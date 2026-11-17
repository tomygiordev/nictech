begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

select has_table('erp', 'financing_account_entries', 'Financing customer subledger exists');
select has_table('erp', 'online_order_refunds', 'Online refund receipts exist');
select has_column('erp', 'cash_movements', 'receivable_payment_id', 'Cash movements link receivable payments');
select has_column('erp', 'receivable_payments', 'journal_entry_id', 'Receivable payments link their journal');
select has_column('erp', 'receivable_payments', 'request_hash', 'Receivable payments persist an idempotency hash');

select has_function(
  'erp', 'record_receivable_payment_settlement',
  array['uuid','uuid','uuid','uuid','numeric','text','text','text'],
  'Explicit atomic receivable settlement exists'
);
select has_function(
  'erp', 'reverse_receivable_payment',
  array['uuid','text','text','uuid'],
  'Receivable settlement reversal exists'
);
select has_function(
  'erp', 'refund_fulfilled_online_order',
  array['uuid','uuid','boolean','text','text','uuid'],
  'Atomic fulfilled-order refund exists'
);
select has_function(
  'erp', 'list_receivable_payment_methods', array['uuid'],
  'Receivable settlement exposes a permission-scoped payment-method lookup'
);
select has_function(
  'erp', 'list_receivable_cash_sessions', array['uuid'],
  'Receivable settlement exposes a permission-scoped open-cash lookup'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'erp.financing_account_entries'::regclass),
  'Financing customer subledger enforces RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'erp.online_order_refunds'::regclass),
  'Online refund receipts enforce RLS'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'erp.cash_movements'::regclass
      and conname = 'cash_movements_single_payment_source'
  ),
  'Cash movement has exactly one payment source'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'erp' and tablename = 'receivable_payments'
      and indexname = 'receivable_payments_reversal_unique'
  ),
  'Receivable payment can be reversed only once'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'erp.online_order_refunds'::regclass
      and conname = 'online_order_refunds_order_unique'
  ),
  'Fulfilled online order can be refunded only once'
);

select ok(
  not has_function_privilege('anon',
    'erp.record_receivable_payment_settlement(uuid,uuid,uuid,uuid,numeric,text,text,text)',
    'EXECUTE'),
  'Anon cannot settle receivables'
);
select ok(
  has_function_privilege('authenticated',
    'erp.record_receivable_payment_settlement(uuid,uuid,uuid,uuid,numeric,text,text,text)',
    'EXECUTE'),
  'Authenticated ERP actors may invoke the authorized settlement command'
);
select ok(
  not has_function_privilege('anon',
    'erp.refund_fulfilled_online_order(uuid,uuid,boolean,text,text,uuid)',
    'EXECUTE'),
  'Anon cannot refund fulfilled orders'
);
select ok(
  not has_function_privilege('anon', 'erp.list_receivable_payment_methods(uuid)', 'EXECUTE'),
  'Anon cannot enumerate receivable payment methods'
);
select ok(
  not has_function_privilege('anon', 'erp.list_receivable_cash_sessions(uuid)', 'EXECUTE'),
  'Anon cannot enumerate receivable cash sessions'
);
select ok(
  has_function_privilege('authenticated', 'erp.list_receivable_payment_methods(uuid)', 'EXECUTE'),
  'Authenticated ERP actors may invoke the authorized payment-method lookup'
);
select ok(
  has_function_privilege('authenticated', 'erp.list_receivable_cash_sessions(uuid)', 'EXECUTE'),
  'Authenticated ERP actors may invoke the authorized cash-session lookup'
);
select ok(
  pg_get_functiondef('erp.list_receivable_payment_methods(uuid)'::regprocedure)
    like '%accounts_receivable.manage%',
  'Payment-method lookup enforces accounts_receivable.manage'
);
select ok(
  pg_get_functiondef('erp.list_receivable_cash_sessions(uuid)'::regprocedure)
    like '%accounts_receivable.manage%',
  'Cash-session lookup enforces accounts_receivable.manage'
);
select ok(
  pg_get_functiondef(
    'erp.record_receivable_payment_settlement(uuid,uuid,uuid,uuid,numeric,text,text,text)'::regprocedure
  ) like '%financing_installment_status%',
  'Installment status assignment uses the enum explicitly'
);
select ok(
  pg_get_functiondef(
    'erp.refund_fulfilled_online_order(uuid,uuid,boolean,text,text,uuid)'::regprocedure
  ) like '%physical_return_confirmed%',
  'Online refund requires explicit physical return confirmation'
);

select * from finish();
rollback;
