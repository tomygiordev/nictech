begin;
create extension if not exists pgtap with schema extensions;
select plan(50);
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

grant select on public.categories, public.brands, public.models, public.products, public.product_variants to authenticated;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '86000000-0000-0000-0000-000000000198',
  'authenticated', 'authenticated', 'catalog-draft-test@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Catalog Draft Test"}'::jsonb, now(), now()
);
update erp.profiles
   set organization_id = '10000000-0000-0000-0000-000000000001'
 where id = '86000000-0000-0000-0000-000000000198';
insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000198',
  '40000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000198'
) on conflict do nothing;
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000','86000000-0000-0000-0000-000000000197','authenticated','authenticated','catalog-no-manage-test@nictech.local','not-used',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{"display_name":"No catalog permission"}'::jsonb,now(),now());
update erp.profile_roles set valid_from=now()-interval '2 minutes',valid_until=now()-interval '1 minute'
where profile_id='86000000-0000-0000-0000-000000000197';
insert into erp.storefront_catalog_sync(organization_id) values ('10000000-0000-0000-0000-000000000001') on conflict do nothing;
select set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-000000000198', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

create temporary table catalog_draft_fixture as
select erp.create_catalog_product_with_variants(
  'TEST-DRAFT-PRICE-198', 'Draft price test', 'product', 'quantity',
  null, null, null, null, 10, 100, 21,
  '[{"code":"ZERO","name":"Zero","price_delta":0},
    {"code":"DELTA","name":"Delta","price_delta":25},
    {"code":"OWN","name":"Own","price_delta":25,"final_price_ars":125}]'::jsonb
) as result;

select is((select publish_on_web from erp.products where id =
  (select (result->>'product_id')::uuid from catalog_draft_fixture)), false, 'new product is not published');
select is((select allow_online_sale from erp.products where id =
  (select (result->>'product_id')::uuid from catalog_draft_fixture)), false, 'new product is not online-sale enabled');
select is((select count(*)::int from public.products where id =
  (select (result->>'product_id')::uuid from catalog_draft_fixture)), 0, 'draft has no storefront row');
select is((select (erp.resolve_catalog_effective_price(
  (result->>'product_id')::uuid, (result->'variants'->0->>'id')::uuid)->>'final_price_ars')::numeric
  from catalog_draft_fixture), 100::numeric, 'zero delta inherits parent');
select is((select (erp.resolve_catalog_effective_price(
  (result->>'product_id')::uuid, (result->'variants'->1->>'id')::uuid)->>'final_price_ars')::numeric
  from catalog_draft_fixture), 100::numeric, 'non-zero delta is ignored');
select is((select (erp.resolve_catalog_effective_price(
  (result->>'product_id')::uuid, (result->'variants'->2->>'id')::uuid)->>'final_price_ars')::numeric
  from catalog_draft_fixture), 125::numeric, 'absolute variant price overrides parent');
select is((select ((result->'variants'->1)->>'effective_price_ars')::numeric
  from catalog_draft_fixture), 100::numeric, 'creation response ignores delta');
select lives_ok('select web_status, tags from erp.products limit 1','authenticated can select sheet columns');
select lives_ok('select * from erp.active_catalog_products limit 1','authenticated can select active product view');
select is((select web_status from erp.products where id =
  (select (result->>'product_id')::uuid from catalog_draft_fixture)), 'draft'::text, 'active unpublished product is draft');
select is((select tags from erp.products where id =
  (select (result->>'product_id')::uuid from catalog_draft_fixture)), '{}'::text[], 'tags default to an empty array');
update erp.products set is_active = false where id =
  (select (result->>'product_id')::uuid from catalog_draft_fixture);
select is((select web_status from erp.products where id =
  (select (result->>'product_id')::uuid from catalog_draft_fixture)), 'paused'::text, 'inactive product is paused');

-- Fixtures for the sheet command. The complete transaction is rolled back.
insert into erp.product_categories(id,organization_id,code,name,code_prefix)
values('86000000-0000-0000-0000-000000000196',erp.current_organization_id(),'SHEET-198','Sheet test','SHT');
insert into erp.brands(id,organization_id,code,name)
values('86000000-0000-0000-0000-000000000195',erp.current_organization_id(),'SHEET-198','Sheet brand');
create temporary table sheet_refs as
select '86000000-0000-0000-0000-000000000196'::uuid category_id,
       '86000000-0000-0000-0000-000000000195'::uuid brand_id;
create temporary table sheet_result as
select erp.save_catalog_product_sheet(jsonb_build_object(
 'internal_name','  Cable   de prueba  ','category_id',category_id,'brand_id',brand_id,
 'sheet_template','accesorio','base_cost',10,'base_sale_price',100,'tags',jsonb_build_array('cable'),'condition','nuevo','capacity','128GB'
)) result from sheet_refs;
select is((select result->'product'->>'internal_name' from sheet_result),'Cable de prueba','sheet normalizes spaces');
select is((select result->'product'->>'web_status' from sheet_result),'draft','sheet starts in draft');
select ok((select (erp.get_catalog_publish_checklist((result->'product'->>'id')::uuid)->'missing') ? 'missing_primary_image' from sheet_result),'checklist detects missing image');
select throws_ok($$select erp.publish_catalog_product((result->'product'->>'id')::uuid) from sheet_result$$,'23514',null,'publish without image fails');
select throws_like($$select erp.publish_catalog_product((result->'product'->>'id')::uuid) from sheet_result$$,'%missing_primary_image%','publish error lists missing image');
select throws_ok($$select erp.save_catalog_product_sheet(jsonb_build_object(
 'internal_name','ATOMIC-INVALID-198','category_id',category_id,'brand_id',brand_id,
 'base_cost',10,'media',jsonb_build_array(jsonb_build_object('storage_path','url','sort_order',0),jsonb_build_object('storage_path','url2','sort_order',0)))) from sheet_refs$$,
 '23505',null,'conflicting media fails the sheet transaction');
select is((select count(*)::int from erp.products where internal_name='ATOMIC-INVALID-198'),0,'failed sheet leaves no product');
select lives_ok($$select erp.save_catalog_product_sheet(jsonb_build_object(
 'id',result->'product'->>'id','base_sale_price',100.001,
 'media',jsonb_build_array(jsonb_build_object('storage_path','https://example.test/product_images/photo.jpg','sort_order',0,'is_primary',true),jsonb_build_object('storage_path','https://example.test/product_images/second.jpg','sort_order',1)))) from sheet_result$$,'save photo and three-decimal draft');
select ok((select (erp.get_catalog_publish_checklist((result->'product'->>'id')::uuid)->'missing') ? 'base_price_precision' from sheet_result),'checklist detects three decimal price');
select throws_ok($$select erp.publish_catalog_product((result->'product'->>'id')::uuid) from sheet_result$$,'23514',null,'publish rejects three decimals');
select lives_ok($$select erp.save_catalog_product_sheet(jsonb_build_object('id',result->'product'->>'id','base_sale_price',100,'public_description','Descripción')) from sheet_result$$,'edit description and valid price');
select is((select internal_name from erp.products where id=(select (result->'product'->>'id')::uuid from sheet_result)),'Cable de prueba','editing description preserves name');
select is((select count(*)::int from erp.stock_balances where product_id=(select (result->'product'->>'id')::uuid from sheet_result)),0,'sheet editing does not create stock');
select lives_ok($$select erp.recode_catalog_product((result->'product'->>'id')::uuid,'SHT-9900') from sheet_result$$,'explicit recode succeeds');
select is((select internal_code from erp.products where id=(select (result->'product'->>'id')::uuid from sheet_result)),'SHT-9900','explicit recode sets code');


reset role;
select throws_ok($$update erp.products set internal_code='BLOCKED' where id=(select (result->'product'->>'id')::uuid from sheet_result)$$,'23000',null,'direct code reassignment is blocked');
set local role authenticated;
select lives_ok($$select erp.save_catalog_product_sheet(jsonb_build_object('id',result->'product'->>'id','variants',jsonb_build_array(jsonb_build_object('code','BLUE','name','Azul','final_price_mode','own','final_price_ars',100.001)))) from sheet_result$$,'draft variant can carry three decimals');
select ok((select (erp.get_catalog_publish_checklist((result->'product'->>'id')::uuid)->'missing') ? 'variant_price_precision' from sheet_result),'checklist detects variant precision');
select lives_ok($$select erp.save_catalog_product_sheet(jsonb_build_object('id',result->'product'->>'id','variants',jsonb_build_array(jsonb_build_object('id',(select id from erp.product_variants where product_id=(result->'product'->>'id')::uuid and code='BLUE'),'code','BLUE','name','Azul','final_price_mode','own','final_price_ars',100)))) from sheet_result$$,'fix variant price');
select lives_ok($$select erp.publish_catalog_product((result->'product'->>'id')::uuid) from sheet_result$$,'publish complete sheet');
select is((select tags from public.products where id=(select (result->'product'->>'id')::uuid from sheet_result)),array['cable']::text[],'storefront projects tags');
select is((select image_url from public.products where id=(select (result->'product'->>'id')::uuid from sheet_result)),'https://example.test/product_images/photo.jpg','storefront projects primary image');

select is((select condition from public.products where id=(select (result->'product'->>'id')::uuid from sheet_result)),'Nuevo','storefront projects condition');
select is((select capacity from public.products where id=(select (result->'product'->>'id')::uuid from sheet_result)),'128GB','storefront projects capacity');
select is((select additional_images from public.products where id=(select (result->'product'->>'id')::uuid from sheet_result)),array['https://example.test/product_images/second.jpg']::text[],'storefront projects gallery');
select is((select count(*)::int from public.product_variants where product_id=(select (result->'product'->>'id')::uuid from sheet_result) and is_active),1,'publishing a draft projects its variants');
select throws_ok($$update erp.products set base_sale_price=100.001 where id=(select (result->'product'->>'id')::uuid from sheet_result)$$,'23514',null,'published price guard rejects three decimals');
select lives_ok($$select erp.unpublish_catalog_product((result->'product'->>'id')::uuid) from sheet_result$$,'pause published product');
select is((select web_status from erp.products where id=(select (result->'product'->>'id')::uuid from sheet_result)),'paused','paused state is derived');
select throws_ok($$select erp.save_catalog_product_sheet(jsonb_build_object('id',result->'product'->>'id','public_description','stale'),'2000-01-01T00:00:00Z') from sheet_result$$,'23514',null,'stale sheet update rejected');
select ok((select (result->'product'->>'internal_code') ~ '^SHT-[0-9]{4,}$' from sheet_result),'automatic category code allocated');
create temporary table sheet_color as select erp.save_catalog_color('Azul','#0033FF') result;
select lives_ok($$select erp.save_catalog_product_sheet(jsonb_build_object('id',result->'product'->>'id','variants',jsonb_build_array(jsonb_build_object('id',(select id from erp.product_variants where product_id=(result->'product'->>'id')::uuid and code='BLUE'),'code','BLUE','name','Azul','color_id',(select result->>'id' from sheet_color),'final_price_mode','inherit')))) from sheet_result$$,'assign catalog color');
select is((select color_id from erp.product_variants where product_id=(select (result->'product'->>'id')::uuid from sheet_result) and code='BLUE'),(select (result->>'id')::uuid from sheet_color),'variant stores color reference');
select lives_ok($$select erp.save_catalog_product_sheet(jsonb_build_object('id',result->'product'->>'id','variants',jsonb_build_array(jsonb_build_object('code','PAUSED','name','Pausada','is_active',false,'final_price_mode','inherit')))) from sheet_result$$,'add paused variant');
select is((select jsonb_array_length(erp.get_catalog_product_variants((result->'product'->>'id')::uuid)) from sheet_result),1,'default getter omits inactive variants');
update erp.products set is_active=false where id=(select (result->'product'->>'id')::uuid from sheet_result);
select is((select (v->>'effective_price_ars')::numeric from sheet_result cross join lateral jsonb_array_elements(erp.get_catalog_product_variants((result->'product'->>'id')::uuid,true)) v where v->>'code'='PAUSED'),100::numeric,'include inactive preserves inactive parent price');
select set_config('request.jwt.claim.sub','86000000-0000-0000-0000-000000000197',true);
select throws_ok($$select erp.save_catalog_product_sheet('{}'::jsonb)$$,'42501',null,'sheet requires catalog.manage');
select throws_ok($$select erp.recode_catalog_product('00000000-0000-0000-0000-000000000000','XXX-1')$$,'42501',null,'recode requires catalog.manage');
select set_config('request.jwt.claim.sub','86000000-0000-0000-0000-000000000198',true);
select * from finish();
rollback;
