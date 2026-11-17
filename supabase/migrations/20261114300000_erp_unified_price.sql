create or replace function erp.resolve_catalog_effective_price_internal(
  p_organization_id uuid,
  p_product_id uuid,
  p_variant_id uuid default null,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := p_organization_id;
  v_prod record;
  v_var record;
  v_effective_price numeric(18, 4);
  v_price_source text;
  v_is_override boolean := false;
begin
  -- 1. Product master in active organization
  select id, organization_id, base_sale_price, tax_rate_percent, is_active
    into v_prod
    from erp.products
   where id = p_product_id and organization_id = org_id;

  if not found then
    raise exception using errcode = 'no_data_found',
      message = 'product not found in current organization';
  end if;

  -- 2. Variant evaluation if specified
  if p_variant_id is not null then
    select id, product_id, organization_id, final_price_ars, is_active
      into v_var
      from erp.product_variants
     where id = p_variant_id and product_id = p_product_id and organization_id = org_id;

    if not found then
      raise exception using errcode = 'no_data_found',
        message = 'variant not found for product in current organization';
    end if;

    if v_var.final_price_ars is not null then
      -- Variant own absolute final price override
      v_effective_price := v_var.final_price_ars;
      v_price_source := 'variant_override';
      v_is_override := true;
    else
      -- Inherits from parent
      v_effective_price := coalesce(v_prod.base_sale_price, 0);
      if v_effective_price < 0 then
        raise exception using errcode = 'check_violation',
          message = 'inherited variant price cannot be negative';
      end if;
      v_price_source := 'parent_inherited';
      v_is_override := false;
    end if;
  else
    v_effective_price := coalesce(v_prod.base_sale_price, 0);
    if v_effective_price < 0 then
      raise exception using errcode = 'check_violation',
        message = 'product base sale price cannot be negative';
    end if;
    v_price_source := 'parent_base';
    v_is_override := false;
  end if;

  return jsonb_build_object(
    'product_id', p_product_id,
    'variant_id', p_variant_id,
    'currency_code', 'ARS',
    'final_price_ars', v_effective_price,
    'tax_rate_percent', v_prod.tax_rate_percent,
    'price_source', v_price_source,
    'is_override', v_is_override
  );
end;
$$;

create or replace function erp.resolve_catalog_effective_price(p_product_id uuid, p_variant_id uuid default null)
returns jsonb language plpgsql security definer
set search_path = erp, pg_catalog, pg_temp as $$
declare org_id uuid := erp.current_organization_id();
begin
  if auth.uid() is null then
    raise exception using errcode = 'insufficient_privilege', message = 'authenticated user required';
  end if;
  if org_id is null or (not erp.has_permission('catalog.view') and not erp.has_permission('catalog.manage')
    and not erp.has_permission('pos.cashier') and not erp.has_permission('sales.create')) then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog.view, catalog.manage, pos.cashier or sales.create permission required';
  end if;
  return erp.resolve_catalog_effective_price_internal(org_id, p_product_id, p_variant_id, now());
end $$;

revoke all on function erp.resolve_catalog_effective_price_internal(uuid,uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function erp.resolve_catalog_effective_price_internal(uuid,uuid,uuid,timestamptz) to service_role;

do $$ begin
  if to_regclass('public.product_variants') is not null then
    alter table public.product_variants add column if not exists price numeric(12,2);
  end if;
end $$;

create or replace function erp.project_storefront_variant_prices(p_org uuid, p_product uuid)
returns void language plpgsql security definer set search_path=pg_catalog,erp,public,pg_temp as $$
begin
  if to_regclass('public.product_variants') is null or not exists
    (select 1 from pg_attribute where attrelid=to_regclass('public.product_variants') and attname='price' and not attisdropped)
    or not exists (select 1 from erp.storefront_catalog_sync where organization_id=p_org) then return; end if;
  update public.product_variants w set price=resolved.price
  from (
    select v.id, v.product_id,
      (erp.resolve_catalog_effective_price_internal(v.organization_id,v.product_id,v.id,now())->>'final_price_ars')::numeric(12,2) as price
    from erp.product_variants v
    where v.organization_id=p_org and v.product_id=p_product
  ) resolved
  where w.id=resolved.id and w.product_id=resolved.product_id
    and w.price is distinct from resolved.price;
end $$;
revoke all on function erp.project_storefront_variant_prices(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function erp.sync_storefront_variant_prices() returns trigger
language plpgsql security definer set search_path=pg_catalog,erp,public,pg_temp as $$
begin
  if tg_table_name='products' then
    perform erp.project_storefront_variant_prices(new.organization_id,new.id);
  else
    perform erp.project_storefront_variant_prices(new.organization_id,new.product_id);
  end if;
  return new;
end $$;
revoke all on function erp.sync_storefront_variant_prices() from public,anon,authenticated,service_role;
drop trigger if exists z_erp_product_price_projection on erp.products;
create trigger z_erp_product_price_projection after insert or update of base_sale_price, publish_on_web, allow_online_sale, can_sell, is_active on erp.products for each row execute function erp.sync_storefront_variant_prices();
drop trigger if exists z_erp_variant_price_projection on erp.product_variants;
create trigger z_erp_variant_price_projection after insert or update of final_price_ars, name, attributes, image_path, is_active on erp.product_variants for each row execute function erp.sync_storefront_variant_prices();

do $$ declare r record; begin
  for r in select distinct v.organization_id,v.product_id from erp.product_variants v
    join erp.storefront_catalog_sync s on s.organization_id=v.organization_id loop
    perform erp.project_storefront_variant_prices(r.organization_id,r.product_id);
  end loop;
end $$;

create or replace function erp.backfill_storefront_variant_prices_on_activation() returns trigger
language plpgsql security definer set search_path=pg_catalog,erp,public,pg_temp as $$
declare r record;
begin
  for r in select distinct product_id from erp.product_variants where organization_id=new.organization_id loop
    perform erp.project_storefront_variant_prices(new.organization_id,r.product_id);
  end loop;
  return new;
end $$;
revoke all on function erp.backfill_storefront_variant_prices_on_activation() from public,anon,authenticated,service_role;
drop trigger if exists z_storefront_variant_prices_activation on erp.storefront_catalog_sync;
create trigger z_storefront_variant_prices_activation after insert on erp.storefront_catalog_sync
for each row execute function erp.backfill_storefront_variant_prices_on_activation();
