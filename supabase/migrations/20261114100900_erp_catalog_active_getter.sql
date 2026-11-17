create or replace function erp.get_catalog_product_variants(p_product_id uuid, p_include_inactive boolean)
returns jsonb
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  v_parent_price numeric(18, 4);
  result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = 'insufficient_privilege', message = 'authenticated user required';
  end if;

  if org_id is null or (not erp.has_permission('catalog.view') and not erp.has_permission('catalog.manage')) then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog.view or catalog.manage permission required';
  end if;

  select base_sale_price into v_parent_price
    from erp.products
   where id = p_product_id and organization_id = org_id;

  if not found then
    raise exception using errcode = 'no_data_found', message = 'product not found in current organization';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'code', v.code,
        'name', v.name,
        'attributes', v.attributes,
        'price_delta', v.price_delta,
        'final_price_ars', v.final_price_ars,
        'effective_price_ars', coalesce(v.final_price_ars, v_parent_price, 0),
        'is_override', (v.final_price_ars is not null),
        'is_active', v.is_active,
        'barcode', (
          select pi.value
            from erp.product_identifiers pi
           where pi.organization_id = org_id
             and pi.product_id = p_product_id
             and pi.variant_id = v.id
             and pi.kind = 'barcode'
             and pi.is_active = true
           order by pi.is_primary desc, pi.created_at desc
           limit 1
        ),
        'sku', (
          select pi.value
            from erp.product_identifiers pi
           where pi.organization_id = org_id
             and pi.product_id = p_product_id
             and pi.variant_id = v.id
             and pi.kind = 'internal'
             and pi.is_active = true
           order by pi.is_primary desc, pi.created_at desc
           limit 1
        )
      ) order by v.code asc, v.name asc
    ),
    '[]'::jsonb
  ) into result
  from erp.product_variants v
  where v.product_id = p_product_id and v.organization_id = org_id and (p_include_inactive or v.is_active);

  return result;
end;
$$;

create or replace function erp.get_catalog_product_variants(p_product_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,erp,pg_temp as $$
 select erp.get_catalog_product_variants(p_product_id,false);
$$;
revoke all on function erp.get_catalog_product_variants(uuid,boolean) from public,anon;
grant execute on function erp.get_catalog_product_variants(uuid,boolean) to authenticated,service_role;
