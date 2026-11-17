-- Promotions never overwrite list prices. The storefront view evaluates time at read time.
create table if not exists erp.promotions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  name text not null check (btrim(name) <> ''),
  kind text not null check (kind in ('porcentaje', 'precio_fijo')),
  value numeric not null check (value <> 'NaN'::numeric and value > 0 and value = round(value, 2)),
  starts_at timestamptz not null,
  ends_at timestamptz,
  is_active boolean not null default true,
  channels text[] not null check (cardinality(channels) > 0 and channels <@ array['web','pos']::text[] and array_position(channels, null) is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  constraint promotions_org_id_unique unique (id, organization_id),
  constraint promotions_valid_dates check (ends_at is null or ends_at > starts_at),
  constraint promotions_percent_range check (kind <> 'porcentaje' or value < 100)
);

create table if not exists erp.promotion_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  promotion_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint promotion_targets_promotion_fk foreign key (promotion_id, organization_id) references erp.promotions(id, organization_id),
  constraint promotion_targets_product_fk foreign key (product_id, organization_id) references erp.products(id, organization_id),
  constraint promotion_targets_variant_fk foreign key (variant_id, product_id, organization_id) references erp.product_variants(id, product_id, organization_id)
);
create unique index if not exists promotion_targets_unique on erp.promotion_targets
  (promotion_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists promotion_targets_lookup on erp.promotion_targets (organization_id, product_id, variant_id) where is_active;

create or replace function erp.can_manage_promotions(p_org uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, erp, pg_temp as $$
  select auth.uid() is not null
    and p_org is not null
    and p_org = erp.current_organization_id()
    and erp.has_permission('pricing.manage');
$$;
revoke all on function erp.can_manage_promotions(uuid) from public, anon;
grant execute on function erp.can_manage_promotions(uuid) to authenticated;

alter table erp.promotions enable row level security;
alter table erp.promotion_targets enable row level security;
drop policy if exists promotions_admin_read on erp.promotions;
drop policy if exists promotions_read on erp.promotions;
create policy promotions_read on erp.promotions for select to authenticated
  using (
    organization_id = erp.current_organization_id()
    and (erp.has_permission('pricing.view') or erp.has_permission('pricing.manage'))
  );
drop policy if exists promotion_targets_admin_read on erp.promotion_targets;
drop policy if exists promotion_targets_read on erp.promotion_targets;
create policy promotion_targets_read on erp.promotion_targets for select to authenticated
  using (
    organization_id = erp.current_organization_id()
    and (erp.has_permission('pricing.view') or erp.has_permission('pricing.manage'))
  );
revoke all on erp.promotions, erp.promotion_targets from public, anon, authenticated;
grant select on erp.promotions, erp.promotion_targets to authenticated;

create or replace function erp.upsert_promotion(
  p_id uuid, p_name text, p_kind text, p_value numeric, p_starts_at timestamptz,
  p_ends_at timestamptz, p_is_active boolean, p_channels text[], p_targets jsonb
) returns uuid language plpgsql security definer set search_path = pg_catalog, erp, pg_temp as $$
declare
  v_org uuid := erp.current_organization_id();
  v_id uuid;
  v_target jsonb;
  v_product uuid;
  v_variant uuid;
begin
  if not coalesce(erp.can_manage_promotions(v_org), false) then
    raise exception 'Se requiere el permiso pricing.manage para administrar promociones' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' or p_kind is null or p_kind not in ('porcentaje','precio_fijo')
    or p_value is null or p_value = 'NaN'::numeric or p_value <= 0 or p_value <> round(p_value,2)
    or (p_kind = 'porcentaje' and p_value >= 100) or p_starts_at is null
    or (p_ends_at is not null and p_ends_at <= p_starts_at) or p_is_active is null
    or p_channels is null or cardinality(p_channels) = 0 or not (p_channels <@ array['web','pos']::text[])
    or array_position(p_channels, null) is not null or p_targets is null
    or jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then
    raise exception 'Datos de promoción inválidos' using errcode = '22023';
  end if;
  if p_id is null then
    insert into erp.promotions (organization_id,name,kind,value,starts_at,ends_at,is_active,channels,created_by,updated_by)
    values (v_org,btrim(p_name),p_kind,p_value,p_starts_at,p_ends_at,p_is_active,p_channels,auth.uid(),auth.uid()) returning id into v_id;
  else
    update erp.promotions set name=btrim(p_name),kind=p_kind,value=p_value,starts_at=p_starts_at,
      ends_at=p_ends_at,is_active=p_is_active,channels=p_channels,updated_at=now(),updated_by=auth.uid()
    where id=p_id and organization_id=v_org returning id into v_id;
    if v_id is null then raise exception 'Promoción inexistente' using errcode = '22023'; end if;
  end if;
  update erp.promotion_targets set is_active=false where organization_id=v_org and promotion_id=v_id and is_active;
  for v_target in select value from jsonb_array_elements(p_targets) loop
    if jsonb_typeof(v_target) <> 'object' then raise exception 'Destino inválido' using errcode='22023'; end if;
    begin
      v_product := (v_target->>'product_id')::uuid;
      v_variant := nullif(v_target->>'variant_id','')::uuid;
    exception when invalid_text_representation then raise exception 'Destino inválido' using errcode='22023'; end;
    if v_product is null or not exists (select 1 from erp.products where id=v_product and organization_id=v_org)
      or (v_variant is not null and not exists (select 1 from erp.product_variants where id=v_variant and product_id=v_product and organization_id=v_org)) then
      raise exception 'Producto o variante inválidos' using errcode='22023';
    end if;
    insert into erp.promotion_targets (organization_id,promotion_id,product_id,variant_id)
    values (v_org,v_id,v_product,v_variant)
    on conflict (promotion_id,product_id,(coalesce(variant_id,'00000000-0000-0000-0000-000000000000'::uuid)))
    do update set is_active=true;
  end loop;
  return v_id;
end $$;
revoke all on function erp.upsert_promotion(uuid,text,text,numeric,timestamptz,timestamptz,boolean,text[],jsonb) from public, anon;
grant execute on function erp.upsert_promotion(uuid,text,text,numeric,timestamptz,timestamptz,boolean,text[],jsonb) to authenticated;

create or replace function erp.set_promotion_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path=pg_catalog,erp,pg_temp as $$
declare v_org uuid := erp.current_organization_id();
begin
  if not coalesce(erp.can_manage_promotions(v_org), false) then raise exception 'Se requiere el permiso pricing.manage para administrar promociones' using errcode='42501'; end if;
  if p_active is null then raise exception 'Estado inválido' using errcode='22023'; end if;
  update erp.promotions set is_active=p_active,updated_at=now(),updated_by=auth.uid() where id=p_id and organization_id=v_org;
  if not found then raise exception 'Promoción inexistente' using errcode='22023'; end if;
end $$;
revoke all on function erp.set_promotion_active(uuid,boolean) from public,anon;
grant execute on function erp.set_promotion_active(uuid,boolean) to authenticated;

create or replace function erp.resolve_catalog_price_for_channel(p_org uuid,p_product uuid,p_variant uuid,p_at timestamptz,p_channel text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,erp,pg_temp as $$
declare
  v_product erp.products%rowtype;
  v_variant erp.product_variants%rowtype;
  v_list numeric(18,4);
  v_price numeric;
  v_promo uuid;
  v_promo_ends_at timestamptz;
  v_source text := 'parent_base';
  v_override boolean := false;
begin
  if p_channel not in ('web','pos') or p_at is null then raise exception 'Canal o fecha inválidos' using errcode='22023'; end if;
  select * into v_product from erp.products where id=p_product and organization_id=p_org;
  if not found then raise exception 'product not found in current organization' using errcode='P0002'; end if;
  v_list := coalesce(v_product.base_sale_price,0);
  if p_variant is not null then
    select * into v_variant from erp.product_variants where id=p_variant and product_id=p_product and organization_id=p_org;
    if not found then raise exception 'variant not found for product in current organization' using errcode='P0002'; end if;
    if v_variant.final_price_ars is not null then
      v_list := v_variant.final_price_ars; v_source := 'variant_override'; v_override := true;
    else v_source := 'parent_inherited'; end if;
  end if;
  if v_list < 0 or v_list = 'NaN'::numeric then raise exception 'product price cannot be negative' using errcode='23514'; end if;
  select x.price,x.id,x.ends_at into v_price,v_promo,v_promo_ends_at from (
    select p.id, p.ends_at, greatest(0,round(case when p.kind='porcentaje' then v_list*(100-p.value)/100 else p.value end,2)) price
    from erp.promotions p join erp.promotion_targets t on t.promotion_id=p.id and t.organization_id=p.organization_id
    where p.organization_id=p_org and p.is_active and t.is_active and t.product_id=p_product
      and (t.variant_id is null or t.variant_id=p_variant) and p_channel=any(p.channels)
      and p.starts_at <= p_at and (p.ends_at is null or p_at < p.ends_at)
  ) x where x.price < v_list order by x.price,x.id limit 1;
  return jsonb_build_object('product_id',p_product,'variant_id',p_variant,'currency_code','ARS',
    'final_price_ars',coalesce(v_price,v_list),'list_price_ars',v_list,'promotion_id',v_promo,
    'promotion_ends_at',v_promo_ends_at,'tax_rate_percent',v_product.tax_rate_percent,
    'price_source',v_source,'is_override',v_override);
end $$;
revoke all on function erp.resolve_catalog_price_for_channel(uuid,uuid,uuid,timestamptz,text) from public,anon,authenticated,service_role;

create or replace function erp.resolve_catalog_effective_price_internal(p_organization_id uuid,p_product_id uuid,p_variant_id uuid default null,p_at timestamptz default now())
returns jsonb language sql stable security definer set search_path=pg_catalog,erp,pg_temp as $$
  select erp.resolve_catalog_price_for_channel(p_organization_id,p_product_id,p_variant_id,p_at,
    case when auth.role()='service_role' then 'web' else 'pos' end);
$$;
revoke all on function erp.resolve_catalog_effective_price_internal(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function erp.resolve_catalog_effective_price_internal(uuid,uuid,uuid,timestamptz) to service_role;

-- The legacy variant price remains the list price, not a frozen time-sensitive promotion.
create or replace function erp.project_storefront_variant_prices(p_org uuid,p_product uuid)
returns void language plpgsql security definer set search_path=pg_catalog,erp,public,pg_temp as $$
begin
  if to_regclass('public.product_variants') is null or not exists
    (select 1 from pg_attribute where attrelid=to_regclass('public.product_variants') and attname='price' and not attisdropped)
    or not exists (select 1 from erp.storefront_catalog_sync where organization_id=p_org) then return; end if;
  update public.product_variants w set price=resolved.price
  from (select v.id,v.product_id,round(coalesce(v.final_price_ars,p.base_sale_price,0),2)::numeric(12,2) as price
    from erp.product_variants v join erp.products p on p.id=v.product_id and p.organization_id=v.organization_id
    where v.organization_id=p_org and v.product_id=p_product) resolved
  where w.id=resolved.id and w.product_id=resolved.product_id and w.price is distinct from resolved.price;
end $$;
revoke all on function erp.project_storefront_variant_prices(uuid,uuid) from public,anon,authenticated,service_role;

-- Public security-definer wrapper for storefront queries so anon never calls erp.* directly.
create or replace function public.storefront_web_price(
  p_product_id uuid,
  p_variant_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, erp, pg_temp
as $$
declare
  v_org uuid;
begin
  if p_product_id is null then
    return null;
  end if;

  select p.organization_id
    into v_org
  from erp.products p
  join erp.storefront_catalog_sync s on s.organization_id = p.organization_id
  where p.id = p_product_id
    and p.is_active
    and p.can_sell
    and p.publish_on_web
    and p.allow_online_sale
    and p.web_status = 'published';

  if v_org is null then
    return null;
  end if;

  if p_variant_id is not null and not exists (
    select 1
    from erp.product_variants v
    where v.id = p_variant_id
      and v.product_id = p_product_id
      and v.organization_id = v_org
      and v.is_active
  ) then
    return null;
  end if;

  return erp.resolve_catalog_price_for_channel(v_org, p_product_id, p_variant_id, now(), 'web');
end $$;
revoke all on function public.storefront_web_price(uuid, uuid) from public;
grant execute on function public.storefront_web_price(uuid, uuid) to anon, authenticated, service_role;

-- Only publication-ready products and active variants are exposed, and the view
-- evaluates the web channel at read time so scheduled boundaries need no job.
create or replace view public.storefront_promotion_prices with (security_barrier=true) as
select p.id product_id, null::uuid variant_id,
  (x.price->>'list_price_ars')::numeric list_price,
  (x.price->>'final_price_ars')::numeric effective_price,
  (x.price->>'promotion_id')::uuid promotion_id,
  (x.price->>'promotion_ends_at')::timestamptz promotion_ends_at
from erp.products p join erp.storefront_catalog_sync s on s.organization_id=p.organization_id
cross join lateral (select public.storefront_web_price(p.id, null) price) x
where p.is_active and p.can_sell and p.publish_on_web and p.allow_online_sale and p.web_status='published'
union all
select p.id, v.id,
  (x.price->>'list_price_ars')::numeric,
  (x.price->>'final_price_ars')::numeric,
  (x.price->>'promotion_id')::uuid,
  (x.price->>'promotion_ends_at')::timestamptz
from erp.products p join erp.storefront_catalog_sync s on s.organization_id=p.organization_id
join erp.product_variants v on v.product_id=p.id and v.organization_id=p.organization_id and v.is_active
cross join lateral (select public.storefront_web_price(p.id, v.id) price) x
where p.is_active and p.can_sell and p.publish_on_web and p.allow_online_sale and p.web_status='published';
revoke all on public.storefront_promotion_prices from public,anon,authenticated;
grant select on public.storefront_promotion_prices to anon,authenticated,service_role;
