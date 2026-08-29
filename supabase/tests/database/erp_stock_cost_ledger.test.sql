begin;

create extension if not exists pgtap with schema extensions;

select plan(67);

select has_table('erp', 'stock_cost_movements', 'Stock cost movement ledger exists');
select has_column('erp', 'stock_cost_movements', 'source_stock_movement_id', 'Cost facts link to physical movements');
select has_column('erp', 'stock_cost_movements', 'value_delta_base', 'Cost facts preserve signed value');
select has_column('erp', 'stock_cost_movements', 'unit_cost_snapshot', 'Cost facts preserve their unit-cost snapshot');
select has_column('erp', 'stock_cost_movements', 'reversal_of_cost_movement_id', 'Cost reversals link to original facts');
select has_column('erp', 'stock_cost_movements', 'purchase_cost_entry_id', 'Purchase costs carry a controlled bridge marker');
select has_function('erp', 'process_stock_document_costs', array['uuid'], 'Private cost processor exists');
select has_function(
  'erp', 'post_stock_document_stage4_core',
  array['erp.stock_document_kind','uuid','text','text','jsonb','boolean','text','uuid'],
  'Stage 4 stock wrapper is retained as a private core'
);
select has_function('erp', 'fulfill_stock_reservation_core', array['uuid','text','text'], 'Reservation fulfillment core exists');
select has_function('erp', 'fulfill_stock_reservation', array['uuid','text','text'], 'Cost-integrated fulfillment wrapper exists');
select ok((select relrowsecurity from pg_class where oid = 'erp.stock_cost_movements'::regclass), 'Cost movements enforce RLS');
select is(has_table_privilege('authenticated', 'erp.stock_cost_movements', 'INSERT'), false, 'Authenticated clients cannot insert costs');
select is(has_table_privilege('authenticated', 'erp.stock_cost_movements', 'UPDATE'), false, 'Authenticated clients cannot update costs');
select is(has_table_privilege('service_role', 'erp.stock_cost_movements', 'SELECT'), true, 'Service role has read-only cost access');
select is(has_table_privilege('service_role', 'erp.stock_cost_movements', 'INSERT'), false, 'Service role cannot insert costs');
select is(has_table_privilege('service_role', 'erp.stock_cost_movements', 'UPDATE'), false, 'Service role cannot update costs');
select is(has_function_privilege('authenticated', 'erp.process_stock_document_costs(uuid)', 'EXECUTE'), false, 'Cost processor is private');
select is(has_function_privilege('service_role', 'erp.post_stock_document_stage4_core(erp.stock_document_kind,uuid,text,text,jsonb,boolean,text,uuid)', 'EXECUTE'), false, 'Stage 4 stock core is private');
select is(has_function_privilege('authenticated', 'erp.fulfill_stock_reservation_core(uuid,text,text)', 'EXECUTE'), false, 'Fulfillment core is private');
select is(has_function_privilege('authenticated', 'erp.fulfill_stock_reservation(uuid,text,text)', 'EXECUTE'), true, 'Authenticated actors use the checked fulfillment wrapper');

insert into erp.products (
  id, organization_id, product_type_id, item_kind, unit_id,
  internal_code, internal_name, inventory_tracking
) values
  ('95000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','product','50000000-0000-0000-0000-000000000001','STAGE5-WAC','Stage 5 WAC','quantity'),
  ('95000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','product','50000000-0000-0000-0000-000000000001','STAGE5-REV','Stage 5 reversal','quantity'),
  ('95000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','product','50000000-0000-0000-0000-000000000001','STAGE5-DIV','Stage 5 divergence','quantity'),
  ('95000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002','product','50000000-0000-0000-0000-000000000001','STAGE5-SERIAL','Stage 5 serial','serial'),
  ('95000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','product','50000000-0000-0000-0000-000000000001','STAGE5-PURCHASE','Stage 5 purchase','quantity');

insert into erp.suppliers (
  id, organization_id, code, display_name, default_currency, payment_terms_days
) values (
  '97000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'STAGE5-SUPPLIER', 'Stage 5 supplier', 'ARS', 0
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '96000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'stage5-test@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Stage 5 Test"}'::jsonb, now(), now()
);
update erp.profiles set organization_id = '10000000-0000-0000-0000-000000000001'
where id = '96000000-0000-0000-0000-000000000001';
insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001'
);

select set_config('request.jwt.claim.sub', '96000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select erp.post_stock_document(
    'sale','20000000-0000-0000-0000-000000000001','stage5-spoofed-receipt','Spoofed source marker',
    '[{"product_id":"95000000-0000-0000-0000-000000000001","from_location_id":"30000000-0000-0000-0000-000000000002","quantity":1}]'::jsonb,
    false,'purchase_receipt','98000000-0000-0000-0000-000000000099'
  )$$,
  '22023','purchase_receipt is reserved for receipt documents',
  'Purchase-receipt source markers cannot bypass valuation on other document kinds'
);

reset role;
insert into erp.profile_permission_overrides (
  organization_id, profile_id, permission_id, branch_id, effect, reason, created_by
) values (
  '10000000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001',
  (select id from erp.permissions where code = 'costs.manage'),
  '20000000-0000-0000-0000-000000000001', 'deny',
  'Stage 5 inbound valuation permission test',
  '96000000-0000-0000-0000-000000000001'
);
set local role authenticated;
select throws_ok(
  $$select erp.post_stock_document(
    'opening','20000000-0000-0000-0000-000000000001','stage5-no-cost-permission','Unauthorized opening value',
    '[{"product_id":"95000000-0000-0000-0000-000000000001","to_location_id":"30000000-0000-0000-0000-000000000002","quantity":1,"unit_cost":10}]'::jsonb
  )$$,
  '42501','costs.manage permission is required for inbound stock valuation',
  'Inbound stock valuation requires costs.manage'
);
reset role;
update erp.profile_permission_overrides
set valid_from = now() - interval '2 minutes',
    valid_until = now() - interval '1 minute'
where profile_id = '96000000-0000-0000-0000-000000000001'
  and permission_id = (select id from erp.permissions where code = 'costs.manage');
set local role authenticated;

select lives_ok(
  $$select erp.post_stock_document(
    'opening','20000000-0000-0000-0000-000000000001','stage5-wac-open','Opening value',
    '[{"product_id":"95000000-0000-0000-0000-000000000001","to_location_id":"30000000-0000-0000-0000-000000000002","quantity":10,"unit_cost":10}]'::jsonb
  )$$,
  'Opening posts stock and cost atomically'
);
select is((select valued_quantity from erp.inventory_cost_balances where product_id = '95000000-0000-0000-0000-000000000001'), 10::numeric, 'Opening establishes valued quantity');
select is((select total_cost_base from erp.inventory_cost_balances where product_id = '95000000-0000-0000-0000-000000000001'), 100::numeric, 'Opening establishes total value');
select is((select count(*) from erp.stock_cost_movements where product_id = '95000000-0000-0000-0000-000000000001'), 1::bigint, 'Opening creates one cost fact');

select lives_ok(
  $$select erp.post_stock_document(
    'sale','20000000-0000-0000-0000-000000000001','stage5-wac-sale','WAC sale',
    '[{"product_id":"95000000-0000-0000-0000-000000000001","from_location_id":"30000000-0000-0000-0000-000000000002","quantity":2}]'::jsonb,
    false,'test_sale','98000000-0000-0000-0000-000000000001'
  )$$,
  'Sale consumes locked WAC atomically'
);
select is((select valued_quantity from erp.inventory_cost_balances where product_id = '95000000-0000-0000-0000-000000000001'), 8::numeric, 'Sale decrements valued quantity');
select is((select total_cost_base from erp.inventory_cost_balances where product_id = '95000000-0000-0000-0000-000000000001'), 80::numeric, 'Sale decrements WAC value');
select is((select value_delta_base from erp.stock_cost_movements where document_id = (select id from erp.stock_documents where idempotency_key = 'stage5-wac-sale')), -20::numeric, 'Sale records signed COGS');

select lives_ok(
  $$select erp.post_stock_document(
    'transfer','20000000-0000-0000-0000-000000000001','stage5-wac-transfer','Internal transfer',
    '[{"product_id":"95000000-0000-0000-0000-000000000001","from_location_id":"30000000-0000-0000-0000-000000000002","to_location_id":"30000000-0000-0000-0000-000000000001","quantity":3}]'::jsonb
  )$$,
  'Same-branch transfer posts two cost movements'
);
select is((select total_cost_base from erp.inventory_cost_balances where product_id = '95000000-0000-0000-0000-000000000001'), 80::numeric, 'Transfer is branch-value neutral');
select is((select sum(value_delta_base) from erp.stock_cost_movements where document_id = (select id from erp.stock_documents where idempotency_key = 'stage5-wac-transfer')), 0::numeric, 'Transfer cost values offset exactly');
select is((select count(*) from erp.stock_cost_movements where document_id = (select id from erp.stock_documents where idempotency_key = 'stage5-wac-transfer')), 2::bigint, 'Transfer values every physical movement once');

select lives_ok(
  $$select erp.post_stock_document(
    'adjustment','20000000-0000-0000-0000-000000000001','stage5-adjust-in','Positive adjustment',
    '[{"product_id":"95000000-0000-0000-0000-000000000001","to_location_id":"30000000-0000-0000-0000-000000000002","quantity":2,"unit_cost":15}]'::jsonb
  )$$,
  'Inbound adjustment uses trusted unit cost'
);
select lives_ok(
  $$select erp.post_stock_document(
    'adjustment','20000000-0000-0000-0000-000000000001','stage5-adjust-out','Negative adjustment',
    '[{"product_id":"95000000-0000-0000-0000-000000000001","from_location_id":"30000000-0000-0000-0000-000000000002","quantity":1}]'::jsonb
  )$$,
  'Outbound adjustment consumes current WAC'
);
select is((select valued_quantity from erp.inventory_cost_balances where product_id = '95000000-0000-0000-0000-000000000001'), 9::numeric, 'Adjustments reconcile valued quantity');
select is((select total_cost_base from erp.inventory_cost_balances where product_id = '95000000-0000-0000-0000-000000000001'), 99::numeric, 'Adjustments reconcile value at WAC');

select lives_ok(
  $$select erp.post_stock_document(
    'sale','20000000-0000-0000-0000-000000000001','stage5-full-deplete','Full depletion',
    '[{"product_id":"95000000-0000-0000-0000-000000000001","from_location_id":"30000000-0000-0000-0000-000000000002","quantity":6},{"product_id":"95000000-0000-0000-0000-000000000001","from_location_id":"30000000-0000-0000-0000-000000000001","quantity":3}]'::jsonb,
    false,'test_sale','98000000-0000-0000-0000-000000000002'
  )$$,
  'Full depletion consumes the exact residual across locations'
);
select is((select valued_quantity from erp.inventory_cost_balances where product_id = '95000000-0000-0000-0000-000000000001'), 0::numeric, 'Full depletion reaches zero quantity');
select is((select total_cost_base from erp.inventory_cost_balances where product_id = '95000000-0000-0000-0000-000000000001'), 0::numeric, 'Full depletion reaches exact zero value');

select erp.post_stock_document(
  'opening','20000000-0000-0000-0000-000000000001','stage5-div-open','Divergence setup',
  '[{"product_id":"95000000-0000-0000-0000-000000000003","to_location_id":"30000000-0000-0000-0000-000000000002","quantity":1,"unit_cost":5}]'::jsonb
);
reset role;
update erp.stock_balances set quantity_on_hand = 2
where product_id = '95000000-0000-0000-0000-000000000003'
  and location_id = '30000000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok(
  $$select erp.post_stock_document(
    'sale','20000000-0000-0000-0000-000000000001','stage5-div-sale','Reject divergence',
    '[{"product_id":"95000000-0000-0000-0000-000000000003","from_location_id":"30000000-0000-0000-0000-000000000002","quantity":2}]'::jsonb,
    false,'test_sale','98000000-0000-0000-0000-000000000003'
  )$$,
  '23514','insufficient valued quantity for stock movement',
  'Insufficient valued quantity rejects the whole stock transaction'
);
select is((select quantity_on_hand from erp.stock_balances where product_id = '95000000-0000-0000-0000-000000000003'), 2::numeric, 'Rejected valuation leaves physical stock unchanged');
select is((select count(*) from erp.stock_documents where idempotency_key = 'stage5-div-sale'), 0::bigint, 'Rejected valuation leaves no stock document');

select lives_ok(
  $$select erp.register_inventory_unit('95000000-0000-0000-0000-000000000004',null,'STAGE5-SERIAL-001',null,77)$$,
  'Serialized unit persists its acquisition cost'
);
select lives_ok(
  $$select erp.post_stock_document(
    'opening','20000000-0000-0000-0000-000000000001','stage5-serial-open','Serialized opening',
    jsonb_build_array(jsonb_build_object(
      'product_id','95000000-0000-0000-0000-000000000004',
      'inventory_unit_id',(select id from erp.inventory_units where product_id = '95000000-0000-0000-0000-000000000004'),
      'to_location_id','30000000-0000-0000-0000-000000000002','quantity',1,'unit_cost',77
    ))
  )$$,
  'Serialized opening records its specific cost'
);
select is((select value_delta_base from erp.stock_cost_movements where document_id = (select id from erp.stock_documents where idempotency_key = 'stage5-serial-open')), 77::numeric, 'Serialized opening uses persisted acquisition cost');
select lives_ok(
  $$select erp.create_stock_reservation(
    '20000000-0000-0000-0000-000000000001','stage5-serial-reserve','sale',
    '98000000-0000-0000-0000-000000000004',now() + interval '30 minutes',
    jsonb_build_array(jsonb_build_object(
      'location_id','30000000-0000-0000-0000-000000000002',
      'product_id','95000000-0000-0000-0000-000000000004',
      'inventory_unit_id',(select id from erp.inventory_units where product_id = '95000000-0000-0000-0000-000000000004'),
      'quantity',1
    ))
  )$$,
  'Serialized unit can be reserved for fulfillment'
);
select lives_ok(
  $$select erp.fulfill_stock_reservation(
    (select id from erp.stock_reservation_batches where idempotency_key = 'stage5-serial-reserve'),
    'stage5-serial-fulfill','Serialized fulfillment'
  )$$,
  'Reservation fulfillment posts its specific cost atomically'
);
select is(
  erp.fulfill_stock_reservation(
    (select id from erp.stock_reservation_batches where idempotency_key = 'stage5-serial-reserve'),
    'stage5-serial-fulfill','Serialized fulfillment'
  ),
  (select id from erp.stock_documents where idempotency_key = 'stage5-serial-fulfill'),
  'Reservation fulfillment retry returns the same document'
);
select is((select count(*) from erp.stock_cost_movements where document_id = (select id from erp.stock_documents where idempotency_key = 'stage5-serial-fulfill')), 1::bigint, 'Reservation fulfillment costs exactly once');

select erp.post_stock_document(
  'opening','20000000-0000-0000-0000-000000000001','stage5-rev-open','Reversal opening',
  '[{"product_id":"95000000-0000-0000-0000-000000000002","to_location_id":"30000000-0000-0000-0000-000000000002","quantity":4,"unit_cost":10}]'::jsonb
);
select erp.post_stock_document(
  'sale','20000000-0000-0000-0000-000000000001','stage5-rev-sale','Historical sale',
  '[{"product_id":"95000000-0000-0000-0000-000000000002","from_location_id":"30000000-0000-0000-0000-000000000002","quantity":2}]'::jsonb,
  false,'test_sale','98000000-0000-0000-0000-000000000005'
);
select erp.post_stock_document(
  'adjustment','20000000-0000-0000-0000-000000000001','stage5-rev-adjust','Change current WAC',
  '[{"product_id":"95000000-0000-0000-0000-000000000002","to_location_id":"30000000-0000-0000-0000-000000000002","quantity":2,"unit_cost":30}]'::jsonb
);
select lives_ok(
  $$select erp.reverse_stock_document(
    (select id from erp.stock_documents where idempotency_key = 'stage5-rev-sale'),
    'stage5-rev-sale-undo','Undo historical sale'
  )$$,
  'Reversal restores original cost facts rather than current WAC'
);
select is((select source_type from erp.stock_documents where idempotency_key = 'stage5-rev-sale-undo'), 'stock_document_reversal', 'Reversal uses the canonical source marker');
select is((select valued_quantity from erp.inventory_cost_balances where product_id = '95000000-0000-0000-0000-000000000002'), 6::numeric, 'Reversal restores exact valued quantity');
select is((select total_cost_base from erp.inventory_cost_balances where product_id = '95000000-0000-0000-0000-000000000002'), 100::numeric, 'Reversal restores exact historical value');
select is((select value_delta_base from erp.stock_cost_movements where document_id = (select id from erp.stock_documents where idempotency_key = 'stage5-rev-sale-undo')), 20::numeric, 'Reversal value is the exact opposite original value');
select is(
  erp.reverse_stock_document(
    (select id from erp.stock_documents where idempotency_key = 'stage5-rev-sale'),
    'stage5-rev-sale-undo','Undo historical sale'
  ),
  (select id from erp.stock_documents where idempotency_key = 'stage5-rev-sale-undo'),
  'Reversal retry is idempotent'
);
select is((select count(*) from erp.stock_cost_movements where reversal_of_cost_movement_id is not null and product_id = '95000000-0000-0000-0000-000000000002'), 1::bigint, 'Original cost fact is reversed only once');

select erp.capture_exchange_rate('ARS',1,'stage5-test','2026-08-19 12:00:00+00','stage5-fx','Base rate');
select erp.create_purchase_order(
  '20000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001','ARS',
  (select id from erp.exchange_rate_snapshots where source = 'stage5-test'),
  'stage5-order','Purchase bridge order',
  '[{"product_id":"95000000-0000-0000-0000-000000000005","quantity":2,"unit_price":20}]'::jsonb
);
select erp.approve_purchase_order(
  (select id from erp.purchase_orders where idempotency_key = 'stage5-order'),
  'stage5-order-approval','Approve bridge order'
);
select lives_ok(
  $$select erp.post_purchase_receipt(
    (select id from erp.purchase_orders where idempotency_key = 'stage5-order'),
    'stage5-receipt','Purchase bridge receipt',
    jsonb_build_array(jsonb_build_object(
      'line_number',1,
      'purchase_order_line_id',(select id from erp.purchase_order_lines where purchase_order_id = (select id from erp.purchase_orders where idempotency_key = 'stage5-order')),
      'to_location_id','30000000-0000-0000-0000-000000000002','quantity',2
    )), '[]'::jsonb, false
  )$$,
  'Purchase receipt keeps stage 4 authoritative valuation'
);
select is((select valued_quantity from erp.inventory_cost_balances where product_id = '95000000-0000-0000-0000-000000000005'), 2::numeric, 'Purchase receipt quantity is not double-valued');
select is((select total_cost_base from erp.inventory_cost_balances where product_id = '95000000-0000-0000-0000-000000000005'), 40::numeric, 'Purchase receipt value is not duplicated');
select is((select count(*) from erp.inventory_cost_entries where product_id = '95000000-0000-0000-0000-000000000005'), 1::bigint, 'Purchase receipt retains one authoritative stage 4 cost entry');
select is((select count(*) from erp.stock_cost_movements where product_id = '95000000-0000-0000-0000-000000000005'), 1::bigint, 'Purchase receipt bridges to one generic cost movement');
select is(
  (select count(*) from erp.stock_cost_movements where product_id = '95000000-0000-0000-0000-000000000005'),
  (select count(*) from erp.stock_movements where product_id = '95000000-0000-0000-0000-000000000005'),
  'Purchase stock and cost movements reconcile one-to-one'
);

reset role;
select throws_ok(
  $$update erp.stock_cost_movements set value_delta_base = 1 where product_id = '95000000-0000-0000-0000-000000000001'$$,
  '23000','erp.stock_cost_movements facts are append-only',
  'Cost facts are immutable even for privileged writers'
);
select throws_ok(
  $$insert into erp.stock_cost_movements (
    organization_id, branch_id, document_id, document_line_id, source_stock_movement_id,
    product_id, location_id, quantity_delta, value_delta_base, unit_cost_snapshot
  ) select organization_id, branch_id, document_id, document_line_id, id,
      product_id, location_id, 'NaN'::numeric, 1, 1
    from erp.stock_movements limit 1$$,
  '23514',null,
  'Cost facts reject NaN quantities'
);
select ok(
  exists (
    select 1 from erp.audit_events
    where table_name = 'stock_cost_movements'
      and new_values is null
      and metadata ->> 'redacted' = 'true'
  ),
  'Cost movement audit events redact quantity and value facts'
);

select * from finish();
rollback;
