-- Catalog bridge is installed inert and enabled only by the owner-operated
-- activate_storefront_bridge command after the opening import.
create table erp.storefront_catalog_sync (
  organization_id uuid primary key references erp.organizations(id) on delete restrict,
  enabled_at timestamptz not null default now()
);
alter table erp.storefront_catalog_sync enable row level security;
revoke all on erp.storefront_catalog_sync from public, anon, authenticated, service_role;

-- Old installations have no publication flag. Adding it with a true default
-- leaves their catalog visible until the explicit cutover command runs.
do $$
begin
  if to_regclass('public.products') is not null then
    execute 'alter table public.products add column if not exists is_active boolean not null default true';
  end if;
  if to_regclass('public.product_variants') is not null then
    execute 'alter table public.product_variants add column if not exists is_active boolean not null default true';
  end if;
end;
$$;

create or replace function erp.storefront_catalog_write_allowed(p_organization_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, erp, pg_temp
as $$
  select session_user = 'postgres'
    or (current_setting('request.jwt.claim.role', true) = 'service_role')
    or (auth.uid() is not null
      and erp.current_organization_id() = p_organization_id
      and erp.has_permission('catalog.manage'));
$$;
revoke all on function erp.storefront_catalog_write_allowed(uuid)
  from public, anon, authenticated, service_role;

create or replace function erp.sync_storefront_product_to_erp()
returns trigger language plpgsql security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  target_org constant uuid := '10000000-0000-0000-0000-000000000001';
  existing erp.products%rowtype;
  resolved_category uuid;
  resolved_brand uuid;
  resolved_model uuid;
begin
  if not exists (select 1 from erp.storefront_catalog_sync where organization_id = target_org) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    select * into existing from erp.products where id = old.id and organization_id = target_org;
    if not found then return old; end if;
    if not erp.storefront_catalog_write_allowed(target_org) then
      raise exception using errcode = 'insufficient_privilege', message = 'catalog.manage is required for storefront catalog changes';
    end if;
    update erp.products set is_active = false, publish_on_web = false, allow_online_sale = false
      where id = old.id and organization_id = target_org;
    return old;
  end if;

  select * into existing from erp.products where id = new.id;
  if found and existing.organization_id <> target_org then
    raise exception using errcode = 'unique_violation', message = 'storefront UUID belongs to another ERP organization';
  end if;
  resolved_category := nullif(to_jsonb(new)->>'category_id', '')::uuid;
  resolved_model := nullif(to_jsonb(new)->>'model_id', '')::uuid;
  resolved_brand := coalesce(
    nullif(to_jsonb(new)->>'brand_id', '')::uuid,
    (select brand_id from erp.product_models
      where id = resolved_model and organization_id = target_org)
  );

  -- The reciprocal ERP trigger already wrote this row. Returning before the
  -- permission check also lets ERP-authorized writes project to public.
  if found and coalesce(nullif(existing.public_name, ''), existing.internal_name) = new.name
    and existing.public_description is not distinct from new.description
    and existing.base_sale_price = new.price
    and existing.web_image_path is not distinct from new.image_url
    and existing.category_id is not distinct from resolved_category
    and existing.brand_id is not distinct from resolved_brand
    and existing.model_id is not distinct from resolved_model
    and (existing.is_active and existing.publish_on_web
      and existing.allow_online_sale and existing.can_sell) = new.is_active then
    return new;
  end if;

  if not erp.storefront_catalog_write_allowed(target_org) then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog.manage is required for storefront catalog changes';
  end if;
  if nullif(btrim(new.name), '') is null or new.price is null
    or new.price < 0 or new.price > 99999999999999.9999 or new.price = 'NaN'::numeric then
    raise exception using errcode = 'check_violation', message = 'invalid storefront product name or price';
  end if;

  if found then
    update erp.products set internal_name = new.name, public_name = new.name,
      public_description = new.description, base_sale_price = new.price,
      web_image_path = new.image_url, category_id = resolved_category,
      brand_id = resolved_brand, model_id = resolved_model,
      is_active = new.is_active,
      publish_on_web = new.is_active, allow_online_sale = new.is_active
    where id = new.id and organization_id = target_org;
  else
    insert into erp.products (
      id, organization_id, product_type_id, item_kind,
      category_id, brand_id, model_id, unit_id,
      internal_code, internal_name, public_name, public_description,
      inventory_tracking, base_sale_price, can_sell, publish_on_web,
      allow_online_sale, web_image_path, is_active, created_at
    ) values (
      new.id, target_org, '60000000-0000-0000-0000-000000000001', 'product',
      resolved_category, resolved_brand, resolved_model,
      '50000000-0000-0000-0000-000000000001',
      'WEB-' || replace(new.id::text, '-', ''), new.name, new.name,
      new.description, 'quantity', new.price, true, new.is_active,
      new.is_active, new.image_url, new.is_active, coalesce(new.created_at, now())
    );
  end if;
  return new;
end;
$$;

create or replace function erp.sync_storefront_variant_to_erp()
returns trigger language plpgsql security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  target_org constant uuid := '10000000-0000-0000-0000-000000000001';
  existing erp.product_variants%rowtype;
begin
  if not exists (select 1 from erp.storefront_catalog_sync where organization_id = target_org) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    select * into existing from erp.product_variants where id = old.id and organization_id = target_org;
    if not found then return old; end if;
    if not erp.storefront_catalog_write_allowed(target_org) then
      raise exception using errcode = 'insufficient_privilege', message = 'catalog.manage is required for storefront catalog changes';
    end if;
    update erp.product_variants set is_active = false
      where id = old.id and organization_id = target_org;
    return old;
  end if;

  if new.product_id is null or nullif(btrim(new.color), '') is null then
    raise exception using errcode = 'check_violation', message = 'storefront variant needs a product and color';
  end if;
  select * into existing from erp.product_variants where id = new.id;
  if found and (existing.organization_id <> target_org or existing.product_id <> new.product_id) then
    raise exception using errcode = 'integrity_constraint_violation', message = 'variant UUID cannot be reassigned';
  end if;
  if found and coalesce(nullif(existing.attributes->>'color', ''), existing.name) = new.color
    and existing.image_path is not distinct from new.image_url
    and existing.is_active = new.is_active then
    return new;
  end if;

  if not erp.storefront_catalog_write_allowed(target_org) then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog.manage is required for storefront catalog changes';
  end if;
  if not exists (select 1 from erp.products where id = new.product_id and organization_id = target_org) then
    raise exception using errcode = 'foreign_key_violation', message = 'storefront variant requires a mapped ERP product';
  end if;
  if found then
    update erp.product_variants set name = new.color,
      attributes = jsonb_set(attributes, '{color}', to_jsonb(new.color), true),
      image_path = new.image_url, is_active = new.is_active
    where id = new.id and organization_id = target_org;
  else
    insert into erp.product_variants (
      id, organization_id, product_id, code, name, attributes,
      image_path, is_active, created_at
    ) values (
      new.id, target_org, new.product_id,
      'WEB-' || replace(new.id::text, '-', ''), new.color,
      jsonb_build_object('color', new.color), new.image_url,
      new.is_active, new.created_at
    );
  end if;
  return new;
end;
$$;

create or replace function erp.sync_erp_product_to_storefront()
returns trigger language plpgsql security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  visible boolean;
begin
  if new.organization_id <> '10000000-0000-0000-0000-000000000001'::uuid
    or not exists (select 1 from erp.storefront_catalog_sync where organization_id = new.organization_id)
    or new.item_kind <> 'product' then
    return new;
  end if;
  visible := new.is_active and new.publish_on_web and new.allow_online_sale and new.can_sell;
  if exists (select 1 from public.products where id = new.id) then
    update public.products set name = coalesce(nullif(new.public_name, ''), new.internal_name),
      description = new.public_description, price = new.base_sale_price,
      image_url = new.web_image_path, is_active = visible,
      category_id = new.category_id, brand_id = new.brand_id, model_id = new.model_id
    where id = new.id and (
      name, description, price, image_url, is_active,
      category_id, brand_id, model_id
    ) is distinct from (
      coalesce(nullif(new.public_name, ''), new.internal_name),
      new.public_description, new.base_sale_price, new.web_image_path, visible,
      new.category_id, new.brand_id, new.model_id
    );
  elsif visible then
    insert into public.products (
      id, name, description, price, image_url, stock, is_active,
      category_id, brand_id, model_id
    )
    values (new.id, coalesce(nullif(new.public_name, ''), new.internal_name),
      new.public_description, new.base_sale_price, new.web_image_path, 0, true,
      new.category_id, new.brand_id, new.model_id);
    perform erp.project_storefront_product_stock(new.organization_id, new.id);
  end if;
  return new;
end;
$$;

create or replace function erp.sync_erp_variant_to_storefront()
returns trigger language plpgsql security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  color_name text;
begin
  if new.organization_id <> '10000000-0000-0000-0000-000000000001'::uuid
    or not exists (select 1 from erp.storefront_catalog_sync where organization_id = new.organization_id) then
    return new;
  end if;
  color_name := coalesce(nullif(new.attributes->>'color', ''), new.name);
  if exists (select 1 from public.product_variants where id = new.id) then
    update public.product_variants set color = color_name,
      image_url = new.image_path, is_active = new.is_active
    where id = new.id and (color, image_url, is_active)
      is distinct from (color_name, new.image_path, new.is_active);
  elsif exists (select 1 from public.products where id = new.product_id) then
    insert into public.product_variants (id, product_id, color, image_url, stock, is_active)
    values (new.id, new.product_id, color_name, new.image_path, 0, new.is_active);
    perform erp.project_storefront_product_stock(new.organization_id, new.product_id);
  end if;
  return new;
end;
$$;

create trigger a_erp_product_storefront_catalog
after insert or update of internal_name, public_name, public_description,
  base_sale_price, web_image_path, is_active, publish_on_web, allow_online_sale,
  can_sell, category_id, brand_id, model_id
on erp.products for each row execute function erp.sync_erp_product_to_storefront();
create trigger a_erp_variant_storefront_catalog
after insert or update of name, attributes, image_path, is_active
on erp.product_variants for each row execute function erp.sync_erp_variant_to_storefront();

create or replace function erp.activate_storefront_bridge(p_organization_id uuid)
returns integer language plpgsql security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  projected_count integer;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = 'insufficient_privilege', message = 'storefront bridge activation requires database owner';
  end if;
  if p_organization_id <> '10000000-0000-0000-0000-000000000001'::uuid then
    raise exception using errcode = 'check_violation', message = 'unsupported storefront organization';
  end if;
  if to_regclass('public.products') is null or to_regclass('public.product_variants') is null then
    raise exception using errcode = 'undefined_table', message = 'storefront catalog tables are required';
  end if;
  if not exists (select 1 from erp.configuration_values
    where organization_id = p_organization_id and branch_id is null
      and key = 'storefront.initial_catalog_import') then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'storefront catalog opening import must complete before bridge activation';
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'is_active')
    or not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'product_variants' and column_name = 'is_active') then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'storefront catalog activation columns are missing';
  end if;

  lock table erp.products, erp.product_variants, erp.stock_balances,
    public.products, public.product_variants, public.categories,
    public.brands, public.models in share row exclusive mode;
  if exists (select 1 from public.products p
    left join erp.products e on e.id = p.id and e.organization_id = p_organization_id
    where e.id is null)
    or exists (select 1 from public.product_variants v
      left join erp.product_variants e on e.id = v.id and e.product_id = v.product_id
        and e.organization_id = p_organization_id
      where e.id is null) then
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'all storefront product and variant UUIDs must be imported before activation';
  end if;

  -- Triggers are installed only at activation. Local ERP-only resets have no
  -- public catalog; production migration remains inert until this command.
  if not exists (select 1 from pg_trigger where tgrelid = 'public.products'::regclass
    and tgname = 'a_storefront_catalog_sync') then
    execute 'create trigger a_storefront_catalog_sync after insert or update of name, description, price, image_url, is_active, category_id, brand_id, model_id or delete on public.products for each row execute function erp.sync_storefront_product_to_erp()';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.product_variants'::regclass
    and tgname = 'a_storefront_catalog_sync') then
    execute 'create trigger a_storefront_catalog_sync after insert or update of color, image_url, is_active or delete on public.product_variants for each row execute function erp.sync_storefront_variant_to_erp()';
  end if;

  insert into erp.storefront_catalog_sync (organization_id) values (p_organization_id)
    on conflict (organization_id) do nothing;
  perform erp.enable_storefront_reference_sync(p_organization_id);
  -- The public catalog can have changed since the opening snapshot. Reconcile
  -- its descriptive fields while both sides are locked and before stock takes
  -- authority from ERP. Stock itself is checked by the capture activation.
  update public.products set name = name;
  update public.product_variants set color = color;
  perform erp.activate_storefront_stock_capture(p_organization_id);
  projected_count := erp.activate_storefront_stock_projection(p_organization_id);
  return projected_count;
end;
$$;

revoke all on function erp.sync_storefront_product_to_erp() from public, anon, authenticated, service_role;
revoke all on function erp.sync_storefront_variant_to_erp() from public, anon, authenticated, service_role;
revoke all on function erp.sync_erp_product_to_storefront() from public, anon, authenticated, service_role;
revoke all on function erp.sync_erp_variant_to_storefront() from public, anon, authenticated, service_role;
revoke all on function erp.activate_storefront_bridge(uuid) from public, anon, authenticated, service_role;
comment on function erp.activate_storefront_bridge(uuid) is
  'Owner-only explicit catalog and stock cutover after import; enabling both directions is atomic.';
