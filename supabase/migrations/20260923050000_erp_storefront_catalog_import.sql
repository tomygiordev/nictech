-- One-time, operator-invoked import of the existing storefront catalog and stock.
-- This migration deliberately does not invoke the command: a cutover or ongoing
-- synchronization must be in place before public and ERP stock can share authority.
create or replace function erp.import_storefront_catalog_opening()
returns jsonb
language plpgsql
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  target_org constant uuid := '10000000-0000-0000-0000-000000000001';
  target_branch constant uuid := '20000000-0000-0000-0000-000000000001';
  target_location constant uuid := '30000000-0000-0000-0000-000000000001';
  target_type constant uuid := '60000000-0000-0000-0000-000000000001';
  target_unit constant uuid := '50000000-0000-0000-0000-000000000001';
  result jsonb;
  product_count integer;
  variant_count integer;
  opening_count integer;
  stock_total numeric;
  batch_number integer;
  opening_document_id uuid;
  opening_line record;
begin
  -- Migration owner only. This function has no PUBLIC, authenticated or service grant.
  if current_user <> 'postgres' then
    raise exception using errcode = 'insufficient_privilege',
      message = 'storefront catalog import requires the database owner';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nictech:storefront-catalog-opening', 0));

  select value into result
  from erp.configuration_values
  where organization_id = target_org and branch_id is null
    and key = 'storefront.initial_catalog_import';
  if found then
    return result;
  end if;

  if to_regclass('public.products') is null or to_regclass('public.product_variants') is null then
    raise exception using errcode = 'undefined_table',
      message = 'storefront products and product_variants tables are required';
  end if;

  -- Hold the source still until the opening ledger and marker commit together.
  execute 'lock table public.products, public.product_variants in share mode';

  if not exists (select 1 from erp.organizations where id = target_org and is_active)
    or not exists (select 1 from erp.branches where id = target_branch and organization_id = target_org and is_active)
    or not exists (select 1 from erp.locations where id = target_location and organization_id = target_org
      and branch_id = target_branch and is_active and allows_sale and contributes_to_web_stock)
    or not exists (select 1 from erp.product_types where id = target_type and organization_id = target_org
      and item_kind = 'product' and default_tracking_mode = 'quantity' and is_active)
    or not exists (select 1 from erp.units_of_measure where id = target_unit and organization_id = target_org
      and not allows_decimals and is_active) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'NicTech ERP organization, branch, location, product type or unit is not ready';
  end if;

  select count(*) into product_count from public.products;
  select count(*) into variant_count from public.product_variants;
  if product_count = 0 then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'the storefront catalog is empty';
  end if;

  if exists (
    select 1 from public.products p
    where nullif(btrim(p.name), '') is null
      or p.price is null or p.price < 0 or p.price > 99999999999999.9999
      or p.price = 'NaN'::numeric
      or p.stock is null or p.stock < 0 or p.stock <> trunc(p.stock)
      or (coalesce((to_jsonb(p)->>'is_active')::boolean, true) = false and p.stock > 0)
  ) or exists (
    select 1 from public.product_variants v
    left join public.products p on p.id = v.product_id
    where p.id is null or nullif(btrim(v.color), '') is null
      or v.stock is null or v.stock < 0 or v.stock <> trunc(v.stock)
      or (coalesce((to_jsonb(v)->>'is_active')::boolean, true) = false and v.stock > 0)
  ) then
    raise exception using errcode = 'check_violation',
      message = 'storefront catalog has missing parents, names, valid prices or nonnegative whole-unit stock';
  end if;

  if exists (
    select 1 from public.products p
    join public.product_variants v on v.product_id = p.id
    group by p.id, p.stock
    having p.stock <> sum(v.stock)
  ) then
    raise exception using errcode = 'check_violation',
      message = 'storefront parent stock differs from its variant stock';
  end if;

  -- Never take over an ERP item or ledger entry already using a storefront UUID.
  if exists (select 1 from erp.products e join public.products p on p.id = e.id)
    or exists (select 1 from erp.product_variants e join public.product_variants v on v.id = e.id)
    or exists (select 1 from erp.products e join public.products p
      on e.organization_id = target_org and e.normalized_internal_code = upper('WEB-' || replace(p.id::text, '-', '')))
    or exists (select 1 from erp.product_variants e join public.product_variants v
      on e.organization_id = target_org and e.product_id = v.product_id
      and e.code = 'WEB-' || replace(v.id::text, '-', '')) then
    raise exception using errcode = 'unique_violation',
      message = 'storefront UUID or deterministic code is already used in ERP';
  end if;

  create temporary table if not exists _nictech_storefront_model_brands (
    model_id uuid primary key,
    brand_id uuid not null
  ) on commit drop;
  truncate _nictech_storefront_model_brands;

  if to_regclass('public.categories') is not null
     and to_regclass('public.brands') is not null
     and to_regclass('public.models') is not null then
    insert into _nictech_storefront_model_brands (model_id, brand_id)
    select id, brand_id from public.models where brand_id is not null;
    if exists (
      select 1 from public.models where brand_id is null or nullif(btrim(name), '') is null
    ) or exists (
      select 1 from public.products p
      join _nictech_storefront_model_brands m on m.model_id = p.model_id
      where p.brand_id is not null and p.brand_id <> m.brand_id
    ) then
      raise exception using errcode = 'check_violation',
        message = 'storefront model and brand references are inconsistent';
    end if;
    insert into erp.product_categories (id, organization_id, code, name, created_at)
    select c.id, target_org, 'WEB-' || replace(c.id::text, '-', ''), c.name,
      coalesce(c.created_at, now()) from public.categories c;
    insert into erp.brands (id, organization_id, code, name, created_at)
    select b.id, target_org, 'WEB-' || replace(b.id::text, '-', ''), b.name,
      b.created_at from public.brands b;
    insert into erp.product_models (id, organization_id, brand_id, code, name, created_at)
    select m.id, target_org, m.brand_id,
      'WEB-' || replace(m.id::text, '-', ''), m.name, m.created_at
    from public.models m;
  elsif exists (
    select 1 from public.products p
    where to_jsonb(p)->>'category_id' is not null
       or to_jsonb(p)->>'brand_id' is not null
       or to_jsonb(p)->>'model_id' is not null
  ) then
    raise exception using errcode = 'undefined_table',
      message = 'storefront categories, brands and models are required for referenced products';
  end if;

  insert into erp.products (
    id, organization_id, product_type_id, item_kind,
    category_id, brand_id, model_id, unit_id,
    internal_code, internal_name, public_name, public_description,
    inventory_tracking, base_sale_price, can_sell, publish_on_web,
    allow_online_sale, web_image_path, is_active, created_at
  )
  select p.id, target_org, target_type, 'product',
    nullif(to_jsonb(p)->>'category_id', '')::uuid,
    coalesce(nullif(to_jsonb(p)->>'brand_id', '')::uuid, mb.brand_id),
    nullif(to_jsonb(p)->>'model_id', '')::uuid, target_unit,
    'WEB-' || replace(p.id::text, '-', ''), p.name, p.name, p.description,
    'quantity', p.price, true,
    coalesce((to_jsonb(p)->>'is_active')::boolean, true),
    coalesce((to_jsonb(p)->>'is_active')::boolean, true), p.image_url,
    coalesce((to_jsonb(p)->>'is_active')::boolean, true), coalesce(p.created_at, now())
  from public.products p
  left join _nictech_storefront_model_brands mb
    on mb.model_id = nullif(to_jsonb(p)->>'model_id', '')::uuid;

  insert into erp.product_variants (
    id, organization_id, product_id, code, name, attributes,
    image_path, price_delta, is_active, created_at
  )
  select v.id, target_org, v.product_id,
    'WEB-' || replace(v.id::text, '-', ''), v.color,
    jsonb_build_object('color', v.color), v.image_url, 0,
    coalesce((to_jsonb(v)->>'is_active')::boolean, true), v.created_at
  from public.product_variants v;

  create temporary table if not exists _nictech_storefront_opening (
    row_number integer primary key,
    product_id uuid not null,
    variant_id uuid,
    quantity numeric(18, 4) not null
  ) on commit drop;
  truncate _nictech_storefront_opening;

  insert into _nictech_storefront_opening (row_number, product_id, variant_id, quantity)
  select row_number() over (order by s.product_id, s.variant_id nulls first),
    s.product_id, s.variant_id, s.quantity
  from (
    select p.id as product_id, null::uuid as variant_id, p.stock::numeric as quantity
    from public.products p
    where not exists (select 1 from public.product_variants v where v.product_id = p.id)
    union all
    select v.product_id, v.id, v.stock::numeric
    from public.product_variants v
  ) s
  where s.quantity > 0;

  select count(*), coalesce(sum(quantity), 0)
    into opening_count, stock_total
  from _nictech_storefront_opening;

  -- Each document has at most 200 lines, below the normal 250-line command limit.
  if opening_count > 0 then
  for batch_number in 0..((opening_count - 1) / 200) loop
    insert into erp.stock_documents (
      organization_id, branch_id, kind, idempotency_key, request_hash,
      reason, source_type
    ) values (
      target_org, target_branch, 'opening',
      'storefront-initial-opening-' || (batch_number + 1)::text,
      md5('storefront-initial-opening-' || (batch_number + 1)::text),
      'Apertura de inventario desde tienda existente',
      'storefront_initial_import'
    ) returning id into opening_document_id;

    for opening_line in
      select product_id, variant_id, quantity,
        row_number - batch_number * 200 as line_number
      from _nictech_storefront_opening
      where row_number between batch_number * 200 + 1 and batch_number * 200 + 200
      order by row_number
    loop
      insert into erp.stock_document_lines (
        organization_id, document_id, line_number, product_id, variant_id,
        to_location_id, quantity, unit_cost
      ) values (
        target_org, opening_document_id, opening_line.line_number,
        opening_line.product_id, opening_line.variant_id,
        target_location, opening_line.quantity, 0
      );
    end loop;

    insert into erp.stock_movements (
      organization_id, branch_id, document_id, document_line_id,
      product_id, variant_id, location_id, quantity_delta, unit_cost
    )
    select target_org, target_branch, opening_document_id, line.id,
      line.product_id, line.variant_id, target_location, line.quantity, 0
    from erp.stock_document_lines line where line.document_id = opening_document_id;

    insert into erp.stock_balances (
      organization_id, branch_id, location_id, product_id, variant_id, quantity_on_hand
    )
    select target_org, target_branch, target_location,
      line.product_id, line.variant_id, line.quantity
    from erp.stock_document_lines line where line.document_id = opening_document_id;

    perform erp.process_stock_document_costs(opening_document_id);
  end loop;
  end if;

  result := jsonb_build_object(
    'products', product_count, 'variants', variant_count,
    'stock_lines', opening_count, 'stock_units', stock_total,
    'opening_documents', case when opening_count = 0 then 0 else ((opening_count - 1) / 200) + 1 end
  );
  insert into erp.configuration_values (
    organization_id, key, value, description, is_system
  ) values (
    target_org, 'storefront.initial_catalog_import', result,
    'One-time storefront opening snapshot', true
  );
  return result;
end;
$$;

revoke all on function erp.import_storefront_catalog_opening()
  from public, anon, authenticated, service_role;
comment on function erp.import_storefront_catalog_opening() is
  'Database-owner-only explicit opening import. Invoke after storefront/ERP stock cutover is ready; never run automatically.';
