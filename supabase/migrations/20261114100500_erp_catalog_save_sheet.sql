create or replace function erp.save_catalog_product_sheet(payload jsonb,p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,erp,pg_temp as $$
declare
 org_id uuid:=erp.current_organization_id(); v_id uuid; p erp.products%rowtype; v_new boolean;
 v_name text; v_template text; v_brand uuid; v_category uuid; v_model uuid; v_code text;
 v_cost numeric; v_price numeric; v_result jsonb; item jsonb; v_media_id uuid; v_variant uuid;
 v_tags text[]; v_condition text; v_capacity text; v_legacy_condition boolean:=false; v_models uuid[]; v_seen uuid[]:='{}'; v_ord integer; v_color uuid;
begin
 if auth.uid() is null or org_id is null or not erp.has_permission('catalog.manage') then raise exception using errcode='42501',message='catalog.manage permission is required'; end if;
 if payload is null or jsonb_typeof(payload)<>'object' then raise exception using errcode='22023',message='payload debe ser un objeto'; end if;
 v_id:=nullif(payload->>'id','')::uuid; v_new:=v_id is null;
 if not v_new then
   perform pg_advisory_xact_lock(hashtext(org_id::text),hashtext(v_id::text));
   select * into p from erp.products where id=v_id and organization_id=org_id for update;
   if not found then raise exception using errcode='P0002',message='producto no encontrado'; end if;
   if p_expected_updated_at is not null and p.updated_at is distinct from p_expected_updated_at then raise exception using errcode='23514',message='concurrency conflict: product was modified by another operation',detail='concurrency_conflict'; end if;
 end if;
 v_tags:=p.tags; v_condition:=p.condition; v_capacity:=p.capacity;
 if not v_new and not p.sheet_fields_initialized and to_regclass('public.products') is not null
    and exists(select 1 from erp.storefront_catalog_sync where organization_id=org_id) then
  execute $query$select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(w)->'tags')='array' then to_jsonb(w)->'tags' else '[]'::jsonb end)),'{}'::text[]),
    lower(nullif(btrim(to_jsonb(w)->>'condition'),'')),to_jsonb(w)->>'capacity'
    from public.products w where w.id=$1$query$ into v_tags,v_condition,v_capacity using v_id;
  v_legacy_condition:=v_condition is not null and v_condition not in ('nuevo','usado','reacondicionado');
  if v_legacy_condition then v_condition:=null; end if;
 end if;
 v_name:=case when payload ? 'internal_name' then nullif(regexp_replace(btrim(payload->>'internal_name'),'[[:space:]]+',' ','g'),'') else p.internal_name end;
 v_brand:=case when payload ? 'brand_id' then nullif(payload->>'brand_id','')::uuid else p.brand_id end;
 v_category:=case when payload ? 'category_id' then nullif(payload->>'category_id','')::uuid else p.category_id end;
 v_model:=case when payload ? 'model_id' then nullif(payload->>'model_id','')::uuid else p.model_id end;
 v_template:=coalesce(nullif(payload->>'sheet_template',''),p.sheet_template,'accesorio');
 v_cost:=case when payload ? 'base_cost' then (payload->>'base_cost')::numeric else p.base_cost end;
 v_price:=case when payload ? 'base_sale_price' then (payload->>'base_sale_price')::numeric else coalesce(p.base_sale_price,0) end;
 if v_name is null then raise exception using errcode='22023',message='nombre obligatorio'; end if;
 if (v_new or payload ? 'brand_id') and (v_brand is null or not exists(select 1 from erp.brands where id=v_brand and organization_id=org_id and is_active)) then raise exception using errcode='22023',message='marca activa obligatoria'; end if;
 if (v_new or payload ? 'category_id') and (v_category is null or not exists(select 1 from erp.product_categories where id=v_category and organization_id=org_id and is_active)) then raise exception using errcode='22023',message='categoría activa obligatoria'; end if;
 if v_template not in ('celular','accesorio','funda') then raise exception using errcode='22023',message='plantilla inválida'; end if;
 if (v_new or payload ? 'model_id' or payload ? 'sheet_template') and v_template='celular' and (v_model is null or not exists(select 1 from erp.product_models where id=v_model and organization_id=org_id and brand_id=v_brand and is_active)) then raise exception using errcode='22023',message='el celular requiere un modelo activo de la marca'; end if;
 if (v_new or payload ? 'model_id' or payload ? 'sheet_template') and v_template in ('accesorio','funda') and v_model is not null then raise exception using errcode='22023',message='el accesorio usa modelos compatibles, no model_id'; end if;
 if v_template='celular' and payload ? 'compatible_model_ids' and jsonb_array_length(payload->'compatible_model_ids')>0 then raise exception using errcode='22023',message='el celular no admite modelos compatibles'; end if;
 if v_new and (v_cost is null or v_cost<=0 or v_cost='NaN'::numeric) then raise exception using errcode='22023',message='costo mayor a cero obligatorio en altas'; end if;
 if v_price is null or v_price<0 or v_price='NaN'::numeric then raise exception using errcode='22023',message='precio inválido'; end if;
 if payload ? 'condition' then
  v_condition:=lower(nullif(btrim(payload->>'condition'),''));
  if v_condition is not null and v_condition not in ('nuevo','usado','reacondicionado') then raise exception using errcode='22023',message='condición inválida'; end if;
  v_legacy_condition:=false;
 end if;
 v_capacity:=case when payload ? 'capacity' then nullif(btrim(payload->>'capacity'),'') else v_capacity end;
 if payload ? 'tags' then
   if jsonb_typeof(payload->'tags')<>'array' then raise exception using errcode='22023',message='tags debe ser un arreglo'; end if;
   select coalesce(array_agg(tag order by first_ord),'{}') into v_tags from (
     select distinct on (lower(btrim(value))) btrim(value) as tag, ord as first_ord
     from jsonb_array_elements_text(payload->'tags') with ordinality as t(value,ord)
     where btrim(value)<>'' order by lower(btrim(value)),ord
   ) normalized;
 else v_tags:=coalesce(v_tags,'{}'); end if;
 if v_new then
   v_code:=erp.next_catalog_product_code(v_category);
   v_result:=erp.create_catalog_product_with_variants(v_code,v_name,'product','quantity',v_category,v_brand,v_model,null,v_cost,v_price,coalesce((payload->>'tax_rate_percent')::numeric,21),'[]'::jsonb);
   v_id:=(v_result->>'product_id')::uuid;
 end if;
 update erp.products set internal_name=v_name,
  public_name=case when payload ? 'public_name' then nullif(regexp_replace(btrim(payload->>'public_name'),'[[:space:]]+',' ','g'),'') else public_name end,
  public_description=case when payload ? 'public_description' then payload->>'public_description' else public_description end,
  category_id=v_category,brand_id=v_brand,model_id=v_model,sheet_template=v_template,
  base_cost=coalesce(v_cost,base_cost),base_sale_price=v_price,tags=v_tags,
  condition=v_condition,capacity=v_capacity,sheet_fields_initialized=not v_legacy_condition,
  updated_by=auth.uid() where id=v_id and organization_id=org_id;
 if payload ? 'variants' then
   perform erp.manage_product_variants(v_id,payload->'variants',null);
   for item in select value from jsonb_array_elements(payload->'variants') loop
     if item ? 'color_id' then
       v_color:=nullif(item->>'color_id','')::uuid;
       if v_color is not null and not exists(select 1 from erp.colors where id=v_color and organization_id=org_id and is_active) then raise exception using errcode='22023',message='color inválido'; end if;
       update erp.product_variants set color_id=v_color,
        name=case when v_color is not null then (select name from erp.colors where id=v_color) else name end,
        attributes=case when v_color is not null then jsonb_set(attributes,'{color}',to_jsonb((select name from erp.colors where id=v_color)),true) else attributes end
       where product_id=v_id and organization_id=org_id and upper(btrim(code))=upper(btrim(item->>'code'));
     else
       update erp.product_variants v set name=c.name,attributes=jsonb_set(v.attributes,'{color}',to_jsonb(c.name),true)
        from erp.colors c where v.product_id=v_id and v.organization_id=org_id and upper(btrim(v.code))=upper(btrim(item->>'code'))
         and c.id=v.color_id and c.organization_id=org_id;
     end if;
   end loop;
 end if;
 if payload ? 'compatible_model_ids' then
   if jsonb_typeof(payload->'compatible_model_ids') <> 'array' then raise exception using errcode='22023',message='modelos compatibles debe ser un arreglo'; end if;
   select coalesce(array_agg(x::uuid),'{}') into v_models from jsonb_array_elements_text(payload->'compatible_model_ids') x;
   perform erp.set_product_compatible_models(v_id,v_models,null);
 end if;
 if payload ? 'media' then
   if jsonb_typeof(payload->'media') <> 'array' then raise exception using errcode='22023',message='media debe ser un arreglo'; end if;
   update erp.products set media_initialized=true where id=v_id and organization_id=org_id;
   update erp.product_media set is_active=false,is_primary=false,updated_by=auth.uid() where product_id=v_id and organization_id=org_id and is_active;
   for item in select value from jsonb_array_elements(payload->'media') loop
     v_media_id:=coalesce(nullif(item->>'id','')::uuid,gen_random_uuid());
     if v_media_id=any(v_seen) then raise exception using errcode='22023',message='foto duplicada'; end if;
     v_seen:=array_append(v_seen,v_media_id);
     v_variant:=nullif(item->>'variant_id','')::uuid;
     if v_variant is null and nullif(item->>'variant_code','') is not null then select id into v_variant from erp.product_variants where product_id=v_id and organization_id=org_id and upper(btrim(code))=upper(btrim(item->>'variant_code')); if v_variant is null then raise exception using errcode='22023',message='variante de foto inexistente'; end if; end if;
     v_ord:=(item->>'sort_order')::integer;
     if nullif(btrim(item->>'storage_path'),'') is null or v_ord is null then raise exception using errcode='22023',message='foto requiere ruta y orden'; end if;
     if exists(select 1 from erp.product_media where id=v_media_id and (organization_id<>org_id or product_id<>v_id)) then raise exception using errcode='23514',message='foto pertenece a otro producto'; end if;
     insert into erp.product_media(id,organization_id,product_id,variant_id,storage_path,sort_order,is_primary,alt_text,created_by,updated_by)
     values(v_media_id,org_id,v_id,v_variant,btrim(item->>'storage_path'),v_ord,coalesce((item->>'is_primary')::boolean,false),item->>'alt_text',auth.uid(),auth.uid())
     on conflict(id) do update set variant_id=excluded.variant_id,storage_path=excluded.storage_path,sort_order=excluded.sort_order,is_primary=excluded.is_primary,alt_text=excluded.alt_text,is_active=true,updated_by=auth.uid()
     where erp.product_media.organization_id=org_id and erp.product_media.product_id=v_id;
     if not found then raise exception using errcode='23514',message='foto pertenece a otro producto'; end if;
   end loop;
   update erp.product_variants v set image_path=m.storage_path
    from erp.product_media m
   where v.organization_id=org_id and v.product_id=v_id and m.organization_id=org_id
     and m.product_id=v_id and m.variant_id=v.id and m.is_active and m.is_primary
     and v.image_path is distinct from m.storage_path;
 end if;
 select jsonb_build_object('product',to_jsonb(pr),'variants',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at) from erp.product_variants v where v.product_id=pr.id and v.organization_id=org_id),'[]'::jsonb),'media',coalesce((select jsonb_agg(to_jsonb(m) order by m.sort_order) from erp.product_media m where m.product_id=pr.id and m.organization_id=org_id and m.is_active),'[]'::jsonb)) into v_result from erp.products pr where pr.id=v_id and pr.organization_id=org_id;
 return v_result;
end $$;
revoke all on function erp.save_catalog_product_sheet(jsonb,timestamptz) from public,anon;
grant execute on function erp.save_catalog_product_sheet(jsonb,timestamptz) to authenticated,service_role;
