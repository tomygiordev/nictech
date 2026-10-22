-- Migration: 20261021230000_erp_pos_v2_exact4_accounting_contract.sql
-- Description: POS v2 exact4 accounting contract, ledger widening to numeric(20,4),
-- immutable accounting_contract discriminator, private exact4 helper and zero-effect outcomes,
-- exact reversals, and trial balance conditional contribution.

begin;

set search_path = erp, pg_catalog;

-- ============================================================================
-- 1. Safely drop dependent view without CASCADE
-- ============================================================================
drop view if exists erp.v_trial_balance;

-- ============================================================================
-- 2. Ledger columns widening to numeric(20,4) & accounting_contract discriminator
-- ============================================================================
alter table erp.journal_entries
  alter column total_debit type numeric(20, 4),
  alter column total_credit type numeric(20, 4);

alter table erp.journal_entries
  add column if not exists accounting_contract text not null default 'legacy_v1';

alter table erp.journal_entries
  drop constraint if exists journal_entries_accounting_contract_check;

alter table erp.journal_entries
  add constraint journal_entries_accounting_contract_check
  check (accounting_contract in ('legacy_v1', 'pos_gross_v2_exact4'));

comment on column erp.journal_entries.accounting_contract is
  'Contract discriminator: legacy_v1 (2 decimals) or pos_gross_v2_exact4 (server-authoritative 4 decimals). Immutable.';

-- The historical reversal_of_entry_id is a forward pointer to the next entry.
alter table erp.journal_entries
  add column v2_original_entry_id uuid,
  add constraint journal_entries_v2_original_fk
    foreign key (v2_original_entry_id, organization_id)
    references erp.journal_entries (id, organization_id) on delete restrict,
  add constraint journal_entries_v2_original_not_self
    check (v2_original_entry_id is null or v2_original_entry_id <> id),
  add constraint journal_entries_v2_original_contract
    check (v2_original_entry_id is null or accounting_contract = 'pos_gross_v2_exact4'),
  add constraint journal_entries_v2_original_unique
    unique (organization_id, v2_original_entry_id);

comment on column erp.journal_entries.v2_original_entry_id is
  'Immutable backward provenance for exact4 reversals; reversal_of_entry_id remains the historical forward pointer.';

alter table erp.journal_entry_lines
  alter column debit type numeric(20, 4),
  alter column credit type numeric(20, 4);

alter table erp.journal_entry_lines
  drop constraint if exists journal_entry_lines_amounts;

alter table erp.journal_entry_lines
  add constraint journal_entry_lines_amounts
  check (
    debit >= 0
    and credit >= 0
    and (debit = 0 or credit = 0)
    and (debit > 0 or credit > 0)
    and debit <> 'NaN'::numeric
    and credit <> 'NaN'::numeric
  );

-- Revoke direct DML on ledger and accounting source event tables from public, anon, authenticated, and service_role.
-- Ledger mutations are strictly performed through security definer RPCs running as postgres.
revoke insert, update, delete, truncate on erp.journal_entries from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate on erp.journal_entry_lines from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate on erp.accounting_source_events from public, anon, authenticated, service_role;

grant select on erp.journal_entries to authenticated, service_role;
grant select on erp.journal_entry_lines to authenticated, service_role;
grant select on erp.accounting_source_events to authenticated, service_role;

-- ============================================================================
-- 3. Private table for POS v2 zero economic effect outcomes
-- ============================================================================
create table if not exists erp.pos_v2_zero_accounting_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  sale_id uuid not null,
  posting_kind text not null default 'primary',
  accounting_contract text not null default 'pos_gross_v2_exact4',
  reason text not null default 'zero_economic_effect',
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint pos_v2_zero_accounting_outcomes_sale_fk
    foreign key (sale_id, organization_id)
    references erp.sales(id, organization_id) on delete restrict,
  constraint pos_v2_zero_accounting_outcomes_unique
    unique (organization_id, sale_id, posting_kind),
  constraint pos_v2_zero_accounting_outcomes_contract_check
    check (accounting_contract = 'pos_gross_v2_exact4'),
  constraint pos_v2_zero_accounting_outcomes_reason_check
    check (reason = 'zero_economic_effect')
);

comment on table erp.pos_v2_zero_accounting_outcomes is
  'Audit record of POS v2 sales with zero economic effect (0 revenue and 0 COGS) where no ledger entry is posted.';

alter table erp.pos_v2_zero_accounting_outcomes enable row level security;
revoke all on erp.pos_v2_zero_accounting_outcomes from public, anon, authenticated, service_role;

-- Append-only protection for pos_v2_zero_accounting_outcomes
create or replace function erp.protect_pos_v2_zero_outcomes_append_only()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
begin
  raise exception using
    errcode = 'integrity_constraint_violation',
    message = 'pos_v2_zero_accounting_outcomes is append-only: updates, deletes, and truncates are prohibited';
end;
$$;

revoke all on function erp.protect_pos_v2_zero_outcomes_append_only()
  from public, anon, authenticated, service_role;

drop trigger if exists pos_v2_zero_accounting_outcomes_protect_append_only
  on erp.pos_v2_zero_accounting_outcomes;
create trigger pos_v2_zero_accounting_outcomes_protect_append_only
before update or delete on erp.pos_v2_zero_accounting_outcomes
for each row execute function erp.protect_pos_v2_zero_outcomes_append_only();

drop trigger if exists pos_v2_zero_accounting_outcomes_protect_truncate
  on erp.pos_v2_zero_accounting_outcomes;
create trigger pos_v2_zero_accounting_outcomes_protect_truncate
before truncate on erp.pos_v2_zero_accounting_outcomes
for each statement execute function erp.protect_pos_v2_zero_outcomes_append_only();

-- Mutual non-coexistence triggers between source events and zero outcomes
create or replace function erp.check_accounting_outcome_non_coexistence()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
begin
  if exists (
    select 1
    from erp.accounting_source_events se
    where se.organization_id = new.organization_id
      and se.source_type = 'sale'
      and se.source_id = new.sale_id
      and se.posting_kind = new.posting_kind
  ) then
    raise exception using
      errcode = 'integrity_constraint_violation',
      message = 'cannot record zero outcome: sale already has an accounting source event';
  end if;
  return new;
end;
$$;

revoke all on function erp.check_accounting_outcome_non_coexistence()
  from public, anon, authenticated, service_role;

drop trigger if exists pos_v2_zero_accounting_outcomes_no_coexist
  on erp.pos_v2_zero_accounting_outcomes;
create trigger pos_v2_zero_accounting_outcomes_no_coexist
before insert on erp.pos_v2_zero_accounting_outcomes
for each row execute function erp.check_accounting_outcome_non_coexistence();

create or replace function erp.check_accounting_source_event_non_coexistence()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
begin
  if new.source_type = 'sale' and exists (
    select 1
    from erp.pos_v2_zero_accounting_outcomes zo
    where zo.organization_id = new.organization_id
      and zo.sale_id = new.source_id
      and zo.posting_kind = new.posting_kind
  ) then
    raise exception using
      errcode = 'integrity_constraint_violation',
      message = 'cannot post accounting event: sale already has a zero accounting outcome recorded';
  end if;
  return new;
end;
$$;

revoke all on function erp.check_accounting_source_event_non_coexistence()
  from public, anon, authenticated, service_role;

drop trigger if exists accounting_source_events_no_coexist
  on erp.accounting_source_events;
create trigger accounting_source_events_no_coexist
before insert on erp.accounting_source_events
for each row execute function erp.check_accounting_source_event_non_coexistence();

-- ============================================================================
-- 4. Anti-forgery & immutability guards for journal entries and lines
-- ============================================================================
create or replace function erp.guard_journal_entry_contract_integrity()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  v_sale_row erp.sales%rowtype;
  v_orig_entry erp.journal_entries%rowtype;
begin
  -- Immutability on UPDATE
  if tg_op = 'UPDATE' then
    if new.v2_original_entry_id is distinct from old.v2_original_entry_id then
      raise exception using
        errcode = 'integrity_constraint_violation',
        message = 'journal entry v2_original_entry_id is immutable';
    end if;
    if new.accounting_contract is distinct from old.accounting_contract then
      raise exception using
        errcode = 'integrity_constraint_violation',
        message = 'journal entry accounting_contract is immutable';
    end if;
  end if;

  -- Validate contract authenticity and amounts (validates both INSERT and UPDATE)
  if new.accounting_contract = 'pos_gross_v2_exact4' then
    if new.v2_original_entry_id is not null then
      select * into v_orig_entry
      from erp.journal_entries
      where id = new.v2_original_entry_id
        and organization_id = new.organization_id;

      if v_orig_entry.id is null
         or v_orig_entry.accounting_contract <> 'pos_gross_v2_exact4'
         or v_orig_entry.branch_id is distinct from new.branch_id then
        raise exception using
          errcode = 'integrity_constraint_violation',
          message = 'pos_gross_v2_exact4 reversal requires an authoritative same-tenant original entry';
      end if;
    elsif new.source_type = 'sale' and new.source_id is not null then
      if new.idempotency_key is distinct from ('sale:' || new.source_id::text || ':primary') then
        raise exception using
          errcode = 'integrity_constraint_violation',
          message = 'pos_gross_v2_exact4 sale entry must use authoritative idempotency key';
      end if;

      select * into v_sale_row
      from erp.sales
      where id = new.source_id
        and organization_id = new.organization_id;

      if v_sale_row.id is null
         or v_sale_row.pricing_version <> 'v2'
         or v_sale_row.currency_code <> 'ARS'
         or v_sale_row.exchange_rate <> 1 then
        raise exception using
          errcode = 'integrity_constraint_violation',
          message = 'pos_gross_v2_exact4 contract requires an authoritative v2 ARS sale fact';
      end if;

      if tg_op = 'INSERT' then
        if exists (
          select 1 from erp.accounting_source_events
          where organization_id = new.organization_id
            and source_type = 'sale'
            and source_id = new.source_id
            and posting_kind = 'primary'
        ) then
          raise exception using
            errcode = 'integrity_constraint_violation',
            message = 'pos_gross_v2_exact4 entry already exists for this sale';
        end if;

        if exists (
          select 1 from erp.pos_v2_zero_accounting_outcomes
          where organization_id = new.organization_id
            and sale_id = new.source_id
            and posting_kind = 'primary'
        ) then
          raise exception using
            errcode = 'integrity_constraint_violation',
            message = 'cannot post journal entry for sale with zero economic outcome';
        end if;
      end if;
    else
      raise exception using
        errcode = 'integrity_constraint_violation',
        message = 'pos_gross_v2_exact4 contract is not permitted for source type ' || coalesce(new.source_type, 'null');
    end if;

    -- Scale check without false positives from stored scale
    if new.total_debit <> round(new.total_debit, 4) or new.total_credit <> round(new.total_credit, 4) then
      raise exception using
        errcode = 'check_violation',
        message = 'pos_gross_v2_exact4 total amounts cannot exceed 4 decimal places';
    end if;

    if new.total_debit >= 10000000000000000::numeric or new.total_credit >= 10000000000000000::numeric then
      raise exception using
        errcode = 'check_violation',
        message = 'pos_gross_v2_exact4 total amounts cannot exceed 16 integer digits';
    end if;
  elsif new.accounting_contract = 'legacy_v1' then
    if new.total_debit <> round(new.total_debit, 2) or new.total_credit <> round(new.total_credit, 2) then
      raise exception using
        errcode = 'check_violation',
        message = 'legacy_v1 total amounts cannot exceed 2 decimal places';
    end if;

    if new.total_debit >= 10000000000000000::numeric or new.total_credit >= 10000000000000000::numeric then
      raise exception using
        errcode = 'check_violation',
        message = 'legacy_v1 total amounts cannot exceed 16 integer digits';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function erp.guard_journal_entry_contract_integrity()
  from public, anon, authenticated, service_role;

drop trigger if exists journal_entries_guard_contract on erp.journal_entries;
create trigger journal_entries_guard_contract
before insert or update on erp.journal_entries
for each row execute function erp.guard_journal_entry_contract_integrity();

create or replace function erp.guard_journal_line_integrity()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  v_parent_contract text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception using
      errcode = 'integrity_constraint_violation',
      message = 'journal entry lines are immutable and cannot be updated';
  end if;

  select entry.accounting_contract into v_parent_contract
  from erp.journal_entries entry
  where entry.id = new.journal_entry_id
    and entry.organization_id = new.organization_id;

  if v_parent_contract is null then
    raise exception using
      errcode = 'foreign_key_violation',
      message = 'parent journal entry not found for journal line';
  end if;

  if v_parent_contract = 'legacy_v1' then
    if new.debit <> round(new.debit, 2) or new.credit <> round(new.credit, 2) then
      raise exception using
        errcode = 'check_violation',
        message = 'legacy_v1 journal lines cannot exceed 2 decimal places';
    end if;

    if new.debit >= 10000000000000000::numeric or new.credit >= 10000000000000000::numeric then
      raise exception using
        errcode = 'check_violation',
        message = 'legacy_v1 journal lines cannot exceed 16 integer digits';
    end if;
  elsif v_parent_contract = 'pos_gross_v2_exact4' then
    if new.debit <> round(new.debit, 4) or new.credit <> round(new.credit, 4) then
      raise exception using
        errcode = 'check_violation',
        message = 'pos_gross_v2_exact4 journal lines cannot exceed 4 decimal places';
    end if;

    if new.debit >= 10000000000000000::numeric or new.credit >= 10000000000000000::numeric then
      raise exception using
        errcode = 'check_violation',
        message = 'pos_gross_v2_exact4 journal lines cannot exceed 16 integer digits';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function erp.guard_journal_line_integrity()
  from public, anon, authenticated, service_role;

drop trigger if exists journal_entry_lines_guard_contract on erp.journal_entry_lines;
create trigger journal_entry_lines_guard_contract
before insert or update or delete on erp.journal_entry_lines
for each row execute function erp.guard_journal_line_integrity();

-- Authoritative latest guards definitions from DEV
CREATE OR REPLACE FUNCTION erp.ensure_open_period_internal(target_date date, target_organization_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

revoke all on function erp.ensure_open_period_internal(date, uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION erp.prevent_posted_entry_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'erp', 'pg_catalog'
AS $function$
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
$function$;

revoke all on function erp.prevent_posted_entry_mutation() from public, anon, authenticated, service_role;

-- ============================================================================
-- 5. Restore erp.post_journal_entry & erp.post_internal_journal_entry
-- ============================================================================
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

  select id into entry_id
  from erp.journal_entries
  where organization_id = org_id and idempotency_key = operation_key;
  if entry_id is not null then
    return entry_id;
  end if;

  if target_source_type is not null and target_source_id is not null then
    -- Public legacy wrapper cannot post v2 sales (checked BEFORE source-event replay)
    if btrim(target_source_type) = 'sale' and exists (
      select 1 from erp.sales
      where id = target_source_id and organization_id = org_id and pricing_version = 'v2'
    ) then
      raise exception using errcode = 'check_violation',
        message = 'pos v2 sales cannot be posted via legacy journal entry';
    end if;

    select journal_entry_id into entry_id
    from erp.accounting_source_events
    where organization_id = org_id
      and source_type = btrim(target_source_type)
      and source_id = target_source_id
      and posting_kind = 'primary';
    if entry_id is not null then
      return entry_id;
    end if;
  end if;

  period_id := erp.ensure_open_period(target_entry_date, org_id);
  if period_id is null then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'open period is required';
  end if;

  insert into erp.journal_entries (
    organization_id, branch_id, period_id, entry_date, status, description,
    source_type, source_id, idempotency_key, created_by, accounting_contract
  ) values (
    org_id, target_branch_id, period_id, target_entry_date, 'draft', operation_reason,
    nullif(btrim(target_source_type), ''), target_source_id, operation_key, auth.uid(),
    'legacy_v1'
  ) returning id into entry_id;

  for line in select value from jsonb_array_elements(lines)
  loop
    line_no := line_no + 1;
    if not exists (
      select 1 from erp.chart_of_accounts
      where id = (line->>'account_id')::uuid and organization_id = org_id and is_active
    ) then
      raise exception using errcode = 'foreign_key_violation', message = 'account is not active in the organization';
    end if;
    if coalesce((line->>'debit')::numeric, 0) < 0
       or coalesce((line->>'credit')::numeric, 0) < 0
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
      coalesce((line->>'debit')::numeric, 0)::numeric(18, 2),
      coalesce((line->>'credit')::numeric, 0)::numeric(18, 2),
      coalesce(line->>'currency_code', 'ARS'), coalesce((line->>'exchange_rate')::numeric, 1)
    );
    debit_total := debit_total + coalesce((line->>'debit')::numeric, 0)::numeric(18, 2);
    credit_total := credit_total + coalesce((line->>'credit')::numeric, 0)::numeric(18, 2);
  end loop;

  if debit_total <= 0 or debit_total <> credit_total then
    raise exception using errcode = 'check_violation', message = 'journal entry must balance Debe=Haber';
  end if;

  update erp.journal_entries
  set total_debit = debit_total,
      total_credit = credit_total,
      status = 'posted',
      posted_at = now(),
      posted_by = auth.uid()
  where id = entry_id;

  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.audit_events (
    organization_id, branch_id, actor_user_id, schema_name, table_name,
    record_id, action, reason, metadata
  ) values (
    org_id, target_branch_id, auth.uid(), 'erp', 'journal_entries', entry_id::text,
    'execute', operation_reason,
    jsonb_build_object('debit', debit_total, 'credit', credit_total)
  );

  if target_source_type is not null and target_source_id is not null then
    insert into erp.accounting_source_events (
      organization_id, source_type, source_id, posting_kind, journal_entry_id
    ) values (
      org_id, btrim(target_source_type), target_source_id, 'primary', entry_id
    ) on conflict (organization_id, source_type, source_id, posting_kind) do nothing;
  end if;

  return entry_id;
end;
$$;

revoke all on function erp.post_journal_entry(uuid, date, text, uuid, text, text, jsonb) from public, anon;
grant execute on function erp.post_journal_entry(uuid, date, text, uuid, text, text, jsonb) to authenticated, service_role;
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

  -- Rejection of v2 sale in legacy internal helper (checked BEFORE source-event replay)
  if target_source_type = 'sale' and exists (
    select 1 from erp.sales
    where id = target_source_id and organization_id = target_organization_id and pricing_version = 'v2'
  ) then
    raise exception using errcode = 'check_violation',
      message = 'pos v2 sales cannot be posted via legacy journal entry';
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

  period_id_value := erp.ensure_open_period_internal(target_entry_date, target_organization_id);
  insert into erp.journal_entries (
    organization_id, branch_id, period_id, entry_date, status, description,
    source_type, source_id, idempotency_key, created_by, accounting_contract
  ) values (
    target_organization_id, target_branch_id, period_id_value, target_entry_date,
    'draft', operation_reason, target_source_type, target_source_id,
    operation_key, auth.uid(), 'legacy_v1'
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
      coalesce((line_value->>'debit')::numeric, 0)::numeric(18, 2),
      coalesce((line_value->>'credit')::numeric, 0)::numeric(18, 2),
      upper(coalesce(nullif(btrim(line_value->>'currency_code'), ''), 'ARS')),
      coalesce((line_value->>'exchange_rate')::numeric, 1)
    );
    debit_total_value := debit_total_value + coalesce((line_value->>'debit')::numeric, 0)::numeric(18, 2);
    credit_total_value := credit_total_value + coalesce((line_value->>'credit')::numeric, 0)::numeric(18, 2);
  end loop;

  if debit_total_value <= 0 or round(debit_total_value, 2) <> round(credit_total_value, 2) then
    raise exception using errcode = 'check_violation',
      message = 'journal entry must balance Debe=Haber';
  end if;

  update erp.journal_entries
  set total_debit = round(debit_total_value, 2),
      total_credit = round(credit_total_value, 2),
      status = 'posted',
      posted_at = now(),
      posted_by = auth.uid()
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

revoke all on function erp.post_internal_journal_entry(uuid, uuid, date, text, uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
-- ============================================================================
-- 6. Private exact4 accounting helper for POS v2
-- ============================================================================
create or replace function erp.post_confirmed_sale_accounting_v2_exact4(
  target_sale_id uuid,
  target_org_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  sale_row erp.sales%rowtype;
  period_id_value uuid;
  journal_entry_id_value uuid;
  receivable_account_id uuid;
  income_account_id uuid;
  inventory_account_id uuid;
  cogs_account_id uuid;
  revenue_base numeric;
  cogs_base numeric;
  debit_total_value numeric;
  base_currency_value text;
begin
  if target_org_id is null or target_org_id is distinct from erp.current_organization_id() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'cross-tenant execution is not permitted';
  end if;

  if auth.uid() is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'an authenticated actor is required for automatic sale accounting';
  end if;

  select sale.*
    into sale_row
  from erp.sales sale
  where sale.id = target_sale_id
    and sale.organization_id = target_org_id
  for update;

  if sale_row.id is null then
    raise exception using errcode = 'no_data_found',
      message = 'sale not found for exact4 accounting helper';
  end if;

  if sale_row.pricing_version <> 'v2' then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'pos_gross_v2_exact4 helper requires pricing_version v2';
  end if;

  if sale_row.currency_code <> 'ARS' or sale_row.exchange_rate <> 1 then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'pos_gross_v2_exact4 helper requires currency ARS and exchange_rate 1';
  end if;

  select currency.currency_code into base_currency_value
  from erp.organization_currencies currency
  where currency.organization_id = sale_row.organization_id
    and currency.is_base and currency.is_active;

  if base_currency_value is distinct from 'ARS' then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'active base currency ARS is required';
  end if;

  -- Replay guard under lock
  if exists (
    select 1
    from erp.accounting_source_events se
    where se.organization_id = sale_row.organization_id
      and se.source_type = 'sale'
      and se.source_id = sale_row.id
      and se.posting_kind = 'primary'
  ) then
    select se.journal_entry_id into journal_entry_id_value
    from erp.accounting_source_events se
    where se.organization_id = sale_row.organization_id
      and se.source_type = 'sale'
      and se.source_id = sale_row.id
      and se.posting_kind = 'primary';
    return journal_entry_id_value;
  end if;

  if exists (
    select 1
    from erp.pos_v2_zero_accounting_outcomes zo
    where zo.organization_id = sale_row.organization_id
      and zo.sale_id = sale_row.id
      and zo.posting_kind = 'primary'
  ) then
    return null;
  end if;

  -- Accounting period validation via authoritative helper (required even for zero economic effect)
  period_id_value := erp.ensure_open_period_internal(sale_row.confirmed_at::date, sale_row.organization_id);

  -- Derive amounts from authoritative persisted facts without round2
  revenue_base := sale_row.total_amount;

  select coalesce(sum(-movement.value_delta_base), 0)
    into cogs_base
  from erp.stock_cost_movements movement
  where movement.organization_id = sale_row.organization_id
    and movement.document_id = sale_row.stock_document_id
    and movement.quantity_delta < 0;

  -- Validations: finitude, non-negative, exact4 comparison, capacity < 1e16
  if revenue_base < 0 or revenue_base = 'NaN'::numeric or revenue_base <> round(revenue_base, 4) or revenue_base >= 10000000000000000::numeric then
    raise exception using errcode = 'check_violation', message = 'invalid revenue_base amount for exact4 accounting';
  end if;

  if cogs_base < 0 or cogs_base = 'NaN'::numeric or cogs_base <> round(cogs_base, 4) or cogs_base >= 10000000000000000::numeric then
    raise exception using errcode = 'check_violation', message = 'invalid cogs_base amount for exact4 accounting';
  end if;

  select
    (max(role.account_id::text) filter (where role.role_code = 'receivable'))::uuid,
    (max(role.account_id::text) filter (where role.role_code = 'sales_income'))::uuid,
    (max(role.account_id::text) filter (where role.role_code = 'inventory'))::uuid,
    (max(role.account_id::text) filter (where role.role_code = 'cogs'))::uuid
  into
    receivable_account_id,
    income_account_id,
    inventory_account_id,
    cogs_account_id
  from erp.accounting_account_roles role
  where role.organization_id = sale_row.organization_id;

  if (revenue_base > 0 and (receivable_account_id is null or income_account_id is null)) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'receivable and sales income account roles are required';
  end if;

  if cogs_base > 0 and (inventory_account_id is null or cogs_account_id is null) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'inventory and COGS account roles are required';
  end if;

  -- Case 1: Both zero -> record private zero outcome without ledger entry
  if revenue_base = 0 and cogs_base = 0 then
    insert into erp.pos_v2_zero_accounting_outcomes (
      organization_id, sale_id, posting_kind, accounting_contract, reason, created_by, created_at
    ) values (
      sale_row.organization_id, sale_row.id, 'primary', 'pos_gross_v2_exact4', 'zero_economic_effect', auth.uid(), now()
    );
    return null;
  end if;

  -- Case 2: Both positive -> generate both revenue and COGS pairs
  if revenue_base > 0 and cogs_base > 0 then
    debit_total_value := revenue_base + cogs_base;

    insert into erp.journal_entries (
      organization_id, branch_id, period_id, entry_date, status, description,
      source_type, source_id, idempotency_key, total_debit, total_credit,
      posted_at, posted_by, created_by, accounting_contract
    ) values (
      sale_row.organization_id, sale_row.branch_id, period_id_value,
      sale_row.confirmed_at::date, 'posted', 'Venta ' || sale_row.id::text,
      'sale', sale_row.id, 'sale:' || sale_row.id::text || ':primary',
      debit_total_value, debit_total_value, now(), auth.uid(), auth.uid(),
      'pos_gross_v2_exact4'
    ) returning id into journal_entry_id_value;

    insert into erp.journal_entry_lines (
      organization_id, journal_entry_id, line_number, account_id, description,
      debit, credit, currency_code, exchange_rate
    ) values
      (
        sale_row.organization_id, journal_entry_id_value, 1,
        receivable_account_id, 'Venta ' || sale_row.id::text,
        revenue_base, 0, 'ARS', 1
      ),
      (
        sale_row.organization_id, journal_entry_id_value, 2,
        income_account_id, 'Ingreso por venta ' || sale_row.id::text,
        0, revenue_base, 'ARS', 1
      ),
      (
        sale_row.organization_id, journal_entry_id_value, 3,
        cogs_account_id, 'Costo de venta ' || sale_row.id::text,
        cogs_base, 0, 'ARS', 1
      ),
      (
        sale_row.organization_id, journal_entry_id_value, 4,
        inventory_account_id, 'Salida de inventario ' || sale_row.id::text,
        0, cogs_base, 'ARS', 1
      );

    insert into erp.accounting_source_events (
      organization_id, source_type, source_id, posting_kind, journal_entry_id
    ) values (
      sale_row.organization_id, 'sale', sale_row.id, 'primary', journal_entry_id_value
    );

    return journal_entry_id_value;
  end if;

  -- Case 3: Zero revenue, positive COGS -> generate only COGS pair
  if revenue_base = 0 and cogs_base > 0 then
    debit_total_value := cogs_base;

    insert into erp.journal_entries (
      organization_id, branch_id, period_id, entry_date, status, description,
      source_type, source_id, idempotency_key, total_debit, total_credit,
      posted_at, posted_by, created_by, accounting_contract
    ) values (
      sale_row.organization_id, sale_row.branch_id, period_id_value,
      sale_row.confirmed_at::date, 'posted', 'Venta ' || sale_row.id::text,
      'sale', sale_row.id, 'sale:' || sale_row.id::text || ':primary',
      debit_total_value, debit_total_value, now(), auth.uid(), auth.uid(),
      'pos_gross_v2_exact4'
    ) returning id into journal_entry_id_value;

    insert into erp.journal_entry_lines (
      organization_id, journal_entry_id, line_number, account_id, description,
      debit, credit, currency_code, exchange_rate
    ) values
      (
        sale_row.organization_id, journal_entry_id_value, 1,
        cogs_account_id, 'Costo de venta ' || sale_row.id::text,
        cogs_base, 0, 'ARS', 1
      ),
      (
        sale_row.organization_id, journal_entry_id_value, 2,
        inventory_account_id, 'Salida de inventario ' || sale_row.id::text,
        0, cogs_base, 'ARS', 1
      );

    insert into erp.accounting_source_events (
      organization_id, source_type, source_id, posting_kind, journal_entry_id
    ) values (
      sale_row.organization_id, 'sale', sale_row.id, 'primary', journal_entry_id_value
    );

    return journal_entry_id_value;
  end if;

  -- Case 4: Positive revenue, zero COGS -> generate only revenue pair
  if revenue_base > 0 and cogs_base = 0 then
    debit_total_value := revenue_base;

    insert into erp.journal_entries (
      organization_id, branch_id, period_id, entry_date, status, description,
      source_type, source_id, idempotency_key, total_debit, total_credit,
      posted_at, posted_by, created_by, accounting_contract
    ) values (
      sale_row.organization_id, sale_row.branch_id, period_id_value,
      sale_row.confirmed_at::date, 'posted', 'Venta ' || sale_row.id::text,
      'sale', sale_row.id, 'sale:' || sale_row.id::text || ':primary',
      debit_total_value, debit_total_value, now(), auth.uid(), auth.uid(),
      'pos_gross_v2_exact4'
    ) returning id into journal_entry_id_value;

    insert into erp.journal_entry_lines (
      organization_id, journal_entry_id, line_number, account_id, description,
      debit, credit, currency_code, exchange_rate
    ) values
      (
        sale_row.organization_id, journal_entry_id_value, 1,
        receivable_account_id, 'Venta ' || sale_row.id::text,
        revenue_base, 0, 'ARS', 1
      ),
      (
        sale_row.organization_id, journal_entry_id_value, 2,
        income_account_id, 'Ingreso por venta ' || sale_row.id::text,
        0, revenue_base, 'ARS', 1
      );

    insert into erp.accounting_source_events (
      organization_id, source_type, source_id, posting_kind, journal_entry_id
    ) values (
      sale_row.organization_id, 'sale', sale_row.id, 'primary', journal_entry_id_value
    );

    return journal_entry_id_value;
  end if;

  return null;
end;
$$;

revoke all on function erp.post_confirmed_sale_accounting_v2_exact4(uuid, uuid)
  from public, anon, authenticated, service_role;
-- ============================================================================
-- 7. Trigger dispatcher post_confirmed_sale_accounting()
-- ============================================================================
create or replace function erp.post_confirmed_sale_accounting()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  sale_row erp.sales%rowtype;
  period_id_value uuid;
  journal_entry_id_value uuid;
  receivable_account_id uuid;
  income_account_id uuid;
  inventory_account_id uuid;
  cogs_account_id uuid;
  revenue_base numeric(18, 2);
  cogs_base numeric(18, 2);
  debit_total_value numeric(18, 2);
  base_currency_value text;
begin
  if new.payment_state is null then
    return new;
  end if;

  select sale.*
    into sale_row
  from erp.sales sale
  where sale.id = new.sale_id
    and sale.organization_id = new.organization_id
  for update;

  if sale_row.id is null
     or sale_row.idempotency_key like '%:fulfill:sale'
     or exists (
       select 1
       from erp.accounting_source_events source_event
       where source_event.organization_id = sale_row.organization_id
         and source_event.source_type = 'sale'
         and source_event.source_id = sale_row.id
         and source_event.posting_kind = 'primary'
     )
     or exists (
       select 1
       from erp.pos_v2_zero_accounting_outcomes outcome
       where outcome.organization_id = sale_row.organization_id
         and outcome.sale_id = sale_row.id
         and outcome.posting_kind = 'primary'
     ) then
    return new;
  end if;

  if auth.uid() is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'an authenticated actor is required for automatic sale accounting';
  end if;

  -- Early dispatch based on authoritative persisted pricing_version
  if sale_row.pricing_version = 'v2' then
    perform erp.post_confirmed_sale_accounting_v2_exact4(sale_row.id, sale_row.organization_id);
    return new;
  end if;

  -- Legacy v1 path (maintained from DEV baseline)
  select
    (max(role.account_id::text) filter (where role.role_code = 'receivable'))::uuid,
    (max(role.account_id::text) filter (where role.role_code = 'sales_income'))::uuid,
    (max(role.account_id::text) filter (where role.role_code = 'inventory'))::uuid,
    (max(role.account_id::text) filter (where role.role_code = 'cogs'))::uuid
  into
    receivable_account_id,
    income_account_id,
    inventory_account_id,
    cogs_account_id
  from erp.accounting_account_roles role
  where role.organization_id = sale_row.organization_id;

  if receivable_account_id is null or income_account_id is null then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'receivable and sales income account roles are required';
  end if;

  revenue_base := round(sale_row.total_amount * sale_row.exchange_rate, 2);
  select currency.currency_code into base_currency_value
  from erp.organization_currencies currency
  where currency.organization_id = sale_row.organization_id
    and currency.is_base and currency.is_active;
  if base_currency_value is null then
    raise exception 'an active base currency is required';
  end if;

  select coalesce(round(sum(-movement.value_delta_base), 2), 0)
    into cogs_base
  from erp.stock_cost_movements movement
  where movement.organization_id = sale_row.organization_id
    and movement.document_id = sale_row.stock_document_id
    and movement.quantity_delta < 0;

  if cogs_base > 0 and (inventory_account_id is null or cogs_account_id is null) then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'inventory and COGS account roles are required';
  end if;

  select period.id
    into period_id_value
  from erp.accounting_periods period
  where period.organization_id = sale_row.organization_id
    and sale_row.confirmed_at::date between period.period_start and period.period_end
  for update;

  if period_id_value is null then
    insert into erp.accounting_periods (
      organization_id, period_start, period_end
    ) values (
      sale_row.organization_id,
      date_trunc('month', sale_row.confirmed_at)::date,
      (date_trunc('month', sale_row.confirmed_at) + interval '1 month - 1 day')::date
    )
    on conflict (organization_id, period_start, period_end) do nothing
    returning id into period_id_value;

    if period_id_value is null then
      select period.id
        into period_id_value
      from erp.accounting_periods period
      where period.organization_id = sale_row.organization_id
        and sale_row.confirmed_at::date between period.period_start and period.period_end;
    end if;
  elsif exists (
    select 1
    from erp.accounting_periods period
    where period.id = period_id_value and period.status = 'closed'
  ) then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'accounting period is closed';
  end if;

  debit_total_value := revenue_base + cogs_base;

  insert into erp.journal_entries (
    organization_id, branch_id, period_id, entry_date, status, description,
    source_type, source_id, idempotency_key, total_debit, total_credit,
    posted_at, posted_by, created_by, accounting_contract
  ) values (
    sale_row.organization_id, sale_row.branch_id, period_id_value,
    sale_row.confirmed_at::date, 'posted', 'Venta ' || sale_row.id::text,
    'sale', sale_row.id, 'sale:' || sale_row.id::text || ':primary',
    debit_total_value, debit_total_value, now(), auth.uid(), auth.uid(),
    'legacy_v1'
  )
  returning id into journal_entry_id_value;

  insert into erp.journal_entry_lines (
    organization_id, journal_entry_id, line_number, account_id, description,
    debit, credit, currency_code, exchange_rate
  ) values
    (
      sale_row.organization_id, journal_entry_id_value, 1,
      receivable_account_id, 'Venta ' || sale_row.id::text,
      revenue_base, 0, base_currency_value, 1
    ),
    (
      sale_row.organization_id, journal_entry_id_value, 2,
      income_account_id, 'Ingreso por venta ' || sale_row.id::text,
      0, revenue_base, base_currency_value, 1
    );

  if cogs_base > 0 then
    insert into erp.journal_entry_lines (
      organization_id, journal_entry_id, line_number, account_id, description,
      debit, credit, currency_code, exchange_rate
    ) values
      (
        sale_row.organization_id, journal_entry_id_value, 3,
        cogs_account_id, 'Costo de venta ' || sale_row.id::text,
        cogs_base, 0, base_currency_value, 1
      ),
      (
        sale_row.organization_id, journal_entry_id_value, 4,
        inventory_account_id, 'Salida de inventario ' || sale_row.id::text,
        0, cogs_base, base_currency_value, 1
      );
  end if;

  insert into erp.accounting_source_events (
    organization_id, source_type, source_id, posting_kind, journal_entry_id
  ) values (
    sale_row.organization_id, 'sale', sale_row.id, 'primary', journal_entry_id_value
  );

  return new;
end;
$$;

revoke all on function erp.post_confirmed_sale_accounting()
  from public, anon, authenticated, service_role;
-- ============================================================================
-- 8. Exact reversals (Public & Internal)
-- ============================================================================
create or replace function erp.reverse_pos_v2_journal_entry_exact4(
  target_organization_id uuid,
  target_entry_id uuid,
  target_reversal_date date,
  operation_key text,
  operation_reason text,
  target_source_type text,
  target_source_id uuid,
  internal_command boolean
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  original_entry erp.journal_entries%rowtype;
  existing_reversal erp.journal_entries%rowtype;
  reversal_id_value uuid;
  period_id_value uuid;
  source_entry_id uuid;
  line_value erp.journal_entry_lines%rowtype;
begin
  if auth.uid() is null or target_organization_id is null
     or target_organization_id is distinct from erp.current_organization_id() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'an authenticated active-organization context is required';
  end if;

  select entry.* into original_entry
  from erp.journal_entries entry
  where entry.id = target_entry_id
    and entry.organization_id = target_organization_id
  for update;

  if original_entry.id is null
     or original_entry.accounting_contract <> 'pos_gross_v2_exact4'
     or original_entry.status not in ('posted', 'reversed') then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'a posted tenant exact4 journal is required';
  end if;
  if not internal_command and not erp.has_permission('accounting.post', original_entry.branch_id) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'accounting.post permission is required for the target branch';
  end if;
  if target_reversal_date is null
     or nullif(btrim(operation_key), '') is null
     or nullif(btrim(operation_reason), '') is null
     or (internal_command and (
       nullif(btrim(target_source_type), '') is null or target_source_id is null
       or not exists (
         select 1 from erp.branches branch
         where branch.id = original_entry.branch_id
           and branch.organization_id = target_organization_id and branch.is_active
       )
     )) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'complete exact4 reversal data is required';
  end if;

  select entry.* into existing_reversal
  from erp.journal_entries entry
  where entry.organization_id = target_organization_id
    and entry.idempotency_key = operation_key;

  if existing_reversal.id is not null then
    if existing_reversal.v2_original_entry_id is distinct from original_entry.id
       or original_entry.reversal_of_entry_id is distinct from existing_reversal.id then
      raise exception using errcode = 'unique_violation',
        message = 'reversal idempotency key belongs to another original entry';
    end if;
    if internal_command and (
      existing_reversal.source_type is distinct from target_source_type
      or existing_reversal.source_id is distinct from target_source_id
      or not exists (
        select 1 from erp.accounting_source_events event
        where event.organization_id = target_organization_id
          and event.source_type = target_source_type and event.source_id = target_source_id
          and event.posting_kind = 'reversal' and event.journal_entry_id = existing_reversal.id
      )
    ) then
      raise exception using errcode = 'unique_violation',
        message = 'reversal idempotency key belongs to another source event';
    end if;
    return existing_reversal.id;
  end if;

  if original_entry.status = 'reversed' then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'exact4 journal is already reversed under another key';
  end if;

  if internal_command then
    select event.journal_entry_id into source_entry_id
    from erp.accounting_source_events event
    where event.organization_id = target_organization_id
      and event.source_type = target_source_type and event.source_id = target_source_id
      and event.posting_kind = 'reversal';
    if source_entry_id is not null then
      raise exception using errcode = 'unique_violation',
        message = 'reversal source event is already used by another command';
    end if;
    period_id_value := erp.ensure_open_period_internal(target_reversal_date, target_organization_id);
  else
    period_id_value := erp.ensure_open_period(target_reversal_date, target_organization_id);
    if period_id_value is null then
      raise exception using errcode = 'object_not_in_prerequisite_state', message = 'open period is required';
    end if;
  end if;

  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.journal_entries (
    organization_id, branch_id, period_id, entry_date, status, description,
    source_type, source_id, v2_original_entry_id, idempotency_key, total_debit, total_credit,
    posted_at, posted_by, created_by, accounting_contract
  ) values (
    target_organization_id, original_entry.branch_id, period_id_value, target_reversal_date, 'posted',
    operation_reason,
    case when internal_command then target_source_type else 'journal_reversal' end,
    case when internal_command then target_source_id else original_entry.id end,
    original_entry.id, operation_key, original_entry.total_credit, original_entry.total_debit,
    now(), auth.uid(), auth.uid(), original_entry.accounting_contract
  ) returning id into reversal_id_value;

  for line_value in
    select line.* from erp.journal_entry_lines line
    where line.journal_entry_id = original_entry.id
      and line.organization_id = target_organization_id
    order by line.line_number
  loop
    insert into erp.journal_entry_lines (
      organization_id, journal_entry_id, line_number, account_id, description,
      debit, credit, currency_code, exchange_rate
    ) values (
      target_organization_id, reversal_id_value, line_value.line_number, line_value.account_id,
      case when internal_command then 'Reversa: ' || line_value.description else line_value.description end,
      line_value.credit, line_value.debit, line_value.currency_code, line_value.exchange_rate
    );
  end loop;

  update erp.journal_entries
  set status = 'reversed', reversal_of_entry_id = reversal_id_value
  where id = original_entry.id and organization_id = target_organization_id;

  insert into erp.accounting_source_events (
    organization_id, source_type, source_id, posting_kind, journal_entry_id
  ) values (
    target_organization_id,
    case when internal_command then target_source_type else 'journal_reversal' end,
    case when internal_command then target_source_id else original_entry.id end,
    case when internal_command then 'reversal' else 'primary' end,
    reversal_id_value
  );

  if not internal_command then
    insert into erp.audit_events (
      organization_id, branch_id, actor_user_id, schema_name, table_name, record_id, action, reason, metadata
    ) values (
      target_organization_id, original_entry.branch_id, auth.uid(), 'erp', 'journal_entries',
      reversal_id_value::text, 'execute', operation_reason,
      jsonb_build_object('debit', original_entry.total_credit, 'credit', original_entry.total_debit)
    );
  end if;
  return reversal_id_value;
end;
$$;

alter function erp.reverse_pos_v2_journal_entry_exact4(uuid, uuid, date, text, text, text, uuid, boolean) owner to postgres;
revoke all on function erp.reverse_pos_v2_journal_entry_exact4(uuid, uuid, date, text, text, text, uuid, boolean)
  from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION erp.reverse_journal_entry(target_entry_id uuid, operation_key text, operation_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'erp', 'pg_catalog', 'pg_temp'
AS $function$
begin
  return erp.reverse_journal_entry(target_entry_id, current_date, operation_key, operation_reason);
end;
$function$;

alter function erp.reverse_journal_entry(uuid, text, text) owner to postgres;
revoke all on function erp.reverse_journal_entry(uuid, text, text) from public, anon;
grant execute on function erp.reverse_journal_entry(uuid, text, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION erp.reverse_journal_entry(target_entry_id uuid, target_reversal_date date, operation_key text, operation_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'erp', 'pg_catalog', 'pg_temp'
AS $function$
declare
  org_id uuid := erp.current_organization_id();
  original erp.journal_entries%rowtype;
  reverse_id uuid;
  lines jsonb;
begin
  -- Key-side dispatch prevents a false legacy target from bypassing exact4 provenance.
  if exists (
    select 1 from erp.journal_entries entry
    where entry.organization_id = org_id
      and entry.accounting_contract = 'pos_gross_v2_exact4'
      and (entry.id = target_entry_id or entry.idempotency_key = operation_key)
  ) then
    return erp.reverse_pos_v2_journal_entry_exact4(
      org_id, target_entry_id, target_reversal_date, operation_key, operation_reason,
      null, null, false
    );
  end if;

  select id into reverse_id
  from erp.journal_entries
  where organization_id = org_id and idempotency_key = operation_key;
  if reverse_id is not null then
    return reverse_id;
  end if;

  select * into original
  from erp.journal_entries
  where id = target_entry_id and organization_id = org_id
  for update;
  if original.id is null or original.status <> 'posted'
     or not erp.has_permission('accounting.post', original.branch_id)
     or target_reversal_date is null
     or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'posted entry, open reversal date, permission and reason are required';
  end if;

  select jsonb_agg(jsonb_build_object(
    'account_id', account_id,
    'description', description,
    'debit', credit,
    'credit', debit,
    'currency_code', currency_code,
    'exchange_rate', exchange_rate
  )) into lines
  from erp.journal_entry_lines
  where journal_entry_id = original.id and organization_id = org_id;

  reverse_id := erp.post_journal_entry(
    original.branch_id, target_reversal_date, 'journal_reversal', original.id,
    operation_key, operation_reason, lines
  );
  update erp.journal_entries
  set status = 'reversed', reversal_of_entry_id = reverse_id
  where id = original.id and organization_id = org_id;
  return reverse_id;
end;
$function$;

alter function erp.reverse_journal_entry(uuid, date, text, text) owner to postgres;
revoke all on function erp.reverse_journal_entry(uuid, date, text, text) from public, anon;
grant execute on function erp.reverse_journal_entry(uuid, date, text, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION erp.reverse_internal_journal_entry(target_organization_id uuid, target_entry_id uuid, target_source_type text, target_source_id uuid, operation_key text, operation_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'erp', 'pg_catalog', 'pg_temp'
AS $function$
declare
  original_entry erp.journal_entries%rowtype;
  reversal_id_value uuid;
  reversal_lines jsonb;
begin
  if exists (
    select 1 from erp.journal_entries entry
    where entry.organization_id = target_organization_id
      and entry.accounting_contract = 'pos_gross_v2_exact4'
      and (entry.id = target_entry_id or entry.idempotency_key = operation_key)
  ) then
    return erp.reverse_pos_v2_journal_entry_exact4(
      target_organization_id, target_entry_id, current_date, operation_key, operation_reason,
      target_source_type, target_source_id, true
    );
  end if;

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
$function$;

alter function erp.reverse_internal_journal_entry(uuid, uuid, text, uuid, text, text) owner to postgres;
revoke all on function erp.reverse_internal_journal_entry(uuid, uuid, text, uuid, text, text)
  from public, anon, authenticated, service_role;
-- ============================================================================
-- 9. Recreate erp.v_trial_balance with conditional contract contribution
-- ============================================================================
create view erp.v_trial_balance
with (security_invoker = true)
as
select
  entry.organization_id,
  entry.period_id,
  period.period_start,
  period.period_end,
  line.account_id,
  account.code as account_code,
  account.name as account_name,
  sum(
    case
      when entry.accounting_contract = 'pos_gross_v2_exact4' then (line.debit * line.exchange_rate)
      else round(line.debit * line.exchange_rate, 2)
    end
  ) as total_debit,
  sum(
    case
      when entry.accounting_contract = 'pos_gross_v2_exact4' then (line.credit * line.exchange_rate)
      else round(line.credit * line.exchange_rate, 2)
    end
  ) as total_credit,
  (
    sum(
      case
        when entry.accounting_contract = 'pos_gross_v2_exact4' then (line.debit * line.exchange_rate)
        else round(line.debit * line.exchange_rate, 2)
      end
    )
    -
    sum(
      case
        when entry.accounting_contract = 'pos_gross_v2_exact4' then (line.credit * line.exchange_rate)
        else round(line.credit * line.exchange_rate, 2)
      end
    )
  ) as balance
from erp.journal_entry_lines line
join erp.journal_entries entry
  on entry.id = line.journal_entry_id
 and entry.organization_id = line.organization_id
join erp.accounting_periods period
  on period.id = entry.period_id
 and period.organization_id = entry.organization_id
join erp.chart_of_accounts account
  on account.id = line.account_id
 and account.organization_id = line.organization_id
where entry.organization_id = erp.current_organization_id()
  and erp.has_permission('accounting.view', entry.branch_id)
  and period.status = 'closed'
  and entry.status in ('posted', 'reversed')
group by
  entry.organization_id, entry.period_id, period.period_start, period.period_end,
  line.account_id, account.code, account.name;

comment on view erp.v_trial_balance is
  'Balance de periodos cerrados convertido a moneda base mediante el snapshot de cada linea.';

alter view erp.v_trial_balance owner to postgres;
grant all on table erp.v_trial_balance to postgres;
grant all on table erp.v_trial_balance to service_role;
grant select on table erp.v_trial_balance to authenticated;
-- ============================================================================
-- 10. Update export_report_rows trial_balance branch preserving exact4
-- ============================================================================
CREATE OR REPLACE FUNCTION erp.export_report_rows(report_code text, operation_reason text, filters jsonb DEFAULT '{}'::jsonb, date_from date DEFAULT NULL::date, date_to date DEFAULT NULL::date, target_branch_id uuid DEFAULT NULL::uuid, row_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'erp', 'pg_catalog', 'pg_temp'
AS $function$
declare
  actor_id uuid := auth.uid();
  organization_id_value uuid := erp.current_organization_id();
  normalized_code text := lower(nullif(btrim(report_code), ''));
  normalized_reason text := nullif(btrim(operation_reason), '');
  normalized_filters jsonb := coalesce(filters, '{}'::jsonb);
  exported_rows jsonb := '[]'::jsonb;
  exported_count integer := 0;
  was_truncated boolean := false;
  allowed_filter_keys text[] := array[]::text[];
  unknown_filter_key text;
  search_filter text;
  schema_filter text;
  table_filter text;
  action_filter text;
  status_filter text;
begin
  if actor_id is null or organization_id_value is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'authenticated ERP context is required';
  end if;

  if normalized_code is null or normalized_code not in (
    'audit', 'iva_ventas', 'iva_compras', 'trial_balance', 'profitability'
  ) then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'unsupported ERP report code';
  end if;

  if normalized_reason is null or length(normalized_reason) < 3 then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'an export reason of at least 3 characters is required';
  end if;

  if length(normalized_reason) > 500 then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'the export reason cannot exceed 500 characters';
  end if;

  if row_limit is null or row_limit < 1 or row_limit > 5000 then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'row_limit must be between 1 and 5000';
  end if;

  if date_from is not null and date_to is not null and date_from > date_to then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'date_from cannot be after date_to';
  end if;

  if jsonb_typeof(normalized_filters) <> 'object' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'filters must be a JSON object';
  end if;

  if target_branch_id is not null and not exists (
    select 1
    from erp.branches branch
    where branch.id = target_branch_id
      and branch.organization_id = organization_id_value
      and branch.is_active
  ) then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'target branch does not belong to the active organization';
  end if;

  -- Organization-wide exports require an organization-wide grant. A grant for
  -- one branch must never become a bulk export of every branch.
  if target_branch_id is null then
    if not erp.has_permission('reports.export') then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'organization-wide reports.export permission is required';
    end if;
  elsif not erp.has_permission('reports.export', target_branch_id) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'reports.export permission is required for the target branch';
  end if;

  if normalized_code = 'audit' then
    allowed_filter_keys := array['search', 'schema', 'table', 'action', 'status'];
  end if;

  select key
    into unknown_filter_key
  from jsonb_object_keys(normalized_filters) as key
  where not (key = any(allowed_filter_keys))
  limit 1;

  if unknown_filter_key is not null then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = format('unsupported filter key: %s', unknown_filter_key);
  end if;

  search_filter := nullif(btrim(normalized_filters ->> 'search'), '');
  schema_filter := nullif(btrim(normalized_filters ->> 'schema'), '');
  table_filter := nullif(btrim(normalized_filters ->> 'table'), '');
  action_filter := nullif(lower(btrim(normalized_filters ->> 'action')), '');
  status_filter := nullif(lower(btrim(normalized_filters ->> 'status')), '');

  if status_filter is not null and status_filter not in ('success', 'warning') then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'audit status filter must be success or warning';
  end if;

  if normalized_code = 'audit' then
    if not (
      (target_branch_id is null and (
        erp.has_permission('audit.view')
        or exists (
          select 1 from erp.branches branch
          where branch.organization_id = organization_id_value
            and branch.is_active
            and erp.has_permission('audit.view', branch.id)
        )
      ))
      or (target_branch_id is not null and erp.has_permission('audit.view', target_branch_id))
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'audit.view permission is required for the export scope';
    end if;

    with limited as (
      select
        row_number() over (order by event.occurred_at desc, event.id desc) as ordinal,
        jsonb_build_object(
          'id', event.id,
          'occurred_at', event.occurred_at,
          'actor_user_id', event.actor_user_id,
          'schema_name', event.schema_name,
          'table_name', event.table_name,
          'record_id', event.record_id,
          'action', event.action,
          'reason', event.reason,
          'correlation_id', event.correlation_id,
          'metadata', event.metadata
        ) as payload
      from erp.audit_events event
      where event.organization_id = organization_id_value
        and (target_branch_id is null or event.branch_id = target_branch_id)
        and erp.has_permission('reports.export', event.branch_id)
        and erp.has_permission('audit.view', event.branch_id)
        and (date_from is null or event.occurred_at::date >= date_from)
        and (date_to is null or event.occurred_at::date <= date_to)
        and (schema_filter is null or event.schema_name = schema_filter)
        and (table_filter is null or event.table_name = table_filter)
        and (action_filter is null or lower(event.action) = action_filter)
        and (
          status_filter is null
          or (status_filter = 'warning' and event.action in ('delete', 'reject'))
          or (status_filter = 'success' and event.action not in ('delete', 'reject'))
        )
        and (
          search_filter is null
          or event.actor_user_id::text ilike '%' || search_filter || '%'
          or event.action ilike '%' || search_filter || '%'
          or event.table_name ilike '%' || search_filter || '%'
          or coalesce(event.record_id, '') ilike '%' || search_filter || '%'
          or coalesce(event.reason, '') ilike '%' || search_filter || '%'
        )
      order by event.occurred_at desc, event.id desc
      limit row_limit + 1
    )
    select
      coalesce(jsonb_agg(payload order by ordinal) filter (where ordinal <= row_limit), '[]'::jsonb),
      count(*) > row_limit
    into exported_rows, was_truncated
    from limited;

  elsif normalized_code = 'iva_ventas' then
    if not (
      (target_branch_id is null and erp.has_permission('reports.view'))
      or (target_branch_id is not null
        and erp.has_permission('reports.view', target_branch_id)
        and erp.has_permission('sales.view', target_branch_id))
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'reports.view and sales.view permissions are required';
    end if;

    with limited as (
      select
        row_number() over (order by report.sale_date desc nulls last, report.sale_id) as ordinal,
        to_jsonb(report) as payload
      from (
        select
          value.organization_id, value.branch_id, value.sale_id, value.sale_date,
          value.alicuota, value.base_imponible, value.iva
        from erp.v_iva_ventas value
        where value.organization_id = organization_id_value
          and (target_branch_id is null or value.branch_id = target_branch_id)
          and erp.has_permission('reports.export', value.branch_id)
          and erp.has_permission('reports.view', value.branch_id)
          and erp.has_permission('sales.view', value.branch_id)
          and (date_from is null or value.sale_date >= date_from)
          and (date_to is null or value.sale_date <= date_to)
        order by value.sale_date desc nulls last, value.sale_id
        limit row_limit + 1
      ) report
    )
    select
      coalesce(jsonb_agg(payload order by ordinal) filter (where ordinal <= row_limit), '[]'::jsonb),
      count(*) > row_limit
    into exported_rows, was_truncated
    from limited;

  elsif normalized_code = 'iva_compras' then
    if not (
      (target_branch_id is null and erp.has_permission('reports.view'))
      or (target_branch_id is not null
        and erp.has_permission('reports.view', target_branch_id)
        and erp.has_permission('purchases.view', target_branch_id)
        and erp.has_permission('costs.view', target_branch_id))
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'reports.view, purchases.view and costs.view permissions are required';
    end if;

    with limited as (
      select
        row_number() over (order by report.purchase_date desc nulls last, report.purchase_order_id) as ordinal,
        to_jsonb(report) as payload
      from (
        select
          value.organization_id, value.branch_id, value.purchase_order_id,
          value.purchase_date, value.alicuota, value.base_imponible, value.iva
        from erp.v_iva_compras value
        where value.organization_id = organization_id_value
          and (target_branch_id is null or value.branch_id = target_branch_id)
          and erp.has_permission('reports.export', value.branch_id)
          and erp.has_permission('reports.view', value.branch_id)
          and erp.has_permission('purchases.view', value.branch_id)
          and erp.has_permission('costs.view', value.branch_id)
          and (date_from is null or value.purchase_date >= date_from)
          and (date_to is null or value.purchase_date <= date_to)
        order by value.purchase_date desc nulls last, value.purchase_order_id
        limit row_limit + 1
      ) report
    )
    select
      coalesce(jsonb_agg(payload order by ordinal) filter (where ordinal <= row_limit), '[]'::jsonb),
      count(*) > row_limit
    into exported_rows, was_truncated
    from limited;

  elsif normalized_code = 'trial_balance' then
    if not (
      (target_branch_id is null
        and erp.has_permission('reports.view')
        and erp.has_permission('accounting.view'))
      or (target_branch_id is not null
        and erp.has_permission('reports.view', target_branch_id)
        and erp.has_permission('accounting.view', target_branch_id))
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'reports.view and accounting.view permissions are required';
    end if;

    with report as (
      select
        entry.organization_id,
        entry.period_id,
        period.period_start,
        period.period_end,
        line.account_id,
        account.code as account_code,
        account.name as account_name,
        sum(
          case
            when entry.accounting_contract = 'pos_gross_v2_exact4' then (line.debit * line.exchange_rate)
            else round(line.debit * line.exchange_rate, 2)
          end
        ) as total_debit,
        sum(
          case
            when entry.accounting_contract = 'pos_gross_v2_exact4' then (line.credit * line.exchange_rate)
            else round(line.credit * line.exchange_rate, 2)
          end
        ) as total_credit,
        (
          sum(
            case
              when entry.accounting_contract = 'pos_gross_v2_exact4' then (line.debit * line.exchange_rate)
              else round(line.debit * line.exchange_rate, 2)
            end
          )
          -
          sum(
            case
              when entry.accounting_contract = 'pos_gross_v2_exact4' then (line.credit * line.exchange_rate)
              else round(line.credit * line.exchange_rate, 2)
            end
          )
        ) as balance
      from erp.journal_entry_lines line
      join erp.journal_entries entry
        on entry.id = line.journal_entry_id
       and entry.organization_id = line.organization_id
      join erp.accounting_periods period
        on period.id = entry.period_id
       and period.organization_id = entry.organization_id
      join erp.chart_of_accounts account
        on account.id = line.account_id
       and account.organization_id = line.organization_id
      where entry.organization_id = organization_id_value
        and (target_branch_id is null or entry.branch_id = target_branch_id)
        and erp.has_permission('reports.export', entry.branch_id)
        and erp.has_permission('reports.view', entry.branch_id)
        and erp.has_permission('accounting.view', entry.branch_id)
        and (date_from is null or period.period_start >= date_from)
        and (date_to is null or period.period_end <= date_to)
        and period.status = 'closed'
        and entry.status in ('posted', 'reversed')
      group by
        entry.organization_id, entry.period_id, period.period_start, period.period_end,
        line.account_id, account.code, account.name
    ),
    limited as (
      select
        row_number() over (order by report.account_code, report.period_start, report.account_id) as ordinal,
        to_jsonb(report) as payload
      from report
      order by report.account_code, report.period_start, report.account_id
      limit row_limit + 1
    )
    select
      coalesce(jsonb_agg(payload order by ordinal) filter (where ordinal <= row_limit), '[]'::jsonb),
      count(*) > row_limit
    into exported_rows, was_truncated
    from limited;

  else
    if not (
      (target_branch_id is null and erp.has_permission('profitability.view'))
      or (target_branch_id is not null and erp.has_permission('profitability.view', target_branch_id))
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'profitability.view permission is required';
    end if;

    if date_from is not null or date_to is not null then
      raise exception using
        errcode = 'invalid_parameter_value',
        message = 'profitability export does not support date filters';
    end if;

    with sales_agg as (
      select
        line.organization_id,
        line.product_id,
        sum(line.quantity)::numeric(18, 4) as quantity_sold,
        sum(round(line.line_total * sale.exchange_rate, 4))::numeric(18, 4) as gross_revenue
      from erp.sale_lines line
      join erp.sales sale
        on sale.id = line.sale_id
       and sale.organization_id = line.organization_id
      where line.organization_id = organization_id_value
        and line.kind = 'product'
        and line.product_id is not null
        and (target_branch_id is null or sale.branch_id = target_branch_id)
        and erp.has_permission('reports.export', sale.branch_id)
        and erp.has_permission('profitability.view', sale.branch_id)
        and erp.has_permission('sales.view', sale.branch_id)
        and coalesce((
          select event.sale_state
          from erp.sale_state_events event
          where event.sale_id = sale.id
            and event.organization_id = sale.organization_id
            and event.sale_state is not null
          order by event.event_sequence desc
          limit 1
        ), 'confirmed'::erp.sale_state) <> 'cancelled'::erp.sale_state
      group by line.organization_id, line.product_id
    ),
    cost_agg as (
      select
        line.organization_id,
        line.product_id,
        sum(line.landed_cost_base)::numeric(18, 4) as total_landed_cost,
        sum(line.quantity)::numeric(18, 4) as quantity_received
      from erp.purchase_receipt_lines line
      join erp.purchase_receipts receipt
        on receipt.id = line.receipt_id
       and receipt.organization_id = line.organization_id
      where line.organization_id = organization_id_value
        and line.product_id is not null
        and (target_branch_id is null or receipt.branch_id = target_branch_id)
        and erp.has_permission('reports.export', receipt.branch_id)
        and erp.has_permission('profitability.view', receipt.branch_id)
        and erp.has_permission('purchases.view', receipt.branch_id)
        and erp.has_permission('costs.view', receipt.branch_id)
      group by line.organization_id, line.product_id
    ),
    report as (
      select
        product.organization_id,
        product.id as product_id,
        product.internal_code,
        product.internal_name,
        sales.quantity_sold,
        sales.gross_revenue,
        case
          when costs.quantity_received is null or costs.quantity_received = 0 then null
          else (costs.total_landed_cost / costs.quantity_received)::numeric(24, 8)
        end as avg_unit_landed_cost,
        case
          when costs.quantity_received is null or costs.quantity_received = 0 or sales.quantity_sold is null then null
          else (sales.quantity_sold * costs.total_landed_cost / costs.quantity_received)::numeric(18, 4)
        end as estimated_cost,
        case
          when costs.quantity_received is null or costs.quantity_received = 0 or sales.quantity_sold is null then null
          else (
            sales.gross_revenue - sales.quantity_sold * costs.total_landed_cost / costs.quantity_received
          )::numeric(18, 4)
        end as margin
      from erp.products product
      left join sales_agg sales
        on sales.product_id = product.id
       and sales.organization_id = product.organization_id
      left join cost_agg costs
        on costs.product_id = product.id
       and costs.organization_id = product.organization_id
      where product.organization_id = organization_id_value
        and (sales.quantity_sold is not null or costs.quantity_received is not null)
    ),
    limited as (
      select
        row_number() over (order by report.gross_revenue desc nulls last, report.product_id) as ordinal,
        to_jsonb(report) as payload
      from report
      order by report.gross_revenue desc nulls last, report.product_id
      limit row_limit + 1
    )
    select
      coalesce(jsonb_agg(payload order by ordinal) filter (where ordinal <= row_limit), '[]'::jsonb),
      count(*) > row_limit
    into exported_rows, was_truncated
    from limited;
  end if;

  exported_count := jsonb_array_length(exported_rows);

  insert into erp.audit_events (
    organization_id,
    branch_id,
    actor_user_id,
    schema_name,
    table_name,
    record_id,
    action,
    reason,
    request_id,
    metadata
  ) values (
    organization_id_value,
    target_branch_id,
    actor_id,
    'erp',
    'report_exports',
    normalized_code,
    'execute',
    normalized_reason,
    nullif(current_setting('request.id', true), ''),
    jsonb_strip_nulls(jsonb_build_object(
      'report_code', normalized_code,
      'date_from', date_from,
      'date_to', date_to,
      'filters', normalized_filters,
      'row_limit', row_limit,
      'row_count', exported_count,
      'truncated', was_truncated,
      'format', 'csv'
    ))
  );

  return jsonb_build_object(
    'report_code', normalized_code,
    'rows', exported_rows,
    'row_count', exported_count,
    'truncated', was_truncated
  );
end;
$function$;


alter function erp.export_report_rows(text, text, jsonb, date, date, uuid, integer) owner to postgres;
revoke all on function erp.export_report_rows(text, text, jsonb, date, date, uuid, integer) from public, anon;
grant execute on function erp.export_report_rows(text, text, jsonb, date, date, uuid, integer) to authenticated;

commit;
