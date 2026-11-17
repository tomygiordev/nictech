begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

create table if not exists public.categories (
  id uuid primary key, name text not null, created_at timestamptz default now()
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
  stock integer not null default 0 check (stock >= 0),
  image_url text,
  additional_images text[], tags text[], condition text, capacity text,
  category_id uuid,
  brand_id uuid,
  model_id uuid,
  is_active boolean not null default true,
  created_at timestamptz default now()
);
create table if not exists public.product_variants (
  id uuid primary key,
  product_id uuid references public.products(id),
  color text not null,
  stock integer not null default 0,
  price numeric(12,2),
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.products (id, name, price, stock)
values ('a1000000-0000-0000-0000-000000000001', 'Cable', 1000, 5);

select is((erp.import_storefront_catalog_opening()->>'stock_units')::numeric, 5::numeric,
  'Opening captures the storefront stock');
select is(erp.activate_storefront_bridge('10000000-0000-0000-0000-000000000001'), 1,
  'Activates catalog and stock in one operation');

update public.products set stock = 6
where id = 'a1000000-0000-0000-0000-000000000001';
select is((select sum(quantity_on_hand) from erp.stock_balances
  where product_id = 'a1000000-0000-0000-0000-000000000001'), 6::numeric,
  'Legacy stock update enters ERP balances');
select is((select sum(quantity_delta) from erp.stock_movements
  where product_id = 'a1000000-0000-0000-0000-000000000001'), 6::numeric,
  'Legacy stock update enters ERP ledger');

update erp.stock_balances set quantity_on_hand = 7
where product_id = 'a1000000-0000-0000-0000-000000000001';
select is((select stock from public.products
  where id = 'a1000000-0000-0000-0000-000000000001'), 7,
  'ERP stock change projects to storefront');

update public.products set name = 'Cable USB' where id = 'a1000000-0000-0000-0000-000000000001';
select is((select public_name from erp.products
  where id = 'a1000000-0000-0000-0000-000000000001'), 'Cable USB',
  'Legacy catalog edit reaches ERP');

-- The bridge may be activated after the public table is created.
update public.products set tags=array['cable'], condition='Nuevo', capacity='128GB'
 where id='a1000000-0000-0000-0000-000000000001';
select is((select tags from erp.products where id='a1000000-0000-0000-0000-000000000001'),array['cable']::text[],'tag-only update reaches ERP after late activation');
select is((select condition from erp.products where id='a1000000-0000-0000-0000-000000000001'),'nuevo','condition update reaches ERP');
select is((select capacity from erp.products where id='a1000000-0000-0000-0000-000000000001'),'128GB','capacity update reaches ERP');

update erp.products set base_sale_price = 1500
where id = 'a1000000-0000-0000-0000-000000000001';
select is((select price from public.products
  where id = 'a1000000-0000-0000-0000-000000000001'), 1500::numeric,
  'ERP price edit reaches storefront');
select is((select count(*) from erp.storefront_stock_capture), 1::bigint,
  'Legacy capture is active after bridge activation');

insert into public.products (id, name, price, stock)
values ('a1000000-0000-0000-0000-000000000002', 'Funda', 2000, 0);
select is((select count(*) from erp.products
  where id = 'a1000000-0000-0000-0000-000000000002'), 1::bigint,
  'Legacy product insertion creates its ERP counterpart');

insert into public.product_variants (id, product_id, color, stock)
values ('a2000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000002', 'Negro', 3);
select is((select count(*) from erp.product_variants
  where id = 'a2000000-0000-0000-0000-000000000001'), 1::bigint,
  'Legacy variant insertion creates its ERP counterpart');
select is((select stock from public.products
  where id = 'a1000000-0000-0000-0000-000000000002'), 3,
  'Variant insertion refreshes parent stock');
select is((select sum(quantity_on_hand) from erp.stock_balances
  where variant_id = 'a2000000-0000-0000-0000-000000000001'), 3::numeric,
  'Variant opening quantity enters ERP balances');

update public.product_variants set stock = 4
where id = 'a2000000-0000-0000-0000-000000000001';
select is((select sum(quantity_on_hand) from erp.stock_balances
  where variant_id = 'a2000000-0000-0000-0000-000000000001'), 4::numeric,
  'Legacy variant adjustment enters ERP balances');
select is((select stock from public.products
  where id = 'a1000000-0000-0000-0000-000000000002'), 4,
  'Variant adjustment refreshes parent stock');

update public.product_variants set stock = 2
where id = 'a2000000-0000-0000-0000-000000000001';
select is((select sum(quantity_on_hand) from erp.stock_balances
  where variant_id = 'a2000000-0000-0000-0000-000000000001'), 2::numeric,
  'Legacy variant sale reduces ERP balances');
select is((select sum(quantity_delta) from erp.stock_movements
  where variant_id = 'a2000000-0000-0000-0000-000000000001'), 2::numeric,
  'Legacy variant sale has a compensating ledger movement');

update erp.stock_balances set quantity_on_hand = 3
where variant_id = 'a2000000-0000-0000-0000-000000000001';
select is((select stock from public.product_variants
  where id = 'a2000000-0000-0000-0000-000000000001'), 3,
  'ERP variant stock projects to storefront variant');
select is((select stock from public.products
  where id = 'a1000000-0000-0000-0000-000000000002'), 3,
  'ERP variant stock projects to parent product');

insert into public.categories (id, name)
values ('c2000000-0000-0000-0000-000000000001', 'Accesorios');
select is((select name from erp.product_categories
  where id = 'c2000000-0000-0000-0000-000000000001'), 'Accesorios',
  'Legacy category insertion reaches ERP');

insert into public.brands (id, name)
values ('b2000000-0000-0000-0000-000000000001', 'Marca B');
select is((select name from erp.brands
  where id = 'b2000000-0000-0000-0000-000000000001'), 'Marca B',
  'Legacy brand insertion reaches ERP');

insert into public.models (id, brand_id, name)
values ('d2000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001', 'Modelo B');
select is((select name from erp.product_models
  where id = 'd2000000-0000-0000-0000-000000000001'), 'Modelo B',
  'Legacy model insertion reaches ERP');

insert into public.products (id, name, price, stock, category_id, model_id)
values ('a1000000-0000-0000-0000-000000000003', 'Cargador', 2500, 0,
  'c2000000-0000-0000-0000-000000000001',
  'd2000000-0000-0000-0000-000000000001');
select is((select brand_id from erp.products
  where id = 'a1000000-0000-0000-0000-000000000003'),
  'b2000000-0000-0000-0000-000000000001'::uuid,
  'New legacy product derives its ERP brand from the model');

update erp.product_categories set name = 'Accesorios nuevos'
where id = 'c2000000-0000-0000-0000-000000000001';
select is((select name from public.categories
  where id = 'c2000000-0000-0000-0000-000000000001'), 'Accesorios nuevos',
  'ERP category edit reaches storefront');

insert into erp.brands (id, organization_id, code, name)
values ('b2000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001', 'ERP-BRAND-B', 'Marca ERP');
select is((select name from public.brands
  where id = 'b2000000-0000-0000-0000-000000000002'), 'Marca ERP',
  'ERP brand insertion reaches storefront');

select * from finish();
rollback;
