-- Reprint locally classified POS invoices from authoritative sale data.
-- ARCA/provider authorization remains a separate future workflow.

begin;

-- No PDF is persisted yet. Never claim that a canonical object exists.
create or replace function erp.issue_document(
  target_branch_id uuid,
  target_template_version_id uuid,
  owner_type text,
  owner_id uuid,
  document_number text,
  customer_snapshot jsonb,
  content_sha256 text,
  private_object_path text,
  operation_key text,
  operation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, erp
as $$
declare
  org_id uuid := erp.current_organization_id();
  cmd erp.stage8_commands%rowtype;
  result_id uuid := gen_random_uuid();
  template_kind text;
begin
  if org_id is null or not erp.has_permission('documents.issue', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'documents.issue permission is required';
  end if;
  if owner_type not in ('sale','payment','repair','warranty','pc_build','trade_in')
    or nullif(btrim(document_number), '') is null
    or customer_snapshot is null
    or jsonb_typeof(customer_snapshot) <> 'object'
    or pg_column_size(customer_snapshot) > 524288
    or content_sha256 !~ '^[0-9a-f]{64}$'
    or private_object_path is not null
    or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'bounded customer-safe document data and reason are required; a stored PDF is not available';
  end if;
  if erp.stage8_json_has_forbidden_key(
    customer_snapshot,
    array['internal_notes','credentials','credential','costs','cost','unit_cost','base_cost','private_object_path','provider_payload','audit','imei','serial_number']
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'customer document snapshot contains internal fields';
  end if;
  select template_row.document_kind into template_kind
  from erp.document_template_versions version_row
  join erp.document_templates template_row
    on template_row.id = version_row.template_id
   and template_row.organization_id = version_row.organization_id
  where version_row.id = target_template_version_id
    and version_row.organization_id = org_id
    and template_row.is_active;
  if template_kind is distinct from owner_type then
    raise exception using errcode = 'foreign_key_violation', message = 'active matching document template is required';
  end if;
  if not (case owner_type
    when 'sale' then exists(select 1 from erp.sales x where x.id = owner_id and x.organization_id = org_id and x.branch_id = target_branch_id)
    when 'payment' then exists(select 1 from erp.payments x where x.id = owner_id and x.organization_id = org_id and x.branch_id = target_branch_id)
    when 'repair' then exists(select 1 from erp.repair_orders x where x.id = owner_id and x.organization_id = org_id and x.branch_id = target_branch_id)
    when 'warranty' then exists(select 1 from erp.repair_warranties x where x.id = owner_id and x.organization_id = org_id and x.branch_id = target_branch_id)
    when 'pc_build' then exists(select 1 from erp.pc_build_completions x where x.id = owner_id and x.organization_id = org_id and x.branch_id = target_branch_id)
    when 'trade_in' then exists(select 1 from erp.trade_in_releases x where x.id = owner_id and x.organization_id = org_id and x.branch_id = target_branch_id)
    else false end) then
    raise exception using errcode = 'foreign_key_violation', message = 'document owner is invalid';
  end if;

  perform set_config('erp.operation_reason', operation_reason, true);
  cmd := erp.claim_stage8_command(
    'document.issue', org_id, target_branch_id, operation_key,
    jsonb_build_object('template', target_template_version_id, 'owner_type', owner_type,
      'owner_id', owner_id, 'number', document_number, 'snapshot', customer_snapshot,
      'digest', content_sha256, 'path', null, 'reason', operation_reason)
  );
  if cmd.result_id is not null then return cmd.result_id; end if;

  insert into erp.documents(
    id, organization_id, branch_id, template_version_id, owner_type, owner_id,
    document_number, customer_snapshot, content_sha256, private_object_path, issued_by
  ) values (
    result_id, org_id, target_branch_id, target_template_version_id, owner_type, owner_id,
    btrim(document_number), customer_snapshot, content_sha256, null, auth.uid()
  );
  insert into erp.document_events(organization_id, branch_id, document_id, status, reason, actor_id)
  values (org_id, target_branch_id, result_id, 'issued', operation_reason, auth.uid());
  perform erp.complete_stage8_command(cmd.id, result_id);
  return result_id;
end;
$$;

create or replace function erp.issue_invoice_document(
  target_branch_id uuid,
  target_template_version_id uuid,
  target_owner_id uuid,
  target_invoice_kind text,
  document_number text,
  customer_snapshot jsonb,
  content_sha256 text,
  operation_key text,
  operation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, erp, extensions
as $$
declare
  org_id uuid := erp.current_organization_id();
  command_row erp.stage8_commands%rowtype;
  result_id uuid := gen_random_uuid();
  template_kind text;
begin
  if org_id is null
    or not erp.has_permission('documents.issue', target_branch_id)
    or target_invoice_kind is null
    or target_invoice_kind not in ('fiscal', 'non_fiscal')
    or nullif(btrim(document_number), '') is null
    or customer_snapshot is null
    or jsonb_typeof(customer_snapshot) <> 'object'
    or pg_column_size(customer_snapshot) > 524288
    or content_sha256 !~ '^[0-9a-f]{64}$'
    or nullif(btrim(operation_key), '') is null
    or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'bounded invoice data, type, permission and reason are required';
  end if;
  if erp.stage8_json_has_forbidden_key(
    customer_snapshot,
    array['internal_notes','credentials','credential','costs','cost','unit_cost','base_cost','private_object_path','provider_payload','audit','imei','serial_number']
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'invoice snapshot contains internal fields';
  end if;
  select template_row.document_kind into template_kind
  from erp.document_template_versions version_row
  join erp.document_templates template_row
    on template_row.id = version_row.template_id
   and template_row.organization_id = version_row.organization_id
  where version_row.id = target_template_version_id
    and version_row.organization_id = org_id
    and template_row.is_active;
  if template_kind is distinct from 'sale'
    or not exists (
      select 1 from erp.sales sale_row
      where sale_row.id = target_owner_id
        and sale_row.organization_id = org_id
        and sale_row.branch_id = target_branch_id
    ) then
    raise exception using errcode = 'foreign_key_violation', message = 'active sale template and owner are required';
  end if;

  perform set_config('erp.operation_reason', operation_reason, true);
  command_row := erp.claim_stage8_command(
    'document.issue.invoice', org_id, target_branch_id, operation_key,
    jsonb_build_object('template', target_template_version_id, 'owner_id', target_owner_id,
      'invoice_kind', target_invoice_kind, 'number', document_number,
      'snapshot', customer_snapshot, 'digest', content_sha256, 'reason', operation_reason)
  );
  if command_row.result_id is not null then return command_row.result_id; end if;

  insert into erp.documents(
    id, organization_id, branch_id, template_version_id, owner_type, owner_id,
    document_number, invoice_kind, customer_snapshot, content_sha256,
    private_object_path, issued_by
  ) values (
    result_id, org_id, target_branch_id, target_template_version_id, 'sale', target_owner_id,
    btrim(document_number), target_invoice_kind, customer_snapshot, content_sha256,
    null, auth.uid()
  );
  insert into erp.document_events(organization_id, branch_id, document_id, status, reason, actor_id)
  values (org_id, target_branch_id, result_id, 'issued', operation_reason, auth.uid());
  perform erp.complete_stage8_command(command_row.id, result_id);
  return result_id;
end;
$$;

revoke all on function erp.issue_document(uuid, uuid, text, uuid, text, jsonb, text, text, text, text)
  from public, anon, service_role;
grant execute on function erp.issue_document(uuid, uuid, text, uuid, text, jsonb, text, text, text, text)
  to authenticated;
revoke all on function erp.issue_invoice_document(uuid, uuid, uuid, text, text, jsonb, text, text, text)
  from public, anon, authenticated, service_role;

-- Include all local invoice documents in one batched, permission-scoped fetch.
-- Direct SELECT on sales/sale_lines is not granted by this RPC.
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
          'discount_amount', line.discount_amount,
          'tax_rate_percent', line.tax_rate_percent,
          'tax_amount', line.tax_amount,
          'line_total', line.line_total
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

-- Keep the document-event stream authoritative for current voided/issued state.
-- Both classifications are local-only; no provider request may be made for them.
create or replace function erp.request_fiscal_issuance(
  target_document_id uuid,
  target_fiscal_point_id uuid,
  voucher_type text,
  operation_key text,
  operation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, erp, extensions
as $$
declare
  org_id uuid := erp.current_organization_id();
  document_row erp.documents%rowtype;
  point_row erp.fiscal_points%rowtype;
  cmd erp.stage8_commands%rowtype;
  next_number bigint;
  result_id uuid;
  digest text;
begin
  select * into document_row
  from erp.documents
  where id = target_document_id and organization_id = org_id
  for update;
  if document_row.id is null then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'issued document, permission and reason are required';
  end if;
  if document_row.invoice_kind is not null then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'locally classified POS invoices cannot be sent for provider authorization';
  end if;
  select * into point_row
  from erp.fiscal_points
  where id = target_fiscal_point_id
    and organization_id = org_id
    and branch_id = document_row.branch_id
    and is_active
  for update;
  if point_row.id is null
    or not erp.has_permission('documents.issue', document_row.branch_id)
    or request_fiscal_issuance.voucher_type !~ '^[A-Z0-9_]{1,40}$'
    or nullif(btrim(operation_key), '') is null
    or nullif(btrim(operation_reason), '') is null
    or (select status from erp.document_events where document_id = document_row.id order by event_sequence desc limit 1)
      is distinct from 'issued'::erp.document_status then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'active fiscal point, issued document, permission and reason are required';
  end if;

  digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'document_id', document_row.id,
    'point_id', point_row.id,
    'voucher_type', request_fiscal_issuance.voucher_type,
    'snapshot', document_row.customer_snapshot
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform set_config('erp.operation_reason', operation_reason, true);
  cmd := erp.claim_stage8_command(
    'fiscal.request', org_id, document_row.branch_id, operation_key,
    jsonb_build_object('document_id', document_row.id, 'point_id', point_row.id,
      'voucher_type', request_fiscal_issuance.voucher_type, 'request_digest', digest,
      'reason', operation_reason)
  );
  if cmd.result_id is not null then return cmd.result_id; end if;

  insert into erp.fiscal_counters(organization_id, fiscal_point_id, voucher_type, last_number)
  values (org_id, point_row.id, request_fiscal_issuance.voucher_type, 1)
  on conflict on constraint fiscal_counters_pkey
  do update set last_number = erp.fiscal_counters.last_number + 1
  returning last_number into next_number;
  insert into erp.fiscal_requests(
    organization_id, branch_id, document_id, fiscal_point_id, voucher_type,
    voucher_number, request_sha256, requested_by
  ) values (
    org_id, document_row.branch_id, document_row.id, point_row.id,
    request_fiscal_issuance.voucher_type, next_number, digest, auth.uid()
  ) returning id into result_id;
  insert into erp.integration_outbox(
    organization_id, branch_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key
  ) values (
    org_id, document_row.branch_id, 'fiscal_request', result_id, 'fiscal.issue.requested',
    jsonb_build_object('request_id', result_id, 'redacted', true), 'stage8:fiscal:' || result_id
  );
  perform erp.complete_stage8_command(cmd.id, result_id);
  return result_id;
end;
$$;
revoke all on function erp.request_fiscal_issuance(uuid, uuid, text, text, text) from public, anon, service_role;
grant execute on function erp.request_fiscal_issuance(uuid, uuid, text, text, text) to authenticated;

-- Prevent clients running an old POS bundle from invoking the ARCA-queuing RPC.
revoke all on function erp.create_sale_with_fiscal_document(uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid)
  from public, anon, authenticated, service_role;

-- Redefine the local sale command only to ensure local numbers never truncate
-- after their minimum eight-digit display width.
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
set search_path = pg_catalog, erp, extensions
as $$
declare
  current_org_id uuid := erp.current_organization_id();
  command_row erp.stage8_commands%rowtype;
  template_version_id uuid;
  sale_id uuid;
  document_id uuid;
  document_number text;
  next_number bigint;
  existing_max numeric;
  customer_snapshot jsonb;
  document_payload jsonb;
  request_payload jsonb;
  content_sha256 text;
  result_invoice_kind text;
begin
  if current_org_id is null
    or not erp.has_permission('sales.create', target_branch_id)
    or not erp.has_permission('documents.issue', target_branch_id)
    or target_invoice_kind is null
    or target_invoice_kind not in ('fiscal', 'non_fiscal')
    or nullif(btrim(operation_key), '') is null
    or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'insufficient_privilege', message = 'sales.create, documents.issue, invoice type, operation key and reason are required';
  end if;

  select version_row.id into template_version_id
  from erp.document_template_versions version_row
  join erp.document_templates template_row
    on template_row.id = version_row.template_id
   and template_row.organization_id = version_row.organization_id
  where version_row.organization_id = current_org_id
    and template_row.document_kind = 'sale'
    and template_row.is_active
  order by version_row.version desc
  limit 1;
  if template_version_id is null then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'active sale document template is required';
  end if;

  request_payload := jsonb_build_object(
    'invoice_kind', target_invoice_kind,
    'branch_id', target_branch_id,
    'customer_id', target_customer_id,
    'currency', upper(btrim(sale_currency)),
    'exchange_snapshot_id', target_exchange_snapshot_id,
    'reservation_batch_id', target_reservation_batch_id,
    'reason', operation_reason,
    'lines_sha256', encode(extensions.digest(convert_to(coalesce(lines, 'null'::jsonb)::text, 'UTF8'), 'sha256'), 'hex'),
    'payments_sha256', encode(extensions.digest(convert_to(coalesce(payment_lines, 'null'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
  );
  command_row := erp.claim_stage8_command('pos.sale.invoice', current_org_id, target_branch_id, operation_key, request_payload);
  if command_row.result_id is not null then
    select document_row.owner_id, document_row.document_number, document_row.invoice_kind
    into sale_id, document_number, result_invoice_kind
    from erp.documents document_row
    where document_row.id = command_row.result_id and document_row.organization_id = current_org_id;
    if sale_id is null then
      raise exception using errcode = 'data_exception', message = 'completed sale invoice command has no document';
    end if;
    return jsonb_build_object('sale_id', sale_id, 'document_id', command_row.result_id,
      'document_number', document_number, 'invoice_kind', result_invoice_kind);
  end if;

  sale_id := erp.create_sale(target_branch_id, target_customer_id, sale_currency,
    target_exchange_snapshot_id, operation_key, operation_reason, lines,
    payment_lines, target_reservation_batch_id);
  if target_customer_id is null then
    customer_snapshot := jsonb_build_object('customer_id', null, 'display_name', 'Consumidor Final', 'kind', 'individual');
  else
    select jsonb_build_object(
      'customer_id', customer_row.id,
      'display_name', customer_row.display_name,
      'legal_name', customer_row.legal_name,
      'kind', customer_row.kind::text,
      'email', customer_row.email,
      'phone', customer_row.phone,
      'whatsapp_phone', customer_row.whatsapp_phone
    ) into customer_snapshot
    from erp.customers customer_row
    where customer_row.id = target_customer_id
      and customer_row.organization_id = current_org_id
      and customer_row.is_active;
    if customer_snapshot is null then
      raise exception using errcode = 'foreign_key_violation', message = 'active sale customer is required for the invoice';
    end if;
  end if;

  select coalesce(max(case target_invoice_kind
    when 'fiscal' then substring(document_row.document_number from 3)::numeric
    else substring(document_row.document_number from 4)::numeric
  end), 0) into existing_max
  from erp.documents document_row
  where document_row.organization_id = current_org_id
    and document_row.branch_id = target_branch_id
    and document_row.document_number ~ (case target_invoice_kind
      when 'fiscal' then '^F-[0-9]{1,19}$' else '^NF-[0-9]{1,19}$' end);
  if existing_max >= 9223372036854775807 then
    raise exception using errcode = 'numeric_value_out_of_range', message = 'local invoice sequence is exhausted';
  end if;

  insert into erp.document_counters(organization_id, branch_id, invoice_kind, last_number)
  values (current_org_id, target_branch_id, target_invoice_kind, existing_max::bigint + 1)
  on conflict (organization_id, branch_id, invoice_kind)
  do update set last_number = greatest(erp.document_counters.last_number, existing_max::bigint) + 1
  returning last_number into next_number;

  document_number := (case target_invoice_kind when 'fiscal' then 'F-' else 'NF-' end)
    || case when length(next_number::text) < 8 then lpad(next_number::text, 8, '0') else next_number::text end;
  document_payload := jsonb_build_object('sale_id', sale_id, 'branch_id', target_branch_id,
    'invoice_kind', target_invoice_kind, 'customer', customer_snapshot, 'lines', lines,
    'payment_lines', payment_lines, 'reason', operation_reason);
  content_sha256 := encode(extensions.digest(convert_to(document_payload::text, 'UTF8'), 'sha256'), 'hex');
  document_id := erp.issue_invoice_document(target_branch_id, template_version_id, sale_id,
    target_invoice_kind, document_number, customer_snapshot, content_sha256,
    operation_key || ':invoice-document', operation_reason);
  perform erp.complete_stage8_command(command_row.id, document_id);
  return jsonb_build_object('sale_id', sale_id, 'document_id', document_id,
    'document_number', document_number, 'invoice_kind', target_invoice_kind);
end;
$$;
revoke all on function erp.create_sale_with_invoice(uuid, uuid, text, uuid, text, text, jsonb, text, jsonb, uuid)
  from public, anon, service_role;
grant execute on function erp.create_sale_with_invoice(uuid, uuid, text, uuid, text, text, jsonb, text, jsonb, uuid)
  to authenticated;

commit;
