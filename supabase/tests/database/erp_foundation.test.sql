begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

select has_schema('erp', 'ERP schema exists');
select has_table('erp', 'organizations', 'Organizations table exists');
select has_table('erp', 'branches', 'Branches table exists');
select has_table('erp', 'locations', 'Locations table exists');
select has_table('erp', 'profiles', 'Profiles table exists');
select has_table('erp', 'roles', 'Roles table exists');
select has_table('erp', 'permissions', 'Permissions table exists');
select has_table('erp', 'audit_events', 'Audit table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'erp.profiles'::regclass),
  'Profiles enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'erp.audit_events'::regclass),
  'Audit events enforce RLS'
);

select is(
  erp.has_permission('users.manage'),
  false,
  'An unauthenticated request has no ERP permissions'
);

select is(
  (select count(*) from erp.locations where organization_id = '10000000-0000-0000-0000-000000000001'),
  8::bigint,
  'Seed creates the eight initial stock locations'
);

select ok(
  (select count(*) >= 60 from erp.permissions),
  'Seed provides the initial permission catalog'
);

select has_column(
  'erp',
  'profile_roles',
  'organization_id',
  'Role assignments carry an explicit organization boundary'
);

select has_column(
  'erp',
  'profile_permission_overrides',
  'organization_id',
  'Permission overrides carry an explicit organization boundary'
);

select has_column(
  'erp',
  'role_permissions',
  'is_active',
  'Role permissions can be revoked without deleting history'
);

select ok(
  not exists (
    select 1
    from erp.audit_events
    where table_name = 'role_permissions'
      and (organization_id is null or record_id is null)
  ),
  'Role permission audit events retain tenant and record identity'
);

select has_function(
  'erp',
  'bootstrap_owner',
  array['uuid', 'uuid'],
  'A controlled first-owner bootstrap function exists'
);

select ok(
  exists (
    select 1
    from erp.permissions
    where code = 'configuration.view_secret'
      and is_sensitive
  ),
  'Secret configuration values require a dedicated sensitive permission'
);

select lives_ok(
  $$
    insert into erp.audit_events (
      organization_id,
      schema_name,
      table_name,
      record_id,
      action,
      metadata
    ) values (
      '10000000-0000-0000-0000-000000000001',
      'erp',
      'test_record',
      '1',
      'execute',
      '{"test": true}'::jsonb
    )
  $$,
  'An audit event can be appended'
);

select throws_ok(
  $$update erp.audit_events set reason = 'tampered' where table_name = 'test_record'$$,
  '23000',
  'audit events are append-only',
  'Audit events cannot be updated'
);

select throws_ok(
  $$delete from erp.audit_events where table_name = 'test_record'$$,
  '23000',
  'audit events are append-only',
  'Audit events cannot be deleted'
);

select throws_ok(
  $$delete from erp.locations where id = '30000000-0000-0000-0000-000000000007'$$,
  '23000',
  'erp.locations records must be deactivated or reversed, not deleted',
  'Master records cannot be hard-deleted'
);

select lives_ok(
  $$
    insert into erp.configuration_values (
      organization_id,
      key,
      value,
      is_secret
    ) values (
      '10000000-0000-0000-0000-000000000001',
      'tests.secret',
      '"never-audit-this"'::jsonb,
      true
    )
  $$,
  'A secret configuration value can be stored'
);

select is(
  (
    select new_values ->> 'value'
    from erp.audit_events
    where table_name = 'configuration_values'
      and new_values ->> 'key' = 'tests.secret'
    order by id desc
    limit 1
  ),
  '[redacted]',
  'Secret configuration values are redacted from audit payloads'
);

select throws_ok(
  $$select erp.bootstrap_owner(gen_random_uuid(), '10000000-0000-0000-0000-000000000001')$$,
  '42501',
  'bootstrap_owner requires the service role',
  'An ordinary database request cannot bootstrap an owner'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'erp.configuration_values'::regclass
      and conname = 'configuration_branch_organization_fk'
  ),
  'Configuration branch references cannot cross organizations'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'erp.audit_events'::regclass
      and conname = 'audit_branch_organization_fk'
  ),
  'Audit branch references cannot cross organizations'
);

select is(
  has_table_privilege('authenticated', 'erp.permissions', 'UPDATE'),
  false,
  'Authenticated tenant administrators cannot mutate the global permission catalog'
);

select is(
  has_sequence_privilege('authenticated', 'erp.audit_events_id_seq', 'USAGE'),
  false,
  'Authenticated users cannot consume audit sequence values'
);

select results_eq(
  $$
    select effect::text
    from unnest(enum_range(null::erp.permission_effect)) effect
    order by effect::text
  $$,
  $$values ('allow'::text), ('deny'::text)$$,
  'Permission effects support explicit allow and deny'
);

select * from finish();
rollback;
