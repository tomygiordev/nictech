begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(53);

-- Tablas legacy mínimas solo si faltan (patrón to_regclass para postgres limpio vs prodlike).
do $$
begin
  if to_regclass('public.categories') is null then
    create table public.categories (
      id uuid primary key,
      name text not null,
      created_at timestamptz default now()
    );
  end if;
  if to_regclass('public.brands') is null then
    create table public.brands (
      id uuid primary key,
      name text not null,
      created_at timestamptz not null default now()
    );
  end if;
  if to_regclass('public.models') is null then
    create table public.models (
      id uuid primary key,
      brand_id uuid references public.brands(id),
      name text not null,
      created_at timestamptz not null default now()
    );
  end if;
  if to_regclass('public.products') is null then
    create table public.products (
      id uuid primary key,
      name text not null,
      description text,
      price numeric not null,
      original_price numeric,
      stock integer not null default 0 check (stock >= 0),
      image_url text,
      additional_images text[],
      tags text[],
      condition text,
      capacity text,
      category_id uuid,
      brand_id uuid,
      model_id uuid,
      is_active boolean not null default true,
      created_at timestamptz default now()
    );
  end if;
  if to_regclass('public.product_variants') is null then
    create table public.product_variants (
      id uuid primary key,
      product_id uuid references public.products(id),
      color text not null,
      stock integer not null default 0,
      price numeric(12, 2),
      image_url text,
      is_active boolean not null default true,
      created_at timestamptz not null default now()
    );
  end if;
end;
$$;

-- 1. Fixture: actor con rol propio y permisos, producto publicado con variantes A (hereda) y B (precio propio), stock y promo web.
create temp table e2e_fixture as
select
  '10000000-0000-0000-0000-000000000001'::uuid as org_id,
  '20000000-0000-0000-0000-000000000001'::uuid as branch_id,
  '30000000-0000-0000-0000-000000000002'::uuid as location_id,
  '82000000-0000-0000-0000-000000000003'::uuid as mp_payment_method_id,
  gen_random_uuid() as actor_id,
  gen_random_uuid() as role_id,
  gen_random_uuid() as customer_id,
  gen_random_uuid() as product_id,
  gen_random_uuid() as variant_a_id,
  gen_random_uuid() as variant_b_id,
  gen_random_uuid() as storefront_order_id;

grant select on e2e_fixture to authenticated, anon, service_role;

insert into erp.storefront_catalog_sync (organization_id)
select org_id from e2e_fixture
on conflict do nothing;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000',
  actor_id,
  'authenticated',
  'authenticated',
  'e2e-storefront-' || actor_id::text || '@nictech.local',
  'not-used',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"E2E Storefront Operator"}'::jsonb,
  now(),
  now()
from e2e_fixture;

insert into erp.profiles (id, organization_id, display_name, is_active)
select actor_id, org_id, 'E2E Storefront Operator', true
from e2e_fixture
on conflict (id) do update
  set organization_id = excluded.organization_id,
      is_active = true;

insert into erp.roles (id, organization_id, code, name, description, is_system, is_active)
select
  role_id,
  org_id,
  'e2e-storefront-op-' || substr(role_id::text, 1, 8),
  'E2E Storefront Operator',
  'Custom role for storefront end-to-end test',
  false,
  true
from e2e_fixture;

insert into erp.role_permissions (organization_id, role_id, permission_id, is_active)
select f.org_id, f.role_id, p.id, true
from e2e_fixture f
join erp.permissions p
  on p.code = any (array[
    'catalog.view', 'catalog.manage',
    'pricing.view', 'pricing.manage',
    'stock.view', 'stock.move', 'stock.adjust', 'costs.manage',
    'orders.view', 'orders.manage',
    'sales.view', 'sales.create',
    'accounting.post'
  ])
 and p.is_active;

insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
select org_id, actor_id, role_id, actor_id
from e2e_fixture;

insert into erp.customers (id, organization_id, code, display_name)
select customer_id, org_id, 'E2E-CUST-' || substr(customer_id::text, 1, 8), 'Cliente Web E2E'
from e2e_fixture;

insert into erp.products (
  id, organization_id, product_type_id, item_kind, unit_id,
  internal_code, internal_name, public_name, inventory_tracking,
  can_sell, publish_on_web, allow_online_sale, base_sale_price, tax_rate_percent, is_active
)
select
  product_id,
  org_id,
  '60000000-0000-0000-0000-000000000001',
  'product',
  '50000000-0000-0000-0000-000000000001',
  'E2E-PROD-' || substr(product_id::text, 1, 8),
  'Auricular E2E',
  'Auricular E2E',
  'quantity',
  true,
  true,
  true,
  1000.00,
  21.00,
  true
from e2e_fixture;

-- Variante A sin precio propio (hereda base_sale_price = 1000.00).
insert into erp.product_variants (
  id, organization_id, product_id, code, name, attributes, final_price_ars, is_active
)
select
  variant_a_id, org_id, product_id, 'E2E-A', 'Negro', '{"color":"Negro"}'::jsonb, null, true
from e2e_fixture;

-- Variante B con final_price_ars propio (1500.00).
insert into erp.product_variants (
  id, organization_id, product_id, code, name, attributes, final_price_ars, is_active
)
select
  variant_b_id, org_id, product_id, 'E2E-B', 'Blanco', '{"color":"Blanco"}'::jsonb, 1500.00, true
from e2e_fixture;

select set_config('request.jwt.claim.sub', (select actor_id::text from e2e_fixture), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select erp.capture_exchange_rate('ARS', 1, 'e2e-storefront-fx', '2026-11-16 12:00:00+00', 'e2e-fx-key', 'E2E base rate')$$,
  'Fixture captures ARS exchange snapshot'
);

select lives_ok(
  $$select erp.post_stock_document(
    'opening',
    (select branch_id from e2e_fixture),
    'e2e-stock-open',
    'E2E opening stock for variants A and B',
    (
      select jsonb_build_array(
        jsonb_build_object(
          'product_id', product_id,
          'variant_id', variant_a_id,
          'to_location_id', location_id,
          'quantity', 5,
          'unit_cost', 400
        ),
        jsonb_build_object(
          'product_id', product_id,
          'variant_id', variant_b_id,
          'to_location_id', location_id,
          'quantity', 5,
          'unit_cost', 600
        )
      )
      from e2e_fixture
    )
  )$$,
  'Fixture opens stock for both variants in web-contributing location'
);

create temp table e2e_promo (id uuid);
grant select on e2e_promo to authenticated, anon, service_role;

select lives_ok(
  $$insert into e2e_promo
    select erp.upsert_promotion(
      null,
      'Promo Web E2E Variante B',
      'porcentaje',
      20,
      now() - interval '1 hour',
      now() + interval '1 day',
      true,
      array['web']::text[],
      (select jsonb_build_array(jsonb_build_object('product_id', product_id, 'variant_id', variant_b_id)) from e2e_fixture)
    )$$,
  'Active web promotion (20% off) is created on variant B'
);

-- 2. Precio: resolver interno (service_role) y vista public.storefront_promotion_prices.
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

create temp table e2e_resolved_prices as
select
  erp.resolve_catalog_effective_price_internal(f.org_id, f.product_id, f.variant_b_id, now()) as price_b,
  erp.resolve_catalog_effective_price_internal(f.org_id, f.product_id, f.variant_a_id, now()) as price_a
from e2e_fixture f;

grant select on e2e_resolved_prices to authenticated, anon, service_role;

select is(
  (select (price_b->>'final_price_ars')::numeric from e2e_resolved_prices),
  1200.00::numeric,
  'Resolver returns promotional price 1200 for variant B'
);

select is(
  (select (price_b->>'list_price_ars')::numeric from e2e_resolved_prices),
  1500.00::numeric,
  'Resolver returns variant B list_price_ars equal to its final_price_ars (1500)'
);

select is(
  (select (price_b->>'promotion_id')::uuid from e2e_resolved_prices),
  (select id from e2e_promo),
  'Resolver attaches active promotion id to variant B'
);

select is(
  (select (price_a->>'final_price_ars')::numeric from e2e_resolved_prices),
  1000.00::numeric,
  'Resolver returns inherited parent price 1000 for variant A'
);

select is(
  (select price_a->>'promotion_id' from e2e_resolved_prices),
  null,
  'Resolver does not apply variant B promotion to variant A'
);

select is(
  (select effective_price from public.storefront_promotion_prices where variant_id = (select variant_b_id from e2e_fixture)),
  1200.00::numeric,
  'storefront_promotion_prices exposes promotional effective_price 1200 for variant B'
);

select is(
  (select list_price from public.storefront_promotion_prices where variant_id = (select variant_b_id from e2e_fixture)),
  1500.00::numeric,
  'storefront_promotion_prices exposes list_price 1500 for variant B'
);

select is(
  (select effective_price from public.storefront_promotion_prices where variant_id = (select variant_a_id from e2e_fixture)),
  1000.00::numeric,
  'storefront_promotion_prices exposes inherited effective_price 1000 for variant A'
);

-- 3. Pedido: orden storefront con items[].unit_price del resolver (igual que la Edge Function) y pago vía process_mercadopago_payment.
create temp table e2e_order_payload as
select
  jsonb_build_array(
    jsonb_build_object(
      'product_id', f.product_id,
      'variant_id', f.variant_a_id,
      'inventory_unit_id', null,
      'quantity', 1,
      'unit_price', (p.price_a->>'final_price_ars')::numeric,
      'title', 'Auricular E2E - Negro'
    ),
    jsonb_build_object(
      'product_id', f.product_id,
      'variant_id', f.variant_b_id,
      'inventory_unit_id', null,
      'quantity', 1,
      'unit_price', (p.price_b->>'final_price_ars')::numeric,
      'title', 'Auricular E2E - Blanco'
    )
  ) as items,
  ((p.price_a->>'final_price_ars')::numeric + (p.price_b->>'final_price_ars')::numeric) as total,
  '{"name":"Comprador E2E","email":"comprador-e2e@example.test","phone":"1155550000","dni":"30111222","address":"Av Siempre Viva 742"}'::jsonb as payer
from e2e_fixture f
cross join e2e_resolved_prices p;

grant select on e2e_order_payload to authenticated, anon, service_role;

insert into public.orders (id, items, payer, total, status)
select f.storefront_order_id, o.items, o.payer, o.total, 'pending'
from e2e_fixture f
cross join e2e_order_payload o;

create temp table e2e_mp_result (res jsonb);
grant select, insert on e2e_mp_result to authenticated, anon, service_role;

select lives_ok(
  $$insert into e2e_mp_result
    select erp.process_mercadopago_payment(
      (select org_id from e2e_fixture),
      (select branch_id from e2e_fixture),
      (select location_id from e2e_fixture),
      (select storefront_order_id from e2e_fixture),
      (select customer_id from e2e_fixture),
      (select id from erp.exchange_rate_snapshots where source = 'e2e-storefront-fx'),
      (select mp_payment_method_id from e2e_fixture),
      'mp-e2e-pay-1',
      'mp-e2e-ev-1',
      'approved',
      (select total from e2e_order_payload),
      'ARS',
      (select storefront_order_id::text from e2e_fixture),
      (select payer from e2e_order_payload),
      (select items from e2e_order_payload),
      now(),
      '{"id":"mp-e2e-pay-1","payment_method_id":"account_money"}'::jsonb
    )$$,
  'Approved Mercado Pago payment via process_mercadopago_payment succeeds'
);

select ok(
  (
    select
      (res->>'web_order_id')::uuid is not null
      and (res->>'payment_event_id')::uuid is not null
      and (res->>'sale_id')::uuid is not null
      and (res->>'stock_document_id')::uuid is not null
      and (res->>'journal_entry_id')::uuid is not null
      and (res->>'idempotent')::boolean = false
    from e2e_mp_result
  ),
  'process_mercadopago_payment returns complete non-idempotent ERP commit receipt'
);

select is(
  (select status || ':' || coalesce(payment_id, '') || ':' || stock_decremented::text from public.orders where id = (select storefront_order_id from e2e_fixture)),
  'approved:mp-e2e-pay-1:true',
  'public.orders is marked approved with provider payment id and stock_decremented = true'
);

select is(
  (
    select count(*)
    from erp.storefront_payment_syncs s
    cross join e2e_mp_result r
    where s.storefront_order_id = (select storefront_order_id from e2e_fixture)
      and s.web_order_id = (r.res->>'web_order_id')::uuid
      and s.sale_id = (r.res->>'sale_id')::uuid
      and s.stock_document_id = (r.res->>'stock_document_id')::uuid
      and s.journal_entry_id = (r.res->>'journal_entry_id')::uuid
      and s.provider = 'mercadopago'
      and s.provider_payment_id = 'mp-e2e-pay-1'
  ),
  1::bigint,
  'storefront_payment_syncs links storefront order to ERP web order, sale, stock and journal'
);

select is(
  (
    select (replay->>'idempotent')::text || ':' || (replay->>'sale_id')
    from (
      select erp.process_mercadopago_payment(
        (select org_id from e2e_fixture),
        (select branch_id from e2e_fixture),
        (select location_id from e2e_fixture),
        (select storefront_order_id from e2e_fixture),
        (select customer_id from e2e_fixture),
        (select id from erp.exchange_rate_snapshots where source = 'e2e-storefront-fx'),
        (select mp_payment_method_id from e2e_fixture),
        'mp-e2e-pay-1',
        'mp-e2e-ev-1',
        'approved',
        (select total from e2e_order_payload),
        'ARS',
        (select storefront_order_id::text from e2e_fixture),
        (select payer from e2e_order_payload),
        (select items from e2e_order_payload),
        now(),
        '{"id":"mp-e2e-pay-1","payment_method_id":"account_money"}'::jsonb
      ) as replay
    ) t
  ),
  'true:' || (select res->>'sale_id' from e2e_mp_result),
  'Replaying process_mercadopago_payment with identical payload is idempotent'
);

select is(
  (select total_amount from erp.web_orders where id = (select (res->>'web_order_id')::uuid from e2e_mp_result)),
  2200.0000::numeric,
  'erp.web_orders row created with promotional total 2200 (1000 + 1200)'
);

select is(
  (select line_total from erp.web_order_lines where web_order_id = (select (res->>'web_order_id')::uuid from e2e_mp_result) and variant_id = (select variant_b_id from e2e_fixture)),
  1200.0000::numeric,
  'erp.web_order_lines persists promotional gross price 1200 for variant B'
);

select is(
  (select line_total from erp.web_order_lines where web_order_id = (select (res->>'web_order_id')::uuid from e2e_mp_result) and variant_id = (select variant_a_id from e2e_fixture)),
  1000.0000::numeric,
  'erp.web_order_lines persists inherited gross price 1000 for variant A'
);

select is(
  (select quantity_on_hand from erp.stock_balances where product_id = (select product_id from e2e_fixture) and variant_id = (select variant_b_id from e2e_fixture) and location_id = (select location_id from e2e_fixture)),
  4.0000::numeric,
  'Final stock on hand decremented to 4 for variant B'
);

select is(
  (select quantity_on_hand from erp.stock_balances where product_id = (select product_id from e2e_fixture) and variant_id = (select variant_a_id from e2e_fixture) and location_id = (select location_id from e2e_fixture)),
  4.0000::numeric,
  'Final stock on hand decremented to 4 for variant A'
);

select is(
  (select quantity_reserved from erp.stock_balances where product_id = (select product_id from e2e_fixture) and variant_id = (select variant_b_id from e2e_fixture) and location_id = (select location_id from e2e_fixture)),
  0.0000::numeric,
  'Reservation released for variant B after fulfillment'
);

select is(
  (select quantity_reserved from erp.stock_balances where product_id = (select product_id from e2e_fixture) and variant_id = (select variant_a_id from e2e_fixture) and location_id = (select location_id from e2e_fixture)),
  0.0000::numeric,
  'Reservation released for variant A after fulfillment'
);

select is(
  (select status from erp.stock_reservation_batches where id = (select reservation_batch_id from erp.web_orders where id = (select (res->>'web_order_id')::uuid from e2e_mp_result))),
  'fulfilled'::erp.stock_reservation_status,
  'Stock reservation batch marked as fulfilled'
);

select is(
  (select count(*) from erp.web_order_fulfillments where web_order_id = (select (res->>'web_order_id')::uuid from e2e_mp_result) and sale_id = (select (res->>'sale_id')::uuid from e2e_mp_result)),
  1::bigint,
  'web_order_fulfillments links web order and sale'
);

select is(
  (select total_amount from erp.sales where id = (select (res->>'sale_id')::uuid from e2e_mp_result)),
  2200.0000::numeric,
  'Sale created with expected promotional total 2200'
);

select is(
  (select count(*) from erp.payments where sale_id = (select (res->>'sale_id')::uuid from e2e_mp_result) and amount = 2200.0000 and payment_method_id = (select mp_payment_method_id from e2e_fixture) and provider_reference = 'mp-e2e-pay-1'),
  1::bigint,
  'Payment recorded against sale for full promotional amount and provider reference'
);

select is(
  (select kind::text || ':' || status::text from erp.stock_documents where id = (select (res->>'stock_document_id')::uuid from e2e_mp_result)),
  'reservation_fulfillment:posted',
  'Posted reservation fulfillment stock document created on fulfillment'
);

select is(
  (select sum(quantity_delta) from erp.stock_movements where document_id = (select (res->>'stock_document_id')::uuid from e2e_mp_result)),
  -2.0000::numeric,
  'Stock ledger records -2 total movement across both variants'
);

select is(
  (select order_state from erp.web_order_events where web_order_id = (select (res->>'web_order_id')::uuid from e2e_mp_result) and order_state is not null order by event_sequence desc limit 1),
  'fulfilled',
  'Web order timeline records fulfilled order state'
);

select is(
  (select delivery_state from erp.web_order_events where web_order_id = (select (res->>'web_order_id')::uuid from e2e_mp_result) and delivery_state is not null order by event_sequence desc limit 1),
  'dispatched',
  'Web order timeline records dispatched delivery state'
);

select ok(
  (
    select array_agg(delivery_state::text order by event_sequence)
    from erp.web_order_events
    where web_order_id = (select (res->>'web_order_id')::uuid from e2e_mp_result)
      and delivery_state is not null
  ) = array['pending', 'preparing', 'ready', 'dispatched'],
  'Web order timeline transitions cleanly through pending -> preparing -> ready -> dispatched'
);

select ok(
  exists(
    select 1
    from erp.journal_entries je
    where je.id = (select (res->>'journal_entry_id')::uuid from e2e_mp_result)
      and je.source_type = 'online_order'
      and je.source_id = (select (res->>'web_order_id')::uuid from e2e_mp_result)
      and je.status = 'posted'
      and je.total_debit = 2200.00
      and je.total_credit = 2200.00
      and je.posted_by is null
      and je.created_by is null
  ),
  'Balanced posted journal entry is recorded under service_role system attribution'
);

select ok(
  exists(
    select 1 from erp.accounting_source_events
    where source_type = 'online_order'
      and source_id = (select (res->>'web_order_id')::uuid from e2e_mp_result)
      and posting_kind = 'primary'
      and journal_entry_id = (select (res->>'journal_entry_id')::uuid from e2e_mp_result)
  ),
  'Accounting source event links online_order primary posting to journal entry'
);

select ok(
  exists(
    select 1 from erp.integration_outbox
    where aggregate_type = 'web_order'
      and aggregate_id = (select (res->>'web_order_id')::uuid from e2e_mp_result)
      and event_type = 'web_order.fulfilled'
  ) and exists(
    select 1 from erp.integration_outbox
    where aggregate_type = 'web_order'
      and aggregate_id = (select (res->>'web_order_id')::uuid from e2e_mp_result)
      and event_type = 'web_order.delivery.dispatched'
  ),
  'Fulfillment emitted both web_order.fulfilled and web_order.delivery.dispatched outbox events'
);

-- 4. Guard manual de erp.fulfill_web_order y privilegios de helpers contables internos.
reset role;
select set_config('request.jwt.claim.sub', (select actor_id::text from e2e_fixture), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '', true);
set local role authenticated;

create temp table e2e_manual_web_order (id uuid);
grant select on e2e_manual_web_order to authenticated, anon, service_role;

insert into e2e_manual_web_order
select erp.create_web_order(
  (select branch_id from e2e_fixture),
  (select customer_id from e2e_fixture),
  'ARS',
  (select id from erp.exchange_rate_snapshots where source = 'e2e-storefront-fx'),
  'e2e-manual-web-order-1',
  now() + interval '30 minutes',
  (
    select jsonb_build_array(
      jsonb_build_object(
        'product_id', f.product_id,
        'variant_id', f.variant_a_id,
        'location_id', f.location_id,
        'description', 'Auricular E2E - Negro',
        'quantity', 1,
        'unit_price', round((p.price_a->>'final_price_ars')::numeric / (1 + (p.price_a->>'tax_rate_percent')::numeric / 100), 4),
        'tax_rate_percent', (p.price_a->>'tax_rate_percent')::numeric,
        'tax_amount', (p.price_a->>'final_price_ars')::numeric - round((p.price_a->>'final_price_ars')::numeric / (1 + (p.price_a->>'tax_rate_percent')::numeric / 100), 4)
      )
    )
    from e2e_fixture f
    cross join e2e_resolved_prices p
  )
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select erp.record_web_payment_event(
  (select id from e2e_manual_web_order),
  'mercadopago',
  'mp-e2e-manual-ev-1',
  'mp-e2e-manual-pay-1',
  'approved',
  (select mp_payment_method_id from e2e_fixture),
  1000.00,
  now(),
  '{"local_fixture":true}'::jsonb
);

reset role;
select set_config('request.jwt.claim.sub', (select actor_id::text from e2e_fixture), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '', true);
set local role authenticated;

select erp.record_web_order_event(
  (select id from e2e_manual_web_order),
  null,
  'preparing',
  'e2e-manual-preparing-1',
  'Prepare manual E2E web order'
);

select throws_ok(
  $$select erp.fulfill_web_order(
    (select id from e2e_manual_web_order),
    'e2e-manual-fulfill-early',
    'Should fail while preparing'
  )$$,
  '55000',
  'a ready web order is required for fulfillment',
  'Manual erp.fulfill_web_order still rejects preparing orders with 55000'
);

select lives_ok(
  $$select erp.record_web_order_event(
    (select id from e2e_manual_web_order),
    null,
    'ready',
    'e2e-manual-ready-1',
    'Ready manual E2E web order'
  )$$,
  'Manual web order moves to ready before fulfill_web_order'
);

select lives_ok(
  $$select erp.fulfill_web_order(
    (select id from e2e_manual_web_order),
    'e2e-manual-fulfill-ok',
    'Fulfill ready manual web order'
  )$$,
  'Manual erp.fulfill_web_order succeeds once order reaches ready'
);

select ok(
  not has_function_privilege('anon', 'erp.post_online_order_accounting_internal(uuid,date,text,uuid,text,text,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'erp.post_online_order_accounting_internal(uuid,date,text,uuid,text,text,jsonb)', 'execute')
  and not has_function_privilege('service_role', 'erp.post_online_order_accounting_internal(uuid,date,text,uuid,text,text,jsonb)', 'execute'),
  'post_online_order_accounting_internal cannot be executed directly by anon, authenticated or service_role'
);

select ok(
  not has_function_privilege('anon', 'erp.ensure_open_period_internal(date,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'erp.ensure_open_period_internal(date,uuid)', 'execute')
  and not has_function_privilege('service_role', 'erp.ensure_open_period_internal(date,uuid)', 'execute'),
  'ensure_open_period_internal cannot be executed directly by anon, authenticated or service_role'
);

-- 5. Casos borde de redondeo IVA 21% en process_mercadopago_payment: 900 x2 (1800) y 2400 x2 (4800).
create temp table e2e_rounding_fixture as
select
  gen_random_uuid() as prod_900_id,
  gen_random_uuid() as prod_2400_id,
  gen_random_uuid() as order_900_id,
  gen_random_uuid() as order_2400_id;

grant select on e2e_rounding_fixture to authenticated, anon, service_role;

insert into erp.products (
  id, organization_id, product_type_id, item_kind, unit_id,
  internal_code, internal_name, public_name, inventory_tracking,
  can_sell, publish_on_web, allow_online_sale, base_sale_price, tax_rate_percent, is_active
)
select
  prod_900_id,
  (select org_id from e2e_fixture),
  '60000000-0000-0000-0000-000000000001'::uuid,
  'product'::erp.catalog_item_kind,
  '50000000-0000-0000-0000-000000000001'::uuid,
  'E2E-ROUND-900-' || substr(prod_900_id::text, 1, 8),
  'Cable 900 E2E',
  'Cable 900 E2E',
  'quantity'::erp.inventory_tracking_mode,
  true, true, true, 900.00, 21.00, true
from e2e_rounding_fixture
union all
select
  prod_2400_id,
  (select org_id from e2e_fixture),
  '60000000-0000-0000-0000-000000000001'::uuid,
  'product'::erp.catalog_item_kind,
  '50000000-0000-0000-0000-000000000001'::uuid,
  'E2E-ROUND-2400-' || substr(prod_2400_id::text, 1, 8),
  'Cargador 2400 E2E',
  'Cargador 2400 E2E',
  'quantity'::erp.inventory_tracking_mode,
  true, true, true, 2400.00, 21.00, true
from e2e_rounding_fixture;

select erp.post_stock_document(
  'opening',
  (select branch_id from e2e_fixture),
  'e2e-rounding-stock-open',
  'Opening stock for 900x2 and 2400x2 rounding cases',
  (
    select jsonb_build_array(
      jsonb_build_object(
        'product_id', r.prod_900_id,
        'to_location_id', f.location_id,
        'quantity', 5,
        'unit_cost', 300
      ),
      jsonb_build_object(
        'product_id', r.prod_2400_id,
        'to_location_id', f.location_id,
        'quantity', 5,
        'unit_cost', 900
      )
    )
    from e2e_rounding_fixture r
    cross join e2e_fixture f
  )
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

insert into public.orders (id, items, payer, total, status)
select
  r.order_900_id,
  jsonb_build_array(
    jsonb_build_object(
      'product_id', r.prod_900_id,
      'variant_id', null,
      'inventory_unit_id', null,
      'quantity', 2,
      'unit_price', 900,
      'title', 'Cable 900 E2E'
    )
  ),
  (select payer from e2e_order_payload),
  1800.00,
  'pending'
from e2e_rounding_fixture r
union all
select
  r.order_2400_id,
  jsonb_build_array(
    jsonb_build_object(
      'product_id', r.prod_2400_id,
      'variant_id', null,
      'inventory_unit_id', null,
      'quantity', 2,
      'unit_price', 2400,
      'title', 'Cargador 2400 E2E'
    )
  ),
  (select payer from e2e_order_payload),
  4800.00,
  'pending'
from e2e_rounding_fixture r;

create temp table e2e_round_results (tag text, res jsonb);
grant select, insert on e2e_round_results to authenticated, anon, service_role;

select lives_ok(
  $$insert into e2e_round_results
    select '900x2', erp.process_mercadopago_payment(
      (select org_id from e2e_fixture),
      (select branch_id from e2e_fixture),
      (select location_id from e2e_fixture),
      (select order_900_id from e2e_rounding_fixture),
      null,
      (select id from erp.exchange_rate_snapshots where source = 'e2e-storefront-fx'),
      (select mp_payment_method_id from e2e_fixture),
      'mp-e2e-pay-900x2',
      'mp-e2e-ev-900x2',
      'approved',
      1800.00,
      'ARS',
      (select order_900_id::text from e2e_rounding_fixture),
      (select payer from e2e_order_payload),
      (select items from public.orders where id = (select order_900_id from e2e_rounding_fixture)),
      now(),
      '{"id":"mp-e2e-pay-900x2","payment_method_id":"account_money"}'::jsonb
    )$$,
  'process_mercadopago_payment succeeds for 900 x2 at 21% VAT (total 1800.00)'
);

select ok(
  exists(
    select 1
    from erp.web_order_lines l
    join e2e_round_results rr on rr.tag = '900x2'
    where l.web_order_id = (rr.res->>'web_order_id')::uuid
      and l.pricing_version = 'v2'
      and l.unit_gross_price = 900.0000
      and l.net_subtotal_amount = 1487.6033
      and l.tax_amount = 312.3967
      and l.line_total = 1800.0000
      and l.tax_amount = round(round(l.quantity * l.unit_price, 4) * l.tax_rate_percent / 100, 4)
  ),
  '900 x2 at 21% persists exact web_order_lines gross/net/tax (1487.6033 + 312.3967 = 1800.0000)'
);

select ok(
  exists(
    select 1
    from erp.sales s
    join erp.sale_lines sl on sl.sale_id = s.id
    join erp.journal_entries je on je.id = (select (res->>'journal_entry_id')::uuid from e2e_round_results where tag = '900x2')
    where s.id = (select (res->>'sale_id')::uuid from e2e_round_results where tag = '900x2')
      and s.total_amount = 1800.0000
      and sl.pricing_version = 'v2'
      and sl.tax_amount = 312.3967
      and sl.line_total = 1800.0000
      and je.total_debit = 1800.00
      and je.total_credit = 1800.00
  ),
  '900 x2 at 21% reconciles sale, sale_lines and journal_entries to 1800.00'
);

select lives_ok(
  $$insert into e2e_round_results
    select '2400x2', erp.process_mercadopago_payment(
      (select org_id from e2e_fixture),
      (select branch_id from e2e_fixture),
      (select location_id from e2e_fixture),
      (select order_2400_id from e2e_rounding_fixture),
      null,
      (select id from erp.exchange_rate_snapshots where source = 'e2e-storefront-fx'),
      (select mp_payment_method_id from e2e_fixture),
      'mp-e2e-pay-2400x2',
      'mp-e2e-ev-2400x2',
      'approved',
      4800.00,
      'ARS',
      (select order_2400_id::text from e2e_rounding_fixture),
      (select payer from e2e_order_payload),
      (select items from public.orders where id = (select order_2400_id from e2e_rounding_fixture)),
      now(),
      '{"id":"mp-e2e-pay-2400x2","payment_method_id":"account_money"}'::jsonb
    )$$,
  'process_mercadopago_payment succeeds for 2400 x2 at 21% VAT (total 4800.00)'
);

select ok(
  exists(
    select 1
    from erp.web_order_lines l
    join e2e_round_results rr on rr.tag = '2400x2'
    where l.web_order_id = (rr.res->>'web_order_id')::uuid
      and l.pricing_version = 'v2'
      and l.unit_gross_price = 2400.0000
      and l.net_subtotal_amount = 3966.9421
      and l.tax_amount = 833.0579
      and l.line_total = 4800.0000
      and l.tax_amount = round(round(l.quantity * l.unit_price, 4) * l.tax_rate_percent / 100, 4)
  ),
  '2400 x2 at 21% persists exact web_order_lines gross/net/tax (3966.9421 + 833.0579 = 4800.0000)'
);

select ok(
  exists(
    select 1
    from erp.sales s
    join erp.sale_lines sl on sl.sale_id = s.id
    join erp.journal_entries je on je.id = (select (res->>'journal_entry_id')::uuid from e2e_round_results where tag = '2400x2')
    where s.id = (select (res->>'sale_id')::uuid from e2e_round_results where tag = '2400x2')
      and s.total_amount = 4800.0000
      and sl.pricing_version = 'v2'
      and sl.tax_amount = 833.0579
      and sl.line_total = 4800.0000
      and je.total_debit = 4800.00
      and je.total_credit = 4800.00
  ),
  '2400 x2 at 21% reconciles sale, sale_lines and journal_entries to 4800.00'
);

-- 6. Desactivar la promo: resolver vuelve al precio de lista y la orden ya cobrada no cambia.
reset role;
select set_config('request.jwt.claim.sub', (select actor_id::text from e2e_fixture), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '', true);
set local role authenticated;

select lives_ok(
  $$select erp.set_promotion_active((select id from e2e_promo), false)$$,
  'Promotion can be deactivated by authorized actor'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select is(
  (select (erp.resolve_catalog_effective_price_internal(org_id, product_id, variant_b_id, now())->>'final_price_ars')::numeric from e2e_fixture),
  1500.00::numeric,
  'Resolver reverts variant B to list price 1500 after promo deactivation'
);

select is(
  (select erp.resolve_catalog_effective_price_internal(org_id, product_id, variant_b_id, now())->>'promotion_id' from e2e_fixture),
  null,
  'Resolver clears promotion_id for variant B after promo deactivation'
);

select is(
  (select effective_price from public.storefront_promotion_prices where variant_id = (select variant_b_id from e2e_fixture)),
  1500.00::numeric,
  'storefront_promotion_prices reverts variant B to list price 1500'
);

select is(
  (select total_amount from erp.web_orders where id = (select (res->>'web_order_id')::uuid from e2e_mp_result)),
  2200.0000::numeric,
  'Already-paid web order total remains 2200 after promo deactivation'
);

select is(
  (select line_total from erp.web_order_lines where web_order_id = (select (res->>'web_order_id')::uuid from e2e_mp_result) and variant_id = (select variant_b_id from e2e_fixture)),
  1200.0000::numeric,
  'Already-paid web order line for variant B preserves 1200 after promo deactivation'
);

select is(
  (select line_total from erp.sale_lines where sale_id = (select (res->>'sale_id')::uuid from e2e_mp_result) and variant_id = (select variant_b_id from e2e_fixture)),
  1200.0000::numeric,
  'Fulfilled sale line for variant B preserves 1200 after promo deactivation'
);

select * from finish();
rollback;
