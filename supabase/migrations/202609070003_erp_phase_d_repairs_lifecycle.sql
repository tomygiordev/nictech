-- Migration: 202609070003_erp_phase_d_repairs_lifecycle.sql
-- Description: Phase D - Repairs lifecycle, QC validation, parts traceability, and delivery/warranties.
-- Fixes H15 (repair_deliveries table reference in record_trade_in_refurbishment)
-- Fixes H16 (repair_latest_final_test_passes must consider part consumption/reversals; delivered orders cannot alter parts)
-- Provisions initial active repair credential key for standard tenant
-- Exposes streamlined RPCs for atomic intake, direct part consumption, and quote response recording
-- Provides erp.repair_orders_overview view for unified workshop management

-- 1. Ensure active repair credential key exists for standard tenant if seeded
insert into erp.repair_credential_keys (
  organization_id, key_version, key_material, is_active
)
select
  '10000000-0000-0000-0000-000000000001'::uuid,
  1,
  extensions.gen_random_bytes(32),
  true
where exists (
  select 1 from erp.organizations
  where id = '10000000-0000-0000-0000-000000000001'::uuid
)
and not exists (
  select 1 from erp.repair_credential_keys
  where organization_id = '10000000-0000-0000-0000-000000000001'::uuid and is_active
);

-- 2. Fix H15: record_trade_in_refurbishment table reference (repair_deliveries instead of repair_delivery_events)
create or replace function erp.record_trade_in_refurbishment(
  target_trade_in_id uuid,
  target_repair_order_id uuid,
  description text,
  actual_cost_base numeric,
  completed boolean,
  operation_key text,
  operation_reason text
)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare
  org_id uuid := erp.current_organization_id();
  trade erp.trade_ins%rowtype;
  cmd erp.stage7_commands%rowtype;
  result_id uuid;
  authoritative_repair_cost numeric;
begin
  select * into trade from erp.trade_ins
  where id = target_trade_in_id and organization_id = org_id for update;

  if trade.id is null or not erp.has_permission('trade_ins.manage', trade.branch_id) or not erp.has_permission('costs.manage', trade.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'trade_ins.manage and costs.manage are required';
  end if;

  if nullif(btrim(description), '') is null or length(description) > 2000
     or not erp.is_finite_numeric_text(actual_cost_base::text) or actual_cost_base < 0
     or completed is distinct from true or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'completed refurbishment, description, finite cost and reason are required';
  end if;

  if exists (select 1 from erp.trade_in_releases where trade_in_id = trade.id) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'released trade-in cannot receive refurbishment costs';
  end if;

  if target_repair_order_id is not null then
    -- Fixed H15: reference erp.repair_deliveries (not nonexistent erp.repair_delivery_events)
    if not exists (
      select 1 from erp.repair_orders r
      where r.id = target_repair_order_id
        and r.organization_id = org_id
        and r.branch_id = trade.branch_id
        and r.customer_id = trade.customer_id
        and exists (
          select 1 from erp.repair_deliveries d
          where d.repair_order_id = r.id and d.organization_id = r.organization_id
        )
    ) then
      raise exception using errcode = 'foreign_key_violation', message = 'refurbishment repair must belong to the same customer and be delivered';
    end if;

    select round(
      coalesce(
        (select sum(abs(m.value_delta_base))
         from erp.repair_part_events p
         join erp.stock_cost_movements m on m.document_id = p.stock_document_id and m.organization_id = p.organization_id
         where p.repair_order_id = target_repair_order_id
           and p.action = 'consumed'
           and not exists (select 1 from erp.repair_part_events x where x.reverses_event_id = p.id)),
        0
      ) +
      coalesce(
        (select sum(total_cost_base)
         from erp.repair_labor_facts
         where repair_order_id = target_repair_order_id and organization_id = org_id),
        0
      ),
      4
    ) into authoritative_repair_cost;

    if actual_cost_base <> authoritative_repair_cost then
      raise exception using errcode = 'check_violation', message = 'refurbishment cost must equal authoritative repair parts and labor';
    end if;
  end if;

  perform set_config('erp.operation_reason', operation_reason, true);
  cmd := erp.claim_stage7_command(
    'trade_in.refurbishment.record',
    org_id,
    trade.branch_id,
    operation_key,
    jsonb_build_object(
      'trade_in_id', trade.id,
      'repair_order_id', target_repair_order_id,
      'description', description,
      'cost', actual_cost_base,
      'completed', completed,
      'reason', operation_reason
    )
  );

  if cmd.result_id is not null then return cmd.result_id; end if;

  insert into erp.trade_in_refurbishments (
    organization_id, branch_id, trade_in_id, repair_order_id, description, actual_cost_base, completed_at, created_by
  ) values (
    org_id, trade.branch_id, trade.id, target_repair_order_id, btrim(description), actual_cost_base, clock_timestamp(), auth.uid()
  ) returning id into result_id;

  perform erp.complete_stage7_command(cmd.id, result_id);
  return result_id;
end $$;

grant execute on function erp.record_trade_in_refurbishment(uuid,uuid,text,numeric,boolean,text,text) to authenticated;

-- 3. Fix H16: repair_latest_final_test_passes must consider repair part consumption and reversals
create or replace function erp.repair_latest_final_test_passes(target_repair_order_id uuid, target_organization_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,erp as $$
  with progression as (
    select max(occurred_at) as occurred_at
    from (
      select e.occurred_at
      from erp.repair_state_events e join erp.repair_statuses s
        on s.id = e.status_id and s.organization_id = e.organization_id
      where e.repair_order_id = target_repair_order_id
        and e.organization_id = target_organization_id
        and not s.is_terminal
      union all
      select p.occurred_at
      from erp.repair_part_events p
      where p.repair_order_id = target_repair_order_id
        and p.organization_id = target_organization_id
        and p.action in ('consumed', 'consumption_reversed')
    ) all_interventions
  ), latest_run as (
    select r.id, r.template_version_id, r.completed_at
    from erp.repair_test_runs r
    where r.repair_order_id = target_repair_order_id
      and r.organization_id = target_organization_id
      and r.kind = 'final'
    order by r.run_sequence desc limit 1
  ), required_keys as (
    select item->>'key' as item_key
    from latest_run r
    join erp.repair_test_template_versions v on v.id = r.template_version_id and v.organization_id = target_organization_id
    cross join lateral jsonb_array_elements(v.definition) item
    where coalesce((item->>'required')::boolean, true)
  )
  select coalesce(
    (select r.completed_at >= p.occurred_at
        and (select count(*) from required_keys) > 0
        and not exists (
          select 1 from required_keys k
          where not exists (
            select 1 from erp.repair_test_results x
            where x.test_run_id = r.id and x.item_key = k.item_key and x.result = 'pass'
          )
        )
     from latest_run r cross join progression p),
    false
  );
$$;

-- Fix H16: parts cannot be consumed or reversed on delivered repair orders
create or replace function erp.consume_repair_parts(
  target_repair_order_id uuid,
  target_batch_id uuid,
  operation_key text,
  operation_reason text
)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare
  org_id uuid := erp.current_organization_id();
  branch uuid;
  cmd erp.repair_commands%rowtype;
  document uuid;
  event_id uuid;
  consumption_lines jsonb;
begin
  select branch_id into branch from erp.repair_orders
  where id = target_repair_order_id and organization_id = org_id for update;

  if branch is null or not erp.has_permission('repairs.manage', branch) then
    raise exception using errcode = 'insufficient_privilege', message = 'repairs.manage permission is required';
  end if;

  if exists (select 1 from erp.repair_deliveries where repair_order_id = target_repair_order_id and organization_id = org_id) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'cannot consume parts on a delivered repair order';
  end if;

  cmd := erp.claim_repair_command(
    'repair.parts.consume',
    org_id,
    branch,
    operation_key,
    jsonb_build_object('order_id', target_repair_order_id, 'batch_id', target_batch_id, 'reason', operation_reason)
  );
  if cmd.result_id is not null then
    return (select stock_document_id from erp.repair_part_events where id = cmd.result_id);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(org_id::text || ':' || branch::text, 0));
  perform 1 from erp.stock_reservation_batches
  where id = target_batch_id and organization_id = org_id and branch_id = branch
    and source_type = 'repair' and source_id = target_repair_order_id and status = 'active' for update;

  if not found then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'active owned repair reservation is required';
  end if;

  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'product_id', r.product_id,
    'variant_id', r.variant_id,
    'inventory_unit_id', r.inventory_unit_id,
    'from_location_id', r.location_id,
    'quantity', r.quantity
  )) order by r.location_id, r.product_id, r.id) into consumption_lines
  from erp.stock_reservations r
  where r.batch_id = target_batch_id and r.organization_id = org_id;

  if consumption_lines is null then
    raise exception using errcode = 'data_exception', message = 'repair reservation has no lines';
  end if;

  perform erp.release_stock_reservation(target_batch_id, operation_reason || ' (consume release)');
  document := erp.post_stock_document('repair_consumption', branch, operation_key || ':stock', operation_reason, consumption_lines, false, 'repair', target_repair_order_id);

  insert into erp.repair_part_events (
    organization_id, branch_id, repair_order_id, action, reservation_batch_id, stock_document_id, actor_id
  ) values (
    org_id, branch, target_repair_order_id, 'consumed', target_batch_id, document, auth.uid()
  ) returning id into event_id;

  perform erp.complete_repair_command(cmd.id, event_id);
  return document;
end; $$;

create or replace function erp.reverse_repair_part_consumption(
  target_repair_order_id uuid,
  target_stock_document_id uuid,
  operation_key text,
  operation_reason text
)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare
  org_id uuid := erp.current_organization_id();
  branch uuid;
  original_event uuid;
  cmd erp.repair_commands%rowtype;
  document uuid;
  event_id uuid;
begin
  select branch_id into branch from erp.repair_orders
  where id = target_repair_order_id and organization_id = org_id for update;

  if exists (select 1 from erp.repair_deliveries where repair_order_id = target_repair_order_id and organization_id = org_id) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'cannot reverse parts on a delivered repair order';
  end if;

  select id into original_event from erp.repair_part_events
  where repair_order_id = target_repair_order_id and stock_document_id = target_stock_document_id and action = 'consumed';

  if branch is null or original_event is null or not erp.has_permission('repairs.manage', branch) or not erp.has_permission('stock.adjust', branch) then
    raise exception using errcode = 'insufficient_privilege', message = 'repair and stock reversal permissions are required';
  end if;

  cmd := erp.claim_repair_command(
    'repair.parts.reverse',
    org_id,
    branch,
    operation_key,
    jsonb_build_object('order_id', target_repair_order_id, 'document_id', target_stock_document_id, 'reason', operation_reason)
  );
  if cmd.result_id is not null then
    return (select stock_document_id from erp.repair_part_events where id = cmd.result_id);
  end if;

  document := erp.reverse_stock_document(target_stock_document_id, operation_key || ':stock', operation_reason);

  insert into erp.repair_part_events (
    organization_id, branch_id, repair_order_id, action, stock_document_id, reverses_event_id, actor_id
  ) values (
    org_id, branch, target_repair_order_id, 'consumption_reversed', document, original_event, auth.uid()
  ) returning id into event_id;

  perform erp.complete_repair_command(cmd.id, event_id);
  return document;
end; $$;

-- 4. Streamlined RPCs for UI integration

-- erp.intake_repair_order
create or replace function erp.intake_repair_order(
  target_branch_id uuid,
  target_customer_id uuid,
  equipment_type text,
  brand_name text,
  model_name text,
  serial_number text default null,
  imei text default null,
  accessories jsonb default '[]'::jsonb,
  intake_condition text default 'Recibido en taller',
  intake_damage text default null,
  intake_notes text default null,
  reported_fault text default 'Diagnóstico técnico',
  operation_reason text default 'Ingreso de reparación'
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare
  org_id uuid := erp.current_organization_id();
  eq_id uuid;
  norm_serial text := nullif(upper(regexp_replace(btrim(serial_number), '[[:space:]-]+', '', 'g')), '');
  norm_imei text := nullif(regexp_replace(btrim(imei), '[^0-9]+', '', 'g'), '');
  op_key text := 'intake-' || extensions.gen_random_uuid()::text;
  repair_res record;
begin
  if org_id is null or not erp.has_permission('repairs.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'repairs.manage permission is required';
  end if;

  -- Look up existing equipment owned by this customer
  if norm_serial is not null or norm_imei is not null then
    select e.id into eq_id
    from erp.customer_equipment e
    where e.organization_id = org_id
      and (
        (norm_serial is not null and e.normalized_serial_number = norm_serial)
        or (norm_imei is not null and e.normalized_imei = norm_imei)
      )
      and (
        select customer_id from erp.equipment_ownership_events
        where equipment_id = e.id order by event_sequence desc limit 1
      ) = target_customer_id
    limit 1;
  end if;

  -- Create equipment if not yet registered
  if eq_id is null then
    eq_id := erp.create_customer_equipment(
      target_branch_id,
      target_customer_id,
      null, -- brand_id
      null, -- model_id
      coalesce(nullif(btrim(equipment_type), ''), 'Smartphone'),
      coalesce(nullif(btrim(brand_name), ''), 'Genérico'),
      coalesce(nullif(btrim(model_name), ''), 'Dispositivo'),
      serial_number,
      imei,
      op_key || ':eq',
      operation_reason
    );
  end if;

  -- Create repair order
  select * into repair_res
  from erp.create_repair_order(
    target_branch_id,
    target_customer_id,
    eq_id,
    coalesce(accessories, '[]'::jsonb),
    coalesce(nullif(btrim(intake_condition), ''), 'Recibido en taller'),
    intake_damage,
    intake_notes,
    coalesce(nullif(btrim(reported_fault), ''), 'Diagnóstico técnico'),
    op_key || ':ro',
    operation_reason
  );

  return jsonb_build_object(
    'repair_order_id', repair_res.repair_order_id,
    'order_code', repair_res.order_code,
    'tracking_token', repair_res.tracking_token,
    'equipment_id', eq_id
  );
end;
$$;

-- erp.consume_repair_part_direct
create or replace function erp.consume_repair_part_direct(
  target_repair_order_id uuid,
  target_location_id uuid,
  target_product_id uuid,
  target_variant_id uuid default null,
  target_quantity numeric default 1,
  operation_reason text default 'Consumo directo de repuesto'
)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare
  org_id uuid := erp.current_organization_id();
  order_row erp.repair_orders%rowtype;
  batch_id uuid;
  doc_id uuid;
  line_item jsonb;
  op_key text := 'consume-direct-' || extensions.gen_random_uuid()::text;
begin
  select * into order_row from erp.repair_orders where id = target_repair_order_id and organization_id = org_id;
  if order_row.id is null then raise exception using errcode = 'no_data_found', message = 'repair order not found'; end if;
  if not erp.has_permission('repairs.manage', order_row.branch_id) or not erp.has_permission('stock.move', order_row.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'repairs.manage and stock.move permissions are required';
  end if;

  line_item := jsonb_build_object(
    'location_id', target_location_id,
    'product_id', target_product_id,
    'variant_id', target_variant_id,
    'quantity', target_quantity
  );

  batch_id := erp.reserve_repair_parts(
    target_repair_order_id,
    clock_timestamp() + interval '2 hours',
    jsonb_build_array(line_item),
    op_key || ':res',
    operation_reason
  );

  doc_id := erp.consume_repair_parts(
    target_repair_order_id,
    batch_id,
    op_key || ':con',
    operation_reason
  );

  return doc_id;
end;
$$;

-- erp.respond_quote_direct
create or replace function erp.respond_quote_direct(
  target_quote_id uuid,
  decision text,
  customer_message text default null
)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare
  org_id uuid := erp.current_organization_id();
  quote_row erp.repair_quotes%rowtype;
  token_record record;
  active_token text;
  event_id uuid;
begin
  select * into quote_row from erp.repair_quotes where id = target_quote_id and organization_id = org_id;
  if quote_row.id is null then raise exception using errcode = 'no_data_found', message = 'quote not found'; end if;
  if not erp.has_permission('quotes.manage', quote_row.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'quotes.manage permission is required';
  end if;

  -- If not yet issued, issue it now
  if quote_row.issued_at is null then
    select * into token_record from erp.issue_repair_quote(
      target_quote_id,
      clock_timestamp() + interval '7 days',
      'auto-issue-' || extensions.gen_random_uuid()::text,
      'Emisión para registro de respuesta del cliente'
    );
    active_token := token_record.response_token;
  else
    -- If already issued, reissue to obtain unconsumed active token
    select response_token into active_token from erp.reissue_repair_quote_token(
      target_quote_id,
      least(quote_row.expires_at, clock_timestamp() + interval '7 days'),
      'Reemisión para registrar decisión del cliente'
    );
  end if;

  event_id := public.respond_repair_quote(active_token, decision, customer_message);
  return event_id;
end;
$$;

-- 5. Overview view for workshop management
create or replace view erp.repair_orders_overview with (security_invoker = true) as
select
  r.id,
  r.organization_id,
  r.branch_id,
  r.order_number,
  r.order_code,
  r.opened_at,
  r.customer_id,
  c.code as customer_code,
  c.display_name as customer_name,
  c.phone as customer_phone,
  c.email as customer_email,
  r.equipment_id,
  e.equipment_type,
  e.brand_snapshot,
  e.model_snapshot,
  r.reported_fault,
  r.intake_condition,
  r.intake_damage,
  r.intake_notes,
  r.intake_accessories,
  -- Current status
  latest_event.status_id,
  latest_status.code as status_code,
  latest_status.name as status_name,
  latest_status.is_initial as status_is_initial,
  latest_status.is_terminal as status_is_terminal,
  latest_status.requires_final_tests as status_requires_final_tests,
  latest_event.occurred_at as status_updated_at,
  latest_event.public_message as status_public_message,
  -- Delivery info
  d.id as delivery_id,
  d.recipient_name,
  d.recipient_document_suffix,
  d.delivered_at,
  w.id as warranty_id,
  w.ends_at as warranty_ends_at,
  -- Quote summary
  (
    select jsonb_build_object(
      'id', q.id,
      'version', q.version,
      'total_amount', q.total_amount,
      'currency_code', q.currency_code,
      'issued_at', q.issued_at,
      'expires_at', q.expires_at,
      'decision', (
        select decision from erp.repair_quote_response_events re
        where re.repair_order_id = r.id order by re.occurred_at desc limit 1
      )
    )
    from erp.repair_quotes q
    where q.repair_order_id = r.id
    order by q.version desc limit 1
  ) as latest_quote,
  -- Parts count
  (
    select count(*) from erp.repair_part_events p
    where p.repair_order_id = r.id and p.action = 'consumed'
    and not exists (select 1 from erp.repair_part_events rev where rev.reverses_event_id = p.id)
  ) as active_parts_count,
  -- QC pass check
  erp.repair_latest_final_test_passes(r.id, r.organization_id) as qc_passed
from erp.repair_orders r
join erp.customers c on c.id = r.customer_id and c.organization_id = r.organization_id
join erp.customer_equipment e on e.id = r.equipment_id and e.organization_id = r.organization_id
left join lateral (
  select se.status_id, se.public_message, se.occurred_at
  from erp.repair_state_events se
  where se.repair_order_id = r.id and se.organization_id = r.organization_id
  order by se.event_sequence desc limit 1
) latest_event on true
left join erp.repair_statuses latest_status on latest_status.id = latest_event.status_id and latest_status.organization_id = r.organization_id
left join erp.repair_deliveries d on d.repair_order_id = r.id and d.organization_id = r.organization_id
left join erp.repair_warranties w on w.delivery_id = d.id and w.organization_id = r.organization_id;

-- Grants
grant select on erp.repair_orders_overview to authenticated;
grant execute on function erp.intake_repair_order(uuid,uuid,text,text,text,text,text,jsonb,text,text,text,text,text) to authenticated;
grant execute on function erp.consume_repair_part_direct(uuid,uuid,uuid,uuid,numeric,text) to authenticated;
grant execute on function erp.respond_quote_direct(uuid,text,text) to authenticated;
