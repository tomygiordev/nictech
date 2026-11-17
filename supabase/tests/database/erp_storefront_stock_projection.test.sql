begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- The local ERP stack intentionally lacks legacy public catalog tables.
do $$
begin
  if to_regclass('public.products') is null then
    execute 'create table public.products (id uuid primary key, name text not null, price numeric not null, stock integer not null default 0 check (stock >= 0), additional_images text[], tags text[], condition text, capacity text)';
    execute 'create table public.product_variants (id uuid primary key, product_id uuid references public.products(id), color text not null, stock integer not null default 0)';
  end if;
end;
$$;

insert into public.products (id, name, price, stock) values
  ('9a000000-0000-0000-0000-000000000001', 'Projection mapped', 100, 88),
  ('9a000000-0000-0000-0000-000000000002', 'Projection unmapped', 100, 77);
insert into public.product_variants (id, product_id, color, stock) values
  ('9b000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001', 'Negro', 55),
  ('9b000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000001', 'Blanco', 33);

insert into erp.products (
  id, organization_id, product_type_id, item_kind, unit_id,
  internal_code, internal_name, inventory_tracking
) values (
  '9a000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001', 'product',
  '50000000-0000-0000-0000-000000000001',
  'PROJECTION-MAPPED', 'Projection mapped', 'quantity'
), (
  '9a000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001', 'product',
  '50000000-0000-0000-0000-000000000001',
  'PROJECTION-ERP-ONLY', 'Projection ERP only', 'quantity'
);

insert into erp.product_variants (
  id, organization_id, product_id, code, name
) values
  ('9b000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   '9a000000-0000-0000-0000-000000000001', 'NEGRO', 'Negro'),
  ('9b000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   '9a000000-0000-0000-0000-000000000001', 'BLANCO', 'Blanco');

insert into erp.stock_balances (
  organization_id, branch_id, location_id, product_id, variant_id,
  quantity_on_hand, quantity_reserved
) values
  ('10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   '9a000000-0000-0000-0000-000000000001',
   '9b000000-0000-0000-0000-000000000001', 10, 2),
  ('10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   '9a000000-0000-0000-0000-000000000001',
   '9b000000-0000-0000-0000-000000000002', 5, 0),
  ('10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   '9a000000-0000-0000-0000-000000000001',
   '9b000000-0000-0000-0000-000000000002', 9, 0),
  ('10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   '9a000000-0000-0000-0000-000000000003', null, 7, 0);

select is((select stock from public.products where id = '9a000000-0000-0000-0000-000000000001'), 88,
  'Before activation ERP balances do not overwrite storefront stock');
select throws_ok(
  $$select erp.activate_storefront_stock_projection('10000000-0000-0000-0000-000000000001')$$,
  '55000', 'storefront catalog opening import must complete before stock projection',
  'Activation requires the catalog opening marker');

insert into erp.configuration_values (organization_id, key, value, is_system)
values ('10000000-0000-0000-0000-000000000001',
  'storefront.initial_catalog_import', '{"test_fixture":true}'::jsonb, true);
insert into erp.storefront_stock_capture (organization_id)
values ('10000000-0000-0000-0000-000000000001');

select is(erp.activate_storefront_stock_projection('10000000-0000-0000-0000-000000000001'), 1,
  'Activation projects the one UUID-mapped product');
select is((select stock from public.products where id = '9a000000-0000-0000-0000-000000000001'), 13,
  'Storefront product stock equals available web-location stock');
select is((select stock from public.product_variants where id = '9b000000-0000-0000-0000-000000000001'), 8,
  'Reserved quantity is excluded from variant stock');
select is((select stock from public.product_variants where id = '9b000000-0000-0000-0000-000000000002'), 5,
  'Non-web location is excluded from variant stock');
select is((select stock from public.products where id = '9a000000-0000-0000-0000-000000000002'), 77,
  'Unmapped storefront product remains untouched');

update erp.stock_balances set quantity_on_hand = 6
where product_id = '9a000000-0000-0000-0000-000000000001'
  and variant_id = '9b000000-0000-0000-0000-000000000002'
  and location_id = '30000000-0000-0000-0000-000000000002';
select is((select stock from public.products where id = '9a000000-0000-0000-0000-000000000001'), 14,
  'ERP balance update refreshes storefront product stock');
select is((select stock from public.product_variants where id = '9b000000-0000-0000-0000-000000000002'), 6,
  'ERP balance update refreshes storefront variant stock');

update erp.locations set contributes_to_web_stock = false
where id = '30000000-0000-0000-0000-000000000002';
select is((select stock from public.products where id = '9a000000-0000-0000-0000-000000000001'), 8,
  'Changing location web eligibility refreshes storefront stock');

select throws_ok(
  $$update erp.stock_balances set quantity_on_hand = 10.5
    where product_id = '9a000000-0000-0000-0000-000000000001'
      and variant_id = '9b000000-0000-0000-0000-000000000001'$$,
  '22003', 'storefront product stock must fit an integer unit count',
  'Fractional ERP stock cannot silently truncate storefront stock');
select is((select quantity_on_hand from erp.stock_balances
    where product_id = '9a000000-0000-0000-0000-000000000001'
      and variant_id = '9b000000-0000-0000-0000-000000000001'), 10::numeric,
  'Rejected projection rolls back the ERP balance update');

select throws_ok(
  $$insert into erp.stock_balances (
      organization_id, branch_id, location_id, product_id,
      variant_id, quantity_on_hand, quantity_reserved
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '9a000000-0000-0000-0000-000000000001', null, 1, 0
    )$$,
  '23514', null,
  'ERP cannot create invisible unvarianted stock for a product with variants');
select is((select stock from public.products where id = '9a000000-0000-0000-0000-000000000001'), 8,
  'Rejected mixed stock leaves the storefront total intact');

select * from finish();
rollback;
