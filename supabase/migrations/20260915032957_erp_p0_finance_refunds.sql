-- ERP P0 finance integrity: complete receivable settlements and fulfilled-order refunds.
-- Imperative migration; all externally callable commands are tenant/branch authorized,
-- idempotent, and keep financial/stock facts append-only.

set search_path = erp, public, pg_catalog, pg_temp;

-- ---------------------------------------------------------------------------
-- Receivable settlements: preserve the existing payment fact while linking it
-- to its settlement method, cash ledger (when applicable), customer subledger,
-- and general ledger.
-- ---------------------------------------------------------------------------

alter table erp.receivable_payments
  add column payment_method_id uuid,
  add column cash_session_id uuid,
  add column exchange_rate numeric(24, 10),
  add column amount_base numeric(18, 2),
  add column settlement_account_id uuid,
  add column journal_entry_id uuid,
  add column request_hash text;

alter table erp.receivable_payments
  add constraint receivable_payments_method_fk
    foreign key (payment_method_id, organization_id)
    references erp.payment_methods(id, organization_id) on delete restrict,
  add constraint receivable_payments_session_fk
    foreign key (cash_session_id, organization_id, branch_id)
    references erp.cash_sessions(id, organization_id, branch_id) on delete restrict,
  add constraint receivable_payments_settlement_account_fk
    foreign key (settlement_account_id, organization_id)
    references erp.chart_of_accounts(id, organization_id) on delete restrict,
  add constraint receivable_payments_journal_fk
    foreign key (journal_entry_id, organization_id)
    references erp.journal_entries(id, organization_id) on delete restrict;

alter table erp.receivable_payments
  drop constraint receivable_payments_amount;
alter table erp.receivable_payments
  add constraint receivable_payments_amount check (
    amount <> 'NaN'::numeric
    and currency_code ~ '^[A-Z]{3}$'
    and (
      (reversed_payment_id is null and amount > 0)
      or (reversed_payment_id is not null and amount < 0)
    )
  ),
  add constraint receivable_payments_settlement_shape check (
    (payment_method_id is null and cash_session_id is null and exchange_rate is null
      and amount_base is null and settlement_account_id is null and journal_entry_id is null
      and request_hash is null)
    or
    (payment_method_id is not null and exchange_rate is not null and exchange_rate > 0
      and amount_base is not null and amount_base <> 0
      and sign(amount_base) = sign(amount)
      and settlement_account_id is not null
      and nullif(btrim(request_hash), '') is not null)
  );

create unique index receivable_payments_reversal_unique
  on erp.receivable_payments (reversed_payment_id)
  where reversed_payment_id is not null;

alter table erp.receivable_payment_allocations
  drop constraint receivable_payment_allocations_amounts;
alter table erp.receivable_payment_allocations
  add constraint receivable_payment_allocations_amounts check (
    principal_amount + interest_amount + late_fee_amount <> 0
    and (
      (principal_amount >= 0 and interest_amount >= 0 and late_fee_amount >= 0)
      or (principal_amount <= 0 and interest_amount <= 0 and late_fee_amount <= 0)
    )
  );

alter table erp.cash_movements
  add column receivable_payment_id uuid;
alter table erp.cash_movements
  add constraint cash_movements_receivable_payment_fk
    foreign key (receivable_payment_id, organization_id)
    references erp.receivable_payments(id, organization_id) on delete restrict,
  add constraint cash_movements_single_payment_source check (
    (kind in ('payment', 'refund') and num_nonnulls(payment_id, receivable_payment_id) = 1)
    or (kind not in ('payment', 'refund') and payment_id is null and receivable_payment_id is null)
  );

create table erp.financing_account_entries (
  id bigint generated always as identity primary key,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid not null,
  contract_id uuid not null,
  receivable_payment_id uuid not null,
  amount_base_delta numeric(18, 2) not null
    check (amount_base_delta <> 'NaN'::numeric and amount_base_delta <> 0),
  entry_kind text not null check (entry_kind in ('payment', 'payment_reversal')),
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint financing_account_entries_contract_fk
    foreign key (contract_id, organization_id)
    references erp.financing_contracts(id, organization_id) on delete restrict,
  constraint financing_account_entries_customer_fk
    foreign key (customer_id, organization_id)
    references erp.customers(id, organization_id) on delete restrict,
  constraint financing_account_entries_payment_fk
    foreign key (receivable_payment_id, organization_id)
    references erp.receivable_payments(id, organization_id) on delete restrict,
  constraint financing_account_entries_branch_fk
    foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint financing_account_entries_payment_unique unique (receivable_payment_id)
);

alter table erp.financing_account_entries enable row level security;
create policy financing_account_entries_select
on erp.financing_account_entries
for select to authenticated
using (
  organization_id = (select erp.current_organization_id())
  and erp.has_permission('accounts_receivable.view', branch_id)
);

create index financing_account_entries_customer_time_idx
  on erp.financing_account_entries (organization_id, customer_id, occurred_at desc, id desc);

create trigger financing_account_entries_immutable
before update or delete on erp.financing_account_entries
for each row execute function erp.prevent_fact_mutation();
create trigger financing_account_entries_audit
after insert on erp.financing_account_entries
for each row execute function erp.audit_operational_fact();

create or replace function erp.protect_receivable_payment()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
begin
  if current_setting('erp.allow_receivable_journal_link', true) = 'on'
     and old.journal_entry_id is null
     and new.journal_entry_id is not null
     and (to_jsonb(new) - 'journal_entry_id') = (to_jsonb(old) - 'journal_entry_id') then
    return new;
  end if;
  if to_jsonb(new) <> to_jsonb(old) then
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'receivable payments are immutable; use a reversal';
  end if;
  return new;
end;
$$;

drop trigger if exists receivable_payments_immutable on erp.receivable_payments;
create trigger receivable_payments_immutable
before update on erp.receivable_payments
for each row execute function erp.protect_receivable_payment();
drop trigger if exists receivable_payment_allocations_immutable on erp.receivable_payment_allocations;
create trigger receivable_payment_allocations_immutable
before update on erp.receivable_payment_allocations
for each row execute function erp.prevent_fact_mutation();

-- Payment/refund movements may now originate from either the sales payment fact
-- or the financing receivable payment fact, never both.
create or replace function erp.validate_cash_reversal()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
begin
  if new.kind = 'payment' and new.payment_id is not null and not exists (
    select 1 from erp.payments payment
    where payment.id = new.payment_id
      and payment.organization_id = new.organization_id
      and payment.branch_id = new.branch_id
      and payment.cash_session_id = new.cash_session_id
      and payment.currency_code = new.currency_code
      and payment.amount = new.amount
      and payment.reversal_of_payment_id is null
  ) then
    raise exception using errcode = 'check_violation',
      message = 'cash payment movement must match its sale payment';
  end if;

  if new.kind = 'payment' and new.receivable_payment_id is not null and not exists (
    select 1 from erp.receivable_payments payment
    where payment.id = new.receivable_payment_id
      and payment.organization_id = new.organization_id
      and payment.branch_id = new.branch_id
      and payment.cash_session_id = new.cash_session_id
      and payment.currency_code = new.currency_code
      and payment.amount = new.amount
      and payment.reversed_payment_id is null
  ) then
    raise exception using errcode = 'check_violation',
      message = 'cash payment movement must match its receivable payment';
  end if;

  if new.reversal_of_movement_id is not null and new.payment_id is not null and not exists (
    select 1
    from erp.cash_movements original
    join erp.payments reversal on reversal.id = new.payment_id
    where original.id = new.reversal_of_movement_id
      and original.organization_id = new.organization_id
      and original.branch_id = new.branch_id
      and original.currency_code = new.currency_code
      and original.amount = -new.amount
      and original.reversal_of_movement_id is null
      and reversal.organization_id = new.organization_id
      and reversal.branch_id = new.branch_id
      and reversal.cash_session_id = new.cash_session_id
      and reversal.currency_code = new.currency_code
      and reversal.amount = new.amount
      and reversal.reversal_of_payment_id = original.payment_id
  ) then
    raise exception using errcode = 'check_violation',
      message = 'cash reversal must exactly offset its sale payment movement';
  end if;

  if new.reversal_of_movement_id is not null and new.receivable_payment_id is not null and not exists (
    select 1
    from erp.cash_movements original
    join erp.receivable_payments reversal on reversal.id = new.receivable_payment_id
    where original.id = new.reversal_of_movement_id
      and original.organization_id = new.organization_id
      and original.branch_id = new.branch_id
      and original.currency_code = new.currency_code
      and original.amount = -new.amount
      and original.reversal_of_movement_id is null
      and reversal.organization_id = new.organization_id
      and reversal.branch_id = new.branch_id
      and reversal.cash_session_id = new.cash_session_id
      and reversal.currency_code = new.currency_code
      and reversal.amount = new.amount
      and reversal.reversed_payment_id = original.receivable_payment_id
  ) then
    raise exception using errcode = 'check_violation',
      message = 'cash reversal must exactly offset its receivable payment movement';
  end if;
  return new;
end;
$$;

create or replace function erp.ensure_settlement_accounting_setup(
  target_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  default_row record;
  account_id_value uuid;
begin
  if target_organization_id is null or not exists (
    select 1 from erp.organizations organization
    where organization.id = target_organization_id
  ) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'a valid organization is required';
  end if;
  for default_row in
    select * from (values
      ('bank_ars', '1.1.05', 'Banco y medios a acreditar ARS'),
      ('bank_usd', '1.1.06', 'Banco y medios a acreditar USD')
    ) as defaults(role_code, code, name)
  loop
    insert into erp.chart_of_accounts (
      organization_id, code, name, account_type, normal_balance, is_control
    ) values (
      target_organization_id, default_row.code, default_row.name,
      'asset'::erp.account_type, 'debit'::erp.account_normal_balance, true
    )
    on conflict on constraint chart_of_accounts_code_unique do update
      set is_active = true
    returning id into account_id_value;

    insert into erp.accounting_account_roles (
      organization_id, role_code, account_id
    ) values (
      target_organization_id, default_row.role_code, account_id_value
    ) on conflict on constraint accounting_account_roles_unique do nothing;
  end loop;
end;
$$;

create or replace function erp.provision_organization_settlement_accounts()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
begin
  perform erp.ensure_settlement_accounting_setup(new.id);
  return new;
end;
$$;

drop trigger if exists organizations_provision_settlement_accounts on erp.organizations;
create trigger organizations_provision_settlement_accounts
after insert on erp.organizations
for each row execute function erp.provision_organization_settlement_accounts();

do $$
declare
  organization_row record;
begin
  for organization_row in select organization.id from erp.organizations organization
  loop
    perform erp.ensure_settlement_accounting_setup(organization_row.id);
  end loop;
end;
$$;

-- Internal posting primitive. It is deliberately unavailable through the Data
-- API; only already-authorized business commands call it.
create or replace function erp.post_internal_journal_entry(
  target_organization_id uuid,
  target_branch_id uuid,
  target_entry_date date,
  target_source_type text,
  target_source_id uuid,
  target_posting_kind text,
  operation_key text,
  operation_reason text,
  lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  period_id_value uuid;
  entry_id_value uuid;
  line_value jsonb;
  line_number_value integer := 0;
  debit_total_value numeric(18, 2) := 0;
  credit_total_value numeric(18, 2) := 0;
begin
  if target_organization_id is null
     or target_organization_id is distinct from erp.current_organization_id()
     or not exists (
       select 1 from erp.branches branch
       where branch.id = target_branch_id
         and branch.organization_id = target_organization_id
         and branch.is_active
     )
     or target_entry_date is null
     or nullif(btrim(target_source_type), '') is null
     or target_source_id is null
     or nullif(btrim(target_posting_kind), '') is null
     or nullif(btrim(operation_key), '') is null
     or nullif(btrim(operation_reason), '') is null
     or lines is null or jsonb_typeof(lines) <> 'array'
     or jsonb_array_length(lines) < 2 then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'complete internal journal data is required';
  end if;

  select source_event.journal_entry_id into entry_id_value
  from erp.accounting_source_events source_event
  where source_event.organization_id = target_organization_id
    and source_event.source_type = target_source_type
    and source_event.source_id = target_source_id
    and source_event.posting_kind = target_posting_kind;
  if entry_id_value is not null then
    return entry_id_value;
  end if;

  if exists (
    select 1 from erp.journal_entries entry
    where entry.organization_id = target_organization_id
      and entry.idempotency_key = operation_key
  ) then
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'journal idempotency key is already used by another source event';
  end if;

  period_id_value := erp.ensure_open_period(target_entry_date, target_organization_id);
  insert into erp.journal_entries (
    organization_id, branch_id, period_id, entry_date, status, description,
    source_type, source_id, idempotency_key, created_by
  ) values (
    target_organization_id, target_branch_id, period_id_value, target_entry_date,
    'draft', operation_reason, target_source_type, target_source_id,
    operation_key, auth.uid()
  ) returning id into entry_id_value;

  for line_value in select value from jsonb_array_elements(lines)
  loop
    line_number_value := line_number_value + 1;
    if not erp.is_finite_numeric_text(coalesce(line_value->>'debit', '0'))
       or not erp.is_finite_numeric_text(coalesce(line_value->>'credit', '0'))
       or coalesce((line_value->>'debit')::numeric, 0) < 0
       or coalesce((line_value->>'credit')::numeric, 0) < 0
       or num_nonnulls(
         nullif(coalesce((line_value->>'debit')::numeric, 0), 0),
         nullif(coalesce((line_value->>'credit')::numeric, 0), 0)
       ) <> 1
       or not exists (
         select 1 from erp.chart_of_accounts account
         where account.id = (line_value->>'account_id')::uuid
           and account.organization_id = target_organization_id
           and account.is_active
       ) then
      raise exception using errcode = 'invalid_parameter_value',
        message = 'each journal line requires one active account and one positive side';
    end if;

    insert into erp.journal_entry_lines (
      organization_id, journal_entry_id, line_number, account_id, description,
      debit, credit, currency_code, exchange_rate
    ) values (
      target_organization_id, entry_id_value, line_number_value,
      (line_value->>'account_id')::uuid,
      coalesce(nullif(btrim(line_value->>'description'), ''), operation_reason),
      coalesce((line_value->>'debit')::numeric, 0),
      coalesce((line_value->>'credit')::numeric, 0),
      upper(coalesce(nullif(btrim(line_value->>'currency_code'), ''), 'ARS')),
      coalesce((line_value->>'exchange_rate')::numeric, 1)
    );
    debit_total_value := debit_total_value + coalesce((line_value->>'debit')::numeric, 0);
    credit_total_value := credit_total_value + coalesce((line_value->>'credit')::numeric, 0);
  end loop;

  if debit_total_value <= 0 or round(debit_total_value, 2) <> round(credit_total_value, 2) then
    raise exception using errcode = 'check_violation',
      message = 'journal entry must balance Debe=Haber';
  end if;

  update erp.journal_entries
  set total_debit = round(debit_total_value, 2),
      total_credit = round(credit_total_value, 2),
      status = 'posted', posted_at = now(), posted_by = auth.uid()
  where id = entry_id_value and organization_id = target_organization_id;

  insert into erp.accounting_source_events (
    organization_id, source_type, source_id, posting_kind, journal_entry_id
  ) values (
    target_organization_id, target_source_type, target_source_id,
    target_posting_kind, entry_id_value
  );
  return entry_id_value;
end;
$$;

create or replace function erp.reverse_internal_journal_entry(
  target_organization_id uuid,
  target_entry_id uuid,
  target_source_type text,
  target_source_id uuid,
  operation_key text,
  operation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  original_entry erp.journal_entries%rowtype;
  reversal_id_value uuid;
  reversal_lines jsonb;
begin
  select entry.* into original_entry
  from erp.journal_entries entry
  where entry.id = target_entry_id
    and entry.organization_id = target_organization_id
  for update;
  if original_entry.id is null
     or original_entry.status not in ('posted', 'reversed')
     or target_organization_id is distinct from erp.current_organization_id()
     or nullif(btrim(operation_key), '') is null
     or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'a posted tenant journal and reversal data are required';
  end if;
  if original_entry.status = 'reversed' then
    return original_entry.reversal_of_entry_id;
  end if;

  select jsonb_agg(jsonb_build_object(
    'account_id', line.account_id,
    'description', 'Reversa: ' || line.description,
    'debit', line.credit,
    'credit', line.debit,
    'currency_code', line.currency_code,
    'exchange_rate', line.exchange_rate
  ) order by line.line_number)
  into reversal_lines
  from erp.journal_entry_lines line
  where line.journal_entry_id = original_entry.id
    and line.organization_id = target_organization_id;

  reversal_id_value := erp.post_internal_journal_entry(
    target_organization_id, original_entry.branch_id, current_date,
    target_source_type, target_source_id, 'reversal', operation_key,
    operation_reason, reversal_lines
  );
  update erp.journal_entries
  set status = 'reversed', reversal_of_entry_id = reversal_id_value
  where id = original_entry.id and organization_id = target_organization_id;
  return reversal_id_value;
end;
$$;

create or replace function erp.record_receivable_payment_settlement(
  target_branch_id uuid,
  target_contract_id uuid,
  target_payment_method_id uuid,
  target_cash_session_id uuid,
  payment_amount numeric,
  operation_key text,
  operation_reason text,
  payment_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  contract_row erp.financing_contracts%rowtype;
  method_row erp.payment_methods%rowtype;
  payment_id_value uuid;
  remaining numeric(18, 2) := round(payment_amount, 2);
  late_allocation numeric(18, 2);
  interest_allocation numeric(18, 2);
  principal_allocation numeric(18, 2);
  total_late numeric(18, 2) := 0;
  total_interest numeric(18, 2) := 0;
  total_principal numeric(18, 2) := 0;
  principal_base_value numeric(18, 2);
  finance_income_base_value numeric(18, 2);
  installment_row record;
  exchange_rate_value numeric(24, 10);
  amount_base_value numeric(18, 2);
  settlement_account_id_value uuid;
  receivable_account_id_value uuid;
  financing_income_account_id_value uuid;
  journal_id_value uuid;
  request_hash_value text;
  outstanding_value numeric(18, 2);
begin
  if org_id is null
     or not erp.has_permission('accounts_receivable.manage', target_branch_id)
     or payment_amount is null or payment_amount = 'NaN'::numeric
     or round(payment_amount, 2) <= 0
     or nullif(btrim(operation_key), '') is null
     or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'payment, permission, key and reason are required';
  end if;

  select contract.* into contract_row
  from erp.financing_contracts contract
  where contract.id = target_contract_id
    and contract.organization_id = org_id
    and contract.branch_id = target_branch_id
  for update;
  if contract_row.id is null or contract_row.status in ('cancelled', 'uncollectible', 'paid') then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'an open financing contract is required';
  end if;

  select method.* into method_row
  from erp.payment_methods method
  where method.id = target_payment_method_id
    and method.organization_id = org_id
    and method.is_active;
  if method_row.id is null
     or (method_row.requires_cash_session and target_cash_session_id is null)
     or (not method_row.requires_cash_session and target_cash_session_id is not null) then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'an active payment method and matching cash session are required';
  end if;

  if target_cash_session_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      org_id::text || ':cash-session:' || target_cash_session_id::text, 0
    ));
    if exists (
      select 1 from erp.cash_closures closure
      where closure.cash_session_id = target_cash_session_id
    ) or not exists (
      select 1
      from erp.cash_sessions session
      join erp.cash_session_opening_counts opening
        on opening.cash_session_id = session.id
       and opening.organization_id = session.organization_id
       and opening.branch_id = session.branch_id
      where session.id = target_cash_session_id
        and session.organization_id = org_id
        and session.branch_id = target_branch_id
        and opening.currency_code = contract_row.currency_code
    ) then
      raise exception using errcode = 'object_not_in_prerequisite_state',
        message = 'an open same-branch cash session with the contract currency is required';
    end if;
  end if;

  select coalesce(snapshot.rate_to_base,
    case when currency.is_base then 1::numeric else null end)
  into exchange_rate_value
  from erp.organization_currencies currency
  left join erp.exchange_rate_snapshots snapshot
    on snapshot.id = contract_row.exchange_snapshot_id
   and snapshot.organization_id = contract_row.organization_id
   and snapshot.quote_currency = contract_row.currency_code
  where currency.organization_id = contract_row.organization_id
    and currency.currency_code = contract_row.currency_code
    and currency.is_active;
  if exchange_rate_value is null or exchange_rate_value <= 0 then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'a valid contract exchange rate is required';
  end if;
  amount_base_value := round(payment_amount * exchange_rate_value, 2);

  select role.account_id into settlement_account_id_value
  from erp.accounting_account_roles role
  where role.organization_id = org_id
    and role.role_code = case
      when method_row.settlement_kind = 'cash' then 'cash_' || lower(contract_row.currency_code)
      else 'bank_' || lower(contract_row.currency_code)
    end;
  select role.account_id into receivable_account_id_value
  from erp.accounting_account_roles role
  where role.organization_id = org_id and role.role_code = 'receivable';
  select role.account_id into financing_income_account_id_value
  from erp.accounting_account_roles role
  where role.organization_id = org_id and role.role_code = 'financing_income';
  if settlement_account_id_value is null or receivable_account_id_value is null
     or financing_income_account_id_value is null then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'settlement, receivable and financing income account roles are required';
  end if;

  request_hash_value := md5(jsonb_build_object(
    'branch_id', target_branch_id,
    'contract_id', target_contract_id,
    'payment_method_id', target_payment_method_id,
    'cash_session_id', target_cash_session_id,
    'amount', round(payment_amount, 2),
    'reason', operation_reason,
    'reference', nullif(btrim(payment_reference), '')
  )::text);
  select payment.id into payment_id_value
  from erp.receivable_payments payment
  where payment.organization_id = org_id
    and payment.branch_id = target_branch_id
    and payment.idempotency_key = operation_key;
  if payment_id_value is not null then
    if exists (
      select 1 from erp.receivable_payments payment
      where payment.id = payment_id_value and payment.request_hash = request_hash_value
    ) then
      return payment_id_value;
    end if;
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'receivable payment idempotency key is already used by another request';
  end if;

  select coalesce(sum(
    installment.principal_due + installment.interest_due + installment.late_fee_due
    - installment.paid_principal - installment.paid_interest - installment.paid_late_fee
  ), 0)
  into outstanding_value
  from erp.financing_installments installment
  where installment.contract_id = target_contract_id
    and installment.organization_id = org_id;
  if remaining > outstanding_value then
    raise exception using errcode = 'check_violation',
      message = 'payment exceeds the outstanding balance';
  end if;

  -- The journal FK is deferred until the internally posted source event exists.
  insert into erp.receivable_payments (
    organization_id, branch_id, contract_id, currency_code, amount,
    reference, idempotency_key, reason, created_by,
    payment_method_id, cash_session_id, exchange_rate, amount_base,
    settlement_account_id, request_hash
  ) values (
    org_id, target_branch_id, target_contract_id, contract_row.currency_code,
    round(payment_amount, 2), nullif(btrim(payment_reference), ''),
    operation_key, operation_reason, auth.uid(), target_payment_method_id,
    target_cash_session_id, exchange_rate_value, amount_base_value,
    settlement_account_id_value, request_hash_value
  ) returning id into payment_id_value;

  for installment_row in
    select installment.*
    from erp.financing_installments installment
    where installment.contract_id = target_contract_id
      and installment.organization_id = org_id
      and installment.principal_due + installment.interest_due + installment.late_fee_due
        > installment.paid_principal + installment.paid_interest + installment.paid_late_fee
    order by installment.due_date, installment.installment_number
    for update
  loop
    exit when remaining <= 0;
    late_allocation := least(remaining,
      installment_row.late_fee_due - installment_row.paid_late_fee);
    remaining := remaining - late_allocation;
    interest_allocation := least(remaining,
      installment_row.interest_due - installment_row.paid_interest);
    remaining := remaining - interest_allocation;
    principal_allocation := least(remaining,
      installment_row.principal_due - installment_row.paid_principal);
    remaining := remaining - principal_allocation;

    if late_allocation + interest_allocation + principal_allocation > 0 then
      update erp.financing_installments
      set paid_late_fee = paid_late_fee + late_allocation,
          paid_interest = paid_interest + interest_allocation,
          paid_principal = paid_principal + principal_allocation,
          status = case
            when paid_principal + principal_allocation >= principal_due
             and paid_interest + interest_allocation >= interest_due
             and paid_late_fee + late_allocation >= late_fee_due
              then 'paid'::erp.financing_installment_status
            else 'partially_paid'::erp.financing_installment_status
          end
      where id = installment_row.id and organization_id = org_id;

      insert into erp.receivable_payment_allocations (
        organization_id, payment_id, installment_id,
        principal_amount, interest_amount, late_fee_amount
      ) values (
        org_id, payment_id_value, installment_row.id,
        principal_allocation, interest_allocation, late_allocation
      );
      total_principal := total_principal + principal_allocation;
      total_interest := total_interest + interest_allocation;
      total_late := total_late + late_allocation;
    end if;
  end loop;
  if remaining <> 0 then
    raise exception using errcode = 'check_violation',
      message = 'payment could not be allocated exactly';
  end if;

  principal_base_value := round(total_principal * exchange_rate_value, 2);
  finance_income_base_value := amount_base_value - principal_base_value;

  journal_id_value := erp.post_internal_journal_entry(
    org_id, target_branch_id, current_date, 'receivable_payment', payment_id_value,
    'primary', operation_key || ':journal', operation_reason,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', settlement_account_id_value,
        'description', 'Cobro financiación ' || target_contract_id::text,
        'debit', amount_base_value, 'credit', 0,
        'currency_code', contract_row.currency_code,
        'exchange_rate', exchange_rate_value
      ),
      jsonb_build_object(
        'account_id', receivable_account_id_value,
        'description', 'Capital cobrado ' || target_contract_id::text,
        'debit', 0, 'credit', principal_base_value,
        'currency_code', contract_row.currency_code,
        'exchange_rate', exchange_rate_value
      )
    ) || case when finance_income_base_value > 0 then jsonb_build_array(
      jsonb_build_object(
        'account_id', financing_income_account_id_value,
        'description', 'Interés y mora cobrados ' || target_contract_id::text,
        'debit', 0, 'credit', finance_income_base_value,
        'currency_code', contract_row.currency_code,
        'exchange_rate', exchange_rate_value
      )
    ) else '[]'::jsonb end
  );

  -- The payment is immutable to API users; this controlled link completes the
  -- same transaction before the command returns.
  perform set_config('erp.allow_receivable_journal_link', 'on', true);
  update erp.receivable_payments
  set journal_entry_id = journal_id_value
  where id = payment_id_value and organization_id = org_id;
  perform set_config('erp.allow_receivable_journal_link', 'off', true);

  insert into erp.financing_account_entries (
    organization_id, branch_id, customer_id, contract_id,
    receivable_payment_id, amount_base_delta, entry_kind, actor_id
  ) values (
    org_id, target_branch_id, contract_row.customer_id, target_contract_id,
    payment_id_value, -amount_base_value, 'payment', auth.uid()
  );

  if target_cash_session_id is not null then
    insert into erp.cash_movements (
      organization_id, branch_id, cash_session_id, kind, currency_code, amount,
      receivable_payment_id, idempotency_key, request_hash, reason, actor_id
    ) values (
      org_id, target_branch_id, target_cash_session_id, 'payment',
      contract_row.currency_code, round(payment_amount, 2), payment_id_value,
      operation_key || ':cash', request_hash_value, operation_reason, auth.uid()
    );
  end if;

  select coalesce(sum(
    installment.principal_due + installment.interest_due + installment.late_fee_due
    - installment.paid_principal - installment.paid_interest - installment.paid_late_fee
  ), 0)
  into outstanding_value
  from erp.financing_installments installment
  where installment.contract_id = target_contract_id
    and installment.organization_id = org_id;
  update erp.financing_contracts
  set status = case when outstanding_value = 0
    then 'paid'::erp.financing_status else 'partially_paid'::erp.financing_status end
  where id = target_contract_id and organization_id = org_id;
  return payment_id_value;
end;
$$;

-- Backward-compatible command used by the current UI. It is safe only when a
-- single open cash session and a single active cash method make settlement
-- unambiguous; otherwise callers must use the explicit settlement command.
create or replace function erp.record_receivable_payment(
  target_branch_id uuid,
  target_contract_id uuid,
  payment_amount numeric,
  operation_key text,
  operation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  currency_value text;
  method_id_value uuid;
  session_id_value uuid;
  method_count integer;
  session_count integer;
begin
  select contract.currency_code into currency_value
  from erp.financing_contracts contract
  where contract.id = target_contract_id
    and contract.organization_id = org_id
    and contract.branch_id = target_branch_id;
  if currency_value is null then
    raise exception using errcode = 'no_data_found',
      message = 'financing contract not found';
  end if;
  select min(method.id::text)::uuid, count(*) into method_id_value, method_count
  from erp.payment_methods method
  where method.organization_id = org_id and method.is_active
    and method.requires_cash_session;
  select min(session.id::text)::uuid, count(*) into session_id_value, session_count
  from erp.cash_sessions session
  join erp.cash_session_opening_counts opening
    on opening.cash_session_id = session.id
   and opening.organization_id = session.organization_id
   and opening.branch_id = session.branch_id
  where session.organization_id = org_id
    and session.branch_id = target_branch_id
    and opening.currency_code = currency_value
    and not exists (
      select 1 from erp.cash_closures closure
      where closure.cash_session_id = session.id
    );
  if method_count <> 1 or session_count <> 1 then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'settlement is ambiguous; use record_receivable_payment_settlement with an explicit payment method and cash session';
  end if;
  return erp.record_receivable_payment_settlement(
    target_branch_id, target_contract_id, method_id_value, session_id_value,
    payment_amount, operation_key, operation_reason, null
  );
end;
$$;

create or replace function erp.reverse_receivable_payment(
  target_payment_id uuid,
  operation_key text,
  operation_reason text,
  target_refund_cash_session_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  original erp.receivable_payments%rowtype;
  contract_row erp.financing_contracts%rowtype;
  original_cash erp.cash_movements%rowtype;
  refund_session_id uuid;
  reversal_id_value uuid;
  reversal_journal_id uuid;
  request_hash_value text;
  allocation_row record;
  paid_total_value numeric(18, 2);
begin
  select payment.* into original
  from erp.receivable_payments payment
  where payment.id = target_payment_id
    and payment.organization_id = org_id
  for update;
  if original.id is null or original.reversed_payment_id is not null
     or original.payment_method_id is null or original.journal_entry_id is null
     or not erp.has_permission('accounts_receivable.manage', original.branch_id) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'an authorized, posted receivable payment is required';
  end if;
  if nullif(btrim(operation_key), '') is null
     or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'payment reversal operation data is required';
  end if;

  request_hash_value := md5(jsonb_build_object(
    'payment_id', target_payment_id,
    'reason', operation_reason,
    'refund_cash_session_id', target_refund_cash_session_id
  )::text);
  select payment.id into reversal_id_value
  from erp.receivable_payments payment
  where payment.reversed_payment_id = target_payment_id;
  if reversal_id_value is not null then
    if exists (
      select 1 from erp.receivable_payments payment
      where payment.id = reversal_id_value
        and payment.idempotency_key = operation_key
        and payment.request_hash = request_hash_value
    ) then
      return reversal_id_value;
    end if;
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'receivable payment already has a different reversal';
  end if;

  select contract.* into contract_row
  from erp.financing_contracts contract
  where contract.id = original.contract_id
    and contract.organization_id = org_id
  for update;

  select movement.* into original_cash
  from erp.cash_movements movement
  where movement.receivable_payment_id = original.id;
  if original_cash.id is not null then
    refund_session_id := original_cash.cash_session_id;
    if exists (
      select 1 from erp.cash_closures closure
      where closure.cash_session_id = refund_session_id
    ) then
      refund_session_id := target_refund_cash_session_id;
    end if;
    if refund_session_id is null then
      raise exception using errcode = 'object_not_in_prerequisite_state',
        message = 'an open refund cash session is required';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      org_id::text || ':cash-session:' || refund_session_id::text, 0
    ));
    if exists (
      select 1 from erp.cash_closures closure
      where closure.cash_session_id = refund_session_id
    ) or not exists (
      select 1
      from erp.cash_sessions session
      join erp.cash_session_opening_counts opening
        on opening.cash_session_id = session.id
       and opening.organization_id = session.organization_id
       and opening.branch_id = session.branch_id
      where session.id = refund_session_id
        and session.organization_id = org_id
        and session.branch_id = original.branch_id
        and opening.currency_code = original.currency_code
    ) then
      raise exception using errcode = 'object_not_in_prerequisite_state',
        message = 'open same-branch refund session with the payment currency is required';
    end if;
  elsif target_refund_cash_session_id is not null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'a non-cash payment cannot reference a refund cash session';
  end if;

  reversal_id_value := gen_random_uuid();
  reversal_journal_id := erp.reverse_internal_journal_entry(
    org_id, original.journal_entry_id, 'receivable_payment_reversal',
    reversal_id_value, operation_key || ':journal', operation_reason
  );

  insert into erp.receivable_payments (
    id, organization_id, branch_id, contract_id, currency_code, amount,
    reference, idempotency_key, reason, reversed_payment_id, created_by,
    payment_method_id, cash_session_id, exchange_rate, amount_base,
    settlement_account_id, journal_entry_id, request_hash
  ) values (
    reversal_id_value, org_id, original.branch_id, original.contract_id,
    original.currency_code, -original.amount, original.reference,
    operation_key, operation_reason, original.id, auth.uid(),
    original.payment_method_id, refund_session_id, original.exchange_rate,
    -original.amount_base, original.settlement_account_id,
    reversal_journal_id, request_hash_value
  );

  for allocation_row in
    select allocation.*
    from erp.receivable_payment_allocations allocation
    where allocation.payment_id = original.id
      and allocation.organization_id = org_id
    order by allocation.id
  loop
    perform 1 from erp.financing_installments installment
    where installment.id = allocation_row.installment_id
      and installment.organization_id = org_id
    for update;
    update erp.financing_installments
    set paid_principal = paid_principal - allocation_row.principal_amount,
        paid_interest = paid_interest - allocation_row.interest_amount,
        paid_late_fee = paid_late_fee - allocation_row.late_fee_amount,
        status = case
          when paid_principal - allocation_row.principal_amount
                 + paid_interest - allocation_row.interest_amount
                 + paid_late_fee - allocation_row.late_fee_amount > 0
            then 'partially_paid'::erp.financing_installment_status
          when due_date < current_date
            then 'due'::erp.financing_installment_status
          else 'upcoming'::erp.financing_installment_status
        end
    where id = allocation_row.installment_id and organization_id = org_id;

    insert into erp.receivable_payment_allocations (
      organization_id, payment_id, installment_id,
      principal_amount, interest_amount, late_fee_amount
    ) values (
      org_id, reversal_id_value, allocation_row.installment_id,
      -allocation_row.principal_amount,
      -allocation_row.interest_amount,
      -allocation_row.late_fee_amount
    );
  end loop;

  insert into erp.financing_account_entries (
    organization_id, branch_id, customer_id, contract_id,
    receivable_payment_id, amount_base_delta, entry_kind, actor_id
  ) values (
    org_id, original.branch_id, contract_row.customer_id, original.contract_id,
    reversal_id_value, original.amount_base, 'payment_reversal', auth.uid()
  );

  if original_cash.id is not null then
    insert into erp.cash_movements (
      organization_id, branch_id, cash_session_id, kind, currency_code, amount,
      receivable_payment_id, reversal_of_movement_id,
      idempotency_key, request_hash, reason, actor_id
    ) values (
      org_id, original.branch_id, refund_session_id, 'refund',
      original.currency_code, -original.amount, reversal_id_value,
      original_cash.id, operation_key || ':cash', request_hash_value,
      operation_reason, auth.uid()
    );
  end if;

  select coalesce(sum(
    installment.paid_principal + installment.paid_interest + installment.paid_late_fee
  ), 0)
  into paid_total_value
  from erp.financing_installments installment
  where installment.contract_id = original.contract_id
    and installment.organization_id = org_id;
  update erp.financing_contracts
  set status = case
    when paid_total_value > 0 then 'partially_paid'::erp.financing_status
    when exists (
      select 1 from erp.financing_installments installment
      where installment.contract_id = original.contract_id
        and installment.organization_id = org_id
        and installment.due_date < current_date
    ) then 'due'::erp.financing_status
    else 'current'::erp.financing_status
  end
  where id = original.contract_id and organization_id = org_id;
  return reversal_id_value;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fulfilled online order refund: a provider refund remains unapplied until the
-- physical return is confirmed. The command then compensates sale/payment,
-- stock, accounting and public storefront state atomically.
-- ---------------------------------------------------------------------------

create table erp.online_order_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  web_order_id uuid not null,
  refund_payment_event_id uuid not null,
  sale_id uuid not null,
  sale_cancellation_event_id uuid not null,
  stock_reversal_document_id uuid not null,
  original_journal_entry_id uuid not null,
  journal_reversal_entry_id uuid not null,
  payment_reversal_ids jsonb not null check (jsonb_typeof(payment_reversal_ids) = 'array'),
  physical_return_confirmed boolean not null check (physical_return_confirmed),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null check (btrim(request_hash) <> ''),
  reason text not null check (btrim(reason) <> ''),
  refunded_at timestamptz not null default now(),
  refunded_by uuid references auth.users(id) on delete restrict,
  constraint online_order_refunds_branch_fk
    foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint online_order_refunds_order_fk
    foreign key (web_order_id, organization_id, branch_id)
    references erp.web_orders(id, organization_id, branch_id) on delete restrict,
  constraint online_order_refunds_event_fk
    foreign key (refund_payment_event_id, organization_id, web_order_id)
    references erp.web_payment_events(id, organization_id, web_order_id) on delete restrict,
  constraint online_order_refunds_sale_fk
    foreign key (sale_id, organization_id, branch_id)
    references erp.sales(id, organization_id, branch_id) on delete restrict,
  constraint online_order_refunds_cancellation_event_fk
    foreign key (sale_cancellation_event_id)
    references erp.sale_state_events(id) on delete restrict,
  constraint online_order_refunds_stock_fk
    foreign key (stock_reversal_document_id, organization_id)
    references erp.stock_documents(id, organization_id) on delete restrict,
  constraint online_order_refunds_original_journal_fk
    foreign key (original_journal_entry_id, organization_id)
    references erp.journal_entries(id, organization_id) on delete restrict,
  constraint online_order_refunds_reversal_journal_fk
    foreign key (journal_reversal_entry_id, organization_id)
    references erp.journal_entries(id, organization_id) on delete restrict,
  constraint online_order_refunds_order_unique unique (web_order_id),
  constraint online_order_refunds_event_unique unique (refund_payment_event_id),
  constraint online_order_refunds_operation_unique
    unique (organization_id, branch_id, idempotency_key)
);

alter table erp.online_order_refunds enable row level security;
create policy online_order_refunds_select
on erp.online_order_refunds
for select to authenticated
using (
  organization_id = (select erp.current_organization_id())
  and erp.has_permission('orders.view', branch_id)
);
create trigger online_order_refunds_immutable
before update or delete on erp.online_order_refunds
for each row execute function erp.prevent_fact_mutation();
create trigger online_order_refunds_audit
after insert on erp.online_order_refunds
for each row execute function erp.audit_operational_fact();

create or replace function erp.protect_web_payment_event()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'web payment events are immutable';
  end if;
  if current_setting('erp.allow_web_refund_apply', true) = 'on'
     and old.status = 'refunded'
     and not old.applied and new.applied
     and new.error_message is null
     and (to_jsonb(new) - array['applied', 'error_message'])
       = (to_jsonb(old) - array['applied', 'error_message']) then
    return new;
  end if;
  if to_jsonb(new) <> to_jsonb(old) then
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'web payment events are immutable; use the atomic refund command';
  end if;
  return new;
end;
$$;

drop trigger if exists web_payment_events_immutable on erp.web_payment_events;
create trigger web_payment_events_immutable
before update or delete on erp.web_payment_events
for each row execute function erp.protect_web_payment_event();

create or replace function erp.refund_fulfilled_online_order(
  target_web_order_id uuid,
  target_refund_payment_event_id uuid,
  physical_return_confirmed boolean,
  operation_key text,
  operation_reason text,
  target_refund_cash_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = erp, public, pg_catalog, pg_temp
as $$
declare
  actor_role text := coalesce(auth.jwt()->>'role', '');
  org_id uuid := erp.current_organization_id();
  refund_event erp.web_payment_events%rowtype;
  order_row erp.web_orders%rowtype;
  fulfillment erp.web_order_fulfillments%rowtype;
  existing erp.online_order_refunds%rowtype;
  original_journal_id uuid;
  reversal_journal_id uuid;
  cancellation_event_id uuid;
  stock_reversal_id uuid;
  refund_id uuid := gen_random_uuid();
  request_hash_value text;
  approved_provider_payment_id text;
  current_order_state text;
  payment_reversal_ids_value jsonb;
  storefront_order_id_value uuid;
begin
  if not coalesce(physical_return_confirmed, false)
     or nullif(btrim(operation_key), '') is null
     or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'physical return confirmation, operation key and reason are required';
  end if;

  select event.* into refund_event
  from erp.web_payment_events event
  where event.id = target_refund_payment_event_id
    and event.web_order_id = target_web_order_id
  for update;
  if refund_event.id is null or refund_event.status <> 'refunded' then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'a provider refund event for the online order is required';
  end if;

  if actor_role = 'service_role' then
    org_id := refund_event.organization_id;
    perform set_config('erp.service_organization_id', org_id::text, true);
  elsif org_id is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'an authenticated ERP actor or service_role is required';
  end if;

  select orders.* into order_row
  from erp.web_orders orders
  where orders.id = target_web_order_id
    and orders.organization_id = org_id
  for update;
  if order_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'online order not found';
  end if;
  if actor_role <> 'service_role' and (
    not erp.has_permission('orders.manage', order_row.branch_id)
    or not erp.has_permission('sales.cancel', order_row.branch_id)
    or not erp.has_permission('stock.adjust', order_row.branch_id)
  ) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'orders.manage, sales.cancel and stock.adjust permissions are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    org_id::text || ':online-order-refund:' || target_web_order_id::text, 0
  ));
  request_hash_value := md5(jsonb_build_object(
    'web_order_id', target_web_order_id,
    'refund_payment_event_id', target_refund_payment_event_id,
    'physical_return_confirmed', true,
    'refund_cash_session_id', target_refund_cash_session_id,
    'reason', operation_reason
  )::text);
  select receipt.* into existing
  from erp.online_order_refunds receipt
  where receipt.organization_id = org_id
    and receipt.web_order_id = target_web_order_id;
  if existing.id is not null then
    if existing.refund_payment_event_id = target_refund_payment_event_id
       and existing.idempotency_key = operation_key
       and existing.request_hash = request_hash_value then
      return jsonb_build_object(
        'refund_id', existing.id,
        'sale_id', existing.sale_id,
        'stock_reversal_document_id', existing.stock_reversal_document_id,
        'journal_reversal_entry_id', existing.journal_reversal_entry_id,
        'payment_reversal_ids', existing.payment_reversal_ids,
        'idempotent', true
      );
    end if;
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'online order already has a different refund receipt';
  end if;

  select fulfillment_row.* into fulfillment
  from erp.web_order_fulfillments fulfillment_row
  where fulfillment_row.web_order_id = target_web_order_id
    and fulfillment_row.organization_id = org_id;
  select event.order_state into current_order_state
  from erp.web_order_events event
  where event.web_order_id = target_web_order_id
    and event.organization_id = org_id
    and event.order_state is not null
  order by event.event_sequence desc limit 1;
  if fulfillment.id is null or current_order_state <> 'fulfilled'
     or refund_event.organization_id <> org_id
     or refund_event.branch_id <> order_row.branch_id
     or refund_event.applied
     or refund_event.amount is distinct from order_row.total_amount then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'an unapplied full provider refund for a fulfilled order is required';
  end if;

  select approved.provider_payment_id into approved_provider_payment_id
  from erp.web_payment_events approved
  join erp.web_order_events event
    on event.source_payment_event_id = approved.id
   and event.organization_id = approved.organization_id
   and event.web_order_id = approved.web_order_id
  where approved.web_order_id = target_web_order_id
    and approved.organization_id = org_id
    and approved.status = 'approved'
    and event.payment_state = 'paid'
  order by event.event_sequence desc limit 1;
  if refund_event.provider_payment_id is distinct from approved_provider_payment_id then
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'refund provider payment does not match the fulfilled payment';
  end if;

  select source_event.journal_entry_id into original_journal_id
  from erp.accounting_source_events source_event
  where source_event.organization_id = org_id
    and source_event.source_type = 'online_order'
    and source_event.source_id = target_web_order_id
    and source_event.posting_kind = 'primary';
  if original_journal_id is null then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'the fulfilled online order journal is required';
  end if;

  cancellation_event_id := erp.cancel_sale(
    fulfillment.sale_id, operation_key || ':sale', operation_reason,
    target_refund_cash_session_id
  );
  select document.id into stock_reversal_id
  from erp.stock_documents document
  where document.organization_id = org_id
    and document.reversed_document_id = fulfillment.stock_document_id;
  if stock_reversal_id is null then
    raise exception using errcode = 'data_exception',
      message = 'sale cancellation did not restore inventory';
  end if;

  select coalesce(jsonb_agg(payment.id order by payment.occurred_at, payment.id), '[]'::jsonb)
  into payment_reversal_ids_value
  from erp.payments payment
  where payment.organization_id = org_id
    and payment.sale_id = fulfillment.sale_id
    and payment.reversal_of_payment_id is not null;
  if jsonb_array_length(payment_reversal_ids_value) = 0 then
    raise exception using errcode = 'data_exception',
      message = 'sale cancellation did not reverse the payment';
  end if;

  reversal_journal_id := erp.reverse_internal_journal_entry(
    org_id, original_journal_id, 'online_order_refund', refund_id,
    operation_key || ':journal', operation_reason
  );

  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, payment_state,
    source_payment_event_id, idempotency_key, request_hash, reason, actor_id
  ) values (
    org_id, order_row.branch_id, target_web_order_id, 'refunded',
    refund_event.id, operation_key || ':payment-state', request_hash_value,
    operation_reason, auth.uid()
  );
  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, order_state,
    source_payment_event_id, idempotency_key, request_hash, reason, actor_id
  ) values (
    org_id, order_row.branch_id, target_web_order_id, 'refunded',
    refund_event.id, operation_key || ':order-state', request_hash_value,
    operation_reason, auth.uid()
  );
  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, delivery_state,
    source_payment_event_id, idempotency_key, request_hash, reason, actor_id
  ) values (
    org_id, order_row.branch_id, target_web_order_id, 'returned',
    refund_event.id, operation_key || ':delivery-state', request_hash_value,
    operation_reason, auth.uid()
  );

  perform set_config('erp.allow_web_refund_apply', 'on', true);
  update erp.web_payment_events
  set applied = true, error_message = null
  where id = refund_event.id and organization_id = org_id and not applied;
  perform set_config('erp.allow_web_refund_apply', 'off', true);

  insert into erp.online_order_refunds (
    id, organization_id, branch_id, web_order_id, refund_payment_event_id,
    sale_id, sale_cancellation_event_id, stock_reversal_document_id,
    original_journal_entry_id, journal_reversal_entry_id,
    payment_reversal_ids, physical_return_confirmed,
    idempotency_key, request_hash, reason, refunded_by
  ) values (
    refund_id, org_id, order_row.branch_id, target_web_order_id, refund_event.id,
    fulfillment.sale_id, cancellation_event_id, stock_reversal_id,
    original_journal_id, reversal_journal_id, payment_reversal_ids_value, true,
    operation_key, request_hash_value, operation_reason, auth.uid()
  );

  select sync.storefront_order_id into storefront_order_id_value
  from erp.storefront_payment_syncs sync
  where sync.organization_id = org_id and sync.web_order_id = target_web_order_id;
  if storefront_order_id_value is not null then
    update public.orders
    set status = 'refunded', stock_decremented = false, updated_at = now()
    where id = storefront_order_id_value;
  end if;

  insert into erp.integration_outbox (
    organization_id, branch_id, aggregate_type, aggregate_id,
    event_type, payload, idempotency_key
  ) values (
    org_id, order_row.branch_id, 'web_order', target_web_order_id,
    'web_order.refunded', jsonb_build_object(
      'web_order_id', target_web_order_id,
      'refund_id', refund_id,
      'refund_payment_event_id', refund_event.id,
      'physical_return_confirmed', true
    ), operation_key || ':outbox'
  );

  return jsonb_build_object(
    'refund_id', refund_id,
    'sale_id', fulfillment.sale_id,
    'stock_reversal_document_id', stock_reversal_id,
    'journal_reversal_entry_id', reversal_journal_id,
    'payment_reversal_ids', payment_reversal_ids_value,
    'idempotent', false
  );
end;
$$;

comment on function erp.record_receivable_payment_settlement(
  uuid, uuid, uuid, uuid, numeric, text, text, text
) is 'Atomic receivable settlement: installment allocation, settlement fact, optional cash movement, customer subledger and balanced journal.';
comment on function erp.reverse_receivable_payment(uuid, text, text, uuid) is
  'Append-only reversal of a receivable settlement, including allocations, cash, customer subledger and journal.';
comment on function erp.refund_fulfilled_online_order(uuid, uuid, boolean, text, text, uuid) is
  'Atomic full refund for a fulfilled online order after confirmed physical return; compensates sale, payments, stock, accounting and storefront state.';

revoke all on erp.financing_account_entries, erp.online_order_refunds
  from public, anon, authenticated, service_role;
grant select on erp.financing_account_entries, erp.online_order_refunds
  to authenticated, service_role;

revoke all on sequence erp.financing_account_entries_id_seq
  from public, anon, authenticated, service_role;

revoke all on function erp.protect_receivable_payment()
  from public, anon, authenticated, service_role;
revoke all on function erp.validate_cash_reversal()
  from public, anon, authenticated, service_role;
revoke all on function erp.ensure_settlement_accounting_setup(uuid)
  from public, anon, authenticated, service_role;
revoke all on function erp.provision_organization_settlement_accounts()
  from public, anon, authenticated, service_role;
revoke all on function erp.post_internal_journal_entry(
  uuid, uuid, date, text, uuid, text, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function erp.reverse_internal_journal_entry(
  uuid, uuid, text, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function erp.protect_web_payment_event()
  from public, anon, authenticated, service_role;

revoke all on function erp.record_receivable_payment_settlement(
  uuid, uuid, uuid, uuid, numeric, text, text, text
) from public, anon, service_role;
grant execute on function erp.record_receivable_payment_settlement(
  uuid, uuid, uuid, uuid, numeric, text, text, text
) to authenticated;
revoke all on function erp.record_receivable_payment(uuid, uuid, numeric, text, text)
  from public, anon, service_role;
grant execute on function erp.record_receivable_payment(uuid, uuid, numeric, text, text)
  to authenticated;
revoke all on function erp.reverse_receivable_payment(uuid, text, text, uuid)
  from public, anon, service_role;
grant execute on function erp.reverse_receivable_payment(uuid, text, text, uuid)
  to authenticated;
revoke all on function erp.refund_fulfilled_online_order(
  uuid, uuid, boolean, text, text, uuid
) from public, anon;
grant execute on function erp.refund_fulfilled_online_order(
  uuid, uuid, boolean, text, text, uuid
) to authenticated, service_role;
