-- Fix MercadoPago webhook fulfillment in the ERP:
-- 1. Support v2 gross pricing on erp.web_orders / erp.web_order_lines (matching erp.sales / erp.sale_lines)
--    so gross ARS storefront prices (e.g. 900 x2 and 2400 x2 at 21% IVA) reconcile exactly with p_total.
-- 2. Advance delivery_state through preparing -> ready inside erp.process_mercadopago_payment before fulfillment,
--    preserving the strict 'ready' requirement on erp.fulfill_web_order for manual ERP calls.
-- 3. Allow service_role (with explicit erp.service_organization_id tenant context) in
--    erp.post_online_order_accounting_internal and erp.ensure_open_period_internal while keeping both
--    internal-only (revoked from public, anon, authenticated, service_role).

begin;

set search_path = erp, public, pg_catalog, pg_temp;

-- ============================================================================
-- 1. Schema extension: v2 gross pricing on erp.web_orders & erp.web_order_lines
-- ============================================================================
alter table erp.web_orders
  add column if not exists pricing_version text not null default 'v1';

alter table erp.web_orders
  drop constraint if exists web_orders_pricing_version_check;

alter table erp.web_orders
  add constraint web_orders_pricing_version_check
  check (pricing_version in ('v1', 'v2'));

alter table erp.web_order_lines
  add column if not exists pricing_version text not null default 'v1';

alter table erp.web_order_lines
  drop constraint if exists web_order_lines_pricing_version_check;

alter table erp.web_order_lines
  add constraint web_order_lines_pricing_version_check
  check (pricing_version in ('v1', 'v2'));

alter table erp.web_order_lines
  add column if not exists unit_gross_price numeric(18, 4);

alter table erp.web_order_lines
  add column if not exists net_subtotal_amount numeric(18, 4);

alter table erp.web_order_lines
  drop constraint if exists web_order_lines_check;

alter table erp.web_order_lines
  drop constraint if exists web_order_lines_amounts_reconcile;

alter table erp.web_order_lines
  add constraint web_order_lines_amounts_reconcile
  check (
    (
      pricing_version = 'v1' and (
        line_total <> 'NaN'::numeric
        and tax_amount = round(round(quantity * unit_price, 4) * tax_rate_percent / 100, 4)
        and line_total = round(quantity * unit_price, 4) + tax_amount
      )
    )
    or
    (
      pricing_version = 'v2' and (
        line_total <> 'NaN'::numeric
        and unit_gross_price is not null
        and unit_gross_price >= 0
        and unit_gross_price <> 'NaN'::numeric
        and net_subtotal_amount is not null
        and net_subtotal_amount >= 0
        and net_subtotal_amount <> 'NaN'::numeric
        and line_total = round(quantity * unit_gross_price, 4)
        and net_subtotal_amount = round(line_total / (1 + tax_rate_percent / 100), 4)
        and tax_amount = line_total - net_subtotal_amount
      )
    )
  );

-- ============================================================================
-- 2. Internal accounting helpers: allow service_role tenant workflow
-- ============================================================================
create or replace function erp.ensure_open_period_internal(
  target_date date,
  target_organization_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_organization_id uuid := erp.current_organization_id();
  period_id_value uuid;
  period_status_value erp.accounting_period_status;
  month_start date;
begin
  if target_date is null
     or target_organization_id is null
     or (auth.uid() is null and auth.role() is distinct from 'service_role')
     or context_organization_id is null
     or context_organization_id <> target_organization_id then
    raise exception using errcode = 'insufficient_privilege',
      message = 'an authenticated active-organization context is required';
  end if;
  month_start := date_trunc('month', target_date)::date;
  select period.id, period.status
  into period_id_value, period_status_value
  from erp.accounting_periods period
  where period.organization_id = target_organization_id
    and target_date between period.period_start and period.period_end
  for update;
  if period_id_value is not null and period_status_value = 'closed' then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'accounting period is closed';
  end if;
  if period_id_value is null then
    insert into erp.accounting_periods (organization_id, period_start, period_end)
    values (
      target_organization_id, month_start,
      (month_start + interval '1 month - 1 day')::date
    )
    on conflict (organization_id, period_start, period_end) do nothing
    returning id into period_id_value;
    if period_id_value is null then
      select period.id, period.status
      into period_id_value, period_status_value
      from erp.accounting_periods period
      where period.organization_id = target_organization_id
        and target_date between period.period_start and period.period_end
      for update;
      if period_status_value = 'closed' then
        raise exception using errcode = 'object_not_in_prerequisite_state',
          message = 'accounting period is closed';
      end if;
    end if;
  end if;
  return period_id_value;
end;
$$;

revoke all on function erp.ensure_open_period_internal(date, uuid)
  from public, anon, authenticated, service_role;

create or replace function erp.post_online_order_accounting_internal(
  target_branch_id uuid,
  target_entry_date date,
  target_source_type text,
  target_source_id uuid,
  operation_key text,
  operation_reason text,
  ignored_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  sale_row erp.sales%rowtype;
  period_id_value uuid;
  entry_id_value uuid;
  receivable_account_id uuid;
  income_account_id uuid;
  entry_amount numeric(18, 2);
begin
  if org_id is null
     or (auth.uid() is null and auth.role() is distinct from 'service_role')
     or target_source_type <> 'online_order'
     or target_source_id is null
     or target_entry_date is null
     or nullif(btrim(operation_key), '') is null
     or nullif(btrim(operation_reason), '') is null then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'complete online-order accounting context is required';
  end if;

  select sale.*
    into sale_row
  from erp.web_order_fulfillments fulfillment
  join erp.sales sale
    on sale.id = fulfillment.sale_id
   and sale.organization_id = fulfillment.organization_id
   and sale.branch_id = fulfillment.branch_id
  where fulfillment.organization_id = org_id
    and fulfillment.web_order_id = target_source_id
    and fulfillment.branch_id = target_branch_id;

  if sale_row.id is null
     or not erp.has_permission('orders.manage', target_branch_id) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'a fulfilled order and orders.manage permission are required';
  end if;

  select source_event.journal_entry_id
    into entry_id_value
  from erp.accounting_source_events source_event
  where source_event.organization_id = org_id
    and source_event.source_type = 'online_order'
    and source_event.source_id = target_source_id
    and source_event.posting_kind = 'primary';
  if entry_id_value is not null then
    return entry_id_value;
  end if;

  select entry.id
    into entry_id_value
  from erp.journal_entries entry
  where entry.organization_id = org_id
    and entry.idempotency_key = operation_key;
  if entry_id_value is not null then
    return entry_id_value;
  end if;

  select
    (max(role.account_id::text) filter (where role.role_code = 'receivable'))::uuid,
    (max(role.account_id::text) filter (where role.role_code = 'sales_income'))::uuid
  into receivable_account_id, income_account_id
  from erp.accounting_account_roles role
  where role.organization_id = org_id;

  if receivable_account_id is null or income_account_id is null then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'receivable and sales income accounts are required';
  end if;

  entry_amount := round(sale_row.total_amount, 2);
  if entry_amount <= 0 then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'a positive fulfilled sale total is required';
  end if;

  period_id_value := erp.ensure_open_period_internal(target_entry_date, org_id);

  insert into erp.journal_entries (
    organization_id, branch_id, period_id, entry_date, status, description,
    source_type, source_id, idempotency_key, total_debit, total_credit,
    posted_at, posted_by, created_by
  ) values (
    org_id, target_branch_id, period_id_value, target_entry_date, 'posted',
    operation_reason, 'online_order', target_source_id, operation_key,
    entry_amount, entry_amount, now(), auth.uid(), auth.uid()
  ) returning id into entry_id_value;

  insert into erp.journal_entry_lines (
    organization_id, journal_entry_id, line_number, account_id, description,
    debit, credit, currency_code, exchange_rate
  ) values
    (
      org_id, entry_id_value, 1, receivable_account_id, operation_reason,
      entry_amount, 0, sale_row.currency_code, sale_row.exchange_rate
    ),
    (
      org_id, entry_id_value, 2, income_account_id, operation_reason,
      0, entry_amount, sale_row.currency_code, sale_row.exchange_rate
    );

  insert into erp.accounting_source_events (
    organization_id, source_type, source_id, posting_kind, journal_entry_id
  ) values (
    org_id, 'online_order', target_source_id, 'primary', entry_id_value
  );

  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.audit_events (
    organization_id, branch_id, actor_user_id, schema_name, table_name,
    record_id, action, reason, metadata
  ) values (
    org_id, target_branch_id, auth.uid(), 'erp', 'journal_entries',
    entry_id_value::text, 'execute', operation_reason,
    jsonb_build_object(
      'source_type', 'online_order',
      'source_id', target_source_id,
      'sale_id', sale_row.id,
      'debit', entry_amount,
      'credit', entry_amount,
      'actor_role', coalesce(nullif(auth.role(), ''), case when auth.uid() is not null then 'authenticated' else 'system' end)
    )
  );

  return entry_id_value;
end;
$$;

revoke all on function erp.post_online_order_accounting_internal(
  uuid, date, text, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;

-- ============================================================================
-- 3. erp.create_web_order: preserve v1 and support v2 gross lines
-- ============================================================================
create or replace function erp.create_web_order(
  target_branch_id uuid,
  target_customer_id uuid,
  order_currency text,
  target_exchange_snapshot_id uuid,
  operation_key text,
  expiration_time timestamptz,
  lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  order_id uuid;
  reservation_id uuid;
  exchange_rate_value numeric(24,10);
  operation_hash text;
  line jsonb;
  line_no integer := 0;
  order_pricing_version text := null;
  line_has_gross boolean;
  quantity_value numeric(18,4);
  unit_price_value numeric(18,4);
  unit_gross_value numeric(18,4);
  net_subtotal_value numeric(18,4);
  tax_rate_value numeric(7,4);
  tax_value numeric(18,4);
  line_total_value numeric(18,4);
  total_value numeric(18,4) := 0;
  reservation_lines jsonb := '[]'::jsonb;
  effective_expiration timestamptz := expiration_time;
  reservation_minutes integer;
  parsed_product_id uuid;
  parsed_variant_id uuid;
  parsed_inventory_unit_id uuid;
  parsed_location_id uuid;
begin
  if actor_organization_id is null or not erp.has_permission('orders.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'orders.manage permission is required';
  end if;
  if effective_expiration is null then
    select (configuration.value #>> '{}')::integer into reservation_minutes
    from erp.configuration_values configuration
    where configuration.organization_id = actor_organization_id
      and configuration.branch_id is null
      and configuration.key = 'orders.reservation_minutes';
    if reservation_minutes is null or reservation_minutes not between 1 and 10080 then
      raise exception using errcode = 'object_not_in_prerequisite_state', message = 'valid orders.reservation_minutes configuration is required';
    end if;
    effective_expiration := now() + reservation_minutes * interval '1 minute';
  end if;
  if effective_expiration <= now() or lines is null or jsonb_typeof(lines) <> 'array'
    or jsonb_array_length(lines) = 0 or jsonb_array_length(lines) > 250
    or pg_column_size(lines) > 1048576
    or nullif(btrim(operation_key), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'future expiration and order lines are required';
  end if;
  select rate_to_base into exchange_rate_value from erp.exchange_rate_snapshots
  where id = target_exchange_snapshot_id and organization_id = actor_organization_id
    and quote_currency = upper(btrim(order_currency));
  if exchange_rate_value is null then raise exception using errcode = 'foreign_key_violation', message = 'matching exchange-rate snapshot is required'; end if;
  if target_customer_id is not null and not exists (
    select 1 from erp.customers
    where id = target_customer_id and organization_id = actor_organization_id and is_active
  ) then raise exception using errcode = 'foreign_key_violation', message = 'active customer not found'; end if;
  operation_hash := md5(jsonb_build_object('branch_id', target_branch_id, 'customer_id', target_customer_id, 'currency', upper(btrim(order_currency)), 'snapshot_id', target_exchange_snapshot_id, 'expires_at', expiration_time, 'lines', lines)::text);
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':' || target_branch_id::text, 0));
  select id into order_id from erp.web_orders where organization_id = actor_organization_id
    and branch_id = target_branch_id and idempotency_key = operation_key and request_hash = operation_hash;
  if order_id is not null then return order_id; end if;

  for line in select value from jsonb_array_elements(lines) loop
    if jsonb_typeof(line) <> 'object'
      or nullif(btrim(line->>'product_id'), '') is null
      or nullif(btrim(line->>'location_id'), '') is null
      or not erp.is_finite_numeric_text(line->>'quantity')
      or not erp.is_finite_numeric_text(coalesce(line->>'tax_rate_percent', '0'))
      or not erp.is_finite_numeric_text(coalesce(line->>'tax_amount', '0')) then
      raise exception using errcode = 'invalid_parameter_value', message = 'web order amounts must be finite';
    end if;

    line_has_gross := (line ? 'unit_gross_price') and nullif(btrim(line->>'unit_gross_price'), '') is not null;
    if order_pricing_version is null then
      order_pricing_version := case when line_has_gross then 'v2' else 'v1' end;
    elsif (line_has_gross and order_pricing_version <> 'v2')
          or (not line_has_gross and order_pricing_version <> 'v1') then
      raise exception using errcode = 'invalid_parameter_value', message = 'cannot mix v1 and v2 pricing lines in one web order';
    end if;

    if order_pricing_version = 'v2' then
      if not erp.is_finite_numeric_text(line->>'unit_gross_price')
         or not erp.is_finite_numeric_text(line->>'net_subtotal_amount')
         or not erp.is_finite_numeric_text(line->>'line_total') then
        raise exception using errcode = 'invalid_parameter_value', message = 'web order amounts must be finite';
      end if;
    else
      if not erp.is_finite_numeric_text(line->>'unit_price') then
        raise exception using errcode = 'invalid_parameter_value', message = 'web order amounts must be finite';
      end if;
    end if;

    begin
      quantity_value := (line->>'quantity')::numeric;
      tax_rate_value := coalesce(nullif(line->>'tax_rate_percent', '')::numeric, 0);
      tax_value := coalesce(nullif(line->>'tax_amount', '')::numeric, 0);
      parsed_product_id := (line->>'product_id')::uuid;
      parsed_variant_id := nullif(line->>'variant_id', '')::uuid;
      parsed_inventory_unit_id := nullif(line->>'inventory_unit_id', '')::uuid;
      parsed_location_id := (line->>'location_id')::uuid;
      if order_pricing_version = 'v2' then
        unit_gross_value := (line->>'unit_gross_price')::numeric;
        net_subtotal_value := (line->>'net_subtotal_amount')::numeric;
        line_total_value := (line->>'line_total')::numeric;
        unit_price_value := round(net_subtotal_value / quantity_value, 4);
      else
        unit_price_value := (line->>'unit_price')::numeric;
      end if;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = 'web order line identifiers and amounts are invalid';
    end;

    if quantity_value <= 0 or unit_price_value < 0 or tax_value < 0
      or tax_rate_value < 0 or tax_rate_value > 100
      or (order_pricing_version = 'v2' and (unit_gross_value < 0 or net_subtotal_value < 0 or line_total_value < 0)) then
      raise exception using errcode = 'invalid_parameter_value', message = 'web order amounts are invalid';
    end if;
    if not exists (
      select 1 from erp.products product
      where product.id = parsed_product_id and product.organization_id = actor_organization_id
        and product.item_kind = 'product' and product.is_active and product.can_sell
        and product.publish_on_web and product.allow_online_sale
    ) then raise exception using errcode = 'foreign_key_violation', message = 'active web product not found'; end if;

    if order_pricing_version = 'v2' then
      total_value := total_value + line_total_value;
    else
      total_value := total_value + round(quantity_value * unit_price_value, 4) + tax_value;
    end if;

    reservation_lines := reservation_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'location_id', line->>'location_id', 'product_id', line->>'product_id',
      'variant_id', nullif(line->>'variant_id', ''), 'inventory_unit_id', nullif(line->>'inventory_unit_id', ''),
      'quantity', quantity_value
    )));
  end loop;
  if total_value <= 0 then
    raise exception using errcode = 'check_violation', message = 'web order total must be positive';
  end if;

  order_pricing_version := coalesce(order_pricing_version, 'v1');

  perform set_config('erp.operation_reason', 'Create web order', true);
  insert into erp.web_orders (
    organization_id, branch_id, customer_id, currency_code, exchange_snapshot_id,
    exchange_rate, idempotency_key, request_hash, total_amount, expires_at, created_by, pricing_version
  ) values (
    actor_organization_id, target_branch_id, target_customer_id, upper(btrim(order_currency)),
    target_exchange_snapshot_id, exchange_rate_value, operation_key, operation_hash,
    total_value, effective_expiration, auth.uid(), order_pricing_version
  ) returning id into order_id;

  line_no := 0;
  for line in select value from jsonb_array_elements(lines) loop
    line_no := line_no + 1;
    quantity_value := (line->>'quantity')::numeric;
    tax_rate_value := coalesce(nullif(line->>'tax_rate_percent', '')::numeric, 0);
    tax_value := coalesce(nullif(line->>'tax_amount', '')::numeric, 0);

    if order_pricing_version = 'v2' then
      unit_gross_value := (line->>'unit_gross_price')::numeric;
      net_subtotal_value := (line->>'net_subtotal_amount')::numeric;
      line_total_value := (line->>'line_total')::numeric;
      unit_price_value := round(net_subtotal_value / quantity_value, 4);
    else
      unit_gross_value := null;
      net_subtotal_value := null;
      unit_price_value := (line->>'unit_price')::numeric;
      line_total_value := round(quantity_value * unit_price_value, 4) + tax_value;
    end if;

    insert into erp.web_order_lines (
      organization_id, web_order_id, branch_id, line_number, product_id, variant_id,
      inventory_unit_id, location_id, description, quantity, unit_price,
      unit_gross_price, net_subtotal_amount, tax_rate_percent, tax_amount, line_total, pricing_version
    ) values (
      actor_organization_id, order_id, target_branch_id, line_no, (line->>'product_id')::uuid,
      nullif(line->>'variant_id', '')::uuid, nullif(line->>'inventory_unit_id', '')::uuid,
      (line->>'location_id')::uuid, coalesce(nullif(btrim(line->>'description'), ''), 'Producto web'),
      quantity_value, unit_price_value,
      unit_gross_value, net_subtotal_value, tax_rate_value, tax_value, line_total_value, order_pricing_version
    );
  end loop;

  reservation_id := erp.create_stock_reservation(
    target_branch_id, operation_key || ':reservation', 'online_order', order_id,
    effective_expiration, reservation_lines
  );
  perform set_config('erp.allow_web_reservation_link', 'on', true);
  update erp.web_orders set reservation_batch_id = reservation_id where id = order_id;
  perform set_config('erp.allow_web_reservation_link', 'off', true);
  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, order_state, idempotency_key, request_hash, reason, actor_id
  ) values (
    actor_organization_id, target_branch_id, order_id, 'placed', operation_key || ':state',
    md5(jsonb_build_object('web_order_id', order_id, 'state', 'placed')::text), 'Web order placed', auth.uid()
  );
  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, payment_state, idempotency_key, request_hash, reason, actor_id
  ) values (
    actor_organization_id, target_branch_id, order_id, 'unpaid', operation_key || ':payment-state',
    md5(jsonb_build_object('web_order_id', order_id, 'payment', 'unpaid')::text), 'Awaiting payment', auth.uid()
  );
  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, delivery_state, idempotency_key, request_hash, reason, actor_id
  ) values (
    actor_organization_id, target_branch_id, order_id, 'pending', operation_key || ':delivery-state',
    md5(jsonb_build_object('web_order_id', order_id, 'delivery', 'pending')::text), 'Awaiting preparation', auth.uid()
  );
  insert into erp.integration_outbox (organization_id, branch_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  values (actor_organization_id, target_branch_id, 'web_order', order_id, 'web_order.placed', jsonb_build_object('web_order_id', order_id), operation_key || ':outbox');
  return order_id;
end;
$$;

revoke all on function erp.create_web_order(uuid, uuid, text, uuid, text, timestamptz, jsonb)
  from public, anon, service_role;
grant execute on function erp.create_web_order(uuid, uuid, text, uuid, text, timestamptz, jsonb)
  to authenticated;

-- ============================================================================
-- 4. erp.fulfill_web_order: preserve 'ready' guard; support v1 and v2 snapshots
-- ============================================================================
create or replace function erp.fulfill_web_order(
  target_web_order_id uuid,
  operation_key text,
  operation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  order_row erp.web_orders%rowtype;
  approved_event erp.web_payment_events%rowtype;
  v_sale_id uuid;
  sale_lines jsonb;
  payment_lines jsonb;
  fulfilled_stock_document_id uuid;
  current_order_state text;
  current_payment_state erp.sale_payment_state;
  current_delivery_state erp.sale_delivery_state;
  effective_pricing_version text;
begin
  select * into order_row
    from erp.web_orders
   where id = target_web_order_id
     and organization_id = actor_organization_id
   for update;

  if order_row.id is null or not erp.has_permission('orders.manage', order_row.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'orders.manage permission is required';
  end if;

  select fulfillment.sale_id into v_sale_id
    from erp.web_order_fulfillments fulfillment
   where fulfillment.web_order_id = target_web_order_id
     and fulfillment.organization_id = actor_organization_id;

  if v_sale_id is not null then return v_sale_id; end if;

  select event.order_state into current_order_state from erp.web_order_events event
   where event.web_order_id = target_web_order_id and event.order_state is not null
   order by event.event_sequence desc limit 1;

  select event.payment_state into current_payment_state from erp.web_order_events event
   where event.web_order_id = target_web_order_id and event.payment_state is not null
   order by event.event_sequence desc limit 1;

  select event.delivery_state into current_delivery_state from erp.web_order_events event
   where event.web_order_id = target_web_order_id and event.delivery_state is not null
   order by event.event_sequence desc limit 1;

  if current_order_state not in ('placed', 'confirmed') then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'web order is not eligible for fulfillment';
  end if;

  -- Strictly require delivery state to be 'ready' (Fix 6 from 20260916006000)
  if current_delivery_state <> 'ready' then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'a ready web order is required for fulfillment';
  end if;

  select payment_event.* into approved_event
    from erp.web_order_events order_event
    join erp.web_payment_events payment_event on payment_event.id = order_event.source_payment_event_id
   where order_event.web_order_id = target_web_order_id and order_event.payment_state is not null
   order by order_event.event_sequence desc limit 1;

  if current_payment_state <> 'paid' or approved_event.status <> 'approved' or approved_event.amount <> order_row.total_amount then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'fully approved web payment is required';
  end if;

  if not exists (
    select 1 from erp.stock_reservation_batches batch
     where batch.id = order_row.reservation_batch_id
       and batch.organization_id = actor_organization_id
       and batch.branch_id = order_row.branch_id
       and batch.source_type = 'online_order'
       and batch.source_id = target_web_order_id
       and batch.status = 'active'
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'matching active web order reservation is required';
  end if;

  effective_pricing_version := coalesce(order_row.pricing_version, 'v1');

  -- Consume immutable snapshot from web_order_lines without requoting live catalog
  if effective_pricing_version = 'v2' then
    select jsonb_agg(jsonb_build_object(
      'kind', 'product',
      'product_id', line.product_id,
      'variant_id', line.variant_id,
      'inventory_unit_id', line.inventory_unit_id,
      'from_location_id', line.location_id,
      'description', line.description,
      'quantity', line.quantity,
      'unit_gross_price', line.unit_gross_price,
      'gross_discount_amount', 0,
      'tax_rate_percent', line.tax_rate_percent,
      'net_subtotal_amount', line.net_subtotal_amount,
      'discount_amount', 0,
      'tax_amount', line.tax_amount,
      'line_total', line.line_total
    ) order by line.line_number) into sale_lines
    from erp.web_order_lines line
    where line.web_order_id = target_web_order_id;
  else
    select jsonb_agg(jsonb_build_object(
      'kind', 'product',
      'product_id', line.product_id,
      'variant_id', line.variant_id,
      'inventory_unit_id', line.inventory_unit_id,
      'from_location_id', line.location_id,
      'description', line.description,
      'quantity', line.quantity,
      'unit_price', line.unit_price,
      'discount_amount', 0,
      'tax_rate_percent', line.tax_rate_percent,
      'tax_amount', line.tax_amount
    ) order by line.line_number) into sale_lines
    from erp.web_order_lines line
    where line.web_order_id = target_web_order_id;
  end if;

  payment_lines := jsonb_build_array(jsonb_build_object(
    'payment_method_id', approved_event.payment_method_id,
    'amount', approved_event.amount,
    'provider_reference', approved_event.provider_payment_id
  ));

  v_sale_id := erp.create_sale_core(
    'web_order',
    effective_pricing_version,
    order_row.branch_id,
    order_row.customer_id,
    order_row.currency_code,
    order_row.exchange_snapshot_id,
    operation_key || ':sale',
    operation_reason,
    sale_lines,
    payment_lines,
    order_row.reservation_batch_id
  );

  select sale.stock_document_id into fulfilled_stock_document_id
    from erp.sales sale where sale.id = v_sale_id;

  insert into erp.web_order_fulfillments (
    organization_id, branch_id, web_order_id, sale_id, reservation_batch_id,
    stock_document_id, fulfilled_by
  ) values (
    actor_organization_id, order_row.branch_id, target_web_order_id, v_sale_id,
    order_row.reservation_batch_id, fulfilled_stock_document_id, auth.uid()
  );

  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, order_state, idempotency_key, request_hash, reason, actor_id
  ) values (
    actor_organization_id, order_row.branch_id, target_web_order_id, 'fulfilled', operation_key || ':state',
    md5(jsonb_build_object('web_order_id', target_web_order_id, 'state', 'fulfilled', 'reason', operation_reason)::text),
    operation_reason, auth.uid()
  );

  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, delivery_state, idempotency_key, request_hash, reason, actor_id
  ) values (
    actor_organization_id, order_row.branch_id, target_web_order_id, 'dispatched', operation_key || ':delivery',
    md5(jsonb_build_object('web_order_id', target_web_order_id, 'delivery', 'dispatched', 'reason', operation_reason)::text),
    operation_reason, auth.uid()
  );

  -- Emits BOTH web_order.fulfilled AND web_order.delivery.dispatched outbox events (Fix 6)
  insert into erp.integration_outbox (
    organization_id, branch_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key
  ) values (
    actor_organization_id, order_row.branch_id, 'web_order', target_web_order_id, 'web_order.fulfilled',
    jsonb_build_object('web_order_id', target_web_order_id, 'sale_id', v_sale_id), operation_key || ':outbox'
  );

  insert into erp.integration_outbox (
    organization_id, branch_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key
  ) values (
    actor_organization_id, order_row.branch_id, 'web_order', target_web_order_id,
    'web_order.delivery.dispatched',
    jsonb_build_object('web_order_id', target_web_order_id, 'sale_id', v_sale_id, 'delivery_state', 'dispatched', 'actor_id', auth.uid()),
    operation_key || ':delivery-outbox'
  );

  return v_sale_id;
end;
$$;

revoke all on function erp.fulfill_web_order(uuid, text, text) from public, anon, service_role;
grant execute on function erp.fulfill_web_order(uuid, text, text) to authenticated;

-- ============================================================================
-- 5. erp.process_mercadopago_payment: preparing -> ready & exact v2 VAT lines
-- ============================================================================
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
  net_subtotal_value numeric(18, 4);
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

    if product_tracking = 'serial'
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
    net_subtotal_value := round(line_gross_value / (1 + product_tax_rate / 100), 4);
    net_unit_price_value := round(net_subtotal_value / quantity_value, 4);
    line_tax_value := line_gross_value - net_subtotal_value;
    computed_total := computed_total + line_gross_value;

    erp_lines := erp_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'product_id', product_id_value,
      'variant_id', variant_id_value,
      'inventory_unit_id', inventory_unit_id_value,
      'location_id', p_location_id,
      'description', btrim(item->>'title'),
      'quantity', quantity_value,
      'unit_price', net_unit_price_value,
      'unit_gross_price', gross_unit_price_value,
      'net_subtotal_amount', net_subtotal_value,
      'tax_rate_percent', product_tax_rate,
      'tax_amount', line_tax_value,
      'line_total', line_gross_value
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

  perform erp.record_web_order_event(
    web_order_id_value,
    null,
    'ready',
    'storefront:' || p_storefront_order_id::text || ':ready',
    'Mercado Pago approved; storefront order ready for fulfillment'
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

commit;
