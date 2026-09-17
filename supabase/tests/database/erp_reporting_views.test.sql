begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

select has_view('erp', 'v_iva_ventas', 'Sales VAT view exists');
select has_view('erp', 'v_iva_compras', 'Purchases VAT view exists');
select has_view('erp', 'v_trial_balance', 'Trial balance view exists');
select has_view('erp', 'v_profitability_by_line', 'Profitability view exists');
select has_column('erp', 'v_iva_ventas', 'base_imponible', 'Sales VAT exposes taxable base');
select has_column('erp', 'v_iva_ventas', 'iva', 'Sales VAT exposes tax amount');
select has_column('erp', 'v_iva_compras', 'alicuota', 'Purchases VAT exposes rate column');
select has_column('erp', 'v_trial_balance', 'balance', 'Trial balance exposes account balance');
select has_column('erp', 'v_profitability_by_line', 'margin', 'Profitability exposes margin');
select is(
  has_table_privilege('authenticated', 'erp.v_trial_balance', 'SELECT'),
  true,
  'Authenticated operators can read reporting views'
);

insert into erp.customers (id, organization_id, code, display_name)
values (
  'd1000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'REPORT-CUSTOMER', 'Report Customer'
);

insert into erp.products (
  id, organization_id, product_type_id, item_kind, unit_id,
  internal_code, internal_name, inventory_tracking, can_sell,
  publish_on_web, allow_online_sale
) values (
  'd2000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001', 'product',
  '50000000-0000-0000-0000-000000000001',
  'REPORT-PRODUCT', 'Report Product', 'quantity', true, true, true
);

insert into erp.product_variants (
  id, organization_id, product_id, code, name, attributes
) values (
  'd3000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'd2000000-0000-0000-0000-000000000001',
  'GREEN', 'Green', '{"color":"green"}'::jsonb
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'd4000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'report-test@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Report Test"}'::jsonb, now(), now()
);
update erp.profiles set organization_id = '10000000-0000-0000-0000-000000000001'
where id = 'd4000000-0000-0000-0000-000000000001';
insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  'd4000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'd4000000-0000-0000-0000-000000000001'
);

select set_config('request.jwt.claim.sub', 'd4000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select erp.capture_exchange_rate('ARS', 1, 'report-local', '2026-09-07 12:00:00+00', 'report-fx', 'Report base rate')$$,
  'Base exchange snapshot can be prepared locally'
);
select lives_ok(
  $$select erp.post_stock_document(
    'opening', '20000000-0000-0000-0000-000000000001',
    'report-stock-open', 'Report opening stock',
    '[{"product_id":"d2000000-0000-0000-0000-000000000001","variant_id":"d3000000-0000-0000-0000-000000000001","to_location_id":"30000000-0000-0000-0000-000000000002","quantity":5,"unit_cost":60}]'::jsonb
  )$$,
  'Report stock is opened atomically'
);
select lives_ok(
  $$select erp.bootstrap_chart_of_accounts()$$,
  'Chart of accounts is bootstrapped'
);
select lives_ok(
  $$select erp.create_sale(
    '20000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001', 'ARS',
    (select id from erp.exchange_rate_snapshots where source = 'report-local'),
    'report-sale', 'Report fixture sale',
    '[{"kind":"product","product_id":"d2000000-0000-0000-0000-000000000001","variant_id":"d3000000-0000-0000-0000-000000000001","from_location_id":"30000000-0000-0000-0000-000000000002","description":"Green product","quantity":2,"unit_price":100,"discount_amount":0,"tax_rate_percent":21,"tax_amount":42}]'::jsonb,
    '[{"payment_method_id":"82000000-0000-0000-0000-000000000002","amount":242}]'::jsonb
  )$$,
  'Report fixture sale posts normally'
);
select is((
  select base_imponible from erp.v_iva_ventas
  where sale_id = (select id from erp.sales where idempotency_key = 'report-sale')
), 200::numeric, 'Sales VAT base equals line total minus tax');
select is((
  select iva from erp.v_iva_ventas
  where sale_id = (select id from erp.sales where idempotency_key = 'report-sale')
), 42::numeric, 'Sales VAT matches the real line tax');
select is(
  (select count(*) from erp.v_trial_balance),
  0::bigint,
  'Trial balance hides open-period postings'
);
select lives_ok(
  $$select erp.post_journal_entry(
    '20000000-0000-0000-0000-000000000001', current_date,
    'report', 'd0000000-0000-0000-0000-000000000001',
    'report-journal', 'Report fixture journal',
    (select jsonb_build_array(
      jsonb_build_object('account_id', r1.account_id, 'description', 'Report debit', 'debit', 500, 'credit', 0),
      jsonb_build_object('account_id', r2.account_id, 'description', 'Report credit', 'debit', 0, 'credit', 500)
    ) from (select account_id from erp.accounting_account_roles where organization_id = '10000000-0000-0000-0000-000000000001' and role_code = 'receivable') r1,
         (select account_id from erp.accounting_account_roles where organization_id = '10000000-0000-0000-0000-000000000001' and role_code = 'sales_income') r2)
  )$$,
  'Report fixture journal posts balanced'
);
select lives_ok(
  $$select erp.close_accounting_period(
    (select p.id from erp.accounting_periods p
     where p.organization_id = '10000000-0000-0000-0000-000000000001'
       and current_date between p.period_start and p.period_end),
    'Report period close'
  )$$,
  'Report period closes without drafts'
);
select is((
  select total_debit from erp.v_trial_balance where account_code = '1.1.10'
), 742::numeric, 'Closed-period debit includes the automatic sale and report fixture');
select is((
  select gross_revenue from erp.v_profitability_by_line
  where product_id = 'd2000000-0000-0000-0000-000000000001'
), 242::numeric, 'Profitability uses real sales revenue');
select is((
  select margin from erp.v_profitability_by_line
  where product_id = 'd2000000-0000-0000-0000-000000000001'
), null::numeric, 'Profitability margin stays null without cost receipts');

reset role;
select * from finish();
rollback;
