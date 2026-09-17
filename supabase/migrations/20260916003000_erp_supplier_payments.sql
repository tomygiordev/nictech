-- Atomic supplier-payable settlement with payment fact, supplier subledger,
-- optional cash withdrawal and balanced accounting journal.

-- Authorized business commands must be able to post their derived accounting
-- without granting operators the generic accounting.post capability.
create or replace function erp.ensure_open_period_internal(
  target_date date,
  target_organization_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_organization_id uuid := erp.current_organization_id();
  period_id_value uuid;
  period_status_value erp.accounting_period_status;
  month_start date;
begin
  if target_date is null
     or target_organization_id is null
     or auth.uid() is null
     or context_organization_id is null
     or context_organization_id <> target_organization_id then
    raise exception using errcode = 'insufficient_privilege',
      message = 'an authenticated active-organization context is required';
  end if;
  month_start := date_trunc('month', target_date)::date;
  select period.id, period.status
  into period_id_value, period_status_value
  from erp.accounting_periods period
  where period.organization_id = target_organization_id
    and target_date between period.period_start and period.period_end
  for update;
  if period_id_value is not null and period_status_value = 'closed' then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'accounting period is closed';
  end if;
  if period_id_value is null then
    insert into erp.accounting_periods (organization_id, period_start, period_end)
    values (
      target_organization_id, month_start,
      (month_start + interval '1 month - 1 day')::date
    )
    on conflict (organization_id, period_start, period_end) do nothing
    returning id into period_id_value;
    if period_id_value is null then
      select period.id, period.status
      into period_id_value, period_status_value
      from erp.accounting_periods period
      where period.organization_id = target_organization_id
        and target_date between period.period_start and period.period_end
      for update;
      if period_status_value = 'closed' then
        raise exception using errcode = 'object_not_in_prerequisite_state',
          message = 'accounting period is closed';
      end if;
    end if;
  end if;
  return period_id_value;
end;
$$;

do $migration$
declare function_definition text;
begin
  select pg_get_functiondef(
    'erp.post_internal_journal_entry(uuid,uuid,date,text,uuid,text,text,text,jsonb)'::regprocedure
  ) into function_definition;
  function_definition := replace(
    function_definition,
    'erp.ensure_open_period(target_entry_date, target_organization_id)',
    'erp.ensure_open_period_internal(target_entry_date, target_organization_id)'
  );
  if function_definition not like '%ensure_open_period_internal%' then
    raise exception 'private journal period routing did not converge';
  end if;
  execute function_definition;
end;
$migration$;

do $migration$
declare function_definition text;
begin
  select pg_get_functiondef(
    'erp.post_online_order_accounting_internal(uuid,date,text,uuid,text,text,jsonb)'::regprocedure
  ) into function_definition;
  function_definition := replace(
    function_definition,
    'erp.ensure_open_period(target_entry_date, org_id)',
    'erp.ensure_open_period_internal(target_entry_date, org_id)'
  );
  if function_definition not like '%ensure_open_period_internal%' then
    raise exception 'online-order period routing did not converge';
  end if;
  execute function_definition;
end;
$migration$;

revoke all on function erp.ensure_open_period_internal(date, uuid)
from public, anon, authenticated, service_role;

create table erp.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  supplier_id uuid not null,
  payable_id uuid not null,
  payment_method_id uuid not null,
  cash_session_id uuid,
  currency_code text not null,
  amount_currency numeric(18, 4) not null
    check (amount_currency <> 'NaN'::numeric and amount_currency > 0),
  exchange_rate numeric(24, 10) not null
    check (exchange_rate <> 'NaN'::numeric and exchange_rate > 0),
  amount_base numeric(18, 4) not null
    check (amount_base <> 'NaN'::numeric and amount_base > 0),
  settlement_account_id uuid not null,
  journal_entry_id uuid,
  reference text,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  reason text not null check (btrim(reason) <> ''),
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint supplier_payments_id_org_unique unique (id, organization_id),
  constraint supplier_payments_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint supplier_payments_operation_unique unique (organization_id, branch_id, idempotency_key),
  constraint supplier_payments_branch_fk
    foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint supplier_payments_supplier_fk
    foreign key (supplier_id, organization_id)
    references erp.suppliers(id, organization_id) on delete restrict,
  constraint supplier_payments_payable_fk
    foreign key (payable_id, organization_id, branch_id)
    references erp.supplier_payables(id, organization_id, branch_id) on delete restrict,
  constraint supplier_payments_method_fk
    foreign key (payment_method_id, organization_id)
    references erp.payment_methods(id, organization_id) on delete restrict,
  constraint supplier_payments_session_fk
    foreign key (cash_session_id, organization_id, branch_id)
    references erp.cash_sessions(id, organization_id, branch_id) on delete restrict,
  constraint supplier_payments_currency_fk
    foreign key (organization_id, currency_code)
    references erp.organization_currencies(organization_id, currency_code) on delete restrict,
  constraint supplier_payments_settlement_account_fk
    foreign key (settlement_account_id, organization_id)
    references erp.chart_of_accounts(id, organization_id) on delete restrict,
  constraint supplier_payments_journal_fk
    foreign key (journal_entry_id, organization_id)
    references erp.journal_entries(id, organization_id) on delete restrict
);

create table erp.supplier_payment_reversals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  supplier_payment_id uuid not null,
  journal_entry_id uuid,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  reason text not null check (btrim(reason) <> ''),
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint supplier_payment_reversals_id_org_unique unique (id, organization_id),
  constraint supplier_payment_reversals_original_unique
    unique (organization_id, supplier_payment_id),
  constraint supplier_payment_reversals_operation_unique
    unique (organization_id, branch_id, idempotency_key),
  constraint supplier_payment_reversals_branch_fk
    foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint supplier_payment_reversals_payment_fk
    foreign key (supplier_payment_id, organization_id, branch_id)
    references erp.supplier_payments(id, organization_id, branch_id) on delete restrict,
  constraint supplier_payment_reversals_journal_fk
    foreign key (journal_entry_id, organization_id)
    references erp.journal_entries(id, organization_id) on delete restrict
);

alter table erp.supplier_account_entries
  drop constraint supplier_account_entries_payable_unique,
  add column supplier_payment_id uuid,
  add column supplier_payment_reversal_id uuid,
  add column entry_kind text not null default 'payable'
    check (entry_kind in ('payable', 'payment', 'payment_reversal')),
  add constraint supplier_account_entries_payment_fk
    foreign key (supplier_payment_id, organization_id)
    references erp.supplier_payments(id, organization_id) on delete restrict,
  add constraint supplier_account_entries_payment_reversal_fk
    foreign key (supplier_payment_reversal_id, organization_id)
    references erp.supplier_payment_reversals(id, organization_id) on delete restrict,
  add constraint supplier_account_entries_shape check (
    (entry_kind = 'payable' and supplier_payment_id is null
      and supplier_payment_reversal_id is null and amount_base_delta > 0)
    or (entry_kind = 'payment' and supplier_payment_id is not null
      and supplier_payment_reversal_id is null and amount_base_delta < 0)
    or (entry_kind = 'payment_reversal' and supplier_payment_id is not null
      and supplier_payment_reversal_id is not null and amount_base_delta > 0)
  );
create unique index supplier_account_entries_payable_origin_unique
  on erp.supplier_account_entries (payable_id)
  where entry_kind = 'payable';
create unique index supplier_account_entries_payment_unique
  on erp.supplier_account_entries (supplier_payment_id)
  where entry_kind = 'payment';
create unique index supplier_account_entries_payment_reversal_unique
  on erp.supplier_account_entries (supplier_payment_reversal_id)
  where supplier_payment_reversal_id is not null;

alter table erp.cash_movements
  add column supplier_payment_id uuid,
  add constraint cash_movements_supplier_payment_fk
    foreign key (supplier_payment_id, organization_id)
    references erp.supplier_payments(id, organization_id) on delete restrict;
alter table erp.cash_movements drop constraint cash_movements_single_payment_source;
alter table erp.cash_movements add constraint cash_movements_single_payment_source check (
  (
    supplier_payment_id is null
    and (
      (kind in ('payment', 'refund') and num_nonnulls(payment_id, receivable_payment_id) = 1)
      or (kind not in ('payment', 'refund') and payment_id is null and receivable_payment_id is null)
    )
  )
  or (
    supplier_payment_id is not null
    and kind = 'withdrawal'
    and payment_id is null
    and receivable_payment_id is null
  )
);

alter table erp.supplier_payments enable row level security;
create policy supplier_payments_select on erp.supplier_payments
for select to authenticated
using (
  organization_id = (select erp.current_organization_id())
  and erp.has_permission('purchases.view', branch_id)
  and erp.has_permission('costs.view', branch_id)
);

alter table erp.supplier_payment_reversals enable row level security;
create policy supplier_payment_reversals_select on erp.supplier_payment_reversals
for select to authenticated
using (
  organization_id = (select erp.current_organization_id())
  and erp.has_permission('purchases.view', branch_id)
  and erp.has_permission('costs.view', branch_id)
);

create or replace function erp.protect_supplier_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('erp.allow_supplier_journal_link', true) = 'on'
     and old.journal_entry_id is null
     and new.journal_entry_id is not null
     and (to_jsonb(new) - 'journal_entry_id') = (to_jsonb(old) - 'journal_entry_id') then
    return new;
  end if;
  raise exception using errcode = 'integrity_constraint_violation',
    message = 'supplier payments are immutable';
end;
$$;

create trigger supplier_payments_immutable
before update on erp.supplier_payments
for each row execute function erp.protect_supplier_payment();
create trigger supplier_payments_no_delete
before delete on erp.supplier_payments
for each row execute function erp.prevent_fact_mutation();
create trigger supplier_payments_audit
after insert on erp.supplier_payments
for each row execute function erp.audit_operational_fact();

create or replace function erp.protect_supplier_payment_reversal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('erp.allow_supplier_journal_link', true) = 'on'
     and old.journal_entry_id is null
     and new.journal_entry_id is not null
     and (to_jsonb(new) - 'journal_entry_id') = (to_jsonb(old) - 'journal_entry_id') then
    return new;
  end if;
  raise exception using errcode = 'integrity_constraint_violation',
    message = 'supplier payment reversals are immutable';
end;
$$;

create trigger supplier_payment_reversals_immutable
before update on erp.supplier_payment_reversals
for each row execute function erp.protect_supplier_payment_reversal();
create trigger supplier_payment_reversals_no_delete
before delete on erp.supplier_payment_reversals
for each row execute function erp.prevent_fact_mutation();
create trigger supplier_payment_reversals_audit
after insert on erp.supplier_payment_reversals
for each row execute function erp.audit_operational_fact();

create or replace function erp.validate_cash_reversal()
returns trigger
language plpgsql
set search_path = ''
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
  if new.kind = 'withdrawal' and new.supplier_payment_id is not null and not exists (
    select 1 from erp.supplier_payments payment
    where payment.id = new.supplier_payment_id
      and payment.organization_id = new.organization_id
      and payment.branch_id = new.branch_id
      and payment.cash_session_id = new.cash_session_id
      and payment.currency_code = new.currency_code
      and payment.amount_currency = -new.amount
  ) then
    raise exception using errcode = 'check_violation',
      message = 'cash withdrawal must match its supplier payment';
  end if;
  if new.reversal_of_movement_id is not null and new.payment_id is not null and not exists (
    select 1 from erp.cash_movements original
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
    select 1 from erp.cash_movements original
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

create or replace function erp.record_supplier_payment(
  target_payable_id uuid,
  target_payment_method_id uuid,
  target_cash_session_id uuid,
  payment_amount numeric,
  payment_reference text,
  operation_key text,
  operation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_id uuid := erp.current_organization_id();
  payable erp.supplier_payables%rowtype;
  method erp.payment_methods%rowtype;
  payment_id_value uuid;
  exchange_rate_value numeric(24, 10);
  amount_base_value numeric(18, 4);
  outstanding_base_value numeric(18, 4);
  settlement_account_id_value uuid;
  payable_account_id_value uuid;
  journal_id_value uuid;
  request_hash_value text;
begin
  select row_value.* into payable
  from erp.supplier_payables row_value
  where row_value.id = target_payable_id
    and row_value.organization_id = org_id
  for update;
  if payable.id is null
     or not erp.has_permission('purchases.manage', payable.branch_id)
     or not erp.has_permission('costs.manage', payable.branch_id) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'purchases.manage and costs.manage permissions are required';
  end if;
  if payment_amount is null or payment_amount = 'NaN'::numeric
     or round(payment_amount, 4) <= 0
     or nullif(btrim(operation_key), '') is null
     or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'payment amount, operation key and reason are required';
  end if;

  select row_value.* into method
  from erp.payment_methods row_value
  where row_value.id = target_payment_method_id
    and row_value.organization_id = org_id
    and row_value.is_active
    and row_value.settlement_kind <> 'credit';
  if method.id is null
     or (method.requires_cash_session and target_cash_session_id is null)
     or (not method.requires_cash_session and target_cash_session_id is not null) then
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
      select 1 from erp.cash_sessions session
      join erp.cash_session_opening_counts opening
        on opening.cash_session_id = session.id
       and opening.organization_id = session.organization_id
       and opening.branch_id = session.branch_id
      where session.id = target_cash_session_id
        and session.organization_id = org_id
        and session.branch_id = payable.branch_id
        and opening.currency_code = payable.currency_code
    ) then
      raise exception using errcode = 'object_not_in_prerequisite_state',
        message = 'an open same-branch cash session with the payable currency is required';
    end if;
  end if;

  select coalesce(snapshot.rate_to_base, case when currency.is_base then 1::numeric else null end)
  into exchange_rate_value
  from erp.organization_currencies currency
  left join erp.exchange_rate_snapshots snapshot
    on snapshot.id = payable.exchange_snapshot_id
   and snapshot.organization_id = payable.organization_id
   and snapshot.quote_currency = payable.currency_code
  where currency.organization_id = payable.organization_id
    and currency.currency_code = payable.currency_code
    and currency.is_active;
  if exchange_rate_value is null or exchange_rate_value <= 0 then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'a valid payable exchange rate is required';
  end if;
  amount_base_value := round(payment_amount * exchange_rate_value, 4);
  select coalesce(sum(entry.amount_base_delta), 0)
  into outstanding_base_value
  from erp.supplier_account_entries entry
  where entry.payable_id = payable.id and entry.organization_id = org_id;
  if amount_base_value > outstanding_base_value then
    raise exception using errcode = 'check_violation',
      message = 'payment exceeds the outstanding supplier balance';
  end if;

  select role.account_id into settlement_account_id_value
  from erp.accounting_account_roles role
  where role.organization_id = org_id
    and role.role_code = case when method.settlement_kind = 'cash'
      then 'cash_' || lower(payable.currency_code)
      else 'bank_' || lower(payable.currency_code)
    end;
  select role.account_id into payable_account_id_value
  from erp.accounting_account_roles role
  where role.organization_id = org_id and role.role_code = 'suppliers';
  if settlement_account_id_value is null or payable_account_id_value is null then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'supplier and settlement account roles are required';
  end if;

  request_hash_value := md5(jsonb_build_object(
    'payable_id', payable.id,
    'payment_method_id', method.id,
    'cash_session_id', target_cash_session_id,
    'amount', round(payment_amount, 4),
    'reference', nullif(btrim(payment_reference), ''),
    'reason', operation_reason
  )::text);
  select row_value.id into payment_id_value
  from erp.supplier_payments row_value
  where row_value.organization_id = org_id
    and row_value.branch_id = payable.branch_id
    and row_value.idempotency_key = operation_key;
  if payment_id_value is not null then
    if exists (
      select 1 from erp.supplier_payments row_value
      where row_value.id = payment_id_value and row_value.request_hash = request_hash_value
    ) then return payment_id_value; end if;
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'supplier payment idempotency key is already used by another request';
  end if;

  insert into erp.supplier_payments (
    organization_id, branch_id, supplier_id, payable_id, payment_method_id,
    cash_session_id, currency_code, amount_currency, exchange_rate, amount_base,
    settlement_account_id, reference, idempotency_key, request_hash, reason, created_by
  ) values (
    org_id, payable.branch_id, payable.supplier_id, payable.id, method.id,
    target_cash_session_id, payable.currency_code, round(payment_amount, 4),
    exchange_rate_value, amount_base_value, settlement_account_id_value,
    nullif(btrim(payment_reference), ''), operation_key, request_hash_value,
    operation_reason, auth.uid()
  ) returning id into payment_id_value;

  insert into erp.supplier_account_entries (
    organization_id, branch_id, supplier_id, payable_id, supplier_payment_id,
    amount_base_delta, entry_kind, actor_id
  ) values (
    org_id, payable.branch_id, payable.supplier_id, payable.id, payment_id_value,
    -amount_base_value, 'payment', auth.uid()
  );

  journal_id_value := erp.post_internal_journal_entry(
    org_id, payable.branch_id, current_date, 'supplier_payment', payment_id_value,
    'primary', operation_key || ':journal', operation_reason,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', payable_account_id_value,
        'description', 'Pago a proveedor ' || payable.supplier_id::text,
        'debit', amount_base_value, 'credit', 0,
        'currency_code', payable.currency_code, 'exchange_rate', exchange_rate_value
      ),
      jsonb_build_object(
        'account_id', settlement_account_id_value,
        'description', 'Medio de pago a proveedor ' || payable.supplier_id::text,
        'debit', 0, 'credit', amount_base_value,
        'currency_code', payable.currency_code, 'exchange_rate', exchange_rate_value
      )
    )
  );
  perform set_config('erp.allow_supplier_journal_link', 'on', true);
  update erp.supplier_payments
  set journal_entry_id = journal_id_value
  where id = payment_id_value and organization_id = org_id;
  perform set_config('erp.allow_supplier_journal_link', 'off', true);

  if target_cash_session_id is not null then
    insert into erp.cash_movements (
      organization_id, branch_id, cash_session_id, kind, currency_code, amount,
      supplier_payment_id, idempotency_key, request_hash, reason, actor_id
    ) values (
      org_id, payable.branch_id, target_cash_session_id, 'withdrawal',
      payable.currency_code, -round(payment_amount, 4), payment_id_value,
      operation_key || ':cash', request_hash_value, operation_reason, auth.uid()
    );
  end if;
  return payment_id_value;
end;
$$;

create or replace function erp.reverse_supplier_payment(
  target_supplier_payment_id uuid,
  operation_key text,
  operation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_id uuid := erp.current_organization_id();
  original erp.supplier_payments%rowtype;
  reversal_id_value uuid;
  journal_id_value uuid;
  original_cash_movement erp.cash_movements%rowtype;
  request_hash_value text;
begin
  select payment.* into original
  from erp.supplier_payments payment
  where payment.id = target_supplier_payment_id
    and payment.organization_id = org_id
  for update;
  if original.id is null
     or not erp.has_permission('purchases.manage', original.branch_id)
     or not erp.has_permission('costs.manage', original.branch_id) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'purchases.manage and costs.manage permissions are required';
  end if;
  if original.journal_entry_id is null
     or nullif(btrim(operation_key), '') is null
     or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'a posted supplier payment, operation key and reason are required';
  end if;

  request_hash_value := md5(jsonb_build_object(
    'supplier_payment_id', original.id,
    'reason', operation_reason
  )::text);
  select reversal.id into reversal_id_value
  from erp.supplier_payment_reversals reversal
  where reversal.organization_id = org_id
    and reversal.branch_id = original.branch_id
    and reversal.idempotency_key = operation_key;
  if reversal_id_value is not null then
    if exists (
      select 1 from erp.supplier_payment_reversals reversal
      where reversal.id = reversal_id_value
        and reversal.supplier_payment_id = original.id
        and reversal.request_hash = request_hash_value
    ) then return reversal_id_value; end if;
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'supplier payment reversal key is already used by another request';
  end if;
  if exists (
    select 1 from erp.supplier_payment_reversals reversal
    where reversal.organization_id = org_id
      and reversal.supplier_payment_id = original.id
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'supplier payment is already reversed';
  end if;

  if original.cash_session_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      org_id::text || ':cash-session:' || original.cash_session_id::text, 0
    ));
    if exists (
      select 1 from erp.cash_closures closure
      where closure.organization_id = org_id
        and closure.cash_session_id = original.cash_session_id
    ) then
      raise exception using errcode = 'object_not_in_prerequisite_state',
        message = 'cash session is closed';
    end if;
    select movement.* into original_cash_movement
    from erp.cash_movements movement
    where movement.organization_id = org_id
      and movement.supplier_payment_id = original.id
    for update;
    if original_cash_movement.id is null
       or original_cash_movement.amount <> -original.amount_currency
       or exists (
         select 1 from erp.cash_movements reversal
         where reversal.organization_id = org_id
           and reversal.reversal_of_movement_id = original_cash_movement.id
       ) then
      raise exception using errcode = 'object_not_in_prerequisite_state',
        message = 'an unreversed matching supplier cash movement is required';
    end if;
  end if;

  insert into erp.supplier_payment_reversals (
    organization_id, branch_id, supplier_payment_id, idempotency_key,
    request_hash, reason, created_by
  ) values (
    org_id, original.branch_id, original.id, operation_key,
    request_hash_value, operation_reason, auth.uid()
  ) returning id into reversal_id_value;

  insert into erp.supplier_account_entries (
    organization_id, branch_id, supplier_id, payable_id, supplier_payment_id,
    supplier_payment_reversal_id, amount_base_delta, entry_kind, actor_id
  ) values (
    org_id, original.branch_id, original.supplier_id, original.payable_id,
    original.id, reversal_id_value, original.amount_base,
    'payment_reversal', auth.uid()
  );

  journal_id_value := erp.reverse_internal_journal_entry(
    org_id, original.journal_entry_id, 'supplier_payment_reversal',
    reversal_id_value, operation_key || ':journal', operation_reason
  );
  perform set_config('erp.allow_supplier_journal_link', 'on', true);
  update erp.supplier_payment_reversals
  set journal_entry_id = journal_id_value
  where id = reversal_id_value and organization_id = org_id;
  perform set_config('erp.allow_supplier_journal_link', 'off', true);

  if original_cash_movement.id is not null then
    insert into erp.cash_movements (
      organization_id, branch_id, cash_session_id, kind, currency_code, amount,
      reversal_of_movement_id, idempotency_key, request_hash, reason, actor_id
    ) values (
      org_id, original.branch_id, original.cash_session_id, 'contribution',
      original.currency_code, original.amount_currency, original_cash_movement.id,
      operation_key || ':cash', request_hash_value, operation_reason, auth.uid()
    );
  end if;
  return reversal_id_value;
end;
$$;

create or replace function erp.list_supplier_open_payables(target_supplier_id uuid)
returns table (
  id uuid, branch_id uuid, supplier_id uuid, currency_code text,
  due_at timestamptz, amount_currency numeric, outstanding_currency numeric,
  outstanding_base numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare org_id uuid := erp.current_organization_id();
begin
  return query
  select payable.id, payable.branch_id, payable.supplier_id, payable.currency_code,
         payable.due_at, payable.amount_currency,
         round(sum(entry.amount_base_delta) / nullif(payable.amount_base / nullif(payable.amount_currency, 0), 0), 4),
         sum(entry.amount_base_delta)
  from erp.supplier_payables payable
  join erp.supplier_account_entries entry
    on entry.payable_id = payable.id and entry.organization_id = payable.organization_id
  where payable.organization_id = org_id
    and payable.supplier_id = target_supplier_id
    and erp.has_permission('purchases.view', payable.branch_id)
    and erp.has_permission('costs.view', payable.branch_id)
  group by payable.id
  having sum(entry.amount_base_delta) > 0
  order by payable.due_at, payable.created_at;
end;
$$;

create or replace function erp.list_supplier_payment_methods(target_branch_id uuid)
returns table (id uuid, code text, name text, settlement_kind text, requires_cash_session boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare org_id uuid := erp.current_organization_id();
begin
  if org_id is null
     or not erp.has_permission('purchases.manage', target_branch_id)
     or not erp.has_permission('costs.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'purchases.manage and costs.manage permissions are required';
  end if;
  return query select method.id, method.code, method.name,
    method.settlement_kind, method.requires_cash_session
  from erp.payment_methods method
  where method.organization_id = org_id
    and method.is_active
    and method.settlement_kind <> 'credit'
  order by method.name;
end;
$$;

create or replace function erp.list_supplier_cash_sessions(target_branch_id uuid)
returns table (
  id uuid, branch_id uuid, cash_register_code text, cash_register_name text,
  opened_at timestamptz, currencies text[]
)
language plpgsql stable security definer set search_path = ''
as $$
declare org_id uuid := erp.current_organization_id();
begin
  if org_id is null
     or not erp.has_permission('purchases.manage', target_branch_id)
     or not erp.has_permission('costs.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'purchases.manage and costs.manage permissions are required';
  end if;
  return query
  select session.id, session.branch_id, register.code, register.name, session.opened_at,
         array_agg(opening.currency_code order by opening.currency_code)::text[]
  from erp.cash_sessions session
  join erp.cash_registers register
    on register.id = session.cash_register_id
   and register.organization_id = session.organization_id
   and register.branch_id = session.branch_id
  join erp.cash_session_opening_counts opening
    on opening.cash_session_id = session.id
   and opening.organization_id = session.organization_id
   and opening.branch_id = session.branch_id
  left join erp.cash_closures closure
    on closure.cash_session_id = session.id
   and closure.organization_id = session.organization_id
   and closure.branch_id = session.branch_id
  where session.organization_id = org_id
    and session.branch_id = target_branch_id
    and closure.id is null
  group by session.id, session.branch_id, register.code, register.name, session.opened_at
  order by session.opened_at desc;
end;
$$;

revoke all on erp.supplier_payments from public, anon, authenticated, service_role;
grant select on erp.supplier_payments to authenticated;
revoke all on erp.supplier_payment_reversals from public, anon, authenticated, service_role;
grant select on erp.supplier_payment_reversals to authenticated;
revoke all on function erp.protect_supplier_payment() from public, anon, authenticated, service_role;
revoke all on function erp.protect_supplier_payment_reversal()
from public, anon, authenticated, service_role;
revoke all on function erp.record_supplier_payment(uuid,uuid,uuid,numeric,text,text,text)
from public, anon, service_role;
grant execute on function erp.record_supplier_payment(uuid,uuid,uuid,numeric,text,text,text)
to authenticated;
revoke all on function erp.reverse_supplier_payment(uuid,text,text)
from public, anon, service_role;
grant execute on function erp.reverse_supplier_payment(uuid,text,text)
to authenticated;
revoke all on function erp.list_supplier_open_payables(uuid) from public, anon, service_role;
revoke all on function erp.list_supplier_payment_methods(uuid) from public, anon, service_role;
revoke all on function erp.list_supplier_cash_sessions(uuid) from public, anon, service_role;
grant execute on function erp.list_supplier_open_payables(uuid) to authenticated;
grant execute on function erp.list_supplier_payment_methods(uuid) to authenticated;
grant execute on function erp.list_supplier_cash_sessions(uuid) to authenticated;
