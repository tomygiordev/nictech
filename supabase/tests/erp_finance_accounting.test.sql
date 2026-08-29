begin;

create extension if not exists pgtap with schema extensions;

select plan(50);

select has_table('erp', 'accounting_periods', 'Accounting periods exist');
select has_table('erp', 'chart_of_accounts', 'Chart of accounts exists');
select has_table('erp', 'accounting_account_roles', 'Account roles exist');
select has_table('erp', 'journal_entries', 'Journal entries exist');
select has_table('erp', 'journal_entry_lines', 'Journal lines exist');
select has_table('erp', 'accounting_source_events', 'Accounting source events exist');
select has_table('erp', 'financing_contracts', 'Financing contracts exist');
select has_table('erp', 'financing_installments', 'Financing installments exist');
select has_table('erp', 'receivable_payments', 'Receivable payments exist');
select has_table('erp', 'receivable_payment_allocations', 'Payment allocations exist');
select has_table('erp', 'account_reconciliations', 'Account reconciliations exist');

select has_function('erp', 'bootstrap_chart_of_accounts', array[]::text[], 'Chart bootstrap command exists');
select has_function('erp', 'get_current_erp_context', array[]::text[], 'ERP context query exists');
select has_function(
  'erp', 'create_financing_contract',
  array['uuid','uuid','text','numeric','numeric','numeric','integer','date','text','text'],
  'Financing contract command exists'
);
select has_function(
  'erp', 'record_receivable_payment',
  array['uuid','uuid','numeric','text','text'],
  'Receivable payment command exists'
);
select has_function('erp', 'calculate_financing_status', array['uuid'], 'Financing status query exists');
select has_function(
  'erp', 'post_journal_entry',
  array['uuid','date','text','uuid','text','text','jsonb'],
  'Balanced journal posting command exists'
);
select has_function('erp', 'reverse_journal_entry', array['uuid','text','text'], 'Journal reversal command exists');
select has_function('erp', 'close_accounting_period', array['uuid','text'], 'Period close command exists');
select has_function(
  'erp', 'reconcile_account_balance',
  array['uuid','uuid','date','numeric','numeric','text'],
  'Exact reconciliation command exists'
);

select ok((select relrowsecurity from pg_class where oid = 'erp.accounting_periods'::regclass), 'Periods enforce RLS');
select ok((select relrowsecurity from pg_class where oid = 'erp.chart_of_accounts'::regclass), 'Chart enforces RLS');
select ok((select relrowsecurity from pg_class where oid = 'erp.accounting_account_roles'::regclass), 'Account roles enforce RLS');
select ok((select relrowsecurity from pg_class where oid = 'erp.journal_entries'::regclass), 'Journal entries enforce RLS');
select ok((select relrowsecurity from pg_class where oid = 'erp.journal_entry_lines'::regclass), 'Journal lines enforce RLS');
select ok((select relrowsecurity from pg_class where oid = 'erp.accounting_source_events'::regclass), 'Source events enforce RLS');
select ok((select relrowsecurity from pg_class where oid = 'erp.financing_contracts'::regclass), 'Financing contracts enforce RLS');
select ok((select relrowsecurity from pg_class where oid = 'erp.financing_installments'::regclass), 'Installments enforce RLS');
select ok((select relrowsecurity from pg_class where oid = 'erp.receivable_payments'::regclass), 'Receivable payments enforce RLS');
select ok((select relrowsecurity from pg_class where oid = 'erp.receivable_payment_allocations'::regclass), 'Payment allocations enforce RLS');
select ok((select relrowsecurity from pg_class where oid = 'erp.account_reconciliations'::regclass), 'Reconciliations enforce RLS');

select ok(exists (select 1 from erp.permissions where code = 'accounts_receivable.view'), 'Accounts view permission exists');
select ok(exists (select 1 from erp.permissions where code = 'accounts_receivable.manage'), 'Accounts manage permission exists');
select ok(exists (select 1 from erp.permissions where code = 'accounting.post'), 'Accounting post permission exists');
select ok(exists (select 1 from erp.permissions where code = 'accounting.close_period'), 'Period close permission exists');

select ok(exists (
  select 1 from pg_constraint where conrelid = 'erp.journal_entries'::regclass and conname = 'journal_entries_balance'
), 'Posted journal entries require Debe=Haber');
select ok(exists (
  select 1 from pg_constraint where conrelid = 'erp.financing_contracts'::regclass and conname = 'financing_contracts_operation_unique'
), 'Financing creation is idempotent');
select ok(exists (
  select 1 from pg_constraint where conrelid = 'erp.receivable_payments'::regclass and conname = 'receivable_payments_unique'
), 'Receivable payments are idempotent');
select ok(exists (
  select 1 from pg_trigger where tgrelid = 'erp.journal_entries'::regclass and tgname = 'journal_entries_immutable'
), 'Posted journal entries are protected from mutation');
select ok(exists (
  select 1 from pg_trigger where tgrelid = 'erp.receivable_payments'::regclass and tgname = 'receivable_payments_no_delete'
), 'Receivable payments cannot be deleted');
select ok(exists (
  select 1 from pg_constraint where conrelid = 'erp.account_reconciliations'::regclass and conname = 'account_reconciliations_difference'
), 'Reconciliation difference is deterministic');

select throws_ok(
  $$select erp.create_financing_contract(
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'ARS', 1000, 100, 0.1, 3, current_date, 'unauth-finance', 'test'
  )$$,
  '22023',
  'customer, terms, currency, permission and reason are required',
  'Unauthenticated financing cannot be created'
);

select has_function(
  'erp', 'post_erp_source_event',
  array['uuid','date','text','uuid','text','text','jsonb'],
  'Generic source-event posting command exists'
);
select has_function(
  'erp', 'reverse_journal_entry',
  array['uuid','date','text','text'],
  'Dated journal reversal command exists'
);
select ok(exists (
  select 1 from pg_trigger where tgrelid = 'erp.accounting_source_events'::regclass
    and tgname = 'accounting_source_events_no_delete'
), 'Accounting source events cannot be deleted');
select ok(exists (
  select 1 from pg_trigger where tgrelid = 'erp.receivable_payment_allocations'::regclass
    and tgname = 'receivable_payment_allocations_no_delete'
), 'Payment allocations cannot be deleted');
select ok(pg_get_functiondef('erp.post_journal_entry(uuid,date,text,uuid,text,text,jsonb)'::regprocedure)
  like '%accounting_source_events%', 'Journal posting records source events');
select ok(pg_get_functiondef('erp.record_receivable_payment(uuid,uuid,numeric,text,text)'::regprocedure)
  like '%interest_amount%', 'Payments allocate interest and late fees');
select ok(pg_get_functiondef('erp.close_accounting_period(uuid,text)'::regprocedure)
  like '%journal_entries%', 'Period close validates journal state');
select ok(pg_get_functiondef('erp.reconcile_account_balance(uuid,uuid,date,numeric,numeric,text)'::regprocedure)
  like '%difference must be zero%', 'Reconciliation rejects non-zero differences');

select * from finish();
rollback;
