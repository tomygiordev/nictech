-- Migration: 20261020232914_erp_catalog_compatibility_and_variant_commands.sql
-- Description: ERP N:M product compatibility and transactional variant management RPCs with server stock granularity invariants

-- ============================================================================
-- A. Compatibilidad N:M ERP real con un SKU y stock físico único
-- ============================================================================

create table if not exists erp.product_compatible_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  product_id uuid not null,
  model_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint product_compatible_models_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint product_compatible_models_model_fk foreign key (model_id, organization_id)
    references erp.product_models(id, organization_id) on delete restrict,
  constraint product_compatible_models_unique unique (organization_id, product_id, model_id)
);

-- Index for searching compatible products by model (unique constraint already covers org, product, model)
create index if not exists idx_product_compatible_models_model
  on erp.product_compatible_models (organization_id, model_id);

alter table erp.product_compatible_models enable row level security;

drop policy if exists product_compatible_models_select on erp.product_compatible_models;
create policy product_compatible_models_select on erp.product_compatible_models
  for select to authenticated
  using (
    organization_id = erp.current_organization_id()
    and (erp.has_permission('catalog.view') or erp.has_permission('catalog.manage'))
  );

revoke all on erp.product_compatible_models from public, anon, authenticated;
grant select on erp.product_compatible_models to authenticated;
grant all on erp.product_compatible_models to service_role;

-- Backfill seguro de vínculos principales existentes desde erp.products.model_id
insert into erp.product_compatible_models (
  organization_id, product_id, model_id, created_at, created_by
)
select
  p.organization_id,
  p.id,
  p.model_id,
  coalesce(p.created_at, now()),
  p.created_by
from erp.products p
where p.model_id is not null
on conflict (organization_id, product_id, model_id) do nothing;

-- Drop prior signatures to prevent insecure legacy overloads
drop function if exists erp.set_product_compatible_models(uuid, uuid[]);
drop function if exists erp.set_product_compatible_models(uuid, uuid[], timestamptz);

-- RPC atómico para fijar conjunto de compatibilidades del producto con control optimista de concurrencia
create or replace function erp.set_product_compatible_models(
  p_product_id uuid,
  p_model_ids uuid[],
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
  v_clean_model_ids uuid[];
  v_valid_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = 'insufficient_privilege', message = 'authenticated user required';
  end if;

  if org_id is null or not erp.has_permission('catalog.manage') then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog.manage permission is required';
  end if;

  -- Bloqueo transaccional del producto y validación de existencia en la organización activa
  select id, organization_id, updated_at
    into v_prod_id, v_prod_org, v_current_updated_at
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

  -- Limpieza y deduplicación de modelos
  select array_agg(distinct m)
    into v_clean_model_ids
    from unnest(coalesce(p_model_ids, '{}'::uuid[])) as m
   where m is not null;

  -- Validar que todos los modelos pertenezcan a la misma org y estén activos
  if v_clean_model_ids is not null and array_length(v_clean_model_ids, 1) > 0 then
    select count(*)
      into v_valid_count
      from erp.product_models
     where organization_id = org_id
       and is_active = true
       and id = any(v_clean_model_ids);

    if v_valid_count <> array_length(v_clean_model_ids, 1) then
      raise exception using errcode = 'invalid_parameter_value',
        message = 'one or more model IDs are invalid, inactive, or belong to another organization';
    end if;
  end if;

  -- Sincronizar: eliminar los que ya no están en el conjunto enviado
  delete from erp.product_compatible_models
   where organization_id = org_id
     and product_id = p_product_id
     and (v_clean_model_ids is null or not (model_id = any(v_clean_model_ids)));

  -- Insertar nuevos vínculos
  if v_clean_model_ids is not null and array_length(v_clean_model_ids, 1) > 0 then
    insert into erp.product_compatible_models (
      organization_id, product_id, model_id, created_by
    )
    select org_id, p_product_id, m, auth.uid()
      from unnest(v_clean_model_ids) as m
    on conflict (organization_id, product_id, model_id) do nothing;
  end if;

  -- Tocar updated_at del producto para reflejar cambios en auditoría y concurrencia
  update erp.products
     set updated_at = now(),
         updated_by = auth.uid()
   where id = p_product_id and organization_id = org_id;

  return jsonb_build_object(
    'product_id', p_product_id,
    'compatible_model_ids', coalesce(v_clean_model_ids, '{}'::uuid[])
  );
end;
$$;

revoke all on function erp.set_product_compatible_models(uuid, uuid[], timestamptz) from public, anon;
grant execute on function erp.set_product_compatible_models(uuid, uuid[], timestamptz) to authenticated, service_role;

-- Getter tipado de modelos compatibles
create or replace function erp.get_product_compatible_models(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = 'insufficient_privilege', message = 'authenticated user required';
  end if;

  if org_id is null or (not erp.has_permission('catalog.view') and not erp.has_permission('catalog.manage')) then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog.view or catalog.manage permission required';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', cm.id,
        'model_id', m.id,
        'model_code', m.code,
        'model_name', m.name,
        'brand_id', b.id,
        'brand_name', b.name
      ) order by b.name asc, m.name asc
    ),
    '[]'::jsonb
  ) into result
  from erp.product_compatible_models cm
  join erp.product_models m on m.id = cm.model_id and m.organization_id = org_id
  left join erp.brands b on b.id = m.brand_id and b.organization_id = org_id
  where cm.product_id = p_product_id and cm.organization_id = org_id;

  return result;
end;
$$;

revoke all on function erp.get_product_compatible_models(uuid) from public, anon;
grant execute on function erp.get_product_compatible_models(uuid) to authenticated, service_role;


-- ============================================================================
-- B. Invariantes de Granularidad de Stock Servidor & Concurrencia Compartida
-- ============================================================================

-- 1. Invariante al crear o reactivar variantes: rechazar si existe stock, reserva activa o unidad física padre
create or replace function erp.enforce_variant_creation_stock_granularity()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  v_has_parent_balance boolean := false;
  v_has_parent_reservation boolean := false;
  v_has_parent_units boolean := false;
begin
  -- Bloqueo transaccional de concurrencia compartido a nivel de (organization_id, product_id)
  perform pg_advisory_xact_lock(hashtext(new.organization_id::text), hashtext(new.product_id::text));

  -- Comprobar balance padre activo
  select exists (
    select 1 from erp.stock_balances
     where organization_id = new.organization_id
       and product_id = new.product_id
       and variant_id is null
       and (quantity_on_hand <> 0 or quantity_reserved <> 0)
  ) into v_has_parent_balance;

  -- Comprobar reservas padre vigentes (lote activo y no expirado)
  select exists (
    select 1
      from erp.stock_reservations sr
      join erp.stock_reservation_batches srb
        on srb.id = sr.batch_id
       and srb.organization_id = sr.organization_id
     where sr.organization_id = new.organization_id
       and sr.product_id = new.product_id
       and sr.variant_id is null
       and srb.status = 'active'
       and srb.expires_at > now()
  ) into v_has_parent_reservation;

  -- Comprobar unidades serializadas padre en estados físicos no terminales
  select exists (
    select 1 from erp.inventory_units
     where organization_id = new.organization_id
       and product_id = new.product_id
       and variant_id is null
       and is_active = true
       and status not in ('sold', 'retired')
  ) into v_has_parent_units;

  if v_has_parent_balance or v_has_parent_reservation or v_has_parent_units then
    raise exception using errcode = 'check_violation',
      message = 'Cannot create variants for product with existing parent stock, active reservations, or inventory units without explicit stock conversion';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_variant_creation_stock_granularity on erp.product_variants;
create trigger trg_enforce_variant_creation_stock_granularity
  before insert on erp.product_variants
  for each row
  execute function erp.enforce_variant_creation_stock_granularity();

-- 2. Invariante en stock_balances: si el producto ya tiene variantes (incluso pausadas), prohibir saldo padre activo
create or replace function erp.enforce_parent_stock_balance_granularity()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
begin
  if new.variant_id is null and (new.quantity_on_hand <> 0 or new.quantity_reserved <> 0) then
    perform pg_advisory_xact_lock(hashtext(new.organization_id::text), hashtext(new.product_id::text));

    if exists (
      select 1 from erp.product_variants
       where organization_id = new.organization_id
         and product_id = new.product_id
    ) then
      raise exception using errcode = 'check_violation',
        message = 'Cannot hold or update active parent stock for a product that has variants';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_parent_stock_balance_granularity on erp.stock_balances;
create trigger trg_enforce_parent_stock_balance_granularity
  before insert or update of variant_id, quantity_on_hand, quantity_reserved on erp.stock_balances
  for each row
  execute function erp.enforce_parent_stock_balance_granularity();

-- 3. Invariante en stock_reservations: prohibir nueva reserva padre si el producto ya tiene variantes
create or replace function erp.enforce_parent_stock_reservation_granularity()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
begin
  if new.variant_id is null and new.quantity > 0 then
    perform pg_advisory_xact_lock(hashtext(new.organization_id::text), hashtext(new.product_id::text));

    if exists (
      select 1 from erp.product_variants
       where organization_id = new.organization_id
         and product_id = new.product_id
    ) then
      raise exception using errcode = 'check_violation',
        message = 'Cannot create parent stock reservations for a product that has variants';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_parent_stock_reservation_granularity on erp.stock_reservations;
create trigger trg_enforce_parent_stock_reservation_granularity
  before insert or update of variant_id, quantity on erp.stock_reservations
  for each row
  execute function erp.enforce_parent_stock_reservation_granularity();

-- 4. Invariante en inventory_units: prohibir unidad serializada padre activa si el producto ya tiene variantes
create or replace function erp.enforce_parent_inventory_unit_granularity()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
begin
  if new.variant_id is null and new.is_active = true and new.status not in ('sold', 'retired') then
    perform pg_advisory_xact_lock(hashtext(new.organization_id::text), hashtext(new.product_id::text));

    if exists (
      select 1 from erp.product_variants
       where organization_id = new.organization_id
         and product_id = new.product_id
    ) then
      raise exception using errcode = 'check_violation',
        message = 'Cannot register or activate parent inventory units for a product that has variants';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_parent_inventory_unit_granularity on erp.inventory_units;
create trigger trg_enforce_parent_inventory_unit_granularity
  before insert or update of variant_id, is_active, status on erp.inventory_units
  for each row
  execute function erp.enforce_parent_inventory_unit_granularity();


-- ============================================================================
-- C. Edición de variantes existentes + alta de nuevas + pausar/reactivar
-- ============================================================================

drop function if exists erp.manage_product_variants(uuid, jsonb);
drop function if exists erp.manage_product_variants(uuid, jsonb, timestamptz);

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

  v_existing_var record;
  v_existing_ident record;

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

  select id, organization_id, updated_at
    into v_prod_id, v_prod_org, v_current_updated_at
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

  -- Si se van a crear nuevas variantes, verificar que el producto padre NO tenga stock físico, reservas vigentes ni unidades serializadas no terminales
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

      select id, attributes, price_delta, is_active
        into v_existing_var
        from erp.product_variants
       where id = v_var_id
         and product_id = p_product_id
         and organization_id = org_id;

      if not found then
        raise exception using errcode = 'invalid_parameter_value',
          message = 'variant ' || v_var_id_text || ' does not belong to product ' || p_product_id::text;
      end if;

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

      -- Actualizar variante preservando atributos no-color y price_delta legacy
      update erp.product_variants
         set code = v_norm_code,
             name = v_name,
             attributes = coalesce(v_existing_var.attributes, '{}'::jsonb) || jsonb_build_object('color', v_name),
             is_active = v_is_active,
             updated_at = now()
       where id = v_var_id and product_id = p_product_id and organization_id = org_id;

    else
      -- Alta de nueva variante (hereda precio base: price_delta = 0)
      if exists (
        select 1 from erp.product_variants
         where organization_id = org_id
           and product_id = p_product_id
           and upper(btrim(code)) = v_norm_code
      ) then
        raise exception using errcode = 'unique_violation',
          message = 'variant code ' || v_norm_code || ' already exists for this product';
      end if;

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
        p_product_id,
        v_norm_code,
        v_name,
        jsonb_build_object('color', v_name),
        0,
        v_is_active
      ) returning id into v_var_id;
    end if;

    -- Manejo inmutable y seguro del barcode en erp.product_identifiers
    -- (trigger erp.prevent_identifier_reassignment prohíbe mutar value, kind, product_id, variant_id)
    if variant_item ? 'barcode' then
      if v_barcode is not null then
        v_norm_barcode := upper(regexp_replace(v_barcode, '[[:space:]]+', '', 'g'));

        -- Comprobar si este normalized_value ya existe en la organización
        select id, product_id, variant_id, kind, is_active, is_primary
          into v_existing_ident
          from erp.product_identifiers
         where organization_id = org_id
           and normalized_value = v_norm_barcode;

        if found then
          -- Conflicto: asignado a otro producto u otra variante
          if v_existing_ident.product_id <> p_product_id
            or v_existing_ident.variant_id is distinct from v_var_id
            or v_existing_ident.kind <> 'barcode' then
            raise exception using errcode = 'unique_violation',
              message = 'barcode ' || v_barcode || ' is already assigned to another catalog item';
          end if;

          -- Pertenece a esta misma variante: reactivar y fijar como primary sin mutar value
          -- Primero desprimar cualquier otro barcode de esta variante
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

          -- Reactivar el registro preexistente idéntico
          update erp.product_identifiers
             set is_active = true,
                 is_primary = true,
                 updated_at = now(),
                 updated_by = auth.uid()
           where id = v_existing_ident.id;

        else
          -- Barcode nuevo para la organización: desprimar/pausar barcode anterior y crear nueva fila
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
        -- Barcode explícitamente null o vacío: desprimar/pausar barcode anterior sin borrar histórico
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
      'barcode', v_barcode
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
