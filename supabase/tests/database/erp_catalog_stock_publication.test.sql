begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(4);

create table if not exists public.products (
  id uuid primary key, name text not null, description text, price numeric not null,
  image_url text, stock integer not null default 0, is_active boolean not null default true,
  category_id uuid, brand_id uuid, model_id uuid
);
create table if not exists public.product_variants (
  id uuid primary key, product_id uuid references public.products(id), color text not null,
  image_url text, stock integer not null default 0, is_active boolean not null default true
);

insert into erp.storefront_catalog_sync (organization_id)
values ('10000000-0000-0000-0000-000000000001') on conflict do nothing;
insert into erp.storefront_stock_capture (organization_id)
values ('10000000-0000-0000-0000-000000000001') on conflict do nothing;
insert into erp.storefront_stock_projection (organization_id)
values ('10000000-0000-0000-0000-000000000001') on conflict do nothing;

create or replace trigger z_storefront_stock_capture after insert or update of stock on public.products
for each row execute function erp.capture_storefront_stock_row();
create or replace trigger z_storefront_stock_capture after insert or update of stock, product_id on public.product_variants
for each row execute function erp.capture_storefront_stock_row();

insert into erp.products (id, organization_id, product_type_id, unit_id, item_kind, inventory_tracking,
  internal_code, internal_name, base_sale_price, can_sell, publish_on_web, allow_online_sale)
values
  ('ea180000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
   'product','quantity','TAP-PUBLISH-COLORS','Stock por color',1210,true,false,false),
  ('ea180000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
   'product','quantity','TAP-PUBLISH-SIMPLE','Stock sin variantes',1210,true,false,false);

insert into erp.product_variants (id,organization_id,product_id,code,name) values
  ('ea180000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',
   'ea180000-0000-0000-0000-000000000001','TAP-BLANCO','Blanco'),
  ('ea180000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001',
   'ea180000-0000-0000-0000-000000000001','TAP-NEGRO','Negro');

insert into erp.stock_balances (organization_id,branch_id,location_id,product_id,variant_id,quantity_on_hand)
select '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', p, v, quantity
from (values
  ('ea180000-0000-0000-0000-000000000001'::uuid, 'ea180000-0000-0000-0000-000000000003'::uuid, 5),
  ('ea180000-0000-0000-0000-000000000001'::uuid, 'ea180000-0000-0000-0000-000000000004'::uuid, 7),
  ('ea180000-0000-0000-0000-000000000002'::uuid, null::uuid, 3)
) as balances(p,v,quantity);

select lives_ok($$
  update erp.products set publish_on_web=true, allow_online_sale=true
  where id in ('ea180000-0000-0000-0000-000000000001', 'ea180000-0000-0000-0000-000000000002')
$$, 'published writes create both kinds of products even when legacy stock capture is active');

select results_eq(
  $$select color, stock from public.product_variants
    where product_id='ea180000-0000-0000-0000-000000000001' order by color$$,
  $$values ('Blanco'::text,5), ('Negro'::text,7)$$,
  'variant rows carry ERP stock, by color'
);
select is((select stock from public.products where id='ea180000-0000-0000-0000-000000000001'), 12,
  'parent stock matches its variants');
select is((select stock from public.products where id='ea180000-0000-0000-0000-000000000002'), 3,
  'non-variant products still get their stock on first publication');

select * from finish();
rollback;
