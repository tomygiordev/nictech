-- Quote the visible catalog in one request, without exposing the promotion tables.
create or replace function erp.quote_pos_catalog_prices(p_product_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, erp, pg_temp
as $$
declare
  v_org uuid := erp.current_organization_id();
  v_at timestamptz := statement_timestamp();
begin
  if auth.uid() is null or v_org is null or not (
    erp.has_permission('sales.create') or exists (
      select 1 from erp.branches b
      where b.organization_id = v_org and b.is_active and erp.has_permission('sales.create', b.id)
    )
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'sales.create permission required';
  end if;

  if p_product_ids is null or cardinality(p_product_ids) > 1000 then
    raise exception using errcode = 'invalid_parameter_value', message = 'up to 1000 product IDs are required';
  end if;

  return (
    select coalesce(jsonb_agg(erp.resolve_catalog_price_for_channel(v_org, p.id, v.id, v_at, 'pos')), '[]'::jsonb)
    from erp.products p
    cross join lateral (
      select null::uuid as id
      union all
      select variant.id
      from erp.product_variants variant
      where variant.organization_id = v_org and variant.product_id = p.id and variant.is_active
    ) v
    where p.organization_id = v_org and p.id = any(p_product_ids) and p.is_active and p.can_sell
  );
end;
$$;

revoke all on function erp.quote_pos_catalog_prices(uuid[]) from public, anon, service_role;
grant execute on function erp.quote_pos_catalog_prices(uuid[]) to authenticated;

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
  v_price jsonb;
  v_price_at timestamptz;
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

  -- Replays above keep the original amount, even after a promotion expires.
  v_price_at := clock_timestamp();
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

    select id, item_kind
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

    if parsed_variant_id is not null and not exists (
      select 1 from erp.product_variants
       where id = parsed_variant_id
         and product_id = parsed_product_id
         and organization_id = current_org_id
         and is_active
    ) then
      raise exception using errcode = 'foreign_key_violation', message = format('sale line %s variant not found or inactive', line_no);
    end if;

    v_price := erp.resolve_catalog_price_for_channel(
      current_org_id, parsed_product_id, parsed_variant_id, v_price_at, 'pos'
    );
    v_server_gross := (v_price->>'final_price_ars')::numeric;
    v_server_tax_rate := (v_price->>'tax_rate_percent')::numeric;

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
