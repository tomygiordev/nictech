begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
set local timezone = 'UTC';

select plan(31);

insert into auth.users (id, aud, role, email, raw_user_meta_data)
values
  ('d8100000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'kpi-owner@nictech.local', '{"display_name":"KPI owner"}'),
  ('d8100000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'kpi-viewer@nictech.local', '{"display_name":"KPI viewer"}');

update erp.profiles set organization_id = '10000000-0000-0000-0000-000000000001'
where id in ('d8100000-0000-0000-0000-000000000001', 'd8100000-0000-0000-0000-000000000002');

insert into erp.profile_roles (organization_id, profile_id, role_id)
values ('10000000-0000-0000-0000-000000000001', 'd8100000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub', 'd8100000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  org constant uuid := '10000000-0000-0000-0000-000000000001';
  central constant uuid := '20000000-0000-0000-0000-000000000001';
  counter_location constant uuid := '30000000-0000-0000-0000-000000000001';
  other_branch constant uuid := 'd8200000-0000-0000-0000-000000000001';
  quarantine constant uuid := 'd8300000-0000-0000-0000-000000000001';
  inactive_location constant uuid := 'd8300000-0000-0000-0000-000000000002';
  other_location constant uuid := 'd8300000-0000-0000-0000-000000000003';
  accessories constant uuid := 'd8400000-0000-0000-0000-000000000001';
  other_category constant uuid := 'd8400000-0000-0000-0000-000000000002';
  case_product constant uuid := 'd8500000-0000-0000-0000-000000000001';
  case_variant constant uuid := 'd8600000-0000-0000-0000-000000000001';
  customer constant uuid := 'd8700000-0000-0000-0000-000000000001';
  equipment constant uuid := 'd8800000-0000-0000-0000-000000000001';
  open_repair constant uuid := 'd8900000-0000-0000-0000-000000000001';
  terminal_repair constant uuid := 'd8900000-0000-0000-0000-000000000002';
  delivered_repair constant uuid := 'd8900000-0000-0000-0000-000000000003';
  pos_sale constant uuid := 'd8a00000-0000-0000-0000-000000000001';
  cancelled_sale constant uuid := 'd8a00000-0000-0000-0000-000000000002';
  repair_payment constant uuid := 'd8b00000-0000-0000-0000-000000000001';
  card_method constant uuid := '82000000-0000-0000-0000-000000000002';
  fx_usd uuid;
  promo uuid;
begin
  insert into erp.branches (id, organization_id, code, name)
  values (other_branch, org, 'KPI-SECOND', 'Sucursal KPI');

  insert into erp.locations (id, organization_id, branch_id, code, name, kind, allows_sale, is_active)
  values
    (quarantine, org, central, 'KPI-QUARANTINE', 'Cuarentena KPI', 'quarantine', false, true),
    (inactive_location, org, central, 'KPI-INACTIVE', 'Ubicación inactiva KPI', 'store', true, false),
    (other_location, org, other_branch, 'KPI-SECOND', 'Mostrador sucursal KPI', 'store', true, true);

  insert into erp.product_categories (id, organization_id, code, name)
  values (accessories, org, 'KPI-ACC', 'Accesorios KPI'), (other_category, org, 'KPI-OTHER', 'Otros KPI');

  insert into erp.products (
    id, organization_id, category_id, product_type_id, item_kind, unit_id, internal_code, internal_name,
    inventory_tracking, can_sell, is_active, base_sale_price, publish_on_web, allow_online_sale
  )
  select id, org, category_id,
    case when is_service then '60000000-0000-0000-0000-000000000004'::uuid
      else '60000000-0000-0000-0000-000000000001'::uuid end,
    case when is_service then 'service'::erp.catalog_item_kind else 'product'::erp.catalog_item_kind end,
    '50000000-0000-0000-0000-000000000001', code, name,
    case when is_service then 'none'::erp.inventory_tracking_mode else 'quantity'::erp.inventory_tracking_mode end,
    true, active, 100, online, online
  from (values
    (case_product, accessories, 'KPI-ONLY-CASE', 'Funda', false, true, false),
    ('d8500000-0000-0000-0000-000000000002', accessories, 'KPI-CABLE', 'Cable KPI-ONLY', false, true, false),
    ('d8500000-0000-0000-0000-000000000003', accessories, 'KPI-CHARGER', 'Cargador', false, true, false),
    ('d8500000-0000-0000-0000-000000000004', accessories, 'KPI-SERVICE', 'Servicio', true, true, false),
    ('d8500000-0000-0000-0000-000000000005', accessories, 'KPI-OLD', 'Inactivo', false, false, false),
    ('d8500000-0000-0000-0000-000000000006', other_category, 'KPI-ADAPTER', 'Adaptador KPI-ONLY', false, true, false),
    ('d8500000-0000-0000-0000-000000000007', other_category, 'KPI-WEB', 'Producto web', false, true, true),
    ('d8500000-0000-0000-0000-000000000008', other_category, 'KPI-NEG', 'Negativo', false, true, false)
  ) as fixture(id, category_id, code, name, is_service, active, online);

  insert into erp.product_variants (id, organization_id, product_id, code, name, final_price_ars)
  values (case_variant, org, case_product, 'BLUE', 'Azul', 200);

  insert into erp.promotions (organization_id, name, kind, value, starts_at, channels)
  values (org, 'Promoción KPI', 'precio_fijo', 20, now() - interval '1 day', array['pos', 'web'])
  returning id into promo;
  insert into erp.promotion_targets (organization_id, promotion_id, product_id, variant_id)
  values (org, promo, case_product, case_variant);

  insert into erp.stock_balances (
    organization_id, branch_id, location_id, product_id, variant_id, quantity_on_hand, quantity_reserved
  ) values
    (org, central, counter_location, case_product, case_variant, 5, 3),
    (org, central, quarantine, case_product, case_variant, 40, 0),
    (org, central, inactive_location, case_product, case_variant, 60, 0),
    (org, other_branch, other_location, case_product, case_variant, 4, 0),
    (org, central, counter_location, 'd8500000-0000-0000-0000-000000000003', null, 1, 0),
    (org, central, counter_location, 'd8500000-0000-0000-0000-000000000005', null, 20, 0),
    (org, central, counter_location, 'd8500000-0000-0000-0000-000000000006', null, 3, 0),
    (org, central, counter_location, 'd8500000-0000-0000-0000-000000000008', null, -2, 0);

  insert into erp.customers (id, organization_id, code, display_name)
  values (customer, org, 'KPI-CUSTOMER', 'Cliente KPI');

  insert into erp.customer_equipment (id, organization_id, equipment_type, brand_snapshot, model_snapshot, serial_number)
  values (equipment, org, 'Teléfono', 'KPI', 'Modelo KPI', 'KPI-SERIAL');

  insert into erp.repair_orders (
    id, organization_id, branch_id, order_number, order_code, tracking_token_digest, customer_id,
    equipment_id, intake_condition, reported_fault, opened_at
  ) values
    (open_repair, org, central, 901, 'KPI-901', md5('kpi-901') || md5('kpi-901'), customer, equipment, 'Usado', 'Pantalla', '2026-01-11 02:59:59+00'),
    (terminal_repair, org, central, 902, 'KPI-902', md5('kpi-902') || md5('kpi-902'), customer, equipment, 'Usado', 'Pantalla', '2026-01-11 03:00:00+00'),
    (delivered_repair, org, central, 903, 'KPI-903', md5('kpi-903') || md5('kpi-903'), customer, equipment, 'Usado', 'Pantalla', '2026-01-09 12:00:00+00');

  insert into erp.repair_state_events (organization_id, branch_id, repair_order_id, status_id, public_message, internal_reason)
  values
    (org, central, open_repair, '85000000-0000-0000-0000-000000000001', 'Recibido', 'Fixture KPI'),
    (org, central, terminal_repair, '85000000-0000-0000-0000-000000000004', 'Finalizado', 'Fixture KPI'),
    (org, central, delivered_repair, '85000000-0000-0000-0000-000000000001', 'Recibido', 'Fixture KPI');

  insert into erp.repair_deliveries (
    organization_id, branch_id, repair_order_id, recipient_name, recipient_document_suffix,
    signature_method, signature_reference, delivered_by
  ) values (org, central, delivered_repair, 'Cliente KPI', '1234', 'typed_name', 'Cliente KPI', auth.uid());

  insert into erp.payments (
    id, organization_id, branch_id, repair_order_id, payment_method_id, currency_code, amount, amount_base,
    idempotency_key, request_hash, reason, occurred_at, reversal_of_payment_id
  ) values
    (repair_payment, org, central, open_repair, card_method, 'USD', 50, 75, 'kpi-repair-paid', 'fixture', 'Cobro KPI', '2026-01-11 02:59:59+00', null),
    (gen_random_uuid(), org, central, open_repair, card_method, 'USD', -50, -75, 'kpi-repair-reversed', 'fixture', 'Reversa KPI', '2026-01-11 03:00:00+00', repair_payment);

  fx_usd := erp.capture_exchange_rate('USD', 1.5, 'kpi-usd', '2026-01-10 15:00:00+00', 'kpi-fx-usd', 'Cotización KPI');
  perform erp.capture_exchange_rate('ARS', 1, 'kpi-ars', now(), 'kpi-fx-ars', 'Cotización KPI');

  insert into erp.sales (
    id, organization_id, branch_id, customer_id, currency_code, exchange_snapshot_id, exchange_rate,
    idempotency_key, request_hash, reason, subtotal_amount, discount_amount, tax_amount, total_amount, confirmed_at
  ) values
    (pos_sale, org, central, customer, 'USD', fx_usd, 1.5, 'kpi-pos', 'fixture', 'Venta KPI', 20.6666, 0, 0, 20.6666, '2026-01-11 02:59:59+00'),
    (cancelled_sale, org, central, customer, 'USD', fx_usd, 1.5, 'kpi-pos-cancelled', 'fixture', 'Venta anulada KPI', 50, 0, 0, 50, '2026-01-11 03:00:00+00');

  insert into erp.sale_lines (
    organization_id, sale_id, branch_id, line_number, kind, product_id, variant_id, from_location_id,
    description, quantity, unit_price, tax_rate_percent, tax_amount, line_total
  ) values
    (org, pos_sale, central, 1, 'product', case_product, case_variant, counter_location, 'Funda KPI', 1, 10.3333, 0, 0, 10.3333),
    (org, pos_sale, central, 2, 'product', case_product, case_variant, counter_location, 'Funda KPI', 1, 10.3333, 0, 0, 10.3333),
    (org, cancelled_sale, central, 1, 'product', case_product, case_variant, counter_location, 'Funda KPI', 1, 50, 0, 0, 50);

  insert into erp.sale_state_events (organization_id, sale_id, branch_id, sale_state, payment_state, idempotency_key, reason)
  values
    (org, pos_sale, central, 'confirmed', null, 'kpi-pos-confirmed', 'Fixture KPI'),
    (org, cancelled_sale, central, 'confirmed', null, 'kpi-cancelled-confirmed', 'Fixture KPI'),
    (org, cancelled_sale, central, 'cancelled', null, 'kpi-cancelled-cancelled', 'Fixture KPI'),
    (org, cancelled_sale, central, null, 'refunded', 'kpi-cancelled-refunded', 'Fixture KPI');
end;
$$;

set local role authenticated;

with dashboard as (
  select erp.get_dashboard_metrics('2026-01-10', '2026-01-12', '20000000-0000-0000-0000-000000000001') as result
)
select is(result->'sales',
  '{"pos_ars":31,"web_ars":0,"repairs_ars":0,"total_ars":31,"pos_count":1,"web_count":0,"repairs_count":1}'::jsonb,
  'Confirmed POS sale counts once, a cancelled sale does not, and repair reversal nets the collection')
from dashboard;

select is(
  (erp.get_dashboard_metrics('2026-01-10', '2026-01-11') #>> '{sales,pos_ars}')::numeric,
  (select gross_revenue from erp.v_profitability_by_line where product_id = 'd8500000-0000-0000-0000-000000000001'),
  'POS uses the same per-line ARS conversion and rounding as Profitability'
);

select is(
  erp.get_dashboard_metrics('2026-01-10', '2026-01-12')->'series',
  '[
    {"day":"2026-01-10","pos_ars":31,"web_ars":0,"repairs_ars":75,"repairs_opened":1},
    {"day":"2026-01-11","pos_ars":0,"web_ars":0,"repairs_ars":-75,"repairs_opened":1},
    {"day":"2026-01-12","pos_ars":0,"web_ars":0,"repairs_ars":0,"repairs_opened":0}
  ]'::jsonb,
  'Buenos Aires midnight splits payments and openings; empty days remain in the series'
);

select is(erp.get_dashboard_metrics('2026-01-11', '2026-01-11')->'sales',
  '{"pos_ars":0,"web_ars":0,"repairs_ars":-75,"total_ars":-75,"pos_count":0,"web_count":0,"repairs_count":1}'::jsonb,
  'A one-day range starts at local midnight and retains a standalone reversal');

select is(erp.get_dashboard_metrics('2026-01-10', '2026-01-10')->>'active_repairs_count', '1',
  'Only undelivered nonterminal repairs count as active');
select is(erp.get_dashboard_metrics('2026-01-10', '2026-01-10')->>'products_active_count', '7',
  'Active product count includes services but not inactive records');

select is(
  erp.get_dashboard_metrics('2026-01-10', '2026-01-10', '20000000-0000-0000-0000-000000000001')->'inventory',
  '{"sellable_units":6,"value_at_sale_price_ars":800}'::jsonb,
  'Branch stock deducts reserves and excludes quarantine, inactive locations and inactive products'
);

select is(
  erp.get_dashboard_metrics('2026-01-10', '2026-01-10')->'inventory',
  '{"sellable_units":10,"value_at_sale_price_ars":1600}'::jsonb,
  'Organization stock includes both branches and values the variant at list price, not promotional price'
);

select is((
  select jsonb_agg((item->>'available')::numeric order by ordinality)
  from jsonb_array_elements(erp.get_dashboard_metrics(
    '2026-01-10', '2026-01-10', '20000000-0000-0000-0000-000000000001')->'low_stock') with ordinality as items(item, ordinality)
), '[0,0,0,1,2]'::jsonb, 'Low stock is sorted by available stock and includes zero');

select is(erp.get_catalog_kpis(),
  '{"total_products":7,"stock_value_ars":1600,"low_stock_count":2,"out_of_stock_count":3}'::jsonb,
  'Catalog totals share the dashboard valuation and do not count services as out of stock');
select is(erp.get_catalog_kpis('  (kpi-only),  '),
  '{"total_products":3,"stock_value_ars":1500,"low_stock_count":1,"out_of_stock_count":1}'::jsonb,
  'Search matches code or name case-insensitively with the catalog list normalization');
select is(erp.get_catalog_kpis('kpi-only', 'd8400000-0000-0000-0000-000000000001'),
  '{"total_products":2,"stock_value_ars":1200,"low_stock_count":0,"out_of_stock_count":1}'::jsonb,
  'Category and search filters also restrict stock KPIs');
select is(erp.get_catalog_kpis(null, 'd8400000-0000-0000-0000-000000000001', true),
  '{"total_products":5,"stock_value_ars":1300,"low_stock_count":1,"out_of_stock_count":1}'::jsonb,
  'Including inactive products changes the list count but not the sellable-stock metrics');
select is(erp.get_catalog_kpis('KPI-NEG')->>'out_of_stock_count', '1',
  'Negative balance counts as out of stock');
select is((erp.get_catalog_kpis('KPI-NEG')->>'stock_value_ars')::numeric, 0::numeric,
  'Negative balance does not subtract from stock valuation');

select lives_ok($$select erp.bootstrap_chart_of_accounts()$$, 'Prepare the web sale chart of accounts');
select lives_ok($$select erp.post_stock_document(
  'opening', '20000000-0000-0000-0000-000000000001', 'kpi-web-opening', 'Opening stock for web KPI',
  '[{"product_id":"d8500000-0000-0000-0000-000000000007","to_location_id":"30000000-0000-0000-0000-000000000002","quantity":3,"unit_cost":50}]'
)$$, 'Prepare reservable web stock');
select lives_ok($$select erp.create_web_order(
  '20000000-0000-0000-0000-000000000001', 'd8700000-0000-0000-0000-000000000001', 'ARS',
  (select id from erp.exchange_rate_snapshots where source = 'kpi-ars'), 'kpi-web-order',
  now() + interval '30 minutes',
  '[{"product_id":"d8500000-0000-0000-0000-000000000007","location_id":"30000000-0000-0000-0000-000000000002","description":"Producto web KPI","quantity":2,"unit_price":100,"tax_rate_percent":21,"tax_amount":42}]'
)$$, 'Create a web order that will produce an ERP sale');

select erp.record_web_order_event(
  (select id from erp.web_orders where idempotency_key = 'kpi-web-order'),
  null, 'preparing', 'kpi-web-preparing', 'Preparing KPI order'
);
select erp.record_web_order_event(
  (select id from erp.web_orders where idempotency_key = 'kpi-web-order'),
  null, 'ready', 'kpi-web-ready', 'KPI order ready'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select lives_ok($$select erp.record_web_payment_event(
  (select id from erp.web_orders where idempotency_key = 'kpi-web-order'),
  'mercadopago', 'kpi-web-approved', 'kpi-mp-payment', 'approved',
  '82000000-0000-0000-0000-000000000003', 242, now(), '{"local_fixture":true}'
)$$, 'Approve the provider payment locally');

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select is(
  erp.get_dashboard_metrics(
    (now() at time zone 'America/Argentina/Buenos_Aires')::date,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date
  ) #>> '{sales,web_count}',
  '0', 'An approved web order does not count before the ERP sale exists'
);
select lives_ok($$select erp.fulfill_online_order(
  (select id from erp.web_orders where idempotency_key = 'kpi-web-order'),
  'kpi-mp-payment', 'kpi-web-fulfill', 'Fulfill paid KPI order'
)$$, 'Fulfillment produces the ERP sale and channel link');

select is(
  erp.get_dashboard_metrics(
    (now() at time zone 'America/Argentina/Buenos_Aires')::date,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date
  )->'sales',
  '{"pos_ars":0,"web_ars":242,"repairs_ars":0,"total_ars":242,"pos_count":0,"web_count":1,"repairs_count":0}'::jsonb,
  'The approved and fulfilled web order is counted once, only as web'
);

select set_config('request.jwt.claim.sub', 'd8100000-0000-0000-0000-000000000002', true);
select throws_ok($$select erp.get_dashboard_metrics('2026-01-10','2026-01-10')$$,
  '42501', 'dashboard.view permission required', 'Dashboard rejects authenticated users without permission');
select throws_ok($$select erp.get_catalog_kpis()$$,
  '42501', 'catalog.view permission required', 'Catalog rejects authenticated users without permission');
select ok(
  not has_function_privilege('authenticated', 'erp.catalog_sellable_stock(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'erp.catalog_sellable_stock(uuid,uuid)', 'execute'),
  'Neither entry point of the internal stock formula is executable by authenticated'
);
select ok(
  not has_function_privilege('anon', 'erp.get_dashboard_metrics(date,date,uuid)', 'execute')
  and not has_function_privilege('anon', 'erp.get_catalog_kpis(text,uuid,boolean)', 'execute')
  and not has_function_privilege('service_role', 'erp.get_dashboard_metrics(date,date,uuid)', 'execute')
  and not has_function_privilege('service_role', 'erp.get_catalog_kpis(text,uuid,boolean)', 'execute'),
  'Both public RPCs are granted only to authenticated callers'
);

reset role;
insert into erp.profile_permission_overrides (organization_id, profile_id, permission_id, branch_id, effect, reason)
select '10000000-0000-0000-0000-000000000001', 'd8100000-0000-0000-0000-000000000002', id,
  '20000000-0000-0000-0000-000000000001', 'allow', 'KPI branch-only access'
from erp.permissions where code = 'dashboard.view';
set local role authenticated;
select is(erp.get_dashboard_metrics('2026-01-10', '2026-01-10', '20000000-0000-0000-0000-000000000001')->'inventory',
  '{"sellable_units":6,"value_at_sale_price_ars":800}'::jsonb, 'A branch-only grant sees only that branch stock');
select throws_ok($$select erp.get_dashboard_metrics('2026-01-10', '2026-01-10')$$,
  '42501', 'dashboard.view permission required', 'A branch-only grant cannot request organization totals');
select throws_ok($$select erp.get_dashboard_metrics('2026-01-10', '2026-01-10', 'd8200000-0000-0000-0000-000000000001')$$,
  '42501', 'dashboard.view permission required', 'A branch-only grant cannot request another branch');
select is(
  erp.get_dashboard_metrics('2026-01-10', '2026-01-12', '20000000-0000-0000-0000-000000000001')->>'can_view_sales',
  'false', 'Dashboard reports can_view_sales = false without sales.view'
);
select is(
  erp.get_dashboard_metrics('2026-01-10', '2026-01-12', '20000000-0000-0000-0000-000000000001')#>>'{sales,total_ars}',
  '0', 'Dashboard zeroes sales amounts without sales.view'
);

reset role;
select * from finish();
rollback;
