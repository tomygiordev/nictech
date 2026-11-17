-- Release hardening for the NicTech ERP.
-- Imperative migration: this repository has no supabase/schemas declarative source.

set search_path = erp, public, storage, pg_catalog, pg_temp;

-- A service-role workflow may establish an explicit tenant context for the duration
-- of one transaction. Authenticated users always resolve their organization from
-- erp.profiles and can never override it with the GUC.
create or replace function erp.current_organization_id()
returns uuid
language plpgsql
stable
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  profile_organization_id uuid;
  service_organization_text text;
begin
  if auth.uid() is not null then
    select profile.organization_id
      into profile_organization_id
    from erp.profiles profile
    where profile.id = auth.uid()
      and profile.is_active;

    return profile_organization_id;
  end if;

  if auth.role() = 'service_role' then
    service_organization_text := nullif(
      current_setting('erp.service_organization_id', true),
      ''
    );
    if service_organization_text is not null then
      return service_organization_text::uuid;
    end if;
  end if;

  return null;
end;
$$;

revoke all on function erp.current_organization_id() from public, anon;
grant execute on function erp.current_organization_id() to authenticated, service_role;

-- Internal accounting helper: its organization must be the authenticated tenant
-- (or the explicit service tenant established by the payment command). It is not
-- part of the Data API surface.
create or replace function erp.ensure_open_period(
  target_date date,
  target_organization_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  context_organization_id uuid := erp.current_organization_id();
  period_id uuid;
  period_status erp.accounting_period_status;
  month_start date;
begin
  if target_date is null or target_organization_id is null then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'target date and organization are required';
  end if;

  if context_organization_id is null
     or context_organization_id <> target_organization_id
     or not erp.has_permission('accounting.post') then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'accounting.post permission in the active organization is required';
  end if;

  month_start := date_trunc('month', target_date)::date;

  select period.id, period.status
    into period_id, period_status
  from erp.accounting_periods period
  where period.organization_id = target_organization_id
    and target_date between period.period_start and period.period_end
  for update;

  if period_id is not null and period_status = 'closed' then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'accounting period is closed';
  end if;

  if period_id is null then
    insert into erp.accounting_periods (
      organization_id, period_start, period_end
    ) values (
      target_organization_id,
      month_start,
      (month_start + interval '1 month - 1 day')::date
    )
    on conflict (organization_id, period_start, period_end) do nothing
    returning id into period_id;

    if period_id is null then
      select period.id, period.status
        into period_id, period_status
      from erp.accounting_periods period
      where period.organization_id = target_organization_id
        and target_date between period.period_start and period.period_end
      for update;

      if period_status = 'closed' then
        raise exception using
          errcode = 'object_not_in_prerequisite_state',
          message = 'accounting period is closed';
      end if;
    end if;
  end if;

  return period_id;
end;
$$;

revoke all on function erp.ensure_open_period(date, uuid)
  from public, anon, authenticated, service_role;

-- POS convenience helpers remain tenant-scoped commands. They no longer guess an
-- organization and do not grant service_role a general-purpose mutation endpoint.
create or replace function erp.get_or_create_pos_customer(
  p_display_name text default 'Consumidor Final'
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  organization_id_value uuid := erp.current_organization_id();
  customer_id_value uuid;
  display_name_value text := coalesce(
    nullif(btrim(p_display_name), ''),
    'Consumidor Final'
  );
  normalized_display_name_value text;
  generated_code_value text;
begin
  if organization_id_value is null
     or not erp.has_permission('customers.manage') then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'customers.manage permission in an active organization is required';
  end if;

  normalized_display_name_value := lower(display_name_value);
  generated_code_value := 'CLI-' || upper(substr(md5(
    organization_id_value::text || ':' || normalized_display_name_value
  ), 1, 12));

  -- Serialize calls for the same tenant/name. The schema intentionally has no
  -- normalized_name column, so the deterministic code is the durable conflict
  -- key and the advisory lock closes the select/insert race between POS calls.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    organization_id_value::text || ':' || normalized_display_name_value,
    0
  ));

  select customer.id
    into customer_id_value
  from erp.customers customer
  where customer.organization_id = organization_id_value
    and lower(btrim(customer.display_name)) = normalized_display_name_value
  order by customer.created_at, customer.id
  limit 1;

  if customer_id_value is not null then
    update erp.customers
    set is_active = true
    where id = customer_id_value
      and not is_active;
    return customer_id_value;
  end if;

  insert into erp.customers (
    organization_id, code, display_name, is_active
  ) values (
    organization_id_value,
    generated_code_value,
    display_name_value,
    true
  )
  on conflict on constraint customers_code_unique do update
    set is_active = true
  returning id into customer_id_value;

  return customer_id_value;
end;
$$;

revoke all on function erp.get_or_create_pos_customer(text)
  from public, anon, service_role;
grant execute on function erp.get_or_create_pos_customer(text) to authenticated;

create or replace function erp.get_or_open_pos_cash_session(
  target_branch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  organization_id_value uuid := erp.current_organization_id();
  session_id_value uuid;
  register_id_value uuid;
begin
  if organization_id_value is null
     or target_branch_id is null
     or not erp.has_permission('cash.open', target_branch_id) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'cash.open permission in an active branch is required';
  end if;

  select session.id
    into session_id_value
  from erp.cash_sessions session
  where session.organization_id = organization_id_value
    and session.branch_id = target_branch_id
    and not exists (
      select 1
      from erp.cash_closures closure
      where closure.cash_session_id = session.id
        and closure.organization_id = session.organization_id
    )
  order by session.opened_at desc, session.id
  limit 1;

  if session_id_value is not null then
    return session_id_value;
  end if;

  select register.id
    into register_id_value
  from erp.cash_registers register
  where register.organization_id = organization_id_value
    and register.branch_id = target_branch_id
    and register.is_active
  order by register.code, register.id
  limit 1;

  if register_id_value is null then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'an active cash register is required';
  end if;

  return erp.open_cash_session(
    register_id_value,
    'pos-auto-open:' || target_branch_id::text || ':' || current_date::text,
    'Apertura automatica POS',
    jsonb_build_array(
      jsonb_build_object('currency_code', 'ARS', 'amount', 0)
    )
  );
end;
$$;

revoke all on function erp.get_or_open_pos_cash_session(uuid)
  from public, anon, service_role;
grant execute on function erp.get_or_open_pos_cash_session(uuid) to authenticated;

create or replace function erp.get_or_create_exchange_snapshot(
  target_quote_currency text default 'ARS'
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  organization_id_value uuid := erp.current_organization_id();
  quote_currency_value text := upper(btrim(coalesce(target_quote_currency, '')));
  base_currency_value text;
  snapshot_id_value uuid;
  exchange_rate_id_value uuid;
begin
  if organization_id_value is null
     or not erp.has_permission('pricing.manage') then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'pricing.manage permission in an active organization is required';
  end if;

  if quote_currency_value !~ '^[A-Z]{3}$' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'a valid quote currency is required';
  end if;

  select currency.currency_code
    into base_currency_value
  from erp.organization_currencies currency
  where currency.organization_id = organization_id_value
    and currency.is_base
    and currency.is_active;

  if base_currency_value is null then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'an active base currency is required';
  end if;

  select snapshot.id
    into snapshot_id_value
  from erp.exchange_rate_snapshots snapshot
  where snapshot.organization_id = organization_id_value
    and snapshot.base_currency = base_currency_value
    and snapshot.quote_currency = quote_currency_value
  order by snapshot.quoted_at desc, snapshot.captured_at desc, snapshot.id
  limit 1;

  if snapshot_id_value is not null then
    return snapshot_id_value;
  end if;

  if quote_currency_value <> base_currency_value then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'a captured exchange-rate snapshot is required for non-base currency';
  end if;

  insert into erp.exchange_rates (
    organization_id, base_currency, quote_currency, rate_to_base, source,
    quoted_at, idempotency_key, request_hash, captured_by
  ) values (
    organization_id_value, base_currency_value, quote_currency_value, 1,
    'base-currency', now(),
    'base-currency:' || quote_currency_value,
    md5(jsonb_build_array(organization_id_value, quote_currency_value, 1)::text),
    auth.uid()
  )
  on conflict (organization_id, idempotency_key) do update
    set quoted_at = excluded.quoted_at
  returning id into exchange_rate_id_value;

  insert into erp.exchange_rate_snapshots (
    organization_id, exchange_rate_id, base_currency, quote_currency,
    rate_to_base, source, quoted_at, captured_at
  ) values (
    organization_id_value, exchange_rate_id_value, base_currency_value,
    quote_currency_value, 1, 'base-currency', now(), now()
  )
  on conflict (exchange_rate_id) do update
    set captured_at = excluded.captured_at
  returning id into snapshot_id_value;

  return snapshot_id_value;
end;
$$;

revoke all on function erp.get_or_create_exchange_snapshot(text)
  from public, anon, service_role;
grant execute on function erp.get_or_create_exchange_snapshot(text) to authenticated;

-- The frontend authorization context is sourced from the same database RBAC used
-- by RLS and commands. User-editable JWT metadata is intentionally not consulted.
create or replace function erp.get_current_erp_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  organization_id_value uuid := erp.current_organization_id();
  permission_codes text[];
  accessible_branch_ids uuid[];
begin
  if auth.uid() is null or organization_id_value is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'authenticated ERP context is required';
  end if;

  select coalesce(array_agg(permission.code order by permission.code), array[]::text[])
    into permission_codes
  from erp.permissions permission
  where permission.is_active
    and (
      erp.has_permission(permission.code)
      or exists (
        select 1
        from erp.branches branch
        where branch.organization_id = organization_id_value
          and branch.is_active
          and erp.has_permission(permission.code, branch.id)
      )
    );

  select coalesce(array_agg(branch.id order by branch.code, branch.id), array[]::uuid[])
    into accessible_branch_ids
  from erp.branches branch
  where branch.organization_id = organization_id_value
    and branch.is_active
    and exists (
      select 1
      from erp.permissions permission
      where permission.is_active
        and erp.has_permission(permission.code, branch.id)
    );

  return jsonb_build_object(
    'organization_id', organization_id_value,
    'user_id', auth.uid(),
    'permissions', to_jsonb(permission_codes),
    'branch_ids', to_jsonb(accessible_branch_ids)
  );
end;
$$;

revoke all on function erp.get_current_erp_context() from public, anon, service_role;
grant execute on function erp.get_current_erp_context() to authenticated;

-- Reporting views use invoker rights so underlying RLS remains authoritative. The
-- explicit tenant/permission predicates are defense in depth and make the intended
-- access contract visible in the view itself.
create or replace view erp.v_iva_ventas
with (security_invoker = true)
as
select
  line.organization_id,
  sale.branch_id,
  sale.id as sale_id,
  sale.confirmed_at::date as sale_date,
  line.tax_rate_percent as alicuota,
  (line.line_total - line.tax_amount)::numeric(18, 4) as base_imponible,
  line.tax_amount::numeric(18, 4) as iva,
  sale.currency_code,
  sale.exchange_rate,
  round((line.line_total - line.tax_amount) * sale.exchange_rate, 4)::numeric(18, 4)
    as base_imponible_base,
  round(line.tax_amount * sale.exchange_rate, 4)::numeric(18, 4) as iva_base
from erp.sale_lines line
join erp.sales sale
  on sale.id = line.sale_id
 and sale.organization_id = line.organization_id
where line.organization_id = erp.current_organization_id()
  and erp.has_permission('sales.view', sale.branch_id)
  and coalesce((
    select event.sale_state
    from erp.sale_state_events event
    where event.sale_id = sale.id
      and event.organization_id = sale.organization_id
      and event.sale_state is not null
    order by event.event_sequence desc
    limit 1
  ), 'confirmed'::erp.sale_state) <> 'cancelled'::erp.sale_state;

create or replace view erp.v_iva_compras
with (security_invoker = true)
as
select
  receipt_line.organization_id,
  receipt.branch_id,
  receipt.purchase_order_id,
  receipt.received_at::date as purchase_date,
  case
    when round(receipt_line.quantity * receipt_line.unit_price, 4) = 0 then null
    else round(
      order_line.tax_amount
      * receipt_line.quantity / order_line.ordered_quantity
      / round(receipt_line.quantity * receipt_line.unit_price, 4)
      * 100,
      4
    )::numeric(7, 4)
  end::numeric(7, 4) as alicuota,
  round(receipt_line.quantity * receipt_line.unit_price, 4)::numeric(18, 4)
    as base_imponible,
  round(
    order_line.tax_amount * receipt_line.quantity / order_line.ordered_quantity,
    4
  )::numeric(18, 4) as iva,
  receipt.id as purchase_receipt_id,
  receipt.currency_code,
  receipt.exchange_rate,
  receipt_line.goods_cost_base::numeric(18, 4) as base_imponible_base,
  round(
    order_line.tax_amount * receipt_line.quantity / order_line.ordered_quantity
    * receipt.exchange_rate,
    4
  )::numeric(18, 4) as iva_base
from erp.purchase_receipt_lines receipt_line
join erp.purchase_receipts receipt
  on receipt.id = receipt_line.receipt_id
 and receipt.organization_id = receipt_line.organization_id
join erp.purchase_order_lines order_line
  on order_line.id = receipt_line.purchase_order_line_id
 and order_line.organization_id = receipt_line.organization_id
where receipt_line.organization_id = erp.current_organization_id()
  and erp.has_permission('purchases.view', receipt.branch_id)
  and erp.has_permission('costs.view', receipt.branch_id);

create or replace view erp.v_trial_balance
with (security_invoker = true)
as
select
  entry.organization_id,
  entry.period_id,
  period.period_start,
  period.period_end,
  line.account_id,
  account.code as account_code,
  account.name as account_name,
  sum(round(line.debit * line.exchange_rate, 2))::numeric(18, 2) as total_debit,
  sum(round(line.credit * line.exchange_rate, 2))::numeric(18, 2) as total_credit,
  (
    sum(round(line.debit * line.exchange_rate, 2))
    - sum(round(line.credit * line.exchange_rate, 2))
  )::numeric(18, 2) as balance
from erp.journal_entry_lines line
join erp.journal_entries entry
  on entry.id = line.journal_entry_id
 and entry.organization_id = line.organization_id
join erp.accounting_periods period
  on period.id = entry.period_id
 and period.organization_id = entry.organization_id
join erp.chart_of_accounts account
  on account.id = line.account_id
 and account.organization_id = line.organization_id
where entry.organization_id = erp.current_organization_id()
  and erp.has_permission('accounting.view', entry.branch_id)
  and period.status = 'closed'
  and entry.status in ('posted', 'reversed')
group by
  entry.organization_id, entry.period_id, period.period_start, period.period_end,
  line.account_id, account.code, account.name;

create or replace view erp.v_profitability_by_line
with (security_invoker = true)
as
with sales_agg as (
  select
    line.organization_id,
    line.product_id,
    sum(line.quantity)::numeric(18, 4) as quantity_sold,
    sum(round(line.line_total * sale.exchange_rate, 4))::numeric(18, 4)
      as gross_revenue
  from erp.sale_lines line
  join erp.sales sale
    on sale.id = line.sale_id
   and sale.organization_id = line.organization_id
  where line.organization_id = erp.current_organization_id()
    and line.kind = 'product'
    and line.product_id is not null
    and erp.has_permission('sales.view', sale.branch_id)
    and coalesce((
      select event.sale_state
      from erp.sale_state_events event
      where event.sale_id = sale.id
        and event.organization_id = sale.organization_id
        and event.sale_state is not null
      order by event.event_sequence desc
      limit 1
    ), 'confirmed'::erp.sale_state) <> 'cancelled'::erp.sale_state
  group by line.organization_id, line.product_id
),
cost_agg as (
  select
    line.organization_id,
    line.product_id,
    sum(line.landed_cost_base)::numeric(18, 4) as total_landed_cost,
    sum(line.quantity)::numeric(18, 4) as quantity_received
  from erp.purchase_receipt_lines line
  join erp.purchase_receipts receipt
    on receipt.id = line.receipt_id
   and receipt.organization_id = line.organization_id
  where line.organization_id = erp.current_organization_id()
    and line.product_id is not null
    and erp.has_permission('purchases.view', receipt.branch_id)
    and erp.has_permission('costs.view', receipt.branch_id)
  group by line.organization_id, line.product_id
)
select
  product.organization_id,
  product.id as product_id,
  product.internal_code,
  product.internal_name,
  sales.quantity_sold,
  sales.gross_revenue,
  case
    when costs.quantity_received is null or costs.quantity_received = 0 then null
    else (costs.total_landed_cost / costs.quantity_received)::numeric(24, 8)
  end as avg_unit_landed_cost,
  case
    when costs.quantity_received is null
      or costs.quantity_received = 0
      or sales.quantity_sold is null then null
    else (
      sales.quantity_sold * costs.total_landed_cost / costs.quantity_received
    )::numeric(18, 4)
  end as estimated_cost,
  case
    when costs.quantity_received is null
      or costs.quantity_received = 0
      or sales.quantity_sold is null then null
    else (
      sales.gross_revenue
      - sales.quantity_sold * costs.total_landed_cost / costs.quantity_received
    )::numeric(18, 4)
  end as margin
from erp.products product
left join sales_agg sales
  on sales.product_id = product.id
 and sales.organization_id = product.organization_id
left join cost_agg costs
  on costs.product_id = product.id
 and costs.organization_id = product.organization_id
where product.organization_id = erp.current_organization_id()
  and (sales.quantity_sold is not null or costs.quantity_received is not null);

comment on view erp.v_iva_ventas is
  'IVA ventas confirmado y no cancelado; importes originales y convertidos a moneda base.';
comment on view erp.v_iva_compras is
  'IVA compras sobre mercaderia efectivamente recepcionada; prorratea el impuesto de la orden y expone moneda base.';
comment on view erp.v_trial_balance is
  'Balance de periodos cerrados convertido a moneda base mediante el snapshot de cada linea.';
comment on view erp.v_profitability_by_line is
  'Rentabilidad en moneda base; excluye ventas canceladas y usa costo de recepciones reales.';

revoke all on
  erp.v_iva_ventas,
  erp.v_iva_compras,
  erp.v_trial_balance,
  erp.v_profitability_by_line
from public, anon;
grant select on
  erp.v_iva_ventas,
  erp.v_iva_compras,
  erp.v_trial_balance,
  erp.v_profitability_by_line
to authenticated;

-- Phase E overview views intentionally mediate column-level grants from several
-- internal tables. Keep that compatibility, but prevent predicate push-down
-- across their tenant/permission filters and keep them off the anonymous API.
alter view erp.trade_ins_overview set (security_barrier = true);
alter view erp.pc_build_projects_overview set (security_barrier = true);

revoke all on
  erp.trade_ins_overview,
  erp.pc_build_projects_overview
from public, anon;
grant select on
  erp.trade_ins_overview,
  erp.pc_build_projects_overview
to authenticated;

-- Seed the standard accounting controls without requiring an authenticated ERP
-- operator. This is an internal provisioning primitive used by the organization
-- trigger and by the one-time backfill below. Existing account definitions and
-- role mappings win; only an inactive matching default account is reactivated.
create or replace function erp.ensure_default_accounting_setup(
  target_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  default_row record;
  account_id_value uuid;
begin
  if target_organization_id is null
     or not exists (
       select 1
       from erp.organizations organization
       where organization.id = target_organization_id
     ) then
    raise exception using
      errcode = 'foreign_key_violation',
      message = 'a valid organization is required';
  end if;

  for default_row in
    select * from (values
      ('cash_ars', '1.1.01', 'Caja ARS', 'asset'::erp.account_type, 'debit'::erp.account_normal_balance),
      ('cash_usd', '1.1.02', 'Caja USD', 'asset'::erp.account_type, 'debit'::erp.account_normal_balance),
      ('receivable', '1.1.10', 'Cuentas por cobrar', 'asset'::erp.account_type, 'debit'::erp.account_normal_balance),
      ('inventory', '1.1.20', 'Inventario', 'asset'::erp.account_type, 'debit'::erp.account_normal_balance),
      ('suppliers', '2.1.10', 'Proveedores', 'liability'::erp.account_type, 'credit'::erp.account_normal_balance),
      ('sales_income', '4.1.01', 'Ventas', 'income'::erp.account_type, 'credit'::erp.account_normal_balance),
      ('financing_income', '4.1.02', 'Ingresos financieros', 'income'::erp.account_type, 'credit'::erp.account_normal_balance),
      ('cogs', '5.1.01', 'Costo de ventas', 'expense'::erp.account_type, 'debit'::erp.account_normal_balance),
      ('fx_result', '4.9.01', 'Diferencias de cambio', 'income'::erp.account_type, 'credit'::erp.account_normal_balance)
    ) as defaults(role_code, code, name, account_type, normal_balance)
  loop
    insert into erp.chart_of_accounts (
      organization_id, code, name, account_type, normal_balance, is_control
    ) values (
      target_organization_id, default_row.code, default_row.name,
      default_row.account_type, default_row.normal_balance, true
    )
    on conflict on constraint chart_of_accounts_code_unique do update
      set is_active = true
    returning id into account_id_value;

    insert into erp.accounting_account_roles (
      organization_id, role_code, account_id
    ) values (
      target_organization_id, default_row.role_code, account_id_value
    )
    on conflict on constraint accounting_account_roles_unique do nothing;
  end loop;
end;
$$;

revoke all on function erp.ensure_default_accounting_setup(uuid)
  from public, anon, authenticated, service_role;

create or replace function erp.provision_organization_accounting_defaults()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
begin
  perform erp.ensure_default_accounting_setup(new.id);
  return new;
end;
$$;

revoke all on function erp.provision_organization_accounting_defaults()
  from public, anon, authenticated, service_role;

drop trigger if exists organizations_provision_accounting_defaults
  on erp.organizations;
create trigger organizations_provision_accounting_defaults
after insert on erp.organizations
for each row execute function erp.provision_organization_accounting_defaults();

do $$
declare
  organization_row record;
begin
  for organization_row in select id from erp.organizations
  loop
    perform erp.ensure_default_accounting_setup(organization_row.id);
  end loop;
end;
$$;

create or replace function erp.post_confirmed_sale_accounting()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  sale_row erp.sales%rowtype;
  period_id_value uuid;
  journal_entry_id_value uuid;
  receivable_account_id uuid;
  income_account_id uuid;
  inventory_account_id uuid;
  cogs_account_id uuid;
  revenue_base numeric(18, 2);
  cogs_base numeric(18, 2);
  debit_total_value numeric(18, 2);
  base_currency_value text;
begin
  if new.payment_state is null then
    return new;
  end if;

  select sale.*
    into sale_row
  from erp.sales sale
  where sale.id = new.sale_id
    and sale.organization_id = new.organization_id;

  if sale_row.id is null
     or sale_row.idempotency_key like '%:fulfill:sale'
     or exists (
       select 1
       from erp.accounting_source_events source_event
       where source_event.organization_id = sale_row.organization_id
         and source_event.source_type = 'sale'
         and source_event.source_id = sale_row.id
         and source_event.posting_kind = 'primary'
     ) then
    return new;
  end if;

  if auth.uid() is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'an authenticated actor is required for automatic sale accounting';
  end if;

  select
    (max(role.account_id::text) filter (where role.role_code = 'receivable'))::uuid,
    (max(role.account_id::text) filter (where role.role_code = 'sales_income'))::uuid,
    (max(role.account_id::text) filter (where role.role_code = 'inventory'))::uuid,
    (max(role.account_id::text) filter (where role.role_code = 'cogs'))::uuid
  into
    receivable_account_id,
    income_account_id,
    inventory_account_id,
    cogs_account_id
  from erp.accounting_account_roles role
  where role.organization_id = sale_row.organization_id;

  if receivable_account_id is null or income_account_id is null then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'receivable and sales income account roles are required';
  end if;

  revenue_base := round(sale_row.total_amount * sale_row.exchange_rate, 2);
  select currency.currency_code into base_currency_value
  from erp.organization_currencies currency
  where currency.organization_id = sale_row.organization_id
    and currency.is_base and currency.is_active;
  if base_currency_value is null then
    raise exception 'an active base currency is required';
  end if;

  select coalesce(round(sum(-movement.value_delta_base), 2), 0)
    into cogs_base
  from erp.stock_cost_movements movement
  where movement.organization_id = sale_row.organization_id
    and movement.document_id = sale_row.stock_document_id
    and movement.quantity_delta < 0;

  if cogs_base > 0 and (inventory_account_id is null or cogs_account_id is null) then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'inventory and COGS account roles are required';
  end if;

  select period.id
    into period_id_value
  from erp.accounting_periods period
  where period.organization_id = sale_row.organization_id
    and sale_row.confirmed_at::date between period.period_start and period.period_end
  for update;

  if period_id_value is null then
    insert into erp.accounting_periods (
      organization_id, period_start, period_end
    ) values (
      sale_row.organization_id,
      date_trunc('month', sale_row.confirmed_at)::date,
      (date_trunc('month', sale_row.confirmed_at) + interval '1 month - 1 day')::date
    )
    on conflict (organization_id, period_start, period_end) do nothing
    returning id into period_id_value;

    if period_id_value is null then
      select period.id
        into period_id_value
      from erp.accounting_periods period
      where period.organization_id = sale_row.organization_id
        and sale_row.confirmed_at::date between period.period_start and period.period_end;
    end if;
  elsif exists (
    select 1
    from erp.accounting_periods period
    where period.id = period_id_value and period.status = 'closed'
  ) then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'accounting period is closed';
  end if;

  debit_total_value := revenue_base + cogs_base;

  insert into erp.journal_entries (
    organization_id, branch_id, period_id, entry_date, status, description,
    source_type, source_id, idempotency_key, total_debit, total_credit,
    posted_at, posted_by, created_by
  ) values (
    sale_row.organization_id, sale_row.branch_id, period_id_value,
    sale_row.confirmed_at::date, 'posted', 'Venta ' || sale_row.id::text,
    'sale', sale_row.id, 'sale:' || sale_row.id::text || ':primary',
    debit_total_value, debit_total_value, now(), auth.uid(), auth.uid()
  )
  returning id into journal_entry_id_value;

  insert into erp.journal_entry_lines (
    organization_id, journal_entry_id, line_number, account_id, description,
    debit, credit, currency_code, exchange_rate
  ) values
    (
      sale_row.organization_id, journal_entry_id_value, 1,
      receivable_account_id, 'Venta ' || sale_row.id::text,
      revenue_base, 0, base_currency_value, 1
    ),
    (
      sale_row.organization_id, journal_entry_id_value, 2,
      income_account_id, 'Ingreso por venta ' || sale_row.id::text,
      0, revenue_base, base_currency_value, 1
    );

  if cogs_base > 0 then
    insert into erp.journal_entry_lines (
      organization_id, journal_entry_id, line_number, account_id, description,
      debit, credit, currency_code, exchange_rate
    ) values
      (
        sale_row.organization_id, journal_entry_id_value, 3,
        cogs_account_id, 'Costo de venta ' || sale_row.id::text,
        cogs_base, 0, base_currency_value, 1
      ),
      (
        sale_row.organization_id, journal_entry_id_value, 4,
        inventory_account_id, 'Salida de inventario ' || sale_row.id::text,
        0, cogs_base, base_currency_value, 1
      );
  end if;

  insert into erp.accounting_source_events (
    organization_id, source_type, source_id, posting_kind, journal_entry_id
  ) values (
    sale_row.organization_id, 'sale', sale_row.id, 'primary', journal_entry_id_value
  );

  return new;
end;
$$;

revoke all on function erp.post_confirmed_sale_accounting()
  from public, anon, authenticated, service_role;

drop trigger if exists sale_state_events_post_accounting on erp.sale_state_events;
create trigger sale_state_events_post_accounting
after insert on erp.sale_state_events
for each row
when (new.payment_state is not null)
execute function erp.post_confirmed_sale_accounting();

-- Provider-driven postings have no auth.users row. Preserve the invariant that a
-- human posting identifies the actor while allowing an explicit service workflow
-- to post with both actor columns null.
alter table erp.journal_entries
  drop constraint if exists journal_entries_posted_shape;
alter table erp.journal_entries
  add constraint journal_entries_posted_shape check (
    (status = 'draft' and posted_at is null and posted_by is null)
    or (
      status in ('posted', 'reversed')
      and posted_at is not null
      and (posted_by is not null or created_by is null)
    )
  );

-- Version the legacy storefront order contract locally. CREATE IF NOT EXISTS is
-- deliberate because existing installations already own this table.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  items jsonb,
  payer jsonb,
  total numeric not null check (total <> 'NaN'::numeric and total >= 0),
  status text not null default 'pending',
  payment_id text,
  payment_method_id text,
  stock_decremented boolean default false,
  ip_address text,
  device_fingerprint text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders enable row level security;
grant select, insert, update on public.orders to service_role;

create table erp.storefront_payment_syncs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  storefront_order_id uuid not null references public.orders(id) on delete restrict,
  web_order_id uuid not null,
  payment_event_id uuid not null,
  sale_id uuid not null,
  stock_document_id uuid not null,
  journal_entry_id uuid not null,
  provider text not null,
  provider_payment_id text not null,
  provider_event_id text not null,
  request_hash text not null,
  processed_at timestamptz not null default now(),
  constraint storefront_payment_syncs_branch_fk
    foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint storefront_payment_syncs_web_order_fk
    foreign key (web_order_id, organization_id, branch_id)
    references erp.web_orders(id, organization_id, branch_id) on delete restrict,
  constraint storefront_payment_syncs_payment_event_fk
    foreign key (payment_event_id, organization_id, web_order_id)
    references erp.web_payment_events(id, organization_id, web_order_id) on delete restrict,
  constraint storefront_payment_syncs_sale_fk
    foreign key (sale_id, organization_id, branch_id)
    references erp.sales(id, organization_id, branch_id) on delete restrict,
  constraint storefront_payment_syncs_stock_fk
    foreign key (stock_document_id, organization_id)
    references erp.stock_documents(id, organization_id) on delete restrict,
  constraint storefront_payment_syncs_journal_fk
    foreign key (journal_entry_id, organization_id)
    references erp.journal_entries(id, organization_id) on delete restrict,
  constraint storefront_payment_syncs_storefront_unique unique (storefront_order_id),
  constraint storefront_payment_syncs_provider_payment_unique
    unique (organization_id, provider, provider_payment_id),
  constraint storefront_payment_syncs_provider_event_unique
    unique (organization_id, provider, provider_event_id)
);

alter table erp.storefront_payment_syncs enable row level security;
revoke all on erp.storefront_payment_syncs from public, anon, authenticated;
grant select, insert on erp.storefront_payment_syncs to service_role;

comment on table erp.storefront_payment_syncs is
  'Immutable commit receipt linking a paid public storefront order to the ERP order, payment, sale, stock and journal facts.';

create or replace function erp.process_mercadopago_payment(
  p_organization_id uuid,
  p_branch_id uuid,
  p_location_id uuid,
  p_storefront_order_id uuid,
  p_customer_id uuid,
  p_exchange_snapshot_id uuid,
  p_payment_method_id uuid,
  p_provider_payment_id text,
  p_provider_event_id text,
  p_status text,
  p_total numeric,
  p_currency_code text,
  p_external_reference text,
  p_payer jsonb,
  p_items jsonb,
  p_provider_occurred_at timestamptz,
  p_raw_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = erp, public, pg_catalog, pg_temp
as $$
declare
  existing_sync erp.storefront_payment_syncs%rowtype;
  storefront_total numeric;
  storefront_items jsonb;
  request_hash_value text;
  erp_lines jsonb := '[]'::jsonb;
  item jsonb;
  item_count integer;
  distinct_item_count integer;
  quantity_value numeric(18, 4);
  gross_unit_price_value numeric(18, 4);
  line_gross_value numeric(18, 4);
  net_unit_price_value numeric(18, 4);
  line_tax_value numeric(18, 4);
  computed_total numeric(18, 4) := 0;
  product_id_value uuid;
  variant_id_value uuid;
  inventory_unit_id_value uuid;
  product_tax_rate numeric(7, 4);
  product_tracking erp.inventory_tracking_mode;
  web_order_id_value uuid;
  payment_event_id_value uuid;
  fulfillment_result jsonb;
  provider_method_text text;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'service_role is required';
  end if;

  if p_organization_id is null
     or p_branch_id is null
     or p_location_id is null
     or p_storefront_order_id is null
     or p_exchange_snapshot_id is null
     or p_payment_method_id is null
     or nullif(btrim(p_provider_payment_id), '') is null
     or nullif(btrim(p_provider_event_id), '') is null
     or lower(btrim(coalesce(p_status, ''))) <> 'approved'
     or p_total is null or p_total = 'NaN'::numeric or p_total <= 0
     or upper(btrim(coalesce(p_currency_code, ''))) !~ '^[A-Z]{3}$'
     or p_external_reference is distinct from p_storefront_order_id::text
     or p_payer is null or jsonb_typeof(p_payer) <> 'object'
     or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 250
     or p_provider_occurred_at is null
     or p_raw_data is null or jsonb_typeof(p_raw_data) <> 'object'
     or pg_column_size(p_items) > 1048576
     or pg_column_size(p_raw_data) > 1048576 then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'complete approved Mercado Pago order data is required';
  end if;

  request_hash_value := md5(jsonb_build_object(
    'organization_id', p_organization_id,
    'branch_id', p_branch_id,
    'location_id', p_location_id,
    'storefront_order_id', p_storefront_order_id,
    'customer_id', p_customer_id,
    'exchange_snapshot_id', p_exchange_snapshot_id,
    'payment_method_id', p_payment_method_id,
    'provider_payment_id', btrim(p_provider_payment_id),
    'status', 'approved',
    'total', round(p_total, 4),
    'currency_code', upper(btrim(p_currency_code)),
    'external_reference', p_external_reference,
    'payer', p_payer,
    'items', p_items
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':mercadopago:' || btrim(p_provider_payment_id),
    0
  ));

  select sync.*
    into existing_sync
  from erp.storefront_payment_syncs sync
  where sync.organization_id = p_organization_id
    and sync.provider = 'mercadopago'
    and sync.provider_payment_id = btrim(p_provider_payment_id)
  for update;

  if existing_sync.id is not null then
    if existing_sync.storefront_order_id <> p_storefront_order_id
       or existing_sync.request_hash <> request_hash_value then
      raise exception using
        errcode = 'integrity_constraint_violation',
        message = 'Mercado Pago payment is already bound to another payload';
    end if;

    return jsonb_build_object(
      'web_order_id', existing_sync.web_order_id,
      'payment_event_id', existing_sync.payment_event_id,
      'sale_id', existing_sync.sale_id,
      'stock_document_id', existing_sync.stock_document_id,
      'journal_entry_id', existing_sync.journal_entry_id,
      'idempotent', true
    );
  end if;

  if not exists (
    select 1
    from erp.branches branch
    where branch.id = p_branch_id
      and branch.organization_id = p_organization_id
      and branch.is_active
  ) or not exists (
    select 1
    from erp.locations location
    where location.id = p_location_id
      and location.organization_id = p_organization_id
      and location.branch_id = p_branch_id
      and location.is_active
      and location.contributes_to_web_stock
  ) or not exists (
    select 1
    from erp.exchange_rate_snapshots snapshot
    where snapshot.id = p_exchange_snapshot_id
      and snapshot.organization_id = p_organization_id
      and snapshot.quote_currency = upper(btrim(p_currency_code))
  ) or not exists (
    select 1
    from erp.payment_methods method
    where method.id = p_payment_method_id
      and method.organization_id = p_organization_id
      and method.is_active
      and not method.requires_cash_session
  ) or (
    p_customer_id is not null
    and not exists (
      select 1
      from erp.customers customer
      where customer.id = p_customer_id
        and customer.organization_id = p_organization_id
        and customer.is_active
    )
  ) then
    raise exception using
      errcode = 'foreign_key_violation',
      message = 'ERP storefront context is invalid or cross-tenant';
  end if;

  select orders.total, orders.items
    into storefront_total, storefront_items
  from public.orders orders
  where orders.id = p_storefront_order_id
  for update;

  if storefront_total is null then
    raise exception using
      errcode = 'no_data_found',
      message = 'storefront order not found';
  end if;

  if round(storefront_total, 4) <> round(p_total, 4)
     or coalesce(storefront_items, '[]'::jsonb) <> p_items then
    raise exception using
      errcode = 'integrity_constraint_violation',
      message = 'storefront order total or items do not match the provider payment';
  end if;

  select count(*), count(distinct concat_ws(
    ':', value->>'product_id', coalesce(value->>'variant_id', ''),
    coalesce(value->>'inventory_unit_id', '')
  ))
  into item_count, distinct_item_count
  from jsonb_array_elements(p_items);

  if item_count <> distinct_item_count then
    raise exception using
      errcode = 'check_violation',
      message = 'duplicate product/variant/unit lines must be aggregated before payment';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(item) <> 'object'
       or nullif(btrim(item->>'product_id'), '') is null
       or nullif(btrim(item->>'title'), '') is null
       or not erp.is_finite_numeric_text(item->>'quantity')
       or not erp.is_finite_numeric_text(item->>'unit_price') then
      raise exception using
        errcode = 'invalid_parameter_value',
        message = 'each item requires product_id, title, finite quantity and unit_price';
    end if;

    begin
      product_id_value := (item->>'product_id')::uuid;
      variant_id_value := nullif(item->>'variant_id', '')::uuid;
      inventory_unit_id_value := nullif(item->>'inventory_unit_id', '')::uuid;
      quantity_value := (item->>'quantity')::numeric;
      gross_unit_price_value := (item->>'unit_price')::numeric;
    exception when others then
      raise exception using
        errcode = 'invalid_parameter_value',
        message = 'item identifiers and amounts are invalid';
    end;

    if quantity_value <= 0
       or gross_unit_price_value < 0
       or quantity_value = 'NaN'::numeric
       or gross_unit_price_value = 'NaN'::numeric then
      raise exception using
        errcode = 'invalid_parameter_value',
        message = 'item quantity and unit price must be finite and positive';
    end if;

    select product.tax_rate_percent, product.inventory_tracking
      into product_tax_rate, product_tracking
    from erp.products product
    where product.id = product_id_value
      and product.organization_id = p_organization_id
      and product.item_kind = 'product'
      and product.is_active
      and product.can_sell
      and product.publish_on_web
      and product.allow_online_sale;

    if product_tax_rate is null then
      raise exception using
        errcode = 'foreign_key_violation',
        message = 'active ERP web product not found';
    end if;

    if variant_id_value is not null and not exists (
      select 1
      from erp.product_variants variant
      where variant.id = variant_id_value
        and variant.product_id = product_id_value
        and variant.organization_id = p_organization_id
        and variant.is_active
    ) then
      raise exception using
        errcode = 'foreign_key_violation',
        message = 'active ERP product variant not found';
    end if;

    if product_tracking = 'serialized'
       and (inventory_unit_id_value is null or quantity_value <> 1) then
      raise exception using
        errcode = 'check_violation',
        message = 'serialized storefront items require one explicit inventory unit';
    end if;

    if inventory_unit_id_value is not null and not exists (
      select 1
      from erp.inventory_units unit
      where unit.id = inventory_unit_id_value
        and unit.product_id = product_id_value
        and unit.organization_id = p_organization_id
        and unit.variant_id is not distinct from variant_id_value
    ) then
      raise exception using
        errcode = 'foreign_key_violation',
        message = 'ERP inventory unit does not match the item';
    end if;

    line_gross_value := round(quantity_value * gross_unit_price_value, 4);
    net_unit_price_value := round(
      line_gross_value / (1 + product_tax_rate / 100) / quantity_value,
      4
    );
    line_tax_value := line_gross_value - round(quantity_value * net_unit_price_value, 4);
    computed_total := computed_total + line_gross_value;

    erp_lines := erp_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'product_id', product_id_value,
      'variant_id', variant_id_value,
      'inventory_unit_id', inventory_unit_id_value,
      'location_id', p_location_id,
      'description', btrim(item->>'title'),
      'quantity', quantity_value,
      'unit_price', net_unit_price_value,
      'tax_rate_percent', product_tax_rate,
      'tax_amount', line_tax_value
    )));
  end loop;

  if round(computed_total, 4) <> round(p_total, 4) then
    raise exception using
      errcode = 'check_violation',
      message = 'aggregated item total does not match the approved payment';
  end if;

  perform set_config('erp.service_organization_id', p_organization_id::text, true);

  web_order_id_value := erp.create_web_order(
    p_branch_id,
    p_customer_id,
    upper(btrim(p_currency_code)),
    p_exchange_snapshot_id,
    'storefront:' || p_storefront_order_id::text,
    now() + interval '30 minutes',
    erp_lines
  );

  payment_event_id_value := erp.record_web_payment_event(
    web_order_id_value,
    'mercadopago',
    btrim(p_provider_event_id),
    btrim(p_provider_payment_id),
    'approved',
    p_payment_method_id,
    round(p_total, 4),
    p_provider_occurred_at,
    p_raw_data
  );

  perform erp.record_web_order_event(
    web_order_id_value,
    null,
    'preparing',
    'storefront:' || p_storefront_order_id::text || ':preparing',
    'Mercado Pago approved; prepare storefront order'
  );

  fulfillment_result := erp.fulfill_online_order(
    web_order_id_value,
    btrim(p_provider_payment_id),
    'storefront:' || p_storefront_order_id::text,
    'Mercado Pago approved storefront fulfillment'
  );

  insert into erp.storefront_payment_syncs (
    organization_id, branch_id, storefront_order_id, web_order_id,
    payment_event_id, sale_id, stock_document_id, journal_entry_id,
    provider, provider_payment_id, provider_event_id, request_hash
  ) values (
    p_organization_id, p_branch_id, p_storefront_order_id, web_order_id_value,
    payment_event_id_value,
    (fulfillment_result->>'sale_id')::uuid,
    (fulfillment_result->>'stock_document_id')::uuid,
    (fulfillment_result->>'journal_entry_id')::uuid,
    'mercadopago', btrim(p_provider_payment_id), btrim(p_provider_event_id),
    request_hash_value
  );

  provider_method_text := coalesce(
    nullif(p_raw_data #>> '{payment_method,id}', ''),
    nullif(p_raw_data->>'payment_method_id', ''),
    p_payment_method_id::text
  );

  update public.orders
  set status = 'approved',
      payment_id = btrim(p_provider_payment_id),
      payment_method_id = provider_method_text,
      stock_decremented = true,
      payer = p_payer,
      updated_at = now()
  where id = p_storefront_order_id;

  return jsonb_build_object(
    'web_order_id', web_order_id_value,
    'payment_event_id', payment_event_id_value,
    'sale_id', fulfillment_result->>'sale_id',
    'stock_document_id', fulfillment_result->>'stock_document_id',
    'journal_entry_id', fulfillment_result->>'journal_entry_id',
    'idempotent', false
  );
end;
$$;

comment on function erp.process_mercadopago_payment(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, numeric,
  text, text, jsonb, jsonb, timestamptz, jsonb
) is
  'Service-only atomic commit: validates a paid storefront order, reserves/fulfills ERP stock, records payment, sale and journal, then marks public.orders approved.';

revoke all on function erp.process_mercadopago_payment(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, numeric,
  text, text, jsonb, jsonb, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function erp.process_mercadopago_payment(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, numeric,
  text, text, jsonb, jsonb, timestamptz, jsonb
) to service_role;

-- Keep per-user predicates as init plans and avoid duplicate permissive SELECT
-- policies. This preserves the existing authorization semantics while preventing
-- repeated auth evaluation and redundant policy execution for every row.
drop policy if exists profiles_select_allowed on erp.profiles;
create policy profiles_select_allowed
on erp.profiles for select to authenticated
using (
  id = (select auth.uid())
  or (organization_id = erp.current_organization_id() and erp.has_permission('users.view'))
);

drop policy if exists profile_roles_select_allowed on erp.profile_roles;
create policy profile_roles_select_allowed
on erp.profile_roles for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and (profile_id = (select auth.uid()) or erp.has_permission('users.view', branch_id))
);

drop policy if exists overrides_select_allowed on erp.profile_permission_overrides;
create policy overrides_select_allowed
on erp.profile_permission_overrides for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and (profile_id = (select auth.uid()) or erp.has_permission('users.view', branch_id))
);

drop policy if exists locations_manage on erp.locations;
create policy locations_insert
on erp.locations for insert to authenticated
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('locations.manage', branch_id)
);
create policy locations_update
on erp.locations for update to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('locations.manage', branch_id)
)
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('locations.manage', branch_id)
);
create policy locations_delete
on erp.locations for delete to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('locations.manage', branch_id)
);

drop policy if exists roles_select_allowed on erp.roles;
drop policy if exists roles_manage on erp.roles;
create policy roles_select_allowed
on erp.roles for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and (erp.has_permission('users.view') or erp.has_permission('users.manage'))
);
create policy roles_insert
on erp.roles for insert to authenticated
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('users.manage')
);
create policy roles_update
on erp.roles for update to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('users.manage')
)
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('users.manage')
);
create policy roles_delete
on erp.roles for delete to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('users.manage')
);
