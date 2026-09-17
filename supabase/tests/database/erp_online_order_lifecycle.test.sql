begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

select has_function(
  'erp', 'record_web_order_event',
  array['uuid', 'text', 'erp.sale_delivery_state', 'text', 'text'],
  'Online-order lifecycle command exists'
);
select has_function(
  'erp', 'fulfill_online_order',
  array['uuid', 'text', 'text', 'text'],
  'Online-order fulfillment command exists'
);
select has_function(
  'erp', 'refund_fulfilled_online_order',
  array['uuid', 'uuid', 'boolean', 'text', 'text', 'uuid'],
  'Online-order refund command exists'
);
select is(
  has_function_privilege('authenticated', 'erp.record_web_order_event(uuid,text,erp.sale_delivery_state,text,text)', 'EXECUTE'),
  true,
  'Authenticated operators can record lifecycle events'
);
select is(
  has_function_privilege('service_role', 'erp.record_web_order_event(uuid,text,erp.sale_delivery_state,text,text)', 'EXECUTE'),
  false,
  'Service role cannot bypass the operator lifecycle command'
);
select is(
  has_function_privilege('authenticated', 'erp.fulfill_online_order(uuid,text,text,text)', 'EXECUTE'),
  true,
  'Authenticated sellers can fulfill online orders'
);
select is(
  has_function_privilege('authenticated', 'erp.refund_fulfilled_online_order(uuid,uuid,boolean,text,text,uuid)', 'EXECUTE'),
  true,
  'Authenticated operators can request atomic online refunds'
);

insert into erp.customers (id, organization_id, code, display_name)
values (
  'e6100000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'LIFECYCLE-CUSTOMER', 'Lifecycle Customer'
);

insert into erp.products (
  id, organization_id, product_type_id, item_kind, unit_id,
  internal_code, internal_name, inventory_tracking, can_sell,
  publish_on_web, allow_online_sale
) values (
  'e6200000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001', 'product',
  '50000000-0000-0000-0000-000000000001',
  'LIFECYCLE-PRODUCT', 'Lifecycle Product', 'quantity', true, true, true
);

insert into erp.product_variants (id, organization_id, product_id, code, name, attributes)
values (
  'e6300000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'e6200000-0000-0000-0000-000000000001',
  'LIFECYCLE-RED', 'Lifecycle Red', '{"color":"red"}'::jsonb
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'e6400000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'lifecycle-test@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Lifecycle Test"}'::jsonb, now(), now()
);
update erp.profiles
set organization_id = '10000000-0000-0000-0000-000000000001'
where id = 'e6400000-0000-0000-0000-000000000001';
insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  'e6400000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'e6400000-0000-0000-0000-000000000001'
);

select set_config('request.jwt.claim.sub', 'e6400000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select erp.capture_exchange_rate('ARS', 1, 'lifecycle-local', '2026-09-07 12:00:00+00', 'lifecycle-fx', 'Lifecycle base rate')$$,
  'Lifecycle fixture has a deterministic exchange rate'
);
select lives_ok(
  $$select erp.post_stock_document(
    'opening', '20000000-0000-0000-0000-000000000001',
    'lifecycle-stock-open', 'Lifecycle opening stock',
    '[{"product_id":"e6200000-0000-0000-0000-000000000001","variant_id":"e6300000-0000-0000-0000-000000000001","to_location_id":"30000000-0000-0000-0000-000000000002","quantity":3,"unit_cost":50}]'::jsonb
  )$$,
  'Lifecycle fixture has reservable stock'
);
select lives_ok(
  $$select erp.bootstrap_chart_of_accounts()$$,
  'Lifecycle fixture has accounting defaults'
);
select lives_ok(
  $$select erp.create_web_order(
    '20000000-0000-0000-0000-000000000001',
    'e6100000-0000-0000-0000-000000000001', 'ARS',
    (select id from erp.exchange_rate_snapshots where source = 'lifecycle-local'),
    'lifecycle-web-order', now() + interval '30 minutes',
    '[{"product_id":"e6200000-0000-0000-0000-000000000001","variant_id":"e6300000-0000-0000-0000-000000000001","location_id":"30000000-0000-0000-0000-000000000002","description":"Lifecycle web product","quantity":2,"unit_price":100,"tax_rate_percent":21,"tax_amount":42}]'::jsonb
  )$$,
  'Lifecycle web order and reservation commit atomically'
);

select throws_ok(
  $$select erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order'),
    null, 'ready', 'lifecycle-ready-before-preparing', 'Skip preparation'
  )$$,
  '55000', 'illegal web delivery state transition',
  'An order cannot become ready before preparation'
);
select lives_ok(
  $$select erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order'),
    null, 'preparing', 'lifecycle-preparing', 'Prepare lifecycle order'
  )$$,
  'Order reaches preparing'
);
select is(
  erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order'),
    null, 'preparing', 'lifecycle-preparing', 'Prepare lifecycle order'
  ),
  (select id from erp.web_order_events where idempotency_key = 'lifecycle-preparing'),
  'Repeating the same lifecycle operation is idempotent'
);
select throws_ok(
  $$select erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order'),
    null, 'preparing', 'lifecycle-preparing', 'Different reason'
  )$$,
  '23000', 'web order event idempotency key is already used by another request',
  'Reusing a lifecycle key with different data is rejected'
);
select lives_ok(
  $$select erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order'),
    null, 'ready', 'lifecycle-ready', 'Lifecycle order ready for dispatch'
  )$$,
  'Order reaches ready before fulfillment'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select lives_ok(
  $$select erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order'),
    'mercadopago', 'mp-lifecycle-ev1', 'mp-lifecycle-pay1', 'approved',
    '82000000-0000-0000-0000-000000000003', 242,
    '2026-09-07 13:00:00+00', '{"local_fixture":true}'::jsonb
  )$$,
  'Full provider approval is recorded for the lifecycle fixture'
);

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select lives_ok(
  $$select erp.fulfill_online_order(
    (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order'),
    'mp-lifecycle-pay1', 'lifecycle-fulfill', 'Dispatch lifecycle order'
  )$$,
  'Fulfillment is allowed only once the order is ready'
);
select is(
  (select order_state from erp.web_order_events
   where web_order_id = (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order')
     and order_state is not null order by event_sequence desc limit 1),
  'fulfilled',
  'Fulfillment records the fulfilled order state'
);
select is(
  (select delivery_state from erp.web_order_events
   where web_order_id = (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order')
     and delivery_state is not null order by event_sequence desc limit 1),
  'dispatched',
  'Fulfillment records the dispatched delivery state'
);
select ok(
  exists(
    select 1 from erp.integration_outbox
    where aggregate_type = 'web_order'
      and aggregate_id = (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order')
      and event_type = 'web_order.delivery.dispatched'
      and idempotency_key = 'lifecycle-fulfill:fulfill:delivery-outbox'
  ),
  'Fulfillment emits an idempotent dispatched outbox event'
);
select lives_ok(
  $$select erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order'),
    null, 'delivered', 'lifecycle-delivered', 'Lifecycle order delivered'
  )$$,
  'A dispatched fulfilled order can become delivered'
);
select is(
  (select delivery_state from erp.web_order_events
   where web_order_id = (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order')
     and delivery_state is not null order by event_sequence desc limit 1),
  'delivered',
  'Delivery state is persisted as delivered'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select lives_ok(
  $$select erp.record_web_payment_event(
    (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order'),
    'mercadopago', 'mp-lifecycle-refund-ev1', 'mp-lifecycle-pay1', 'refunded', null, 242,
    '2026-09-07 14:00:00+00', '{"local_fixture":true}'::jsonb
  )$$,
  'Provider refund is recorded as unapplied evidence'
);
select set_config(
  'test.lifecycle_refund_event_id',
  (select id::text from erp.web_payment_events where provider_event_id = 'mp-lifecycle-refund-ev1'),
  true
);

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select erp.refund_fulfilled_online_order(
    (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order'),
    current_setting('test.lifecycle_refund_event_id')::uuid,
    false, 'lifecycle-refund-no-return', 'Missing physical return', null
  )$$,
  '22023', 'physical return confirmation, operation key and reason are required',
  'Refund requires explicit physical return confirmation'
);
select lives_ok(
  $$select erp.refund_fulfilled_online_order(
    (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order'),
    current_setting('test.lifecycle_refund_event_id')::uuid,
    true, 'lifecycle-refund', 'Lifecycle physical return confirmed', null
  )$$,
  'Delivered order refund is atomic'
);
select is(
  (select delivery_state from erp.web_order_events
   where web_order_id = (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order')
     and delivery_state is not null order by event_sequence desc limit 1),
  'returned',
  'Atomic refund records the returned delivery state'
);
select is(
  (select order_state from erp.web_order_events
   where web_order_id = (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order')
     and order_state is not null order by event_sequence desc limit 1),
  'refunded',
  'Atomic refund records the refunded order state'
);
select ok(
  exists(
    select 1 from erp.integration_outbox
    where aggregate_type = 'web_order'
      and aggregate_id = (select id from erp.web_orders where idempotency_key = 'lifecycle-web-order')
      and event_type = 'web_order.delivery.returned'
      and idempotency_key = 'lifecycle-refund:delivery-outbox'
  ),
  'Atomic refund emits an idempotent returned outbox event'
);

select lives_ok(
  $$select erp.create_web_order(
    '20000000-0000-0000-0000-000000000001',
    'e6100000-0000-0000-0000-000000000001', 'ARS',
    (select id from erp.exchange_rate_snapshots where source = 'lifecycle-local'),
    'lifecycle-unpaid-order', now() + interval '30 minutes',
    '[{"product_id":"e6200000-0000-0000-0000-000000000001","variant_id":"e6300000-0000-0000-0000-000000000001","location_id":"30000000-0000-0000-0000-000000000002","description":"Unpaid lifecycle product","quantity":1,"unit_price":100,"tax_rate_percent":21,"tax_amount":21}]'::jsonb
  )$$,
  'Unpaid lifecycle order is created for cancellation coverage'
);
select lives_ok(
  $$select erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'lifecycle-unpaid-order'),
    'cancelled', null, 'lifecycle-cancel', 'Customer cancelled unpaid order'
  )$$,
  'Unpaid placed order can be cancelled'
);
select is(
  (select order_state from erp.web_order_events
   where web_order_id = (select id from erp.web_orders where idempotency_key = 'lifecycle-unpaid-order')
     and order_state is not null order by event_sequence desc limit 1),
  'cancelled',
  'Cancellation records the cancelled order state'
);
select throws_ok(
  $$select erp.record_web_order_event(
    (select id from erp.web_orders where idempotency_key = 'lifecycle-unpaid-order'),
    null, 'preparing', 'lifecycle-after-cancel', 'Cannot prepare cancelled order'
  )$$,
  '55000', 'illegal web delivery state transition',
  'Cancelled orders cannot re-enter preparation'
);

select * from finish();
rollback;
