begin;
set local search_path=public,extensions,pg_catalog;
select plan(50);

create temp table promo_fixture as
select o.id org, gen_random_uuid() product, gen_random_uuid() variant,
  gen_random_uuid() draft_product, gen_random_uuid() inactive_variant,
  gen_random_uuid() frac_product, gen_random_uuid() frac_variant,
  gen_random_uuid() admin_id, gen_random_uuid() sales_id,
  gen_random_uuid() manager_id, gen_random_uuid() viewer_id, gen_random_uuid() nopricing_id,
  gen_random_uuid() manager_role_id, gen_random_uuid() viewer_role_id, gen_random_uuid() nopricing_role_id,
  gen_random_uuid() promo_id,
  gen_random_uuid() pct_promo_id, gen_random_uuid() fixed_no_beat_promo_id, gen_random_uuid() fixed_beat_promo_id,
  (date_trunc('second', now()) + interval '3 days') timed_ends_at
from erp.organizations o order by o.created_at limit 1;
grant select on promo_fixture to authenticated,anon,service_role;

insert into auth.users(id,email,raw_user_meta_data) select admin_id,admin_id::text||'@example.test','{}'::jsonb from promo_fixture;
insert into auth.users(id,email,raw_user_meta_data) select sales_id,sales_id::text||'@example.test','{}'::jsonb from promo_fixture;
insert into erp.profiles(id,organization_id,display_name)
select admin_id,org,'Promo admin' from promo_fixture on conflict(id) do update set organization_id=excluded.organization_id,is_active=true;
insert into erp.profiles(id,organization_id,display_name)
select sales_id,org,'Promo sales' from promo_fixture on conflict(id) do update set organization_id=excluded.organization_id,is_active=true;
insert into erp.profile_roles(organization_id,profile_id,role_id)
select f.org,f.admin_id,r.id from promo_fixture f join erp.roles r on r.organization_id=f.org and r.code='owner' on conflict do nothing;
insert into erp.profile_roles(organization_id,profile_id,role_id)
select f.org,f.sales_id,r.id from promo_fixture f join erp.roles r on r.organization_id=f.org and r.code='sales' on conflict do nothing;
insert into erp.products(id,organization_id,product_type_id,item_kind,unit_id,internal_code,internal_name,inventory_tracking,base_sale_price)
select f.product,f.org,t.id,'product',u.id,'PROMO-'||f.product::text,'Promo fixture','quantity',100
from promo_fixture f join erp.product_types t on t.organization_id=f.org and t.code='PRODUCT'
join erp.units_of_measure u on u.organization_id=f.org and u.code='UN';
insert into erp.products(id,organization_id,product_type_id,item_kind,unit_id,internal_code,internal_name,inventory_tracking,base_sale_price,publish_on_web,allow_online_sale,can_sell)
select f.draft_product,f.org,t.id,'product',u.id,'DRAFT-'||f.draft_product::text,'Draft fixture','quantity',50,false,false,true
from promo_fixture f join erp.product_types t on t.organization_id=f.org and t.code='PRODUCT'
join erp.units_of_measure u on u.organization_id=f.org and u.code='UN';
insert into erp.product_variants(id,organization_id,product_id,code,name,final_price_ars)
select variant,org,product,'OWN','Own',120 from promo_fixture;
insert into erp.product_variants(id,organization_id,product_id,code,name,final_price_ars,is_active)
select inactive_variant,org,product,'INACT','Inactive',130,false from promo_fixture;
insert into erp.products(id,organization_id,product_type_id,item_kind,unit_id,internal_code,internal_name,inventory_tracking,base_sale_price)
select f.frac_product,f.org,t.id,'product',u.id,'FRAC-'||f.frac_product::text,'Fractional promo fixture','quantity',100.0050
from promo_fixture f join erp.product_types t on t.organization_id=f.org and t.code='PRODUCT'
join erp.units_of_measure u on u.organization_id=f.org and u.code='UN';
insert into erp.product_variants(id,organization_id,product_id,code,name,final_price_ars)
select frac_variant,org,frac_product,'FRAC4','Frac 100.0040',100.0040 from promo_fixture;
insert into erp.storefront_catalog_sync(organization_id) select org from promo_fixture on conflict do nothing;
update erp.products set publish_on_web=true,allow_online_sale=true,can_sell=true where id=(select product from promo_fixture);

insert into erp.promotions(id,organization_id,name,kind,value,starts_at,ends_at,channels)
select promo_id,org,'Percentage','porcentaje',20,now()-interval '1 day',now()+interval '1 day',array['web','pos'] from promo_fixture;
insert into erp.promotion_targets(organization_id,promotion_id,product_id)
select org,promo_id,product from promo_fixture;

select is((erp.resolve_catalog_price_for_channel(org,product,null,now()-interval '2 days','web')->>'final_price_ars')::numeric,100::numeric,'before start list price') from promo_fixture;
select is((erp.resolve_catalog_price_for_channel(org,product,null,now(),'web')->>'final_price_ars')::numeric,80::numeric,'during percentage promotion') from promo_fixture;
select is((erp.resolve_catalog_price_for_channel(org,product,null,now()+interval '1 day','web')->>'final_price_ars')::numeric,100::numeric,'end is exclusive') from promo_fixture;
select is((erp.resolve_catalog_price_for_channel(org,product,variant,now(),'web')->>'final_price_ars')::numeric,96::numeric,'variant own price receives product promotion') from promo_fixture;
update erp.promotions set ends_at=null where id=(select promo_id from promo_fixture);
select is((erp.resolve_catalog_price_for_channel(org,product,null,now()+interval '10 years','web')->>'final_price_ars')::numeric,80::numeric,'no end remains valid') from promo_fixture;

select set_config('request.jwt.claim.sub',(select admin_id::text from promo_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
create temp table promo_result(id uuid);
insert into promo_result select erp.upsert_promotion(null,'Fixed','precio_fijo',70,now()-interval '1 hour',null,true,array['web','pos'],
  jsonb_build_array(jsonb_build_object('product_id',product,'variant_id',variant))) from promo_fixture;
select is((select count(*) from erp.promotions),2::bigint,'owner sees promotions');
select is((erp.resolve_catalog_effective_price(product,variant)->>'final_price_ars')::numeric,70::numeric,'best fixed price wins over percentage at POS') from promo_fixture;
select throws_ok($$select erp.upsert_promotion(null,'bad','porcentaje',101,now(),null,true,array['web'],'[]'::jsonb)$$,'22023',null,'invalid percent and targets rejected');
select throws_ok($$select erp.upsert_promotion(null,'bad','precio_fijo',1.001,now(),null,true,array['web'],(select jsonb_build_array(jsonb_build_object('product_id',product)) from promo_fixture))$$,'22023',null,'three decimals rejected');
select throws_ok($$insert into erp.promotions(organization_id,name,kind,value,starts_at,channels) select org,'direct','precio_fijo',1,now(),array['web'] from promo_fixture$$,'42501',null,'writes must use checked RPC');
select erp.set_promotion_active((select id from promo_result),false);
select is((erp.resolve_catalog_effective_price(product,variant)->>'final_price_ars')::numeric,96::numeric,'deactivation restores percentage') from promo_fixture;
select erp.set_promotion_active((select id from promo_result),true);
reset role;

select set_config('request.jwt.claim.role','service_role',true);
select is((erp.resolve_catalog_effective_price_internal(org,product,variant,now())->>'final_price_ars')::numeric,70::numeric,'checkout resolver returns promotional price') from promo_fixture;
select is((erp.resolve_catalog_effective_price_internal(org,product,variant,now())->>'list_price_ars')::numeric,120::numeric,'resolver preserves list price') from promo_fixture;
select is((erp.resolve_catalog_price_for_channel(org,product,variant,now(),'web')->>'final_price_ars')::numeric,70::numeric,'explicit web channel') from promo_fixture;
select is((select effective_price from public.storefront_promotion_prices where variant_id=(select variant from promo_fixture)),70::numeric,'published variant view exposes effective price');
select is((select list_price from public.storefront_promotion_prices where variant_id=(select variant from promo_fixture)),120::numeric,'published variant view exposes list price');
select ok(not has_table_privilege('anon','erp.promotions','select'),'anon cannot read promotions directly');
select ok(not has_table_privilege('anon','erp.promotion_targets','insert'),'anon cannot write targets directly');
select ok(not has_function_privilege('anon','erp.upsert_promotion(uuid,text,text,numeric,timestamptz,timestamptz,boolean,text[],jsonb)','execute'),'anon cannot invoke upsert');
select ok(has_table_privilege('anon','public.storefront_promotion_prices','select'),'anon can read published projection');
set local role anon;
select is((select effective_price from public.storefront_promotion_prices where variant_id=(select variant from promo_fixture)),70::numeric,'anon can read published variant price');
reset role;
select set_config('request.jwt.claim.sub',(select sales_id::text from promo_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select is((select count(*) from erp.promotions),2::bigint,'sales with pricing.view sees promotions');
select throws_ok($$select erp.set_promotion_active((select promo_id from promo_fixture),false)$$,'42501',null,'non-admin cannot deactivate');
select throws_ok($$select erp.upsert_promotion(null,'bad','precio_fijo',1,now(),null,true,array['web'],(select jsonb_build_array(jsonb_build_object('product_id',product)) from promo_fixture))$$,'42501',null,'non-admin cannot upsert');
reset role;

-- Additional checks for P-1, P-1b, P-2, P-3
select is((select count(*) from public.storefront_promotion_prices where product_id=(select draft_product from promo_fixture)),0::bigint,'unpublished product omitted from storefront view');
select is(public.storefront_web_price((select draft_product from promo_fixture),null),null::jsonb,'storefront_web_price returns null for unpublished product');
select is(public.storefront_web_price((select product from promo_fixture),(select inactive_variant from promo_fixture)),null::jsonb,'storefront_web_price returns null for inactive variant');
select is(public.storefront_web_price((select product from promo_fixture),gen_random_uuid()),null::jsonb,'storefront_web_price returns null for unknown variant');
select ok(has_function_privilege('anon','public.storefront_web_price(uuid, uuid)','execute'),'anon can execute storefront_web_price');

insert into auth.users(id,email,raw_user_meta_data) select manager_id,manager_id::text||'@example.test','{}'::jsonb from promo_fixture;
insert into auth.users(id,email,raw_user_meta_data) select viewer_id,viewer_id::text||'@example.test','{}'::jsonb from promo_fixture;
insert into auth.users(id,email,raw_user_meta_data) select nopricing_id,nopricing_id::text||'@example.test','{}'::jsonb from promo_fixture;
insert into erp.profiles(id,organization_id,display_name)
select manager_id,org,'Promo manager' from promo_fixture on conflict(id) do update set organization_id=excluded.organization_id,is_active=true;
insert into erp.profiles(id,organization_id,display_name)
select viewer_id,org,'Promo viewer' from promo_fixture on conflict(id) do update set organization_id=excluded.organization_id,is_active=true;
insert into erp.profiles(id,organization_id,display_name)
select nopricing_id,org,'Promo nopricing' from promo_fixture on conflict(id) do update set organization_id=excluded.organization_id,is_active=true;

insert into erp.roles(id,organization_id,code,name)
select manager_role_id,org,'custom-pricing-mgr-'||manager_role_id::text,'Custom Pricing Manager' from promo_fixture;
insert into erp.role_permissions(organization_id,role_id,permission_id)
select f.org,f.manager_role_id,p.id from promo_fixture f join erp.permissions p on p.code='pricing.manage';
insert into erp.profile_roles(organization_id,profile_id,role_id)
select org,manager_id,manager_role_id from promo_fixture;

insert into erp.roles(id,organization_id,code,name)
select viewer_role_id,org,'custom-pricing-view-'||viewer_role_id::text,'Custom Pricing Viewer' from promo_fixture;
insert into erp.role_permissions(organization_id,role_id,permission_id)
select f.org,f.viewer_role_id,p.id from promo_fixture f join erp.permissions p on p.code='pricing.view';
insert into erp.profile_roles(organization_id,profile_id,role_id)
select org,viewer_id,viewer_role_id from promo_fixture;

insert into erp.roles(id,organization_id,code,name)
select nopricing_role_id,org,'custom-no-pricing-'||nopricing_role_id::text,'Custom No Pricing' from promo_fixture;
insert into erp.role_permissions(organization_id,role_id,permission_id)
select f.org,f.nopricing_role_id,p.id from promo_fixture f join erp.permissions p on p.code='catalog.view';
insert into erp.profile_roles(organization_id,profile_id,role_id)
select org,nopricing_id,nopricing_role_id from promo_fixture;

select set_config('request.jwt.claim.sub',(select manager_id::text from promo_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok($$select erp.upsert_promotion(null,'Timed web','precio_fijo',55,now()-interval '1 hour',(select timed_ends_at from promo_fixture),true,array['web'],(select jsonb_build_array(jsonb_build_object('product_id',product)) from promo_fixture))$$,'custom role with pricing.manage can upsert promotion');
select is((select count(*) from erp.promotions),3::bigint,'custom role with pricing.manage can read promotions');
select throws_ok($$select erp.upsert_promotion(null,'bad100','porcentaje',100,now(),null,true,array['web'],(select jsonb_build_array(jsonb_build_object('product_id',product)) from promo_fixture))$$,'22023',null,'100 percent rejected by upsert_promotion');
reset role;

set local role anon;
select is((select promotion_ends_at from public.storefront_promotion_prices where product_id=(select product from promo_fixture) and variant_id is null),(select timed_ends_at from promo_fixture),'anon sees winning promotion_ends_at in view');
select is((public.storefront_web_price((select product from promo_fixture),null)->>'promotion_ends_at')::timestamptz,(select timed_ends_at from promo_fixture),'anon sees winning promotion_ends_at in storefront_web_price');
select is((select effective_price from public.storefront_promotion_prices where product_id=(select product from promo_fixture) and variant_id is null),55::numeric,'anon sees updated effective_price for product without variant');
reset role;

select set_config('request.jwt.claim.sub',(select viewer_id::text from promo_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select is((select count(*) from erp.promotions),3::bigint,'pricing.view reads promotions');
select ok((select count(*) > 0 from erp.promotion_targets),'pricing.view reads promotion targets');
select throws_ok($$select erp.upsert_promotion(null,'badview','precio_fijo',10,now(),null,true,array['web'],(select jsonb_build_array(jsonb_build_object('product_id',product)) from promo_fixture))$$,'42501',null,'pricing.view cannot upsert promotion');
select throws_ok($$select erp.set_promotion_active((select promo_id from promo_fixture),false)$$,'42501',null,'pricing.view cannot toggle promotion');
reset role;

select set_config('request.jwt.claim.sub',(select nopricing_id::text from promo_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select is((select count(*) from erp.promotions),0::bigint,'no-pricing role sees 0 promotions');
select is((select count(*) from erp.promotion_targets),0::bigint,'no-pricing role sees 0 promotion targets');
select throws_ok($$select erp.upsert_promotion(null,'badnopr','precio_fijo',10,now(),null,true,array['web'],(select jsonb_build_array(jsonb_build_object('product_id',product)) from promo_fixture))$$,'42501',null,'no-pricing role cannot upsert promotion');
select throws_ok($$select erp.set_promotion_active((select promo_id from promo_fixture),false)$$,'42501',null,'no-pricing role cannot toggle promotion');
reset role;

select throws_ok($$insert into erp.promotions(organization_id,name,kind,value,starts_at,channels) select org,'bad100tbl','porcentaje',100,now(),array['web'] from promo_fixture$$,'23514',null,'100 percent rejected by table check');

-- Fractional list price rounding edge cases
insert into erp.promotions(id,organization_id,name,kind,value,starts_at,ends_at,channels)
select pct_promo_id,org,'Frac 10%','porcentaje',10,now()+interval '1 hour',now()+interval '2 hours',array['web','pos'] from promo_fixture
union all
select fixed_no_beat_promo_id,org,'Frac fixed 100.01','precio_fijo',100.01,now()+interval '3 hours',now()+interval '4 hours',array['web','pos'] from promo_fixture
union all
select fixed_beat_promo_id,org,'Frac fixed 100.00','precio_fijo',100.00,now()+interval '5 hours',now()+interval '6 hours',array['web','pos'] from promo_fixture;

insert into erp.promotion_targets(organization_id,promotion_id,product_id,variant_id)
select org,pct_promo_id,frac_product,null::uuid from promo_fixture
union all
select org,fixed_no_beat_promo_id,frac_product,null::uuid from promo_fixture
union all
select org,fixed_beat_promo_id,frac_product,frac_variant from promo_fixture;

select is((erp.resolve_catalog_price_for_channel(org,frac_product,null,now(),'web')->>'final_price_ars')::numeric,100.0050::numeric,'no promo preserves 4-decimal final_price_ars') from promo_fixture;
select is((erp.resolve_catalog_price_for_channel(org,frac_product,null,now(),'web')->>'list_price_ars')::numeric,100.0050::numeric,'no promo preserves 4-decimal list_price_ars') from promo_fixture;
select is((erp.resolve_catalog_price_for_channel(org,frac_product,null,now()+interval '90 minutes','web')->>'final_price_ars')::numeric,90.00::numeric,'percentage promo rounds only final result from unrounded list price') from promo_fixture;
select is((erp.resolve_catalog_price_for_channel(org,frac_product,null,now()+interval '90 minutes','web')->>'list_price_ars')::numeric,100.0050::numeric,'percentage promo preserves unrounded list_price_ars') from promo_fixture;
select is(erp.resolve_catalog_price_for_channel(org,frac_product,null,now()+interval '210 minutes','web')->>'promotion_id',null,'fixed promo above unrounded list price does not apply') from promo_fixture;
select is((erp.resolve_catalog_price_for_channel(org,frac_product,frac_variant,now()+interval '330 minutes','web')->>'final_price_ars')::numeric,100.00::numeric,'fixed promo below 4-decimal variant list price applies') from promo_fixture;

select * from finish();
rollback;
