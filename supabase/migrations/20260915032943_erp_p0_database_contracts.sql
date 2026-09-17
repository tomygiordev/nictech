-- ERP release blockers: database contracts required by POS, catalog and sales flows.
set search_path = erp, pg_catalog, pg_temp;

-- POS operators may reuse/create the identity snapshot for the organization's base
-- currency. Capturing or selecting a non-base quote remains pricing.manage only.
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
  if organization_id_value is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'an active organization is required';
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

  if quote_currency_value = base_currency_value then
    if not (
      erp.has_permission('pricing.manage')
      or erp.has_permission('sales.create')
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'sales.create or pricing.manage permission is required for the base currency snapshot';
    end if;
  elsif not erp.has_permission('pricing.manage') then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'pricing.manage permission is required for non-base currency snapshots';
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

-- Keep raw serial/IMEI columns out of general stock reads. POS receives only
-- available units in branches where the actor can both sell and view stock.
revoke select (serial_number, imei) on erp.inventory_units from authenticated;

create or replace function erp.list_available_inventory_units_for_pos()
returns table (
  id uuid,
  product_id uuid,
  variant_id uuid,
  current_location_id uuid,
  serial_number text,
  imei text
)
language plpgsql
stable
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  organization_id_value uuid := erp.current_organization_id();
begin
  if organization_id_value is null or auth.uid() is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'an authenticated ERP organization is required';
  end if;

  return query
  select
    unit.id,
    unit.product_id,
    unit.variant_id,
    unit.current_location_id,
    unit.serial_number,
    unit.imei
  from erp.inventory_units unit
  join erp.locations location
    on location.id = unit.current_location_id
   and location.organization_id = unit.organization_id
  where unit.organization_id = organization_id_value
    and unit.is_active
    and unit.status = 'available'
    and location.is_active
    and erp.has_permission('sales.create', location.branch_id)
    and erp.has_permission('stock.view', location.branch_id)
  order by unit.product_id, unit.variant_id, unit.id;
end;
$$;

revoke all on function erp.list_available_inventory_units_for_pos()
  from public, anon, service_role;
grant execute on function erp.list_available_inventory_units_for_pos()
  to authenticated;

-- SKU is represented by the canonical `internal` identifier kind. The enum does
-- not contain a `sku` value, so never cast user JSON to that nonexistent label.
create or replace function erp.create_catalog_product_with_variants(
  p_internal_code text,
  p_internal_name text,
  p_item_kind erp.catalog_item_kind default 'product',
  p_inventory_tracking erp.inventory_tracking_mode default 'quantity',
  p_category_id uuid default null,
  p_brand_id uuid default null,
  p_model_id uuid default null,
  p_unit_id uuid default null,
  p_base_cost numeric default 0,
  p_base_sale_price numeric default 0,
  p_tax_rate_percent numeric default 21,
  p_variants jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  target_unit_id uuid := p_unit_id;
  target_type_id uuid;
  new_product_id uuid;
  variant_item jsonb;
  var_code text;
  var_name text;
  var_attrs jsonb;
  var_price_delta numeric;
  var_barcode text;
  var_sku text;
  new_var_id uuid;
  created_variants jsonb := '[]'::jsonb;
begin
  if org_id is null or not erp.has_permission('catalog.manage') then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog.manage permission is required';
  end if;

  if nullif(btrim(p_internal_code), '') is null or nullif(btrim(p_internal_name), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'product code and name are required';
  end if;

  if target_unit_id is null then
    select id into target_unit_id
      from erp.units_of_measure
     where organization_id = org_id and is_active
     order by created_at asc limit 1;
    if target_unit_id is null then
      raise exception using errcode = 'foreign_key_violation', message = 'no active unit of measure found';
    end if;
  end if;

  select id into target_type_id
    from erp.product_types
   where organization_id = org_id and item_kind = p_item_kind and is_active
   order by created_at asc limit 1;
  if target_type_id is null then
    raise exception using errcode = 'foreign_key_violation', message = 'no active product type found for item kind';
  end if;

  insert into erp.products (
    organization_id, product_type_id, item_kind, category_id, brand_id, model_id,
    unit_id, internal_code, internal_name, public_name, inventory_tracking,
    base_cost, base_sale_price, tax_rate_percent, can_sell,
    can_use_as_repair_part, publish_on_web, allow_online_sale, is_active, created_by
  ) values (
    org_id, target_type_id, p_item_kind, p_category_id, p_brand_id, p_model_id,
    target_unit_id, btrim(p_internal_code), btrim(p_internal_name),
    btrim(p_internal_name), p_inventory_tracking, coalesce(p_base_cost, 0),
    coalesce(p_base_sale_price, 0), coalesce(p_tax_rate_percent, 21),
    true, true, true, true, true, auth.uid()
  ) returning id into new_product_id;

  if p_variants is not null and jsonb_typeof(p_variants) = 'array' then
    for variant_item in select value from jsonb_array_elements(p_variants) loop
      var_code := btrim(variant_item->>'code');
      var_name := btrim(variant_item->>'name');
      var_attrs := coalesce(variant_item->'attributes', '{}'::jsonb);
      var_price_delta := coalesce((variant_item->>'price_delta')::numeric, 0);
      var_barcode := nullif(btrim(variant_item->>'barcode'), '');
      var_sku := nullif(btrim(variant_item->>'sku'), '');

      insert into erp.product_variants (
        organization_id, product_id, code, name, attributes, price_delta, is_active
      ) values (
        org_id, new_product_id, var_code, var_name, var_attrs, var_price_delta, true
      ) returning id into new_var_id;

      if var_barcode is not null then
        insert into erp.product_identifiers (
          organization_id, product_id, variant_id, kind, value,
          is_primary, is_active, created_by
        ) values (
          org_id, new_product_id, new_var_id, 'barcode', var_barcode,
          true, true, auth.uid()
        );
      end if;

      if var_sku is not null then
        insert into erp.product_identifiers (
          organization_id, product_id, variant_id, kind, value,
          is_primary, is_active, created_by
        ) values (
          org_id, new_product_id, new_var_id, 'internal', var_sku,
          false, true, auth.uid()
        );
      end if;

      created_variants := created_variants || jsonb_build_object(
        'id', new_var_id,
        'code', var_code,
        'name', var_name,
        'barcode', var_barcode,
        'sku', var_sku
      );
    end loop;
  end if;

  return jsonb_build_object(
    'product_id', new_product_id,
    'internal_code', btrim(p_internal_code),
    'internal_name', btrim(p_internal_name),
    'variants', created_variants
  );
end;
$$;

revoke all on function erp.create_catalog_product_with_variants(
  text, text, erp.catalog_item_kind, erp.inventory_tracking_mode,
  uuid, uuid, uuid, uuid, numeric, numeric, numeric, jsonb
) from public, anon;
grant execute on function erp.create_catalog_product_with_variants(
  text, text, erp.catalog_item_kind, erp.inventory_tracking_mode,
  uuid, uuid, uuid, uuid, numeric, numeric, numeric, jsonb
) to authenticated, service_role;

-- These three routines are large audited commands. Preserve their complete
-- current definitions and apply only the release-blocking token/name fixes.
do $migration$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef(
    'erp.process_mercadopago_payment(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,numeric,text,text,jsonb,jsonb,timestamptz,jsonb)'::regprocedure
  ) into function_definition;
  corrected_definition := replace(
    function_definition,
    'product_tracking = ''serialized''',
    'product_tracking = ''serial'''
  );
  if corrected_definition = function_definition then
    raise exception 'process_mercadopago_payment serialized enum comparison was not found';
  end if;
  execute corrected_definition;
end;
$migration$;

-- Fulfillment is an authorized business command: a sales operator must not also
-- receive the generic accounting.post capability. This private helper derives
-- every accounting value from the fulfilled order and cannot be called by API roles.
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
     or auth.uid() is null
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

  period_id_value := erp.ensure_open_period(target_entry_date, org_id);

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
      'credit', entry_amount
    )
  );

  return entry_id_value;
end;
$$;

revoke all on function erp.post_online_order_accounting_internal(
  uuid, date, text, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;

do $migration$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef(
    'erp.fulfill_online_order(uuid,text,text,text)'::regprocedure
  ) into function_definition;
  corrected_definition := replace(
    function_definition,
    'journal_id := erp.post_erp_source_event(',
    'journal_id := erp.post_online_order_accounting_internal('
  );
  if corrected_definition = function_definition then
    raise exception 'fulfill_online_order accounting call was not found';
  end if;
  execute corrected_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef(
    'erp.apply_trade_in_sale_payment(uuid,uuid,numeric,text,text)'::regprocedure
  ) into function_definition;
  corrected_definition := replace(function_definition, 'payment_id uuid; event_id uuid;', 'v_payment_id uuid; event_id uuid;');
  corrected_definition := replace(
    corrected_definition,
    'return (select payment_id from erp.trade_in_sale_payment_events where id=cmd.result_id);',
    'return (select payment_event.payment_id from erp.trade_in_sale_payment_events payment_event where payment_event.id=cmd.result_id);'
  );
  corrected_definition := replace(corrected_definition, 'payment_id:=erp.record_sale_payment', 'v_payment_id:=erp.record_sale_payment');
  corrected_definition := replace(
    corrected_definition,
    'values(org_id,trade.branch_id,trade.id,target_sale_id,payment_id,''applied''',
    'values(org_id,trade.branch_id,trade.id,target_sale_id,v_payment_id,''applied'''
  );
  corrected_definition := replace(corrected_definition, 'return payment_id;', 'return v_payment_id;');
  if corrected_definition = function_definition
     or corrected_definition like '%; payment_id uuid; event_id uuid;%'
     or corrected_definition like '%return (select payment_id from erp.trade_in_sale_payment_events%' then
    raise exception 'apply_trade_in_sale_payment ambiguity fix did not converge';
  end if;
  execute corrected_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef(
    'erp.complete_pc_build(uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure
  ) into function_definition;
  corrected_definition := replace(function_definition, 'equipment_id uuid; v_completion_id uuid;', 'v_equipment_id uuid; v_completion_id uuid;');
  corrected_definition := replace(
    corrected_definition,
    'return (select equipment_id from erp.pc_build_completions where id=cmd.result_id);',
    'return (select completion.equipment_id from erp.pc_build_completions completion where completion.id=cmd.result_id);'
  );
  corrected_definition := replace(corrected_definition, 'returning id into equipment_id;', 'returning id into v_equipment_id;');
  corrected_definition := replace(
    corrected_definition,
    'values(org_id,equipment_id,project.customer_id,operation_reason,auth.uid())',
    'values(org_id,v_equipment_id,project.customer_id,operation_reason,auth.uid())'
  );
  corrected_definition := replace(
    corrected_definition,
    'values(org_id,project.branch_id,project.id,rev.id,target_reservation_batch_id,stock_id,equipment_id,auth.uid())',
    'values(org_id,project.branch_id,project.id,rev.id,target_reservation_batch_id,stock_id,v_equipment_id,auth.uid())'
  );
  corrected_definition := replace(corrected_definition, 'return equipment_id;', 'return v_equipment_id;');
  if corrected_definition = function_definition
     or corrected_definition like '%; equipment_id uuid; v_completion_id uuid;%'
     or corrected_definition like '%return (select equipment_id from erp.pc_build_completions%' then
    raise exception 'complete_pc_build ambiguity fix did not converge';
  end if;
  execute corrected_definition;
end;
$migration$;
