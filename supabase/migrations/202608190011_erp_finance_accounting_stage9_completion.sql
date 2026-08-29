-- Stage 9 forward corrections. Migration 010 remains immutable history.

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
    source_type, source_id, idempotency_key, created_by
  ) values (
    org_id, target_branch_id, period_id, target_entry_date, 'draft', operation_reason,
    nullif(btrim(target_source_type), ''), target_source_id, operation_key, auth.uid()
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

create or replace function erp.post_erp_source_event(
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
begin
  if nullif(btrim(target_source_type), '') is null or target_source_id is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'source type and source id are required';
  end if;
  return erp.post_journal_entry(
    target_branch_id, target_entry_date, target_source_type, target_source_id,
    operation_key, operation_reason, lines
  );
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
  late_allocation numeric(18,2);
  interest_allocation numeric(18,2);
  principal_allocation numeric(18,2);
  installment record;
begin
  if org_id is null or not erp.has_permission('accounts_receivable.manage', target_branch_id)
     or payment_amount <= 0 or nullif(btrim(operation_key), '') is null
     or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'payment, permission, key and reason are required';
  end if;

  select id into payment_id
  from erp.receivable_payments
  where organization_id = org_id and branch_id = target_branch_id and idempotency_key = operation_key;
  if payment_id is not null then
    return payment_id;
  end if;

  perform 1 from erp.financing_contracts
  where id = target_contract_id and organization_id = org_id and branch_id = target_branch_id
  for update;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'financing contract not found';
  end if;

  if remaining > (
    select coalesce(sum(
      principal_due + interest_due + late_fee_due
      - paid_principal - paid_interest - paid_late_fee
    ), 0)
    from erp.financing_installments
    where contract_id = target_contract_id and organization_id = org_id
  ) then
    raise exception using errcode = 'check_violation', message = 'payment exceeds the outstanding balance';
  end if;

  insert into erp.receivable_payments (
    organization_id, branch_id, contract_id, currency_code, amount,
    idempotency_key, reason, created_by
  )
  select org_id, target_branch_id, id, currency_code, payment_amount,
    operation_key, operation_reason, auth.uid()
  from erp.financing_contracts
  where id = target_contract_id and organization_id = org_id
  returning id into payment_id;

  for installment in
    select * from erp.financing_installments
    where contract_id = target_contract_id and organization_id = org_id
      and principal_due + interest_due + late_fee_due > paid_principal + paid_interest + paid_late_fee
    order by due_date, installment_number
    for update
  loop
    exit when remaining <= 0;

    late_allocation := least(remaining, installment.late_fee_due - installment.paid_late_fee);
    remaining := remaining - late_allocation;
    interest_allocation := least(remaining, installment.interest_due - installment.paid_interest);
    remaining := remaining - interest_allocation;
    principal_allocation := least(remaining, installment.principal_due - installment.paid_principal);
    remaining := remaining - principal_allocation;

    if late_allocation + interest_allocation + principal_allocation > 0 then
      update erp.financing_installments
      set paid_late_fee = paid_late_fee + late_allocation,
          paid_interest = paid_interest + interest_allocation,
          paid_principal = paid_principal + principal_allocation,
          status = case
            when paid_principal + principal_allocation >= principal_due
             and paid_interest + interest_allocation >= interest_due
             and paid_late_fee + late_allocation >= late_fee_due then 'paid'
            else 'partially_paid'
          end
      where id = installment.id and organization_id = org_id;

      insert into erp.receivable_payment_allocations (
        organization_id, payment_id, installment_id,
        principal_amount, interest_amount, late_fee_amount
      ) values (
        org_id, payment_id, installment.id,
        principal_allocation, interest_allocation, late_allocation
      );
    end if;
  end loop;

  if remaining <> 0 then
    raise exception using errcode = 'check_violation', message = 'payment could not be allocated exactly';
  end if;

  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.audit_events (
    organization_id, branch_id, actor_user_id, schema_name, table_name,
    record_id, action, reason, metadata
  ) values (
    org_id, target_branch_id, auth.uid(), 'erp', 'receivable_payments', payment_id::text,
    'execute', operation_reason, jsonb_build_object('amount', payment_amount)
  );
  return payment_id;
end;
$$;

create or replace function erp.reverse_journal_entry(
  target_entry_id uuid,
  target_reversal_date date,
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
  original erp.journal_entries%rowtype;
  reverse_id uuid;
  lines jsonb;
begin
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
$$;

create or replace function erp.reverse_journal_entry(
  target_entry_id uuid,
  operation_key text,
  operation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
begin
  return erp.reverse_journal_entry(target_entry_id, current_date, operation_key, operation_reason);
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
  period_row erp.accounting_periods%rowtype;
begin
  if org_id is null or not erp.has_permission('accounting.close_period')
     or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'insufficient_privilege', message = 'accounting.close_period permission and reason are required';
  end if;

  select * into period_row
  from erp.accounting_periods
  where id = target_period_id and organization_id = org_id
  for update;
  if period_row.id is null or period_row.status <> 'open' then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'open period not found';
  end if;
  if exists (
    select 1 from erp.journal_entries
    where organization_id = org_id and period_id = target_period_id and status = 'draft'
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'period contains draft journal entries';
  end if;
  if exists (
    select 1 from erp.account_reconciliations
    where organization_id = org_id and as_of_date between period_row.period_start and period_row.period_end
      and status <> 'matched'
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'period contains unmatched reconciliation';
  end if;

  update erp.accounting_periods
  set status = 'closed', closed_at = now(), closed_by = auth.uid(), close_reason = operation_reason
  where id = target_period_id and organization_id = org_id;
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
  if org_id is null or not erp.has_permission('accounting.view', target_branch_id)
     or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'insufficient_privilege', message = 'accounting.view permission and reason are required';
  end if;
  if difference <> 0 then
    raise exception using errcode = 'check_violation', message = 'difference must be zero';
  end if;
  insert into erp.account_reconciliations (
    organization_id, branch_id, account_id, as_of_date, subledger_balance,
    general_ledger_balance, difference_amount, status, reason, created_by
  ) values (
    org_id, target_branch_id, target_account_id, target_as_of_date,
    target_subledger_balance, target_general_ledger_balance, 0, 'matched',
    operation_reason, auth.uid()
  ) returning id into result_id;
  return result_id;
end;
$$;

drop trigger if exists accounting_source_events_no_delete on erp.accounting_source_events;
create trigger accounting_source_events_no_delete
before delete on erp.accounting_source_events
for each row execute function erp.prevent_finance_delete();

drop trigger if exists receivable_payment_allocations_no_delete on erp.receivable_payment_allocations;
create trigger receivable_payment_allocations_no_delete
before delete on erp.receivable_payment_allocations
for each row execute function erp.prevent_finance_delete();

drop trigger if exists accounting_source_events_audit on erp.accounting_source_events;
create trigger accounting_source_events_audit
after insert on erp.accounting_source_events
for each row execute function erp.finance_audit_insert();

drop trigger if exists receivable_payment_allocations_audit on erp.receivable_payment_allocations;
create trigger receivable_payment_allocations_audit
after insert on erp.receivable_payment_allocations
for each row execute function erp.finance_audit_insert();

revoke all on function erp.post_erp_source_event(uuid, date, text, uuid, text, text, jsonb) from public, anon;
revoke all on function erp.reverse_journal_entry(uuid, date, text, text) from public, anon;
grant execute on function erp.post_erp_source_event(uuid, date, text, uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function erp.reverse_journal_entry(uuid, date, text, text) to authenticated, service_role;
