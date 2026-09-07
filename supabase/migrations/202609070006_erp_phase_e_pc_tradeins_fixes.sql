-- Migration: 202609070006_erp_phase_e_pc_tradeins_fixes.sql
-- Description: Phase E: Fix H14 (IMEI NULL gate checks), Fix H17 (PC revision variable disambiguation),
--              add trade_ins_overview and pc_build_projects_overview views and atomic intake wrappers.

set search_path = erp, pg_catalog;

-- 1. Fix Finding H14: release_trade_in_to_stock must strictly reject NULL imei_status
create or replace function erp.release_trade_in_to_stock(
  target_trade_in_id uuid,
  target_location_id uuid,
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
  trade erp.trade_ins%rowtype;
  cmd erp.stage7_commands%rowtype;
  evaluation erp.trade_in_evaluations%rowtype;
  latest_request_id uuid;
  has_imei boolean;
  refurb numeric;
  total numeric;
  document_id uuid;
  release_id uuid;
  imei_status erp.imei_check_status;
begin
  select * into trade
    from erp.trade_ins
   where id = target_trade_in_id and organization_id = org_id
     for update;

  if trade.id is null
     or not erp.has_permission('trade_ins.approve', trade.branch_id)
     or not erp.has_permission('stock.move', trade.branch_id)
     or not erp.has_permission('purchases.manage', trade.branch_id)
     or not erp.has_permission('costs.manage', trade.branch_id) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'trade-in approval, stock, purchase and cost permissions are required';
  end if;

  if nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'operation reason is required';
  end if;

  perform set_config('erp.operation_reason', operation_reason, true);

  cmd := erp.claim_stage7_command(
    'trade_in.release', org_id, trade.branch_id, operation_key,
    jsonb_build_object('trade_in_id', trade.id, 'location_id', target_location_id, 'reason', operation_reason)
  );
  if cmd.result_id is not null then
    return (select stock_document_id from erp.trade_in_releases where id = cmd.result_id);
  end if;

  if coalesce((
    select decision = 'approved'
      from erp.trade_in_provenance_reviews
     where trade_in_id = trade.id
     order by event_sequence desc limit 1
  ), false) = false then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'latest provenance review must approve release';
  end if;

  select normalized_imei is not null into has_imei
    from erp.inventory_units
   where id = trade.inventory_unit_id and organization_id = org_id;

  if has_imei then
    select id into latest_request_id
      from erp.trade_in_imei_requests
     where trade_in_id = trade.id
     order by request_version desc limit 1;

    select status into imei_status
      from erp.trade_in_imei_results
     where request_id = latest_request_id
     order by event_sequence desc limit 1;
  else
    select status into imei_status
      from erp.trade_in_imei_results
     where trade_in_id = trade.id
       and source = 'manual'
       and status = 'not_required'
     order by event_sequence desc limit 1;
  end if;

  -- H14 FIX: Explicitly reject null imei_status (request without result or pending check)
  if imei_status is null or imei_status not in ('clear', 'not_required') then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'latest IMEI request must have an effective clear or applicable not-required result';
  end if;

  select * into evaluation
    from erp.trade_in_evaluations
   where trade_in_id = trade.id
   order by version desc limit 1;

  if evaluation.id is null or coalesce((
    select decision = 'approved'
      from erp.trade_in_evaluation_reviews
     where evaluation_id = evaluation.id
     order by event_sequence desc limit 1
  ), false) = false then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'latest evaluation must be approved';
  end if;

  if exists(select 1 from erp.trade_in_refurbishments where trade_in_id = trade.id and completed_at is null) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'all refurbishment work must be completed';
  end if;

  select coalesce(sum(actual_cost_base), 0) into refurb
    from erp.trade_in_refurbishments
   where trade_in_id = trade.id;

  total := evaluation.appraised_value_base + refurb;

  if not exists(
    select 1 from erp.locations
     where id = target_location_id and organization_id = org_id
       and branch_id = trade.branch_id and is_active and allows_sale
  ) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'active sale location in the trade-in branch is required';
  end if;

  update erp.inventory_units
     set acquisition_cost = total, updated_by = auth.uid()
   where id = trade.inventory_unit_id and organization_id = org_id
     and status = 'quarantine' and current_location_id is null;

  if not found then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'trade-in unit is not quarantined';
  end if;

  document_id := erp.post_stock_document_core(
    'receipt', trade.branch_id, operation_key || ':stock', operation_reason,
    jsonb_build_array(jsonb_build_object(
      'product_id', trade.product_id,
      'variant_id', trade.variant_id,
      'inventory_unit_id', trade.inventory_unit_id,
      'to_location_id', target_location_id,
      'quantity', 1,
      'unit_cost', total
    )),
    false, 'trade_in', trade.id
  );

  perform erp.process_stock_document_costs(document_id);

  insert into erp.trade_in_releases(
    organization_id, branch_id, trade_in_id, evaluation_id,
    stock_document_id, destination_location_id,
    accepted_value_base, refurbishment_cost_base, total_cost_base, released_by
  ) values (
    org_id, trade.branch_id, trade.id, evaluation.id,
    document_id, target_location_id,
    evaluation.appraised_value_base, refurb, total, auth.uid()
  ) returning id into release_id;

  perform erp.complete_stage7_command(cmd.id, release_id);
  return document_id;
end $$;

-- 2. Fix Finding H14: record_trade_in_imei_manual_fallback must strictly check latest_provider_status is not null
create or replace function erp.record_trade_in_imei_manual_fallback(
  target_trade_in_id uuid,
  fallback_status erp.imei_check_status,
  documentation jsonb,
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
  trade erp.trade_ins%rowtype;
  latest_request erp.trade_in_imei_requests%rowtype;
  latest_provider_status erp.imei_check_status;
  cmd erp.stage7_commands%rowtype;
  result_id uuid;
  has_imei boolean;
  key_row erp.repair_credential_keys%rowtype;
  candidate erp.repair_credential_keys%rowtype;
  payload jsonb;
  prior_hash text;
begin
  select * into trade
    from erp.trade_ins
   where id = target_trade_in_id and organization_id = org_id
     for update;

  if trade.id is null or not erp.has_permission('trade_ins.approve', trade.branch_id) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'trade_ins.approve permission is required';
  end if;

  select normalized_imei is not null into has_imei
    from erp.inventory_units
   where id = trade.inventory_unit_id;

  if fallback_status not in ('clear', 'not_required')
     or documentation is null
     or jsonb_typeof(documentation) <> 'object'
     or documentation = '{}'
     or pg_column_size(documentation) > 262144
     or nullif(btrim(operation_reason), '') is null
     or (fallback_status = 'not_required' and has_imei) then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'documented clear or applicable not-required fallback is required';
  end if;

  select * into latest_request
    from erp.trade_in_imei_requests
   where trade_in_id = trade.id
   order by request_version desc limit 1;

  select status into latest_provider_status
    from erp.trade_in_imei_results
   where request_id = latest_request.id and source = 'provider'
   order by event_sequence desc limit 1;

  if latest_provider_status = 'blocked' then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'manual fallback cannot override a blocked IMEI';
  end if;

  -- H14 FIX: Explicitly require latest_provider_status is not null and in ('unavailable', 'error')
  if has_imei and (
    latest_request.id is null
    or latest_provider_status is null
    or latest_provider_status not in ('unavailable', 'error')
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'latest provider request must end unavailable or error for manual fallback';
  end if;

  select request_hash into prior_hash
    from erp.stage7_commands
   where command_name = 'trade_in.imei.manual'
     and organization_id = org_id
     and branch_id = trade.branch_id
     and idempotency_key = operation_key;

  if prior_hash is not null then
    for candidate in select * from erp.repair_credential_keys where organization_id = org_id order by key_version loop
      payload := jsonb_build_object(
        'trade_in_id', trade.id,
        'status', fallback_status,
        'documentation_hmac', encode(extensions.hmac(convert_to(documentation::text, 'UTF8'), candidate.key_material, 'sha256'), 'hex'),
        'reason_hmac', encode(extensions.hmac(convert_to(operation_reason, 'UTF8'), candidate.key_material, 'sha256'), 'hex'),
        'identifier_key_id', candidate.id
      );
      if encode(extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256'), 'hex') = prior_hash then
        key_row := candidate;
        exit;
      end if;
    end loop;
    if key_row.id is null then
      raise exception using errcode = 'integrity_constraint_violation',
        message = 'idempotency key is already used by another request';
    end if;
  else
    select * into key_row
      from erp.repair_credential_keys
     where organization_id = org_id and is_active
       for share;
  end if;

  if key_row.id is null then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'protected repair identifier key is unavailable';
  end if;

  payload := jsonb_build_object(
    'trade_in_id', trade.id,
    'status', fallback_status,
    'documentation_hmac', encode(extensions.hmac(convert_to(documentation::text, 'UTF8'), key_row.key_material, 'sha256'), 'hex'),
    'reason_hmac', encode(extensions.hmac(convert_to(operation_reason, 'UTF8'), key_row.key_material, 'sha256'), 'hex'),
    'identifier_key_id', key_row.id
  );

  cmd := erp.claim_stage7_command('trade_in.imei.manual', org_id, trade.branch_id, operation_key, payload);
  if cmd.result_id is not null then
    return cmd.result_id;
  end if;

  perform set_config('erp.operation_reason', operation_reason, true);

  insert into erp.trade_in_imei_results(
    organization_id, branch_id, trade_in_id, request_id, source,
    status, evidence, reason, checked_by, request_hash
  ) values (
    org_id, trade.branch_id, trade.id,
    case when has_imei then latest_request.id end,
    'manual', fallback_status, documentation, operation_reason, auth.uid(),
    encode(extensions.hmac(
      convert_to(jsonb_build_object(
        'trade_in_id', trade.id,
        'request_id', case when has_imei then latest_request.id end,
        'status', fallback_status,
        'documentation', documentation,
        'reason', operation_reason
      )::text, 'UTF8'),
      key_row.key_material, 'sha256'
    ), 'hex')
  ) returning id into result_id;

  perform erp.complete_stage7_command(cmd.id, result_id);
  return result_id;
end $$;

-- 3. Fix Finding H17: Disambiguate local variables in create_pc_build_revision
create or replace function erp.create_pc_build_revision(
  target_project_id uuid,
  target_spec_version_id uuid,
  target_rule_set_version_id uuid,
  configuration jsonb,
  components jsonb,
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
  branch uuid;
  cmd erp.stage7_commands%rowtype;
  revision_id uuid;
  prior uuid;
  next_version int;
  item jsonb;
  n int := 0;
  v_product_id uuid;
  v_variant_id uuid;
  v_unit_id uuid;
  v_qty numeric;
  tracking erp.inventory_tracking_mode;
  cost numeric;
  serial text;
begin
  select branch_id into branch from erp.assert_pc_project_mutable(target_project_id, org_id);
  if branch is null or not erp.has_permission('pc_builds.manage', branch) then
    raise exception using errcode = 'insufficient_privilege', message = 'pc_builds.manage permission is required';
  end if;

  if configuration is null or jsonb_typeof(configuration) <> 'object'
     or pg_column_size(configuration) > 262144
     or components is null or jsonb_typeof(components) <> 'array'
     or jsonb_array_length(components) not between 1 and 100
     or pg_column_size(components) > 1048576
     or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'bounded configuration, components and reason are required';
  end if;

  perform set_config('erp.operation_reason', operation_reason, true);

  cmd := erp.claim_stage7_command(
    'pc.revision.create', org_id, branch, operation_key,
    jsonb_build_object(
      'project_id', target_project_id,
      'spec_version_id', target_spec_version_id,
      'rule_set_version_id', target_rule_set_version_id,
      'configuration', configuration,
      'components', components,
      'reason', operation_reason
    )
  );
  if cmd.result_id is not null then return cmd.result_id; end if;

  select id, version into prior, next_version
    from erp.pc_build_revisions
   where project_id = target_project_id
   order by version desc limit 1;

  next_version := coalesce(next_version, 0) + 1;

  insert into erp.pc_build_revisions(
    organization_id, branch_id, project_id, version,
    supersedes_revision_id, spec_version_id, rule_set_version_id,
    configuration, created_by
  ) values (
    org_id, branch, target_project_id, next_version,
    prior, target_spec_version_id, target_rule_set_version_id,
    configuration, auth.uid()
  ) returning id into revision_id;

  for item in select value from jsonb_array_elements(components) loop
    n := n + 1;
    if jsonb_typeof(item) <> 'object'
       or nullif(item->>'slot_code', '') is null
       or not erp.is_finite_numeric_text(item->>'quantity') then
      raise exception using errcode = 'invalid_parameter_value', message = format('invalid component %s', n);
    end if;

    begin
      v_product_id := (item->>'product_id')::uuid;
      v_variant_id := nullif(item->>'variant_id', '')::uuid;
      v_unit_id := nullif(item->>'inventory_unit_id', '')::uuid;
      v_qty := (item->>'quantity')::numeric;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = format('invalid component %s', n);
    end;

    select p.inventory_tracking into tracking
      from erp.products p
     where p.id = v_product_id and p.organization_id = org_id and p.item_kind = 'product' and p.is_active;

    if tracking is null or v_qty <= 0
       or (tracking in ('serial', 'imei') and (v_unit_id is null or v_qty <> 1))
       or (tracking = 'quantity' and v_unit_id is not null) then
      raise exception using errcode = 'check_violation', message = format('component %s stock identity is invalid', n);
    end if;

    if tracking = 'quantity' then
      select icb.weighted_average_cost into cost
        from erp.inventory_cost_balances icb
       where icb.organization_id = org_id
         and icb.branch_id = branch
         and icb.product_id = v_product_id
         and icb.variant_key = coalesce(v_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
         and icb.valued_quantity > 0;
    else
      select coalesce(sc.acquisition_cost_base, u.acquisition_cost), coalesce(u.serial_number, u.imei)
        into cost, serial
        from erp.inventory_units u
        left join erp.serialized_acquisition_costs sc
               on sc.inventory_unit_id = u.id and sc.organization_id = u.organization_id
        join erp.locations l
          on l.id = u.current_location_id and l.organization_id = u.organization_id
       where u.id = v_unit_id
         and u.organization_id = org_id
         and u.product_id = v_product_id
         and u.variant_id is not distinct from v_variant_id
         and u.status = 'available'
         and u.is_active
         and l.branch_id = branch;
    end if;

    if cost is null then
      raise exception using errcode = 'object_not_in_prerequisite_state',
        message = format('component %s authoritative cost is unavailable', n);
    end if;

    insert into erp.pc_build_components(
      organization_id, revision_id, line_number, slot_code,
      product_id, variant_id, inventory_unit_id, quantity,
      specification_snapshot, unit_cost_snapshot, serial_snapshot, warranty_snapshot
    ) values (
      org_id, revision_id, n, btrim(item->>'slot_code'),
      v_product_id, v_variant_id, v_unit_id, v_qty,
      coalesce(item->'specifications', '{}'), cost, serial,
      coalesce(item->'warranty', '{}')
    );
  end loop;

  perform erp.complete_stage7_command(cmd.id, revision_id);
  return revision_id;
end $$;

-- 4. View: erp.trade_ins_overview
create or replace view erp.trade_ins_overview as
select
  t.id,
  t.organization_id,
  t.branch_id,
  t.customer_id,
  c.display_name as customer_name,
  c.code as customer_code,
  c.phone as customer_phone,
  t.product_id,
  p.internal_name as product_name,
  p.internal_code as product_code,
  t.variant_id,
  pv.code as variant_code,
  pv.name as variant_name,
  t.inventory_unit_id,
  u.serial_number,
  u.imei,
  u.status as unit_status,
  t.declared_value_base,
  t.received_at,
  -- Provenance
  prov.decision as provenance_decision,
  prov.reviewed_at as provenance_reviewed_at,
  -- IMEI Check
  imei_req.request_version as imei_request_version,
  imei_res.status as imei_status,
  imei_res.source as imei_source,
  imei_res.checked_at as imei_checked_at,
  -- Evaluation
  eval.id as evaluation_id,
  eval.version as evaluation_version,
  eval.appraised_value_base,
  eval.estimated_refurbishment_cost_base,
  eval_rev.decision as evaluation_decision,
  -- Refurbishment cost
  coalesce((select sum(r.actual_cost_base) from erp.trade_in_refurbishments r where r.trade_in_id = t.id), 0) as actual_refurbishment_cost,
  -- Release
  rel.id as release_id,
  rel.total_cost_base as release_total_cost,
  rel.destination_location_id as release_location_id,
  rel.released_at,
  -- Sale Payment
  pay.id as payment_id,
  pay.sale_id,
  pay.amount as payment_amount,
  pay.occurred_at as payment_applied_at,
  -- Derived stage
  case
    when pay.id is not null then 'applied_to_sale'
    when rel.id is not null then 'ready_for_stock'
    when eval.id is not null then 'evaluating'
    else 'quarantine'
  end as stage
from erp.trade_ins t
join erp.customers c on c.id = t.customer_id
join erp.products p on p.id = t.product_id
left join erp.product_variants pv on pv.id = t.variant_id
join erp.inventory_units u on u.id = t.inventory_unit_id
left join lateral (
  select pr.decision, pr.reviewed_at
    from erp.trade_in_provenance_reviews pr
   where pr.trade_in_id = t.id
   order by pr.event_sequence desc limit 1
) prov on true
left join lateral (
  select ir.id as request_id, ir.request_version
    from erp.trade_in_imei_requests ir
   where ir.trade_in_id = t.id
   order by ir.request_version desc limit 1
) imei_req on true
left join lateral (
  select res.status, res.source, res.checked_at
    from erp.trade_in_imei_results res
   where (imei_req.request_id is not null and res.request_id = imei_req.request_id)
      or (imei_req.request_id is null and res.trade_in_id = t.id and res.source = 'manual')
   order by res.event_sequence desc limit 1
) imei_res on true
left join lateral (
  select e.id, e.version, e.appraised_value_base, e.estimated_refurbishment_cost_base
    from erp.trade_in_evaluations e
   where e.trade_in_id = t.id
   order by e.version desc limit 1
) eval on true
left join lateral (
  select er.decision
    from erp.trade_in_evaluation_reviews er
   where er.evaluation_id = eval.id
   order by er.event_sequence desc limit 1
) eval_rev on true
left join erp.trade_in_releases rel on rel.trade_in_id = t.id
left join lateral (
  select sp.id, sp.sale_id, sp.amount, sp.occurred_at
    from erp.trade_in_sale_payment_events sp
   where sp.trade_in_id = t.id and sp.event_kind = 'applied'
   order by sp.occurred_at desc, sp.id desc limit 1
) pay on true
where t.organization_id = erp.current_organization_id()
  and erp.has_permission('trade_ins.view', t.branch_id);

grant select on erp.trade_ins_overview to authenticated;

-- 5. View: erp.pc_build_projects_overview
create or replace view erp.pc_build_projects_overview as
select
  proj.id,
  proj.organization_id,
  proj.branch_id,
  proj.customer_id,
  c.display_name as customer_name,
  c.code as customer_code,
  c.phone as customer_phone,
  proj.title,
  proj.notes,
  proj.created_at,
  st.state as current_state,
  st.occurred_at as state_changed_at,
  rev.id as latest_revision_id,
  rev.version as latest_revision_version,
  rev.spec_version_id,
  rev.rule_set_version_id,
  rev.configuration,
  comp.components_count,
  comp.total_components_cost,
  comp_run.outcome as latest_compatibility_outcome,
  comp_run.completed_at as compatibility_checked_at,
  res.reservation_batch_id,
  res_batch.status as reservation_status,
  res_batch.expires_at as reservation_expires_at,
  test_run.id as latest_test_run_id,
  test_run.completed_at as test_completed_at,
  comp_fact.id as completion_id,
  comp_fact.equipment_id,
  comp_fact.stock_document_id as fulfillment_stock_document_id,
  eq.serial_number as built_serial_number,
  comp_fact.completed_at
from erp.pc_build_projects proj
join erp.customers c on c.id = proj.customer_id
left join lateral (
  select state, occurred_at
    from erp.pc_build_state_events se
   where se.project_id = proj.id
   order by se.event_sequence desc limit 1
) st on true
left join lateral (
  select r.id, r.version, r.spec_version_id, r.rule_set_version_id, r.configuration
    from erp.pc_build_revisions r
   where r.project_id = proj.id
   order by r.version desc limit 1
) rev on true
left join lateral (
  select count(*)::int as components_count,
         coalesce(sum(bc.quantity * bc.unit_cost_snapshot), 0) as total_components_cost
    from erp.pc_build_components bc
   where bc.revision_id = rev.id
) comp on true
left join lateral (
  select cr.outcome, cr.completed_at
    from erp.pc_compatibility_runs cr
   where cr.revision_id = rev.id
   order by cr.run_sequence desc limit 1
) comp_run on true
left join lateral (
  select pcr.reservation_batch_id
    from erp.pc_build_reservations pcr
   where pcr.project_id = proj.id and pcr.revision_id = rev.id
   order by pcr.created_at desc limit 1
) res on true
left join erp.stock_reservation_batches res_batch on res_batch.id = res.reservation_batch_id
left join lateral (
  select tr.id, tr.completed_at
    from erp.pc_test_runs tr
   where tr.revision_id = rev.id
   order by tr.run_sequence desc limit 1
) test_run on true
left join erp.pc_build_completions comp_fact on comp_fact.project_id = proj.id
left join erp.customer_equipment eq on eq.id = comp_fact.equipment_id
where proj.organization_id = erp.current_organization_id()
  and erp.has_permission('pc_builds.view', proj.branch_id);

grant select on erp.pc_build_projects_overview to authenticated;

-- 6. Helper RPC: erp.intake_trade_in_direct
create or replace function erp.intake_trade_in_direct(
  target_branch_id uuid,
  target_customer_id uuid,
  target_product_id uuid,
  target_variant_id uuid,
  device_serial text,
  device_imei text,
  owner_name text,
  declaration_text text,
  declared_value numeric,
  evidence_doc text default null,
  operation_reason text default 'Ingreso de equipo en parte de pago'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, erp, extensions
as $$
declare
  op_key text := 'tradein-in-' || floor(extract(epoch from clock_timestamp()) * 1000)::text || '-' || substr(md5(random()::text), 1, 6);
  evidence_array jsonb;
  doc_hash text;
  trade_id uuid;
begin
  doc_hash := encode(digest(coalesce(evidence_doc, owner_name || '-intake-' || now()::text), 'sha256'), 'hex');
  evidence_array := jsonb_build_array(
    jsonb_build_object(
      'type', 'ownership',
      'private_object_path', 'provenance/' || target_customer_id::text || '/' || op_key,
      'sha256', doc_hash,
      'metadata', jsonb_build_object('doc_reference', coalesce(evidence_doc, 'Declaración jurada mostrador'))
    )
  );

  trade_id := erp.create_trade_in(
    target_branch_id,
    target_customer_id,
    target_product_id,
    target_variant_id,
    nullif(btrim(device_serial), ''),
    nullif(btrim(device_imei), ''),
    btrim(owner_name),
    btrim(declaration_text),
    evidence_array,
    declared_value,
    op_key,
    operation_reason
  );

  return trade_id;
end $$;

grant execute on function erp.intake_trade_in_direct to authenticated;

-- 7. Helper RPC: erp.create_pc_build_atomic
create or replace function erp.create_pc_build_atomic(
  target_branch_id uuid,
  target_customer_id uuid,
  build_title text,
  build_notes text,
  components_list jsonb,
  operation_reason text default 'Creación de proyecto de PC armada'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, erp
as $$
declare
  op_key_proj text := 'pc-proj-' || floor(extract(epoch from clock_timestamp()) * 1000)::text || '-' || substr(md5(random()::text), 1, 6);
  op_key_rev text := 'pc-rev-' || floor(extract(epoch from clock_timestamp()) * 1000)::text || '-' || substr(md5(random()::text), 1, 6);
  op_key_comp text := 'pc-chk-' || floor(extract(epoch from clock_timestamp()) * 1000)::text || '-' || substr(md5(random()::text), 1, 6);
  project_id uuid;
  spec_ver_id uuid;
  rule_ver_id uuid;
  rev_id uuid;
  run_id uuid;
  comp_outcome erp.pc_compatibility_outcome;
begin
  -- 1. Create project
  project_id := erp.create_pc_build_project(
    target_branch_id,
    target_customer_id,
    build_title,
    build_notes,
    op_key_proj,
    operation_reason
  );

  -- 2. Find active standard spec and rule-set versions
  select v.id into spec_ver_id
    from erp.pc_compatibility_spec_versions v
    join erp.pc_compatibility_specs s on s.id = v.spec_id
   where s.code = 'standard_pc' and s.is_active
   order by v.version desc limit 1;

  select rv.id into rule_ver_id
    from erp.pc_compatibility_rule_set_versions rv
    join erp.pc_compatibility_rule_sets rs on rs.id = rv.rule_set_id
   where rs.code = 'standard_pc' and rs.is_active
   order by rv.version desc limit 1;

  if spec_ver_id is null or rule_ver_id is null then
    -- Fallback to any active spec and rule version
    select id into spec_ver_id from erp.pc_compatibility_spec_versions order by version desc limit 1;
    select id into rule_ver_id from erp.pc_compatibility_rule_set_versions order by version desc limit 1;
  end if;

  -- 3. Create initial revision
  rev_id := erp.create_pc_build_revision(
    project_id,
    spec_ver_id,
    rule_ver_id,
    jsonb_build_object('platform', 'desktop_custom', 'created_via', 'erp_workspace'),
    components_list,
    op_key_rev,
    operation_reason
  );

  -- 4. Run compatibility check
  run_id := erp.record_pc_compatibility_run(
    rev_id,
    op_key_comp,
    'Chequeo de compatibilidad inicial'
  );

  select outcome into comp_outcome from erp.pc_compatibility_runs where id = run_id;

  return jsonb_build_object(
    'project_id', project_id,
    'revision_id', rev_id,
    'compatibility_run_id', run_id,
    'compatibility_outcome', comp_outcome
  );
end $$;

grant execute on function erp.create_pc_build_atomic to authenticated;
