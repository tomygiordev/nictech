begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000','99000000-0000-0000-0000-000000000001','authenticated','authenticated','audit-admin@nictech.local','x',now(),'{"provider":"email"}','{"display_name":"Audit Admin"}',now(),now());
update erp.profiles set organization_id='10000000-0000-0000-0000-000000000001' where id='99000000-0000-0000-0000-000000000001';
insert into erp.profile_roles (organization_id,profile_id,role_id,created_by)
values ('10000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001') on conflict do nothing;
insert into erp.brands(id,organization_id,code,name)
values ('99000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','AUD-BR','AuditBrand');
insert into erp.organizations(id,legal_name,display_name,timezone,default_currency)
values('99000000-0000-0000-0000-000000000093','Audit org','Audit org','America/Argentina/Buenos_Aires','ARS');
select is((select count(*) from erp.brands where organization_id='99000000-0000-0000-0000-000000000093' and name='Genérico'),1::bigint,'new organization gets generic brand');
select is((select code from erp.brands where organization_id='99000000-0000-0000-0000-000000000093' and name='Genérico'),'GENERICO','generic code is deterministic');
insert into erp.product_categories(organization_id,code,name) values('99000000-0000-0000-0000-000000000093','ACCENT','Cámaras y Cables');
select is((select code_prefix from erp.product_categories where organization_id='99000000-0000-0000-0000-000000000093' and code='ACCENT'),'CAM','category prefix transliterates accents');
select set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into erp.product_categories(id,organization_id,code,name) values('99000000-0000-0000-0000-000000000091',erp.current_organization_id(),'NO-WEB','No web');
set local role authenticated;
create temporary table no_web_sheet as select erp.save_catalog_product_sheet(jsonb_build_object('internal_name','No storefront','category_id','99000000-0000-0000-0000-000000000091','brand_id','99000000-0000-0000-0000-0000000000b1','base_cost',1,'base_sale_price',10)) value;
select ok((select (value->'product'->>'id') is not null from no_web_sheet),'create works with no public.products');
create temporary table no_web_legacy as select erp.create_catalog_product_with_variants('NO-WEB-OLD','No web legacy','product','quantity','99000000-0000-0000-0000-000000000091','99000000-0000-0000-0000-0000000000b1',null,null,0,10,21,'[]') value;
select lives_ok($$select erp.save_catalog_product_sheet(jsonb_build_object('id',value->>'product_id','public_description','new')) from no_web_legacy$$,'edit works with no public.products');
select is((select public_description from erp.products where id=(select (value->>'product_id')::uuid from no_web_legacy)),'new','edit persisted within transaction');
select * from finish();
rollback;
