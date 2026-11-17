begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- The legacy storefront tables do not exist in a fresh migration-only database.
create table if not exists public.categories (id uuid primary key, name text not null, created_at timestamptz default now());
create table if not exists public.brands (id uuid primary key, name text not null, created_at timestamptz default now());
create table if not exists public.models (id uuid primary key, brand_id uuid, name text not null, created_at timestamptz default now());
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

select ok(not has_function_privilege('anon','erp.resolve_catalog_effective_price_internal(uuid,uuid,uuid,timestamptz)','execute'), 'anon cannot invoke internal resolver');
select ok(not has_function_privilege('authenticated','erp.resolve_catalog_effective_price_internal(uuid,uuid,uuid,timestamptz)','execute'), 'authenticated cannot invoke internal resolver');
select ok(has_function_privilege('service_role','erp.resolve_catalog_effective_price_internal(uuid,uuid,uuid,timestamptz)','execute'), 'service role can invoke internal resolver');

insert into erp.organizations (id, legal_name, display_name, timezone, default_currency)
select '10000000-0000-0000-0000-000000000001', 'NicTech', 'NicTech', 'America/Argentina/Buenos_Aires', 'ARS'
where not exists (select 1 from erp.organizations where is_active);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','86000000-0000-0000-0000-000000000194','authenticated','authenticated','unified-price-test@nictech.local','not-used',now(),'{"provider":"email"}'::jsonb,'{"display_name":"Unified Price Test"}'::jsonb,now(),now())
on conflict (id) do nothing;

insert into erp.profiles(id,organization_id,display_name,is_active)
select '86000000-0000-0000-0000-000000000194',o.id,'Unified Price Test',true
from erp.organizations o
where o.is_active
order by o.created_at asc
limit 1
on conflict (id) do update
  set organization_id=excluded.organization_id,
      is_active=true;

insert into erp.units_of_measure(id,organization_id,code,name,allows_decimals)
select '86000000-0000-0000-0000-000000000196',p.organization_id,'UN-194','Unidad 194',false
from erp.profiles p
where p.id='86000000-0000-0000-0000-000000000194'
  and not exists (select 1 from erp.units_of_measure u where u.organization_id=p.organization_id and u.is_active);

insert into erp.product_types(id,organization_id,code,name,item_kind,default_tracking_mode)
select '86000000-0000-0000-0000-000000000197',p.organization_id,'PROD-194','Producto 194','product','quantity'
from erp.profiles p
where p.id='86000000-0000-0000-0000-000000000194'
  and not exists (select 1 from erp.product_types pt where pt.organization_id=p.organization_id and pt.item_kind='product' and pt.default_tracking_mode='quantity' and pt.is_active);

insert into erp.roles(id,organization_id,code,name,description,is_system,is_active)
select '86000000-0000-0000-0000-000000000195',p.organization_id,'test-unified-price-194','Test Unified Price','Fixture role for unified price test',false,true
from erp.profiles p
where p.id='86000000-0000-0000-0000-000000000194'
on conflict (organization_id,code) do update set is_active=true;

insert into erp.role_permissions(organization_id,role_id,permission_id,is_active)
select r.organization_id,r.id,perm.id,true
from erp.roles r
join erp.profiles p on p.organization_id=r.organization_id and p.id='86000000-0000-0000-0000-000000000194'
join erp.permissions perm on perm.code in ('catalog.view','catalog.manage','pricing.view','pricing.manage','sales.create') and perm.is_active
where r.code='test-unified-price-194'
on conflict (role_id,permission_id) do update set is_active=true,updated_at=now();

insert into erp.profile_roles(organization_id,profile_id,role_id,created_by)
select p.organization_id,p.id,r.id,p.id
from erp.profiles p
join erp.roles r on r.organization_id=p.organization_id and r.code='test-unified-price-194'
where p.id='86000000-0000-0000-0000-000000000194'
on conflict (profile_id,role_id) where branch_id is null do update
  set valid_from=clock_timestamp(),valid_until=null;
select set_config('request.jwt.claim.sub','86000000-0000-0000-0000-000000000194',true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into erp.storefront_catalog_sync(organization_id) values (erp.current_organization_id()) on conflict do nothing;
set local role authenticated;
create temp table unified_price_fixture as
select erp.create_catalog_product_with_variants('TEST-UNIFIED-PRICE-194','Unified price test','product','quantity',null,null,null,null,10,1000,21,
 '[{"code":"INHERIT","name":"Inherit","price_delta":15},{"code":"OWN","name":"Own","final_price_ars":1200}]'::jsonb) result;
create temp table unified_pos_price as select erp.resolve_catalog_effective_price((result->>'product_id')::uuid,(result->'variants'->1->>'id')::uuid) value from unified_price_fixture;
reset role;
select is((select value from unified_pos_price),
 (select erp.resolve_catalog_effective_price_internal(erp.current_organization_id(),(result->>'product_id')::uuid,(result->'variants'->1->>'id')::uuid,now()) from unified_price_fixture), 'POS and internal resolver return the same JSON');
update erp.products set publish_on_web=true,allow_online_sale=true,can_sell=true where id=(select (result->>'product_id')::uuid from unified_price_fixture);
select is((select w.price from public.product_variants w,unified_price_fixture f where w.id=(f.result->'variants'->0->>'id')::uuid),1000::numeric,'inherited initial projection');
select is((select w.price from public.product_variants w,unified_price_fixture f where w.id=(f.result->'variants'->1->>'id')::uuid),1200::numeric,'own initial projection');
update erp.products set base_sale_price=1100 where id=(select (result->>'product_id')::uuid from unified_price_fixture);
select is((select w.price from public.product_variants w,unified_price_fixture f where w.id=(f.result->'variants'->0->>'id')::uuid),1100::numeric,'parent price change updates inherited price');
select is((select w.price from public.product_variants w,unified_price_fixture f where w.id=(f.result->'variants'->1->>'id')::uuid),1200::numeric,'parent price change preserves own price');
update erp.product_variants set final_price_ars=1300 where id=(select (result->'variants'->1->>'id')::uuid from unified_price_fixture);
select is((select w.price from public.product_variants w,unified_price_fixture f where w.id=(f.result->'variants'->1->>'id')::uuid),1300::numeric,'own price change projects');
update public.product_variants set price=999 where id=(select (result->'variants'->1->>'id')::uuid from unified_price_fixture);
select is((select v.final_price_ars from erp.product_variants v,unified_price_fixture f where v.id=(f.result->'variants'->1->>'id')::uuid),1300::numeric,'public price write cannot alter ERP');
update erp.product_variants set final_price_ars=null where id=(select (result->'variants'->1->>'id')::uuid from unified_price_fixture);
select is((select w.price from public.product_variants w,unified_price_fixture f where w.id=(f.result->'variants'->1->>'id')::uuid),1100::numeric,'clearing own price restores inheritance');
select * from finish();
rollback;
