begin;

create extension if not exists pgtap with schema extensions;

select plan(85);

select has_table('erp', 'organization_currencies', 'Organization currencies exist');
select has_table('erp', 'exchange_rate_snapshots', 'Immutable FX snapshots exist');
select has_table('erp', 'purchase_orders', 'Purchase orders exist');
select has_table('erp', 'purchase_receipts', 'Partial purchase receipts exist');
select has_table('erp', 'inventory_cost_entries', 'Inventory cost ledger exists');
select has_table('erp', 'supplier_payables', 'Supplier payables exist');
select has_table('erp', 'price_entries', 'Immutable price entries exist');
select has_function('erp', 'capture_exchange_rate', array['text','numeric','text','timestamp with time zone','text','text'], 'FX capture command exists');
select has_function('erp', 'create_purchase_order', array['uuid','uuid','text','uuid','text','text','jsonb'], 'Purchase-order command exists');
select has_function('erp', 'approve_purchase_order', array['uuid','text','text'], 'Approval command exists');
select has_function('erp', 'reject_purchase_order', array['uuid','text','text'], 'Rejection command exists');
select has_function('erp', 'post_purchase_receipt', array['uuid','text','text','jsonb','jsonb','boolean'], 'Receipt command exists');
select has_function('erp', 'preview_price_change', array['uuid','text','text','jsonb'], 'Price preview command exists');
select has_function('erp', 'apply_price_change', array['uuid','text','text'], 'Price apply command exists');
select has_column('erp', 'price_change_preview_lines', 'baseline_entry_id', 'Price previews freeze their baseline entry');
select has_column('erp', 'purchase_receipt_lines', 'rounding_adjustment_base', 'Receipt lines preserve rounding residuals');

select ok((select relrowsecurity from pg_class where oid = 'erp.purchase_orders'::regclass), 'Purchase orders enforce RLS');
select ok((select relrowsecurity from pg_class where oid = 'erp.inventory_cost_entries'::regclass), 'Cost entries enforce RLS');
select ok((select relrowsecurity from pg_class where oid = 'erp.price_entries'::regclass), 'Price entries enforce RLS');
select is(has_table_privilege('authenticated', 'erp.purchase_receipts', 'INSERT'), false, 'Authenticated clients cannot insert receipts');
select is(has_table_privilege('authenticated', 'erp.inventory_cost_entries', 'UPDATE'), false, 'Authenticated clients cannot mutate costs');
select is(has_table_privilege('service_role', 'erp.supplier_payables', 'INSERT'), false, 'Service clients cannot insert supplier debt');
select is(has_function_privilege('service_role', 'erp.post_purchase_receipt(uuid,text,text,jsonb,jsonb,boolean)', 'EXECUTE'), false, 'Service role cannot post unscoped receipts');
select is(has_function_privilege('authenticated', 'erp.post_purchase_receipt(uuid,text,text,jsonb,jsonb,boolean)', 'EXECUTE'), true, 'Authenticated actors may invoke the checked receipt command');
select is(has_function_privilege('authenticated', 'erp.post_stock_document_core(erp.stock_document_kind,uuid,text,text,jsonb,boolean,text,uuid)', 'EXECUTE'), false, 'Stock core is not directly executable');
select is(has_column_privilege('authenticated', 'erp.products', 'base_cost', 'SELECT'), false, 'Catalog readers cannot read product costs directly');

select is((select count(*) from erp.organization_currencies where organization_id = '10000000-0000-0000-0000-000000000001'), 2::bigint, 'Seed provides ARS and USD');
select is((select count(*) from erp.payment_methods where organization_id = '10000000-0000-0000-0000-000000000001'), 4::bigint, 'Seed provides deterministic payment methods including trade-in credit');
select is((select count(*) from erp.price_lists where organization_id = '10000000-0000-0000-0000-000000000001'), 1::bigint, 'Seed provides the retail price list');

insert into erp.suppliers (
  id, organization_id, code, display_name, default_currency, payment_terms_days
) values (
  '84000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'STAGE4-SUPPLIER', 'Stage 4 supplier', 'USD', 15
);

insert into erp.products (
  id, organization_id, product_type_id, item_kind, unit_id,
  internal_code, internal_name, inventory_tracking
) values
  (
    '85000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001', 'product',
    '50000000-0000-0000-0000-000000000001',
    'STAGE4-QUANTITY', 'Stage 4 quantity product', 'quantity'
  ),
  (
    '85000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000002', 'product',
    '50000000-0000-0000-0000-000000000001',
    'STAGE4-SERIAL', 'Stage 4 serialized product', 'serial'
  );

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '86000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'stage4-test@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Stage 4 Test"}'::jsonb, now(), now()
);
update erp.profiles set organization_id = '10000000-0000-0000-0000-000000000001'
where id = '86000000-0000-0000-0000-000000000001';
insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000004',
  '86000000-0000-0000-0000-000000000001'
);

select set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select ok(
  erp.has_permission('purchases.manage', '20000000-0000-0000-0000-000000000001')
  and erp.has_permission('costs.manage', '20000000-0000-0000-0000-000000000001')
  and erp.has_permission('pricing.manage', '20000000-0000-0000-0000-000000000001'),
  'The seeded inventory role can execute the stage 4 workflow'
);

select lives_ok(
  $$select erp.capture_exchange_rate('USD', 1000, 'manual-test', '2026-08-19 12:00:00+00', 'stage4-fx-1', 'Initial USD rate')$$,
  'A permitted actor captures an FX snapshot'
);
select is(
  erp.capture_exchange_rate('USD', 1000, 'manual-test', '2026-08-19 12:00:00+00', 'stage4-fx-1', 'Initial USD rate'),
  (select id from erp.exchange_rate_snapshots where source = 'manual-test'),
  'FX capture retry returns the original snapshot'
);
select throws_ok(
  $$select erp.capture_exchange_rate('USD', 1001, 'manual-test', '2026-08-19 12:00:00+00', 'stage4-fx-1', 'Changed USD rate')$$,
  '23000', 'exchange-rate operation key is already used by another request',
  'Conflicting FX retry is rejected'
);
select throws_ok(
  $$select erp.capture_exchange_rate('USD', 'NaN'::numeric, 'manual-test', '2026-08-19 12:00:00+00', 'stage4-fx-nan', 'Invalid USD rate')$$,
  '22023', 'complete positive exchange-rate data is required',
  'Non-finite exchange rates are rejected'
);
select throws_ok(
  $$update erp.exchange_rate_snapshots set rate_to_base = 999 where source = 'manual-test'$$,
  '42501', null,
  'Authenticated actors cannot alter historical FX snapshots'
);

select lives_ok(
  $$select erp.create_purchase_order(
    '20000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001', 'USD',
    (select id from erp.exchange_rate_snapshots where source = 'manual-test'),
    'stage4-order-1', 'Restock stage 4 products',
    '[{"product_id":"85000000-0000-0000-0000-000000000001","quantity":10,"unit_price":2},{"product_id":"85000000-0000-0000-0000-000000000002","quantity":1,"unit_price":5}]'::jsonb
  )$$,
  'A purchase order is created'
);
select is(
  erp.create_purchase_order(
    '20000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001', 'USD',
    (select id from erp.exchange_rate_snapshots where source = 'manual-test'),
    'stage4-order-1', 'Restock stage 4 products',
    '[{"product_id":"85000000-0000-0000-0000-000000000001","quantity":10,"unit_price":2},{"product_id":"85000000-0000-0000-0000-000000000002","quantity":1,"unit_price":5}]'::jsonb
  ),
  (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1'),
  'Purchase-order retry is idempotent'
);
select throws_ok(
  $$select erp.create_purchase_order(
    '20000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001', 'USD',
    (select id from erp.exchange_rate_snapshots where source = 'manual-test'),
    'stage4-order-1', 'Conflicting order',
    '[{"product_id":"85000000-0000-0000-0000-000000000001","quantity":1,"unit_price":2}]'::jsonb
  )$$,
  '23000', 'purchase-order operation key is already used by another request',
  'Conflicting purchase-order retry is rejected'
);
select lives_ok(
  $$select erp.approve_purchase_order(
    (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1'),
    'stage4-approval-1', 'Approved for test'
  )$$,
  'Purchase order approval is recorded'
);
select is(
  erp.approve_purchase_order(
    (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1'),
    'stage4-approval-1', 'Approved for test'
  ),
  (select id from erp.purchase_approval_events where idempotency_key = 'stage4-approval-1'),
  'Approval retry is idempotent'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'erp' and indexname = 'purchase_order_terminal_event_once'
  ),
  'A purchase order can have only one terminal decision'
);
select throws_ok(
  $$select erp.reject_purchase_order(
    (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1'),
    'stage4-rejection-after-approval', 'Contradictory terminal decision'
  )$$,
  '55000', 'purchase order already has a terminal approval event',
  'An approved purchase order cannot also be rejected'
);
select is((select exchange_rate from erp.purchase_orders where idempotency_key = 'stage4-order-1'), 1000::numeric, 'Purchase order preserves its historical FX rate');

select throws_ok(
  $$select erp.post_stock_document(
    'receipt', '20000000-0000-0000-0000-000000000001', 'raw-receipt', 'Bypass attempt',
    '[{"product_id":"85000000-0000-0000-0000-000000000001","to_location_id":"30000000-0000-0000-0000-000000000002","quantity":1}]'::jsonb,
    false, 'purchase_receipt', gen_random_uuid()
  )$$,
  '42501', 'purchase receipts must be posted through post_purchase_receipt',
  'Raw inbound receipt bypass is blocked'
);

select throws_ok(
  $$select erp.post_purchase_receipt(
    (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1'),
    'stage4-bad-allocation', 'Bad expense allocation',
    jsonb_build_array(jsonb_build_object(
      'line_number', 1,
      'purchase_order_line_id', (select id from erp.purchase_order_lines where purchase_order_id = (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1') and line_number = 1),
      'to_location_id', '30000000-0000-0000-0000-000000000002', 'quantity', 4
    )),
    '[{"kind":"freight","description":"Freight","amount_base":400,"payable_to_supplier":true,"allocations":[{"line_number":1,"amount_base":399}]}]'::jsonb,
    true
  )$$,
  '23514', 'each receipt expense must reconcile exactly to its allocations',
  'Expense allocations must reconcile exactly'
);

select lives_ok(
  $$select erp.post_purchase_receipt(
    (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1'),
    'stage4-receipt-1', 'First partial receipt',
    jsonb_build_array(jsonb_build_object(
      'line_number', 1,
      'purchase_order_line_id', (select id from erp.purchase_order_lines where purchase_order_id = (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1') and line_number = 1),
      'to_location_id', '30000000-0000-0000-0000-000000000002', 'quantity', 4
    )),
    '[{"kind":"freight","description":"Freight","amount_base":400,"payable_to_supplier":true,"allocations":[{"line_number":1,"amount_base":400}]}]'::jsonb,
    true
  )$$,
  'A partial receipt posts stock, cost and debt atomically'
);
select is(
  erp.post_purchase_receipt(
    (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1'),
    'stage4-receipt-1', 'First partial receipt',
    jsonb_build_array(jsonb_build_object(
      'line_number', 1,
      'purchase_order_line_id', (select id from erp.purchase_order_lines where purchase_order_id = (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1') and line_number = 1),
      'to_location_id', '30000000-0000-0000-0000-000000000002', 'quantity', 4
    )),
    '[{"kind":"freight","description":"Freight","amount_base":400,"payable_to_supplier":true,"allocations":[{"line_number":1,"amount_base":400}]}]'::jsonb,
    true
  ),
  (select id from erp.purchase_receipts where idempotency_key = 'stage4-receipt-1'),
  'Receipt retry returns the original receipt'
);
select is((select count(*) from erp.purchase_receipts where idempotency_key = 'stage4-receipt-1'), 1::bigint, 'Receipt retry does not duplicate the receipt');
select is((select count(*) from erp.stock_documents where source_type = 'purchase_receipt' and source_id = (select id from erp.purchase_receipts where idempotency_key = 'stage4-receipt-1')), 1::bigint, 'Receipt has exactly one stock document');
select is((select quantity_on_hand from erp.stock_balances where product_id = '85000000-0000-0000-0000-000000000001' and location_id = '30000000-0000-0000-0000-000000000002'), 4::numeric, 'Partial receipt increases stock once');
select is((select expense_total_base from erp.purchase_receipts where idempotency_key = 'stage4-receipt-1'), 400::numeric, 'Receipt stores the exact expense total');
select is((select sum(amount_base) from erp.purchase_expense_allocations where expense_id in (select id from erp.purchase_receipt_expenses where receipt_id = (select id from erp.purchase_receipts where idempotency_key = 'stage4-receipt-1'))), 400::numeric, 'Expense allocations reconcile to the receipt');
select is((select weighted_average_cost from erp.inventory_cost_balances where product_id = '85000000-0000-0000-0000-000000000001'), 2100::numeric, 'First receipt establishes weighted cost');
select is((select count(*) from erp.supplier_payables where receipt_id = (select id from erp.purchase_receipts where idempotency_key = 'stage4-receipt-1')), 1::bigint, 'Receipt creates one supplier payable');
select is((select sum(amount_base_delta) from erp.supplier_account_entries where supplier_id = '84000000-0000-0000-0000-000000000001'), 8400::numeric, 'Supplier debt equals landed receipt value');
select is((select count(*) from erp.inventory_cost_entries where receipt_id = (select id from erp.purchase_receipts where idempotency_key = 'stage4-receipt-1')), 1::bigint, 'Receipt retry does not duplicate cost entries');
select is((select count(*) from erp.supplier_account_entries where payable_id = (select id from erp.supplier_payables where receipt_id = (select id from erp.purchase_receipts where idempotency_key = 'stage4-receipt-1'))), 1::bigint, 'Receipt retry does not duplicate supplier account entries');

select throws_ok(
  $$select erp.post_purchase_receipt(
    (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1'),
    'stage4-receipt-1', 'Conflicting receipt retry',
    jsonb_build_array(jsonb_build_object(
      'line_number', 1,
      'purchase_order_line_id', (select id from erp.purchase_order_lines where purchase_order_id = (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1') and line_number = 1),
      'to_location_id', '30000000-0000-0000-0000-000000000002', 'quantity', 1
    )), '[]'::jsonb, true
  )$$,
  '23000', 'purchase-receipt operation key is already used by another request',
  'Conflicting receipt request hash is rejected'
);
select throws_ok(
  $$select erp.post_purchase_receipt(
    (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1'),
    'stage4-overreceipt', 'Overreceipt attempt',
    jsonb_build_array(jsonb_build_object(
      'line_number', 1,
      'purchase_order_line_id', (select id from erp.purchase_order_lines where purchase_order_id = (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1') and line_number = 1),
      'to_location_id', '30000000-0000-0000-0000-000000000002', 'quantity', 7
    )), '[]'::jsonb, false
  )$$,
  '23514', 'receipt would exceed ordered quantity on line 1',
  'Receipt cannot exceed the remaining ordered quantity'
);

select lives_ok(
  $$select erp.post_purchase_receipt(
    (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1'),
    'stage4-receipt-2', 'Second partial receipt',
    jsonb_build_array(jsonb_build_object(
      'line_number', 1,
      'purchase_order_line_id', (select id from erp.purchase_order_lines where purchase_order_id = (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1') and line_number = 1),
      'to_location_id', '30000000-0000-0000-0000-000000000002', 'quantity', 6
    )), '[]'::jsonb, false
  )$$,
  'Remaining quantity can be received without a payable'
);
select is((select quantity_on_hand from erp.stock_balances where product_id = '85000000-0000-0000-0000-000000000001' and location_id = '30000000-0000-0000-0000-000000000002'), 10::numeric, 'Two partial receipts fill the order quantity');
select is((select weighted_average_cost from erp.inventory_cost_balances where product_id = '85000000-0000-0000-0000-000000000001'), 2040::numeric, 'Weighted cost combines both receipt valuations');
select is((select count(*) from erp.supplier_payables where supplier_id = '84000000-0000-0000-0000-000000000001'), 1::bigint, 'Optional payable flag avoids extra supplier debt');

select lives_ok(
  $$select erp.register_inventory_unit('85000000-0000-0000-0000-000000000002', null, 'STAGE4-SERIAL-001', null, 0)$$,
  'Serialized unit is prepared in quarantine'
);
select lives_ok(
  $$select erp.post_purchase_receipt(
    (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1'),
    'stage4-serial-receipt', 'Serialized receipt',
    jsonb_build_array(jsonb_build_object(
      'line_number', 1,
      'purchase_order_line_id', (select id from erp.purchase_order_lines where purchase_order_id = (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1') and line_number = 2),
      'inventory_unit_id', (select id from erp.inventory_units where product_id = '85000000-0000-0000-0000-000000000002'),
      'to_location_id', '30000000-0000-0000-0000-000000000002', 'quantity', 1
    )), '[]'::jsonb, false
  )$$,
  'Serialized receipt records a specific acquisition cost'
);
select is((select acquisition_cost_base from erp.serialized_acquisition_costs where inventory_unit_id = (select id from erp.inventory_units where product_id = '85000000-0000-0000-0000-000000000002')), 5000::numeric, 'Serialized unit keeps its specific landed cost');
select is(has_column_privilege('authenticated', 'erp.inventory_units', 'acquisition_cost', 'SELECT'), false, 'Serialized unit costs remain hidden from direct reads');

select lives_ok(
  $$select erp.preview_price_change(
    '83000000-0000-0000-0000-000000000001', 'stage4-price-preview-1', 'Publish initial price',
    '[{"product_id":"85000000-0000-0000-0000-000000000001","new_price":3500}]'::jsonb
  )$$,
  'A price change preview is created'
);
select is((select proposed_price from erp.price_change_preview_lines where preview_id = (select id from erp.price_change_previews where idempotency_key = 'stage4-price-preview-1')), 3500::numeric, 'Preview stores the proposed immutable value');
select lives_ok(
  $$select erp.apply_price_change(
    (select id from erp.price_change_previews where idempotency_key = 'stage4-price-preview-1'),
    'stage4-price-apply-1', 'Apply initial price'
  )$$,
  'A reviewed price change is applied'
);
select is((select amount from erp.price_entries where product_id = '85000000-0000-0000-0000-000000000001'), 3500::numeric, 'Applied price is published');
select is(
  erp.apply_price_change(
    (select id from erp.price_change_previews where idempotency_key = 'stage4-price-preview-1'),
    'stage4-price-apply-1', 'Apply initial price'
  ),
  (select id from erp.price_change_applications where idempotency_key = 'stage4-price-apply-1'),
  'Price application retry is idempotent'
);
select is((select count(*) from erp.price_entries where product_id = '85000000-0000-0000-0000-000000000001'), 1::bigint, 'Price retry does not duplicate history');
select throws_ok(
  $$update erp.price_entries set amount = 1 where product_id = '85000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'Published prices cannot be changed directly'
);

select lives_ok(
  $$select erp.preview_price_change(
    '83000000-0000-0000-0000-000000000001', 'stage4-price-preview-a', 'First competing preview',
    '[{"product_id":"85000000-0000-0000-0000-000000000001","new_price":3600}]'::jsonb
  )$$,
  'A first competing price preview is created'
);
select lives_ok(
  $$select erp.preview_price_change(
    '83000000-0000-0000-0000-000000000001', 'stage4-price-preview-b', 'Second competing preview',
    '[{"product_id":"85000000-0000-0000-0000-000000000001","new_price":3700}]'::jsonb
  )$$,
  'A second preview freezes the same baseline'
);
select lives_ok(
  $$select erp.apply_price_change(
    (select id from erp.price_change_previews where idempotency_key = 'stage4-price-preview-a'),
    'stage4-price-apply-a', 'Apply first competing preview'
  )$$,
  'The first competing preview is applied'
);
select throws_ok(
  $$select erp.apply_price_change(
    (select id from erp.price_change_previews where idempotency_key = 'stage4-price-preview-b'),
    'stage4-price-apply-b', 'Apply stale competing preview'
  )$$,
  '55000', 'price preview is stale and must be regenerated',
  'A stale price preview cannot overwrite a newer price'
);
select is(
  (select amount from erp.price_entries where product_id = '85000000-0000-0000-0000-000000000001' order by effective_at desc, id desc limit 1),
  3600::numeric,
  'The latest applied price remains authoritative'
);
select throws_ok(
  $$select erp.preview_price_change(
    '83000000-0000-0000-0000-000000000001', 'stage4-price-duplicate', 'Duplicate product preview',
    '[{"product_id":"85000000-0000-0000-0000-000000000001","new_price":3800},{"product_id":"85000000-0000-0000-0000-000000000001","new_price":3900}]'::jsonb
  )$$,
  '22023', 'price changes cannot repeat a product variant',
  'A preview cannot repeat the same product variant'
);

reset role;

select throws_ok(
  $$update erp.exchange_rate_snapshots set rate_to_base = 999 where source = 'manual-test'$$,
  '23000', 'erp.exchange_rate_snapshots facts are append-only',
  'Historical FX immutability is enforced for privileged writers'
);
select throws_ok(
  $$update erp.price_entries set amount = 1 where product_id = '85000000-0000-0000-0000-000000000001'$$,
  '23000', 'erp.price_entries facts are append-only',
  'Published price immutability is enforced for privileged writers'
);

select throws_ok(
  $$delete from erp.purchase_order_lines where purchase_order_id = (select id from erp.purchase_orders where idempotency_key = 'stage4-order-1')$$,
  '23000', 'erp.purchase_order_lines facts are append-only',
  'Purchase facts cannot be deleted'
);
select ok(
  exists (select 1 from erp.audit_events where table_name = 'purchase_receipts' and new_values ->> 'idempotency_key' = 'stage4-receipt-1'),
  'Receipt posting is audited'
);
select ok(
  not exists (
    select 1 from erp.audit_events
    where table_name in ('purchase_receipts', 'purchase_receipt_lines', 'inventory_cost_entries', 'supplier_payables')
      and (
        new_values ? 'landed_total_base'
        or new_values ? 'unit_landed_cost'
        or new_values ? 'total_cost_base'
        or new_values ? 'amount_base'
      )
  ),
  'Financial values are redacted from general audit payloads'
);

select * from finish();
rollback;
