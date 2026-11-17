-- Emitir ventas y comprobantes dentro del ERP. El flujo local no crea solicitudes
-- fiscales ni eventos de outbox; la conexión a un proveedor queda como adaptador futuro.

alter table erp.documents
  add column invoice_kind text,
  add constraint documents_invoice_kind_check
    check (invoice_kind is null or (owner_type = 'sale' and invoice_kind in ('fiscal', 'non_fiscal')));

create table erp.document_counters (
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  invoice_kind text not null check (invoice_kind in ('fiscal', 'non_fiscal')),
  last_number bigint not null default 0 check (last_number >= 0),
  primary key (organization_id, branch_id, invoice_kind),
  constraint document_counters_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict
);

alter table erp.document_counters enable row level security;
revoke all on erp.document_counters from public, anon, authenticated, service_role;
grant select (invoice_kind) on erp.documents to authenticated, service_role;

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
  canonical_path text;
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
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'bounded invoice data, type, permission and reason are required';
  end if;

  if erp.stage8_json_has_forbidden_key(
    customer_snapshot,
    array['internal_notes','credentials','credential','costs','cost','unit_cost','base_cost','private_object_path','provider_payload','audit','imei','serial_number']
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'invoice snapshot contains internal fields';
  end if;

  select template_row.document_kind
    into template_kind
  from erp.document_template_versions version_row
  join erp.document_templates template_row
    on template_row.id = version_row.template_id
   and template_row.organization_id = version_row.organization_id
  where version_row.id = target_template_version_id
    and version_row.organization_id = org_id
    and template_row.is_active;

  if template_kind is distinct from 'sale'
    or not exists (
      select 1
      from erp.sales sale_row
      where sale_row.id = target_owner_id
        and sale_row.organization_id = org_id
        and sale_row.branch_id = target_branch_id
    ) then
    raise exception using errcode = 'foreign_key_violation', message = 'active sale template and owner are required';
  end if;

  canonical_path := 'documents/' || org_id || '/' || target_branch_id || '/sale/' || target_owner_id || '/' || content_sha256 || '.pdf';
  perform set_config('erp.operation_reason', operation_reason, true);
  command_row := erp.claim_stage8_command(
    'document.issue.invoice',
    org_id,
    target_branch_id,
    operation_key,
    jsonb_build_object(
      'template', target_template_version_id,
      'owner_id', target_owner_id,
      'invoice_kind', target_invoice_kind,
      'number', document_number,
      'snapshot', customer_snapshot,
      'digest', content_sha256,
      'reason', operation_reason
    )
  );
  if command_row.result_id is not null then
    return command_row.result_id;
  end if;

  insert into erp.documents (
    id, organization_id, branch_id, template_version_id, owner_type, owner_id,
    document_number, invoice_kind, customer_snapshot, content_sha256,
    private_object_path, issued_by
  ) values (
    result_id, org_id, target_branch_id, target_template_version_id, 'sale', target_owner_id,
    btrim(document_number), target_invoice_kind, customer_snapshot, content_sha256,
    canonical_path, auth.uid()
  );

  insert into erp.document_events(organization_id, branch_id, document_id, status, reason, actor_id)
  values (org_id, target_branch_id, result_id, 'issued', operation_reason, auth.uid());

  perform erp.complete_stage8_command(command_row.id, result_id);
  return result_id;
end;
$$;

revoke all on function erp.issue_invoice_document(uuid, uuid, uuid, text, text, jsonb, text, text, text)
  from public, anon, authenticated, service_role;

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
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'sales.create, documents.issue, invoice type, operation key and reason are required';
  end if;

  select version_row.id
    into template_version_id
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
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'active sale document template is required';
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
    where document_row.id = command_row.result_id
      and document_row.organization_id = current_org_id;
    if sale_id is null then
      raise exception using errcode = 'data_exception', message = 'completed sale invoice command has no document';
    end if;
    return jsonb_build_object(
      'sale_id', sale_id,
      'document_id', command_row.result_id,
      'document_number', document_number,
      'invoice_kind', result_invoice_kind
    );
  end if;

  sale_id := erp.create_sale(
    target_branch_id,
    target_customer_id,
    sale_currency,
    target_exchange_snapshot_id,
    operation_key,
    operation_reason,
    lines,
    payment_lines,
    target_reservation_batch_id
  );

  if target_customer_id is null then
    customer_snapshot := jsonb_build_object(
      'customer_id', null,
      'display_name', 'Consumidor Final',
      'kind', 'individual'
    );
  else
    select jsonb_build_object(
      'customer_id', customer_row.id,
      'display_name', customer_row.display_name,
      'legal_name', customer_row.legal_name,
      'kind', customer_row.kind::text,
      'email', customer_row.email,
      'phone', customer_row.phone,
      'whatsapp_phone', customer_row.whatsapp_phone
    )
      into customer_snapshot
    from erp.customers customer_row
    where customer_row.id = target_customer_id
      and customer_row.organization_id = current_org_id
      and customer_row.is_active;

    if customer_snapshot is null then
      raise exception using
        errcode = 'foreign_key_violation',
        message = 'active sale customer is required for the invoice';
    end if;
  end if;

  select coalesce(max(
    case target_invoice_kind
      when 'fiscal' then substring(document_row.document_number from 3)::numeric
      else substring(document_row.document_number from 4)::numeric
    end
  ), 0)
    into existing_max
  from erp.documents document_row
  where document_row.organization_id = current_org_id
    and document_row.branch_id = target_branch_id
    and document_row.document_number ~ (case target_invoice_kind
      when 'fiscal' then '^F-[0-9]{1,19}$'
      else '^NF-[0-9]{1,19}$'
    end);

  if existing_max >= 9223372036854775807 then
    raise exception using errcode = 'numeric_value_out_of_range', message = 'local invoice sequence is exhausted';
  end if;

  insert into erp.document_counters(organization_id, branch_id, invoice_kind, last_number)
  values (current_org_id, target_branch_id, target_invoice_kind, existing_max::bigint + 1)
  on conflict (organization_id, branch_id, invoice_kind)
  do update set last_number = greatest(erp.document_counters.last_number, existing_max::bigint) + 1
  returning last_number into next_number;

  document_number := case target_invoice_kind
    when 'fiscal' then 'F-'
    else 'NF-'
  end || lpad(next_number::text, 8, '0');

  document_payload := jsonb_build_object(
    'sale_id', sale_id,
    'branch_id', target_branch_id,
    'invoice_kind', target_invoice_kind,
    'customer', customer_snapshot,
    'lines', lines,
    'payment_lines', payment_lines,
    'reason', operation_reason
  );
  content_sha256 := encode(extensions.digest(convert_to(document_payload::text, 'UTF8'), 'sha256'), 'hex');

  document_id := erp.issue_invoice_document(
    target_branch_id,
    template_version_id,
    sale_id,
    target_invoice_kind,
    document_number,
    customer_snapshot,
    content_sha256,
    operation_key || ':invoice-document',
    operation_reason
  );

  perform erp.complete_stage8_command(command_row.id, document_id);
  return jsonb_build_object(
    'sale_id', sale_id,
    'document_id', document_id,
    'document_number', document_number,
    'invoice_kind', target_invoice_kind
  );
end;
$$;

revoke all on function erp.create_sale_with_invoice(uuid, uuid, text, uuid, text, text, jsonb, text, jsonb, uuid)
  from public, anon, service_role;
grant execute on function erp.create_sale_with_invoice(uuid, uuid, text, uuid, text, text, jsonb, text, jsonb, uuid)
  to authenticated;

-- Catalog UPDATE remains column-scoped; the existing `products_update` policy
-- still enforces organization and catalog.manage permission for each row.
grant update (internal_name, base_sale_price, is_active, updated_at)
  on erp.products to authenticated;

comment on column erp.documents.invoice_kind is
  'Internal ERP invoice classification. Provider authorization is a separate optional future workflow.';
comment on table erp.document_counters is
  'Atomic per-branch internal invoice numbering, independent of fiscal providers and fiscal points.';
