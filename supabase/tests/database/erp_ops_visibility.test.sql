begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

-- La policy SELECT de DLQ existe desde 202608190009 pero el GRANT solo llegaba a
-- service_role: authenticated no leia nada aunque tuviera integrations.view.
select has_table('erp', 'integration_dead_letters', 'Dead-letter queue exists');
select is(
  has_table_privilege('authenticated', 'erp.integration_dead_letters', 'SELECT'),
  true,
  'Authenticated operators can read dead letters'
);
select ok(exists(
  select 1 from pg_policies
  where schemaname = 'erp'
    and tablename = 'integration_dead_letters'
    and policyname = 'integration_dead_letters_select'
    and qual like '%integrations.view%'
), 'Dead-letter reads stay gated by integrations.view');
select ok(
  (select relrowsecurity from pg_class where oid = 'erp.integration_dead_letters'::regclass),
  'Dead letters enforce RLS'
);
select is(
  has_table_privilege('authenticated', 'erp.integration_dead_letters', 'INSERT'),
  false,
  'Authenticated operators cannot write dead letters directly'
);
select is(
  has_table_privilege('service_role', 'erp.integration_dead_letters', 'SELECT'),
  true,
  'Service role retains dead-letter reads'
);

-- Auditoria: la policy audit_events_select_allowed (audit.view) ya exponia la fila
-- completa incluido actor_user_id; 011 lo deja en un GRANT explicito.
select has_table('erp', 'audit_events', 'Audit events exist');
select is(
  has_column_privilege('authenticated', 'erp.audit_events', 'actor_user_id', 'SELECT'),
  true,
  'Authenticated auditors can read the audit actor'
);
select ok(exists(
  select 1 from pg_policies
  where schemaname = 'erp'
    and tablename = 'audit_events'
    and policyname = 'audit_events_select_allowed'
), 'Audit reads stay gated by audit.view');
select is(
  has_table_privilege('authenticated', 'erp.audit_events', 'UPDATE'),
  false,
  'Authenticated operators cannot mutate audit events'
);

select * from finish();
rollback;
