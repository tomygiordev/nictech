-- Keep the shared category, brand and model UUIDs usable from both admin UIs.
-- Triggers on the legacy tables are installed by the bridge activation only.
create or replace function erp.sync_storefront_reference_to_erp()
returns trigger language plpgsql security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  target_org constant uuid := '10000000-0000-0000-0000-000000000001';
begin
  if not exists (select 1 from erp.storefront_catalog_sync where organization_id = target_org) then
    return coalesce(new, old);
  end if;
  if not erp.storefront_catalog_write_allowed(target_org) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'catalog.manage is required for storefront reference changes';
  end if;
  if tg_op = 'DELETE' then
    if tg_table_name = 'categories' then
      update erp.product_categories set is_active = false
        where id = old.id and organization_id = target_org;
    elsif tg_table_name = 'brands' then
      update erp.brands set is_active = false
        where id = old.id and organization_id = target_org;
    else
      update erp.product_models set is_active = false
        where id = old.id and organization_id = target_org;
    end if;
    return old;
  end if;
  if nullif(btrim(new.name), '') is null then
    raise exception using errcode = 'check_violation', message = 'reference name is required';
  end if;
  if (tg_table_name = 'categories' and exists (
    select 1 from erp.product_categories where id = new.id and organization_id <> target_org
  )) or (tg_table_name = 'brands' and exists (
    select 1 from erp.brands where id = new.id and organization_id <> target_org
  )) or (tg_table_name = 'models' and exists (
    select 1 from erp.product_models where id = new.id and organization_id <> target_org
  )) then
    raise exception using errcode = 'unique_violation',
      message = 'storefront reference UUID belongs to another ERP organization';
  end if;
  if tg_table_name = 'categories' then
    insert into erp.product_categories (id, organization_id, code, name, created_at)
    values (new.id, target_org, 'WEB-' || replace(new.id::text, '-', ''),
      new.name, coalesce(new.created_at, now()))
    on conflict (id) do update set name = excluded.name, is_active = true
      where erp.product_categories.organization_id = target_org
        and (erp.product_categories.name is distinct from excluded.name
          or not erp.product_categories.is_active);
  elsif tg_table_name = 'brands' then
    insert into erp.brands (id, organization_id, code, name, created_at)
    values (new.id, target_org, 'WEB-' || replace(new.id::text, '-', ''),
      new.name, new.created_at)
    on conflict (id) do update set name = excluded.name, is_active = true
      where erp.brands.organization_id = target_org
        and (erp.brands.name is distinct from excluded.name or not erp.brands.is_active);
  else
    if new.brand_id is null then
      raise exception using errcode = 'check_violation',
        message = 'storefront model requires a brand for ERP';
    end if;
    insert into erp.product_models (id, organization_id, brand_id, code, name, created_at)
    values (new.id, target_org, new.brand_id,
      'WEB-' || replace(new.id::text, '-', ''), new.name, new.created_at)
    on conflict (id) do update set name = excluded.name,
      brand_id = excluded.brand_id, is_active = true
      where erp.product_models.organization_id = target_org
        and (erp.product_models.name is distinct from excluded.name
          or erp.product_models.brand_id is distinct from excluded.brand_id
          or not erp.product_models.is_active);
  end if;
  return new;
end;
$$;

create or replace function erp.sync_erp_reference_to_storefront()
returns trigger language plpgsql security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
begin
  if new.organization_id <> '10000000-0000-0000-0000-000000000001'::uuid
    or not exists (select 1 from erp.storefront_catalog_sync
      where organization_id = new.organization_id) then
    return new;
  end if;
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
  return new;
end;
$$;

create trigger erp_categories_project_storefront
after insert or update of name on erp.product_categories
for each row execute function erp.sync_erp_reference_to_storefront();
create trigger erp_brands_project_storefront
after insert or update of name on erp.brands
for each row execute function erp.sync_erp_reference_to_storefront();
create trigger erp_models_project_storefront
after insert or update of name, brand_id on erp.product_models
for each row execute function erp.sync_erp_reference_to_storefront();

create or replace function erp.enable_storefront_reference_sync(p_organization_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
begin
  if current_user <> 'postgres'
    or p_organization_id <> '10000000-0000-0000-0000-000000000001'::uuid then
    raise exception using errcode = 'insufficient_privilege',
      message = 'storefront reference activation requires the database owner';
  end if;
  if to_regclass('public.categories') is null
    or to_regclass('public.brands') is null
    or to_regclass('public.models') is null then
    raise exception using errcode = 'undefined_table',
      message = 'storefront reference tables are required';
  end if;
  if not exists (select 1 from pg_trigger
    where tgrelid = 'public.categories'::regclass
      and tgname = 'a_storefront_reference_sync') then
    execute 'create trigger a_storefront_reference_sync after insert or update of name or delete on public.categories for each row execute function erp.sync_storefront_reference_to_erp()';
  end if;
  if not exists (select 1 from pg_trigger
    where tgrelid = 'public.brands'::regclass
      and tgname = 'a_storefront_reference_sync') then
    execute 'create trigger a_storefront_reference_sync after insert or update of name or delete on public.brands for each row execute function erp.sync_storefront_reference_to_erp()';
  end if;
  if not exists (select 1 from pg_trigger
    where tgrelid = 'public.models'::regclass
      and tgname = 'a_storefront_reference_sync') then
    execute 'create trigger a_storefront_reference_sync after insert or update of name, brand_id or delete on public.models for each row execute function erp.sync_storefront_reference_to_erp()';
  end if;
  update public.categories set name = name;
  update public.brands set name = name;
  update public.models set name = name;
end;
$$;

revoke all on function erp.sync_storefront_reference_to_erp()
  from public, anon, authenticated, service_role;
revoke all on function erp.sync_erp_reference_to_storefront()
  from public, anon, authenticated, service_role;
revoke all on function erp.enable_storefront_reference_sync(uuid)
  from public, anon, authenticated, service_role;
