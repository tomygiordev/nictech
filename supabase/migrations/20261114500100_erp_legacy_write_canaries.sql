-- W3 parte 2: canarios observe/block sobre tablas legacy y captura de stock según modo.
-- Todo nace en off; sin activar banderas ningún comportamiento actual cambia.

create table if not exists erp.legacy_write_canary_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references erp.organizations (id) on delete restrict,
  group_code text not null check (group_code in ('catalog', 'stock', 'prices_promos', 'repairs', 'dashboard')),
  table_name text not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  touched_columns text[] not null default '{}',
  row_id text,
  actor_user_id uuid,
  actor_role text not null,
  created_at timestamptz not null default clock_timestamp()
);

comment on table erp.legacy_write_canary_events is
  'Registro de escrituras legacy detectadas por los canarios de corte (modo observe).';

create index if not exists legacy_write_canary_events_org_group_idx
  on erp.legacy_write_canary_events (organization_id, group_code, created_at desc);

alter table erp.legacy_write_canary_events enable row level security;

drop policy if exists legacy_write_canary_events_select on erp.legacy_write_canary_events;
create policy legacy_write_canary_events_select
  on erp.legacy_write_canary_events
  for select
  to authenticated
  using (
    organization_id = erp.current_organization_id()
    and erp.has_permission('audit.view')
  );

revoke all on table erp.legacy_write_canary_events from public, anon, authenticated, service_role;
grant select on table erp.legacy_write_canary_events to authenticated, service_role;

-- Las proyecciones del ERP hacia public.* marcan el GUC erp.projecting_storefront_catalog = 'on'
-- (además de erp.projecting_storefront_stock que ya usa project_storefront_product_stock)
-- para que nunca queden bloqueadas ni registradas por el canario, incluso en llamadas directas.

create or replace function erp.project_catalog_sheet(p_org uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  p erp.products%rowtype;
  v_image text;
  v_gallery text[];
  v_visible boolean;
  v_tags text[];
  v_condition text;
  v_capacity text;
  v_inserted integer;
  v_public jsonb;
  v_prev_projection text;
begin
  if to_regclass('public.products') is null or to_regclass('public.product_variants') is null then
    return;
  end if;
  if not exists (select 1 from erp.storefront_catalog_sync where organization_id = p_org) then
    return;
  end if;
  select * into p from erp.products where id = p_id and organization_id = p_org and item_kind = 'product';
  if not found then
    return;
  end if;

  select coalesce(
    (select m.storage_path from erp.product_media m
     where m.organization_id = p_org and m.product_id = p_id and m.variant_id is null and m.is_active and m.is_primary
     limit 1),
    p.web_image_path
  ) into v_image;

  execute 'select to_jsonb(w) from public.products w where id = $1' into v_public using p_id;

  if p.media_initialized then
    select coalesce(array_agg(m.storage_path order by m.sort_order, m.id), '{}')
      into v_gallery
    from erp.product_media m
    where m.organization_id = p_org and m.product_id = p_id and m.variant_id is null and m.is_active and not m.is_primary;
  else
    select coalesce(array_agg(x.value order by x.ord), '{}')
      into v_gallery
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_public -> 'additional_images') = 'array' then v_public -> 'additional_images' else '[]'::jsonb end
    ) with ordinality x(value, ord);
  end if;

  if p.sheet_fields_initialized then
    v_tags := p.tags;
    v_condition := initcap(p.condition);
    v_capacity := p.capacity;
  else
    select coalesce(array_agg(x.value order by x.ord), p.tags)
      into v_tags
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_public -> 'tags') = 'array' then v_public -> 'tags' else '[]'::jsonb end
    ) with ordinality x(value, ord);
    v_condition := v_public ->> 'condition';
    v_capacity := v_public ->> 'capacity';
  end if;

  v_visible := p.is_active and p.publish_on_web and p.allow_online_sale and p.can_sell;

  v_prev_projection := current_setting('erp.projecting_storefront_catalog', true);
  perform set_config('erp.projecting_storefront_catalog', 'on', true);

  begin
    if v_public is not null then
      update public.products
         set name = coalesce(nullif(p.public_name, ''), p.internal_name),
             description = p.public_description,
             price = p.base_sale_price,
             image_url = v_image,
             is_active = v_visible,
             category_id = p.category_id,
             brand_id = p.brand_id,
             model_id = p.model_id
       where id = p_id
         and (name, description, price, image_url, is_active, category_id, brand_id, model_id)
          is distinct from (
            coalesce(nullif(p.public_name, ''), p.internal_name),
            p.public_description,
            p.base_sale_price,
            v_image,
            v_visible,
            p.category_id,
            p.brand_id,
            p.model_id
          );
    elsif v_visible then
      insert into public.products (id, name, description, price, image_url, stock, is_active, category_id, brand_id, model_id)
      values (
        p.id,
        coalesce(nullif(p.public_name, ''), p.internal_name),
        p.public_description,
        p.base_sale_price,
        v_image,
        0,
        true,
        p.category_id,
        p.brand_id,
        p.model_id
      );
      perform erp.project_storefront_product_stock(p_org, p_id);
    else
      perform set_config('erp.projecting_storefront_catalog', coalesce(v_prev_projection, ''), true);
      return;
    end if;

    if exists (select 1 from pg_attribute where attrelid = to_regclass('public.products') and attname = 'additional_images' and not attisdropped) then
      execute 'update public.products set additional_images = $1 where id = $2 and coalesce(additional_images, ''{}''::text[]) is distinct from $1'
        using v_gallery, p_id;
    end if;
    if exists (select 1 from pg_attribute where attrelid = to_regclass('public.products') and attname = 'tags' and not attisdropped) then
      execute 'update public.products set tags = $1 where id = $2 and coalesce(tags, ''{}''::text[]) is distinct from $1'
        using v_tags, p_id;
    end if;
    if exists (select 1 from pg_attribute where attrelid = to_regclass('public.products') and attname = 'condition' and not attisdropped) then
      execute 'update public.products set condition = $1 where id = $2 and condition is distinct from $1'
        using v_condition, p_id;
    end if;
    if exists (select 1 from pg_attribute where attrelid = to_regclass('public.products') and attname = 'capacity' and not attisdropped) then
      execute 'update public.products set capacity = $1 where id = $2 and capacity is distinct from $1'
        using v_capacity, p_id;
    end if;

    -- Variants created while the parent was a draft have no public row yet.
    if v_visible then
      insert into public.product_variants (id, product_id, color, image_url, stock, is_active)
      select v.id, v.product_id, coalesce(nullif(v.attributes ->> 'color', ''), v.name), v.image_path, 0, v.is_active
      from erp.product_variants v
      where v.organization_id = p_org
        and v.product_id = p_id
        and not exists (select 1 from public.product_variants w where w.id = v.id)
      on conflict (id) do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted > 0 then
        perform erp.project_storefront_product_stock(p_org, p_id);
      end if;
    end if;

    perform set_config('erp.projecting_storefront_catalog', coalesce(v_prev_projection, ''), true);
  exception when others then
    perform set_config('erp.projecting_storefront_catalog', coalesce(v_prev_projection, ''), true);
    raise;
  end;
end;
$$;

revoke all on function erp.project_catalog_sheet(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function erp.project_storefront_variant_prices(p_org uuid, p_product uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  v_prev_projection text;
begin
  if to_regclass('public.product_variants') is null
     or not exists (
       select 1 from pg_attribute
       where attrelid = to_regclass('public.product_variants') and attname = 'price' and not attisdropped
     )
     or not exists (select 1 from erp.storefront_catalog_sync where organization_id = p_org) then
    return;
  end if;

  v_prev_projection := current_setting('erp.projecting_storefront_catalog', true);
  perform set_config('erp.projecting_storefront_catalog', 'on', true);

  begin
    update public.product_variants w
       set price = resolved.price
      from (
        select v.id, v.product_id,
          round(coalesce(v.final_price_ars, p.base_sale_price, 0), 2)::numeric(12, 2) as price
        from erp.product_variants v
        join erp.products p on p.id = v.product_id and p.organization_id = v.organization_id
        where v.organization_id = p_org and v.product_id = p_product
      ) resolved
     where w.id = resolved.id
       and w.product_id = resolved.product_id
       and w.price is distinct from resolved.price;

    perform set_config('erp.projecting_storefront_catalog', coalesce(v_prev_projection, ''), true);
  exception when others then
    perform set_config('erp.projecting_storefront_catalog', coalesce(v_prev_projection, ''), true);
    raise;
  end;
end;
$$;

revoke all on function erp.project_storefront_variant_prices(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function erp.sync_erp_variant_to_storefront()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  color_name text;
  v_prev_projection text;
begin
  if new.organization_id <> '10000000-0000-0000-0000-000000000001'::uuid
     or not exists (select 1 from erp.storefront_catalog_sync where organization_id = new.organization_id) then
    return new;
  end if;

  color_name := coalesce(nullif(new.attributes ->> 'color', ''), new.name);
  v_prev_projection := current_setting('erp.projecting_storefront_catalog', true);
  perform set_config('erp.projecting_storefront_catalog', 'on', true);

  begin
    if exists (select 1 from public.product_variants where id = new.id) then
      update public.product_variants
         set color = color_name,
             image_url = new.image_path,
             is_active = new.is_active
       where id = new.id
         and (color, image_url, is_active) is distinct from (color_name, new.image_path, new.is_active);
    elsif exists (select 1 from public.products where id = new.product_id) then
      insert into public.product_variants (id, product_id, color, image_url, stock, is_active)
      values (new.id, new.product_id, color_name, new.image_path, 0, new.is_active);
      perform erp.project_storefront_product_stock(new.organization_id, new.product_id);
    end if;

    perform set_config('erp.projecting_storefront_catalog', coalesce(v_prev_projection, ''), true);
  exception when others then
    perform set_config('erp.projecting_storefront_catalog', coalesce(v_prev_projection, ''), true);
    raise;
  end;

  return new;
end;
$$;

revoke all on function erp.sync_erp_variant_to_storefront() from public, anon, authenticated, service_role;

create or replace function erp.sync_erp_reference_to_storefront()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  v_prev_projection text;
begin
  if new.organization_id <> '10000000-0000-0000-0000-000000000001'::uuid
     or not exists (
       select 1 from erp.storefront_catalog_sync where organization_id = new.organization_id
     ) then
    return new;
  end if;

  v_prev_projection := current_setting('erp.projecting_storefront_catalog', true);
  perform set_config('erp.projecting_storefront_catalog', 'on', true);

  begin
    if tg_table_name = 'product_categories' then
      insert into public.categories (id, name) values (new.id, new.name)
      on conflict (id) do update set name = excluded.name
        where public.categories.name is distinct from excluded.name;
    elsif tg_table_name = 'brands' then
      insert into public.brands (id, name) values (new.id, new.name)
      on conflict (id) do update set name = excluded.name
        where public.brands.name is distinct from excluded.name;
    else
      insert into public.models (id, brand_id, name)
      values (new.id, new.brand_id, new.name)
      on conflict (id) do update set brand_id = excluded.brand_id, name = excluded.name
        where (public.models.brand_id, public.models.name)
          is distinct from (excluded.brand_id, excluded.name);
    end if;

    perform set_config('erp.projecting_storefront_catalog', coalesce(v_prev_projection, ''), true);
  exception when others then
    perform set_config('erp.projecting_storefront_catalog', coalesce(v_prev_projection, ''), true);
    raise;
  end;

  return new;
end;
$$;

revoke all on function erp.sync_erp_reference_to_storefront() from public, anon, authenticated, service_role;

create or replace function erp.sync_storefront_product_to_erp()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  target_org uuid;
  existing erp.products%rowtype;
  resolved_category uuid;
  resolved_brand uuid;
  resolved_model uuid;
  v_type uuid;
  v_unit uuid;
  img text;
  ord integer := 0;
  old_row boolean;
  v_condition text;
  v_tags text[];
  v_capacity text;
  v_legacy_condition boolean;
  v_images text[];
begin
  if pg_trigger_depth() > 1 or current_setting('erp.projecting_storefront_catalog', true) = 'on' then
    return coalesce(new, old);
  end if;
  if (select count(*) from erp.storefront_catalog_sync) <> 1 then
    return coalesce(new, old);
  end if;
  select organization_id into target_org from erp.storefront_catalog_sync;
  if not erp.storefront_catalog_write_allowed(target_org) then
    raise exception using errcode = '42501', message = 'catalog.manage is required for storefront catalog changes';
  end if;
  if tg_op = 'DELETE' then
    update erp.products set is_active = false, publish_on_web = false, allow_online_sale = false
    where id = old.id and organization_id = target_org;
    return old;
  end if;
  select * into existing from erp.products where id = new.id;
  old_row := found;
  if old_row and existing.organization_id <> target_org then
    raise exception using errcode = '23505', message = 'storefront UUID belongs to another ERP organization';
  end if;
  resolved_category := nullif(to_jsonb(new) ->> 'category_id', '')::uuid;
  resolved_model := nullif(to_jsonb(new) ->> 'model_id', '')::uuid;
  resolved_brand := coalesce(
    nullif(to_jsonb(new) ->> 'brand_id', '')::uuid,
    (select brand_id from erp.product_models where id = resolved_model and organization_id = target_org)
  );
  if nullif(btrim(new.name), '') is null or new.price is null or new.price < 0
     or new.price > 99999999999999.9999 or new.price = 'NaN'::numeric then
    raise exception using errcode = '23514', message = 'invalid storefront product name or price';
  end if;
  v_condition := lower(nullif(btrim(to_jsonb(new) ->> 'condition'), ''));
  v_legacy_condition := v_condition is not null and v_condition not in ('nuevo', 'usado', 'reacondicionado');
  if v_legacy_condition then
    v_condition := null;
  end if;
  select coalesce(array_agg(x.value order by x.ord), '{}')
    into v_tags
  from jsonb_array_elements_text(
    case when jsonb_typeof(to_jsonb(new) -> 'tags') = 'array' then to_jsonb(new) -> 'tags' else '[]'::jsonb end
  ) with ordinality x(value, ord);
  select coalesce(array_agg(x.value order by x.ord), '{}')
    into v_images
  from jsonb_array_elements_text(
    case when jsonb_typeof(to_jsonb(new) -> 'additional_images') = 'array' then to_jsonb(new) -> 'additional_images' else '[]'::jsonb end
  ) with ordinality x(value, ord);
  v_capacity := to_jsonb(new) ->> 'capacity';
  if old_row then
    update erp.products
       set internal_name = new.name,
           public_name = new.name,
           public_description = new.description,
           base_sale_price = new.price,
           web_image_path = new.image_url,
           category_id = resolved_category,
           brand_id = resolved_brand,
           model_id = resolved_model,
           tags = v_tags,
           condition = v_condition,
           capacity = v_capacity,
           sheet_fields_initialized = not v_legacy_condition,
           is_active = new.is_active,
           publish_on_web = new.is_active,
           allow_online_sale = new.is_active
     where id = new.id and organization_id = target_org;
  else
    select id into v_type from erp.product_types where organization_id = target_org and item_kind = 'product' and is_active order by created_at limit 1;
    select id into v_unit from erp.units_of_measure where organization_id = target_org and is_active order by created_at limit 1;
    insert into erp.products (
      id, organization_id, product_type_id, item_kind, category_id, brand_id, model_id, unit_id,
      internal_code, internal_name, public_name, public_description, inventory_tracking,
      base_sale_price, can_sell, publish_on_web, allow_online_sale, web_image_path,
      is_active, created_at, tags, condition, capacity, sheet_fields_initialized
    ) values (
      new.id, target_org, v_type, 'product', resolved_category, resolved_brand, resolved_model, v_unit,
      'WEB-' || replace(new.id::text, '-', ''), new.name, new.name, new.description, 'quantity',
      new.price, true, new.is_active, new.is_active, new.image_url,
      new.is_active, coalesce(new.created_at, now()), v_tags, v_condition, v_capacity, not v_legacy_condition
    );
  end if;
  if tg_op = 'INSERT'
     or (old.image_url, to_jsonb(old) -> 'additional_images') is distinct from (new.image_url, to_jsonb(new) -> 'additional_images') then
    update erp.products set media_initialized = true where id = new.id and organization_id = target_org;
    select coalesce(max(sort_order) + 1, 0) into ord
    from erp.product_media
    where organization_id = target_org and product_id = new.id and variant_id is not null and is_active;
    update erp.product_media
       set is_active = false, is_primary = false
     where organization_id = target_org and product_id = new.id and variant_id is null and is_active;
    if nullif(btrim(new.image_url), '') is not null then
      insert into erp.product_media (organization_id, product_id, storage_path, sort_order, is_primary)
      values (target_org, new.id, new.image_url, ord, true);
      ord := ord + 1;
    end if;
    foreach img in array v_images loop
      if nullif(btrim(img), '') is not null then
        insert into erp.product_media (organization_id, product_id, storage_path, sort_order, is_primary)
        values (target_org, new.id, img, ord, false);
        ord := ord + 1;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function erp.sync_storefront_product_to_erp() from public, anon, authenticated, service_role;

-- Captura de stock legacy respetando el modo del grupo 'stock' (off / observe / block).

create or replace function erp.capture_storefront_stock_delta(
  p_product_id uuid, p_variant_id uuid, p_previous integer, p_current integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  target_org constant uuid := '10000000-0000-0000-0000-000000000001';
  target_branch constant uuid := '20000000-0000-0000-0000-000000000001';
  intake_location constant uuid := '30000000-0000-0000-0000-000000000001';
  delta integer := p_current - p_previous;
  erp_available numeric;
  remaining numeric;
  take_quantity numeric;
  source_balance record;
  document_id uuid;
  document_line_id uuid;
  line_number integer := 0;
  weighted_cost numeric(18, 4);
  previous_reason text;
  previous_capture_setting text;
  v_stock_mode text := 'off';
  v_is_projection boolean :=
    current_setting('erp.projecting_storefront_stock', true) = 'on'
    or current_setting('erp.projecting_storefront_catalog', true) = 'on';
begin
  if delta = 0 then return; end if;
  if p_previous is null or p_current is null or p_previous < 0 or p_current < 0 then
    raise exception using errcode = 'check_violation', message = 'storefront stock must be a nonnegative integer';
  end if;

  if not v_is_projection then
    select g.legacy_write_mode
      into v_stock_mode
    from erp.storefront_cutover_groups g
    where g.organization_id = target_org
      and g.group_code = 'stock';
    v_stock_mode := coalesce(v_stock_mode, 'off');

    if v_stock_mode = 'block' then
      raise exception 'Este dato se gestiona desde el ERP' using errcode = '42501';
    end if;
  end if;

  if not exists (select 1 from erp.storefront_stock_capture where organization_id = target_org)
     or not exists (select 1 from erp.storefront_stock_projection where organization_id = target_org) then
    return;
  end if;
  if not exists (
    select 1 from erp.products ep
    where ep.id = p_product_id and ep.organization_id = target_org
      and ep.item_kind = 'product' and ep.inventory_tracking = 'quantity' and ep.is_active
      and (p_variant_id is null or exists (
        select 1 from erp.product_variants ev
        where ev.id = p_variant_id and ev.product_id = ep.id
          and ev.organization_id = target_org and ev.is_active
      ))
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'storefront stock item must be mapped to an active quantity-tracked ERP item';
  end if;
  if session_user <> 'postgres'
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and (auth.uid() is null
       or not erp.has_permission('stock.adjust', target_branch)
       or not erp.has_permission('stock.move', target_branch)
       or (delta > 0 and not erp.has_permission('costs.manage', target_branch))) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'ERP stock adjustment permission is required for legacy stock updates';
  end if;

  -- A historical storefront row must agree with ERP before applying its delta.
  -- This check refuses to compound an out-of-band write or a stale client edit.
  select greatest(coalesce(sum(b.quantity_on_hand - b.quantity_reserved), 0), 0)
    into erp_available
  from erp.stock_balances b
  join erp.locations l on l.id = b.location_id and l.organization_id = b.organization_id
  where b.organization_id = target_org and b.product_id = p_product_id
    and b.variant_id is not distinct from p_variant_id
    and l.is_active and l.contributes_to_web_stock;
  if erp_available <> p_previous then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'storefront stock differs from ERP; reconcile before changing it';
  end if;
  if exists (
    select 1 from erp.stock_balances b
    join erp.locations l on l.id = b.location_id and l.organization_id = b.organization_id
    where b.organization_id = target_org and b.product_id = p_product_id
      and b.variant_id is not distinct from p_variant_id
      and l.is_active and l.contributes_to_web_stock
      and b.branch_id <> target_branch
      and b.quantity_on_hand <> 0
  ) then
    raise exception using errcode = 'feature_not_supported',
      message = 'legacy stock capture cannot adjust inventory across ERP branches';
  end if;
  if not exists (
    select 1 from erp.locations
    where id = intake_location and organization_id = target_org
      and branch_id = target_branch and is_active and contributes_to_web_stock
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'ERP web intake location is not active';
  end if;

  if not v_is_projection
     and v_stock_mode = 'observe'
     and coalesce(current_setting('erp.from_stock_capture_trigger', true), '') <> 'on' then
    insert into erp.legacy_write_canary_events (
      organization_id,
      group_code,
      table_name,
      operation,
      touched_columns,
      row_id,
      actor_user_id,
      actor_role
    ) values (
      target_org,
      'stock',
      case when p_variant_id is null then 'public.products' else 'public.product_variants' end,
      'UPDATE',
      array['stock'],
      coalesce(p_variant_id, p_product_id)::text,
      auth.uid(),
      coalesce(nullif(auth.role(), ''), current_user)
    );
  end if;

  previous_reason := current_setting('erp.operation_reason', true);
  previous_capture_setting := current_setting('erp.applying_legacy_stock', true);
  perform set_config('erp.operation_reason', 'Ajuste de stock desde panel anterior', true);
  perform set_config('erp.applying_legacy_stock', 'on', true);

  insert into erp.stock_documents (
    organization_id, branch_id, kind, idempotency_key, request_hash,
    reason, source_type, source_id, posted_by
  ) values (
    target_org, target_branch, 'adjustment',
    'storefront-legacy-' || gen_random_uuid()::text,
    md5(jsonb_build_object('product', p_product_id, 'variant', p_variant_id,
      'before', p_previous, 'after', p_current, 'transaction', txid_current())::text),
    'Ajuste de stock desde panel anterior', 'storefront_legacy_stock',
    coalesce(p_variant_id, p_product_id), auth.uid()
  ) returning id into document_id;

  if delta > 0 then
    select coalesce(weighted_average_cost, 0) into weighted_cost
    from erp.inventory_cost_balances
    where organization_id = target_org and branch_id = target_branch
      and product_id = p_product_id
      and variant_key = coalesce(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid);
    weighted_cost := coalesce(weighted_cost, 0);
    insert into erp.stock_document_lines (
      organization_id, document_id, line_number, product_id, variant_id,
      to_location_id, quantity, unit_cost
    ) values (
      target_org, document_id, 1, p_product_id, p_variant_id,
      intake_location, delta, weighted_cost
    ) returning id into document_line_id;
    insert into erp.stock_movements (
      organization_id, branch_id, document_id, document_line_id,
      product_id, variant_id, location_id, quantity_delta, unit_cost, actor_id
    ) values (
      target_org, target_branch, document_id, document_line_id,
      p_product_id, p_variant_id, intake_location, delta, weighted_cost, auth.uid()
    );
    insert into erp.stock_balances (
      organization_id, branch_id, location_id, product_id, variant_id, quantity_on_hand
    ) values (
      target_org, target_branch, intake_location, p_product_id, p_variant_id, delta
    ) on conflict (organization_id, location_id, product_id, variant_key) do update
      set quantity_on_hand = erp.stock_balances.quantity_on_hand + excluded.quantity_on_hand,
          updated_at = now();
  else
    remaining := -delta;
    for source_balance in
      select b.id, b.location_id,
        greatest(b.quantity_on_hand - b.quantity_reserved, 0) as available
      from erp.stock_balances b
      join erp.locations l on l.id = b.location_id and l.organization_id = b.organization_id
      where b.organization_id = target_org and b.branch_id = target_branch
        and b.product_id = p_product_id
        and b.variant_id is not distinct from p_variant_id
        and l.is_active and l.contributes_to_web_stock
      order by b.location_id
      for update of b
    loop
      exit when remaining = 0;
      take_quantity := least(remaining, source_balance.available);
      if take_quantity <= 0 then continue; end if;
      line_number := line_number + 1;
      if line_number > 250 then
        raise exception using errcode = 'program_limit_exceeded',
          message = 'legacy stock adjustment exceeds 250 location lines';
      end if;
      insert into erp.stock_document_lines (
        organization_id, document_id, line_number, product_id, variant_id,
        from_location_id, quantity, unit_cost
      ) values (
        target_org, document_id, line_number, p_product_id, p_variant_id,
        source_balance.location_id, take_quantity, 0
      ) returning id into document_line_id;
      update erp.stock_balances
        set quantity_on_hand = quantity_on_hand - take_quantity, updated_at = now()
        where id = source_balance.id
          and quantity_on_hand - quantity_reserved >= take_quantity;
      if not found then
        raise exception using errcode = 'check_violation',
          message = 'ERP available stock changed during legacy adjustment';
      end if;
      insert into erp.stock_movements (
        organization_id, branch_id, document_id, document_line_id,
        product_id, variant_id, location_id, quantity_delta, unit_cost, actor_id
      ) values (
        target_org, target_branch, document_id, document_line_id,
        p_product_id, p_variant_id, source_balance.location_id,
        -take_quantity, 0, auth.uid()
      );
      remaining := remaining - take_quantity;
    end loop;
    if remaining <> 0 then
      raise exception using errcode = 'check_violation',
        message = 'insufficient ERP web stock for legacy adjustment';
    end if;
  end if;

  perform erp.process_stock_document_costs(document_id);
  perform set_config('erp.operation_reason', coalesce(previous_reason, ''), true);
  perform set_config('erp.applying_legacy_stock', coalesce(previous_capture_setting, ''), true);
end;
$$;

revoke all on function erp.capture_storefront_stock_delta(uuid, uuid, integer, integer)
  from public, anon, authenticated, service_role;

create or replace function erp.capture_storefront_stock_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  target_org constant uuid := '10000000-0000-0000-0000-000000000001';
  variant_total integer;
  parent_stock integer;
  previous_capture_setting text;
  previous_trigger_flag text;
begin
  if current_setting('erp.projecting_storefront_stock', true) = 'on'
     or current_setting('erp.applying_legacy_stock', true) = 'on'
     or not exists (select 1 from erp.storefront_stock_capture where organization_id = target_org)
     or not exists (select 1 from erp.storefront_stock_projection where organization_id = target_org) then
    return new;
  end if;

  if tg_table_name = 'products' then
    if tg_op = 'UPDATE' and new.stock is not distinct from old.stock then return new; end if;
    if exists (select 1 from public.product_variants where product_id = new.id) then
      select coalesce(sum(stock), 0) into variant_total
      from public.product_variants where product_id = new.id;
      if new.stock <> variant_total then
        raise exception using errcode = 'check_violation',
          message = 'parent product stock must equal the sum of its variants';
      end if;
      if tg_op = 'UPDATE' then return new; end if;
    end if;
    previous_trigger_flag := current_setting('erp.from_stock_capture_trigger', true);
    perform set_config('erp.from_stock_capture_trigger', 'on', true);
    begin
      perform erp.capture_storefront_stock_delta(
        new.id, null, case when tg_op = 'INSERT' then 0 else old.stock end, new.stock
      );
      perform set_config('erp.from_stock_capture_trigger', coalesce(previous_trigger_flag, ''), true);
    exception when others then
      perform set_config('erp.from_stock_capture_trigger', coalesce(previous_trigger_flag, ''), true);
      raise;
    end;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then
    raise exception using errcode = 'feature_not_supported',
      message = 'moving a storefront variant between products requires ERP migration';
  end if;
  if new.product_id is null then
    raise exception using errcode = 'check_violation',
      message = 'storefront stock variant requires a parent product';
  end if;
  if tg_op = 'UPDATE' and new.stock is not distinct from old.stock then return new; end if;

  select stock into parent_stock from public.products where id = new.product_id for update;
  if not found then
    raise exception using errcode = 'foreign_key_violation', message = 'variant parent product not found';
  end if;
  select coalesce(sum(stock), 0) into variant_total
  from public.product_variants where product_id = new.product_id;
  if tg_op = 'INSERT' and parent_stock <> variant_total - new.stock then
    raise exception using errcode = 'feature_not_supported',
      message = 'adding a variant to a product with unvarianted stock requires ERP migration';
  end if;
  if tg_op = 'UPDATE' and parent_stock <> variant_total - (new.stock - old.stock) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'storefront parent and variant stock were already inconsistent';
  end if;

  previous_trigger_flag := current_setting('erp.from_stock_capture_trigger', true);
  perform set_config('erp.from_stock_capture_trigger', 'on', true);
  begin
    perform erp.capture_storefront_stock_delta(
      new.product_id, new.id, case when tg_op = 'INSERT' then 0 else old.stock end, new.stock
    );
    perform set_config('erp.from_stock_capture_trigger', coalesce(previous_trigger_flag, ''), true);
  exception when others then
    perform set_config('erp.from_stock_capture_trigger', coalesce(previous_trigger_flag, ''), true);
    raise;
  end;

  previous_capture_setting := current_setting('erp.applying_legacy_stock', true);
  perform set_config('erp.applying_legacy_stock', 'on', true);
  begin
    update public.products set stock = variant_total where id = new.product_id;
    perform set_config('erp.applying_legacy_stock', coalesce(previous_capture_setting, ''), true);
  exception when others then
    perform set_config('erp.applying_legacy_stock', coalesce(previous_capture_setting, ''), true);
    raise;
  end;
  return new;
end;
$$;

revoke all on function erp.capture_storefront_stock_row() from public, anon, authenticated, service_role;

-- Trigger genérico de canario observe/block sobre tablas legacy de public.

create or replace function erp.legacy_write_canary()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  v_org uuid;
  v_old jsonb;
  v_new jsonb;
  v_row_id text;
  v_actor_id uuid;
  v_actor_role text;
  v_table text := tg_table_schema || '.' || tg_table_name;
  v_single_group text;
  v_single_mode text;
  v_catalog_mode text := 'off';
  v_stock_mode text := 'off';
  v_prices_mode text := 'off';
  v_touched text[] := '{}';
  v_catalog_cols text[] := '{}';
  v_stock_cols text[] := '{}';
  v_price_cols text[] := '{}';
  v_col text;
  v_rec record;
begin
  -- Las escrituras de la proyección del ERP (y cascades internos de captura de stock)
  -- nunca se registran ni se bloquean.
  if current_setting('erp.projecting_storefront_stock', true) = 'on'
     or current_setting('erp.applying_legacy_stock', true) = 'on'
     or current_setting('erp.projecting_storefront_catalog', true) = 'on' then
    return coalesce(new, old);
  end if;

  v_org := erp.current_organization_id();
  if v_org is null then
    select min(s.organization_id::text)::uuid
      into v_org
    from erp.storefront_catalog_sync s
    having count(*) = 1;
  end if;
  if v_org is null then
    select min(c.organization_id::text)::uuid
      into v_org
    from erp.storefront_stock_capture c
    having count(*) = 1;
  end if;
  if v_org is null then
    select min(o.id::text)::uuid
      into v_org
    from erp.organizations o
    having count(*) = 1;
  end if;
  if v_org is null then
    return coalesce(new, old);
  end if;

  if tg_table_name in ('categories', 'brands', 'models') then
    v_single_group := 'catalog';
  elsif tg_table_name in ('repairs', 'repair_logs') then
    v_single_group := 'repairs';
  elsif tg_table_name = 'inventory_movements' then
    v_single_group := 'stock';
  end if;

  if v_single_group is not null then
    -- Ruta caliente: una única consulta indexada por PK (organization_id, group_code).
    select g.legacy_write_mode
      into v_single_mode
    from erp.storefront_cutover_groups g
    where g.organization_id = v_org
      and g.group_code = v_single_group;

    if coalesce(v_single_mode, 'off') = 'off' then
      return coalesce(new, old);
    end if;

    if v_single_mode = 'block' then
      raise exception 'Este dato se gestiona desde el ERP' using errcode = '42501';
    end if;

    if tg_op = 'DELETE' then
      v_old := to_jsonb(old);
      v_row_id := v_old ->> 'id';
    elsif tg_op = 'INSERT' then
      v_new := to_jsonb(new);
      v_row_id := v_new ->> 'id';
      select coalesce(array_agg(k order by k), '{}')
        into v_touched
      from jsonb_object_keys(v_new) k
      where (v_new -> k) is not null and (v_new -> k) <> 'null'::jsonb;
    else
      v_old := to_jsonb(old);
      v_new := to_jsonb(new);
      v_row_id := coalesce(v_new ->> 'id', v_old ->> 'id');
      select coalesce(array_agg(k order by k), '{}')
        into v_touched
      from jsonb_object_keys(v_new) k
      where k <> 'updated_at'
        and (v_new -> k) is distinct from (v_old -> k);
      if cardinality(v_touched) = 0
         and (v_new -> 'updated_at') is distinct from (v_old -> 'updated_at') then
        v_touched := array['updated_at'];
      end if;
    end if;

    if tg_op <> 'UPDATE' or cardinality(v_touched) > 0 then
      insert into erp.legacy_write_canary_events (
        organization_id,
        group_code,
        table_name,
        operation,
        touched_columns,
        row_id,
        actor_user_id,
        actor_role
      ) values (
        v_org,
        v_single_group,
        v_table,
        tg_op,
        v_touched,
        v_row_id,
        auth.uid(),
        coalesce(nullif(auth.role(), ''), current_user)
      );
    end if;

    return coalesce(new, old);
  end if;

  -- Tablas mixtas: public.products y public.product_variants.
  -- Ruta caliente: una única consulta indexada por PK para las 3 claves.
  for v_rec in
    select g.group_code, g.legacy_write_mode
    from erp.storefront_cutover_groups g
    where g.organization_id = v_org
      and g.group_code in ('catalog', 'stock', 'prices_promos')
      and g.legacy_write_mode <> 'off'
  loop
    if v_rec.group_code = 'catalog' then
      v_catalog_mode := v_rec.legacy_write_mode;
    elsif v_rec.group_code = 'stock' then
      v_stock_mode := v_rec.legacy_write_mode;
    elsif v_rec.group_code = 'prices_promos' then
      v_prices_mode := v_rec.legacy_write_mode;
    end if;
  end loop;

  if v_catalog_mode = 'off' and v_stock_mode = 'off' and v_prices_mode = 'off' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_row_id := v_old ->> 'id';
    if v_catalog_mode = 'block' then
      raise exception 'Este dato se gestiona desde el ERP' using errcode = '42501';
    end if;
    if v_catalog_mode = 'observe' then
      insert into erp.legacy_write_canary_events (
        organization_id,
        group_code,
        table_name,
        operation,
        touched_columns,
        row_id,
        actor_user_id,
        actor_role
      ) values (
        v_org,
        'catalog',
        v_table,
        'DELETE',
        '{}',
        v_row_id,
        auth.uid(),
        coalesce(nullif(auth.role(), ''), current_user)
      );
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_row_id := v_new ->> 'id';
    for v_col in
      select k
      from jsonb_object_keys(v_new) k
      where (v_new -> k) is not null and (v_new -> k) <> 'null'::jsonb
      order by k
    loop
      if (tg_table_name = 'products' and v_col in ('price', 'original_price', 'price_usd', 'sale_expires_at'))
         or (tg_table_name = 'product_variants' and v_col = 'price') then
        v_price_cols := array_append(v_price_cols, v_col);
      elsif v_col = 'stock' then
        if coalesce((v_new ->> 'stock')::numeric, 0) <> 0 then
          v_stock_cols := array_append(v_stock_cols, v_col);
        end if;
      elsif v_col <> 'updated_at' then
        v_catalog_cols := array_append(v_catalog_cols, v_col);
      end if;
    end loop;
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row_id := coalesce(v_new ->> 'id', v_old ->> 'id');
    for v_col in
      select k
      from jsonb_object_keys(v_new) k
      where (v_new -> k) is distinct from (v_old -> k)
      order by k
    loop
      if (tg_table_name = 'products' and v_col in ('price', 'original_price', 'price_usd', 'sale_expires_at'))
         or (tg_table_name = 'product_variants' and v_col = 'price') then
        v_price_cols := array_append(v_price_cols, v_col);
      elsif v_col = 'stock' then
        v_stock_cols := array_append(v_stock_cols, v_col);
      elsif v_col <> 'updated_at' then
        v_catalog_cols := array_append(v_catalog_cols, v_col);
      end if;
    end loop;
  end if;

  if (cardinality(v_catalog_cols) > 0 and v_catalog_mode = 'block')
     or (cardinality(v_price_cols) > 0 and v_prices_mode = 'block')
     or (cardinality(v_stock_cols) > 0 and v_stock_mode = 'block') then
    raise exception 'Este dato se gestiona desde el ERP' using errcode = '42501';
  end if;

  v_actor_id := auth.uid();
  v_actor_role := coalesce(nullif(auth.role(), ''), current_user);

  if cardinality(v_catalog_cols) > 0 and v_catalog_mode = 'observe' then
    insert into erp.legacy_write_canary_events (
      organization_id, group_code, table_name, operation, touched_columns, row_id, actor_user_id, actor_role
    ) values (
      v_org, 'catalog', v_table, tg_op, v_catalog_cols, v_row_id, v_actor_id, v_actor_role
    );
  end if;

  if cardinality(v_price_cols) > 0 and v_prices_mode = 'observe' then
    insert into erp.legacy_write_canary_events (
      organization_id, group_code, table_name, operation, touched_columns, row_id, actor_user_id, actor_role
    ) values (
      v_org, 'prices_promos', v_table, tg_op, v_price_cols, v_row_id, v_actor_id, v_actor_role
    );
  end if;

  if cardinality(v_stock_cols) > 0 and v_stock_mode = 'observe' then
    insert into erp.legacy_write_canary_events (
      organization_id, group_code, table_name, operation, touched_columns, row_id, actor_user_id, actor_role
    ) values (
      v_org, 'stock', v_table, tg_op, v_stock_cols, v_row_id, v_actor_id, v_actor_role
    );
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function erp.legacy_write_canary() from public, anon, authenticated, service_role;

create or replace function erp.install_legacy_write_canaries()
returns void
language plpgsql
security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'public.products',
    'public.product_variants',
    'public.categories',
    'public.brands',
    'public.models',
    'public.repairs',
    'public.repair_logs',
    'public.inventory_movements'
  ] loop
    if to_regclass(v_table) is not null then
      execute format('drop trigger if exists a_00_erp_legacy_write_canary on %s', v_table);
      execute format(
        'create trigger a_00_erp_legacy_write_canary before insert or update or delete on %s for each row execute function erp.legacy_write_canary()',
        v_table
      );
    end if;
  end loop;
end;
$$;

revoke all on function erp.install_legacy_write_canaries() from public, anon, authenticated, service_role;

select erp.install_legacy_write_canaries();

create or replace function erp.install_storefront_sheet_trigger_on_activation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  extra_columns text;
begin
  perform erp.install_legacy_write_canaries();
  if to_regclass('public.products') is null then
    return new;
  end if;
  select coalesce(string_agg(format(',%I', attname), ''), '')
    into extra_columns
  from pg_attribute
  where attrelid = to_regclass('public.products')
    and attname in ('additional_images', 'tags', 'condition', 'capacity')
    and not attisdropped;
  execute 'drop trigger if exists a_storefront_catalog_sync on public.products';
  execute 'create trigger a_storefront_catalog_sync after insert or update of name,description,price,image_url,is_active,category_id,brand_id,model_id'
    || extra_columns || ' or delete on public.products for each row execute function erp.sync_storefront_product_to_erp()';
  return new;
end;
$$;

revoke all on function erp.install_storefront_sheet_trigger_on_activation() from public, anon, authenticated, service_role;
