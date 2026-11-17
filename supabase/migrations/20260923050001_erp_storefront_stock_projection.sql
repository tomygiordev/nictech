-- Opt-in stock projection after erp.import_storefront_catalog_opening() has
-- established shared product and variant UUIDs. No public tables are needed
-- during local reset; activation validates their presence at cutover.
create table erp.storefront_stock_projection (
  organization_id uuid primary key references erp.organizations(id) on delete restrict,
  enabled_at timestamptz not null default now()
);

alter table erp.storefront_stock_projection enable row level security;
revoke all on erp.storefront_stock_projection from public, anon, authenticated, service_role;

create index stock_balances_storefront_projection_idx
  on erp.stock_balances (organization_id, product_id, variant_id, location_id);

create or replace function erp.project_storefront_product_stock(
  p_organization_id uuid,
  p_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = erp, public, pg_catalog, pg_temp
as $$
declare
  projected_stock numeric;
  projected_variant record;
  previous_projection_setting text;
begin
  -- Shared UUIDs are the sole mapping. Unmapped storefront products remain
  -- untouched, including products from any other ERP organization.
  if not exists (
    select 1 from erp.products ep
    join public.products pp on pp.id = ep.id
    where ep.id = p_product_id and ep.organization_id = p_organization_id
  ) then
    return;
  end if;

  select greatest(coalesce(sum(b.quantity_on_hand - b.quantity_reserved), 0), 0)
    into projected_stock
  from erp.stock_balances b
  join erp.locations l
    on l.id = b.location_id and l.organization_id = b.organization_id
  where b.organization_id = p_organization_id
    and b.product_id = p_product_id
    and l.is_active and l.contributes_to_web_stock;

  if projected_stock <> trunc(projected_stock) or projected_stock > 2147483647 then
    raise exception using errcode = 'numeric_value_out_of_range',
      message = 'storefront product stock must fit an integer unit count';
  end if;

  if exists (select 1 from public.product_variants where product_id = p_product_id)
     and exists (
       select 1 from erp.stock_balances b
       join erp.locations l
         on l.id = b.location_id and l.organization_id = b.organization_id
       where b.organization_id = p_organization_id
         and b.product_id = p_product_id and b.variant_id is null
         and b.quantity_on_hand > b.quantity_reserved
         and l.is_active and l.contributes_to_web_stock
     ) then
    raise exception using errcode = 'check_violation',
      message = 'a storefront product with variants cannot have unvarianted web stock';
  end if;

  previous_projection_setting := current_setting('erp.projecting_storefront_stock', true);
  perform set_config('erp.projecting_storefront_stock', 'on', true);

  update public.products
     set stock = projected_stock::integer
   where id = p_product_id and stock is distinct from projected_stock::integer;

  for projected_variant in
    select pv.id,
      greatest(coalesce(sum(b.quantity_on_hand - b.quantity_reserved), 0), 0) as stock
    from public.product_variants pv
    join erp.product_variants ev
      on ev.id = pv.id and ev.product_id = p_product_id
        and ev.organization_id = p_organization_id
    left join erp.stock_balances b
      on b.organization_id = p_organization_id
        and b.product_id = p_product_id and b.variant_id = pv.id
        and exists (
          select 1 from erp.locations l
          where l.id = b.location_id and l.organization_id = b.organization_id
            and l.is_active and l.contributes_to_web_stock
        )
    where pv.product_id = p_product_id
    group by pv.id
  loop
    if projected_variant.stock <> trunc(projected_variant.stock)
       or projected_variant.stock > 2147483647 then
      raise exception using errcode = 'numeric_value_out_of_range',
        message = 'storefront variant stock must fit an integer unit count';
    end if;
    update public.product_variants
       set stock = projected_variant.stock::integer
     where id = projected_variant.id
       and stock is distinct from projected_variant.stock::integer;
  end loop;

  perform set_config('erp.projecting_storefront_stock', coalesce(previous_projection_setting, ''), true);
end;
$$;

create or replace function erp.project_storefront_stock_balance_change()
returns trigger
language plpgsql
security definer
set search_path = erp, public, pg_catalog, pg_temp
as $$
begin
  if current_setting('erp.applying_legacy_stock', true) = 'on' then
    return new;
  end if;
  if exists (
    select 1 from erp.storefront_stock_projection
    where organization_id = new.organization_id
  ) then
    perform erp.project_storefront_product_stock(new.organization_id, new.product_id);
  end if;
  if tg_op = 'UPDATE'
     and (old.organization_id, old.product_id) is distinct from (new.organization_id, new.product_id)
     and exists (
       select 1 from erp.storefront_stock_projection
       where organization_id = old.organization_id
     ) then
    perform erp.project_storefront_product_stock(old.organization_id, old.product_id);
  end if;
  return new;
end;
$$;

create trigger stock_balances_project_storefront
after insert or update of organization_id, location_id, product_id, variant_id,
  quantity_on_hand, quantity_reserved on erp.stock_balances
for each row execute function erp.project_storefront_stock_balance_change();

create or replace function erp.project_storefront_location_change()
returns trigger
language plpgsql
security definer
set search_path = erp, public, pg_catalog, pg_temp
as $$
declare
  affected_product record;
begin
  if (old.is_active, old.contributes_to_web_stock)
     is not distinct from (new.is_active, new.contributes_to_web_stock)
     or not exists (
       select 1 from erp.storefront_stock_projection
       where organization_id = new.organization_id
     ) then
    return new;
  end if;

  for affected_product in
    select distinct b.product_id
    from erp.stock_balances b
    where b.organization_id = new.organization_id and b.location_id = new.id
    order by b.product_id
  loop
    perform erp.project_storefront_product_stock(new.organization_id, affected_product.product_id);
  end loop;
  return new;
end;
$$;

create trigger locations_project_storefront
after update of is_active, contributes_to_web_stock on erp.locations
for each row execute function erp.project_storefront_location_change();

create or replace function erp.activate_storefront_stock_projection(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = erp, public, pg_catalog, pg_temp
as $$
declare
  mapped_product record;
  product_count integer := 0;
begin
  if to_regclass('public.products') is null
     or to_regclass('public.product_variants') is null then
    raise exception using errcode = 'undefined_table',
      message = 'storefront product tables are required before activation';
  end if;
  if not exists (select 1 from erp.organizations where id = p_organization_id) then
    raise exception using errcode = 'foreign_key_violation', message = 'ERP organization not found';
  end if;
  if not exists (
    select 1 from erp.configuration_values
    where organization_id = p_organization_id and branch_id is null
      and key = 'storefront.initial_catalog_import'
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'storefront catalog opening import must complete before stock projection';
  end if;
  if to_regclass('erp.storefront_stock_capture') is null or not exists (
    select 1 from erp.storefront_stock_capture
    where organization_id = p_organization_id
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'legacy stock capture must be active before stock projection';
  end if;

  -- Block stock writers and legacy storefront updates through activation.
  -- The first projection and enable flag commit as one transaction.
  lock table erp.stock_balances, erp.locations, public.products,
    public.product_variants in share row exclusive mode;

  if exists (
    select 1 from public.product_variants pv
    join erp.products ep on ep.id = pv.product_id
    where ep.organization_id = p_organization_id
      and not exists (
        select 1 from erp.product_variants ev
        where ev.id = pv.id and ev.product_id = ep.id
          and ev.organization_id = p_organization_id
      )
  ) then
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'storefront variants must be imported with matching ERP UUIDs';
  end if;

  insert into erp.storefront_stock_projection (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  for mapped_product in
    select ep.id from erp.products ep
    join public.products pp on pp.id = ep.id
    where ep.organization_id = p_organization_id
    order by ep.id
  loop
    perform erp.project_storefront_product_stock(p_organization_id, mapped_product.id);
    product_count := product_count + 1;
  end loop;
  return product_count;
end;
$$;

revoke all on function erp.project_storefront_product_stock(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function erp.project_storefront_stock_balance_change() from public, anon, authenticated, service_role;
revoke all on function erp.project_storefront_location_change() from public, anon, authenticated, service_role;
revoke all on function erp.activate_storefront_stock_projection(uuid)
  from public, anon, authenticated, service_role;
