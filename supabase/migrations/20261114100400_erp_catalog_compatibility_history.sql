alter table erp.product_compatible_models add column is_active boolean not null default true;

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

  -- Conservar como inactivos los vínculos omitidos.
  update erp.product_compatible_models set is_active = false
   where organization_id = org_id and product_id = p_product_id and is_active
     and (v_clean_model_ids is null or not (model_id = any(v_clean_model_ids)));

  -- Insertar nuevos vínculos
  if v_clean_model_ids is not null and array_length(v_clean_model_ids, 1) > 0 then
    insert into erp.product_compatible_models (
      organization_id, product_id, model_id, created_by
    )
    select org_id, p_product_id, m, auth.uid()
      from unnest(v_clean_model_ids) as m
    on conflict (organization_id, product_id, model_id) do update set is_active = true;
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
  where cm.product_id = p_product_id and cm.organization_id = org_id and cm.is_active;

  return result;
end;
$$;
