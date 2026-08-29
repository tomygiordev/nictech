-- Forward-only corrections verified against the local ERP pgTAP suite.

drop function if exists erp.request_fiscal_issuance(uuid, uuid, text, text, text);

create function erp.request_fiscal_issuance(
  target_document_id uuid,
  target_fiscal_point_id uuid,
  voucher_type text,
  operation_key text,
  operation_reason text
)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp, extensions as $$
declare
  org_id uuid := erp.current_organization_id();
  document_row erp.documents%rowtype;
  point_row erp.fiscal_points%rowtype;
  cmd erp.stage8_commands%rowtype;
  next_number bigint;
  result_id uuid;
  digest text;
begin
  select * into document_row from erp.documents where id = target_document_id and organization_id = org_id for update;
  select * into point_row from erp.fiscal_points where id = target_fiscal_point_id and organization_id = org_id and branch_id = document_row.branch_id and is_active for update;
  if document_row.id is null or point_row.id is null or not erp.has_permission('documents.issue', document_row.branch_id)
    or request_fiscal_issuance.voucher_type !~ '^[A-Z0-9_]{1,40}$' or nullif(btrim(operation_reason), '') is null
    or (select status from erp.document_events where document_id = document_row.id order by event_sequence desc limit 1) is distinct from 'issued'::erp.document_status then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'active fiscal point, issued document, permission and reason are required';
  end if;
  digest := encode(extensions.digest(convert_to(jsonb_build_object('document_id', document_row.id, 'point_id', point_row.id, 'voucher_type', request_fiscal_issuance.voucher_type, 'snapshot', document_row.customer_snapshot)::text, 'UTF8'), 'sha256'), 'hex');
  perform set_config('erp.operation_reason', operation_reason, true);
  cmd := erp.claim_stage8_command('fiscal.request', org_id, document_row.branch_id, operation_key, jsonb_build_object('document_id', document_row.id, 'point_id', point_row.id, 'voucher_type', request_fiscal_issuance.voucher_type, 'request_digest', digest, 'reason', operation_reason));
  if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.fiscal_counters(organization_id, fiscal_point_id, voucher_type, last_number)
    values (org_id, point_row.id, request_fiscal_issuance.voucher_type, 1)
    on conflict (fiscal_point_id, voucher_type) do update set last_number = erp.fiscal_counters.last_number + 1
    returning last_number into next_number;
  insert into erp.fiscal_requests(organization_id, branch_id, document_id, fiscal_point_id, voucher_type, voucher_number, request_sha256, requested_by)
    values (org_id, document_row.branch_id, document_row.id, point_row.id, request_fiscal_issuance.voucher_type, next_number, digest, auth.uid())
    returning id into result_id;
  insert into erp.integration_outbox(organization_id, branch_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
    values (org_id, document_row.branch_id, 'fiscal_request', result_id, 'fiscal.issue.requested', jsonb_build_object('request_id', result_id, 'redacted', true), 'stage8:fiscal:' || result_id);
  perform erp.complete_stage8_command(cmd.id, result_id);
  return result_id;
end $$;

create or replace function erp.sync_stock_reservation_statuses()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog
as $$
begin
  if new.status is distinct from old.status and new.status in ('released'::erp.stock_reservation_status, 'expired'::erp.stock_reservation_status, 'fulfilled'::erp.stock_reservation_status) then
    update erp.stock_reservations
    set status = new.status
    where batch_id = new.id and status = 'active'::erp.stock_reservation_status;
  end if;
  return new;
end;
$$;

drop trigger if exists stock_reservation_batch_status_sync on erp.stock_reservation_batches;
create trigger stock_reservation_batch_status_sync
after update of status on erp.stock_reservation_batches
for each row execute function erp.sync_stock_reservation_statuses();

create or replace function erp.transfer_customer_equipment(
  target_branch_id uuid, target_equipment_id uuid, target_customer_id uuid,
  operation_key text, operation_reason text
)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare
  org_id uuid := erp.current_organization_id();
  cmd erp.repair_commands%rowtype;
  event_id uuid;
  next_effective_at timestamptz;
begin
  if org_id is null or not erp.has_permission('repairs.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'repairs.manage permission is required';
  end if;
  perform 1 from erp.customer_equipment where id = target_equipment_id and organization_id = org_id for update;
  if not found then raise exception using errcode = 'foreign_key_violation', message = 'equipment not found'; end if;
  cmd := erp.claim_repair_command('repair.equipment.transfer', org_id, target_branch_id, operation_key,
    jsonb_build_object('equipment_id', target_equipment_id, 'customer_id', target_customer_id, 'reason', operation_reason));
  if cmd.result_id is not null then return cmd.result_id; end if;
  if not exists (select 1 from erp.customers where id = target_customer_id and organization_id = org_id) then
    raise exception using errcode = 'foreign_key_violation', message = 'customer not found';
  end if;
  if target_customer_id = (select customer_id from erp.equipment_ownership_events where equipment_id = target_equipment_id order by event_sequence desc limit 1) then
    raise exception using errcode = 'check_violation', message = 'equipment already belongs to customer';
  end if;
  select greatest(coalesce(max(effective_at), '-infinity'::timestamptz) + interval '1 microsecond', clock_timestamp())
    into next_effective_at
    from erp.equipment_ownership_events
    where equipment_id = target_equipment_id;
  insert into erp.equipment_ownership_events(organization_id, equipment_id, customer_id, effective_at, reason, actor_id)
    values (org_id, target_equipment_id, target_customer_id, next_effective_at, operation_reason, auth.uid())
    returning id into event_id;
  perform erp.complete_repair_command(cmd.id, event_id);
  return event_id;
end; $$;

grant execute on function erp.provision_repair_credential_key(uuid, bytea, text) to authenticated;
grant insert on table erp.products to authenticated;

create or replace function erp.validate_inventory_unit()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog
as $$
declare
  tracking_mode erp.inventory_tracking_mode;
  normalized_serial text := nullif(upper(regexp_replace(btrim(new.serial_number), '[[:space:]-]+', '', 'g')), '');
  normalized_imei text := nullif(regexp_replace(btrim(new.imei), '[^0-9]+', '', 'g'), '');
begin
  select inventory_tracking into tracking_mode from erp.products
  where id = new.product_id and organization_id = new.organization_id and item_kind = 'product' and is_active;
  if tracking_mode is null then raise exception using errcode = 'foreign_key_violation', message = 'active serialized product not found'; end if;
  if tracking_mode = 'serial' and normalized_serial is null then raise exception using errcode = 'check_violation', message = 'serial-tracked products require a serial number'; end if;
  if tracking_mode = 'imei' and (normalized_imei is null or normalized_imei !~ '^[0-9]{14,16}$') then raise exception using errcode = 'check_violation', message = 'IMEI-tracked products require a valid IMEI'; end if;
  if tracking_mode not in ('serial', 'imei') then raise exception using errcode = 'check_violation', message = 'inventory units require a serial- or IMEI-tracked product'; end if;
  if tg_op = 'UPDATE' and (new.organization_id <> old.organization_id or new.product_id <> old.product_id or new.variant_id is distinct from old.variant_id or new.serial_number is distinct from old.serial_number or new.imei is distinct from old.imei) then
    raise exception using errcode = 'integrity_constraint_violation', message = 'inventory unit identity is permanent';
  end if;
  return new;
end; $$;

create or replace function erp.validate_stock_cost_movement()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
begin
  if new.quantity_delta = 'NaN'::numeric or new.value_delta_base = 'NaN'::numeric or new.unit_cost_snapshot = 'NaN'::numeric then
    raise exception using errcode = 'check_violation', message = 'cost movement numeric values must be finite';
  end if;
  if not exists (select 1 from erp.stock_movements movement where movement.id = new.source_stock_movement_id and movement.organization_id = new.organization_id and movement.branch_id = new.branch_id and movement.document_id = new.document_id and movement.document_line_id = new.document_line_id and movement.product_id = new.product_id and movement.variant_id is not distinct from new.variant_id and movement.inventory_unit_id is not distinct from new.inventory_unit_id and movement.location_id = new.location_id and movement.quantity_delta = new.quantity_delta) then
    raise exception using errcode = 'foreign_key_violation', message = 'cost movement does not match its source stock movement';
  end if;
  if new.reversal_of_cost_movement_id is not null and not exists (select 1 from erp.stock_cost_movements original join erp.stock_documents reversal_document on reversal_document.id = new.document_id and reversal_document.organization_id = new.organization_id where original.id = new.reversal_of_cost_movement_id and original.organization_id = new.organization_id and original.document_id = reversal_document.source_id and reversal_document.source_type in ('stock_document_reversal', 'stock_reversal') and original.product_id = new.product_id and original.variant_id is not distinct from new.variant_id and original.inventory_unit_id is not distinct from new.inventory_unit_id and original.location_id = new.location_id and original.quantity_delta = -new.quantity_delta and original.value_delta_base = -new.value_delta_base and original.unit_cost_snapshot = new.unit_cost_snapshot) then
    raise exception using errcode = 'check_violation', message = 'cost reversal must be the exact opposite original fact';
  end if;
  if new.purchase_cost_entry_id is not null and not exists (select 1 from erp.inventory_cost_entries entry join erp.purchase_receipts receipt on receipt.id = entry.receipt_id and receipt.organization_id = entry.organization_id where entry.id = new.purchase_cost_entry_id and entry.organization_id = new.organization_id and entry.branch_id = new.branch_id and receipt.stock_document_id = new.document_id and entry.product_id = new.product_id and entry.variant_id is not distinct from new.variant_id and entry.inventory_unit_id is not distinct from new.inventory_unit_id and entry.quantity_delta = new.quantity_delta and entry.total_cost_base = new.value_delta_base and entry.unit_cost_base = new.unit_cost_snapshot) then
    raise exception using errcode = 'check_violation', message = 'purchase cost movement must match its authoritative receipt cost entry';
  end if;
  return new;
end; $$;
