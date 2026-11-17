-- Project a single ERP row without changing stock or legacy promotion columns.
create or replace function erp.project_catalog_sheet(p_org uuid,p_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,erp,public,pg_temp as $$
declare p erp.products%rowtype; v_image text; v_gallery text[]; v_visible boolean; v_tags text[]; v_condition text; v_capacity text; v_inserted integer; v_public jsonb;
begin
 if to_regclass('public.products') is null or to_regclass('public.product_variants') is null then return; end if;
 if not exists(select 1 from erp.storefront_catalog_sync where organization_id=p_org) then return; end if;
 select * into p from erp.products where id=p_id and organization_id=p_org and item_kind='product';
 if not found then return; end if;
 select coalesce((select m.storage_path from erp.product_media m where m.organization_id=p_org and m.product_id=p_id and m.variant_id is null and m.is_active and m.is_primary limit 1),p.web_image_path) into v_image;
 execute 'select to_jsonb(w) from public.products w where id=$1' into v_public using p_id;
 if p.media_initialized then
  select coalesce(array_agg(m.storage_path order by m.sort_order,m.id),'{}') into v_gallery from erp.product_media m where m.organization_id=p_org and m.product_id=p_id and m.variant_id is null and m.is_active and not m.is_primary;
 else
  select coalesce(array_agg(x.value order by x.ord),'{}') into v_gallery from jsonb_array_elements_text(case when jsonb_typeof(v_public->'additional_images')='array' then v_public->'additional_images' else '[]'::jsonb end) with ordinality x(value,ord);
 end if;
 if p.sheet_fields_initialized then
  v_tags:=p.tags; v_condition:=initcap(p.condition); v_capacity:=p.capacity;
 else
  select coalesce(array_agg(x.value order by x.ord),p.tags) into v_tags from jsonb_array_elements_text(case when jsonb_typeof(v_public->'tags')='array' then v_public->'tags' else '[]'::jsonb end) with ordinality x(value,ord);
  v_condition:=v_public->>'condition'; v_capacity:=v_public->>'capacity';
 end if;
 v_visible:=p.is_active and p.publish_on_web and p.allow_online_sale and p.can_sell;
 if v_public is not null then
  update public.products set name=coalesce(nullif(p.public_name,''),p.internal_name),description=p.public_description,
   price=p.base_sale_price,image_url=v_image,is_active=v_visible,category_id=p.category_id,brand_id=p.brand_id,model_id=p.model_id
  where id=p_id and (name,description,price,image_url,is_active,category_id,brand_id,model_id)
   is distinct from (coalesce(nullif(p.public_name,''),p.internal_name),p.public_description,p.base_sale_price,v_image,v_visible,p.category_id,p.brand_id,p.model_id);
 elsif v_visible then
  insert into public.products(id,name,description,price,image_url,stock,is_active,category_id,brand_id,model_id)
  values(p.id,coalesce(nullif(p.public_name,''),p.internal_name),p.public_description,p.base_sale_price,v_image,0,true,p.category_id,p.brand_id,p.model_id);
  perform erp.project_storefront_product_stock(p_org,p_id);
 else
  return;
 end if;
 if exists(select 1 from pg_attribute where attrelid=to_regclass('public.products') and attname='additional_images' and not attisdropped) then
  execute 'update public.products set additional_images=$1 where id=$2 and coalesce(additional_images, ''{}''::text[]) is distinct from $1' using v_gallery,p_id;
 end if;
 if exists(select 1 from pg_attribute where attrelid=to_regclass('public.products') and attname='tags' and not attisdropped) then
  execute 'update public.products set tags=$1 where id=$2 and coalesce(tags, ''{}''::text[]) is distinct from $1' using v_tags,p_id;
 end if;
 if exists(select 1 from pg_attribute where attrelid=to_regclass('public.products') and attname='condition' and not attisdropped) then
  execute 'update public.products set condition=$1 where id=$2 and condition is distinct from $1' using v_condition,p_id;
 end if;
 if exists(select 1 from pg_attribute where attrelid=to_regclass('public.products') and attname='capacity' and not attisdropped) then
  execute 'update public.products set capacity=$1 where id=$2 and capacity is distinct from $1' using v_capacity,p_id;
 end if;
 -- Variants created while the parent was a draft have no public row yet.
 if v_visible then
  insert into public.product_variants(id,product_id,color,image_url,stock,is_active)
  select v.id,v.product_id,coalesce(nullif(v.attributes->>'color',''),v.name),v.image_path,0,v.is_active
  from erp.product_variants v where v.organization_id=p_org and v.product_id=p_id
   and not exists(select 1 from public.product_variants w where w.id=v.id)
  on conflict(id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted>0 then perform erp.project_storefront_product_stock(p_org,p_id); end if;
 end if;
end $$;
revoke all on function erp.project_catalog_sheet(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function erp.sync_erp_product_to_storefront()
returns trigger language plpgsql security definer set search_path=pg_catalog,erp,public,pg_temp as $$
begin
 if pg_trigger_depth()>1 then return new; end if;
 perform erp.project_catalog_sheet(new.organization_id,new.id);
 return new;
end $$;
create or replace function erp.sync_erp_media_to_storefront()
returns trigger language plpgsql security definer set search_path=pg_catalog,erp,public,pg_temp as $$
begin
 if pg_trigger_depth()>1 then return new; end if;
 perform erp.project_catalog_sheet(new.organization_id,new.product_id);
 return new;
end $$;
revoke all on function erp.sync_erp_media_to_storefront() from public,anon,authenticated,service_role;
create trigger product_media_storefront_sync after insert or update on erp.product_media for each row execute function erp.sync_erp_media_to_storefront();
drop trigger a_erp_product_storefront_catalog on erp.products;
create trigger a_erp_product_storefront_catalog after insert or update of internal_name,public_name,public_description,base_sale_price,web_image_path,is_active,publish_on_web,allow_online_sale,can_sell,category_id,brand_id,model_id,tags,condition,capacity,media_initialized,sheet_fields_initialized on erp.products for each row execute function erp.sync_erp_product_to_storefront();

create or replace function erp.sync_storefront_product_to_erp()
returns trigger language plpgsql security definer set search_path=pg_catalog,erp,public,pg_temp as $$
declare target_org uuid; existing erp.products%rowtype; resolved_category uuid; resolved_brand uuid; resolved_model uuid;
 v_type uuid; v_unit uuid; img text; ord integer:=0; old_row boolean; v_condition text; v_tags text[]; v_capacity text; v_legacy_condition boolean; v_images text[];
begin
 if pg_trigger_depth()>1 then return coalesce(new,old); end if;
 if (select count(*) from erp.storefront_catalog_sync)<>1 then return coalesce(new,old); end if;
 select organization_id into target_org from erp.storefront_catalog_sync;
 if not erp.storefront_catalog_write_allowed(target_org) then raise exception using errcode='42501',message='catalog.manage is required for storefront catalog changes'; end if;
 if tg_op='DELETE' then
  update erp.products set is_active=false,publish_on_web=false,allow_online_sale=false where id=old.id and organization_id=target_org;
  return old;
 end if;
 select * into existing from erp.products where id=new.id;
 old_row:=found;
 if old_row and existing.organization_id<>target_org then raise exception using errcode='23505',message='storefront UUID belongs to another ERP organization'; end if;
 resolved_category:=nullif(to_jsonb(new)->>'category_id','')::uuid;
 resolved_model:=nullif(to_jsonb(new)->>'model_id','')::uuid;
 resolved_brand:=coalesce(nullif(to_jsonb(new)->>'brand_id','')::uuid,(select brand_id from erp.product_models where id=resolved_model and organization_id=target_org));
 if nullif(btrim(new.name),'') is null or new.price is null or new.price<0 or new.price>99999999999999.9999 or new.price='NaN'::numeric then raise exception using errcode='23514',message='invalid storefront product name or price'; end if;
 v_condition:=lower(nullif(btrim(to_jsonb(new)->>'condition'),''));
 v_legacy_condition:=v_condition is not null and v_condition not in ('nuevo','usado','reacondicionado');
 if v_legacy_condition then v_condition:=null; end if;
 select coalesce(array_agg(x.value order by x.ord),'{}') into v_tags from jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(new)->'tags')='array' then to_jsonb(new)->'tags' else '[]'::jsonb end) with ordinality x(value,ord);
 select coalesce(array_agg(x.value order by x.ord),'{}') into v_images from jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(new)->'additional_images')='array' then to_jsonb(new)->'additional_images' else '[]'::jsonb end) with ordinality x(value,ord);
 v_capacity:=to_jsonb(new)->>'capacity';
 if old_row then
  update erp.products set internal_name=new.name,public_name=new.name,public_description=new.description,base_sale_price=new.price,
   web_image_path=new.image_url,category_id=resolved_category,brand_id=resolved_brand,model_id=resolved_model,
   tags=v_tags,condition=v_condition,capacity=v_capacity,sheet_fields_initialized=not v_legacy_condition,is_active=new.is_active,
   publish_on_web=new.is_active,allow_online_sale=new.is_active where id=new.id and organization_id=target_org;
 else
  select id into v_type from erp.product_types where organization_id=target_org and item_kind='product' and is_active order by created_at limit 1;
  select id into v_unit from erp.units_of_measure where organization_id=target_org and is_active order by created_at limit 1;
  insert into erp.products(id,organization_id,product_type_id,item_kind,category_id,brand_id,model_id,unit_id,internal_code,internal_name,public_name,public_description,inventory_tracking,base_sale_price,can_sell,publish_on_web,allow_online_sale,web_image_path,is_active,created_at,tags,condition,capacity,sheet_fields_initialized)
  values(new.id,target_org,v_type,'product',resolved_category,resolved_brand,resolved_model,v_unit,'WEB-'||replace(new.id::text,'-',''),new.name,new.name,new.description,'quantity',new.price,true,new.is_active,new.is_active,new.image_url,new.is_active,coalesce(new.created_at,now()),v_tags,v_condition,v_capacity,not v_legacy_condition);
 end if;
 if tg_op='INSERT' or (old.image_url,to_jsonb(old)->'additional_images') is distinct from (new.image_url,to_jsonb(new)->'additional_images') then
  update erp.products set media_initialized=true where id=new.id and organization_id=target_org;
  select coalesce(max(sort_order)+1,0) into ord from erp.product_media where organization_id=target_org and product_id=new.id and variant_id is not null and is_active;
  update erp.product_media set is_active=false,is_primary=false where organization_id=target_org and product_id=new.id and variant_id is null and is_active;
  if nullif(btrim(new.image_url),'') is not null then
   insert into erp.product_media(organization_id,product_id,storage_path,sort_order,is_primary) values(target_org,new.id,new.image_url,ord,true); ord:=ord+1;
  end if;
  foreach img in array v_images loop
   if nullif(btrim(img),'') is not null then insert into erp.product_media(organization_id,product_id,storage_path,sort_order,is_primary) values(target_org,new.id,img,ord,false); ord:=ord+1; end if;
  end loop;
 end if;
 return new;
end $$;
-- Install an inert trigger even before activation; the function returns when no bridge is active.
do $$ declare extra_columns text; begin
 if to_regclass('public.products') is not null then
  select coalesce(string_agg(format(',%I',attname),''),'') into extra_columns from pg_attribute
   where attrelid=to_regclass('public.products') and attname in ('additional_images','tags','condition','capacity') and not attisdropped;
  execute 'drop trigger if exists a_storefront_catalog_sync on public.products';
  execute 'create trigger a_storefront_catalog_sync after insert or update of name,description,price,image_url,is_active,category_id,brand_id,model_id' || extra_columns || ' or delete on public.products for each row execute function erp.sync_storefront_product_to_erp()';
 end if;
end $$;

-- Activation can happen after this migration, when legacy tables are created later.
create or replace function erp.install_storefront_sheet_trigger_on_activation()
returns trigger language plpgsql security definer set search_path=pg_catalog,erp,public,pg_temp as $$
declare extra_columns text;
begin
 if to_regclass('public.products') is null then return new; end if;
 select coalesce(string_agg(format(',%I',attname),''),'') into extra_columns from pg_attribute
  where attrelid=to_regclass('public.products') and attname in ('additional_images','tags','condition','capacity') and not attisdropped;
 execute 'drop trigger if exists a_storefront_catalog_sync on public.products';
 execute 'create trigger a_storefront_catalog_sync after insert or update of name,description,price,image_url,is_active,category_id,brand_id,model_id' || extra_columns || ' or delete on public.products for each row execute function erp.sync_storefront_product_to_erp()';
 return new;
end $$;
revoke all on function erp.install_storefront_sheet_trigger_on_activation() from public,anon,authenticated,service_role;
create trigger storefront_sheet_trigger_install after insert on erp.storefront_catalog_sync for each row execute function erp.install_storefront_sheet_trigger_on_activation();
