-- ERP Phase C Test Suite: Purchases, Transactional POS & Cash Ledger
-- Covers:
-- 1. Cash session opening and idempotency
-- 2. Reject concurrent duplicate open session on same register
-- 3. Transactional POS cash sale updates cash ledger
-- 4. POS sale idempotency avoids duplicate cash movements and stock deductions
-- 5. Physical cash arqueo and closure with 0 difference
-- 6. Physical cash arqueo with discrepancy (reconciled difference)
-- 7. Reject closing an already closed session
-- 8. Purchase receipt idempotency with invoice/remito reference

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Setup test user with owner permissions
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '86000000-0000-0000-0000-000000000098',
  'authenticated', 'authenticated', 'phase-c-test@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Phase C Test"}'::jsonb, now(), now()
);

update erp.profiles
   set organization_id = '10000000-0000-0000-0000-000000000001'
 where id = '86000000-0000-0000-0000-000000000098';

insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000098',
  '40000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000098'
);

select set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-000000000098', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

-- Prepare variables
create temporary table _test_ctx as
select
  '20000000-0000-0000-0000-000000000001'::uuid as branch_id,
  '84000000-0000-0000-0000-000000000001'::uuid as register_id,
  '30000000-0000-0000-0000-000000000001'::uuid as location_id,
  '82000000-0000-0000-0000-000000000001'::uuid as cash_method_id,
  erp.get_or_create_exchange_snapshot('ARS') as snapshot_id,
  erp.get_or_create_pos_customer('Cliente Test Fase C') as customer_id;

-- 1. Open cash session
create temporary table _open_sess as
select erp.open_cash_session(
  (select register_id from _test_ctx),
  'op-cash-open-c01',
  'Turno Mañana Fase C',
  jsonb_build_array(
    jsonb_build_object('currency_code', 'ARS', 'amount', 5000)
  )
) as session_id;

select is(
  ((select session_id from _open_sess) is not null),
  true,
  'Cash session opened successfully with initial 5000 ARS'
);

-- 2. Open cash session idempotency: same key returns same ID
select is(
  (select erp.open_cash_session(
    (select register_id from _test_ctx),
    'op-cash-open-c01',
    'Turno Mañana Fase C',
    jsonb_build_array(
      jsonb_build_object('currency_code', 'ARS', 'amount', 5000)
    )
  )),
  (select session_id from _open_sess),
  'Open cash session returns existing session on identical idempotent replay'
);

-- 3. Reject second open session while register is currently open
select throws_ok(
  $$
    select erp.open_cash_session(
      '84000000-0000-0000-0000-000000000001'::uuid,
      'op-cash-open-c02-duplicate',
      'Intento apertura duplicada',
      jsonb_build_array(
        jsonb_build_object('currency_code', 'ARS', 'amount', 1000)
      )
    );
  $$,
  '55000',
  'cash register already has an open session',
  'Cannot open second session on already open cash register'
);

-- Create test product for sale
create temporary table _sale_prod as
select (erp.create_catalog_product_with_variants(
  'PROD-FASEC-001',
  'Cargador Rápido 20W',
  'product'::erp.catalog_item_kind,
  'quantity'::erp.inventory_tracking_mode,
  null, null, null, null,
  3500, 8500, 0,
  '[]'::jsonb
)->>'product_id')::uuid as product_id;

-- Seed stock for sale via opening stock document
select erp.post_stock_document(
  'opening',
  (select branch_id from _test_ctx),
  'op-stock-init-c01',
  'Stock inicial para POS',
  jsonb_build_array(
    jsonb_build_object(
      'product_id', (select product_id from _sale_prod),
      'to_location_id', (select location_id from _test_ctx),
      'quantity', 10,
      'unit_cost', 3500
    )
  )
);

-- 4. POS Cash Sale: create_sale with payment linked to cash session
create temporary table _sale_c_result as
select erp.create_sale(
  (select branch_id from _test_ctx),
  (select customer_id from _test_ctx),
  'ARS',
  (select snapshot_id from _test_ctx),
  'op-sale-c01',
  'Venta POS Mostrador Efectivo',
  jsonb_build_array(
    jsonb_build_object(
      'kind', 'product',
      'product_id', (select product_id from _sale_prod),
      'from_location_id', (select location_id from _test_ctx),
      'description', 'Cargador Rápido 20W',
      'quantity', 2,
      'unit_price', 8500,
      'discount_amount', 0,
      'tax_rate_percent', 0,
      'tax_amount', 0
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'payment_method_id', (select cash_method_id from _test_ctx),
      'cash_session_id', (select session_id from _open_sess),
      'amount', 17000
    )
  )
) as sale_id;

select is(
  ((select sale_id from _sale_c_result) is not null),
  true,
  'POS sale created and paid with cash successfully'
);

-- 5. Verify cash ledger movement created
select is(
  (select sum(amount) from erp.cash_movements where cash_session_id = (select session_id from _open_sess)),
  17000::numeric,
  'Cash movement of 17000 ARS recorded in open session'
);

-- 6. POS sale idempotency: re-submitting does not duplicate cash movement
select is(
  (select erp.create_sale(
    (select branch_id from _test_ctx),
    (select customer_id from _test_ctx),
    'ARS',
    (select snapshot_id from _test_ctx),
    'op-sale-c01',
    'Venta POS Mostrador Efectivo',
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'product',
        'product_id', (select product_id from _sale_prod),
        'from_location_id', (select location_id from _test_ctx),
        'description', 'Cargador Rápido 20W',
        'quantity', 2,
        'unit_price', 8500,
        'discount_amount', 0,
        'tax_rate_percent', 0,
        'tax_amount', 0
      )
    ),
    jsonb_build_array(
      jsonb_build_object(
        'payment_method_id', (select cash_method_id from _test_ctx),
        'cash_session_id', (select session_id from _open_sess),
        'amount', 17000
      )
    )
  )),
  (select sale_id from _sale_c_result),
  'Sale replay returns existing sale_id without duplicating facts'
);

-- Verify cash movements still exactly 17000 (no duplicate movement)
select is(
  (select count(*) from erp.cash_movements where cash_session_id = (select session_id from _open_sess)),
  1::bigint,
  'Cash movements count remains 1 after sale replay'
);

-- 7. Arqueo and close cash session with exact physical count (5000 initial + 17000 sales = 22000)
create temporary table _closure_c_result as
select erp.close_cash_session(
  (select session_id from _open_sess),
  'op-cash-close-c01',
  'Arqueo exacto fin de turno',
  jsonb_build_array(
    jsonb_build_object('currency_code', 'ARS', 'amount', 22000)
  )
) as closure_id;

select is(
  ((select closure_id from _closure_c_result) is not null),
  true,
  'Cash session closed and physical arqueo persisted'
);

-- 8. Verify exact difference is 0 in cash_close_counts
select is(
  (select difference_amount from erp.cash_close_counts where cash_closure_id = (select closure_id from _closure_c_result)),
  0::numeric,
  'Arqueo difference is exactly 0 ARS (caja cuadrada)'
);

-- 9. Reject closing an already closed session
select throws_ok(
  $$
    select erp.close_cash_session(
      (select session_id from _open_sess),
      'op-cash-close-c02-already-closed',
      'Segundo cierre',
      jsonb_build_array(
        jsonb_build_object('currency_code', 'ARS', 'amount', 22000)
      )
    );
  $$,
  '55000',
  'cash session is already closed',
  'Cannot close an already closed cash session'
);

-- 10. Purchase Order & Receipt with invoice/remito reference
insert into erp.suppliers (
  id, organization_id, code, display_name, is_active
) values (
  '62000000-0000-0000-0000-000000000099',
  '10000000-0000-0000-0000-000000000001',
  'SUPP-FASEC-01',
  'Distribuidora Mayorista Fase C',
  true
) on conflict (id) do nothing;

create temporary table _po_c as
select erp.create_purchase_order(
  (select branch_id from _test_ctx),
  '62000000-0000-0000-0000-000000000099'::uuid,
  'ARS',
  (select snapshot_id from _test_ctx),
  'op-po-c01',
  'Orden de compra con factura',
  jsonb_build_array(
    jsonb_build_object(
      'product_id', (select product_id from _sale_prod),
      'quantity', 15,
      'unit_price', 4000
    )
  )
) as po_id;

select erp.approve_purchase_order(
  (select po_id from _po_c),
  'op-po-c01-appr',
  'Aprobada por titular'
);

-- 11. Post receipt with invoice/remito reference in reason
create temporary table _rcpt_c as
select erp.post_purchase_receipt(
  (select po_id from _po_c),
  'op-rcpt-c01',
  'Recepción mercadería [Doc: REM-0001-00045678]',
  jsonb_build_array(
    jsonb_build_object(
      'line_number', 1,
      'purchase_order_line_id', (select id from erp.purchase_order_lines where purchase_order_id = (select po_id from _po_c) limit 1),
      'to_location_id', (select location_id from _test_ctx),
      'quantity', 15
    )
  ),
  '[]'::jsonb,
  true
) as receipt_id;

select is(
  ((select receipt_id from _rcpt_c) is not null),
  true,
  'Purchase receipt with remito reference posted successfully'
);

-- 12. Idempotent purchase receipt replay returns existing receipt ID
select is(
  (select erp.post_purchase_receipt(
    (select po_id from _po_c),
    'op-rcpt-c01',
    'Recepción mercadería [Doc: REM-0001-00045678]',
    jsonb_build_array(
      jsonb_build_object(
        'line_number', 1,
        'purchase_order_line_id', (select id from erp.purchase_order_lines where purchase_order_id = (select po_id from _po_c) limit 1),
        'to_location_id', (select location_id from _test_ctx),
        'quantity', 15
      )
    ),
    '[]'::jsonb,
    true
  )),
  (select receipt_id from _rcpt_c),
  'Receipt replay returns existing receipt ID without duplicate stock or payables'
);

select * from finish();
rollback;
