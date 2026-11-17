-- ERP online-order lifecycle: explicit preparation, dispatch, delivery,
-- cancellation and atomic return/refund with append-only evidence.

set search_path = erp, public, pg_catalog, pg_temp;

create or replace function erp.record_web_order_event(
  target_web_order_id uuid,
  target_order_state text,
  target_delivery_state erp.sale_delivery_state,
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
  target_branch_id uuid;
  event_id uuid;
  event_occurred_at timestamptz;
  operation_hash text;
  existing_hash text;
  existing_order_id uuid;
  current_order_state text;
  current_payment_state erp.sale_payment_state;
  current_delivery_state erp.sale_delivery_state;
  reservation_id uuid;
  outbox_event_type text;
begin
  select orders.branch_id, orders.reservation_batch_id
    into target_branch_id, reservation_id
  from erp.web_orders orders
  where orders.id = target_web_order_id
    and orders.organization_id = actor_organization_id
  for update;

  if target_branch_id is null
     or not erp.has_permission('orders.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'orders.manage permission is required';
  end if;

  if num_nonnulls(target_order_state, target_delivery_state) <> 1
     or nullif(btrim(operation_key), '') is null
     or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'exactly one state axis, operation key and reason are required';
  end if;

  if target_order_state is not null
     and target_order_state not in ('confirmed', 'cancelled') then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'unsupported manual order state';
  end if;

  -- Dispatch is the atomic fulfillment command (sale + stock + journal), and
  -- return is the atomic refund command. Neither can be forged as a bare event.
  if target_delivery_state in ('dispatched', 'returned') then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'dispatch requires fulfillment and return requires the atomic refund command';
  end if;

  operation_hash := md5(jsonb_build_object(
    'web_order_id', target_web_order_id,
    'order_state', target_order_state,
    'delivery_state', target_delivery_state,
    'reason', btrim(operation_reason)
  )::text);

  select event.id, event.request_hash, event.web_order_id
    into event_id, existing_hash, existing_order_id
  from erp.web_order_events event
  where event.organization_id = actor_organization_id
    and event.branch_id = target_branch_id
    and event.idempotency_key = btrim(operation_key);

  if event_id is not null then
    if existing_order_id = target_web_order_id
       and existing_hash = operation_hash then
      return event_id;
    end if;
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'web order event idempotency key is already used by another request';
  end if;

  select event.order_state into current_order_state
  from erp.web_order_events event
  where event.web_order_id = target_web_order_id
    and event.organization_id = actor_organization_id
    and event.order_state is not null
  order by event.event_sequence desc
  limit 1;

  select event.payment_state into current_payment_state
  from erp.web_order_events event
  where event.web_order_id = target_web_order_id
    and event.organization_id = actor_organization_id
    and event.payment_state is not null
  order by event.event_sequence desc
  limit 1;

  select event.delivery_state into current_delivery_state
  from erp.web_order_events event
  where event.web_order_id = target_web_order_id
    and event.organization_id = actor_organization_id
    and event.delivery_state is not null
  order by event.event_sequence desc
  limit 1;

  if target_order_state = 'confirmed' then
    if current_order_state <> 'placed' then
      raise exception using errcode = 'object_not_in_prerequisite_state',
        message = 'illegal web order state transition';
    end if;
  elsif target_order_state = 'cancelled' then
    if current_order_state not in ('placed', 'confirmed') then
      raise exception using errcode = 'object_not_in_prerequisite_state',
        message = 'illegal web order state transition';
    end if;
    if current_payment_state is distinct from 'unpaid' then
      raise exception using errcode = 'object_not_in_prerequisite_state',
        message = 'paid or partially paid online orders require the provider refund workflow';
    end if;
  elsif target_delivery_state = 'preparing' then
    if current_order_state not in ('placed', 'confirmed')
       or current_delivery_state <> 'pending' then
      raise exception using errcode = 'object_not_in_prerequisite_state',
        message = 'illegal web delivery state transition';
    end if;
  elsif target_delivery_state = 'ready' then
    if current_order_state not in ('placed', 'confirmed')
       or current_delivery_state <> 'preparing' then
      raise exception using errcode = 'object_not_in_prerequisite_state',
        message = 'illegal web delivery state transition';
    end if;
  elsif target_delivery_state = 'delivered' then
    if current_order_state <> 'fulfilled'
       or current_delivery_state <> 'dispatched' then
      raise exception using errcode = 'object_not_in_prerequisite_state',
        message = 'only a dispatched fulfilled order can be delivered';
    end if;
  else
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'illegal web delivery state transition';
  end if;

  perform set_config('erp.operation_reason', btrim(operation_reason), true);
  if target_order_state = 'cancelled' then
    perform erp.release_stock_reservation(reservation_id, btrim(operation_reason));
  end if;

  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, order_state, delivery_state,
    idempotency_key, request_hash, reason, actor_id
  ) values (
    actor_organization_id, target_branch_id, target_web_order_id,
    target_order_state, target_delivery_state, btrim(operation_key),
    operation_hash, btrim(operation_reason), auth.uid()
  )
  returning id, occurred_at into event_id, event_occurred_at;

  outbox_event_type := case
    when target_order_state is not null
      then 'web_order.' || target_order_state
    else 'web_order.delivery.' || target_delivery_state::text
  end;

  insert into erp.integration_outbox (
    organization_id, branch_id, aggregate_type, aggregate_id,
    event_type, payload, idempotency_key
  ) values (
    actor_organization_id, target_branch_id, 'web_order', target_web_order_id,
    outbox_event_type,
    jsonb_strip_nulls(jsonb_build_object(
      'web_order_id', target_web_order_id,
      'event_id', event_id,
      'order_state', target_order_state,
      'delivery_state', target_delivery_state,
      'reason', btrim(operation_reason),
      'occurred_at', event_occurred_at,
      'actor_id', auth.uid()
    )),
    btrim(operation_key) || ':outbox'
  );

  return event_id;
end;
$$;

comment on function erp.record_web_order_event(
  uuid, text, erp.sale_delivery_state, text, text
) is 'Append-only online-order lifecycle command. Dispatch requires atomic fulfillment; return requires atomic refund.';

revoke all on function erp.record_web_order_event(
  uuid, text, erp.sale_delivery_state, text, text
) from public, anon, service_role;
grant execute on function erp.record_web_order_event(
  uuid, text, erp.sale_delivery_state, text, text
) to authenticated;

-- The sale/stock/accounting fulfillment is the explicit dispatch operation.
-- Require the physical preparation workflow to have reached ready first and
-- emit a delivery-specific outbox message in addition to web_order.fulfilled.
do $migration$
declare
  definition text;
  patched_definition text;
  eligibility_needle text := $needle$  if current_delivery_state not in ('preparing', 'ready') then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'web order delivery state is not eligible for fulfillment';
  end if;$needle$;
  eligibility_replacement text := $replacement$  if current_delivery_state <> 'ready' then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'a ready web order is required for fulfillment';
  end if;$replacement$;
  outbox_needle text := $needle$  insert into erp.integration_outbox (organization_id, branch_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  values (actor_organization_id, order_row.branch_id, 'web_order', target_web_order_id, 'web_order.fulfilled', jsonb_build_object('web_order_id', target_web_order_id, 'sale_id', sale_id), operation_key || ':outbox');$needle$;
  outbox_replacement text := $replacement$  insert into erp.integration_outbox (organization_id, branch_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  values (actor_organization_id, order_row.branch_id, 'web_order', target_web_order_id, 'web_order.fulfilled', jsonb_build_object('web_order_id', target_web_order_id, 'sale_id', sale_id), operation_key || ':outbox');
  insert into erp.integration_outbox (organization_id, branch_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  values (
    actor_organization_id, order_row.branch_id, 'web_order', target_web_order_id,
    'web_order.delivery.dispatched',
    jsonb_build_object('web_order_id', target_web_order_id, 'sale_id', sale_id, 'delivery_state', 'dispatched', 'actor_id', auth.uid()),
    operation_key || ':delivery-outbox'
  );$replacement$;
begin
  definition := replace(
    pg_get_functiondef(
      'erp.fulfill_web_order(uuid,text,text)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  );
  patched_definition := replace(definition, eligibility_needle, eligibility_replacement);
  if patched_definition = definition then
    raise exception 'fulfill_web_order ready-state guard was not found';
  end if;
  definition := patched_definition;
  patched_definition := replace(definition, outbox_needle, outbox_replacement);
  if patched_definition = definition then
    raise exception 'fulfill_web_order outbox insertion was not found';
  end if;
  execute patched_definition;
end;
$migration$;

revoke all on function erp.fulfill_web_order(uuid, text, text)
from public, anon, service_role;
grant execute on function erp.fulfill_web_order(uuid, text, text)
to authenticated;

-- A returned event is valid only after a delivered fact and only as part of
-- the existing all-or-nothing provider refund, sale, stock and GL reversal.
do $migration$
declare
  definition text;
  patched_definition text;
  declaration_needle text := $needle$  current_order_state text;
  payment_reversal_ids_value jsonb;$needle$;
  declaration_replacement text := $replacement$  current_order_state text;
  current_delivery_state erp.sale_delivery_state;
  payment_reversal_ids_value jsonb;$replacement$;
  state_needle text := $needle$  select event.order_state into current_order_state
  from erp.web_order_events event
  where event.web_order_id = target_web_order_id
    and event.organization_id = org_id
    and event.order_state is not null
  order by event.event_sequence desc limit 1;
  if fulfillment.id is null or current_order_state <> 'fulfilled'$needle$;
  state_replacement text := $replacement$  select event.order_state into current_order_state
  from erp.web_order_events event
  where event.web_order_id = target_web_order_id
    and event.organization_id = org_id
    and event.order_state is not null
  order by event.event_sequence desc limit 1;
  select event.delivery_state into current_delivery_state
  from erp.web_order_events event
  where event.web_order_id = target_web_order_id
    and event.organization_id = org_id
    and event.delivery_state is not null
  order by event.event_sequence desc limit 1;
  if fulfillment.id is null or current_order_state <> 'fulfilled'
     or current_delivery_state <> 'delivered'$replacement$;
  message_needle text := $needle$message = 'an unapplied full provider refund for a fulfilled order is required';$needle$;
  message_replacement text := $replacement$message = 'an unapplied full provider refund for a delivered fulfilled order is required';$replacement$;
  outbox_needle text := $needle$  insert into erp.integration_outbox (
    organization_id, branch_id, aggregate_type, aggregate_id,
    event_type, payload, idempotency_key
  ) values (
    org_id, order_row.branch_id, 'web_order', target_web_order_id,
    'web_order.refunded', jsonb_build_object(
      'web_order_id', target_web_order_id,
      'refund_id', refund_id,
      'refund_payment_event_id', refund_event.id,
      'physical_return_confirmed', true
    ), operation_key || ':outbox'
  );$needle$;
  outbox_replacement text := $replacement$  insert into erp.integration_outbox (
    organization_id, branch_id, aggregate_type, aggregate_id,
    event_type, payload, idempotency_key
  ) values (
    org_id, order_row.branch_id, 'web_order', target_web_order_id,
    'web_order.refunded', jsonb_build_object(
      'web_order_id', target_web_order_id,
      'refund_id', refund_id,
      'refund_payment_event_id', refund_event.id,
      'physical_return_confirmed', true
    ), operation_key || ':outbox'
  );
  insert into erp.integration_outbox (
    organization_id, branch_id, aggregate_type, aggregate_id,
    event_type, payload, idempotency_key
  ) values (
    org_id, order_row.branch_id, 'web_order', target_web_order_id,
    'web_order.delivery.returned', jsonb_build_object(
      'web_order_id', target_web_order_id,
      'refund_id', refund_id,
      'delivery_state', 'returned',
      'actor_id', auth.uid()
    ), operation_key || ':delivery-outbox'
  );$replacement$;
begin
  definition := replace(
    pg_get_functiondef(
      'erp.refund_fulfilled_online_order(uuid,uuid,boolean,text,text,uuid)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  );
  patched_definition := replace(definition, declaration_needle, declaration_replacement);
  if patched_definition = definition then
    raise exception 'refund lifecycle declaration was not found';
  end if;
  definition := patched_definition;
  patched_definition := replace(definition, state_needle, state_replacement);
  if patched_definition = definition then
    raise exception 'refund lifecycle state guard was not found';
  end if;
  definition := patched_definition;
  patched_definition := replace(definition, message_needle, message_replacement);
  if patched_definition = definition then
    raise exception 'refund lifecycle error message was not found';
  end if;
  definition := patched_definition;
  patched_definition := replace(definition, outbox_needle, outbox_replacement);
  if patched_definition = definition then
    raise exception 'refund lifecycle outbox insertion was not found';
  end if;
  execute patched_definition;
end;
$migration$;

comment on function erp.refund_fulfilled_online_order(
  uuid, uuid, boolean, text, text, uuid
) is 'Atomic full refund for a delivered fulfilled online order after confirmed physical return; compensates sale, payments, stock, accounting and storefront state.';

revoke all on function erp.refund_fulfilled_online_order(
  uuid, uuid, boolean, text, text, uuid
) from public, anon;
grant execute on function erp.refund_fulfilled_online_order(
  uuid, uuid, boolean, text, text, uuid
) to authenticated, service_role;
