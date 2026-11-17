create or replace function erp.save_catalog_color(p_name text,p_hex text default null,p_color_id uuid default null,p_is_active boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog,erp,pg_temp as $$
declare org_id uuid:=erp.current_organization_id(); c erp.colors%rowtype;
begin
 if auth.uid() is null or org_id is null or not erp.has_permission('catalog.manage') then raise exception using errcode='42501',message='catalog.manage permission is required'; end if;
 if nullif(btrim(p_name),'') is null or (p_hex is not null and p_hex !~ '^#[0-9A-Fa-f]{6}$') then raise exception using errcode='22023',message='nombre o color hexadecimal inválido'; end if;
 if p_color_id is null then
  insert into erp.colors(organization_id,name,hex,is_active,created_by) values(org_id,regexp_replace(btrim(p_name),'[[:space:]]+',' ','g'),p_hex,p_is_active,auth.uid()) returning * into c;
 else
  update erp.colors set name=regexp_replace(btrim(p_name),'[[:space:]]+',' ','g'),hex=p_hex,is_active=p_is_active,updated_by=auth.uid() where id=p_color_id and organization_id=org_id returning * into c;
  if not found then raise exception using errcode='P0002',message='color no encontrado'; end if;
  update erp.product_variants set name=c.name,attributes=jsonb_set(attributes,'{color}',to_jsonb(c.name),true) where color_id=c.id and organization_id=org_id;
 end if;
 return to_jsonb(c);
end $$;
revoke all on function erp.save_catalog_color(text,text,uuid,boolean) from public,anon;
grant execute on function erp.save_catalog_color(text,text,uuid,boolean) to authenticated,service_role;

-- Opt-in views for direct screen queries; underlying RLS remains authoritative.
create view erp.active_catalog_products with (security_invoker=true) as
 select id,organization_id,product_type_id,item_kind,category_id,brand_id,model_id,unit_id,
 internal_code,normalized_internal_code,internal_name,public_name,internal_description,public_description,
 inventory_tracking,service_price_mode,base_sale_price,tax_rate_percent,warranty_days,minimum_stock,admission_date,
 can_sell,can_use_as_repair_part,publish_on_web,allow_online_sale,zero_stock_behavior,internal_image_path,web_image_path,
 is_active,created_at,updated_at,created_by,updated_by,tags,condition,capacity,sheet_template,web_status,media_initialized,sheet_fields_initialized
 from erp.products where is_active;
create view erp.active_catalog_variants with (security_invoker=true) as
 select v.* from erp.product_variants v join erp.products p on p.id=v.product_id and p.organization_id=v.organization_id where v.is_active and p.is_active;
create view erp.active_stock_balances with (security_invoker=true) as
 select b.* from erp.stock_balances b join erp.products p on p.id=b.product_id and p.organization_id=b.organization_id
 left join erp.product_variants v on v.id=b.variant_id and v.product_id=b.product_id and v.organization_id=b.organization_id
 where p.is_active and (b.variant_id is null or v.is_active);
grant select on erp.active_catalog_products,erp.active_catalog_variants,erp.active_stock_balances to authenticated;
