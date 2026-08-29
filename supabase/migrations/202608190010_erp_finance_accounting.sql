create type erp.accounting_period_status as enum ('open', 'closed');
create type erp.accounting_entry_status as enum ('draft', 'posted', 'reversed');
create type erp.financing_status as enum (
  'current', 'due', 'partially_paid', 'refinanced', 'cancelled', 'uncollectible', 'paid'
);
create type erp.financing_installment_status as enum ('upcoming', 'due', 'partially_paid', 'paid', 'cancelled');
create type erp.reconciliation_status as enum ('matched', 'unmatched');
create type erp.account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type erp.account_normal_balance as enum ('debit', 'credit');

create table erp.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  status erp.accounting_period_status not null default 'open',
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete restrict,
  close_reason text,
  created_at timestamptz not null default now(),
  constraint accounting_periods_range check (period_end >= period_start),
  constraint accounting_periods_closed_shape check (
    (status = 'open' and closed_at is null and closed_by is null)
    or (status = 'closed' and closed_at is not null and closed_by is not null)
  ),
  constraint accounting_periods_id_org_unique unique (id, organization_id),
  constraint accounting_periods_unique unique (organization_id, period_start, period_end)
);

create table erp.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  parent_account_id uuid,
  code text not null,
  name text not null,
  account_type erp.account_type not null,
  normal_balance erp.account_normal_balance not null,
  is_control boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint chart_of_accounts_parent_fk foreign key (parent_account_id, organization_id)
    references erp.chart_of_accounts(id, organization_id) on delete restrict,
  constraint chart_of_accounts_id_org_unique unique (id, organization_id),
  constraint chart_of_accounts_code_unique unique (organization_id, code),
  constraint chart_of_accounts_name_not_blank check (btrim(name) <> ''),
  constraint chart_of_accounts_code_not_blank check (btrim(code) <> '')
);

create table erp.accounting_account_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  role_code text not null,
  account_id uuid not null,
  created_at timestamptz not null default now(),
  constraint accounting_account_roles_account_fk foreign key (account_id, organization_id)
    references erp.chart_of_accounts(id, organization_id) on delete restrict,
  constraint accounting_account_roles_unique unique (organization_id, role_code)
);

create table erp.journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  period_id uuid not null,
  entry_date date not null,
  status erp.accounting_entry_status not null default 'draft',
  description text not null,
  source_type text,
  source_id uuid,
  idempotency_key text not null,
  total_debit numeric(18,2) not null default 0,
  total_credit numeric(18,2) not null default 0,
  reversal_of_entry_id uuid,
  posted_at timestamptz,
  posted_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint journal_entries_id_org_unique unique (id, organization_id),
  constraint journal_entries_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint journal_entries_period_fk foreign key (period_id, organization_id)
    references erp.accounting_periods(id, organization_id) on delete restrict,
  constraint journal_entries_reversal_fk foreign key (reversal_of_entry_id, organization_id)
    references erp.journal_entries(id, organization_id) on delete restrict,
  constraint journal_entries_operation_unique unique (organization_id, idempotency_key),
  constraint journal_entries_description_not_blank check (btrim(description) <> ''),
  constraint journal_entries_balance check (status = 'draft' or total_debit = total_credit),
  constraint journal_entries_posted_shape check (
    (status = 'draft' and posted_at is null and posted_by is null)
    or (status in ('posted', 'reversed') and posted_at is not null and posted_by is not null)
  )
);

create table erp.journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  journal_entry_id uuid not null,
  line_number integer not null,
  account_id uuid not null,
  description text not null,
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  currency_code text not null default 'ARS',
  exchange_rate numeric(18,6) not null default 1,
  created_at timestamptz not null default now(),
  constraint journal_entry_lines_id_org_unique unique (id, organization_id),
  constraint journal_entry_lines_entry_fk foreign key (journal_entry_id, organization_id)
    references erp.journal_entries(id, organization_id) on delete restrict,
  constraint journal_entry_lines_account_fk foreign key (account_id, organization_id)
    references erp.chart_of_accounts(id, organization_id) on delete restrict,
  constraint journal_entry_lines_number_unique unique (journal_entry_id, line_number),
  constraint journal_entry_lines_amounts check (
    debit >= 0 and credit >= 0 and (debit = 0 or credit = 0) and (debit > 0 or credit > 0)
  ),
  constraint journal_entry_lines_currency check (currency_code ~ '^[A-Z]{3}$' and exchange_rate > 0)
);

create table erp.accounting_source_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  source_type text not null,
  source_id uuid not null,
  posting_kind text not null,
  journal_entry_id uuid not null,
  created_at timestamptz not null default now(),
  constraint accounting_source_events_entry_fk foreign key (journal_entry_id, organization_id)
    references erp.journal_entries(id, organization_id) on delete restrict,
  constraint accounting_source_events_unique unique (organization_id, source_type, source_id, posting_kind)
);

create table erp.financing_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid not null,
  currency_code text not null default 'ARS',
  exchange_snapshot_id uuid,
  principal_amount numeric(18,2) not null,
  down_payment_amount numeric(18,2) not null default 0,
  financed_amount numeric(18,2) not null,
  monthly_interest_rate numeric(9,6) not null default 0,
  installment_count integer not null,
  first_due_date date not null,
  status erp.financing_status not null default 'current',
  contract_reference text,
  idempotency_key text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint financing_contracts_id_org_unique unique (id, organization_id),
  constraint financing_contracts_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint financing_contracts_customer_fk foreign key (customer_id, organization_id)
    references erp.customers(id, organization_id) on delete restrict,
  constraint financing_contracts_snapshot_fk foreign key (exchange_snapshot_id, organization_id)
    references erp.exchange_rate_snapshots(id, organization_id) on delete restrict,
  constraint financing_contracts_operation_unique unique (organization_id, branch_id, idempotency_key),
  constraint financing_contracts_amounts check (
    principal_amount > 0 and down_payment_amount >= 0 and down_payment_amount <= principal_amount
    and financed_amount = principal_amount - down_payment_amount
  ),
  constraint financing_contracts_terms check (
    monthly_interest_rate >= 0 and monthly_interest_rate <= 1 and installment_count between 1 and 120
  ),
  constraint financing_contracts_currency check (currency_code ~ '^[A-Z]{3}$')
);

create table erp.financing_installments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  contract_id uuid not null,
  installment_number integer not null,
  due_date date not null,
  principal_due numeric(18,2) not null,
  interest_due numeric(18,2) not null default 0,
  late_fee_due numeric(18,2) not null default 0,
  paid_principal numeric(18,2) not null default 0,
  paid_interest numeric(18,2) not null default 0,
  paid_late_fee numeric(18,2) not null default 0,
  status erp.financing_installment_status not null default 'upcoming',
  created_at timestamptz not null default now(),
  constraint financing_installments_id_org_unique unique (id, organization_id),
  constraint financing_installments_contract_fk foreign key (contract_id, organization_id)
    references erp.financing_contracts(id, organization_id) on delete restrict,
  constraint financing_installments_unique unique (contract_id, installment_number),
  constraint financing_installments_number check (installment_number > 0),
  constraint financing_installments_amounts check (
    principal_due >= 0 and interest_due >= 0 and late_fee_due >= 0
    and paid_principal >= 0 and paid_interest >= 0 and paid_late_fee >= 0
    and paid_principal <= principal_due and paid_interest <= interest_due and paid_late_fee <= late_fee_due
  )
);

create table erp.receivable_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  contract_id uuid not null,
  currency_code text not null,
  amount numeric(18,2) not null,
  paid_at timestamptz not null default now(),
  reference text,
  idempotency_key text not null,
  reason text not null,
  reversed_payment_id uuid,
  created_by uuid references auth.users(id) on delete restrict,
  constraint receivable_payments_id_org_unique unique (id, organization_id),
  constraint receivable_payments_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint receivable_payments_contract_fk foreign key (contract_id, organization_id)
    references erp.financing_contracts(id, organization_id) on delete restrict,
  constraint receivable_payments_reversal_fk foreign key (reversed_payment_id, organization_id)
    references erp.receivable_payments(id, organization_id) on delete restrict,
  constraint receivable_payments_unique unique (organization_id, branch_id, idempotency_key),
  constraint receivable_payments_amount check (amount > 0 and currency_code ~ '^[A-Z]{3}$')
);

create table erp.receivable_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  payment_id uuid not null,
  installment_id uuid not null,
  principal_amount numeric(18,2) not null default 0,
  interest_amount numeric(18,2) not null default 0,
  late_fee_amount numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  constraint receivable_payment_allocations_payment_fk foreign key (payment_id, organization_id)
    references erp.receivable_payments(id, organization_id) on delete restrict,
  constraint receivable_payment_allocations_installment_fk foreign key (installment_id, organization_id)
    references erp.financing_installments(id, organization_id) on delete restrict,
  constraint receivable_payment_allocations_unique unique (payment_id, installment_id),
  constraint receivable_payment_allocations_amounts check (
    principal_amount >= 0 and interest_amount >= 0 and late_fee_amount >= 0
    and principal_amount + interest_amount + late_fee_amount > 0
  )
);

create table erp.account_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  account_id uuid not null,
  as_of_date date not null,
  subledger_balance numeric(18,2) not null,
  general_ledger_balance numeric(18,2) not null,
  difference_amount numeric(18,2) not null,
  status erp.reconciliation_status not null,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint account_reconciliations_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint account_reconciliations_account_fk foreign key (account_id, organization_id)
    references erp.chart_of_accounts(id, organization_id) on delete restrict,
  constraint account_reconciliations_difference check (difference_amount = subledger_balance - general_ledger_balance),
  constraint account_reconciliations_status check (
    (difference_amount = 0 and status = 'matched') or (difference_amount <> 0 and status = 'unmatched')
  )
);

create index journal_entries_period_idx on erp.journal_entries (organization_id, period_id, entry_date);
create index financing_contracts_customer_idx on erp.financing_contracts (organization_id, customer_id, status);
create index financing_installments_due_idx on erp.financing_installments (organization_id, due_date, status);
create index journal_entry_lines_account_idx on erp.journal_entry_lines (organization_id, account_id);

create or replace function erp.finance_audit_insert()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
begin
  insert into erp.audit_events (
    organization_id, branch_id, actor_user_id, schema_name, table_name, record_id, action, reason, metadata
  ) values (
    new.organization_id,
    nullif(to_jsonb(new)->>'branch_id', '')::uuid,
    auth.uid(), 'erp', tg_table_name,
    coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'journal_entry_id'), 'insert',
    nullif(current_setting('erp.operation_reason', true), ''),
    jsonb_build_object('finance_fact', true, 'redacted', true)
  );
  return null;
end;
$$;

create or replace function erp.prevent_finance_delete()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
begin
  raise exception using errcode = 'integrity_constraint_violation',
    message = format('%I records are append-only; use a reversal', tg_table_name);
end;
$$;

create or replace function erp.prevent_posted_entry_mutation()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
begin
  if old.status = 'posted'
     and not (
       new.status = 'reversed'
       and old.reversal_of_entry_id is null
       and new.reversal_of_entry_id is not null
       and (to_jsonb(new) - 'status' - 'reversal_of_entry_id') = (to_jsonb(old) - 'status' - 'reversal_of_entry_id')
     )
     and to_jsonb(new) <> to_jsonb(old) then
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'posted journal entries are immutable; use a reversal';
  elsif old.status = 'reversed' and to_jsonb(new) <> to_jsonb(old) then
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'posted journal entries are immutable; use a reversal';
  end if;
  return new;
end;
$$;

create or replace function erp.bootstrap_chart_of_accounts()
returns void
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  role_row record;
  account_id uuid;
begin
  if org_id is null or not erp.has_permission('accounting.post') then
    raise exception using errcode = 'insufficient_privilege', message = 'accounting.post permission is required';
  end if;

  for role_row in
    select * from (values
      ('cash_ars', '1.1.01', 'Caja ARS', 'asset'::erp.account_type, 'debit'::erp.account_normal_balance),
      ('cash_usd', '1.1.02', 'Caja USD', 'asset'::erp.account_type, 'debit'::erp.account_normal_balance),
      ('receivable', '1.1.10', 'Cuentas por cobrar', 'asset'::erp.account_type, 'debit'::erp.account_normal_balance),
      ('inventory', '1.1.20', 'Inventario', 'asset'::erp.account_type, 'debit'::erp.account_normal_balance),
      ('suppliers', '2.1.10', 'Proveedores', 'liability'::erp.account_type, 'credit'::erp.account_normal_balance),
      ('sales_income', '4.1.01', 'Ventas', 'income'::erp.account_type, 'credit'::erp.account_normal_balance),
      ('financing_income', '4.1.02', 'Ingresos financieros', 'income'::erp.account_type, 'credit'::erp.account_normal_balance),
      ('cogs', '5.1.01', 'Costo de ventas', 'expense'::erp.account_type, 'debit'::erp.account_normal_balance),
      ('fx_result', '4.9.01', 'Diferencias de cambio', 'income'::erp.account_type, 'credit'::erp.account_normal_balance)
    ) as defaults(role_code, code, name, account_type, normal_balance)
  loop
    insert into erp.chart_of_accounts (
      organization_id, code, name, account_type, normal_balance, is_control
    ) values (
      org_id, role_row.code, role_row.name, role_row.account_type, role_row.normal_balance, true
    ) on conflict (organization_id, code) do update set is_active = true
    returning id into account_id;

    if account_id is null then
      select id into account_id from erp.chart_of_accounts
      where organization_id = org_id and code = role_row.code;
    end if;

    insert into erp.accounting_account_roles (organization_id, role_code, account_id)
    values (org_id, role_row.role_code, account_id)
    on conflict (organization_id, role_code) do update set account_id = excluded.account_id;
  end loop;
end;
$$;

create or replace function erp.get_current_erp_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
begin
  if auth.uid() is null or org_id is null then
    raise exception using errcode = 'insufficient_privilege', message = 'authenticated ERP context is required';
  end if;
  return jsonb_build_object('organization_id', org_id, 'user_id', auth.uid());
end;
$$;

create or replace function erp.ensure_open_period(target_date date, target_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  period_id uuid;
  period_status erp.accounting_period_status;
  month_start date := date_trunc('month', target_date)::date;
begin
  select id, status into period_id, period_status from erp.accounting_periods
  where organization_id = target_organization_id
    and target_date between period_start and period_end
  for update;
  if period_id is not null and period_status = 'closed' then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'accounting period is closed';
  end if;
  if period_id is null then
    insert into erp.accounting_periods (organization_id, period_start, period_end)
    values (target_organization_id, month_start, (month_start + interval '1 month - 1 day')::date)
    on conflict (organization_id, period_start, period_end) do update set status = excluded.status
    returning id into period_id;
  end if;
  return period_id;
end;
$$;

create or replace function erp.post_journal_entry(
  target_branch_id uuid,
  target_entry_date date,
  target_source_type text,
  target_source_id uuid,
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
  org_id uuid := erp.current_organization_id();
  period_id uuid;
  entry_id uuid;
  line jsonb;
  line_no integer := 0;
  debit_total numeric(18,2) := 0;
  credit_total numeric(18,2) := 0;
begin
  if org_id is null or not erp.has_permission('accounting.post', target_branch_id)
     or nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null
     or lines is null or jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) < 2 then
    raise exception using errcode = 'invalid_parameter_value', message = 'posting permission, reason, key and at least two lines are required';
  end if;
  if exists (select 1 from erp.journal_entries where organization_id = org_id and idempotency_key = operation_key) then
    select id into entry_id from erp.journal_entries where organization_id = org_id and idempotency_key = operation_key;
    return entry_id;
  end if;
  period_id := erp.ensure_open_period(target_entry_date, org_id);
  if period_id is null then raise exception using errcode = 'object_not_in_prerequisite_state', message = 'open period is required'; end if;

  insert into erp.journal_entries (
    organization_id, branch_id, period_id, entry_date, status, description,
    source_type, source_id, idempotency_key, created_by
  ) values (
    org_id, target_branch_id, period_id, target_entry_date, 'draft', operation_reason,
    nullif(btrim(target_source_type), ''), target_source_id, operation_key, auth.uid()
  ) returning id into entry_id;

  for line in select value from jsonb_array_elements(lines)
  loop
    line_no := line_no + 1;
    if not exists (select 1 from erp.chart_of_accounts where id = (line->>'account_id')::uuid and organization_id = org_id and is_active) then
      raise exception using errcode = 'foreign_key_violation', message = 'account is not active in the organization';
    end if;
    if coalesce((line->>'debit')::numeric, 0) < 0 or coalesce((line->>'credit')::numeric, 0) < 0
       or (coalesce((line->>'debit')::numeric, 0) = 0 and coalesce((line->>'credit')::numeric, 0) = 0)
       or ((line->>'debit')::numeric > 0 and (line->>'credit')::numeric > 0) then
      raise exception using errcode = 'invalid_parameter_value', message = 'each line must have one positive side';
    end if;
    insert into erp.journal_entry_lines (
      organization_id, journal_entry_id, line_number, account_id, description,
      debit, credit, currency_code, exchange_rate
    ) values (
      org_id, entry_id, line_no, (line->>'account_id')::uuid,
      coalesce(nullif(btrim(line->>'description'), ''), operation_reason),
      coalesce((line->>'debit')::numeric, 0), coalesce((line->>'credit')::numeric, 0),
      coalesce(line->>'currency_code', 'ARS'), coalesce((line->>'exchange_rate')::numeric, 1)
    );
    debit_total := debit_total + coalesce((line->>'debit')::numeric, 0);
    credit_total := credit_total + coalesce((line->>'credit')::numeric, 0);
  end loop;
  if debit_total <= 0 or debit_total <> credit_total then
    raise exception using errcode = 'check_violation', message = 'journal entry must balance Debe=Haber';
  end if;
  update erp.journal_entries
  set total_debit = debit_total, total_credit = credit_total, status = 'posted', posted_at = now(), posted_by = auth.uid()
  where id = entry_id;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.audit_events (organization_id, branch_id, actor_user_id, schema_name, table_name, record_id, action, reason, metadata)
  values (org_id, target_branch_id, auth.uid(), 'erp', 'journal_entries', entry_id::text, 'execute', operation_reason, jsonb_build_object('debit', debit_total, 'credit', credit_total));
  return entry_id;
end;
$$;

create or replace function erp.create_financing_contract(
  target_branch_id uuid,
  target_customer_id uuid,
  currency text,
  principal numeric,
  down_payment numeric,
  interest_rate numeric,
  installments_count integer,
  first_due date,
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
  contract_id uuid;
  financed numeric(18,2);
  base_installment numeric(18,2);
  current_due date;
  n integer;
begin
  if org_id is null or not erp.has_permission('accounts_receivable.manage', target_branch_id)
     or principal <= 0 or down_payment < 0 or down_payment > principal or interest_rate < 0
     or installments_count not between 1 and 120 or first_due is null
     or nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null
     or currency !~ '^[A-Z]{3}$'
     or not exists (select 1 from erp.customers where id = target_customer_id and organization_id = org_id)
  then
    raise exception using errcode = 'invalid_parameter_value', message = 'customer, terms, currency, permission and reason are required';
  end if;
  select id into contract_id from erp.financing_contracts where organization_id = org_id and branch_id = target_branch_id and idempotency_key = operation_key;
  if contract_id is not null then return contract_id; end if;
  financed := round(principal - down_payment, 2);
  base_installment := round(financed / installments_count, 2);
  insert into erp.financing_contracts (
    organization_id, branch_id, customer_id, currency_code, principal_amount, down_payment_amount,
    financed_amount, monthly_interest_rate, installment_count, first_due_date, idempotency_key, reason, created_by
  ) values (
    org_id, target_branch_id, target_customer_id, currency, round(principal,2), round(down_payment,2),
    financed, round(interest_rate,6), installments_count, first_due, operation_key, operation_reason, auth.uid()
  ) returning id into contract_id;
  for n in 1..installments_count loop
    current_due := (first_due + ((n - 1) || ' months')::interval)::date;
    insert into erp.financing_installments (
      organization_id, contract_id, installment_number, due_date, principal_due, interest_due
    ) values (
      org_id, contract_id, n, current_due,
      case when n = installments_count then financed - base_installment * (installments_count - 1) else base_installment end,
      round(financed * interest_rate, 2)
    );
  end loop;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.audit_events (organization_id, branch_id, actor_user_id, schema_name, table_name, record_id, action, reason, metadata)
  values (org_id, target_branch_id, auth.uid(), 'erp', 'financing_contracts', contract_id::text, 'execute', operation_reason, jsonb_build_object('installments', installments_count));
  return contract_id;
end;
$$;

create or replace function erp.calculate_financing_status(target_contract_id uuid)
returns erp.financing_status
language plpgsql
stable
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  contract_branch_id uuid;
  outstanding numeric;
  has_partial boolean;
  has_due boolean;
begin
  select branch_id into contract_branch_id
  from erp.financing_contracts
  where id = target_contract_id and organization_id = org_id;
  if contract_branch_id is null or not erp.has_permission('accounts_receivable.view', contract_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'accounts_receivable.view permission is required';
  end if;
  select
    coalesce(sum(principal_due + interest_due + late_fee_due - paid_principal - paid_interest - paid_late_fee), 0),
    bool_or(status = 'partially_paid'),
    bool_or(due_date < current_date and status <> 'paid')
  into outstanding, has_partial, has_due
  from erp.financing_installments
  where contract_id = target_contract_id and organization_id = org_id;
  if outstanding <= 0 then return 'paid'; end if;
  if has_partial then return 'partially_paid'; end if;
  if has_due then return 'due'; end if;
  return 'current';
end;
$$;

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
  payment_id uuid;
  remaining numeric(18,2) := round(payment_amount, 2);
  allocation numeric(18,2);
  installment record;
begin
  if org_id is null or not erp.has_permission('accounts_receivable.manage', target_branch_id)
     or payment_amount <= 0 or nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'payment, permission, key and reason are required';
  end if;
  select id into payment_id from erp.receivable_payments where organization_id = org_id and branch_id = target_branch_id and idempotency_key = operation_key;
  if payment_id is not null then return payment_id; end if;
  perform 1 from erp.financing_contracts where id = target_contract_id and organization_id = org_id and branch_id = target_branch_id for update;
  if not found then raise exception using errcode = 'no_data_found', message = 'financing contract not found'; end if;
  if remaining > (select coalesce(sum(principal_due + interest_due + late_fee_due - paid_principal - paid_interest - paid_late_fee),0) from erp.financing_installments where contract_id = target_contract_id) then
    raise exception using errcode = 'check_violation', message = 'payment exceeds the outstanding balance';
  end if;
  insert into erp.receivable_payments (organization_id, branch_id, contract_id, currency_code, amount, idempotency_key, reason, created_by)
  select org_id, target_branch_id, id, currency_code, payment_amount, operation_key, operation_reason, auth.uid()
  from erp.financing_contracts where id = target_contract_id
  returning id into payment_id;
  for installment in
    select * from erp.financing_installments
    where contract_id = target_contract_id and principal_due + interest_due + late_fee_due > paid_principal + paid_interest + paid_late_fee
    order by due_date, installment_number for update
  loop
    exit when remaining <= 0;
    allocation := least(remaining, installment.principal_due - installment.paid_principal);
    if allocation > 0 then
      update erp.financing_installments set paid_principal = paid_principal + allocation, status = case when paid_principal + allocation >= principal_due and paid_interest >= interest_due and paid_late_fee >= late_fee_due then 'paid' else 'partially_paid' end where id = installment.id;
      insert into erp.receivable_payment_allocations (organization_id, payment_id, installment_id, principal_amount)
      values (org_id, payment_id, installment.id, allocation);
      remaining := remaining - allocation;
    end if;
  end loop;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.audit_events (organization_id, branch_id, actor_user_id, schema_name, table_name, record_id, action, reason, metadata)
  values (org_id, target_branch_id, auth.uid(), 'erp', 'receivable_payments', payment_id::text, 'execute', operation_reason, jsonb_build_object('amount', payment_amount));
  return payment_id;
end;
$$;

create or replace function erp.reverse_journal_entry(target_entry_id uuid, operation_key text, operation_reason text)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  original erp.journal_entries%rowtype;
  reverse_id uuid;
  lines jsonb;
begin
  select id into reverse_id
  from erp.journal_entries
  where organization_id = org_id and idempotency_key = operation_key;
  if reverse_id is not null then return reverse_id; end if;
  select * into original from erp.journal_entries where id = target_entry_id and organization_id = org_id for update;
  if original.id is null or original.status <> 'posted' or not erp.has_permission('accounting.post', original.branch_id) or nullif(btrim(operation_reason),'') is null then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'posted entry, permission and reason are required';
  end if;
  select jsonb_agg(jsonb_build_object('account_id', account_id, 'description', description, 'debit', credit, 'credit', debit, 'currency_code', currency_code, 'exchange_rate', exchange_rate)) into lines
  from erp.journal_entry_lines where journal_entry_id = original.id and organization_id = org_id;
  reverse_id := erp.post_journal_entry(original.branch_id, original.entry_date, 'journal_reversal', original.id, operation_key, operation_reason, lines);
  update erp.journal_entries set status = 'reversed', reversal_of_entry_id = reverse_id where id = original.id;
  return reverse_id;
end;
$$;

create or replace function erp.close_accounting_period(target_period_id uuid, operation_reason text)
returns void
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
begin
  if org_id is null or not erp.has_permission('accounting.close_period') or nullif(btrim(operation_reason),'') is null then
    raise exception using errcode = 'insufficient_privilege', message = 'accounting.close_period permission and reason are required';
  end if;
  update erp.accounting_periods
  set status = 'closed', closed_at = now(), closed_by = auth.uid(), close_reason = operation_reason
  where id = target_period_id and organization_id = org_id and status = 'open';
  if not found then raise exception using errcode = 'object_not_in_prerequisite_state', message = 'open period not found'; end if;
end;
$$;

create or replace function erp.reconcile_account_balance(
  target_branch_id uuid, target_account_id uuid, target_as_of_date date,
  target_subledger_balance numeric, target_general_ledger_balance numeric, operation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  result_id uuid;
  difference numeric(18,2) := round(target_subledger_balance - target_general_ledger_balance, 2);
begin
  if org_id is null or not erp.has_permission('accounting.view', target_branch_id) or nullif(btrim(operation_reason),'') is null then
    raise exception using errcode = 'insufficient_privilege', message = 'accounting.view permission and reason are required';
  end if;
  insert into erp.account_reconciliations (
    organization_id, branch_id, account_id, as_of_date, subledger_balance,
    general_ledger_balance, difference_amount, status, reason, created_by
  ) values (
    org_id, target_branch_id, target_account_id, target_as_of_date, target_subledger_balance,
    target_general_ledger_balance, difference,
    case when difference = 0 then 'matched' else 'unmatched' end, operation_reason, auth.uid()
  ) returning id into result_id;
  return result_id;
end;
$$;

create trigger accounting_periods_no_delete before delete on erp.accounting_periods
for each row execute function erp.prevent_finance_delete();
create trigger chart_of_accounts_no_delete before delete on erp.chart_of_accounts
for each row execute function erp.prevent_finance_delete();
create trigger journal_entries_no_delete before delete on erp.journal_entries
for each row execute function erp.prevent_finance_delete();
create trigger journal_entry_lines_no_delete before delete on erp.journal_entry_lines
for each row execute function erp.prevent_finance_delete();
create trigger financing_contracts_no_delete before delete on erp.financing_contracts
for each row execute function erp.prevent_finance_delete();
create trigger financing_installments_no_delete before delete on erp.financing_installments
for each row execute function erp.prevent_finance_delete();
create trigger receivable_payments_no_delete before delete on erp.receivable_payments
for each row execute function erp.prevent_finance_delete();
create trigger journal_entries_immutable before update on erp.journal_entries
for each row execute function erp.prevent_posted_entry_mutation();

create trigger journal_entries_audit after insert on erp.journal_entries
for each row execute function erp.finance_audit_insert();
create trigger financing_contracts_audit after insert on erp.financing_contracts
for each row execute function erp.finance_audit_insert();
create trigger receivable_payments_audit after insert on erp.receivable_payments
for each row execute function erp.finance_audit_insert();
create trigger account_reconciliations_audit after insert on erp.account_reconciliations
for each row execute function erp.finance_audit_insert();

alter table erp.accounting_periods enable row level security;
alter table erp.chart_of_accounts enable row level security;
alter table erp.accounting_account_roles enable row level security;
alter table erp.journal_entries enable row level security;
alter table erp.journal_entry_lines enable row level security;
alter table erp.accounting_source_events enable row level security;
alter table erp.financing_contracts enable row level security;
alter table erp.financing_installments enable row level security;
alter table erp.receivable_payments enable row level security;
alter table erp.receivable_payment_allocations enable row level security;
alter table erp.account_reconciliations enable row level security;

create policy accounting_periods_select on erp.accounting_periods for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('accounting.view'));
create policy chart_of_accounts_select on erp.chart_of_accounts for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('accounting.view'));
create policy accounting_account_roles_select on erp.accounting_account_roles for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('accounting.view'));
create policy journal_entries_select on erp.journal_entries for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('accounting.view', branch_id));
create policy journal_entry_lines_select on erp.journal_entry_lines for select to authenticated
using (organization_id = erp.current_organization_id() and exists (
  select 1 from erp.journal_entries entry where entry.id = journal_entry_id
    and entry.organization_id = journal_entry_lines.organization_id
    and erp.has_permission('accounting.view', entry.branch_id)
));
create policy accounting_source_events_select on erp.accounting_source_events for select to authenticated
using (organization_id = erp.current_organization_id() and exists (
  select 1 from erp.journal_entries entry where entry.id = journal_entry_id
    and entry.organization_id = accounting_source_events.organization_id
    and erp.has_permission('accounting.view', entry.branch_id)
));
create policy financing_contracts_select on erp.financing_contracts for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('accounts_receivable.view', branch_id));
create policy financing_installments_select on erp.financing_installments for select to authenticated
using (organization_id = erp.current_organization_id() and exists (
  select 1 from erp.financing_contracts contract where contract.id = contract_id
    and contract.organization_id = financing_installments.organization_id
    and erp.has_permission('accounts_receivable.view', contract.branch_id)
));
create policy receivable_payments_select on erp.receivable_payments for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('accounts_receivable.view', branch_id));
create policy receivable_payment_allocations_select on erp.receivable_payment_allocations for select to authenticated
using (organization_id = erp.current_organization_id() and exists (
  select 1 from erp.receivable_payments payment where payment.id = payment_id
    and payment.organization_id = receivable_payment_allocations.organization_id
    and erp.has_permission('accounts_receivable.view', payment.branch_id)
));
create policy account_reconciliations_select on erp.account_reconciliations for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('accounting.view', branch_id));

grant select on
  erp.accounting_periods, erp.chart_of_accounts, erp.accounting_account_roles,
  erp.journal_entries, erp.journal_entry_lines, erp.accounting_source_events,
  erp.financing_contracts, erp.financing_installments, erp.receivable_payments,
  erp.receivable_payment_allocations, erp.account_reconciliations
to authenticated;
grant all on
  erp.accounting_periods, erp.chart_of_accounts, erp.accounting_account_roles,
  erp.journal_entries, erp.journal_entry_lines, erp.accounting_source_events,
  erp.financing_contracts, erp.financing_installments, erp.receivable_payments,
  erp.receivable_payment_allocations, erp.account_reconciliations
to service_role;

revoke all on function erp.bootstrap_chart_of_accounts() from public, anon;
revoke all on function erp.get_current_erp_context() from public, anon;
revoke all on function erp.create_financing_contract(uuid, uuid, text, numeric, numeric, numeric, integer, date, text, text) from public, anon;
revoke all on function erp.record_receivable_payment(uuid, uuid, numeric, text, text) from public, anon;
revoke all on function erp.post_journal_entry(uuid, date, text, uuid, text, text, jsonb) from public, anon;
revoke all on function erp.reverse_journal_entry(uuid, text, text) from public, anon;
revoke all on function erp.close_accounting_period(uuid, text) from public, anon;
revoke all on function erp.reconcile_account_balance(uuid, uuid, date, numeric, numeric, text) from public, anon;
grant execute on function erp.bootstrap_chart_of_accounts() to authenticated, service_role;
grant execute on function erp.get_current_erp_context() to authenticated, service_role;
grant execute on function erp.create_financing_contract(uuid, uuid, text, numeric, numeric, numeric, integer, date, text, text) to authenticated, service_role;
grant execute on function erp.record_receivable_payment(uuid, uuid, numeric, text, text) to authenticated, service_role;
grant execute on function erp.calculate_financing_status(uuid) to authenticated, service_role;
grant execute on function erp.post_journal_entry(uuid, date, text, uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function erp.reverse_journal_entry(uuid, text, text) to authenticated, service_role;
grant execute on function erp.close_accounting_period(uuid, text) to authenticated, service_role;
grant execute on function erp.reconcile_account_balance(uuid, uuid, date, numeric, numeric, text) to authenticated, service_role;
