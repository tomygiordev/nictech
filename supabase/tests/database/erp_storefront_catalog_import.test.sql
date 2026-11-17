begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

-- The legacy public tables are remote-only in the current local baseline.
create table if not exists public.categories (
  id uuid primary key, name text not null, created_at timestamptz
);
create table if not exists public.brands (
  id uuid primary key, name text not null, created_at timestamptz not null default now()
);
create table if not exists public.models (
  id uuid primary key, brand_id uuid references public.brands(id),
  name text not null, created_at timestamptz not null default now()
);
create table if not exists public.products (
  id uuid primary key,
  name text not null,
  description text,
  price numeric not null,
  stock integer not null,
  image_url text,
  additional_images text[], tags text[], condition text, capacity text,
  category_id uuid references public.categories(id),
  brand_id uuid references public.brands(id),
  model_id uuid references public.models(id),
  created_at timestamptz
);
create table if not exists public.product_variants (
  id uuid primary key,
  product_id uuid references public.products(id),
  color text not null,
  stock integer not null,
  price numeric(12,2),
  image_url text,
  created_at timestamptz not null default now()
);

select has_function('erp', 'import_storefront_catalog_opening', array[]::text[],
  'Private storefront opening command exists');
select is(has_function_privilege('anon', 'erp.import_storefront_catalog_opening()', 'EXECUTE'), false,
  'Anonymous clients cannot import catalog');
select is(has_function_privilege('authenticated', 'erp.import_storefront_catalog_opening()', 'EXECUTE'), false,
  'Authenticated clients cannot import catalog');
select is(has_function_privilege('service_role', 'erp.import_storefront_catalog_opening()', 'EXECUTE'), false,
  'Service role cannot import catalog');

insert into public.categories (id, name)
values ('c1000000-0000-0000-0000-000000000001', 'Accesorios');
insert into public.brands (id, name)
values ('b1000000-0000-0000-0000-000000000001', 'Marca');
insert into public.models (id, brand_id, name)
values ('d1000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001', 'Modelo');

insert into public.products (id, name, description, price, stock, category_id, model_id)
values
  ('e1000000-0000-0000-0000-000000000001', 'Funda', 'Proteccion', 1200, 3,
    'c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001'),
  ('e1000000-0000-0000-0000-000000000002', 'Cable', null, 800, 2,
    'c1000000-0000-0000-0000-000000000001', null);
insert into public.product_variants (id, product_id, color, stock)
values ('e2000000-0000-0000-0000-000000000001',
  'e1000000-0000-0000-0000-000000000001', 'Negro', 2);

select throws_ok(
  $$select erp.import_storefront_catalog_opening()$$,
  '23514', 'storefront parent stock differs from its variant stock',
  'Import aborts on parent/variant mismatch'
);
select is((select count(*) from erp.products
  where id in ('e1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000002')), 0::bigint,
  'Failed import leaves no ERP products');

update public.product_variants set stock = 3
where id = 'e2000000-0000-0000-0000-000000000001';

select is((erp.import_storefront_catalog_opening()->>'products')::integer, 2,
  'Import reports actual product count');
select is((select count(*) from erp.product_variants
  where id = 'e2000000-0000-0000-0000-000000000001'), 1::bigint,
  'Variant UUID survives import');
select is((select count(*) from erp.products
  where id in ('e1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000002')), 2::bigint,
  'Product UUIDs survive import');
select is((select count(*) from erp.product_categories
  where id = 'c1000000-0000-0000-0000-000000000001'), 1::bigint,
  'Category UUID survives import');
select is((select count(*) from erp.brands
  where id = 'b1000000-0000-0000-0000-000000000001'), 1::bigint,
  'Brand UUID survives import');
select is((select count(*) from erp.product_models
  where id = 'd1000000-0000-0000-0000-000000000001'), 1::bigint,
  'Model UUID survives import');
select is((select brand_id from erp.products
  where id = 'e1000000-0000-0000-0000-000000000001'),
  'b1000000-0000-0000-0000-000000000001'::uuid,
  'Product brand is derived from its model when absent in storefront');
select is((select sum(quantity_on_hand) from erp.stock_balances
  where product_id in ('e1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000002')), 5::numeric,
  'Opening balances equal storefront stock');
select is((select sum(quantity_delta) from erp.stock_movements
  where product_id in ('e1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000002')), 5::numeric,
  'Opening movements reconcile to balances');
select is((select count(*) from erp.stock_cost_movements
  where product_id in ('e1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000002')), 2::bigint,
  'Opening also enters the cost ledger');
select is((erp.import_storefront_catalog_opening()->>'stock_units')::numeric, 5::numeric,
  'Rerun returns the recorded snapshot');
select is((select count(*) from erp.stock_documents
  where source_type = 'storefront_initial_import'), 1::bigint,
  'Rerun creates no duplicate opening document');
select ok((select relrowsecurity from pg_class where oid = 'erp.stock_balances'::regclass),
  'Import leaves ledger RLS enabled');

select * from finish();
rollback;
