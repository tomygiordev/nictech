-- Operational retry/recovery for the ERP transactional outbox.
-- Operator requests and worker claims are immutable facts; provider delivery is
-- still performed by an external worker and is never inferred by this schema.

set search_path = erp, pg_catalog;

create type erp.integration_retry_action as enum ('retry', 'recover');

create table erp.integration_retry_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  outbox_id uuid not null,
  root_request_id uuid not null,
  action erp.integration_retry_action not null,
  request_origin text not null check (request_origin in ('operator', 'automatic')),
  reason text not null check (btrim(reason) <> '' and length(reason) <= 2000),
  operation_key text not null check (btrim(operation_key) <> '' and length(operation_key) <= 240),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{32}$'),
  attempt_count_snapshot integer not null check (attempt_count_snapshot >= 1),
  retry_sequence smallint not null check (retry_sequence between 1 and 5),
  available_at timestamptz not null,
  requested_at timestamptz not null default clock_timestamp(),
  requested_by uuid references auth.users(id) on delete restrict,
  constraint integration_retry_requests_outbox_fk
    foreign key (outbox_id, organization_id, branch_id)
    references erp.integration_outbox(id, organization_id, branch_id) on delete restrict,
  constraint integration_retry_requests_root_fk
    foreign key (root_request_id) references erp.integration_retry_requests(id)
    deferrable initially deferred,
  constraint integration_retry_requests_operation_unique unique (organization_id, operation_key),
  constraint integration_retry_requests_id_outbox_unique unique (id, outbox_id)
);

create table erp.integration_retry_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  outbox_id uuid not null,
  retry_request_id uuid not null,
  claim_token uuid not null unique default gen_random_uuid(),
  claimed_at timestamptz not null default clock_timestamp(),
  lease_expires_at timestamptz not null,
  constraint integration_retry_claims_request_fk
    foreign key (retry_request_id, outbox_id)
    references erp.integration_retry_requests(id, outbox_id) on delete restrict,
  constraint integration_retry_claims_outbox_fk
    foreign key (outbox_id, organization_id, branch_id)
    references erp.integration_outbox(id, organization_id, branch_id) on delete restrict,
  constraint integration_retry_claims_lease_check check (lease_expires_at > claimed_at)
);

alter table erp.integration_attempts
  add column retry_request_id uuid,
  add column worker_claim_token uuid,
  add constraint integration_attempts_retry_request_fk
    foreign key (retry_request_id, outbox_id)
    references erp.integration_retry_requests(id, outbox_id) on delete restrict,
  add constraint integration_attempts_claim_token_unique unique (worker_claim_token),
  add constraint integration_attempts_retry_claim_shape check (
    (retry_request_id is null and worker_claim_token is null)
    or (retry_request_id is not null and worker_claim_token is not null)
  );

create index integration_retry_requests_due_idx
  on erp.integration_retry_requests (available_at, requested_at, id);
create index integration_retry_requests_outbox_idx
  on erp.integration_retry_requests (outbox_id, requested_at desc, id desc);
create index integration_retry_claims_request_idx
  on erp.integration_retry_claims (retry_request_id, lease_expires_at desc);

alter table erp.integration_retry_requests enable row level security;
alter table erp.integration_retry_claims enable row level security;

create policy integration_retry_requests_select on erp.integration_retry_requests
for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('integrations.view', branch_id)
);

create trigger integration_retry_requests_immutable
before update or delete on erp.integration_retry_requests
for each row execute function erp.prevent_fact_mutation();
create trigger integration_retry_claims_immutable
before update or delete on erp.integration_retry_claims
for each row execute function erp.prevent_fact_mutation();
create trigger integration_retry_requests_audit
after insert on erp.integration_retry_requests
for each row execute function erp.audit_operational_fact();
create trigger integration_retry_claims_audit
after insert on erp.integration_retry_claims
for each row execute function erp.audit_operational_fact();

create or replace function erp.request_integration_retry(
  target_outbox_id uuid,
  requested_action erp.integration_retry_action,
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
  outbox_row erp.integration_outbox%rowtype;
  existing erp.integration_retry_requests%rowtype;
  result_id uuid := gen_random_uuid();
  normalized_reason text := btrim(operation_reason);
  normalized_key text := btrim(operation_key);
  expected_hash text;
  attempt_count integer;
begin
  if org_id is null or requested_action is null or target_outbox_id is null
     or normalized_key is null or normalized_key = '' or length(normalized_key) > 240
     or normalized_reason is null or normalized_reason = '' or length(normalized_reason) > 2000 then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'outbox, action, bounded operation key and reason are required';
  end if;

  expected_hash := md5(jsonb_build_object(
    'outbox_id', target_outbox_id,
    'action', requested_action,
    'reason', normalized_reason
  )::text);

  select * into existing
  from erp.integration_retry_requests request
  where request.organization_id = org_id and request.operation_key = normalized_key;
  if existing.id is not null then
    if existing.request_hash <> expected_hash then
      raise exception using errcode = 'integrity_constraint_violation',
        message = 'operation key is already used by another integration retry request';
    end if;
    return existing.id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(org_id::text || ':integration-retry:' || target_outbox_id::text, 0));
  select * into outbox_row from erp.integration_outbox outbox
  where outbox.id = target_outbox_id and outbox.organization_id = org_id;
  if outbox_row.id is null or not erp.has_permission('integrations.retry', outbox_row.branch_id) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'integrations.retry permission is required';
  end if;
  if exists(select 1 from erp.integration_attempts attempt where attempt.outbox_id = target_outbox_id and attempt.status = 'succeeded') then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'delivered integration events cannot be retried';
  end if;
  select count(*)::integer into attempt_count from erp.integration_attempts attempt
  where attempt.outbox_id = target_outbox_id;
  if attempt_count = 0 or not exists(
    select 1 from erp.integration_attempts attempt
    where attempt.outbox_id = target_outbox_id and attempt.status = 'failed'
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'a failed integration attempt is required';
  end if;
  if requested_action = 'retry' and exists(
    select 1 from erp.integration_dead_letters dead where dead.outbox_id = target_outbox_id
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'dead-letter events require recovery';
  end if;
  if requested_action = 'recover' and not exists(
    select 1 from erp.integration_dead_letters dead where dead.outbox_id = target_outbox_id
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'only dead-letter events can be recovered';
  end if;
  if requested_action = 'recover' and exists(
    select 1 from erp.integration_retry_requests request
    where request.outbox_id = target_outbox_id and request.action = 'recover'
      and request.request_origin = 'operator'
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'dead-letter event already has a recovery cycle';
  end if;
  if exists(
    select 1 from erp.integration_retry_requests request
    where request.outbox_id = target_outbox_id
      and not exists(select 1 from erp.integration_attempts attempt where attempt.retry_request_id = request.id)
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'integration event already has a pending retry request';
  end if;
  if requested_action = 'retry' and exists(
    select 1 from erp.integration_retry_requests request
    join erp.integration_attempts attempt on attempt.retry_request_id = request.id and attempt.status = 'failed'
    where request.outbox_id = target_outbox_id and request.action = 'retry' and request.retry_sequence = 5
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'maximum retry attempts reached; move the event to dead letter';
  end if;

  perform set_config('erp.operation_reason', normalized_reason, true);
  insert into erp.integration_retry_requests(
    id, organization_id, branch_id, outbox_id, root_request_id, action,
    request_origin, reason, operation_key, request_hash,
    attempt_count_snapshot, retry_sequence, available_at, requested_by
  ) values (
    result_id, org_id, outbox_row.branch_id, target_outbox_id, result_id, requested_action,
    'operator', normalized_reason, normalized_key, expected_hash,
    attempt_count, 1, clock_timestamp() + interval '1 minute', auth.uid()
  );
  return result_id;
end;
$$;

create or replace function erp.claim_due_integration_retries(batch_limit integer default 10, lease_seconds integer default 120)
returns table (
  claim_token uuid,
  retry_request_id uuid,
  outbox_id uuid,
  organization_id uuid,
  branch_id uuid,
  event_type text,
  payload jsonb,
  idempotency_key text,
  action erp.integration_retry_action,
  retry_sequence smallint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row record;
  created_claim erp.integration_retry_claims%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = 'insufficient_privilege', message = 'service role is required';
  end if;
  if batch_limit is null or batch_limit not between 1 and 50
     or lease_seconds is null or lease_seconds not between 30 and 600 then
    raise exception using errcode = 'invalid_parameter_value', message = 'valid batch limit and lease are required';
  end if;

  for request_row in
    select request.*, outbox.event_type, outbox.payload, outbox.idempotency_key
    from erp.integration_retry_requests request
    join erp.integration_outbox outbox on outbox.id = request.outbox_id
    where request.available_at <= clock_timestamp()
      and not exists(select 1 from erp.integration_attempts attempt where attempt.retry_request_id = request.id)
      and not exists(
        select 1 from erp.integration_retry_claims claim
        where claim.retry_request_id = request.id and claim.lease_expires_at > clock_timestamp()
      )
      and not exists(
        select 1 from erp.integration_attempts attempt
        where attempt.outbox_id = request.outbox_id and attempt.status = 'succeeded'
      )
      and (
        (request.action = 'retry' and not exists(select 1 from erp.integration_dead_letters dead where dead.outbox_id = request.outbox_id))
        or (request.action = 'recover' and exists(select 1 from erp.integration_dead_letters dead where dead.outbox_id = request.outbox_id))
      )
    order by request.available_at, request.requested_at, request.id
    for update of request skip locked
    limit batch_limit
  loop
    insert into erp.integration_retry_claims(
      organization_id, branch_id, outbox_id, retry_request_id, lease_expires_at
    ) values (
      request_row.organization_id, request_row.branch_id, request_row.outbox_id,
      request_row.id, clock_timestamp() + make_interval(secs => lease_seconds)
    ) returning * into created_claim;
    return query select created_claim.claim_token, request_row.id, request_row.outbox_id,
      request_row.organization_id, request_row.branch_id, request_row.event_type,
      request_row.payload, request_row.idempotency_key, request_row.action,
      request_row.retry_sequence;
  end loop;
end;
$$;

create or replace function erp.record_claimed_integration_attempt(
  target_claim_token uuid,
  attempt_status erp.integration_attempt_status,
  attempt_error text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_row erp.integration_retry_claims%rowtype;
  request_row erp.integration_retry_requests%rowtype;
  existing erp.integration_attempts%rowtype;
  result_id uuid;
  next_attempt integer;
  next_request_id uuid;
  normalized_error text := nullif(btrim(attempt_error), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = 'insufficient_privilege', message = 'service role is required';
  end if;
  select * into claim_row from erp.integration_retry_claims claim
  where claim.claim_token = target_claim_token for update;
  if claim_row.id is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'valid integration retry claim is required';
  end if;
  select * into request_row from erp.integration_retry_requests request where request.id = claim_row.retry_request_id;
  select * into existing from erp.integration_attempts attempt where attempt.worker_claim_token = target_claim_token;
  if existing.id is not null then
    if existing.status <> attempt_status or existing.error_message is distinct from normalized_error then
      raise exception using errcode = 'integrity_constraint_violation', message = 'claim already has a different integration result';
    end if;
    return existing.id;
  end if;
  if claim_row.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'integration retry claim lease expired';
  end if;
  if attempt_status = 'failed' and normalized_error is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'failed integration attempts require an error';
  end if;
  if attempt_status = 'succeeded' and normalized_error is not null then
    raise exception using errcode = 'invalid_parameter_value', message = 'successful integration attempts cannot include an error';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(claim_row.organization_id::text || ':outbox:' || claim_row.outbox_id::text, 0));
  if exists(select 1 from erp.integration_attempts attempt where attempt.outbox_id = claim_row.outbox_id and attempt.status = 'succeeded') then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'integration event is already delivered';
  end if;
  select coalesce(max(attempt.attempt_number), 0) + 1 into next_attempt
  from erp.integration_attempts attempt where attempt.outbox_id = claim_row.outbox_id;
  perform set_config('erp.operation_reason', 'Integration retry worker result', true);
  insert into erp.integration_attempts(
    organization_id, outbox_id, attempt_number, status, error_message,
    attempted_by, retry_request_id, worker_claim_token
  ) values (
    claim_row.organization_id, claim_row.outbox_id, next_attempt, attempt_status,
    normalized_error, auth.uid(), request_row.id, target_claim_token
  ) returning id into result_id;

  if attempt_status = 'failed' and request_row.retry_sequence < 5 then
    next_request_id := gen_random_uuid();
    insert into erp.integration_retry_requests(
      id, organization_id, branch_id, outbox_id, root_request_id, action,
      request_origin, reason, operation_key, request_hash,
      attempt_count_snapshot, retry_sequence, available_at, requested_by
    ) values (
      next_request_id, request_row.organization_id, request_row.branch_id,
      request_row.outbox_id, request_row.root_request_id, request_row.action,
      'automatic', request_row.reason,
      'auto:' || request_row.root_request_id::text || ':' || (request_row.retry_sequence + 1)::text,
      md5(jsonb_build_object('root', request_row.root_request_id, 'sequence', request_row.retry_sequence + 1)::text),
      next_attempt, request_row.retry_sequence + 1,
      clock_timestamp() + make_interval(mins => least(60, (power(2, request_row.retry_sequence))::integer)),
      null
    );
  end if;
  return result_id;
end;
$$;

create or replace function erp.record_integration_attempt(
  target_outbox_id uuid,
  attempt_status erp.integration_attempt_status,
  attempt_error text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  outbox_row erp.integration_outbox%rowtype;
  result_id uuid;
  normalized_error text := nullif(btrim(attempt_error), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = 'insufficient_privilege', message = 'service role is required';
  end if;
  select * into outbox_row from erp.integration_outbox outbox where outbox.id = target_outbox_id;
  if outbox_row.id is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'valid integration outbox event is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(outbox_row.organization_id::text || ':outbox:' || target_outbox_id::text, 0));
  if exists(select 1 from erp.integration_attempts attempt where attempt.outbox_id = target_outbox_id)
     or exists(select 1 from erp.integration_dead_letters dead where dead.outbox_id = target_outbox_id)
     or exists(select 1 from erp.integration_retry_requests request where request.outbox_id = target_outbox_id) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'subsequent integration attempts require a claimed retry request';
  end if;
  if attempt_status = 'failed' and normalized_error is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'failed integration attempts require an error';
  end if;
  if attempt_status = 'succeeded' and normalized_error is not null then
    raise exception using errcode = 'invalid_parameter_value', message = 'successful integration attempts cannot include an error';
  end if;
  perform set_config('erp.operation_reason', 'Initial integration worker result', true);
  insert into erp.integration_attempts(
    organization_id, outbox_id, attempt_number, status, error_message, attempted_by
  ) values (
    outbox_row.organization_id, target_outbox_id, 1, attempt_status, normalized_error, auth.uid()
  ) returning id into result_id;
  return result_id;
end;
$$;

create or replace function erp.move_integration_to_dead_letter(target_outbox_id uuid, operation_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare org_id uuid := erp.current_organization_id(); outbox erp.integration_outbox%rowtype; result_id uuid;
begin
  select * into outbox from erp.integration_outbox where id = target_outbox_id and organization_id = org_id for update;
  if outbox.id is null or not erp.has_permission('integrations.retry', outbox.branch_id)
     or nullif(btrim(operation_reason), '') is null
     or not exists(select 1 from erp.integration_attempts a where a.outbox_id = outbox.id and a.organization_id = org_id and a.status = 'failed') then
    raise exception using errcode = 'insufficient_privilege', message = 'failed outbox item, integration retry permission and reason are required';
  end if;
  if exists(select 1 from erp.integration_attempts a where a.outbox_id = outbox.id and a.status = 'succeeded') then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'delivered integration events cannot move to dead letter';
  end if;
  if exists(
    select 1 from erp.integration_retry_requests request
    where request.outbox_id = outbox.id
      and not exists(select 1 from erp.integration_attempts attempt where attempt.retry_request_id = request.id)
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'pending retry must finish before dead letter';
  end if;
  select id into result_id from erp.integration_dead_letters where outbox_id = outbox.id;
  if result_id is not null then
    if not exists(select 1 from erp.integration_dead_letters where id = result_id and reason = operation_reason) then
      raise exception using errcode = 'integrity_constraint_violation', message = 'outbox item already has a different dead-letter reason';
    end if;
    return result_id;
  end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.integration_dead_letters(organization_id, branch_id, outbox_id, reason, moved_by)
  values(org_id, outbox.branch_id, outbox.id, operation_reason, auth.uid()) returning id into result_id;
  return result_id;
end;
$$;

revoke all on erp.integration_retry_requests, erp.integration_retry_claims
from public, anon, authenticated, service_role;
grant select on erp.integration_retry_requests to authenticated, service_role;
grant select on erp.integration_retry_claims to service_role;

revoke all on function erp.request_integration_retry(uuid,erp.integration_retry_action,text,text)
from public, anon, service_role;
grant execute on function erp.request_integration_retry(uuid,erp.integration_retry_action,text,text)
to authenticated;

revoke all on function erp.claim_due_integration_retries(integer,integer),
  erp.record_claimed_integration_attempt(uuid,erp.integration_attempt_status,text),
  erp.record_integration_attempt(uuid,erp.integration_attempt_status,text)
from public, anon, authenticated;
grant execute on function erp.claim_due_integration_retries(integer,integer),
  erp.record_claimed_integration_attempt(uuid,erp.integration_attempt_status,text),
  erp.record_integration_attempt(uuid,erp.integration_attempt_status,text)
to service_role;

revoke all on function erp.move_integration_to_dead_letter(uuid,text) from public, anon, service_role;
grant execute on function erp.move_integration_to_dead_letter(uuid,text) to authenticated;

