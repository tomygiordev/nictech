-- Migration: 20261021004233_erp_catalog_variant_final_price_and_canonical_resolver.sql
-- Description: Absolute own final price ARS for ERP product variants, canonical price resolver, and transactional variant commands

-- ============================================================================
-- A. Nueva columna nullable final_price_ars en erp.product_variants
-- ============================================================================
-- Invariante: null hereda el precio base de venta del producto padre.
-- Un valor numérico >= 0 establece un precio propio final absoluto (IVA incluido).
-- Preserva UUIDs, atributos, saldos de stock, price_delta y todos los datos legacy.

alter table erp.product_variants
  add column if not exists final_price_ars numeric(18, 4);

alter table erp.product_variants
  drop constraint if exists product_variants_final_price_ars_check;

alter table erp.product_variants
  add constraint product_variants_final_price_ars_check
  check (final_price_ars is null or (final_price_ars >= 0 and final_price_ars <> 'NaN'::numeric));

comment on column erp.product_variants.final_price_ars is
  'Precio de venta final ARS propio absoluto con IVA incluido. Si es null, hereda el precio base del padre (más price_delta legacy si existiera). Un valor no nulo tiene precedencia sobre delta y padre.';


-- ============================================================================
-- B. Resolver canónico en servidor para precio efectivo final ARS
-- ============================================================================
-- Resuelve el precio final ARS vigente para un producto o variante:
-- 1. Precedencia: precio propio variante (final_price_ars) > herencia padre (base_sale_price + delta legacy)
-- 2. El precio devuelto es el TOTAL FINAL A COBRAR en ARS exacto (numeric 18,4).
-- 3. Aislamiento estricto multi-tenant por erp.current_organization_id() y permisos mínimos.

drop function if exists erp.resolve_catalog_effective_price(uuid, uuid, uuid);

create or replace function erp.resolve_catalog_effective_price(
  p_product_id uuid,
  p_variant_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  v_prod record;
  v_var record;
  v_effective_price numeric(18, 4);
  v_price_source text;
  v_is_override boolean := false;
begin
  if auth.uid() is null then
    raise exception using errcode = 'insufficient_privilege', message = 'authenticated user required';
  end if;

  if org_id is null or (
    not erp.has_permission('catalog.view')
    and not erp.has_permission('catalog.manage')
    and not erp.has_permission('pos.cashier')
  ) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'catalog.view, catalog.manage, or pos.cashier permission required';
  end if;

  -- 1. Obtener producto maestro en la organización activa
  select id, organization_id, base_sale_price, tax_rate_percent, is_active
    into v_prod
    from erp.products
   where id = p_product_id and organization_id = org_id;

  if not found then
    raise exception using errcode = 'no_data_found',
      message = 'product not found in current organization';
  end if;

  -- 2. Si se especifica variante, validar pertenencia al producto y a la organización
  if p_variant_id is not null then
    select id, product_id, organization_id, price_delta, final_price_ars, is_active
      into v_var
      from erp.product_variants
     where id = p_variant_id and product_id = p_product_id and organization_id = org_id;

    if not found then
      raise exception using errcode = 'no_data_found',
        message = 'variant not found for product in current organization';
    end if;

    if v_var.final_price_ars is not null then
      -- Override explícito de variante: precio final propio absoluto (gana a delta y a base)
      v_effective_price := v_var.final_price_ars;
      v_price_source := 'variant_override';
      v_is_override := true;
    else
      -- Hereda del padre (preserva price_delta legacy si existiera)
      v_effective_price := coalesce(v_prod.base_sale_price, 0) + coalesce(v_var.price_delta, 0);
      v_price_source := case when coalesce(v_var.price_delta, 0) <> 0 then 'legacy_delta' else 'parent_inherited' end;
      v_is_override := false;
    end if;
  else
    -- Precio base del padre
    v_effective_price := coalesce(v_prod.base_sale_price, 0);
    v_price_source := 'parent_base';
    v_is_override := false;
  end if;

  return jsonb_build_object(
    'product_id', p_product_id,
    'variant_id', p_variant_id,
    'currency_code', 'ARS',
    'final_price_ars', v_effective_price,
    'price_source', v_price_source,
    'is_override', v_is_override
  );
end;
$$;

revoke all on function erp.resolve_catalog_effective_price(uuid, uuid) from public, anon;
grant execute on function erp.resolve_catalog_effective_price(uuid, uuid) to authenticated, service_role;


-- ============================================================================
-- C. Getter tipado de variantes con precios efectivos
-- ============================================================================

create or replace function erp.get_catalog_product_variants(p_product_id uuid)
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
        'effective_price_ars', coalesce(v.final_price_ars, coalesce(v_parent_price, 0) + coalesce(v.price_delta, 0)),
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
  where v.product_id = p_product_id and v.organization_id = org_id;

  return result;
end;
$$;

revoke all on function erp.get_catalog_product_variants(uuid) from public, anon;
grant execute on function erp.get_catalog_product_variants(uuid) to authenticated, service_role;


-- ============================================================================
-- D. Actualización de manage_product_variants con soporte para final_price_ars
-- ============================================================================

create or replace function erp.manage_product_variants(
  p_product_id uuid,
  p_variants jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  v_prod_id uuid;
  v_prod_org uuid;
  v_current_updated_at timestamptz;
  v_parent_base_price numeric(18, 4);
  v_has_parent_balance boolean := false;
  v_has_parent_reservation boolean := false;
  v_has_parent_units boolean := false;
  v_has_new_variants boolean := false;

  variant_item jsonb;
  v_var_id uuid;
  v_var_id_text text;
  v_name text;
  v_code text;
  v_norm_code text;
  v_barcode text;
  v_norm_barcode text;
  v_is_active boolean;
  v_new_final_price_ars numeric(18, 4);

  v_existing_var record;
  v_existing_ident record;
  v_existing_delta numeric(18, 4) := 0;

  seen_codes text[] := '{}'::text[];
  seen_barcodes text[] := '{}'::text[];
  result_variants jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = 'insufficient_privilege', message = 'authenticated user required';
  end if;

  if org_id is null or not erp.has_permission('catalog.manage') then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog.manage permission is required';
  end if;

  if p_variants is null or jsonb_typeof(p_variants) <> 'array' then
    raise exception using errcode = 'invalid_parameter_value', message = 'variants payload must be a JSON array';
  end if;

  -- Lock común compartido por producto y organización (advisory + row lock)
  perform pg_advisory_xact_lock(hashtext(org_id::text), hashtext(p_product_id::text));

  select id, organization_id, updated_at, base_sale_price
    into v_prod_id, v_prod_org, v_current_updated_at, v_parent_base_price
    from erp.products
   where id = p_product_id and organization_id = org_id
     for update;

  if not found then
    raise exception using errcode = 'no_data_found', message = 'product not found in current organization';
  end if;

  if p_expected_updated_at is not null and v_current_updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'check_violation',
      message = 'concurrency conflict: product was modified by another operation';
  end if;

  -- Detectar si hay alta de nuevas variantes (id nulo o vacío)
  for variant_item in select value from jsonb_array_elements(p_variants) loop
    v_var_id_text := nullif(btrim(variant_item->>'id'), '');
    if v_var_id_text is null then
      v_has_new_variants := true;
      exit;
    end if;
  end loop;

  -- Si se van a crear nuevas variantes, verificar granularidad padre
  if v_has_new_variants then
    select exists (
      select 1 from erp.stock_balances
       where organization_id = org_id
         and product_id = p_product_id
         and variant_id is null
         and (quantity_on_hand <> 0 or quantity_reserved <> 0)
    ) into v_has_parent_balance;

    select exists (
      select 1
        from erp.stock_reservations sr
        join erp.stock_reservation_batches srb
          on srb.id = sr.batch_id
         and srb.organization_id = sr.organization_id
       where sr.organization_id = org_id
         and sr.product_id = p_product_id
         and sr.variant_id is null
         and srb.status = 'active'
         and srb.expires_at > now()
    ) into v_has_parent_reservation;

    select exists (
      select 1 from erp.inventory_units
       where organization_id = org_id
         and product_id = p_product_id
         and variant_id is null
         and is_active = true
         and status not in ('sold', 'retired')
    ) into v_has_parent_units;

    if (v_has_parent_balance or v_has_parent_reservation or v_has_parent_units) then
      raise exception using errcode = 'check_violation',
        message = 'Cannot create variants for product with existing parent stock or reservations without explicit stock conversion';
    end if;
  end if;

  -- Validar y procesar cada variante del array
  for variant_item in select value from jsonb_array_elements(p_variants) loop
    v_existing_delta := 0;
    v_var_id_text := nullif(btrim(variant_item->>'id'), '');
    v_name := btrim(coalesce(variant_item->>'name', ''));
    v_code := btrim(coalesce(variant_item->>'code', ''));
    v_norm_code := upper(v_code);
    v_barcode := nullif(btrim(variant_item->>'barcode'), '');
    v_is_active := coalesce((variant_item->>'is_active')::boolean, true);

    if v_name = '' then
      raise exception using errcode = 'invalid_parameter_value', message = 'variant name is required';
    end if;

    if v_norm_code = '' then
      raise exception using errcode = 'invalid_parameter_value', message = 'variant code is required';
    end if;

    -- Validar unicidad del código dentro del payload enviado
    if v_norm_code = any(seen_codes) then
      raise exception using errcode = 'unique_violation',
        message = 'duplicate variant code in payload: ' || v_norm_code;
    end if;
    seen_codes := array_append(seen_codes, v_norm_code);

    -- Validar unicidad del código de barras dentro del payload si está presente
    if v_barcode is not null then
      v_norm_barcode := upper(regexp_replace(v_barcode, '[[:space:]]+', '', 'g'));
      if v_norm_barcode = any(seen_barcodes) then
        raise exception using errcode = 'unique_violation',
          message = 'duplicate barcode in payload: ' || v_barcode;
      end if;
      seen_barcodes := array_append(seen_barcodes, v_norm_barcode);
    end if;

    if v_var_id_text is not null then
      -- Edición de variante existente
      begin
        v_var_id := v_var_id_text::uuid;
      exception when others then
        raise exception using errcode = 'invalid_parameter_value',
          message = 'invalid variant UUID: ' || v_var_id_text;
      end;

      select id, attributes, price_delta, final_price_ars, is_active
        into v_existing_var
        from erp.product_variants
       where id = v_var_id
         and product_id = p_product_id
         and organization_id = org_id;

      if not found then
        raise exception using errcode = 'invalid_parameter_value',
          message = 'variant ' || v_var_id_text || ' does not belong to product ' || p_product_id::text;
      end if;

      v_existing_delta := coalesce(v_existing_var.price_delta, 0);

      if exists (
        select 1 from erp.product_variants
         where organization_id = org_id
           and product_id = p_product_id
           and upper(btrim(code)) = v_norm_code
           and id <> v_var_id
      ) then
        raise exception using errcode = 'unique_violation',
          message = 'variant code ' || v_norm_code || ' already in use by another variant of this product';
      end if;

      -- Resolución del precio propio / herencia:
      -- 1. Si se envía final_price_mode:
      --    - 'inherit': elección explícita inequívoca de heredar -> final_price_ars = null.
      --    - 'own': requiere final_price_ars numérico >= 0 y no NaN.
      -- 2. Si no viene final_price_mode pero viene final_price_ars:
      --    - null -> heredar.
      --    - numérico -> fijar precio propio.
      -- 3. Si se omiten ambos campos: PRESERVAR v_existing_var.final_price_ars (omisión no borra override).
      if variant_item ? 'final_price_mode' then
        if variant_item->>'final_price_mode' = 'inherit' then
          v_new_final_price_ars := null;
        elsif variant_item->>'final_price_mode' = 'own' then
          if not (variant_item ? 'final_price_ars') or variant_item->>'final_price_ars' is null then
            raise exception using errcode = 'invalid_parameter_value',
              message = 'final_price_ars is required when final_price_mode is own';
          end if;
          begin
            v_new_final_price_ars := (variant_item->>'final_price_ars')::numeric;
          exception when others then
            raise exception using errcode = 'invalid_parameter_value',
              message = 'invalid final_price_ars value';
          end;
          if v_new_final_price_ars is null or v_new_final_price_ars < 0 or v_new_final_price_ars = 'NaN'::numeric then
            raise exception using errcode = 'check_violation',
              message = 'final_price_ars must be a non-negative finite number';
          end if;
        else
          raise exception using errcode = 'invalid_parameter_value',
            message = 'invalid final_price_mode: must be inherit or own';
        end if;
      elsif variant_item ? 'final_price_ars' then
        if variant_item->>'final_price_ars' is null or btrim(variant_item->>'final_price_ars') = '' then
          v_new_final_price_ars := null;
        else
          begin
            v_new_final_price_ars := (variant_item->>'final_price_ars')::numeric;
          exception when others then
            raise exception using errcode = 'invalid_parameter_value',
              message = 'invalid final_price_ars value';
          end;
          if v_new_final_price_ars is null or v_new_final_price_ars < 0 or v_new_final_price_ars = 'NaN'::numeric then
            raise exception using errcode = 'check_violation',
              message = 'final_price_ars must be a non-negative finite number';
          end if;
        end if;
      else
        -- Omisión de campos: preservar override existente
        v_new_final_price_ars := v_existing_var.final_price_ars;
      end if;

      -- Actualizar variante preservando atributos no-color y price_delta legacy
      update erp.product_variants
         set code = v_norm_code,
             name = v_name,
             attributes = coalesce(v_existing_var.attributes, '{}'::jsonb) || jsonb_build_object('color', v_name),
             final_price_ars = v_new_final_price_ars,
             is_active = v_is_active,
             updated_at = now()
       where id = v_var_id and product_id = p_product_id and organization_id = org_id;

    else
      -- Alta de nueva variante
      if exists (
        select 1 from erp.product_variants
         where organization_id = org_id
           and product_id = p_product_id
           and upper(btrim(code)) = v_norm_code
      ) then
        raise exception using errcode = 'unique_violation',
          message = 'variant code ' || v_norm_code || ' already exists for this product';
      end if;

      -- Determinar precio propio o herencia para nueva variante
      if variant_item ? 'final_price_mode' then
        if variant_item->>'final_price_mode' = 'inherit' then
          v_new_final_price_ars := null;
        elsif variant_item->>'final_price_mode' = 'own' then
          if not (variant_item ? 'final_price_ars') or variant_item->>'final_price_ars' is null then
            raise exception using errcode = 'invalid_parameter_value',
              message = 'final_price_ars is required when final_price_mode is own';
          end if;
          begin
            v_new_final_price_ars := (variant_item->>'final_price_ars')::numeric;
          exception when others then
            raise exception using errcode = 'invalid_parameter_value',
              message = 'invalid final_price_ars value';
          end;
          if v_new_final_price_ars is null or v_new_final_price_ars < 0 or v_new_final_price_ars = 'NaN'::numeric then
            raise exception using errcode = 'check_violation',
              message = 'final_price_ars must be a non-negative finite number';
          end if;
        else
          raise exception using errcode = 'invalid_parameter_value',
            message = 'invalid final_price_mode: must be inherit or own';
        end if;
      elsif variant_item ? 'final_price_ars' and variant_item->>'final_price_ars' is not null and btrim(variant_item->>'final_price_ars') <> '' then
        begin
          v_new_final_price_ars := (variant_item->>'final_price_ars')::numeric;
        exception when others then
          raise exception using errcode = 'invalid_parameter_value',
            message = 'invalid final_price_ars value';
        end;
        if v_new_final_price_ars is null or v_new_final_price_ars < 0 or v_new_final_price_ars = 'NaN'::numeric then
          raise exception using errcode = 'check_violation',
            message = 'final_price_ars must be a non-negative finite number';
        end if;
      else
        v_new_final_price_ars := null; -- hereda del padre
      end if;

      insert into erp.product_variants (
        organization_id,
        product_id,
        code,
        name,
        attributes,
        price_delta,
        final_price_ars,
        is_active
      ) values (
        org_id,
        p_product_id,
        v_norm_code,
        v_name,
        jsonb_build_object('color', v_name),
        0,
        v_new_final_price_ars,
        v_is_active
      ) returning id into v_var_id;
    end if;

    -- Manejo inmutable y seguro del barcode en erp.product_identifiers
    if variant_item ? 'barcode' then
      if v_barcode is not null then
        v_norm_barcode := upper(regexp_replace(v_barcode, '[[:space:]]+', '', 'g'));

        select id, product_id, variant_id, kind, is_active, is_primary
          into v_existing_ident
          from erp.product_identifiers
         where organization_id = org_id
           and normalized_value = v_norm_barcode;

        if found then
          if v_existing_ident.product_id <> p_product_id
            or v_existing_ident.variant_id is distinct from v_var_id
            or v_existing_ident.kind <> 'barcode' then
            raise exception using errcode = 'unique_violation',
              message = 'barcode ' || v_barcode || ' is already assigned to another catalog item';
          end if;

          update erp.product_identifiers
             set is_primary = false,
                 is_active = false,
                 updated_at = now(),
                 updated_by = auth.uid()
           where organization_id = org_id
             and product_id = p_product_id
             and variant_id = v_var_id
             and kind = 'barcode'
             and id <> v_existing_ident.id
             and (is_active = true or is_primary = true);

          update erp.product_identifiers
             set is_active = true,
                 is_primary = true,
                 updated_at = now(),
                 updated_by = auth.uid()
           where id = v_existing_ident.id;

        else
          update erp.product_identifiers
             set is_primary = false,
                 is_active = false,
                 updated_at = now(),
                 updated_by = auth.uid()
           where organization_id = org_id
             and product_id = p_product_id
             and variant_id = v_var_id
             and kind = 'barcode'
             and (is_active = true or is_primary = true);

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
            p_product_id,
            v_var_id,
            'barcode',
            v_barcode,
            true,
            true,
            auth.uid()
          );
        end if;

      else
        update erp.product_identifiers
           set is_primary = false,
               is_active = false,
               updated_at = now(),
               updated_by = auth.uid()
         where organization_id = org_id
           and product_id = p_product_id
           and variant_id = v_var_id
           and kind = 'barcode'
           and (is_active = true or is_primary = true);
      end if;
    end if;

    result_variants := result_variants || jsonb_build_object(
      'id', v_var_id,
      'code', v_norm_code,
      'name', v_name,
      'is_active', v_is_active,
      'barcode', v_barcode,
      'final_price_ars', v_new_final_price_ars,
      'effective_price_ars', coalesce(v_new_final_price_ars, coalesce(v_parent_base_price, 0) + v_existing_delta),
      'is_override', (v_new_final_price_ars is not null)
    );
  end loop;

  -- Concurrencia y auditoría: actualizar timestamp del producto padre
  update erp.products
     set updated_at = now(),
         updated_by = auth.uid()
   where id = p_product_id and organization_id = org_id;

  return jsonb_build_object(
    'product_id', p_product_id,
    'variants', result_variants
  );
end;
$$;

revoke all on function erp.manage_product_variants(uuid, jsonb, timestamptz) from public, anon;
grant execute on function erp.manage_product_variants(uuid, jsonb, timestamptz) to authenticated, service_role;


-- ============================================================================
-- E. Actualización de create_catalog_product_with_variants con soporte final_price_ars
-- ============================================================================

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
  var_final_price_ars numeric(18, 4);
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
    organization_id, product_type_id, item_kind, category_id, brand_id, model_id,
    unit_id, internal_code, internal_name, public_name, inventory_tracking,
    base_cost, base_sale_price, tax_rate_percent, can_sell,
    can_use_as_repair_part, publish_on_web, allow_online_sale, is_active, created_by
  ) values (
    org_id, target_type_id, p_item_kind, p_category_id, p_brand_id, p_model_id,
    target_unit_id, btrim(p_internal_code), btrim(p_internal_name),
    btrim(p_internal_name), p_inventory_tracking, coalesce(p_base_cost, 0),
    coalesce(p_base_sale_price, 0), coalesce(p_tax_rate_percent, 21),
    true, true, true, true, true, auth.uid()
  ) returning id into new_product_id;

  if p_variants is not null and jsonb_typeof(p_variants) = 'array' then
    for variant_item in select value from jsonb_array_elements(p_variants) loop
      var_code := btrim(variant_item->>'code');
      var_name := btrim(variant_item->>'name');
      var_attrs := coalesce(variant_item->'attributes', '{}'::jsonb);
      var_price_delta := coalesce((variant_item->>'price_delta')::numeric, 0);
      var_barcode := nullif(btrim(variant_item->>'barcode'), '');
      var_sku := nullif(btrim(variant_item->>'sku'), '');

      -- Determinar precio propio o herencia para la variante
      if variant_item ? 'final_price_mode' then
        if variant_item->>'final_price_mode' = 'inherit' then
          var_final_price_ars := null;
        elsif variant_item->>'final_price_mode' = 'own' then
          if not (variant_item ? 'final_price_ars') or variant_item->>'final_price_ars' is null then
            raise exception using errcode = 'invalid_parameter_value',
              message = 'final_price_ars is required when final_price_mode is own';
          end if;
          begin
            var_final_price_ars := (variant_item->>'final_price_ars')::numeric;
          exception when others then
            raise exception using errcode = 'invalid_parameter_value',
              message = 'invalid final_price_ars value';
          end;
          if var_final_price_ars is null or var_final_price_ars < 0 or var_final_price_ars = 'NaN'::numeric then
            raise exception using errcode = 'check_violation',
              message = 'final_price_ars must be a non-negative finite number';
          end if;
        else
          raise exception using errcode = 'invalid_parameter_value',
            message = 'invalid final_price_mode: must be inherit or own';
        end if;
      elsif variant_item ? 'final_price_ars' and variant_item->>'final_price_ars' is not null and btrim(variant_item->>'final_price_ars') <> '' then
        begin
          var_final_price_ars := (variant_item->>'final_price_ars')::numeric;
        exception when others then
          raise exception using errcode = 'invalid_parameter_value',
            message = 'invalid final_price_ars value';
        end;
        if var_final_price_ars is null or var_final_price_ars < 0 or var_final_price_ars = 'NaN'::numeric then
          raise exception using errcode = 'check_violation',
            message = 'final_price_ars must be a non-negative finite number';
        end if;
      else
        var_final_price_ars := null; -- hereda del padre
      end if;

      insert into erp.product_variants (
        organization_id, product_id, code, name, attributes, price_delta, final_price_ars, is_active
      ) values (
        org_id, new_product_id, var_code, var_name, var_attrs, var_price_delta, var_final_price_ars, true
      ) returning id into new_var_id;

      if var_barcode is not null then
        insert into erp.product_identifiers (
          organization_id, product_id, variant_id, kind, value,
          is_primary, is_active, created_by
        ) values (
          org_id, new_product_id, new_var_id, 'barcode', var_barcode,
          true, true, auth.uid()
        );
      end if;

      if var_sku is not null then
        insert into erp.product_identifiers (
          organization_id, product_id, variant_id, kind, value,
          is_primary, is_active, created_by
        ) values (
          org_id, new_product_id, new_var_id, 'internal', var_sku,
          false, true, auth.uid()
        );
      end if;

      created_variants := created_variants || jsonb_build_object(
        'id', new_var_id,
        'code', var_code,
        'name', var_name,
        'barcode', var_barcode,
        'sku', var_sku,
        'final_price_ars', var_final_price_ars,
        'effective_price_ars', coalesce(var_final_price_ars, coalesce(p_base_sale_price, 0) + coalesce(var_price_delta, 0)),
        'is_override', (var_final_price_ars is not null)
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

revoke all on function erp.create_catalog_product_with_variants(
  text, text, erp.catalog_item_kind, erp.inventory_tracking_mode,
  uuid, uuid, uuid, uuid, numeric, numeric, numeric, jsonb
) from public, anon;
grant execute on function erp.create_catalog_product_with_variants(
  text, text, erp.catalog_item_kind, erp.inventory_tracking_mode,
  uuid, uuid, uuid, uuid, numeric, numeric, numeric, jsonb
) to authenticated, service_role;
