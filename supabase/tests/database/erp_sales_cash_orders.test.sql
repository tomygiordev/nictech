begin;

create extension if not exists pgtap with schema extensions;

select plan(146);

select has_table('erp', 'sales', 'Sales header exists');
select has_table('erp', 'sale_lines', 'Sales lines exist');
select has_table('erp', 'payments', 'Payment facts exist');
select has_table('erp', 'customer_account_entries', 'Customer account ledger exists');
select has_table('erp', 'cash_sessions', 'Cash sessions exist');
select has_table('erp', 'cash_close_counts', 'Cash close reconciliation exists');
select has_table('erp', 'web_orders', 'Web orders exist');
select has_table('erp', 'web_payment_events', 'Provider event inbox exists');
select has_table('erp', 'web_provider_payments', 'Provider payment ownership exists');
select has_table('erp', 'integration_outbox', 'Integration outbox exists');
select has_table('erp', 'integration_attempts', 'Outbox attempts exist');
select has_column('erp', 'sale_lines', 'variant_id', 'Sale lines preserve variants');
select has_column('erp', 'sale_lines', 'inventory_unit_id', 'Sale lines preserve serialized units');
select has_column('erp', 'sales', 'stock_document_id', 'Sales link to atomic stock facts');
select has_column('erp', 'cash_close_counts', 'difference_amount', 'Close differences are persisted');
select has_column('erp', 'web_payment_events', 'applied', 'Provider events expose transition application');
select has_column('erp', 'sale_state_events', 'event_sequence', 'Sale state order is database-monotonic');
select has_column('erp', 'web_order_events', 'event_sequence', 'Web state order is database-monotonic');
select has_column('erp', 'web_order_events', 'request_hash', 'Manual web event retries preserve their request hash');

select has_function(
  'erp', 'create_sale',
  array['uuid','uuid','text','uuid','text','text','jsonb','jsonb','uuid'],
  'Atomic sale command exists'
);
select has_function('erp', 'record_sale_payment', array['uuid','uuid','uuid','numeric','text','text','text'], 'Partial payment command exists');
select has_function('erp', 'reverse_sale_payment', array['uuid','text','text','uuid'], 'Payment reversal accepts a safe refund cash session');
select has_function('erp', 'cancel_sale', array['uuid','text','text','uuid'], 'Sale cancellation accepts a safe refund cash session');
select has_function('erp', 'open_cash_session', array['uuid','text','text','jsonb'], 'Cash opening command exists');
select has_function('erp', 'close_cash_session', array['uuid','text','text','jsonb'], 'Counted close command exists');
select has_function(
  'erp', 'record_web_payment_event',
  array['uuid','text','text','text','erp.web_payment_status','uuid','numeric','timestamp with time zone','jsonb'],
  'Idempotent provider event command exists'
);
select has_function('erp', 'fulfill_web_order', array['uuid','text','text'], 'Web fulfillment command exists');

select ok((select relrowsecurity from pg_class where oid = 'erp.sales'::regclass), 'Sales enforce RLS');
select ok((select relrowsecurity from pg_class where oid = 'erp.cash_movements'::regclass), 'Cash movements enforce RLS');
select ok((select relrowsecurity from pg_class where oid = 'erp.web_payment_events'::regclass), 'Web events enforce RLS');
select is(has_table_privilege('authenticated', 'erp.sales', 'INSERT'), false, 'Authenticated clients cannot insert sales directly');
select is(has_table_privilege('service_role', 'erp.sales', 'INSERT'), false, 'Service role cannot insert sales directly');
select is(has_table_privilege('authenticated', 'erp.payments', 'UPDATE'), false, 'Authenticated clients cannot mutate payments');
select is(has_table_privilege('service_role', 'erp.web_payment_events', 'INSERT'), false, 'Service role cannot insert provider events directly');
select is(has_table_privilege('service_role', 'erp.web_provider_payments', 'INSERT'), false, 'Service role cannot claim provider payments by direct DML');
select is(has_function_privilege('service_role', 'erp.create_sale(uuid,uuid,text,uuid,text,text,jsonb,jsonb,uuid)', 'EXECUTE'), false, 'Service role cannot invoke sale command');
select is(has_function_privilege('service_role', 'erp.record_web_payment_event(uuid,text,text,text,erp.web_payment_status,uuid,numeric,timestamp with time zone,jsonb)', 'EXECUTE'), true, 'Service role alone invokes provider event command');
select is(has_function_privilege('authenticated', 'erp.record_web_payment_event(uuid,text,text,text,erp.web_payment_status,uuid,numeric,timestamp with time zone,jsonb)', 'EXECUTE'), false, 'Authenticated operators cannot forge provider events');
select is(has_function_privilege('authenticated', 'erp.create_sale(uuid,uuid,text,uuid,text,text,jsonb,jsonb,uuid)', 'EXECUTE'), true, 'Authenticated actors use checked sale command');
select is(has_function_privilege('authenticated', 'erp.record_sale_payment_core(uuid,uuid,uuid,numeric,text,text,text)', 'EXECUTE'), false, 'Payment core remains private');
select is(has_function_privilege('authenticated', 'erp.post_stock_document_stage4_core(erp.stock_document_kind,uuid,text,text,jsonb,boolean,text,uuid)', 'EXECUTE'), false, 'Existing stock-cost core remains private');
select is(has_table_privilege('authenticated', 'erp.payments', 'SELECT'), false, 'Authenticated actors lack table-wide payment reads');
select is(has_column_privilege('authenticated', 'erp.payments', 'amount', 'SELECT'), true, 'Authenticated actors retain safe payment amount reads');
select is(has_column_privilege('authenticated', 'erp.payments', 'provider_reference', 'SELECT'), false, 'Provider references are hidden from authenticated actors');
select is(has_table_privilege('authenticated', 'erp.web_payment_events', 'SELECT'), false, 'Authenticated actors lack table-wide provider-event reads');
select is(has_column_privilege('authenticated', 'erp.web_payment_events', 'status', 'SELECT'), true, 'Authenticated actors retain safe provider status reads');
select is(has_column_privilege('authenticated', 'erp.web_payment_events', 'payload', 'SELECT'), false, 'Provider payloads are hidden from authenticated actors');
select is(has_column_privilege('authenticated', 'erp.web_payment_events', 'error_message', 'SELECT'), false, 'Provider processing errors are hidden from authenticated actors');
select is(has_column_privilege('authenticated', 'erp.web_payment_events', 'provider_payment_id', 'SELECT'), false, 'Provider payment identifiers are hidden from authenticated actors');
select is(has_table_privilege('service_role', 'erp.web_payment_events', 'SELECT'), true, 'Service role retains provider-event reads');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'erp.cash_movements'::regclass
    and conname = 'cash_movements_opened_currency_fk'
), 'Cash movements require a currency opened by their session');

insert into erp.customers (id, organization_id, code, display_name)
values (
  'a1000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'STAGE6-CUSTOMER', 'Stage 6 Customer'
);

insert into erp.products (
  id, organization_id, product_type_id, item_kind, unit_id,
  internal_code, internal_name, inventory_tracking, can_sell,
  publish_on_web, allow_online_sale
) values
  (
    'a2000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001', 'product',
    '50000000-0000-0000-0000-000000000001',
    'STAGE6-PRODUCT', 'Stage 6 Product', 'quantity', true, true, true
  ),
  (
    'a2000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000004', 'service',
    '50000000-0000-0000-0000-000000000002',
    'STAGE6-SERVICE', 'Stage 6 Service', 'none', true, false, false
  );

insert into erp.product_variants (
  id, organization_id, product_id, code, name, attributes
) values (
  'a3000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'BLUE', 'Blue', '{"color":"blue"}'::jsonb
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'a4000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'stage6-test@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Stage 6 Test"}'::jsonb, now(), now()
);
update erp.profiles set organization_id = '10000000-0000-0000-0000-000000000001'
where id = 'a4000000-0000-0000-0000-000000000001';
insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000001'
);

select set_config('request.jwt.claim.sub', 'a4000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select erp.capture_exchange_rate('ARS', 1, 'stage6-local', '2026-08-19 12:00:00+00', 'stage6-fx', 'Stage 6 base rate')$$,
  'Base exchange snapshot can be prepared locally'
);

select throws_ok(
  $$select erp.create_sale(
    '20000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001', 'ARS',
    (select id from erp.exchange_rate_snapshots where source = 'stage6-local'),
    'stage6-malformed-sale', 'Reject malformed sale JSON', '[1]'::jsonb
  )$$,
  '22023', 'invalid sale line 1',
  'Sale JSON elements must be objects before typed casts'
);
select lives_ok(
  $$select erp.post_stock_document(
    'opening', '20000000-0000-0000-0000-000000000001',
    'stage6-stock-open', 'Stage 6 opening stock',
    '[{"product_id":"a2000000-0000-0000-0000-000000000001","variant_id":"a3000000-0000-0000-0000-000000000001","to_location_id":"30000000-0000-0000-0000-000000000002","quantity":10,"unit_cost":50}]'::jsonb
  )$$,
  'Variant stock and cost are opened atomically'
);

select lives_ok(
  $$select erp.open_cash_session(
    '84000000-0000-0000-0000-000000000001', 'stage6-cash-open', 'Open test cash',
    '[{"currency_code":"ARS","amount":0}]'::jsonb
  )$$,
  'Cash session opens with counted currency'
);
select is(
  erp.open_cash_session(
    '84000000-0000-0000-0000-000000000001', 'stage6-cash-open', 'Open test cash',
    '[{"currency_code":"ARS","amount":0}]'::jsonb
  ),
  (select id from erp.cash_sessions where idempotency_key = 'stage6-cash-open'),
  'Cash opening retry returns the same session'
);
select throws_ok(
  $$select erp.open_cash_session(
    '84000000-0000-0000-0000-000000000001', 'stage6-cash-open-other', 'Second open',
    '[{"currency_code":"ARS","amount":0}]'::jsonb
  )$$,
  '55000', 'cash register already has an open session',
  'A register cannot have two open sessions'
);

reset role;
insert into erp.profile_permission_overrides (
  organization_id, profile_id, permission_id, branch_id, effect, reason, created_by
) values (
  '10000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000001',
  (select id from erp.permissions where code = 'sales.discount'),
  '20000000-0000-0000-0000-000000000001', 'deny',
  'Stage 6 discount authorization test',
  'a4000000-0000-0000-0000-000000000001'
);
set local role authenticated;
select throws_ok(
  $$select erp.create_sale(
    '20000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001', 'ARS',
    (select id from erp.exchange_rate_snapshots where source = 'stage6-local'),
    'stage6-unauthorized-discount', 'Reject unauthorized discount',
    '[{"kind":"service","product_id":"a2000000-0000-0000-0000-000000000002","description":"Discounted service","quantity":1,"unit_price":50,"discount_amount":1,"discount_reason":"Unauthorized","tax_rate_percent":21,"tax_amount":10.29}]'::jsonb,
    '[{"payment_method_id":"82000000-0000-0000-0000-000000000002","amount":59.29}]'::jsonb
  )$$,
  '42501', 'discount requires sales.discount and an explicit reason',
  'Discount is rejected without explicit authorization permission'
);
reset role;
update erp.profile_permission_overrides
set valid_from = now() - interval '2 minutes', valid_until = now() - interval '1 minute'
where profile_id = 'a4000000-0000-0000-0000-000000000001'
  and permission_id = (select id from erp.permissions where code = 'sales.discount');
set local role authenticated;

select lives_ok(
  $$select erp.create_sale(
    '20000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001', 'ARS',
    (select id from erp.exchange_rate_snapshots where source = 'stage6-local'),
    'stage6-sale', 'Mixed partial sale',
    '[
      {"kind":"product","product_id":"a2000000-0000-0000-0000-000000000001","variant_id":"a3000000-0000-0000-0000-000000000001","from_location_id":"30000000-0000-0000-0000-000000000002","description":"Blue product","quantity":2,"unit_price":100,"discount_amount":10,"discount_reason":"Approved launch discount","tax_rate_percent":21,"tax_amount":39.9},
      {"kind":"service","product_id":"a2000000-0000-0000-0000-000000000002","description":"Setup service","quantity":1,"unit_price":50,"discount_amount":0,"tax_rate_percent":21,"tax_amount":10.5},
      {"kind":"free_concept","description":"Delivery","quantity":1,"unit_price":20,"discount_amount":0,"tax_rate_percent":0,"tax_amount":0}
    ]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('payment_method_id','82000000-0000-0000-0000-000000000001','cash_session_id',(select id from erp.cash_sessions where idempotency_key = 'stage6-cash-open'),'amount',100),
      jsonb_build_object('payment_method_id','82000000-0000-0000-0000-000000000002','amount',100)
    )
  )$$,
  'Sale, lines, split payments, stock, cash, receivable and audit commit atomically'
);

select is((select subtotal_amount from erp.sales where idempotency_key = 'stage6-sale'), 270::numeric, 'Sale subtotal is immutable');
select is((select discount_amount from erp.sales where idempotency_key = 'stage6-sale'), 10::numeric, 'Sale discount is immutable');
select is((select tax_amount from erp.sales where idempotency_key = 'stage6-sale'), 50.4::numeric, 'Sale tax is immutable');
select is((select total_amount from erp.sales where idempotency_key = 'stage6-sale'), 310.4::numeric, 'Sale total reconciles');
select is((select count(*) from erp.sale_lines where sale_id = (select id from erp.sales where idempotency_key = 'stage6-sale')), 3::bigint, 'Product, service and free concept persist');
select is((select count(*) from erp.sale_discount_authorizations where sale_id = (select id from erp.sales where idempotency_key = 'stage6-sale')), 1::bigint, 'Discount has explicit authorization');
select is((select count(*) from erp.payments where sale_id = (select id from erp.sales where idempotency_key = 'stage6-sale')), 2::bigint, 'Split payments persist independently');
select is((select sum(amount) from erp.payments where sale_id = (select id from erp.sales where idempotency_key = 'stage6-sale')), 200::numeric, 'Partial payment total is preserved');
select is((select count(*) from erp.customer_receivables where sale_id = (select id from erp.sales where idempotency_key = 'stage6-sale')), 1::bigint, 'Customer receivable is created');
select is((select sum(amount_base_delta) from erp.customer_account_entries where receivable_id = (select id from erp.customer_receivables where sale_id = (select id from erp.sales where idempotency_key = 'stage6-sale'))), 110.4::numeric, 'Customer account balance equals outstanding amount');
select is((select quantity_on_hand from erp.stock_balances where product_id = 'a2000000-0000-0000-0000-000000000001' and variant_id = 'a3000000-0000-0000-0000-000000000001' and location_id = '30000000-0000-0000-0000-000000000002'), 8::numeric, 'Sale consumes selected variant stock');
select is((select value_delta_base from erp.stock_cost_movements where document_id = (select stock_document_id from erp.sales where idempotency_key = 'stage6-sale')), -100::numeric, 'Sale posts COGS through checked cost wrapper');
select is((select sum(amount) from erp.cash_movements where cash_session_id = (select id from erp.cash_sessions where idempotency_key = 'stage6-cash-open')), 100::numeric, 'Cash payment reaches cash ledger');
select ok(exists(select 1 from erp.audit_events where table_name = 'sales' and metadata->>'redacted' = 'true'), 'Sale audit is redacted');
select is(
  erp.create_sale(
    '20000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001', 'ARS',
    (select id from erp.exchange_rate_snapshots where source = 'stage6-local'),
    'stage6-sale', 'Mixed partial sale',
    '[
      {"kind":"product","product_id":"a2000000-0000-0000-0000-000000000001","variant_id":"a3000000-0000-0000-0000-000000000001","from_location_id":"30000000-0000-0000-0000-000000000002","description":"Blue product","quantity":2,"unit_price":100,"discount_amount":10,"discount_reason":"Approved launch discount","tax_rate_percent":21,"tax_amount":39.9},
      {"kind":"service","product_id":"a2000000-0000-0000-0000-000000000002","description":"Setup service","quantity":1,"unit_price":50,"discount_amount":0,"tax_rate_percent":21,"tax_amount":10.5},
      {"kind":"free_concept","description":"Delivery","quantity":1,"unit_price":20,"discount_amount":0,"tax_rate_percent":0,"tax_amount":0}
    ]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('payment_method_id','82000000-0000-0000-0000-000000000001','cash_session_id',(select id from erp.cash_sessions where idempotency_key = 'stage6-cash-open'),'amount',100),
      jsonb_build_object('payment_method_id','82000000-0000-0000-0000-000000000002','amount',100)
    )
  ),
  (select id from erp.sales where idempotency_key = 'stage6-sale'),
  'Sale retry does not duplicate business facts'
);

select lives_ok(
  $$select erp.record_sale_payment(
    (select id from erp.sales where idempotency_key = 'stage6-sale'),
    '82000000-0000-0000-0000-000000000002', null, 110.4,
    'stage6-final-payment', 'Settle receivable', null
  )$$,
  'Outstanding balance can be paid later'
);
select is((select sum(amount) from erp.payments where sale_id = (select id from erp.sales where idempotency_key = 'stage6-sale')), 310.4::numeric, 'Partial payments settle to exact sale total');
select is((select sum(amount_base_delta) from erp.customer_account_entries where receivable_id = (select id from erp.customer_receivables where sale_id = (select id from erp.sales where idempotency_key = 'stage6-sale'))), 0::numeric, 'Customer account settles to zero');
select ok(exists(select 1 from erp.sale_state_events where sale_id = (select id from erp.sales where idempotency_key = 'stage6-sale') and payment_state = 'paid'), 'Payment state advances independently to paid');
select throws_ok(
  $$select erp.record_sale_payment(
    (select id from erp.sales where idempotency_key = 'stage6-sale'),
    '82000000-0000-0000-0000-000000000002', null, 1,
    'stage6-overpayment', 'Reject overpayment', null
  )$$,
  '23514', 'payment exceeds outstanding sale amount',
  'Overpayment rolls back'
);

select lives_ok(
  $$select erp.post_cash_movement(
    (select id from erp.cash_sessions where idempotency_key = 'stage6-cash-open'),
    'contribution', 'ARS', 20, 'stage6-contribution', 'Cash contribution'
  )$$,
  'Cash contribution persists'
);
select lives_ok(
  $$select erp.post_cash_movement(
    (select id from erp.cash_sessions where idempotency_key = 'stage6-cash-open'),
    'expense', 'ARS', 5, 'stage6-expense', 'Cash expense'
  )$$,
  'Cash expense persists with negative sign'
);
select throws_ok(
  $$select erp.post_cash_movement(
    (select id from erp.cash_sessions where idempotency_key = 'stage6-cash-open'),
    'contribution', 'USD', 1, 'stage6-unopened-usd', 'Reject unopened currency'
  )$$,
  '23503', null,
  'Manual cash movements reject currencies not opened by the session'
);
select lives_ok(
  $$select erp.capture_exchange_rate('USD', 1000, 'stage6-usd', '2026-08-19 12:30:00+00', 'stage6-fx-usd', 'Stage 6 USD rate')$$,
  'USD exchange snapshot is available for currency enforcement'
);
select throws_ok(
  $$select erp.create_sale(
    '20000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001', 'USD',
    (select id from erp.exchange_rate_snapshots where source = 'stage6-usd'),
    'stage6-usd-cash-sale', 'Reject cash in unopened USD',
    '[{"kind":"service","product_id":"a2000000-0000-0000-0000-000000000002","description":"USD service","quantity":1,"unit_price":1,"discount_amount":0,"tax_rate_percent":0,"tax_amount":0}]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'payment_method_id','82000000-0000-0000-0000-000000000001',
      'cash_session_id',(select id from erp.cash_sessions where idempotency_key = 'stage6-cash-open'),
      'amount',1
    ))
  )$$,
  '23503', 'payment currency is not open in its cash session',
  'Cash payments reject currencies not opened by the session'
);
select lives_ok(
  $$select erp.close_cash_session(
    (select id from erp.cash_sessions where idempotency_key = 'stage6-cash-open'),
    'stage6-cash-close', 'Count test cash',
    '[{"currency_code":"ARS","amount":116}]'::jsonb
  )$$,
  'Cash close stores expected and counted amounts'
);
select is((select expected_amount from erp.cash_close_counts where cash_closure_id = (select id from erp.cash_closures where idempotency_key = 'stage6-cash-close')), 115::numeric, 'Expected cash includes opening and signed movements');
select is((select counted_amount from erp.cash_close_counts where cash_closure_id = (select id from erp.cash_closures where idempotency_key = 'stage6-cash-close')), 116::numeric, 'Counted cash is immutable');
select is((select difference_amount from erp.cash_close_counts where cash_closure_id = (select id from erp.cash_closures where idempotency_key = 'stage6-cash-close')), 1::numeric, 'Cash difference reconciles exactly');
select throws_ok(
  $$select erp.post_cash_movement(
    (select id from erp.cash_sessions where idempotency_key = 'stage6-cash-open'),
    'withdrawal', 'ARS', 1, 'stage6-after-close', 'Late withdrawal'
  )$$,
  '55000', 'cash session is closed',
  'Closed sessions reject movements'
);
select lives_ok(
  $$select erp.open_cash_session(
    '84000000-0000-0000-0000-000000000001', 'stage6-refund-cash-open', 'Open refund cash',
    '[{"currency_code":"ARS","amount":0}]'::jsonb
  )$$,
  'A new cash session opens after the original closes'
);
select lives_ok(
  $$select erp.reverse_sale_payment(
    (select id from erp.payments
     where sale_id = (select id from erp.sales where idempotency_key = 'stage6-sale')
       and cash_session_id = (select id from erp.cash_sessions where idempotency_key = 'stage6-cash-open')
       and reversal_of_payment_id is null),
    'stage6-closed-session-refund', 'Refund after close',
    (select id from erp.cash_sessions where idempotency_key = 'stage6-refund-cash-open')
  )$$,
  'Cash payment reversal routes to a current open refund session'
);
select is(
  (select count(*) from erp.cash_movements
   where cash_session_id = (select id from erp.cash_sessions where idempotency_key = 'stage6-cash-open')
     and kind = 'refund'),
  0::bigint,
  'Closed cash session history is never mutated by a later refund'
);
select is(
  (select sum(amount) from erp.cash_movements
   where cash_session_id = (select id from erp.cash_sessions where idempotency_key = 'stage6-refund-cash-open')),
  (-100)::numeric,
  'Refund movement is posted in the open replacement session'
);

select lives_ok(
  $$select erp.create_web_order(
    '20000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001', 'ARS',
    (select id from erp.exchange_rate_snapshots where source = 'stage6-local'),
    'stage6-web-order', now() + interval '30 minutes',
    '[{"product_id":"a2000000-0000-0000-0000-000000000001","variant_id":"a3000000-0000-0000-0000-000000000001","location_id":"30000000-0000-0000-0000-000000000002","description":"Blue web product","quantity":1,"unit_price":100,"tax_rate_percent":21,"tax_amount":21}]'::jsonb
  )$$,
  'Web order and reservation commit atomically'
);
select is((select variant_id from erp.web_order_lines where web_order_id = (select id from erp.web_orders where idempotency_key = 'stage6-web-order')), 'a3000000-0000-0000-0000-000000000001'::uuid, 'Web line preserves selected variant');
select is((select variant_id from erp.stock_reservations where batch_id = (select reservation_batch_id from erp.web_orders where idempotency_key = 'stage6-web-order')), 'a3000000-0000-0000-0000-000000000001'::uuid, 'Reservation preserves selected variant');
select is((select quantity_reserved from erp.stock_balances where product_id = 'a2000000-0000-0000-0000-000000000001' and variant_id = 'a3000000-0000-0000-0000-000000000001' and location_id = '30000000-0000-0000-0000-000000000002'), 1::numeric, 'Web order reserves stock');

select lives_ok(
  $$select erp.create_web_order(
    '20000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001', 'ARS',
    (select id from erp.exchange_rate_snapshots where source = 'stage6-local'),
    'stage6-web-order-2', now() + interval '30 minutes',
    '[{"product_id":"a2000000-0000-0000-0000-000000000001","variant_id":"a3000000-0000-0000-0000-000000000001","location_id":"30000000-0000-0000-0000-000000000002","description":"Second web product","quantity":1,"unit_price":100,"tax_rate_percent":21,"tax_amount":21}]'::jsonb
  )$$,
  'A second web order obtains an independent reservation'
);
select throws_ok(
  $$select erp.create_sale(
    '20000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001', 'ARS',
    (select id from erp.exchange_rate_snapshots where source = 'stage6-local'),
    'stage6-duplicate-reservation-sale', 'Reject duplicate overconsumption',
    '[
      {"kind":"product","product_id":"a2000000-0000-0000-0000-000000000001","variant_id":"a3000000-0000-0000-0000-000000000001","from_location_id":"30000000-0000-0000-0000-000000000002","description":"Duplicate one","quantity":1,"unit_price":50,"discount_amount":0,"tax_rate_percent":0,"tax_amount":0},
      {"kind":"product","product_id":"a2000000-0000-0000-0000-000000000001","variant_id":"a3000000-0000-0000-0000-000000000001","from_location_id":"30000000-0000-0000-0000-000000000002","description":"Duplicate two","quantity":1,"unit_price":50,"discount_amount":0,"tax_rate_percent":0,"tax_amount":0}
    ]'::jsonb,
    '[]'::jsonb,
    (select reservation_batch_id from erp.web_orders where idempotency_key = 'stage6-web-order-2')
  )$$,
  '23514', 'sale product lines do not match the active reservation',
  'Grouped reservation matching prevents duplicate sale lines from overconsuming one reservation'
);
select throws_ok(
  $$select erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order'),
    'mercadopago', 'operator-forgery', 'operator-payment', 'approved',
    '82000000-0000-0000-0000-000000000003', 121,
    '2026-08-19 12:59:00+00', '{"forged":true}'::jsonb
  )$$,
  '42501', null,
  'Authenticated orders.manage operators cannot forge provider approval'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select lives_ok(
  $$select erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order'),
    'mercadopago', 'mp-approved-1', 'mp-payment-1', 'approved',
    '82000000-0000-0000-0000-000000000003', 121,
    '2026-08-19 13:00:00+00', '{"local_fixture":true}'::jsonb
  )$$,
  'Approved provider event is recorded locally'
);
select is(
  erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order'),
    'mercadopago', 'mp-approved-1', 'mp-payment-1', 'approved',
    '82000000-0000-0000-0000-000000000003', 121,
    '2026-08-19 13:00:00+00', '{"local_fixture":true}'::jsonb
  ),
  (select id from erp.web_payment_events where provider_event_id = 'mp-approved-1'),
  'Repeated provider event returns the same inbox fact'
);
select lives_ok(
  $$select erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order'),
    'mercadopago', 'mp-pending-old', 'mp-payment-1', 'pending', null, null,
    '2026-08-19 12:00:00+00', '{"local_fixture":true}'::jsonb
  )$$,
  'Out-of-order provider event remains visible'
);
select is((select applied from erp.web_payment_events where provider_event_id = 'mp-pending-old'), false, 'Out-of-order event does not regress business state');
select is((select count(*) from erp.web_order_events where web_order_id = (select id from erp.web_orders where idempotency_key = 'stage6-web-order') and payment_state = 'paid'), 1::bigint, 'Repeated and out-of-order events create one paid transition');
select is((select count(*) from erp.web_payment_events where web_order_id = (select id from erp.web_orders where idempotency_key = 'stage6-web-order')), 2::bigint, 'Inbox preserves both unique provider facts');
select throws_ok(
  $$select erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order-2'),
    'mercadopago', 'mp-cross-order', 'mp-payment-1', 'approved',
    '82000000-0000-0000-0000-000000000003', 121,
    '2026-08-19 13:01:00+00', '{"local_fixture":true}'::jsonb
  )$$,
  '23000', 'provider payment is already owned by another web order',
  'One provider payment cannot attach to a second web order'
);
select throws_ok(
  $$select erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order-2'),
    'mercadopago', 'mp-oversized', 'mp-payment-oversized', 'pending', null, null,
    '2026-08-19 13:01:00+00', jsonb_build_object('data', repeat('x', 1048577))
  )$$,
  '22023', 'complete finite provider event data is required',
  'Provider payloads larger than one MiB are rejected'
);
select lives_ok(
  $$select erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order-2'),
    'a:b', 'c', null, 'pending', null, null,
    '2026-08-19 13:01:10+00', '{"collision_fixture":1}'::jsonb
  )$$,
  'Structured provider keys accept the first delimiter-collision fixture'
);
select lives_ok(
  $$select erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order-2'),
    'a', 'b:c', null, 'rejected', null, null,
    '2026-08-19 13:01:20+00', '{"collision_fixture":2}'::jsonb
  )$$,
  'Structured provider keys keep distinct provider and event tuples independent'
);
select lives_ok(
  $$select erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order-2'),
    'mercadopago', 'mp-approved-2', 'mp-payment-2', 'approved',
    '82000000-0000-0000-0000-000000000003', 121,
    '2026-08-19 13:02:00+00', '{"local_fixture":true}'::jsonb
  )$$,
  'Second order provider approval is ingested by service role'
);
select lives_ok(
  $$select erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order-2'),
    'mercadopago', 'mp-refunded-2', 'mp-payment-2', 'refunded', null, 121,
    '2026-08-19 13:03:00+00', '{"local_fixture":true}'::jsonb
  )$$,
  'Unfulfilled provider refund applies atomically'
);
select is(
  (select status from erp.stock_reservation_batches where id = (select reservation_batch_id from erp.web_orders where idempotency_key = 'stage6-web-order-2')),
  'released'::erp.stock_reservation_status,
  'Applied unfulfilled refund releases its active reservation'
);
select is(
  (select order_state from erp.web_order_events
   where web_order_id = (select id from erp.web_orders where idempotency_key = 'stage6-web-order-2')
     and order_state is not null order by event_sequence desc limit 1),
  'refunded',
  'Applied provider refund makes the unfulfilled order terminal'
);

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select erp.fulfill_web_order(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order-2'),
    'stage6-refunded-fulfill', 'Reject refunded fulfillment'
  )$$,
  '55000', 'web order is not eligible for fulfillment',
  'Refunded terminal orders cannot be fulfilled'
);

select lives_ok(
  $$select erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order'),
    null, 'preparing', 'stage6-web-preparing', 'Prepare order'
  )$$,
  'Preparation state advances independently'
);
select is(
  erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order'),
    null, 'preparing', 'stage6-web-preparing', 'Prepare order'
  ),
  (select id from erp.web_order_events where idempotency_key = 'stage6-web-preparing'),
  'Manual web event retry returns the original event'
);
select throws_ok(
  $$select erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order'),
    null, 'preparing', 'stage6-web-preparing', 'Different retry payload'
  )$$,
  '23000', 'web order event idempotency key is already used by another request',
  'Manual web event retry rejects a changed request hash'
);
select lives_ok(
  $$select erp.fulfill_web_order(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order'),
    'stage6-web-fulfill', 'Dispatch paid web order'
  )$$,
  'Paid web order atomically creates sale and fulfills reservation'
);
select is((select variant_id from erp.sale_lines where sale_id = (select sale_id from erp.web_order_fulfillments where web_order_id = (select id from erp.web_orders where idempotency_key = 'stage6-web-order'))), 'a3000000-0000-0000-0000-000000000001'::uuid, 'Selected variant reaches persisted sale');
select is((select variant_id from erp.stock_document_lines where document_id = (select stock_document_id from erp.web_order_fulfillments where web_order_id = (select id from erp.web_orders where idempotency_key = 'stage6-web-order'))), 'a3000000-0000-0000-0000-000000000001'::uuid, 'Selected variant reaches fulfillment stock document');
select is((select status from erp.stock_reservation_batches where id = (select reservation_batch_id from erp.web_orders where idempotency_key = 'stage6-web-order')), 'fulfilled'::erp.stock_reservation_status, 'Reservation becomes fulfilled');
select is((select quantity_reserved from erp.stock_balances where product_id = 'a2000000-0000-0000-0000-000000000001' and variant_id = 'a3000000-0000-0000-0000-000000000001' and location_id = '30000000-0000-0000-0000-000000000002'), 0::numeric, 'Fulfillment releases reserved quantity');
select is((select quantity_on_hand from erp.stock_balances where product_id = 'a2000000-0000-0000-0000-000000000001' and variant_id = 'a3000000-0000-0000-0000-000000000001' and location_id = '30000000-0000-0000-0000-000000000002'), 7::numeric, 'Fulfillment consumes exactly one selected variant');
select is(
  erp.fulfill_web_order(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order'),
    'stage6-web-fulfill', 'Dispatch paid web order'
  ),
  (select sale_id from erp.web_order_fulfillments where web_order_id = (select id from erp.web_orders where idempotency_key = 'stage6-web-order')),
  'Fulfillment retry returns the same sale'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select lives_ok(
  $$select erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'stage6-web-order'),
    'mercadopago', 'mp-refunded-after-fulfillment', 'mp-payment-1', 'refunded', null, 121,
    '2026-08-19 14:00:00+00', '{"local_fixture":true}'::jsonb
  )$$,
  'Fulfilled-order provider refund remains durably visible'
);
select is((select applied from erp.web_payment_events where provider_event_id = 'mp-refunded-after-fulfillment'), false, 'Fulfilled-order refund is stored but unapplied');
select is(
  (select error_message from erp.web_payment_events where provider_event_id = 'mp-refunded-after-fulfillment'),
  'Refund recorded but unapplied: fulfilled orders require an atomic refund command',
  'Unapplied fulfilled refund explains the missing atomic compensation command'
);
select is(
  (select order_state from erp.web_order_events
   where web_order_id = (select id from erp.web_orders where idempotency_key = 'stage6-web-order')
     and order_state is not null order by event_sequence desc limit 1),
  'fulfilled',
  'Fulfilled-order refund does not regress business state'
);
select is((select quantity_on_hand from erp.stock_balances where product_id = 'a2000000-0000-0000-0000-000000000001' and variant_id = 'a3000000-0000-0000-0000-000000000001' and location_id = '30000000-0000-0000-0000-000000000002'), 7::numeric, 'Unapplied refund does not claim stock compensation');

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select erp.create_sale(
    '20000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001', 'ARS',
    (select id from erp.exchange_rate_snapshots where source = 'stage6-local'),
    'stage6-cancel-sale', 'Sale to cancel',
    '[{"kind":"product","product_id":"a2000000-0000-0000-0000-000000000001","variant_id":"a3000000-0000-0000-0000-000000000001","from_location_id":"30000000-0000-0000-0000-000000000002","description":"Cancellation product","quantity":1,"unit_price":100,"discount_amount":0,"tax_rate_percent":0,"tax_amount":0}]'::jsonb,
    '[{"payment_method_id":"82000000-0000-0000-0000-000000000002","amount":100}]'::jsonb
  )$$,
  'Cancellation fixture sale posts normally'
);
select lives_ok(
  $$select erp.cancel_sale(
    (select id from erp.sales where idempotency_key = 'stage6-cancel-sale'),
    'stage6-cancel-sale-undo', 'Customer cancellation'
  )$$,
  'Sale cancellation appends compensating stock, payment and account facts'
);
select ok(exists(select 1 from erp.sale_state_events where sale_id = (select id from erp.sales where idempotency_key = 'stage6-cancel-sale') and sale_state = 'cancelled'), 'Cancellation state is append-only');
select is((select sum(amount) from erp.payments where sale_id = (select id from erp.sales where idempotency_key = 'stage6-cancel-sale')), 0::numeric, 'Payment and reversal net to zero');
select is((select sum(amount_base_delta) from erp.customer_account_entries where receivable_id = (select id from erp.customer_receivables where sale_id = (select id from erp.sales where idempotency_key = 'stage6-cancel-sale'))), 0::numeric, 'Customer account cancellation nets to zero');
select is((select quantity_on_hand from erp.stock_balances where product_id = 'a2000000-0000-0000-0000-000000000001' and variant_id = 'a3000000-0000-0000-0000-000000000001' and location_id = '30000000-0000-0000-0000-000000000002'), 7::numeric, 'Stock reversal restores exact quantity');
select is((select count(*) from erp.stock_cost_movements where reversal_of_cost_movement_id is not null and document_id = (select id from erp.stock_documents where idempotency_key = 'stage6-cancel-sale-undo:stock')), 1::bigint, 'Cost reversal links to original COGS fact');

select lives_ok(
  $$select erp.record_integration_attempt(
    (select id from erp.integration_outbox where idempotency_key = 'stage6-web-fulfill:outbox'),
    'failed', 'Local test failure'
  )$$,
  'Failed outbox attempt remains visible'
);
select lives_ok(
  $$select erp.record_integration_attempt(
    (select id from erp.integration_outbox where idempotency_key = 'stage6-web-fulfill:outbox'),
    'succeeded', null
  )$$,
  'Successful retry appends a new attempt'
);
select is((select count(*) from erp.integration_attempts where outbox_id = (select id from erp.integration_outbox where idempotency_key = 'stage6-web-fulfill:outbox')), 2::bigint, 'Outbox history contains both attempts');
select is((select max(attempt_number) from erp.integration_attempts where outbox_id = (select id from erp.integration_outbox where idempotency_key = 'stage6-web-fulfill:outbox')), 2, 'Retry numbers increase monotonically');
select ok(exists(select 1 from erp.integration_attempts where status = 'failed' and error_message = 'Local test failure'), 'Integration error is query-visible');

reset role;
select throws_ok(
  $$update erp.payments set amount = 1 where id = (select id from erp.payments limit 1)$$,
  '23000', 'erp.payments facts are append-only',
  'Payment facts are immutable'
);
select throws_ok(
  $$update erp.cash_close_counts set counted_amount = 0$$,
  '23000', 'erp.cash_close_counts facts are append-only',
  'Counted close facts are immutable'
);
select throws_ok(
  $$insert into erp.payments (
    organization_id, branch_id, sale_id, payment_method_id, currency_code,
    amount, amount_base, idempotency_key, request_hash, reason
  ) select organization_id, branch_id, id, '82000000-0000-0000-0000-000000000002',
      currency_code, 'NaN'::numeric, 1, 'stage6-nan', 'x', 'Reject NaN'
    from erp.sales limit 1$$,
  '23514', null,
  'Payment facts reject NaN'
);
select ok(not exists(select 1 from erp.audit_events where table_name = 'sales' and new_values is not null), 'Operational financial audit does not copy sale amounts');

select * from finish();
rollback;
