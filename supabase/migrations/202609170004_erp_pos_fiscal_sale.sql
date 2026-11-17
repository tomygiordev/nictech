-- Coordina la venta POS con su documento comercial y la solicitud fiscal.
-- La operación se mantiene en una única transacción para no confirmar una venta
-- desde el frontend sin dejar trazabilidad documental.

create or replace function erp.create_sale_with_fiscal_document(
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
returns jsonb
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp, extensions
as $$
declare
  current_org_id uuid := erp.current_organization_id();
  template_version_id uuid;
  fiscal_point_id uuid;
  sale_id uuid;
  document_id uuid;
  fiscal_request_id uuid;
  customer_snapshot jsonb;
  document_payload jsonb;
  content_sha256 text;
begin
  if current_org_id is null
    or not erp.has_permission('sales.create', target_branch_id)
    or not erp.has_permission('documents.issue', target_branch_id)
    or nullif(btrim(operation_key), '') is null
    or nullif(btrim(operation_reason), '') is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'sales.create, documents.issue, operation key and reason are required';
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

  select point_row.id
    into fiscal_point_id
  from erp.fiscal_points point_row
  where point_row.organization_id = current_org_id
    and point_row.branch_id = target_branch_id
    and point_row.is_active
  order by point_row.code
  limit 1;

  if template_version_id is null or fiscal_point_id is null then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'active sale document template and fiscal point are required';
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
        message = 'active sale customer is required for the document';
    end if;
  end if;

  document_payload := jsonb_build_object(
    'sale_id', sale_id,
    'branch_id', target_branch_id,
    'customer', customer_snapshot,
    'lines', lines,
    'payment_lines', payment_lines,
    'reason', operation_reason
  );
  content_sha256 := encode(
    extensions.digest(convert_to(document_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  document_id := erp.issue_document(
    target_branch_id,
    template_version_id,
    'sale',
    sale_id,
    'POS-' || upper(sale_id::text),
    customer_snapshot,
    content_sha256,
    null,
    operation_key || ':document',
    operation_reason
  );

  fiscal_request_id := erp.request_fiscal_issuance(
    document_id,
    fiscal_point_id,
    'FACTURA_B',
    operation_key || ':fiscal',
    operation_reason
  );

  return jsonb_build_object(
    'sale_id', sale_id,
    'document_id', document_id,
    'fiscal_request_id', fiscal_request_id,
    'fiscal_status', 'queued'
  );
end;
$$;

revoke all on function erp.create_sale_with_fiscal_document(uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid)
  from public, anon, service_role;
grant execute on function erp.create_sale_with_fiscal_document(uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid)
  to authenticated;
