-- Append-only reversal for manual cash movements.

create or replace function erp.reverse_manual_cash_movement(
  target_cash_movement_id uuid,
  operation_key text,
  operation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_id uuid := erp.current_organization_id();
  original erp.cash_movements%rowtype;
  reversal_id uuid;
  reversal_kind erp.cash_movement_kind;
  request_hash_value text;
begin
  select movement.* into original
  from erp.cash_movements movement
  where movement.id = target_cash_movement_id
    and movement.organization_id = org_id
  for update;

  if original.id is null
     or original.kind not in ('contribution', 'withdrawal', 'expense')
     or original.reversal_of_movement_id is not null then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'an original manual cash movement is required';
  end if;
  if not erp.has_permission('cash.adjust', original.branch_id) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'cash.adjust permission is required';
  end if;
  if nullif(btrim(operation_key), '') is null
     or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'operation key and reason are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    org_id::text || ':cash-session:' || original.cash_session_id::text, 0
  ));
  if exists (
    select 1 from erp.cash_closures closure
    where closure.cash_session_id = original.cash_session_id
      and closure.organization_id = org_id
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'cash session is closed';
  end if;

  request_hash_value := md5(jsonb_build_object(
    'movement_id', original.id,
    'reason', operation_reason
  )::text);
  select movement.id into reversal_id
  from erp.cash_movements movement
  where movement.organization_id = org_id
    and movement.branch_id = original.branch_id
    and movement.idempotency_key = operation_key;
  if reversal_id is not null then
    if exists (
      select 1 from erp.cash_movements movement
      where movement.id = reversal_id
        and movement.request_hash = request_hash_value
        and movement.reversal_of_movement_id = original.id
    ) then
      return reversal_id;
    end if;
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'cash movement reversal key is already used by another request';
  end if;
  if exists (
    select 1 from erp.cash_movements movement
    where movement.organization_id = org_id
      and movement.reversal_of_movement_id = original.id
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'cash movement is already reversed';
  end if;

  reversal_kind := case when original.amount > 0
    then 'withdrawal'::erp.cash_movement_kind
    else 'contribution'::erp.cash_movement_kind
  end;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.cash_movements (
    organization_id, branch_id, cash_session_id, kind, currency_code, amount,
    reversal_of_movement_id, idempotency_key, request_hash, reason, actor_id
  ) values (
    org_id, original.branch_id, original.cash_session_id, reversal_kind,
    original.currency_code, -original.amount, original.id,
    operation_key, request_hash_value, operation_reason, auth.uid()
  ) returning id into reversal_id;

  return reversal_id;
end;
$$;

comment on function erp.reverse_manual_cash_movement(uuid, text, text) is
  'Append-only reversal for an open-session contribution, withdrawal or expense.';

revoke all on function erp.reverse_manual_cash_movement(uuid, text, text)
from public, anon, service_role;
grant execute on function erp.reverse_manual_cash_movement(uuid, text, text)
to authenticated;
