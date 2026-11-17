-- Migration: 20261021051914_erp_pos_authoritative_gross_pricing_and_v2_contract.sql
-- Description: Server-authoritative gross pricing (v2) for POS, line-level gross/net/tax derivation,
-- explicit version checks, private core sale creation with protected wrappers, and immutable persisted-fact receipts.

begin;

set search_path = erp, pg_catalog;

-- ============================================================================
-- 1. Schema Extensions for erp.sales and erp.sale_lines (v1 legacy intact)
-- ============================================================================

-- Sales header pricing version: defaults to 'v1' for all historical rows.
alter table erp.sales
  add column if not exists pricing_version text not null default 'v1';

alter table erp.sales
  drop constraint if exists sales_pricing_version_check;

alter table erp.sales
  add constraint sales_pricing_version_check
  check (pricing_version in ('v1', 'v2'));

comment on column erp.sales.pricing_version is
  'Pricing model version: v1 (legacy net-unit pricing) or v2 (server-authoritative gross ARS pricing).';

-- Sale lines: pricing version and persisted gross/net breakdown columns.
alter table erp.sale_lines
  add column if not exists pricing_version text not null default 'v1';

alter table erp.sale_lines
  drop constraint if exists sale_lines_pricing_version_check;

alter table erp.sale_lines
  add constraint sale_lines_pricing_version_check
  check (pricing_version in ('v1', 'v2'));

alter table erp.sale_lines
  add column if not exists unit_gross_price numeric(18, 4);

alter table erp.sale_lines
  add column if not exists net_subtotal_amount numeric(18, 4);

alter table erp.sale_lines
  add column if not exists gross_discount_amount numeric(18, 4) not null default 0;

alter table erp.sale_lines
  drop constraint if exists sale_lines_gross_discount_check;

alter table erp.sale_lines
  add constraint sale_lines_gross_discount_check
  check (gross_discount_amount >= 0 and gross_discount_amount <> 'NaN'::numeric);

comment on column erp.sale_lines.pricing_version is
  'Line pricing version: v1 (legacy) or v2 (gross ARS with server authority).';
comment on column erp.sale_lines.unit_gross_price is
  'For v2: server-resolved gross unit price inclusive of VAT. Null for v1 legacy.';
comment on column erp.sale_lines.net_subtotal_amount is
  'For v2: line net subtotal derived from gross line and tax rate. Null for v1 legacy.';
comment on column erp.sale_lines.gross_discount_amount is
  'For v2: gross discount amount on the line.';

-- Replace amounts reconciliation check: explicit branch per version.
-- v1 retains exact historical calculation.
-- v2 enforces line_total = round(qty * unit_gross, 4) - gross_discount,
-- net_subtotal derived from gross line, net discount derived, and exact residual tax.
alter table erp.sale_lines
  drop constraint if exists sale_lines_amounts_reconcile;

alter table erp.sale_lines
  add constraint sale_lines_amounts_reconcile
  check (
    (
      pricing_version = 'v1' and (
        discount_amount <= round(quantity * unit_price, 4)
        and tax_amount = round(
          (round(quantity * unit_price, 4) - discount_amount) * tax_rate_percent / 100,
          4
        )
        and line_total = round(quantity * unit_price, 4) - discount_amount + tax_amount
      )
    )
    or
    (
      pricing_version = 'v2' and (
        unit_gross_price is not null
        and unit_gross_price >= 0
        and unit_gross_price <> 'NaN'::numeric
        and net_subtotal_amount is not null
        and net_subtotal_amount >= 0
        and net_subtotal_amount <> 'NaN'::numeric
        and gross_discount_amount >= 0
        and gross_discount_amount <> 'NaN'::numeric
        and gross_discount_amount <= round(quantity * unit_gross_price, 4)
        and line_total = round(quantity * unit_gross_price, 4) - gross_discount_amount
        and net_subtotal_amount = round(round(quantity * unit_gross_price, 4) / (1 + tax_rate_percent / 100), 4)
        and discount_amount = round(gross_discount_amount / (1 + tax_rate_percent / 100), 4)
        and tax_amount = line_total - (net_subtotal_amount - discount_amount)
      )
    )
  );

-- ============================================================================
-- 2. Catalog Price Resolver (Astra1266 / Engram 1221 hardening)
-- ============================================================================
-- Returns authoritative gross final price in ARS and product tax rate.
-- Rejects negative inherited prices (no clamp to 0). Precios 0 y 4 decimales válidos.

drop function if exists erp.resolve_catalog_effective_price(uuid, uuid);

create or replace function erp.resolve_catalog_effective_price(
  p_product_id uuid,
  p_variant_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  v_prod record;
  v_var record;
  v_effective_price numeric(18, 4);
  v_price_source text;
  v_is_override boolean := false;
begin
  if auth.uid() is null then
    raise exception using errcode = 'insufficient_privilege', message = 'authenticated user required';
  end if;

  if org_id is null or (
    not erp.has_permission('catalog.view')
    and not erp.has_permission('catalog.manage')
    and not erp.has_permission('pos.cashier')
    and not erp.has_permission('sales.create')
  ) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'catalog.view, catalog.manage, pos.cashier or sales.create permission required';
  end if;

  -- 1. Product master in active organization
  select id, organization_id, base_sale_price, tax_rate_percent, is_active
    into v_prod
    from erp.products
   where id = p_product_id and organization_id = org_id;

  if not found then
    raise exception using errcode = 'no_data_found',
      message = 'product not found in current organization';
  end if;

  -- 2. Variant evaluation if specified
  if p_variant_id is not null then
    select id, product_id, organization_id, price_delta, final_price_ars, is_active
      into v_var
      from erp.product_variants
     where id = p_variant_id and product_id = p_product_id and organization_id = org_id;

    if not found then
      raise exception using errcode = 'no_data_found',
        message = 'variant not found for product in current organization';
    end if;

    if v_var.final_price_ars is not null then
      -- Variant own absolute final price override (takes precedence over delta and base)
      v_effective_price := v_var.final_price_ars;
      v_price_source := 'variant_override';
      v_is_override := true;
    else
      -- Inherits from parent (preserves legacy price_delta if non-zero)
      v_effective_price := coalesce(v_prod.base_sale_price, 0) + coalesce(v_var.price_delta, 0);
      if v_effective_price < 0 then
        raise exception using errcode = 'check_violation',
          message = 'inherited variant price cannot be negative';
      end if;
      v_price_source := case when coalesce(v_var.price_delta, 0) <> 0 then 'legacy_delta' else 'parent_inherited' end;
      v_is_override := false;
    end if;
  else
    v_effective_price := coalesce(v_prod.base_sale_price, 0);
    if v_effective_price < 0 then
      raise exception using errcode = 'check_violation',
        message = 'product base sale price cannot be negative';
    end if;
    v_price_source := 'parent_base';
    v_is_override := false;
  end if;

  return jsonb_build_object(
    'product_id', p_product_id,
    'variant_id', p_variant_id,
    'currency_code', 'ARS',
    'final_price_ars', v_effective_price,
    'tax_rate_percent', v_prod.tax_rate_percent,
    'price_source', v_price_source,
    'is_override', v_is_override
  );
end;
$$;

revoke all on function erp.resolve_catalog_effective_price(uuid, uuid) from public, anon;
grant execute on function erp.resolve_catalog_effective_price(uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- 3. Core Privado: erp.create_sale_core
-- ============================================================================
-- Sin EXECUTE para public, anon, authenticated, ni service_role.
-- Solo llamable por wrappers autorizados en este schema (security definer).
-- Reordenado: permiso/contexto -> rawhash -> advisory sucursal -> replay ->
--            validaciones nueva op -> snapshot/customer -> persistencia.

create or replace function erp.create_sale_core(
  p_origin text,
  p_pricing_version text,
  p_target_branch_id uuid,
  p_target_customer_id uuid,
  p_sale_currency text,
  p_target_exchange_snapshot_id uuid,
  p_operation_key text,
  p_operation_reason text,
  p_lines jsonb,
  p_payment_lines jsonb default '[]'::jsonb,
  p_target_reservation_batch_id uuid default null,
  p_raw_request_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  v_core_sale_id uuid;
  posted_stock_document_id uuid;
  exchange_rate_value numeric(24, 10);
  operation_hash text;
  line jsonb;
  payment_line jsonb;
  line_id uuid;
  line_no integer := 0;
  line_kind erp.sale_line_kind;
  quantity_value numeric(18, 4);
  unit_price_value numeric(18, 4);
  unit_gross_value numeric(18, 4);
  discount_value numeric(18, 4);
  gross_discount_value numeric(18, 4);
  net_subtotal_value numeric(18, 4);
  tax_rate_value numeric(7, 4);
  tax_value numeric(18, 4);
  line_total_value numeric(18, 4);
  subtotal_accum numeric(18, 4) := 0;
  discount_accum numeric(18, 4) := 0;
  tax_accum numeric(18, 4) := 0;
  total_accum numeric(18, 4) := 0;
  stock_lines jsonb := '[]'::jsonb;
  payment_total numeric(18, 4) := 0;
  receivable_id uuid;
  parsed_product_id uuid;
  parsed_variant_id uuid;
  parsed_inventory_unit_id uuid;
  parsed_location_id uuid;
  v_raw_val numeric;
  v_product_ids uuid[];
  v_variant_ids uuid[];
begin
  -- 1. Permiso / contexto
  if p_origin not in ('pos_v2', 'web_order', 'legacy_internal') then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid sale origin';
  end if;
  if p_pricing_version not in ('v1', 'v2') then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid pricing version';
  end if;
  if p_origin = 'pos_v2' and p_pricing_version <> 'v2' then
    raise exception using errcode = 'invalid_parameter_value', message = 'pos origin requires pricing version v2';
  end if;

  if actor_organization_id is null or not erp.has_permission('sales.create', p_target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'sales.create permission is required';
  end if;

  if p_target_branch_id is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'target branch is required';
  end if;

  if nullif(btrim(p_operation_key), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'operation key is required';
  end if;

  if nullif(btrim(p_operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'operation reason is required';
  end if;

  -- 2. Rawhash (calculado antes de bloqueos de sucursal o lecturas de snapshot/customer)
  operation_hash := coalesce(
    p_raw_request_hash,
    md5(jsonb_build_object(
      'branch_id', p_target_branch_id,
      'customer_id', p_target_customer_id,
      'currency', upper(btrim(coalesce(p_sale_currency, ''))),
      'snapshot_id', p_target_exchange_snapshot_id,
      'reason', p_operation_reason,
      'lines', p_lines,
      'payments', p_payment_lines,
      'reservation_id', p_target_reservation_batch_id
    )::text)
  );

  -- 3. Advisory sucursal FIRST en orden de concurrencia
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':' || p_target_branch_id::text, 0));

  -- 4. Replay guard on sales table (resuelto antes de validar estado o consultar snapshot/customer)
  select s.id into v_core_sale_id
    from erp.sales s
   where s.organization_id = actor_organization_id
     and s.branch_id = p_target_branch_id
     and s.idempotency_key = p_operation_key;

  if v_core_sale_id is not null then
    if exists (
      select 1 from erp.sales s
       where s.id = v_core_sale_id and s.request_hash = operation_hash
    ) then
      return v_core_sale_id;
    else
      raise exception using errcode = 'unique_violation',
        message = 'idempotency key is already used by another request';
    end if;
  end if;

  -- 5. Validaciones de nueva operación:
  -- Payload JSON no nulo, límites de líneas y tamaño
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 250 then
    raise exception using errcode = 'invalid_parameter_value', message = 'between 1 and 250 sale lines are required';
  end if;

  if p_payment_lines is null or jsonb_typeof(p_payment_lines) <> 'array' or jsonb_array_length(p_payment_lines) > 20 then
    raise exception using errcode = 'invalid_parameter_value', message = 'payment lines must be a JSON array with up to 20 lines';
  end if;

  if pg_column_size(p_lines) > 1048576 or pg_column_size(p_payment_lines) > 1048576
     or pg_column_size(p_lines) + pg_column_size(p_payment_lines) > 1048576 then
    raise exception using errcode = 'program_limit_exceeded', message = 'request payload exceeds 1 MiB limit';
  end if;

  -- 6. Snapshot / customer
  select rate_to_base into exchange_rate_value
    from erp.exchange_rate_snapshots
   where id = p_target_exchange_snapshot_id
     and organization_id = actor_organization_id
     and quote_currency = upper(btrim(coalesce(p_sale_currency, '')));

  if exchange_rate_value is null then
    raise exception using errcode = 'foreign_key_violation', message = 'matching exchange-rate snapshot is required';
  end if;

  if p_target_customer_id is not null and not exists (
    select 1 from erp.customers where id = p_target_customer_id and organization_id = actor_organization_id and is_active
  ) then
    raise exception using errcode = 'foreign_key_violation', message = 'active customer not found';
  end if;

  -- 7. Concurrency & locking order:
  -- sucursal (ya tomado) -> advisories productos ordenados -> filas producto/variantes ordenadas -> stock
  select array_agg(p_id order by p_id) into v_product_ids
    from (select distinct nullif(line_item->>'product_id', '')::uuid as p_id from jsonb_array_elements(p_lines) line_item) sub
   where p_id is not null;

  select array_agg(v_id order by v_id) into v_variant_ids
    from (select distinct nullif(line_item->>'variant_id', '')::uuid as v_id from jsonb_array_elements(p_lines) line_item) sub
   where v_id is not null;

  if v_product_ids is not null and array_length(v_product_ids, 1) > 0 then
    for i in 1 .. array_length(v_product_ids, 1) loop
      perform pg_advisory_xact_lock(hashtext(actor_organization_id::text), hashtext(v_product_ids[i]::text));
    end loop;
    perform 1 from erp.products
     where id = any(v_product_ids) and organization_id = actor_organization_id
     order by id
     for share;
  end if;

  if v_variant_ids is not null and array_length(v_variant_ids, 1) > 0 then
    perform 1 from erp.product_variants
     where id = any(v_variant_ids) and organization_id = actor_organization_id
     order by id
     for share;
  end if;

  -- 8. Validar líneas y acumular totales con validación finita y escala 4 ANTES de redondeos
  for line in select value from jsonb_array_elements(p_lines) loop
    line_no := line_no + 1;
    if jsonb_typeof(line) <> 'object' then
      raise exception using errcode = 'invalid_parameter_value', message = format('invalid sale line %s', line_no);
    end if;

    begin
      line_kind := (line->>'kind')::erp.sale_line_kind;
      parsed_product_id := nullif(line->>'product_id', '')::uuid;
      parsed_variant_id := nullif(line->>'variant_id', '')::uuid;
      parsed_inventory_unit_id := nullif(line->>'inventory_unit_id', '')::uuid;
      parsed_location_id := nullif(line->>'from_location_id', '')::uuid;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = format('invalid sale line %s', line_no);
    end;

    if p_pricing_version = 'v2' and line_kind = 'free_concept' then
      raise exception using errcode = 'feature_not_supported',
        message = 'free_concept lines are not permitted for POS v2 sales';
    end if;

    -- Validar cantidad finita y escala <= 4 ANTES de asignación a numeric(18,4)
    begin
      v_raw_val := (line->>'quantity')::numeric;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = format('sale line %s quantity must be positive', line_no);
    end;
    if v_raw_val is null or v_raw_val <= 0 or v_raw_val = 'NaN'::numeric
       or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
       or v_raw_val <> round(v_raw_val, 4) then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s quantity must be positive', line_no);
    end if;
    quantity_value := v_raw_val;

    if p_pricing_version = 'v1' then
      begin
        v_raw_val := (line->>'unit_price')::numeric;
      exception when others then
        raise exception using errcode = 'invalid_parameter_value', message = format('invalid sale line %s', line_no);
      end;
      if v_raw_val is null or v_raw_val < 0 or v_raw_val = 'NaN'::numeric
         or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
         or v_raw_val <> round(v_raw_val, 4) then
        raise exception using errcode = 'invalid_parameter_value',
          message = format('sale line %s unit price must be non-negative with at most 4 decimal places', line_no);
      end if;
      unit_price_value := v_raw_val;

      v_raw_val := coalesce(nullif(line->>'discount_amount', '')::numeric, 0);
      if v_raw_val < 0 or v_raw_val = 'NaN'::numeric
         or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
         or v_raw_val <> round(v_raw_val, 4) then
        raise exception using errcode = 'invalid_parameter_value',
          message = format('sale line %s discount must be non-negative with at most 4 decimal places', line_no);
      end if;
      discount_value := v_raw_val;

      v_raw_val := coalesce(nullif(line->>'tax_rate_percent', '')::numeric, 0);
      if v_raw_val < 0 or v_raw_val > 100 or v_raw_val = 'NaN'::numeric
         or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
         or v_raw_val <> round(v_raw_val, 4) then
        raise exception using errcode = 'invalid_parameter_value',
          message = format('sale line %s tax rate must be between 0 and 100 with at most 4 decimal places', line_no);
      end if;
      tax_rate_value := v_raw_val;

      v_raw_val := coalesce(nullif(line->>'tax_amount', '')::numeric, 0);
      if v_raw_val < 0 or v_raw_val = 'NaN'::numeric
         or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
         or v_raw_val <> round(v_raw_val, 4) then
        raise exception using errcode = 'invalid_parameter_value',
          message = format('sale line %s tax amount must be non-negative with at most 4 decimal places', line_no);
      end if;
      tax_value := v_raw_val;

      line_total_value := round(quantity_value * unit_price_value, 4) - discount_value + tax_value;

      subtotal_accum := subtotal_accum + round(quantity_value * unit_price_value, 4);
      discount_accum := discount_accum + discount_value;
      tax_accum := tax_accum + tax_value;
      total_accum := total_accum + line_total_value;
    else
      -- v2 gross lines
      begin
        v_raw_val := (line->>'unit_gross_price')::numeric;
      exception when others then
        raise exception using errcode = 'invalid_parameter_value', message = format('invalid sale line %s', line_no);
      end;
      if v_raw_val is null or v_raw_val < 0 or v_raw_val = 'NaN'::numeric
         or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
         or v_raw_val <> round(v_raw_val, 4) then
        raise exception using errcode = 'invalid_parameter_value',
          message = format('sale line %s unit gross price must be non-negative with at most 4 decimal places', line_no);
      end if;
      unit_gross_value := v_raw_val;
      if unit_gross_value > 1000000000 then
        raise exception using errcode = 'invalid_parameter_value', message = 'POS amount exceeds maximum of 1000000000 ARS';
      end if;

      v_raw_val := coalesce(nullif(line->>'gross_discount_amount', '')::numeric, 0);
      if v_raw_val < 0 or v_raw_val = 'NaN'::numeric
         or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
         or v_raw_val <> round(v_raw_val, 4) then
        raise exception using errcode = 'invalid_parameter_value',
          message = format('sale line %s gross discount must be non-negative with at most 4 decimal places', line_no);
      end if;
      gross_discount_value := v_raw_val;

      v_raw_val := coalesce(nullif(line->>'tax_rate_percent', '')::numeric, 0);
      if v_raw_val < 0 or v_raw_val > 100 or v_raw_val = 'NaN'::numeric
         or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
         or v_raw_val <> round(v_raw_val, 4) then
        raise exception using errcode = 'invalid_parameter_value',
          message = format('sale line %s tax rate must be between 0 and 100 with at most 4 decimal places', line_no);
      end if;
      tax_rate_value := v_raw_val;

      begin
        v_raw_val := (line->>'net_subtotal_amount')::numeric;
      exception when others then
        raise exception using errcode = 'invalid_parameter_value', message = format('invalid sale line %s', line_no);
      end;
      if v_raw_val is null or v_raw_val < 0 or v_raw_val = 'NaN'::numeric
         or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
         or v_raw_val <> round(v_raw_val, 4) then
        raise exception using errcode = 'invalid_parameter_value',
          message = format('sale line %s net subtotal must be non-negative with at most 4 decimal places', line_no);
      end if;
      net_subtotal_value := v_raw_val;

      begin
        v_raw_val := (line->>'discount_amount')::numeric;
      exception when others then
        raise exception using errcode = 'invalid_parameter_value', message = format('invalid sale line %s', line_no);
      end;
      if v_raw_val is null or v_raw_val < 0 or v_raw_val = 'NaN'::numeric
         or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
         or v_raw_val <> round(v_raw_val, 4) then
        raise exception using errcode = 'invalid_parameter_value',
          message = format('sale line %s net discount must be non-negative with at most 4 decimal places', line_no);
      end if;
      discount_value := v_raw_val;

      begin
        v_raw_val := (line->>'tax_amount')::numeric;
      exception when others then
        raise exception using errcode = 'invalid_parameter_value', message = format('invalid sale line %s', line_no);
      end;
      if v_raw_val is null or v_raw_val < 0 or v_raw_val = 'NaN'::numeric
         or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
         or v_raw_val <> round(v_raw_val, 4) then
        raise exception using errcode = 'invalid_parameter_value',
          message = format('sale line %s tax amount must be non-negative with at most 4 decimal places', line_no);
      end if;
      tax_value := v_raw_val;

      begin
        v_raw_val := (line->>'line_total')::numeric;
      exception when others then
        raise exception using errcode = 'invalid_parameter_value', message = format('invalid sale line %s', line_no);
      end;
      if v_raw_val is null or v_raw_val < 0 or v_raw_val = 'NaN'::numeric
         or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
         or v_raw_val <> round(v_raw_val, 4) then
        raise exception using errcode = 'invalid_parameter_value',
          message = format('sale line %s line total must be non-negative with at most 4 decimal places', line_no);
      end if;
      line_total_value := v_raw_val;

      subtotal_accum := subtotal_accum + net_subtotal_value;
      discount_accum := discount_accum + discount_value;
      tax_accum := tax_accum + tax_value;
      total_accum := total_accum + line_total_value;
    end if;
  end loop;

  if total_accum < 0 then
    raise exception using errcode = 'check_violation', message = 'sale total cannot be negative';
  end if;
  if p_pricing_version = 'v2' and total_accum > 1000000000 then
    raise exception using errcode = 'invalid_parameter_value', message = 'POS total exceeds maximum of 1000000000 ARS';
  end if;

  -- Validate payments
  for payment_line in select value from jsonb_array_elements(p_payment_lines) loop
    if jsonb_typeof(payment_line) <> 'object' then
      raise exception using errcode = 'invalid_parameter_value', message = 'invalid payment line';
    end if;

    begin
      v_raw_val := (payment_line->>'amount')::numeric;
      perform (payment_line->>'payment_method_id')::uuid;
      perform nullif(payment_line->>'cash_session_id', '')::uuid;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = 'invalid payment line';
    end;

    if v_raw_val is null or v_raw_val < 0 or v_raw_val = 'NaN'::numeric
       or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
       or v_raw_val <> round(v_raw_val, 4) then
      raise exception using errcode = 'invalid_parameter_value',
        message = 'payment amount must be non-negative with at most 4 decimal places';
    end if;
    payment_total := payment_total + v_raw_val;
  end loop;

  if payment_total > total_accum then
    raise exception using errcode = 'check_violation', message = 'payments cannot exceed sale total';
  end if;
  if payment_total < total_accum and p_target_customer_id is null then
    raise exception using errcode = 'check_violation', message = 'partial sales require a customer receivable';
  end if;

  -- 8. Set operation_reason GUC for audit_operational_fact BEFORE inserting facts
  perform set_config('erp.operation_reason', p_operation_reason, true);

  -- 9. Insert sale header
  insert into erp.sales (
    organization_id, branch_id, customer_id, currency_code, exchange_snapshot_id,
    exchange_rate, idempotency_key, request_hash, reason, subtotal_amount,
    discount_amount, tax_amount, total_amount, confirmed_by, pricing_version
  ) values (
    actor_organization_id, p_target_branch_id, p_target_customer_id, upper(btrim(p_sale_currency)),
    p_target_exchange_snapshot_id, exchange_rate_value, p_operation_key, operation_hash,
    p_operation_reason, subtotal_accum, discount_accum, tax_accum, total_accum, auth.uid(),
    p_pricing_version
  ) returning id into v_core_sale_id;

  -- 10. Insert sale lines
  line_no := 0;
  for line in select value from jsonb_array_elements(p_lines) loop
    line_no := line_no + 1;
    line_kind := (line->>'kind')::erp.sale_line_kind;
    quantity_value := (line->>'quantity')::numeric;
    parsed_product_id := case when line_kind = 'free_concept' then null else (line->>'product_id')::uuid end;
    parsed_variant_id := nullif(line->>'variant_id', '')::uuid;
    parsed_inventory_unit_id := nullif(line->>'inventory_unit_id', '')::uuid;
    parsed_location_id := nullif(line->>'from_location_id', '')::uuid;

    if p_pricing_version = 'v1' then
      unit_price_value := (line->>'unit_price')::numeric;
      discount_value := coalesce(nullif(line->>'discount_amount', '')::numeric, 0);
      tax_rate_value := coalesce(nullif(line->>'tax_rate_percent', '')::numeric, 0);
      tax_value := coalesce(nullif(line->>'tax_amount', '')::numeric, 0);
      line_total_value := round(quantity_value * unit_price_value, 4) - discount_value + tax_value;

      insert into erp.sale_lines (
        organization_id, sale_id, branch_id, line_number, kind, product_id, variant_id,
        inventory_unit_id, from_location_id, description, quantity, unit_price,
        discount_amount, tax_rate_percent, tax_amount, line_total, pricing_version
      ) values (
        actor_organization_id, v_core_sale_id, p_target_branch_id, line_no, line_kind,
        parsed_product_id, parsed_variant_id, parsed_inventory_unit_id, parsed_location_id,
        coalesce(nullif(btrim(line->>'description'), ''), 'Concepto de venta'),
        quantity_value, unit_price_value, discount_value, tax_rate_value, tax_value,
        line_total_value, 'v1'
      ) returning id into line_id;

      if discount_value > 0 then
        insert into erp.sale_discount_authorizations (
          organization_id, sale_id, sale_line_id, authorized_amount, reason, authorized_by
        ) values (
          actor_organization_id, v_core_sale_id, line_id, discount_value, btrim(line->>'discount_reason'), auth.uid()
        );
      end if;
    else
      -- v2 gross line insertion
      unit_gross_value := (line->>'unit_gross_price')::numeric;
      gross_discount_value := coalesce(nullif(line->>'gross_discount_amount', '')::numeric, 0);
      tax_rate_value := coalesce(nullif(line->>'tax_rate_percent', '')::numeric, 0);
      net_subtotal_value := (line->>'net_subtotal_amount')::numeric;
      discount_value := (line->>'discount_amount')::numeric;
      tax_value := (line->>'tax_amount')::numeric;
      line_total_value := (line->>'line_total')::numeric;
      unit_price_value := round(net_subtotal_value / quantity_value, 4);

      insert into erp.sale_lines (
        organization_id, sale_id, branch_id, line_number, kind, product_id, variant_id,
        inventory_unit_id, from_location_id, description, quantity, unit_price,
        unit_gross_price, net_subtotal_amount, gross_discount_amount,
        discount_amount, tax_rate_percent, tax_amount, line_total, pricing_version
      ) values (
        actor_organization_id, v_core_sale_id, p_target_branch_id, line_no, line_kind,
        parsed_product_id, parsed_variant_id, parsed_inventory_unit_id, parsed_location_id,
        coalesce(nullif(btrim(line->>'description'), ''), 'Concepto de venta'),
        quantity_value, unit_price_value,
        unit_gross_value, net_subtotal_value, gross_discount_value,
        discount_value, tax_rate_value, tax_value, line_total_value, 'v2'
      ) returning id into line_id;

      if gross_discount_value > 0 then
        insert into erp.sale_discount_authorizations (
          organization_id, sale_id, sale_line_id, authorized_amount, reason, authorized_by
        ) values (
          actor_organization_id, v_core_sale_id, line_id, gross_discount_value, btrim(line->>'discount_reason'), auth.uid()
        );
      end if;
    end if;

    if line_kind = 'product' then
      stock_lines := stock_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'product_id', line->>'product_id',
        'variant_id', nullif(line->>'variant_id', ''),
        'inventory_unit_id', nullif(line->>'inventory_unit_id', ''),
        'from_location_id', line->>'from_location_id',
        'quantity', quantity_value
      )));
    end if;
  end loop;

  -- Stock document posting or reservation fulfillment
  if jsonb_array_length(stock_lines) > 0 then
    if p_target_reservation_batch_id is null then
      posted_stock_document_id := erp.post_stock_document(
        'sale', p_target_branch_id, p_operation_key || ':stock',
        p_operation_reason, stock_lines, false, 'sale', v_core_sale_id
      );
    else
      if not exists (
        select 1 from erp.stock_reservation_batches batch
        where batch.id = p_target_reservation_batch_id
          and batch.organization_id = actor_organization_id
          and batch.branch_id = p_target_branch_id and batch.status = 'active'
      ) or exists (
        with sale_multiset as (
          select
            (item->>'from_location_id')::uuid as location_id,
            (item->>'product_id')::uuid as product_id,
            nullif(item->>'variant_id','')::uuid as variant_id,
            nullif(item->>'inventory_unit_id','')::uuid as inventory_unit_id,
            sum((item->>'quantity')::numeric) as quantity
          from jsonb_array_elements(stock_lines) item
          group by 1, 2, 3, 4
        ), reservation_multiset as (
          select location_id, product_id, variant_id, inventory_unit_id, sum(quantity) as quantity
          from erp.stock_reservations
          where batch_id = p_target_reservation_batch_id
          group by 1, 2, 3, 4
        )
        select 1 from (
          (select * from sale_multiset except select * from reservation_multiset)
          union all
          (select * from reservation_multiset except select * from sale_multiset)
        ) mismatch
      ) then
        raise exception using errcode = 'check_violation', message = 'sale product lines do not match the active reservation';
      end if;
      posted_stock_document_id := erp.fulfill_stock_reservation(p_target_reservation_batch_id, p_operation_key || ':stock', p_operation_reason);
    end if;

    perform set_config('erp.allow_sale_stock_link', 'on', true);
    update erp.sales set stock_document_id = posted_stock_document_id where id = v_core_sale_id;
    perform set_config('erp.allow_sale_stock_link', 'off', true);
  end if;

  -- Lifecycle events
  insert into erp.sale_state_events (organization_id, sale_id, branch_id, sale_state, idempotency_key, reason, actor_id)
  values (actor_organization_id, v_core_sale_id, p_target_branch_id, 'confirmed', p_operation_key || ':sale-state', p_operation_reason, auth.uid());

  insert into erp.sale_state_events (organization_id, sale_id, branch_id, delivery_state, idempotency_key, reason, actor_id)
  values (actor_organization_id, v_core_sale_id, p_target_branch_id, 'pending', p_operation_key || ':delivery-state', p_operation_reason, auth.uid());

  -- Customer receivables and accounts
  if p_target_customer_id is not null and total_accum > 0 then
    insert into erp.customer_receivables (
      organization_id, branch_id, customer_id, sale_id, currency_code, original_amount, original_amount_base
    ) values (
      actor_organization_id, p_target_branch_id, p_target_customer_id, v_core_sale_id, upper(btrim(p_sale_currency)),
      total_accum, round(total_accum * exchange_rate_value, 4)
    ) returning id into receivable_id;

    insert into erp.customer_account_entries (
      organization_id, branch_id, customer_id, receivable_id, amount_base_delta, entry_kind, actor_id
    ) values (
      actor_organization_id, p_target_branch_id, p_target_customer_id, receivable_id,
      round(total_accum * exchange_rate_value, 4), 'sale', auth.uid()
    );
  end if;

  -- Payments processing: payment_lines [] genera evento unpaid; líneas de pago ejecutan record_sale_payment_core
  if jsonb_array_length(p_payment_lines) = 0 then
    insert into erp.sale_state_events (organization_id, sale_id, branch_id, payment_state, idempotency_key, reason, actor_id)
    values (actor_organization_id, v_core_sale_id, p_target_branch_id, 'unpaid', p_operation_key || ':payment-state', p_operation_reason, auth.uid());
  else
    line_no := 0;
    for payment_line in select value from jsonb_array_elements(p_payment_lines) loop
      line_no := line_no + 1;
      perform erp.record_sale_payment_core(
        v_core_sale_id,
        (payment_line->>'payment_method_id')::uuid,
        nullif(payment_line->>'cash_session_id', '')::uuid,
        (payment_line->>'amount')::numeric,
        p_operation_key || ':payment:' || line_no,
        p_operation_reason,
        payment_line->>'provider_reference'
      );
    end loop;
  end if;

  return v_core_sale_id;
end;
$$;

-- Strict revocation: core cannot be executed by public, anon, authenticated, or service_role
revoke all on function erp.create_sale_core(text, text, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text)
  from public, anon, authenticated, service_role;

-- ============================================================================
-- 4. Authoritative POS Wrapper: erp.create_sale_with_invoice
-- ============================================================================
-- Public POS endpoint with full server pricing authority:
-- - Validates permissions (sales.create, documents.issue).
-- - Validates JSON non-null, 1..250 lines, 0..20 payments, <= 1MiB payload.
-- - Checks raw request claim/replay BEFORE template check, catalog queries or requoting.
-- - Strictly requires ARS currency and ARS rate 1 snapshot.
-- - Locks in common deadlock-free hierarchy:
--     sucursal -> advisories productos ordenados -> filas producto/variantes ordenadas -> stock
-- - Resolves catalog effective gross price and tax rate.
-- - Asserts expected unit price and expected tax rate (exact match, no tolerance/null).
-- - Rejects free_concept lines in POS v2.
-- - Enforces finite quantities, discounts and rates with scale <= 4 BEFORE numeric(18,4) assignment.
-- - Computes exact 4-decimal gross/net/tax breakdown.
-- - Calls private core with validated v2 payload.
-- - Issues invoice document whose content_sha256 is derived strictly from PERSISTED FACTS.

create or replace function erp.create_sale_with_invoice(
  target_branch_id uuid,
  target_customer_id uuid,
  sale_currency text,
  target_exchange_snapshot_id uuid,
  operation_key text,
  operation_reason text,
  lines jsonb,
  target_invoice_kind text,
  payment_lines jsonb default '[]'::jsonb,
  target_reservation_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, erp, extensions, pg_temp
as $$
declare
  current_org_id uuid := erp.current_organization_id();
  v_cmd_row erp.stage8_commands%rowtype;
  v_template_version_id uuid;
  v_sale_id uuid;
  v_document_id uuid;
  v_document_number text;
  v_next_number bigint;
  v_existing_max numeric;
  v_customer_snapshot jsonb;
  v_document_payload jsonb;
  v_request_payload jsonb;
  v_content_sha256 text;
  v_result_invoice_kind text;
  v_rate numeric(24, 10);

  line jsonb;
  payment_line jsonb;
  line_no integer := 0;
  line_kind erp.sale_line_kind;
  parsed_product_id uuid;
  parsed_variant_id uuid;
  parsed_inventory_unit_id uuid;
  parsed_location_id uuid;
  quantity_val numeric(18, 4);
  client_expected_price numeric(18, 4);
  client_expected_tax_rate numeric(7, 4);
  v_prod record;
  v_var record;
  v_server_gross numeric(18, 4);
  v_server_tax_rate numeric(7, 4);
  v_gross_line numeric(18, 4);
  v_gross_discount numeric(18, 4);
  v_net_subtotal numeric(18, 4);
  v_net_discount numeric(18, 4);
  v_tax_amount numeric(18, 4);
  v_line_total numeric(18, 4);
  v_v2_lines jsonb := '[]'::jsonb;
  persisted_lines jsonb;
  persisted_payments jsonb;

  v_product_ids uuid[];
  v_variant_ids uuid[];
  v_raw_val numeric;
  v_raw_text text;
begin
  if current_org_id is null
    or not erp.has_permission('sales.create', target_branch_id)
    or not erp.has_permission('documents.issue', target_branch_id)
    or target_invoice_kind is null
    or target_invoice_kind not in ('fiscal', 'non_fiscal')
    or nullif(btrim(operation_key), '') is null
    or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'sales.create, documents.issue, invoice type, operation key and reason are required';
  end if;

  if lines is null or jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 or jsonb_array_length(lines) > 250 then
    raise exception using errcode = 'invalid_parameter_value', message = 'between 1 and 250 sale lines are required';
  end if;

  if payment_lines is null or jsonb_typeof(payment_lines) <> 'array' or jsonb_array_length(payment_lines) > 20 then
    raise exception using errcode = 'invalid_parameter_value', message = 'maximum of 20 payment lines allowed';
  end if;

  if pg_column_size(lines) > 1048576 or pg_column_size(payment_lines) > 1048576
     or pg_column_size(lines) + pg_column_size(payment_lines) > 1048576 then
    raise exception using errcode = 'program_limit_exceeded', message = 'request payload exceeds 1 MiB limit';
  end if;

  -- 1. Raw request payload for exact replay verification
  v_request_payload := jsonb_build_object(
    'invoice_kind', target_invoice_kind,
    'branch_id', target_branch_id,
    'customer_id', target_customer_id,
    'currency', upper(btrim(coalesce(sale_currency, ''))),
    'exchange_snapshot_id', target_exchange_snapshot_id,
    'reservation_batch_id', target_reservation_batch_id,
    'reason', operation_reason,
    'lines_sha256', encode(extensions.digest(convert_to(lines::text, 'UTF8'), 'sha256'), 'hex'),
    'payments_sha256', encode(extensions.digest(convert_to(payment_lines::text, 'UTF8'), 'sha256'), 'hex')
  );

  -- 2. Check replay BEFORE querying catalog, requoting, or verifying active templates
  begin
    v_cmd_row := erp.claim_stage8_command('pos.sale.invoice', current_org_id, target_branch_id, operation_key, v_request_payload);
  exception
    when others then
      declare
        v_claim_sqlstate text;
        v_claim_sqlerrm text;
      begin
        get stacked diagnostics
          v_claim_sqlstate = returned_sqlstate,
          v_claim_sqlerrm = message_text;
        if v_claim_sqlstate = '23000' and v_claim_sqlerrm = 'idempotency key is already used by another request' then
          raise exception using errcode = 'unique_violation', message = v_claim_sqlerrm;
        end if;
        raise;
      end;
  end;
  if v_cmd_row.result_id is not null then
    select document_row.owner_id, document_row.document_number, document_row.invoice_kind
      into v_sale_id, v_document_number, v_result_invoice_kind
      from erp.documents document_row
     where document_row.id = v_cmd_row.result_id and document_row.organization_id = current_org_id;

    if v_sale_id is null then
      raise exception using errcode = 'data_exception', message = 'completed sale invoice command has no document';
    end if;

    return jsonb_build_object(
      'sale_id', v_sale_id,
      'document_id', v_cmd_row.result_id,
      'document_number', v_document_number,
      'invoice_kind', v_result_invoice_kind
    );
  end if;

  -- 3. Strict currency and snapshot guards for new POS v2 sales
  if sale_currency is null or upper(btrim(sale_currency)) <> 'ARS' then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'pos v2 sales strictly require ARS currency';
  end if;

  select rate_to_base into v_rate
    from erp.exchange_rate_snapshots
   where id = target_exchange_snapshot_id
     and organization_id = current_org_id
     and quote_currency = 'ARS';

  if v_rate is null or v_rate <> 1 then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'pos v2 requires an active ARS exchange rate snapshot with rate 1';
  end if;

  -- 4. Active document template check
  select version_row.id into v_template_version_id
    from erp.document_template_versions version_row
    join erp.document_templates template_row
      on template_row.id = version_row.template_id
     and template_row.organization_id = version_row.organization_id
   where version_row.organization_id = current_org_id
     and template_row.document_kind = 'sale'
     and template_row.is_active
   order by version_row.version desc
   limit 1;

  if v_template_version_id is null then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'active sale document template is required';
  end if;

  -- 5. Concurrency: Lock in common deadlock-free hierarchy
  -- sucursal -> advisories productos ordenados -> filas producto/variantes ordenadas -> stock
  perform pg_advisory_xact_lock(hashtextextended(current_org_id::text || ':' || target_branch_id::text, 0));

  select array_agg(p_id order by p_id) into v_product_ids
    from (select distinct nullif(line_item->>'product_id', '')::uuid as p_id from jsonb_array_elements(lines) line_item) sub
   where p_id is not null;

  select array_agg(v_id order by v_id) into v_variant_ids
    from (select distinct nullif(line_item->>'variant_id', '')::uuid as v_id from jsonb_array_elements(lines) line_item) sub
   where v_id is not null;

  if v_product_ids is not null and array_length(v_product_ids, 1) > 0 then
    for i in 1 .. array_length(v_product_ids, 1) loop
      perform pg_advisory_xact_lock(hashtext(current_org_id::text), hashtext(v_product_ids[i]::text));
    end loop;
    perform 1 from erp.products
     where id = any(v_product_ids) and organization_id = current_org_id
     order by id
     for share;
  end if;

  if v_variant_ids is not null and array_length(v_variant_ids, 1) > 0 then
    perform 1 from erp.product_variants
     where id = any(v_variant_ids) and organization_id = current_org_id
     order by id
     for share;
  end if;

  -- 6. Authoritative server pricing and strict quote assertion
  for line in select value from jsonb_array_elements(lines) loop
    line_no := line_no + 1;
    if jsonb_typeof(line) <> 'object' then
      raise exception using errcode = 'invalid_parameter_value', message = format('invalid sale line %s', line_no);
    end if;

    begin
      line_kind := (line->>'kind')::erp.sale_line_kind;
      parsed_product_id := nullif(line->>'product_id', '')::uuid;
      parsed_variant_id := nullif(line->>'variant_id', '')::uuid;
      parsed_inventory_unit_id := nullif(line->>'inventory_unit_id', '')::uuid;
      parsed_location_id := nullif(line->>'from_location_id', '')::uuid;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = format('invalid sale line %s', line_no);
    end;

    if line_kind = 'free_concept' then
      raise exception using errcode = 'feature_not_supported',
        message = 'free_concept lines are not permitted for POS v2 sales';
    end if;

    -- Validar cantidad finita y escala <= 4 ANTES de asignación a numeric(18,4)
    begin
      v_raw_val := (line->>'quantity')::numeric;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = format('sale line %s quantity must be positive', line_no);
    end;
    if v_raw_val is null or v_raw_val <= 0 or v_raw_val = 'NaN'::numeric
       or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
       or v_raw_val <> round(v_raw_val, 4) then
      raise exception using errcode = 'invalid_parameter_value', message = format('sale line %s quantity must be positive', line_no);
    end if;
    quantity_val := v_raw_val;

    if parsed_product_id is null then
      raise exception using errcode = 'invalid_parameter_value', message = format('sale line %s requires a product', line_no);
    end if;

    select id, organization_id, base_sale_price, tax_rate_percent, is_active, can_sell, item_kind
      into v_prod
      from erp.products
     where id = parsed_product_id
       and organization_id = current_org_id
       and is_active
       and can_sell;

    if v_prod.id is null then
      raise exception using errcode = 'foreign_key_violation', message = format('sale line %s product not found or inactive', line_no);
    end if;

    if v_prod.item_kind::text <> line_kind::text then
      raise exception using errcode = 'foreign_key_violation', message = format('sale line %s catalog kind mismatch', line_no);
    end if;

    -- Require variant_id if product has active variants
    if exists (
      select 1 from erp.product_variants
       where product_id = parsed_product_id and organization_id = current_org_id and is_active
    ) and parsed_variant_id is null then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s product has variants; explicit variant_id is required', line_no);
    end if;

    if parsed_variant_id is not null then
      select id, product_id, organization_id, price_delta, final_price_ars, is_active
        into v_var
        from erp.product_variants
       where id = parsed_variant_id
         and product_id = parsed_product_id
         and organization_id = current_org_id
         and is_active;

      if v_var.id is null then
        raise exception using errcode = 'foreign_key_violation', message = format('sale line %s variant not found or inactive', line_no);
      end if;

      if v_var.final_price_ars is not null then
        v_server_gross := v_var.final_price_ars;
      else
        v_server_gross := coalesce(v_prod.base_sale_price, 0) + coalesce(v_var.price_delta, 0);
        if v_server_gross < 0 then
          raise exception using errcode = 'check_violation', message = 'inherited variant price cannot be negative';
        end if;
      end if;
    else
      v_server_gross := coalesce(v_prod.base_sale_price, 0);
      if v_server_gross < 0 then
        raise exception using errcode = 'check_violation', message = 'product base sale price cannot be negative';
      end if;
    end if;

    v_server_tax_rate := v_prod.tax_rate_percent;

    -- Expected quote validation: mandatory, NOT NULL, finite, escala <= 4, exact comparison
    v_raw_text := nullif(btrim(line->>'expected_unit_price'), '');
    if v_raw_text is null then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s missing expected quote price or tax rate', line_no);
    end if;
    begin
      v_raw_val := v_raw_text::numeric;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s missing expected quote price or tax rate', line_no);
    end;
    if v_raw_val is null or v_raw_val < 0 or v_raw_val = 'NaN'::numeric
       or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
       or v_raw_val <> round(v_raw_val, 4) then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s missing expected quote price or tax rate', line_no);
    end if;
    client_expected_price := v_raw_val;

    v_raw_text := coalesce(
      nullif(btrim(line->>'expected_tax_rate'), ''),
      nullif(btrim(line->>'tax_rate_percent'), '')
    );
    if v_raw_text is null then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s missing expected quote price or tax rate', line_no);
    end if;
    begin
      v_raw_val := v_raw_text::numeric;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s missing expected quote price or tax rate', line_no);
    end;
    if v_raw_val is null or v_raw_val < 0 or v_raw_val > 100 or v_raw_val = 'NaN'::numeric
       or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
       or v_raw_val <> round(v_raw_val, 4) then
      raise exception using errcode = 'invalid_parameter_value',
        message = format('sale line %s missing expected quote price or tax rate', line_no);
    end if;
    client_expected_tax_rate := v_raw_val;

    if client_expected_price is distinct from v_server_gross
       or client_expected_tax_rate is distinct from v_server_tax_rate then
      raise exception using errcode = 'check_violation',
        message = 'stale quote: catalog price or tax rate has changed, requote required';
    end if;

    -- Compute exact 4-decimal gross line breakdown
    v_gross_line := round(quantity_val * v_server_gross, 4);

    v_raw_text := coalesce(
      nullif(btrim(line->>'gross_discount_amount'), ''),
      nullif(btrim(line->>'discount_amount'), '')
    );
    if v_raw_text is not null then
      begin
        v_raw_val := v_raw_text::numeric;
      exception when others then
        raise exception using errcode = 'invalid_parameter_value', message = 'discount must be non-negative';
      end;
      if v_raw_val is null or v_raw_val < 0 or v_raw_val = 'NaN'::numeric
         or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
         or v_raw_val <> round(v_raw_val, 4) then
        raise exception using errcode = 'invalid_parameter_value', message = 'discount must be non-negative';
      end if;
      v_gross_discount := v_raw_val;
    else
      v_gross_discount := 0;
    end if;

    if v_gross_discount > v_gross_line then
      raise exception using errcode = 'check_violation', message = 'discount cannot exceed line subtotal';
    end if;

    if v_gross_discount > 0 and (
      not erp.has_permission('sales.discount', target_branch_id)
      or nullif(btrim(line->>'discount_reason'), '') is null
    ) then
      raise exception using errcode = 'insufficient_privilege', message = 'discount requires sales.discount and an explicit reason';
    end if;

    v_line_total := v_gross_line - v_gross_discount;
    v_net_subtotal := round(v_gross_line / (1 + v_server_tax_rate / 100), 4);
    v_net_discount := round(v_gross_discount / (1 + v_server_tax_rate / 100), 4);
    v_tax_amount := v_line_total - (v_net_subtotal - v_net_discount);

    v_v2_lines := v_v2_lines || jsonb_build_array(jsonb_build_object(
      'kind', line_kind::text,
      'product_id', parsed_product_id,
      'variant_id', parsed_variant_id,
      'inventory_unit_id', parsed_inventory_unit_id,
      'from_location_id', parsed_location_id,
      'description', coalesce(nullif(btrim(line->>'description'), ''), 'Venta mostrador'),
      'quantity', quantity_val,
      'unit_gross_price', v_server_gross,
      'gross_discount_amount', v_gross_discount,
      'tax_rate_percent', v_server_tax_rate,
      'net_subtotal_amount', v_net_subtotal,
      'discount_amount', v_net_discount,
      'tax_amount', v_tax_amount,
      'line_total', v_line_total,
      'discount_reason', line->>'discount_reason'
    ));
  end loop;

  -- Validate payment lines in wrapper
  for payment_line in select value from jsonb_array_elements(payment_lines) loop
    if jsonb_typeof(payment_line) <> 'object' then
      raise exception using errcode = 'invalid_parameter_value', message = 'invalid payment line';
    end if;

    begin
      v_raw_val := (payment_line->>'amount')::numeric;
      perform (payment_line->>'payment_method_id')::uuid;
      perform nullif(payment_line->>'cash_session_id', '')::uuid;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = 'invalid payment line';
    end;

    if v_raw_val is null or v_raw_val < 0 or v_raw_val = 'NaN'::numeric
       or v_raw_val = 'Infinity'::numeric or v_raw_val = '-Infinity'::numeric
       or v_raw_val <> round(v_raw_val, 4) then
      raise exception using errcode = 'invalid_parameter_value',
        message = 'payment amount must be non-negative with at most 4 decimal places';
    end if;
  end loop;

  -- 7. Call private core with validated v2 origin and lines
  v_sale_id := erp.create_sale_core(
    'pos_v2',
    'v2',
    target_branch_id,
    target_customer_id,
    sale_currency,
    target_exchange_snapshot_id,
    operation_key,
    operation_reason,
    v_v2_lines,
    payment_lines,
    target_reservation_batch_id,
    v_cmd_row.request_hash
  );

  -- 8. Customer snapshot for invoice document
  if target_customer_id is null then
    v_customer_snapshot := jsonb_build_object('customer_id', null, 'display_name', 'Consumidor Final', 'kind', 'individual');
  else
    select jsonb_build_object(
      'customer_id', customer_row.id,
      'display_name', customer_row.display_name,
      'legal_name', customer_row.legal_name,
      'kind', customer_row.kind::text,
      'email', customer_row.email,
      'phone', customer_row.phone,
      'whatsapp_phone', customer_row.whatsapp_phone
    ) into v_customer_snapshot
    from erp.customers customer_row
    where customer_row.id = target_customer_id
      and customer_row.organization_id = current_org_id
      and customer_row.is_active;
    if v_customer_snapshot is null then
      raise exception using errcode = 'foreign_key_violation', message = 'active sale customer is required for the invoice';
    end if;
  end if;

  -- 9. Sequential invoice number
  select coalesce(max(case target_invoice_kind
    when 'fiscal' then substring(document_row.document_number from 3)::numeric
    else substring(document_row.document_number from 4)::numeric
  end), 0) into v_existing_max
  from erp.documents document_row
  where document_row.organization_id = current_org_id
    and document_row.branch_id = target_branch_id
    and document_row.document_number ~ (case target_invoice_kind
      when 'fiscal' then '^F-[0-9]{1,19}$' else '^NF-[0-9]{1,19}$' end);

  if v_existing_max >= 9223372036854775807 then
    raise exception using errcode = 'numeric_value_out_of_range', message = 'local invoice sequence is exhausted';
  end if;

  insert into erp.document_counters(organization_id, branch_id, invoice_kind, last_number)
  values (current_org_id, target_branch_id, target_invoice_kind, v_existing_max::bigint + 1)
  on conflict (organization_id, branch_id, invoice_kind)
  do update set last_number = greatest(erp.document_counters.last_number, v_existing_max::bigint) + 1
  returning last_number into v_next_number;

  v_document_number := (case target_invoice_kind when 'fiscal' then 'F-' else 'NF-' end)
    || case when length(v_next_number::text) < 8 then lpad(v_next_number::text, 8, '0') else v_next_number::text end;

  -- 10. Document content hash strictly sealed from PERSISTED database facts
  select jsonb_agg(jsonb_build_object(
    'line_number', line_row.line_number,
    'kind', line_row.kind::text,
    'product_id', line_row.product_id,
    'variant_id', line_row.variant_id,
    'description', line_row.description,
    'quantity', line_row.quantity,
    'unit_price', line_row.unit_price,
    'unit_gross_price', line_row.unit_gross_price,
    'net_subtotal_amount', line_row.net_subtotal_amount,
    'gross_discount_amount', line_row.gross_discount_amount,
    'discount_amount', line_row.discount_amount,
    'tax_rate_percent', line_row.tax_rate_percent,
    'tax_amount', line_row.tax_amount,
    'line_total', line_row.line_total,
    'pricing_version', line_row.pricing_version
  ) order by line_row.line_number)
  into persisted_lines
  from erp.sale_lines line_row
  where line_row.sale_id = v_sale_id
    and line_row.organization_id = current_org_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'payment_method_id', pay_row.payment_method_id,
    'amount', pay_row.amount,
    'currency_code', pay_row.currency_code
  ) order by pay_row.id), '[]'::jsonb)
  into persisted_payments
  from erp.payments pay_row
  where pay_row.sale_id = v_sale_id
    and pay_row.organization_id = current_org_id;

  v_document_payload := jsonb_build_object(
    'sale_id', v_sale_id,
    'branch_id', target_branch_id,
    'invoice_kind', target_invoice_kind,
    'pricing_version', 'v2',
    'customer', v_customer_snapshot,
    'lines', persisted_lines,
    'payment_lines', persisted_payments,
    'reason', operation_reason
  );
  v_content_sha256 := encode(extensions.digest(convert_to(v_document_payload::text, 'UTF8'), 'sha256'), 'hex');

  v_document_id := erp.issue_invoice_document(
    target_branch_id, v_template_version_id, v_sale_id,
    target_invoice_kind, v_document_number, v_customer_snapshot, v_content_sha256,
    operation_key || ':invoice-document', operation_reason
  );

  perform erp.complete_stage8_command(v_cmd_row.id, v_document_id);

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'document_id', v_document_id,
    'document_number', v_document_number,
    'invoice_kind', target_invoice_kind
  );
end;
$$;

revoke all on function erp.create_sale_with_invoice(uuid, uuid, text, uuid, text, text, jsonb, text, jsonb, uuid)
  from public, anon, service_role;
grant execute on function erp.create_sale_with_invoice(uuid, uuid, text, uuid, text, text, jsonb, text, jsonb, uuid)
  to authenticated;

-- ============================================================================
-- 5. Legacy create_sale Wrapper: Replay Only, No Bypass for New Sales
-- ============================================================================
-- Preserves idempotent replay for existing sales.
-- Completely closes public/authenticated bypass: cannot be used to forge arbitrary prices on new sales.

create or replace function erp.create_sale(
  target_branch_id uuid,
  target_customer_id uuid,
  sale_currency text,
  target_exchange_snapshot_id uuid,
  operation_key text,
  operation_reason text,
  lines jsonb,
  payment_lines jsonb default '[]'::jsonb,
  target_reservation_batch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  v_sale_id uuid;
  operation_hash text;
begin
  if actor_organization_id is null or not erp.has_permission('sales.create', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'sales.create permission is required';
  end if;

  operation_hash := md5(jsonb_build_object(
    'branch_id', target_branch_id,
    'customer_id', target_customer_id,
    'currency', upper(btrim(coalesce(sale_currency, ''))),
    'snapshot_id', target_exchange_snapshot_id,
    'reason', operation_reason,
    'lines', lines,
    'payments', payment_lines,
    'reservation_id', target_reservation_batch_id
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':' || target_branch_id::text, 0));

  select s.id into v_sale_id
    from erp.sales s
   where s.organization_id = actor_organization_id
     and s.branch_id = target_branch_id
     and s.idempotency_key = operation_key;

  if v_sale_id is not null then
    if exists (
      select 1 from erp.sales s where s.id = v_sale_id and s.request_hash = operation_hash
    ) then
      return v_sale_id;
    else
      raise exception using errcode = 'unique_violation',
        message = 'idempotency key is already used by another request';
    end if;
  end if;

  -- Block any attempt to bypass server pricing authority for new sales
  raise exception using errcode = 'feature_not_supported',
    message = 'direct legacy create_sale is deprecated for new sales; use create_sale_with_invoice with server-authoritative pricing';
end;
$$;

revoke all on function erp.create_sale(uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid) from public, anon, service_role;
grant execute on function erp.create_sale(uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid) to authenticated;

-- ============================================================================
-- 6. fulfill_web_order: Latest Definition (20260916006000) with Core Integration (Fix 6)
-- ============================================================================
-- Requires current_delivery_state = 'ready'.
-- Emits BOTH web_order.fulfilled AND web_order.delivery.dispatched outbox events.
-- Consumes paid snapshot via core without live requoting.

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

  -- Consume immutable snapshot from web_order_lines without requoting live catalog
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

  payment_lines := jsonb_build_array(jsonb_build_object(
    'payment_method_id', approved_event.payment_method_id,
    'amount', approved_event.amount,
    'provider_reference', approved_event.provider_payment_id
  ));

  v_sale_id := erp.create_sale_core(
    'web_order',
    'v1',
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
-- 7. Document Sale Receipt Readback: Latest (20260923001208) with Null v2 Columns (Fix 7)
-- ============================================================================

create or replace function erp.get_document_sale_receipts(target_document_ids uuid[])
returns table(document_id uuid, receipt jsonb)
language sql
stable
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
  select d.id,
    jsonb_build_object(
      'sale_id', s.id,
      'document_id', d.id,
      'document_number', d.document_number,
      'branch_name', branch_row.name,
      'invoice_kind', d.invoice_kind,
      'pricing_version', s.pricing_version,
      'customer_display_name', coalesce(nullif(btrim(c.display_name), ''), nullif(btrim(d.customer_snapshot->>'display_name'), ''), 'Consumidor Final'),
      'customer_legal_name', coalesce(nullif(btrim(c.legal_name), ''), nullif(btrim(d.customer_snapshot->>'legal_name'), ''), nullif(btrim(c.display_name), ''), nullif(btrim(d.customer_snapshot->>'display_name'), ''), 'Consumidor Final'),
      'currency_code', s.currency_code,
      'exchange_rate', s.exchange_rate,
      'subtotal_amount', s.subtotal_amount,
      'discount_amount', s.discount_amount,
      'tax_amount', s.tax_amount,
      'total_amount', s.total_amount,
      'total_ars', case when upper(s.currency_code) = 'ARS' then s.total_amount else s.total_amount * s.exchange_rate end,
      'confirmed_at', s.confirmed_at,
      'document_status', latest_document_event.status,
      'sale_state', (
        select state_event.sale_state::text
        from erp.sale_state_events state_event
        where state_event.sale_id = s.id
          and state_event.organization_id = s.organization_id
          and state_event.branch_id = s.branch_id
          and state_event.sale_state is not null
        order by state_event.event_sequence desc
        limit 1
      ),
      'payment_state', (
        select state_event.payment_state::text
        from erp.sale_state_events state_event
        where state_event.sale_id = s.id
          and state_event.organization_id = s.organization_id
          and state_event.branch_id = s.branch_id
          and state_event.payment_state is not null
        order by state_event.event_sequence desc
        limit 1
      ),
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'description', line.description,
          'quantity', line.quantity,
          'unit_price', line.unit_price,
          'unit_gross_price', case when line.pricing_version = 'v2' then line.unit_gross_price else null end,
          'net_subtotal_amount', case when line.pricing_version = 'v2' then line.net_subtotal_amount else null end,
          'gross_discount_amount', case when line.pricing_version = 'v2' then line.gross_discount_amount else null end,
          'discount_amount', line.discount_amount,
          'tax_rate_percent', line.tax_rate_percent,
          'tax_amount', line.tax_amount,
          'line_total', line.line_total,
          'pricing_version', line.pricing_version
        ) order by line.line_number)
        from erp.sale_lines line
        where line.sale_id = s.id
          and line.organization_id = s.organization_id
          and line.branch_id = s.branch_id
      ), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'method_name', payment_method.name,
          'amount', payment_row.amount,
          'currency_code', payment_row.currency_code,
          'occurred_at', payment_row.occurred_at,
          'reversed', exists (
            select 1
            from erp.payments reversal_row
            where reversal_row.reversal_of_payment_id = payment_row.id
              and reversal_row.organization_id = payment_row.organization_id
          )
        ) order by payment_row.occurred_at, payment_row.id)
        from erp.payments payment_row
        join erp.payment_methods payment_method
          on payment_method.id = payment_row.payment_method_id
         and payment_method.organization_id = payment_row.organization_id
        where payment_row.sale_id = s.id
          and payment_row.organization_id = s.organization_id
          and payment_row.branch_id = s.branch_id
          and payment_row.reversal_of_payment_id is null
      ), '[]'::jsonb)
    )
  from erp.documents d
  join erp.sales s
    on s.id = d.owner_id
   and s.organization_id = d.organization_id
   and s.branch_id = d.branch_id
  left join erp.customers c
    on c.id = s.customer_id
   and c.organization_id = s.organization_id
  join erp.branches branch_row
    on branch_row.id = s.branch_id
   and branch_row.organization_id = s.organization_id
  left join lateral (
    select event_row.status
    from erp.document_events event_row
    where event_row.document_id = d.id
      and event_row.organization_id = d.organization_id
      and event_row.branch_id = d.branch_id
    order by event_row.event_sequence desc
    limit 1
  ) latest_document_event on true
  where d.id = any(coalesce(target_document_ids, '{}'::uuid[]))
    and d.organization_id = erp.current_organization_id()
    and d.owner_type = 'sale'
    and d.invoice_kind in ('fiscal', 'non_fiscal')
    and erp.has_permission('documents.view', d.branch_id);
$$;

revoke all on function erp.get_document_sale_receipts(uuid[]) from public, anon, service_role;
grant execute on function erp.get_document_sale_receipts(uuid[]) to authenticated;

commit;
