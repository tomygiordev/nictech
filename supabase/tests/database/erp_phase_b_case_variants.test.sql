begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- Setup test user with owner permissions
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '86000000-0000-0000-0000-000000000099',
  'authenticated', 'authenticated', 'phase-b-test@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Phase B Test"}'::jsonb, now(), now()
);

update erp.profiles
   set organization_id = '10000000-0000-0000-0000-000000000001'
 where id = '86000000-0000-0000-0000-000000000099';

insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000099',
  '40000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000099'
);

-- Ensure supplier exists
insert into erp.suppliers (
  id, organization_id, code, display_name, default_currency, payment_terms_days
) values (
  '84000000-0000-0000-0000-000000000099',
  '10000000-0000-0000-0000-000000000001',
  'PHASEB-SUPPLIER', 'Phase B Cases Supplier', 'ARS', 30
) on conflict do nothing;

select set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-000000000099', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

-- Test 1: Create a phone case with variants (Negro and Rosa) with barcodes
create temporary table _case_creation as
select erp.create_catalog_product_with_variants(
  'CASE-IPHONE13-PRO',
  'Funda Silicona iPhone 13 Pro',
  'product'::erp.catalog_item_kind,
  'quantity'::erp.inventory_tracking_mode,
  null, null, null, null,
  2500, 7500, 21,
  jsonb_build_array(
    jsonb_build_object(
      'code', 'NEG',
      'name', 'Negro',
      'attributes', '{"color": "Negro"}'::jsonb,
      'barcode', '7790001001'
    ),
    jsonb_build_object(
      'code', 'ROS',
      'name', 'Rosa',
      'attributes', '{"color": "Rosa"}'::jsonb,
      'barcode', '7790001002'
    )
  )
) as result;

select ok(
  ((select (result->>'product_id')::uuid from _case_creation) is not null),
  'Phone case product with variants created successfully'
);

-- Obtain IDs into temporary variables
create temporary table _test_vars as
select
  (result->>'product_id')::uuid as prod_id,
  (result->'variants'->0->>'id')::uuid as var_negro_id,
  (result->'variants'->1->>'id')::uuid as var_rosa_id,
  erp.get_or_create_exchange_snapshot('ARS') as snap_id
from _case_creation;

-- Test 2: Indivisible units rule: fractional quantity (0.5) rejected on purchase order
select throws_ok(
  $$
    select erp.create_purchase_order(
      '20000000-0000-0000-0000-000000000001'::uuid,
      '84000000-0000-0000-0000-000000000099'::uuid,
      'ARS',
      (select snap_id from _test_vars),
      'op-po-frac-fail',
      'Purchase fractional order',
      jsonb_build_array(
        jsonb_build_object(
          'product_id', (select prod_id from _test_vars),
          'variant_id', (select var_negro_id from _test_vars),
          'quantity', 0.5,
          'unit_price', 2500
        )
      )
    );
  $$,
  '23514',
  'product unit of measure does not allow decimal quantities',
  'Indivisible units rule rejects fractional quantities on purchase orders'
);

-- Test 3: Create purchase order for 20 Negras and 20 Rosas
create temporary table _po_result as
select erp.create_purchase_order(
  '20000000-0000-0000-0000-000000000001'::uuid,
  '84000000-0000-0000-0000-000000000099'::uuid,
  'ARS',
  (select snap_id from _test_vars),
  'op-po-cases-001',
  'Purchase 20 Negro and 20 Rosa cases',
  jsonb_build_array(
    jsonb_build_object(
      'product_id', (select prod_id from _test_vars),
      'variant_id', (select var_negro_id from _test_vars),
      'quantity', 20,
      'unit_price', 2500
    ),
    jsonb_build_object(
      'product_id', (select prod_id from _test_vars),
      'variant_id', (select var_rosa_id from _test_vars),
      'quantity', 20,
      'unit_price', 2500
    )
  )
) as po_id;

select ok(
  ((select po_id from _po_result) is not null),
  'Purchase order with 20 Negro and 20 Rosa cases created'
);

-- Test 4: Approve purchase order
select lives_ok(
  $$
    select erp.approve_purchase_order(
      (select po_id from _po_result),
      'op-po-approve-001',
      'Approved by owner'
    );
  $$,
  'Purchase order approved successfully'
);

-- Get purchase order line IDs
create temporary table _po_lines as
select
  id as pol_id,
  variant_id
from erp.purchase_order_lines
where purchase_order_id = (select po_id from _po_result);

-- Test 5: Partial receipt: 8 Negras and 12 Rosas
create temporary table _receipt_1 as
select erp.post_purchase_receipt(
  (select po_id from _po_result),
  'op-receipt-partial-001',
  'Partial receipt: 8 Negro, 12 Rosa',
  jsonb_build_array(
    jsonb_build_object(
      'line_number', 1,
      'purchase_order_line_id', (select pol_id from _po_lines where variant_id = (select var_negro_id from _test_vars)),
      'to_location_id', '30000000-0000-0000-0000-000000000001'::uuid,
      'quantity', 8
    ),
    jsonb_build_object(
      'line_number', 2,
      'purchase_order_line_id', (select pol_id from _po_lines where variant_id = (select var_rosa_id from _test_vars)),
      'to_location_id', '30000000-0000-0000-0000-000000000001'::uuid,
      'quantity', 12
    )
  )
) as receipt_id;

select ok(
  ((select receipt_id from _receipt_1) is not null),
  'Partial receipt posted successfully'
);

-- Test 6: Verify stock balances after partial receipt
select is(
  (select quantity_on_hand from erp.stock_balances
    where product_id = (select prod_id from _test_vars)
      and variant_id = (select var_negro_id from _test_vars)
      and location_id = '30000000-0000-0000-0000-000000000001'::uuid),
  8::numeric,
  'Stock balance for Negro is exactly 8 after partial receipt'
);

select is(
  (select quantity_on_hand from erp.stock_balances
    where product_id = (select prod_id from _test_vars)
      and variant_id = (select var_rosa_id from _test_vars)
      and location_id = '30000000-0000-0000-0000-000000000001'::uuid),
  12::numeric,
  'Stock balance for Rosa is exactly 12 after partial receipt'
);

-- Test 7: Second receipt: receive remaining 12 Negras and 8 Rosas
create temporary table _receipt_2 as
select erp.post_purchase_receipt(
  (select po_id from _po_result),
  'op-receipt-partial-002',
  'Final receipt: 12 Negro, 8 Rosa',
  jsonb_build_array(
    jsonb_build_object(
      'line_number', 1,
      'purchase_order_line_id', (select pol_id from _po_lines where variant_id = (select var_negro_id from _test_vars)),
      'to_location_id', '30000000-0000-0000-0000-000000000001'::uuid,
      'quantity', 12
    ),
    jsonb_build_object(
      'line_number', 2,
      'purchase_order_line_id', (select pol_id from _po_lines where variant_id = (select var_rosa_id from _test_vars)),
      'to_location_id', '30000000-0000-0000-0000-000000000001'::uuid,
      'quantity', 8
    )
  )
) as receipt_id;

-- Test 8: Verify stock balances: Negro = 20, Rosa = 20
select is(
  (select quantity_on_hand from erp.stock_balances
    where product_id = (select prod_id from _test_vars)
      and variant_id = (select var_negro_id from _test_vars)
      and location_id = '30000000-0000-0000-0000-000000000001'::uuid),
  20::numeric,
  'Stock balance for Negro is 20 after second receipt'
);

select is(
  (select quantity_on_hand from erp.stock_balances
    where product_id = (select prod_id from _test_vars)
      and variant_id = (select var_rosa_id from _test_vars)
      and location_id = '30000000-0000-0000-0000-000000000001'::uuid),
  20::numeric,
  'Stock balance for Rosa is 20 after second receipt'
);

-- Ensure a customer exists for sale
insert into erp.customers (
  id, organization_id, code, display_name
) values (
  '71000000-0000-0000-0000-000000000099',
  '10000000-0000-0000-0000-000000000001',
  'CUST-PHASEB-001',
  'Cliente Phase B'
) on conflict do nothing;

-- Test 9: Create sale for 1 Negro case
create temporary table _sale_result as
select erp.create_sale(
  '20000000-0000-0000-0000-000000000001'::uuid,
  '71000000-0000-0000-0000-000000000099'::uuid,
  'ARS',
  (select snap_id from _test_vars),
  'op-sale-negro-001',
  'Sale 1 Negro case',
  jsonb_build_array(
    jsonb_build_object(
      'kind', 'product',
      'product_id', (select prod_id from _test_vars),
      'variant_id', (select var_negro_id from _test_vars),
      'from_location_id', '30000000-0000-0000-0000-000000000001'::uuid,
      'description', 'Funda Silicona iPhone 13 Pro Negro',
      'quantity', 1,
      'unit_price', 7500,
      'discount_amount', 0,
      'tax_rate_percent', 21,
      'tax_amount', 1575
    )
  ),
  '[]'::jsonb
) as sale_id;

select ok(
  ((select sale_id from _sale_result) is not null),
  'Sale of 1 Negro case posted successfully'
);

-- Test 10: Verify variant stock deduction isolation:
-- Negro must be 19 (decreased by 1)
-- Rosa must remain 20 (UNTOUCHED!)
select is(
  (select quantity_on_hand from erp.stock_balances
    where product_id = (select prod_id from _test_vars)
      and variant_id = (select var_negro_id from _test_vars)
      and location_id = '30000000-0000-0000-0000-000000000001'::uuid),
  19::numeric,
  'Negro stock is decremented to 19 after sale'
);

select is(
  (select quantity_on_hand from erp.stock_balances
    where product_id = (select prod_id from _test_vars)
      and variant_id = (select var_rosa_id from _test_vars)
      and location_id = '30000000-0000-0000-0000-000000000001'::uuid),
  20::numeric,
  'Rosa stock remains strictly untouched at 20 (variant isolation proven)'
);

-- Test 11: Barcode lookup: scanning barcode retrieves correct variant
select is(
  (select name from erp.product_variants
    where id = (select variant_id from erp.product_identifiers where value = '7790001001')),
  'Negro',
  'Barcode 7790001001 resolves specifically to Negro variant'
);

select is(
  (select name from erp.product_variants
    where id = (select variant_id from erp.product_identifiers where value = '7790001002')),
  'Rosa',
  'Barcode 7790001002 resolves specifically to Rosa variant'
);

rollback;
