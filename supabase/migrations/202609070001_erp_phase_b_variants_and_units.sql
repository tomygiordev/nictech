-- Migration: 202609070001_erp_phase_b_variants_and_units.sql
-- Description: FASE B - Enforce indivisible units rule, restore product select grants, and provide helper functions for phone cases with variants.

-- 1. Restore product select permissions that were unintentionally revoked
grant select on erp.products to service_role;
grant select (
  id, organization_id, product_type_id, item_kind, category_id, brand_id, model_id,
  unit_id, internal_code, normalized_internal_code, internal_name, public_name,
  internal_description, public_description, inventory_tracking, service_price_mode,
  base_sale_price, tax_rate_percent, warranty_days, minimum_stock, admission_date,
  can_sell, can_use_as_repair_part, publish_on_web, allow_online_sale,
  zero_stock_behavior, internal_image_path, web_image_path, is_active,
  created_at, updated_at, created_by, updated_by
) on erp.products to authenticated;

-- 2. Trigger functions to enforce indivisible units rule (Finding 9)
create or replace function erp.validate_indivisible_unit_quantity()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  allows_dec boolean;
begin
  if NEW.quantity is not null and NEW.quantity <> trunc(NEW.quantity) then
    select coalesce(u.allows_decimals, false) into allows_dec
      from erp.products p
      left join erp.units_of_measure u on u.id = p.unit_id
     where p.id = NEW.product_id;
    if allows_dec is false then
      raise exception using errcode = 'check_violation',
        message = 'product unit of measure does not allow decimal quantities';
    end if;
  end if;
  return NEW;
end;
$$;

create or replace function erp.validate_indivisible_unit_ordered_quantity()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  allows_dec boolean;
begin
  if NEW.ordered_quantity is not null and NEW.ordered_quantity <> trunc(NEW.ordered_quantity) then
    select coalesce(u.allows_decimals, false) into allows_dec
      from erp.products p
      left join erp.units_of_measure u on u.id = p.unit_id
     where p.id = NEW.product_id;
    if allows_dec is false then
      raise exception using errcode = 'check_violation',
        message = 'product unit of measure does not allow decimal quantities';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_validate_indivisible_unit_po_lines on erp.purchase_order_lines;
create trigger trg_validate_indivisible_unit_po_lines
  before insert or update of ordered_quantity, product_id on erp.purchase_order_lines
  for each row execute function erp.validate_indivisible_unit_ordered_quantity();

drop trigger if exists trg_validate_indivisible_unit_pr_lines on erp.purchase_receipt_lines;
create trigger trg_validate_indivisible_unit_pr_lines
  before insert or update of quantity, product_id on erp.purchase_receipt_lines
  for each row execute function erp.validate_indivisible_unit_quantity();

drop trigger if exists trg_validate_indivisible_unit_stock_lines on erp.stock_document_lines;
create trigger trg_validate_indivisible_unit_stock_lines
  before insert or update of quantity, product_id on erp.stock_document_lines
  for each row execute function erp.validate_indivisible_unit_quantity();

drop trigger if exists trg_validate_indivisible_unit_sale_lines on erp.sale_lines;
create trigger trg_validate_indivisible_unit_sale_lines
  before insert or update of quantity, product_id on erp.sale_lines
  for each row execute function erp.validate_indivisible_unit_quantity();

-- 3. Exchange snapshot helper for purchase orders and sales
create or replace function erp.get_or_create_exchange_snapshot(target_quote_currency text default 'ARS')
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  cur text := upper(btrim(coalesce(target_quote_currency, 'ARS')));
  base_cur text;
  snap_id uuid;
  rate_id uuid;
begin
  if org_id is null then
    raise exception using errcode = 'insufficient_privilege', message = 'active organization is required';
  end if;
  
  select id into snap_id
    from erp.exchange_rate_snapshots
   where organization_id = org_id and quote_currency = cur
   order by captured_at desc
   limit 1;
   
  if snap_id is not null then
    return snap_id;
  end if;
  
  select currency_code into base_cur
    from erp.organization_currencies
   where organization_id = org_id and is_base and is_active;
   
  if base_cur is null then
    base_cur := 'ARS';
  end if;
  
  insert into erp.exchange_rates (
    organization_id, base_currency, quote_currency, rate_to_base, source,
    quoted_at, idempotency_key, request_hash, captured_by
  ) values (
    org_id, base_cur, cur, 1, 'system-default',
    now(), 'init-fx-' || cur || '-' || org_id::text,
    md5('init-fx-' || cur), auth.uid()
  ) on conflict (organization_id, idempotency_key) do update
    set quoted_at = excluded.quoted_at
  returning id into rate_id;
  
  if rate_id is null then
    select id into rate_id from erp.exchange_rates where organization_id = org_id and idempotency_key = 'init-fx-' || cur || '-' || org_id::text;
  end if;
  
  insert into erp.exchange_rate_snapshots (
    organization_id, exchange_rate_id, base_currency, quote_currency,
    rate_to_base, source, quoted_at, captured_at
  ) values (
    org_id, rate_id, base_cur, cur, 1, 'system-default', now(), now()
  ) on conflict (exchange_rate_id) do update
    set captured_at = excluded.captured_at
  returning id into snap_id;
  
  if snap_id is null then
    select id into snap_id from erp.exchange_rate_snapshots where exchange_rate_id = rate_id;
  end if;
  
  return snap_id;
end;
$$;
grant execute on function erp.get_or_create_exchange_snapshot(text) to authenticated, service_role;

-- 4. Helper RPC to create product with variants and optional barcode/sku identifiers
create or replace function erp.create_catalog_product_with_variants(
  p_internal_code text,
  p_internal_name text,
  p_item_kind erp.catalog_item_kind default 'product',
  p_inventory_tracking erp.inventory_tracking_mode default 'quantity',
  p_category_id uuid default null,
  p_brand_id uuid default null,
  p_model_id uuid default null,
  p_unit_id uuid default null,
  p_base_cost numeric default 0,
  p_base_sale_price numeric default 0,
  p_tax_rate_percent numeric default 21,
  p_variants jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  target_unit_id uuid := p_unit_id;
  target_type_id uuid;
  new_product_id uuid;
  variant_item jsonb;
  var_code text;
  var_name text;
  var_attrs jsonb;
  var_price_delta numeric;
  var_barcode text;
  var_sku text;
  new_var_id uuid;
  created_variants jsonb := '[]'::jsonb;
begin
  if org_id is null or not erp.has_permission('catalog.manage') then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog.manage permission is required';
  end if;

  if nullif(btrim(p_internal_code), '') is null or nullif(btrim(p_internal_name), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'product code and name are required';
  end if;

  if target_unit_id is null then
    select id into target_unit_id
      from erp.units_of_measure
     where organization_id = org_id and is_active
     order by created_at asc limit 1;
    if target_unit_id is null then
      raise exception using errcode = 'foreign_key_violation', message = 'no active unit of measure found';
    end if;
  end if;

  select id into target_type_id
    from erp.product_types
   where organization_id = org_id and item_kind = p_item_kind and is_active
   order by created_at asc limit 1;
  if target_type_id is null then
    raise exception using errcode = 'foreign_key_violation', message = 'no active product type found for item kind';
  end if;

  insert into erp.products (
    organization_id,
    product_type_id,
    item_kind,
    category_id,
    brand_id,
    model_id,
    unit_id,
    internal_code,
    internal_name,
    public_name,
    inventory_tracking,
    base_cost,
    base_sale_price,
    tax_rate_percent,
    can_sell,
    can_use_as_repair_part,
    publish_on_web,
    allow_online_sale,
    is_active,
    created_by
  ) values (
    org_id,
    target_type_id,
    p_item_kind,
    p_category_id,
    p_brand_id,
    p_model_id,
    target_unit_id,
    btrim(p_internal_code),
    btrim(p_internal_name),
    btrim(p_internal_name),
    p_inventory_tracking,
    coalesce(p_base_cost, 0),
    coalesce(p_base_sale_price, 0),
    coalesce(p_tax_rate_percent, 21),
    true,
    true,
    true,
    true,
    true,
    auth.uid()
  ) returning id into new_product_id;

  if p_variants is not null and jsonb_typeof(p_variants) = 'array' then
    for variant_item in select value from jsonb_array_elements(p_variants) loop
      var_code := btrim(variant_item->>'code');
      var_name := btrim(variant_item->>'name');
      var_attrs := coalesce(variant_item->'attributes', '{}'::jsonb);
      var_price_delta := coalesce((variant_item->>'price_delta')::numeric, 0);
      var_barcode := nullif(btrim(variant_item->>'barcode'), '');
      var_sku := nullif(btrim(variant_item->>'sku'), '');

      insert into erp.product_variants (
        organization_id,
        product_id,
        code,
        name,
        attributes,
        price_delta,
        is_active
      ) values (
        org_id,
        new_product_id,
        var_code,
        var_name,
        var_attrs,
        var_price_delta,
        true
      ) returning id into new_var_id;

      if var_barcode is not null then
        insert into erp.product_identifiers (
          organization_id,
          product_id,
          variant_id,
          kind,
          value,
          is_primary,
          is_active,
          created_by
        ) values (
          org_id,
          new_product_id,
          new_var_id,
          'barcode',
          var_barcode,
          true,
          true,
          auth.uid()
        );
      end if;

      if var_sku is not null then
        insert into erp.product_identifiers (
          organization_id,
          product_id,
          variant_id,
          kind,
          value,
          is_primary,
          is_active,
          created_by
        ) values (
          org_id,
          new_product_id,
          new_var_id,
          'sku',
          var_sku,
          false,
          true,
          auth.uid()
        );
      end if;

      created_variants := created_variants || jsonb_build_object(
        'id', new_var_id,
        'code', var_code,
        'name', var_name,
        'barcode', var_barcode
      );
    end loop;
  end if;

  return jsonb_build_object(
    'product_id', new_product_id,
    'internal_code', btrim(p_internal_code),
    'internal_name', btrim(p_internal_name),
    'variants', created_variants
  );
end;
$$;
grant execute on function erp.create_catalog_product_with_variants(text, text, erp.catalog_item_kind, erp.inventory_tracking_mode, uuid, uuid, uuid, uuid, numeric, numeric, numeric, jsonb) to authenticated, service_role;
