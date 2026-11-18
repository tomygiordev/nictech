create or replace function erp.catalog_sellable_stock(
  p_organization_id uuid,
  p_branch_id uuid
)
returns table (
  product_id uuid,
  variant_id uuid,
  available numeric,
  unit_price_ars numeric,
  stock_value_ars numeric
)
language sql
stable
set search_path = pg_catalog, erp, pg_temp
as $$
  -- Sellable stock is stock in active locations marked allows_sale (not quarantine or transit).
  with balances as (
    select b.product_id, b.variant_id,
      sum(greatest(b.quantity_on_hand - b.quantity_reserved, 0)) as available
    from erp.stock_balances b
    join erp.locations l
      on l.id = b.location_id and l.organization_id = b.organization_id and l.branch_id = b.branch_id
    join erp.products p on p.id = b.product_id and p.organization_id = b.organization_id
    where b.organization_id = p_organization_id
      and (p_branch_id is null or b.branch_id = p_branch_id)
      and l.allows_sale and l.is_active
      and p.is_active and p.inventory_tracking <> 'none'
    group by b.product_id, b.variant_id
  ), priced as materialized (
    select b.*,
      (erp.resolve_catalog_effective_price_internal(p_organization_id, b.product_id, b.variant_id)
        ->> 'list_price_ars')::numeric as unit_price_ars
    from balances b
  )
  select p.product_id, p.variant_id, p.available, p.unit_price_ars,
    p.available * p.unit_price_ars as stock_value_ars
  from priced p;
$$;

create or replace function erp.catalog_sellable_stock(p_organization_id uuid)
returns table (
  product_id uuid,
  variant_id uuid,
  available numeric,
  unit_price_ars numeric,
  stock_value_ars numeric
)
language sql
stable
set search_path = pg_catalog, erp, pg_temp
as $$
  select * from erp.catalog_sellable_stock(p_organization_id, null);
$$;

revoke all on function erp.catalog_sellable_stock(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function erp.catalog_sellable_stock(uuid) from public, anon, authenticated, service_role;

create or replace function erp.get_dashboard_metrics(
  date_from date,
  date_to date,
  target_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, erp, pg_temp
as $$
declare
  v_org uuid := erp.current_organization_id();
  v_zone constant text := 'America/Argentina/Buenos_Aires';
  v_from timestamptz;
  v_to timestamptz;
  v_can_sales boolean;
begin
  if auth.uid() is null or v_org is null or not erp.has_permission('dashboard.view', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'dashboard.view permission required';
  end if;

  if date_from is null or date_to is null
    or not isfinite(date_from) or not isfinite(date_to) or date_to < date_from
    or date_to - date_from > 731 then
    raise exception using errcode = 'invalid_parameter_value', message = 'a finite, ordered date range of up to 732 days is required';
  end if;

  v_from := date_from::timestamp at time zone v_zone;
  v_to := (date_to + 1)::timestamp at time zone v_zone;
  v_can_sales := erp.has_permission('sales.view', target_branch_id);

  return (
    with sales_by_day as (
      select (s.confirmed_at at time zone v_zone)::date as day,
        sum(amount.ars) filter (where f.sale_id is null) as pos_ars,
        sum(amount.ars) filter (where f.sale_id is not null) as web_ars,
        count(*) filter (where f.sale_id is null) as pos_count,
        count(*) filter (where f.sale_id is not null) as web_count
      from erp.sales s
      -- Fulfillment creates the ERP sale. The link determines its channel, not a second amount.
      left join erp.web_order_fulfillments f
        on f.sale_id = s.id and f.organization_id = s.organization_id and f.branch_id = s.branch_id
      cross join lateral (
        select coalesce(sum(round(l.line_total * s.exchange_rate, 4)), 0) as ars
        from erp.sale_lines l
        where l.sale_id = s.id and l.organization_id = s.organization_id
      ) amount
      where s.organization_id = v_org
        and (target_branch_id is null or s.branch_id = target_branch_id)
        and v_can_sales
        and s.confirmed_at >= v_from and s.confirmed_at < v_to
        and coalesce((
          select e.sale_state
          from erp.sale_state_events e
          where e.sale_id = s.id and e.organization_id = s.organization_id and e.sale_state is not null
          order by e.event_sequence desc
          limit 1
        ), 'confirmed'::erp.sale_state) <> 'cancelled'::erp.sale_state
      group by 1
    ), repair_payments as materialized (
      select (p.occurred_at at time zone v_zone)::date as day, p.repair_order_id, p.amount_base
      from erp.payments p
      where p.organization_id = v_org and p.repair_order_id is not null
        and (target_branch_id is null or p.branch_id = target_branch_id)
        and v_can_sales
        and p.occurred_at >= v_from and p.occurred_at < v_to
    ), repairs_paid_by_day as (
      select day, sum(amount_base) as ars from repair_payments group by day
    ), repairs_opened_by_day as (
      select (r.opened_at at time zone v_zone)::date as day, count(*) as opened
      from erp.repair_orders r
      where r.organization_id = v_org
        and (target_branch_id is null or r.branch_id = target_branch_id)
        and r.opened_at >= v_from and r.opened_at < v_to
      group by 1
    ), active_products as (
      select p.id, p.internal_name, p.inventory_tracking
      from erp.products p where p.organization_id = v_org and p.is_active
    ), stock_by_product as (
      select s.product_id, sum(s.available) as available, sum(s.stock_value_ars) as stock_value_ars
      from erp.catalog_sellable_stock(v_org, target_branch_id) s
      group by s.product_id
    ), lowest_stock as (
      select p.id as product_id, p.internal_name as name, coalesce(s.available, 0) as available
      from active_products p
      left join stock_by_product s on s.product_id = p.id
      where p.inventory_tracking <> 'none' and coalesce(s.available, 0) <= 3
      order by available, p.id
      limit 5
    ), daily as (
      select date_from + offset_day as day,
        coalesce(s.pos_ars, 0) as pos_ars,
        coalesce(s.web_ars, 0) as web_ars,
        coalesce(p.ars, 0) as repairs_ars,
        coalesce(r.opened, 0) as repairs_opened,
        coalesce(s.pos_count, 0) as pos_count,
        coalesce(s.web_count, 0) as web_count
      from generate_series(0, date_to - date_from) as days(offset_day)
      left join sales_by_day s on s.day = date_from + offset_day
      left join repairs_paid_by_day p on p.day = date_from + offset_day
      left join repairs_opened_by_day r on r.day = date_from + offset_day
    )
    select jsonb_build_object(
      'can_view_sales', v_can_sales,
      'sales', jsonb_build_object(
        'pos_ars', sum(pos_ars),
        'web_ars', sum(web_ars),
        'repairs_ars', sum(repairs_ars),
        'total_ars', sum(pos_ars + web_ars + repairs_ars),
        'pos_count', sum(pos_count),
        'web_count', sum(web_count),
        'repairs_count', (select count(distinct repair_order_id) from repair_payments)
      ),
      'series', jsonb_agg(jsonb_build_object(
        'day', day, 'pos_ars', pos_ars, 'web_ars', web_ars,
        'repairs_ars', repairs_ars, 'repairs_opened', repairs_opened
      ) order by day),
      'products_active_count', (select count(*) from active_products),
      'inventory', (
        select jsonb_build_object(
          'sellable_units', coalesce(sum(available), 0),
          'value_at_sale_price_ars', coalesce(sum(stock_value_ars), 0)
        )
        from stock_by_product
      ),
      'low_stock', (
        select coalesce(jsonb_agg(to_jsonb(l) order by l.available, l.product_id), '[]'::jsonb)
        from lowest_stock l
      ),
      'active_repairs_count', (
        select count(*)
        from erp.repair_orders_overview r
        where r.organization_id = v_org
          and (target_branch_id is null or r.branch_id = target_branch_id)
          and r.status_is_terminal is not true and r.delivery_id is null
      )
    )
    from daily
  );
end;
$$;

create or replace function erp.get_catalog_kpis(
  search_text text default null,
  target_category_id uuid default null,
  include_inactive boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, erp, pg_temp
as $$
declare
  v_org uuid := erp.current_organization_id();
  v_term text := nullif(translate(regexp_replace(search_text, '^\s+|\s+$', '', 'g'), ',()', ''), '');
begin
  if auth.uid() is null or v_org is null or not erp.has_permission('catalog.view') then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog.view permission required';
  end if;

  return (
    with stock_by_product as (
      select s.product_id, sum(s.available) as available, sum(s.stock_value_ars) as stock_value_ars
      from erp.catalog_sellable_stock(v_org) s
      group by s.product_id
    )
    select jsonb_build_object(
      'total_products', count(*),
      'stock_value_ars', coalesce(sum(s.stock_value_ars), 0),
      'low_stock_count', count(*) filter (
        where p.is_active and p.inventory_tracking <> 'none' and s.available between 1 and 3
      ),
      'out_of_stock_count', count(*) filter (
        where p.is_active and p.inventory_tracking <> 'none' and coalesce(s.available, 0) <= 0
      )
    )
    from erp.products p
    left join stock_by_product s on s.product_id = p.id
    where p.organization_id = v_org
      and (include_inactive or p.is_active)
      and (target_category_id is null or p.category_id = target_category_id)
      and (v_term is null or p.internal_name ilike '%' || v_term || '%'
         or p.internal_code ilike '%' || v_term || '%')
  );
end;
$$;

revoke all on function erp.get_dashboard_metrics(date, date, uuid) from public, anon, service_role;
grant execute on function erp.get_dashboard_metrics(date, date, uuid) to authenticated;
revoke all on function erp.get_catalog_kpis(text, uuid, boolean) from public, anon, service_role;
grant execute on function erp.get_catalog_kpis(text, uuid, boolean) to authenticated;
