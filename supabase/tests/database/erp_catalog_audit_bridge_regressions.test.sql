begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

do $$
begin
  if to_regclass('public.products') is null then
    create table if not exists public.categories (
      id uuid primary key, name text not null, created_at timestamptz default now()
    );
    create table if not exists public.brands (
      id uuid primary key, name text not null, created_at timestamptz default now()
    );
    create table if not exists public.models (
      id uuid primary key, brand_id uuid, name text not null, created_at timestamptz default now()
    );
    create table if not exists public.products (
      id uuid primary key, name text not null, description text, price numeric not null,
      stock integer not null default 0, image_url text, additional_images text[], tags text[],
      condition text, capacity text, category_id uuid, brand_id uuid, model_id uuid,
      is_active boolean not null default true, created_at timestamptz default now()
    );
    create table if not exists public.product_variants (
      id uuid primary key, product_id uuid references public.products(id), color text not null,
      stock integer not null default 0, image_url text, is_active boolean not null default true,
      created_at timestamptz default now(), price numeric(12,2)
    );
    grant select on public.categories, public.brands, public.models, public.products, public.product_variants to authenticated;
  else
    -- Prod enforces products_condition_check ('Nuevo','Usado','Reacondicionado'), which conflicts
    -- with the nonstandard legacy condition fixture tested below; relax only inside this rollback txn.
    alter table public.products drop constraint if exists products_condition_check;
  end if;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '99000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated',
  'audit-bridge-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8) || '@nictech.local',
  'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Audit Bridge Admin"}'::jsonb, now(), now()
) on conflict (id) do nothing;
update erp.profiles
   set organization_id = '10000000-0000-0000-0000-000000000001'
 where id = '99000000-0000-0000-0000-000000000001';
insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  '99000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '99000000-0000-0000-0000-000000000001'
) on conflict do nothing;

insert into erp.storefront_catalog_sync (organization_id)
values ('10000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into erp.products (
  id, organization_id, product_type_id, item_kind, unit_id,
  internal_code, internal_name, inventory_tracking, base_sale_price
) values (
  'e0000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001',
  'product',
  '50000000-0000-0000-0000-000000000001',
  'AUDIT-MIX-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  'Legacy mixed variant fixture ' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6),
  'quantity',
  100
) on conflict (id) do nothing;

insert into erp.product_variants (
  id, organization_id, product_id, code, name
) values (
  'f0000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000003',
  'MixCase-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6),
  'MixCase'
) on conflict (id) do nothing;

insert into public.products(id,name,price,stock,condition,tags) values('99000000-0000-0000-0000-000000000094','Legacy nonstandard',10,0,'Usado - Excelente',array['a']);
select lives_ok($$update public.products set price=11 where id='99000000-0000-0000-0000-000000000094'$$,'legacy nonstandard condition permits price edit');
select is((select condition from public.products where id='99000000-0000-0000-0000-000000000094'),'Usado - Excelente','legacy condition survives price edit');
select is((select sheet_fields_initialized from erp.products where id='99000000-0000-0000-0000-000000000094'),false,'unrecognized condition remains uninitialized');
select set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok($$select erp.save_catalog_product_sheet('{"id":"99000000-0000-0000-0000-000000000094","public_description":"edit without brand or category"}'::jsonb)$$,'description can be saved with missing brand and category');
select is((select condition from public.products where id='99000000-0000-0000-0000-000000000094'),'Usado - Excelente','sheet edit preserves unrecognized condition');
select is((select sheet_fields_initialized from erp.products where id='99000000-0000-0000-0000-000000000094'),false,'sheet edit retains projection fallback');
select lives_ok($$select erp.save_catalog_product_sheet('{"id":"99000000-0000-0000-0000-000000000094","condition":" Nuevo ","tags":["B","a","b"]}'::jsonb)$$,'explicit recognized condition and tags accepted');
select is((select tags from erp.products where id='99000000-0000-0000-0000-000000000094'),array['B','a']::text[],'tags preserve first occurrence order and spelling');
select throws_ok($$select erp.save_catalog_product_sheet('{"id":"99000000-0000-0000-0000-000000000094","condition":"invalida"}'::jsonb)$$,'22023','condición inválida','invalid condition returns clear error');
select lives_ok($$select erp.save_catalog_product_sheet(jsonb_build_object('id','e0000000-0000-0000-0000-000000000003','media',jsonb_build_array(jsonb_build_object('variant_code',upper(v.code),'storage_path','https://example.test/product_images/legacy.jpg','sort_order',0,'is_primary',true)))) from erp.product_variants v where v.id='f0000000-0000-0000-0000-000000000001'$$,'legacy mixed-case variant code resolves for media');
select is((select variant_id from erp.product_media where product_id='e0000000-0000-0000-0000-000000000003' and storage_path='https://example.test/product_images/legacy.jpg' and is_active),'f0000000-0000-0000-0000-000000000001'::uuid,'media remains attached to legacy variant');
select * from finish();
rollback;
