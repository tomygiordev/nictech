-- Stage 1 pricing and draft creation.  Function definitions below are based on
-- the latest POS/catalog migrations; signatures and existing grants are retained.
comment on column erp.product_variants.price_delta is
  'Obsoleto: se conserva para historial; no interviene en el precio efectivo.';
comment on column erp.product_variants.final_price_ars is
  'Precio final ARS propio; si es nulo, se hereda base_sale_price del producto.';

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
    and not erp.has_permission('sales.create')
  ) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'catalog.view, catalog.manage, pos.cashier or sales.create permission required';
  end if;

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
  where v.product_id = p_product_id and v.organization_id = org_id;

  return result;
end;
$$;

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
      'effective_price_ars', coalesce(v_new_final_price_ars, v_parent_base_price, 0),
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
  v_product_code text := nullif(btrim(p_internal_code), '');
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

  if nullif(btrim(p_internal_name), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'product name is required';
  end if;
  if v_product_code is null then
    v_product_code := erp.next_catalog_product_code(p_category_id);
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
    target_unit_id, v_product_code, btrim(p_internal_name),
    btrim(p_internal_name), p_inventory_tracking, coalesce(p_base_cost, 0),
    coalesce(p_base_sale_price, 0), coalesce(p_tax_rate_percent, 21),
    true, true, false, false, true, auth.uid()
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
        'effective_price_ars', coalesce(var_final_price_ars, p_base_sale_price, 0),
        'is_override', (var_final_price_ars is not null)
      );
    end loop;
  end if;

  return jsonb_build_object(
    'product_id', new_product_id,
    'internal_code', v_product_code,
    'internal_name', btrim(p_internal_name),
    'variants', created_variants
  );
end;
$$;

create or replace function erp.create_sale_with_invoice(
  target_branch_id uuid,
  target_customer_id uuid,
  sale_currency text,
  target_exchange_snapshot_id uuid,
  operation_key text,
  operation_reason text,
  lines jsonb,
  target_invoice_kind text,
  payment_lines jsonb default '[]'::jsonb,
  target_reservation_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, erp, extensions, pg_temp
as $$
declare
  current_org_id uuid := erp.current_organization_id();
  v_cmd_row erp.stage8_commands%rowtype;
  v_template_version_id uuid;
  v_sale_id uuid;
  v_document_id uuid;
  v_document_number text;
  v_next_number bigint;
  v_existing_max numeric;
  v_customer_snapshot jsonb;
  v_document_payload jsonb;
  v_request_payload jsonb;
  v_content_sha256 text;
  v_result_invoice_kind text;
  v_rate numeric(24, 10);

  line jsonb;
  payment_line jsonb;
  line_no integer := 0;
  line_kind erp.sale_line_kind;
  parsed_product_id uuid;
  parsed_variant_id uuid;
  parsed_inventory_unit_id uuid;
  parsed_location_id uuid;
  quantity_val numeric(18, 4);
  client_expected_price numeric(18, 4);
  client_expected_tax_rate numeric(7, 4);
  v_prod record;
  v_var record;
  v_server_gross numeric(18, 4);
  v_server_tax_rate numeric(7, 4);
  v_gross_line numeric(18, 4);
  v_gross_discount numeric(18, 4);
  v_net_subtotal numeric(18, 4);
  v_net_discount numeric(18, 4);
  v_tax_amount numeric(18, 4);
  v_line_total numeric(18, 4);
  v_v2_lines jsonb := '[]'::jsonb;
  persisted_lines jsonb;
  persisted_payments jsonb;

  v_product_ids uuid[];
  v_variant_ids uuid[];
  v_raw_val numeric;
  v_raw_text text;
begin
  if current_org_id is null
    or not erp.has_permission('sales.create', target_branch_id)
    or not erp.has_permission('documents.issue', target_branch_id)
    or target_invoice_kind is null
    or target_invoice_kind not in ('fiscal', 'non_fiscal')
    or nullif(btrim(operation_key), '') is null
    or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'sales.create, documents.issue, invoice type, operation key and reason are required';
  end if;

  if lines is null or jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 or jsonb_array_length(lines) > 250 then
    raise exception using errcode = 'invalid_parameter_value', message = 'between 1 and 250 sale lines are required';
  end if;

  if payment_lines is null or jsonb_typeof(payment_lines) <> 'array' or jsonb_array_length(payment_lines) > 20 then
    raise exception using errcode = 'invalid_parameter_value', message = 'maximum of 20 payment lines allowed';
  end if;

  if pg_column_size(lines) > 1048576 or pg_column_size(payment_lines) > 1048576
     or pg_column_size(lines) + pg_column_size(payment_lines) > 1048576 then
    raise exception using errcode = 'program_limit_exceeded', message = 'request payload exceeds 1 MiB limit';
  end if;

  -- 1. Raw request payload for exact replay verification
  v_request_payload := jsonb_build_object(
    'invoice_kind', target_invoice_kind,
    'branch_id', target_branch_id,
    'customer_id', target_customer_id,
    'currency', upper(btrim(coalesce(sale_currency, ''))),
    'exchange_snapshot_id', target_exchange_snapshot_id,
    'reservation_batch_id', target_reservation_batch_id,
    'reason', operation_reason,
    'lines_sha256', encode(extensions.digest(convert_to(lines::text, 'UTF8'), 'sha256'), 'hex'),
    'payments_sha256', encode(extensions.digest(convert_to(payment_lines::text, 'UTF8'), 'sha256'), 'hex')
  );

  -- 2. Check replay BEFORE querying catalog, requoting, or verifying active templates
  begin
    v_cmd_row := erp.claim_stage8_command('pos.sale.invoice', current_org_id, target_branch_id, operation_key, v_request_payload);
  exception
    when others then
      declare
        v_claim_sqlstate text;
        v_claim_sqlerrm text;
      begin
        get stacked diagnostics
          v_claim_sqlstate = returned_sqlstate,
          v_claim_sqlerrm = message_text;
        if v_claim_sqlstate = '23000' and v_claim_sqlerrm = 'idempotency key is already used by another request' then
          raise exception using errcode = 'unique_violation', message = v_claim_sqlerrm;
        end if;
        raise;
      end;
  end;
  if v_cmd_row.result_id is not null then
    select document_row.owner_id, document_row.document_number, document_row.invoice_kind
      into v_sale_id, v_document_number, v_result_invoice_kind
      from erp.documents document_row
     where document_row.id = v_cmd_row.result_id and document_row.organization_id = current_org_id;

    if v_sale_id is null then
      raise exception using errcode = 'data_exception', message = 'completed sale invoice command has no document';
    end if;

    return jsonb_build_object(
      'sale_id', v_sale_id,
      'document_id', v_cmd_row.result_id,
      'document_number', v_document_number,
      'invoice_kind', v_result_invoice_kind
    );
  end if;

  -- 3. Strict currency and snapshot guards for new POS v2 sales
  if sale_currency is null or upper(btrim(sale_currency)) <> 'ARS' then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'pos v2 sales strictly require ARS currency';
  end if;

  select rate_to_base into v_rate
    from erp.exchange_rate_snapshots
   where id = target_exchange_snapshot_id
     and organization_id = current_org_id
     and quote_currency = 'ARS';

  if v_rate is null or v_rate <> 1 then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'pos v2 requires an active ARS exchange rate snapshot with rate 1';
  end if;

  -- 4. Active document template check
  select version_row.id into v_template_version_id
    from erp.document_template_versions version_row
    join erp.document_templates template_row
      on template_row.id = version_row.template_id
     and template_row.organization_id = version_row.organization_id
   where version_row.organization_id = current_org_id
     and template_row.document_kind = 'sale'
     and template_row.is_active
   order by version_row.version desc
   limit 1;

  if v_template_version_id is null then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'active sale document template is required';
  end if;

  -- 5. Concurrency: Lock in common deadlock-free hierarchy
  -- sucursal -> advisories productos ordenados -> filas producto/variantes ordenadas -> stock
  perform pg_advisory_xact_lock(hashtextextended(current_org_id::text || ':' || target_branch_id::text, 0));

  select array_agg(p_id order by p_id) into v_product_ids
    from (select distinct nullif(line_item->>'product_id', '')::uuid as p_id from jsonb_array_elements(lines) line_item) sub
   where p_id is not null;

  select array_agg(v_id order by v_id) into v_variant_ids
    from (select distinct nullif(line_item->>'variant_id', '')::uuid as v_id from jsonb_array_elements(lines) line_item) sub
   where v_id is not null;

  if v_product_ids is not null and array_length(v_product_ids, 1) > 0 then
    for i in 1 .. array_length(v_product_ids, 1) loop
      perform pg_advisory_xact_lock(hashtext(current_org_id::text), hashtext(v_product_ids[i]::text));
    end loop;
    perform 1 from erp.products
     where id = any(v_product_ids) and organization_id = current_org_id
     order by id
     for share;
  end if;

  if v_variant_ids is not null and array_length(v_variant_ids, 1) > 0 then
    perform 1 from erp.product_variants
     where id = any(v_variant_ids) and organization_id = current_org_id
     order by id
     for share;
  end if;

  -- 6. Authoritative server pricing and strict quote assertion
  for line in select value from jsonb_array_elements(lines) loop
    line_no := line_no + 1;
    if jsonb_typeof(line) <> 'object' then
      raise exception using errcode = 'invalid_parameter_value', message = format('invalid sale line %s', line_no);
    end if;

    begin
      line_kind := (line->>'kind')::erp.sale_line_kind;
      parsed_product_id := nullif(line->>'product_id', '')::uuid;
      parsed_variant_id := nullif(line->>'variant_id', '')::uuid;
      parsed_inventory_unit_id := nullif(line->>'inventory_unit_id', '')::uuid;
      parsed_location_id := nullif(line->>'from_location_id', '')::uuid;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = format('invalid sale line %s', line_no);
    end;

    if line_kind = 'free_concept' then
      raise exception using errcode = 'feature_not_supported',
        message = 'free_concept lines are not permitted for POS v2 sales';
    end if;

    -- Validar cantidad finita y escala <= 4 ANTES de asignación a numeric(18,4)
    begin
      v_raw_val := (line->>'quantity')::numeric;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = format('sale line %s quantity must be positive', line_no);
    end;
    if v_raw_val is null or v_raw_val <= 0 or v_raw_val = 'NaN'::numeric
       or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
       or v_raw_val <> round(v_raw_val, 4) then
      raise exception using errcode = 'invalid_parameter_value', message = format('sale line %s quantity must be positive', line_no);
    end if;
    quantity_val := v_raw_val;

    if parsed_product_id is null then
      raise exception using errcode = 'invalid_parameter_value', message = format('sale line %s requires a product', line_no);
    end if;

    select id, organization_id, base_sale_price, tax_rate_percent, is_active, can_sell, item_kind
      into v_prod
      from erp.products
     where id = parsed_product_id
       and organization_id = current_org_id
       and is_active
       and can_sell;

    if v_prod.id is null then
      raise exception using errcode = 'foreign_key_violation', message = format('sale line %s product not found or inactive', line_no);
    end if;

    if v_prod.item_kind::text <> line_kind::text then
      raise exception using errcode = 'foreign_key_violation', message = format('sale line %s catalog kind mismatch', line_no);
    end if;

    -- Require variant_id if product has active variants
    if exists (
      select 1 from erp.product_variants
       where product_id = parsed_product_id and organization_id = current_org_id and is_active
    ) and parsed_variant_id is null then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s product has variants; explicit variant_id is required', line_no);
    end if;

    if parsed_variant_id is not null then
      select id, product_id, organization_id, final_price_ars, is_active
        into v_var
        from erp.product_variants
       where id = parsed_variant_id
         and product_id = parsed_product_id
         and organization_id = current_org_id
         and is_active;

      if v_var.id is null then
        raise exception using errcode = 'foreign_key_violation', message = format('sale line %s variant not found or inactive', line_no);
      end if;

      if v_var.final_price_ars is not null then
        v_server_gross := v_var.final_price_ars;
      else
        v_server_gross := coalesce(v_prod.base_sale_price, 0);
        if v_server_gross < 0 then
          raise exception using errcode = 'check_violation', message = 'inherited variant price cannot be negative';
        end if;
      end if;
    else
      v_server_gross := coalesce(v_prod.base_sale_price, 0);
      if v_server_gross < 0 then
        raise exception using errcode = 'check_violation', message = 'product base sale price cannot be negative';
      end if;
    end if;

    v_server_tax_rate := v_prod.tax_rate_percent;

    -- Expected quote validation: mandatory, NOT NULL, finite, escala <= 4, exact comparison
    v_raw_text := nullif(btrim(line->>'expected_unit_price'), '');
    if v_raw_text is null then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s missing expected quote price or tax rate', line_no);
    end if;
    begin
      v_raw_val := v_raw_text::numeric;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s missing expected quote price or tax rate', line_no);
    end;
    if v_raw_val is null or v_raw_val < 0 or v_raw_val = 'NaN'::numeric
       or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
       or v_raw_val <> round(v_raw_val, 4) then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s missing expected quote price or tax rate', line_no);
    end if;
    client_expected_price := v_raw_val;

    v_raw_text := coalesce(
      nullif(btrim(line->>'expected_tax_rate'), ''),
      nullif(btrim(line->>'tax_rate_percent'), '')
    );
    if v_raw_text is null then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s missing expected quote price or tax rate', line_no);
    end if;
    begin
      v_raw_val := v_raw_text::numeric;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s missing expected quote price or tax rate', line_no);
    end;
    if v_raw_val is null or v_raw_val < 0 or v_raw_val > 100 or v_raw_val = 'NaN'::numeric
       or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
       or v_raw_val <> round(v_raw_val, 4) then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s missing expected quote price or tax rate', line_no);
    end if;
    client_expected_tax_rate := v_raw_val;

    if client_expected_price is distinct from v_server_gross
       or client_expected_tax_rate is distinct from v_server_tax_rate then
      raise exception using errcode = 'check_violation',
        message = 'stale quote: catalog price or tax rate has changed, requote required';
    end if;

    -- Compute exact 4-decimal gross line breakdown
    v_gross_line := round(quantity_val * v_server_gross, 4);

    v_raw_text := coalesce(
      nullif(btrim(line->>'gross_discount_amount'), ''),
      nullif(btrim(line->>'discount_amount'), '')
    );
    if v_raw_text is not null then
      begin
        v_raw_val := v_raw_text::numeric;
      exception when others then
        raise exception using errcode = 'invalid_parameter_value', message = 'discount must be non-negative';
      end;
      if v_raw_val is null or v_raw_val < 0 or v_raw_val = 'NaN'::numeric
         or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
         or v_raw_val <> round(v_raw_val, 4) then
        raise exception using errcode = 'invalid_parameter_value', message = 'discount must be non-negative';
      end if;
      v_gross_discount := v_raw_val;
    else
      v_gross_discount := 0;
    end if;

    if v_gross_discount > v_gross_line then
      raise exception using errcode = 'check_violation', message = 'discount cannot exceed line subtotal';
    end if;

    if v_gross_discount > 0 and (
      not erp.has_permission('sales.discount', target_branch_id)
      or nullif(btrim(line->>'discount_reason'), '') is null
    ) then
      raise exception using errcode = 'insufficient_privilege', message = 'discount requires sales.discount and an explicit reason';
    end if;

    v_line_total := v_gross_line - v_gross_discount;
    v_net_subtotal := round(v_gross_line / (1 + v_server_tax_rate / 100), 4);
    v_net_discount := round(v_gross_discount / (1 + v_server_tax_rate / 100), 4);
    v_tax_amount := v_line_total - (v_net_subtotal - v_net_discount);

    v_v2_lines := v_v2_lines || jsonb_build_array(jsonb_build_object(
      'kind', line_kind::text,
      'product_id', parsed_product_id,
      'variant_id', parsed_variant_id,
      'inventory_unit_id', parsed_inventory_unit_id,
      'from_location_id', parsed_location_id,
      'description', coalesce(nullif(btrim(line->>'description'), ''), 'Venta mostrador'),
      'quantity', quantity_val,
      'unit_gross_price', v_server_gross,
      'gross_discount_amount', v_gross_discount,
      'tax_rate_percent', v_server_tax_rate,
      'net_subtotal_amount', v_net_subtotal,
      'discount_amount', v_net_discount,
      'tax_amount', v_tax_amount,
      'line_total', v_line_total,
      'discount_reason', line->>'discount_reason'
    ));
  end loop;

  -- Validate payment lines in wrapper
  for payment_line in select value from jsonb_array_elements(payment_lines) loop
    if jsonb_typeof(payment_line) <> 'object' then
      raise exception using errcode = 'invalid_parameter_value', message = 'invalid payment line';
    end if;

    begin
      v_raw_val := (payment_line->>'amount')::numeric;
      perform (payment_line->>'payment_method_id')::uuid;
      perform nullif(payment_line->>'cash_session_id', '')::uuid;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = 'invalid payment line';
    end;

    if v_raw_val is null or v_raw_val < 0 or v_raw_val = 'NaN'::numeric
       or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
       or v_raw_val <> round(v_raw_val, 4) then
      raise exception using errcode = 'invalid_parameter_value',
        message = 'payment amount must be non-negative with at most 4 decimal places';
    end if;
  end loop;

  -- 7. Call private core with validated v2 origin and lines
  v_sale_id := erp.create_sale_core(
    'pos_v2',
    'v2',
    target_branch_id,
    target_customer_id,
    sale_currency,
    target_exchange_snapshot_id,
    operation_key,
    operation_reason,
    v_v2_lines,
    payment_lines,
    target_reservation_batch_id,
    v_cmd_row.request_hash
  );

  -- 8. Customer snapshot for invoice document
  if target_customer_id is null then
    v_customer_snapshot := jsonb_build_object('customer_id', null, 'display_name', 'Consumidor Final', 'kind', 'individual');
  else
    select jsonb_build_object(
      'customer_id', customer_row.id,
      'display_name', customer_row.display_name,
      'legal_name', customer_row.legal_name,
      'kind', customer_row.kind::text,
      'email', customer_row.email,
      'phone', customer_row.phone,
      'whatsapp_phone', customer_row.whatsapp_phone
    ) into v_customer_snapshot
    from erp.customers customer_row
    where customer_row.id = target_customer_id
      and customer_row.organization_id = current_org_id
      and customer_row.is_active;
    if v_customer_snapshot is null then
      raise exception using errcode = 'foreign_key_violation', message = 'active sale customer is required for the invoice';
    end if;
  end if;

  -- 9. Sequential invoice number
  select coalesce(max(case target_invoice_kind
    when 'fiscal' then substring(document_row.document_number from 3)::numeric
    else substring(document_row.document_number from 4)::numeric
  end), 0) into v_existing_max
  from erp.documents document_row
  where document_row.organization_id = current_org_id
    and document_row.branch_id = target_branch_id
    and document_row.document_number ~ (case target_invoice_kind
      when 'fiscal' then '^F-[0-9]{1,19}$' else '^NF-[0-9]{1,19}$' end);

  if v_existing_max >= 9223372036854775807 then
    raise exception using errcode = 'numeric_value_out_of_range', message = 'local invoice sequence is exhausted';
  end if;

  insert into erp.document_counters(organization_id, branch_id, invoice_kind, last_number)
  values (current_org_id, target_branch_id, target_invoice_kind, v_existing_max::bigint + 1)
  on conflict (organization_id, branch_id, invoice_kind)
  do update set last_number = greatest(erp.document_counters.last_number, v_existing_max::bigint) + 1
  returning last_number into v_next_number;

  v_document_number := (case target_invoice_kind when 'fiscal' then 'F-' else 'NF-' end)
    || case when length(v_next_number::text) < 8 then lpad(v_next_number::text, 8, '0') else v_next_number::text end;

  -- 10. Document content hash strictly sealed from PERSISTED database facts
  select jsonb_agg(jsonb_build_object(
    'line_number', line_row.line_number,
    'kind', line_row.kind::text,
    'product_id', line_row.product_id,
    'variant_id', line_row.variant_id,
    'description', line_row.description,
    'quantity', line_row.quantity,
    'unit_price', line_row.unit_price,
    'unit_gross_price', line_row.unit_gross_price,
    'net_subtotal_amount', line_row.net_subtotal_amount,
    'gross_discount_amount', line_row.gross_discount_amount,
    'discount_amount', line_row.discount_amount,
    'tax_rate_percent', line_row.tax_rate_percent,
    'tax_amount', line_row.tax_amount,
    'line_total', line_row.line_total,
    'pricing_version', line_row.pricing_version
  ) order by line_row.line_number)
  into persisted_lines
  from erp.sale_lines line_row
  where line_row.sale_id = v_sale_id
    and line_row.organization_id = current_org_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'payment_method_id', pay_row.payment_method_id,
    'amount', pay_row.amount,
    'currency_code', pay_row.currency_code
  ) order by pay_row.id), '[]'::jsonb)
  into persisted_payments
  from erp.payments pay_row
  where pay_row.sale_id = v_sale_id
    and pay_row.organization_id = current_org_id;

  v_document_payload := jsonb_build_object(
    'sale_id', v_sale_id,
    'branch_id', target_branch_id,
    'invoice_kind', target_invoice_kind,
    'pricing_version', 'v2',
    'customer', v_customer_snapshot,
    'lines', persisted_lines,
    'payment_lines', persisted_payments,
    'reason', operation_reason
  );
  v_content_sha256 := encode(extensions.digest(convert_to(v_document_payload::text, 'UTF8'), 'sha256'), 'hex');

  v_document_id := erp.issue_invoice_document(
    target_branch_id, v_template_version_id, v_sale_id,
    target_invoice_kind, v_document_number, v_customer_snapshot, v_content_sha256,
    operation_key || ':invoice-document', operation_reason
  );

  perform erp.complete_stage8_command(v_cmd_row.id, v_document_id);

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'document_id', v_document_id,
    'document_number', v_document_number,
    'invoice_kind', target_invoice_kind
  );
end;
$$;
