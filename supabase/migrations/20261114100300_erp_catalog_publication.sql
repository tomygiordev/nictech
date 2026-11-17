create or replace function erp.get_catalog_publish_checklist(p_product_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,erp,pg_temp as $$
declare org_id uuid:=erp.current_organization_id(); p erp.products%rowtype; missing text[]:='{}';
begin
 if auth.uid() is null or org_id is null or not (erp.has_permission('catalog.view') or erp.has_permission('catalog.manage')) then raise exception using errcode='42501',message='catalog.view or catalog.manage is required'; end if;
 select * into p from erp.products where id=p_product_id and organization_id=org_id;
 if not found then raise exception using errcode='P0002',message='producto no encontrado'; end if;
 if not exists(select 1 from erp.product_media m where m.organization_id=org_id and m.product_id=p.id and m.variant_id is null and m.is_active and m.is_primary) and nullif(btrim(p.web_image_path),'') is null then missing:=array_append(missing,'missing_primary_image'); end if;
 if p.base_sale_price <= 0 then missing:=array_append(missing,'invalid_base_price'); end if;
 if p.base_sale_price <> round(p.base_sale_price,2) then missing:=array_append(missing,'base_price_precision'); end if;
 if p.category_id is null then missing:=array_append(missing,'missing_category'); end if;
 if nullif(btrim(coalesce(nullif(btrim(p.public_name),''),p.internal_name)),'') is null then missing:=array_append(missing,'missing_name'); end if;
 if p.brand_id is null then missing:=array_append(missing,'missing_brand'); end if;
 if not p.is_active then missing:=array_append(missing,'inactive_product'); end if;
 if exists(select 1 from erp.product_variants v where v.organization_id=org_id and v.product_id=p.id)
  and not exists(select 1 from erp.product_variants v where v.organization_id=org_id and v.product_id=p.id and v.is_active)
 then missing:=array_append(missing,'no_active_variant'); end if;
 if exists(select 1 from erp.product_variants v where v.organization_id=org_id and v.product_id=p.id and v.is_active and v.final_price_ars is not null and v.final_price_ars <= 0) then missing:=array_append(missing,'invalid_variant_price'); end if;
 if exists(select 1 from erp.product_variants v where v.organization_id=org_id and v.product_id=p.id and v.is_active and v.final_price_ars is not null and v.final_price_ars <> round(v.final_price_ars,2)) then missing:=array_append(missing,'variant_price_precision'); end if;
 return jsonb_build_object('product_id',p.id,'ready',cardinality(missing)=0,'missing',to_jsonb(missing));
end $$;
create or replace function erp.publish_catalog_product(p_product_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,erp,pg_temp as $$
declare org_id uuid:=erp.current_organization_id(); checklist jsonb;
begin
 if auth.uid() is null or org_id is null or not erp.has_permission('catalog.manage') then raise exception using errcode='42501',message='catalog.manage permission is required'; end if;
 perform 1 from erp.products where id=p_product_id and organization_id=org_id for update;
 if not found then raise exception using errcode='P0002',message='producto no encontrado'; end if;
 checklist:=erp.get_catalog_publish_checklist(p_product_id);
 if not (checklist->>'ready')::boolean then raise exception using errcode='23514',message='No se puede publicar: ' || (checklist->'missing')::text,detail=(checklist->'missing')::text; end if;
 update erp.products set publish_on_web=true,allow_online_sale=true,can_sell=true,updated_by=auth.uid() where id=p_product_id and organization_id=org_id;
 return jsonb_build_object('product_id',p_product_id,'web_status','published');
end $$;
create or replace function erp.unpublish_catalog_product(p_product_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,erp,pg_temp as $$
declare org_id uuid:=erp.current_organization_id(); status text;
begin
 if auth.uid() is null or org_id is null or not erp.has_permission('catalog.manage') then raise exception using errcode='42501',message='catalog.manage permission is required'; end if;
 update erp.products set publish_on_web=true,allow_online_sale=false,updated_by=auth.uid() where id=p_product_id and organization_id=org_id returning web_status into status;
 if not found then raise exception using errcode='P0002',message='producto no encontrado'; end if;
 return jsonb_build_object('product_id',p_product_id,'web_status',status);
end $$;
revoke all on function erp.get_catalog_publish_checklist(uuid),erp.publish_catalog_product(uuid),erp.unpublish_catalog_product(uuid) from public,anon;
grant execute on function erp.get_catalog_publish_checklist(uuid),erp.publish_catalog_product(uuid),erp.unpublish_catalog_product(uuid) to authenticated,service_role;
