begin;

create extension if not exists pgtap with schema extensions;

select plan(40);

select has_function(
  'erp', 'fulfill_online_order',
  array['uuid','text','text','text'],
  'Online fulfillment command exists'
);
select function_returns(
  'erp', 'fulfill_online_order',
  array['uuid','text','text','text'],
  'jsonb',
  'Online fulfillment returns sale, stock document and journal ids'
);
select is(
  has_function_privilege('authenticated', 'erp.fulfill_online_order(uuid,text,text,text)', 'EXECUTE'),
  true,
  'Authenticated sellers invoke the online fulfillment command'
);
select is(
  has_function_privilege('service_role', 'erp.fulfill_online_order(uuid,text,text,text)', 'EXECUTE'),
  false,
  'Service role cannot invoke the online fulfillment command'
);

insert into erp.customers (id, organization_id, code, display_name)
values (
  'b1000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'FULFILL-CUSTOMER', 'Fulfill Customer'
);

insert into erp.products (
  id, organization_id, product_type_id, item_kind, unit_id,
  internal_code, internal_name, inventory_tracking, can_sell,
  publish_on_web, allow_online_sale
) values (
  'b2000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001', 'product',
  '50000000-0000-0000-0000-000000000001',
  'FULFILL-PRODUCT', 'Fulfill Product', 'quantity', true, true, true
);

insert into erp.product_variants (
  id, organization_id, product_id, code, name, attributes
) values (
  'b3000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001',
  'RED', 'Red', '{"color":"red"}'::jsonb
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'b4000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'fulfill-test@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Fulfill Test"}'::jsonb, now(), now()
);
update erp.profiles set organization_id = '10000000-0000-0000-0000-000000000001'
where id = 'b4000000-0000-0000-0000-000000000001';
insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  'b4000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'b4000000-0000-0000-0000-000000000001'
);

select set_config('request.jwt.claim.sub', 'b4000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select erp.capture_exchange_rate('ARS', 1, 'fulfill-local', '2026-09-07 12:00:00+00', 'fulfill-fx', 'Fulfill base rate')$$,
  'Base exchange snapshot can be prepared locally'
);
select lives_ok(
  $$select erp.post_stock_document(
    'opening', '20000000-0000-0000-0000-000000000001',
    'fulfill-stock-open', 'Fulfill opening stock',
    '[{"product_id":"b2000000-0000-0000-0000-000000000001","variant_id":"b3000000-0000-0000-0000-000000000001","to_location_id":"30000000-0000-0000-0000-000000000002","quantity":3,"unit_cost":50}]'::jsonb
  )$$,
  'Fulfillment stock is opened atomically'
);
select lives_ok(
  $$select erp.bootstrap_chart_of_accounts()$$,
  'Chart of accounts exposes receivable and sales income roles'
);
select lives_ok(
  $$select erp.create_web_order(
    '20000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001', 'ARS',
    (select id from erp.exchange_rate_snapshots where source = 'fulfill-local'),
    'fulfill-web-order', now() + interval '30 minutes',
    '[{"product_id":"b2000000-0000-0000-0000-000000000001","variant_id":"b3000000-0000-0000-0000-000000000001","location_id":"30000000-0000-0000-0000-000000000002","description":"Red web product","quantity":2,"unit_price":100,"tax_rate_percent":21,"tax_amount":42}]'::jsonb
  )$$,
  'Fulfillment web order and reservation commit atomically'
);
select lives_ok(
  $$select erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'),
    null, 'preparing', 'fulfill-preparing', 'Prepare order'
  )$$,
  'Fulfillment order reaches preparing delivery state'
);
select lives_ok(
  $$select erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'),
    null, 'ready', 'fulfill-ready', 'Order is ready for dispatch'
  )$$,
  'Fulfillment order reaches ready delivery state'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select lives_ok(
  $$select erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'),
    'mercadopago', 'mp-fulfill-ev1', 'mp-fulfill-pay1', 'approved',
    '82000000-0000-0000-0000-000000000003', 242,
    '2026-09-07 13:00:00+00', '{"local_fixture":true}'::jsonb
  )$$,
  'Full-amount provider approval is recorded'
);

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select throws_ok(
  $$select erp.fulfill_online_order(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'),
    'mp-other-pay', 'fulfill-wrong-ref', 'Mismatched reference'
  )$$,
  '55000', 'payment reference does not match the approved provider payment',
  'Fulfillment with a mismatched payment reference is rejected'
);
select lives_ok(
  $$select erp.fulfill_online_order(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'),
    'mp-fulfill-pay1', 'fulfill-k1', 'Dispatch paid online order'
  )$$,
  'Paid online order fulfills sale, stock and journal atomically'
);
select ok((
  select (r ? 'sale_id') and (r ? 'stock_document_id') and (r ? 'journal_entry_id')
    and (r->>'sale_id') <> 'null' and (r->>'stock_document_id') <> 'null' and (r->>'journal_entry_id') <> 'null'
  from (select erp.fulfill_online_order(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'),
    'mp-fulfill-pay1', 'fulfill-k1', 'Dispatch paid online order'
  ) as r) t
), 'Fulfillment payload carries sale, stock document and journal ids');
select is((
  select r->>'sale_id'
  from (select erp.fulfill_online_order(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'),
    'mp-fulfill-pay1', 'fulfill-k1b', 'Retry paid online order'
  ) as r) t
), (
  select sale_id::text from erp.web_order_fulfillments
  where web_order_id = (select id from erp.web_orders where idempotency_key = 'fulfill-web-order')
), 'Fulfillment retry returns the existing sale');
select ok(exists(
  select 1 from erp.accounting_source_events
  where source_type = 'online_order'
    and source_id = (select id from erp.web_orders where idempotency_key = 'fulfill-web-order')
    and posting_kind = 'primary'
), 'Online sale posts its journal source event');
select is((
  select total_debit = total_credit and total_debit = 242::numeric
  from erp.journal_entries
  where source_type = 'online_order'
    and source_id = (select id from erp.web_orders where idempotency_key = 'fulfill-web-order')
), true, 'Online sale journal balances Debe=Haber for the real total');
select is((
  select order_state from erp.web_order_events
  where web_order_id = (select id from erp.web_orders where idempotency_key = 'fulfill-web-order')
    and order_state is not null order by event_sequence desc limit 1
), 'fulfilled', 'Fulfilled state is recorded on the order timeline');
select lives_ok(
  $$select erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'),
    null, 'delivered', 'fulfill-delivered', 'Order delivered before physical return'
  )$$,
  'Fulfillment order reaches delivered delivery state'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select lives_ok(
  $$select erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'),
    'mercadopago', 'mp-fulfill-refund-ev1', 'mp-fulfill-pay1', 'refunded', null, 242,
    '2026-09-07 14:00:00+00', '{"local_fixture":true}'::jsonb
  )$$,
  'Provider full refund for the fulfilled order is recorded unapplied'
);
select set_config(
  'test.fulfill_refund_event_id',
  (select id::text from erp.web_payment_events where provider_event_id = 'mp-fulfill-refund-ev1'),
  true
);

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select erp.refund_fulfilled_online_order(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'),
    current_setting('test.fulfill_refund_event_id')::uuid,
    false, 'fulfill-refund-no-return', 'Missing physical return', null
  )$$,
  '22023', 'physical return confirmation, operation key and reason are required',
  'Fulfilled order cannot be refunded without explicit physical return confirmation'
);
select lives_ok(
  $$select erp.refund_fulfilled_online_order(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'),
    current_setting('test.fulfill_refund_event_id')::uuid,
    true, 'fulfill-refund-k1', 'Physical return confirmed and provider refund received', null
  )$$,
  'Fulfilled online order refund compensates sale, stock, payment and journal atomically'
);
select is(
  (select applied from erp.web_payment_events where id = current_setting('test.fulfill_refund_event_id')::uuid),
  true,
  'Atomic refund marks the provider event as applied'
);
select is(
  (select count(*) from erp.online_order_refunds
   where web_order_id = (select id from erp.web_orders where idempotency_key = 'fulfill-web-order')),
  1::bigint,
  'Atomic refund persists exactly one immutable receipt'
);
select is((
  select order_state from erp.web_order_events
  where web_order_id = (select id from erp.web_orders where idempotency_key = 'fulfill-web-order')
    and order_state is not null order by event_sequence desc limit 1
), 'refunded', 'Atomic refund advances the order state to refunded');
select is((
  select payment_state from erp.web_order_events
  where web_order_id = (select id from erp.web_orders where idempotency_key = 'fulfill-web-order')
    and payment_state is not null order by event_sequence desc limit 1
), 'refunded', 'Atomic refund advances the payment state to refunded');
select is((
  select delivery_state from erp.web_order_events
  where web_order_id = (select id from erp.web_orders where idempotency_key = 'fulfill-web-order')
    and delivery_state is not null order by event_sequence desc limit 1
), 'returned', 'Atomic refund records the physical return');
select is(
  (select sum(amount) from erp.payments
   where sale_id = (select sale_id from erp.web_order_fulfillments
                    where web_order_id = (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'))),
  0::numeric,
  'Original online payment and its reversal net to zero'
);
select ok(
  exists(
    select 1 from erp.sale_state_events
    where sale_id = (select sale_id from erp.web_order_fulfillments
                     where web_order_id = (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'))
      and sale_state = 'cancelled'
  ),
  'Fulfilled sale is cancelled by an append-only state event'
);
select is(
  (select quantity_on_hand from erp.stock_balances
   where product_id = 'b2000000-0000-0000-0000-000000000001'
     and variant_id = 'b3000000-0000-0000-0000-000000000001'
     and location_id = '30000000-0000-0000-0000-000000000002'),
  3::numeric,
  'Atomic refund restores the exact fulfilled stock quantity'
);
select ok(
  exists(
    select 1
    from erp.online_order_refunds receipt
    join erp.journal_entries original on original.id = receipt.original_journal_entry_id
    where receipt.web_order_id = (select id from erp.web_orders where idempotency_key = 'fulfill-web-order')
      and original.status = 'reversed'
      and original.reversal_of_entry_id = receipt.journal_reversal_entry_id
  ),
  'Atomic refund links the balanced journal reversal to its original entry'
);
select ok(
  exists(
    select 1 from erp.integration_outbox
    where aggregate_type = 'web_order'
      and aggregate_id = (select id from erp.web_orders where idempotency_key = 'fulfill-web-order')
      and event_type = 'web_order.refunded'
      and idempotency_key = 'fulfill-refund-k1:outbox'
  ),
  'Atomic refund emits one idempotent integration event'
);
select is(
  (
    erp.refund_fulfilled_online_order(
      (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'),
      current_setting('test.fulfill_refund_event_id')::uuid,
      true, 'fulfill-refund-k1', 'Physical return confirmed and provider refund received', null
    )->>'refund_id'
  )::uuid,
  (select id from erp.online_order_refunds
   where web_order_id = (select id from erp.web_orders where idempotency_key = 'fulfill-web-order')),
  'Exact retry returns the original refund receipt without duplicating facts'
);

select throws_ok(
  $$select erp.fulfill_online_order(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order'),
    '', 'fulfill-no-ref', 'Missing payment reference'
  )$$,
  '22023', 'payment reference is required',
  'Fulfillment without payment reference is rejected'
);
select throws_ok(
  $$select erp.fulfill_online_order(
    'c0000000-0000-0000-0000-000000000001',
    'mp-fulfill-pay1', 'fulfill-missing', 'Missing order'
  )$$,
  'P0002', 'online order not found',
  'Fulfillment of an unknown order is rejected'
);

select lives_ok(
  $$select erp.create_web_order(
    '20000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001', 'ARS',
    (select id from erp.exchange_rate_snapshots where source = 'fulfill-local'),
    'fulfill-web-order-unpaid', now() + interval '30 minutes',
    '[{"product_id":"b2000000-0000-0000-0000-000000000001","variant_id":"b3000000-0000-0000-0000-000000000001","location_id":"30000000-0000-0000-0000-000000000002","description":"Unpaid web product","quantity":1,"unit_price":100,"tax_rate_percent":21,"tax_amount":21}]'::jsonb
  )$$,
  'Unpaid web order and reservation commit atomically'
);
select lives_ok(
  $$select erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order-unpaid'),
    null, 'preparing', 'fulfill-preparing-unpaid', 'Prepare unpaid order'
  )$$,
  'Unpaid order reaches preparing delivery state'
);
select throws_ok(
  $$select erp.fulfill_online_order(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order-unpaid'),
    'mp-unpaid-pay', 'fulfill-unpaid', 'Unapproved fulfillment'
  )$$,
  '55000', 'fully approved web payment is required',
  'Fulfillment without an approved payment is rejected'
);
select throws_ok(
  $$select erp.create_web_order(
    '20000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001', 'ARS',
    (select id from erp.exchange_rate_snapshots where source = 'fulfill-local'),
    'fulfill-web-order-nostock', now() + interval '30 minutes',
    '[{"product_id":"b2000000-0000-0000-0000-000000000001","variant_id":"b3000000-0000-0000-0000-000000000001","location_id":"30000000-0000-0000-0000-000000000002","description":"Overstock web product","quantity":999,"unit_price":100,"tax_rate_percent":21,"tax_amount":20979}]'::jsonb
  )$$,
  '23514', 'insufficient stock for reservation',
  'Web orders without available stock are rejected'
);

reset role;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'c4000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'fulfill-noperm@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Fulfill NoPerm"}'::jsonb, now(), now()
);
update erp.profiles set organization_id = '10000000-0000-0000-0000-000000000001'
where id = 'c4000000-0000-0000-0000-000000000001';
insert into erp.profile_permission_overrides (
  organization_id, profile_id, permission_id, branch_id, effect, reason, created_by
) values (
  '10000000-0000-0000-0000-000000000001',
  'c4000000-0000-0000-0000-000000000001',
  (select id from erp.permissions where code = 'orders.view'),
  '20000000-0000-0000-0000-000000000001', 'allow',
  'Fulfill test: row visibility without manage permission',
  'b4000000-0000-0000-0000-000000000001'
);
select set_config('request.jwt.claim.sub', 'c4000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select erp.fulfill_online_order(
    (select id from erp.web_orders where idempotency_key = 'fulfill-web-order-unpaid'),
    'mp-unpaid-pay', 'fulfill-noperm', 'Unauthorized fulfillment'
  )$$,
  '42501', 'orders.manage permission is required',
  'Fulfillment without orders.manage is rejected'
);
reset role;

select * from finish();
rollback;
