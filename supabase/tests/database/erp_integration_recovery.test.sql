begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

select has_table('erp', 'integration_retry_requests', 'Integration retry requests table exists');
select has_table('erp', 'integration_retry_claims', 'Integration retry claims table exists');
select has_function(
  'erp', 'request_integration_retry',
  array['uuid', 'erp.integration_retry_action', 'text', 'text'],
  'Authenticated retry request RPC exists'
);
select has_function(
  'erp', 'claim_due_integration_retries',
  array['integer', 'integer'],
  'Service worker claim RPC exists'
);
select has_function(
  'erp', 'record_claimed_integration_attempt',
  array['uuid', 'erp.integration_attempt_status', 'text'],
  'Claimed attempt result RPC exists'
);
select has_function(
  'erp', 'record_integration_attempt',
  array['uuid', 'erp.integration_attempt_status', 'text'],
  'Initial attempt result RPC exists'
);
select has_function(
  'erp', 'move_integration_to_dead_letter',
  array['uuid', 'text'],
  'Dead-letter RPC exists'
);
select is(
  has_function_privilege('authenticated', 'erp.request_integration_retry(uuid,erp.integration_retry_action,text,text)', 'EXECUTE'),
  true,
  'Authenticated operators can request retries'
);
select is(
  has_function_privilege('authenticated', 'erp.move_integration_to_dead_letter(uuid,text)', 'EXECUTE'),
  true,
  'Authenticated operators can move failed events to dead letter'
);
select is(
  has_function_privilege('service_role', 'erp.claim_due_integration_retries(integer,integer)', 'EXECUTE'),
  true,
  'Service workers can claim due retries'
);
select is(
  has_function_privilege('authenticated', 'erp.claim_due_integration_retries(integer,integer)', 'EXECUTE'),
  false,
  'Authenticated operators cannot claim worker retries'
);
select is(
  has_function_privilege('service_role', 'erp.record_claimed_integration_attempt(uuid,erp.integration_attempt_status,text)', 'EXECUTE'),
  true,
  'Service workers can record claimed results'
);
select is(
  has_function_privilege('authenticated', 'erp.record_claimed_integration_attempt(uuid,erp.integration_attempt_status,text)', 'EXECUTE'),
  false,
  'Authenticated operators cannot record claimed results'
);
select is(
  has_function_privilege('service_role', 'erp.record_integration_attempt(uuid,erp.integration_attempt_status,text)', 'EXECUTE'),
  true,
  'Service workers can record initial results'
);
select is(
  has_function_privilege('authenticated', 'erp.record_integration_attempt(uuid,erp.integration_attempt_status,text)', 'EXECUTE'),
  false,
  'Authenticated operators cannot fabricate initial results'
);

create temp table integration_recovery_ids (
  kind text primary key,
  id uuid not null
) on commit drop;
grant select, insert on integration_recovery_ids to authenticated, service_role;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'e4000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'integration-owner@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Integration Owner"}'::jsonb, now(), now()
);
update erp.profiles
set organization_id = '10000000-0000-0000-0000-000000000001'
where id = 'e4000000-0000-0000-0000-000000000001';
insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000001'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'e4000000-0000-0000-0000-000000000002',
  'authenticated', 'authenticated', 'integration-no-perm@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Integration No Permission"}'::jsonb, now(), now()
);
update erp.profiles
set organization_id = '10000000-0000-0000-0000-000000000001'
where id = 'e4000000-0000-0000-0000-000000000002';
insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000002',
  'e4000000-0000-0000-0000-000000000002'
);

set local role postgres;
insert into erp.integration_outbox (
  id, organization_id, branch_id, aggregate_type, aggregate_id,
  event_type, payload, idempotency_key, available_at
) values
  (
    'e4100000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'integration_test', 'e4200000-0000-0000-0000-000000000001',
    'integration.test.retry', '{"case":"retry"}'::jsonb,
    'integration-test-outbox-retry', now()
  ),
  (
    'e4100000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'integration_test', 'e4200000-0000-0000-0000-000000000002',
    'integration.test.worker', '{"case":"worker"}'::jsonb,
    'integration-test-outbox-worker', now()
  ),
  (
    'e4100000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'integration_test', 'e4200000-0000-0000-0000-000000000003',
    'integration.test.dead', '{"case":"dead-letter"}'::jsonb,
    'integration-test-outbox-dead', now()
  ),
  (
    'e4100000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'integration_test', 'e4200000-0000-0000-0000-000000000004',
    'integration.test.guards', '{"case":"guards"}'::jsonb,
    'integration-test-outbox-guards', now()
  );
reset role;

select set_config('request.jwt.claim.sub', 'e4000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select lives_ok(
  $$select erp.record_integration_attempt(
    'e4100000-0000-0000-0000-000000000001', 'failed', 'provider timeout'
  )$$,
  'Worker can record the initial failed retry event'
);
select lives_ok(
  $$select erp.record_integration_attempt(
    'e4100000-0000-0000-0000-000000000002', 'failed', 'connection reset'
  )$$,
  'Worker can record the claim fixture failed event'
);
select lives_ok(
  $$select erp.record_integration_attempt(
    'e4100000-0000-0000-0000-000000000003', 'failed', 'dead provider'
  )$$,
  'Worker can record the dead-letter fixture failed event'
);
select throws_ok(
  $$select erp.record_integration_attempt(
    'e4100000-0000-0000-0000-000000000004', 'failed', null
  )$$,
  '22023', 'failed integration attempts require an error',
  'Initial failed attempts require an error'
);
select throws_ok(
  $$select erp.record_integration_attempt(
    'e4100000-0000-0000-0000-000000000004', 'succeeded', 'unexpected error'
  )$$,
  '22023', 'successful integration attempts cannot include an error',
  'Initial succeeded attempts reject an error'
);
reset role;

select set_config('request.jwt.claim.sub', 'e4000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select lives_ok(
  $$select erp.request_integration_retry(
    'e4100000-0000-0000-0000-000000000001', 'retry',
    'integration-retry-op-001', 'Retry after provider timeout'
  )$$,
  'Owner can request a retry for a failed event'
);
insert into integration_recovery_ids(kind, id)
select 'retry_request', id
from erp.integration_retry_requests
where operation_key = 'integration-retry-op-001';
select is(
  erp.request_integration_retry(
    'e4100000-0000-0000-0000-000000000001', 'retry',
    'integration-retry-op-001', 'Retry after provider timeout'
  ),
  (select id from integration_recovery_ids where kind = 'retry_request'),
  'Same operation key and payload returns the same retry request UUID'
);
select throws_ok(
  $$select erp.request_integration_retry(
    'e4100000-0000-0000-0000-000000000001', 'retry',
    'integration-retry-op-001', 'Different payload'
  )$$,
  '23000', 'operation key is already used by another integration retry request',
  'Reusing an operation key with different data fails'
);
select throws_ok(
  $$select erp.claim_due_integration_retries(10, 120)$$,
  '42501', 'permission denied for function claim_due_integration_retries',
  'Authenticated operators cannot claim worker retries'
);
select throws_ok(
  $$select erp.record_claimed_integration_attempt(gen_random_uuid(), 'succeeded', null)$$,
  '42501', 'permission denied for function record_claimed_integration_attempt',
  'Authenticated operators cannot record claimed results'
);
reset role;

select set_config('request.jwt.claim.sub', 'e4000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select erp.request_integration_retry(
    'e4100000-0000-0000-0000-000000000001', 'retry',
    'integration-no-permission-op', 'Must be rejected'
  )$$,
  '42501', 'integrations.retry permission is required',
  'A role without integrations.retry cannot request retries'
);
reset role;

set local role postgres;
insert into erp.integration_retry_requests (
  id, organization_id, branch_id, outbox_id, root_request_id, action,
  request_origin, reason, operation_key, request_hash, attempt_count_snapshot,
  retry_sequence, available_at, requested_by
) values (
  'e4300000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'e4100000-0000-0000-0000-000000000002',
  'e4300000-0000-0000-0000-000000000001',
  'retry', 'operator', 'Worker retry fixture', 'integration-worker-op-001',
  md5('integration-worker-op-001'), 1, 1,
  clock_timestamp() - interval '1 second',
  'e4000000-0000-0000-0000-000000000001'
), (
  'e4300000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'e4100000-0000-0000-0000-000000000004',
  'e4300000-0000-0000-0000-000000000002',
  'retry', 'operator', 'Worker guard fixture', 'integration-worker-op-002',
  md5('integration-worker-op-002'), 1, 1,
  clock_timestamp() - interval '1 second',
  'e4000000-0000-0000-0000-000000000001'
);
reset role;

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select throws_ok(
  $$select * from erp.claim_due_integration_retries(0, 120)$$,
  '22023', 'valid batch limit and lease are required',
  'Claim rejects an invalid batch limit'
);
select throws_ok(
  $$select * from erp.claim_due_integration_retries(10, 29)$$,
  '22023', 'valid batch limit and lease are required',
  'Claim rejects a lease shorter than the minimum'
);
create temp table claimed_retry_fixture as
select * from erp.claim_due_integration_retries(10, 120);
select is((select count(*) from claimed_retry_fixture), 2::bigint, 'Worker claims each due retry once');
select ok((select claim_token is not null from claimed_retry_fixture where retry_request_id = 'e4300000-0000-0000-0000-000000000001'), 'Claim returns a claim token');
select ok((select retry_request_id = 'e4300000-0000-0000-0000-000000000001' and outbox_id = 'e4100000-0000-0000-0000-000000000002' from claimed_retry_fixture where retry_request_id = 'e4300000-0000-0000-0000-000000000001'), 'Claim binds the request to its outbox');
select ok((select lease_expires_at > claimed_at from erp.integration_retry_claims where retry_request_id = 'e4300000-0000-0000-0000-000000000001'), 'Claim creates a future lease');
select lives_ok(
  $$select erp.record_claimed_integration_attempt(
    (select claim_token from claimed_retry_fixture where retry_request_id = 'e4300000-0000-0000-0000-000000000001'),
    'succeeded', null
  )$$,
  'Worker can record a successful claimed result'
);
select is(
  erp.record_claimed_integration_attempt(
    (select claim_token from claimed_retry_fixture where retry_request_id = 'e4300000-0000-0000-0000-000000000001'),
    'succeeded', null
  ),
  (select id from erp.integration_attempts where retry_request_id = 'e4300000-0000-0000-0000-000000000001'),
  'Repeating the same claimed result returns the same attempt UUID'
);
select ok(
  exists(
    select 1 from erp.integration_attempts attempt
    where attempt.retry_request_id = 'e4300000-0000-0000-0000-000000000001'
      and attempt.worker_claim_token = (select claim_token from claimed_retry_fixture where retry_request_id = 'e4300000-0000-0000-0000-000000000001')
      and attempt.status = 'succeeded'
      and attempt.error_message is null
  ),
  'Claimed result stores both retry request and worker claim token'
);
reset role;

select set_config('request.jwt.claim.sub', 'e4000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select lives_ok(
  $$select erp.move_integration_to_dead_letter('e4100000-0000-0000-0000-000000000003', 'Permanent provider failure')$$,
  'Owner can move a failed event to dead letter'
);
insert into integration_recovery_ids(kind, id)
select 'dead_letter', id from erp.integration_dead_letters where outbox_id = 'e4100000-0000-0000-0000-000000000003';
select is(
  erp.move_integration_to_dead_letter('e4100000-0000-0000-0000-000000000003', 'Permanent provider failure'),
  (select id from integration_recovery_ids where kind = 'dead_letter'),
  'Moving the same event to dead letter with the same reason is idempotent'
);
select throws_ok(
  $$select erp.move_integration_to_dead_letter('e4100000-0000-0000-0000-000000000003', 'Different reason')$$,
  '23000', 'outbox item already has a different dead-letter reason',
  'A dead-letter event cannot change its reason'
);
select throws_ok(
  $$select erp.move_integration_to_dead_letter('e4100000-0000-0000-0000-000000000001', 'Pending retry')$$,
  '55000', 'pending retry must finish before dead letter',
  'An event with a pending retry cannot move to dead letter'
);
reset role;

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select throws_ok(
  $$select erp.record_claimed_integration_attempt(
    (select claim_token from claimed_retry_fixture where retry_request_id = 'e4300000-0000-0000-0000-000000000002'),
    'failed', null
  )$$,
  '22023', 'failed integration attempts require an error',
  'Claimed failed results require an error'
);
select throws_ok(
  $$select erp.record_claimed_integration_attempt(
    (select claim_token from claimed_retry_fixture where retry_request_id = 'e4300000-0000-0000-0000-000000000002'),
    'succeeded', 'unexpected error'
  )$$,
  '22023', 'successful integration attempts cannot include an error',
  'Claimed succeeded results reject an error'
);
reset role;

select * from finish();
rollback;
