begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

select has_function(
  'erp', 'export_report_rows',
  array['text', 'text', 'jsonb', 'date', 'date', 'uuid', 'integer'],
  'Official report export RPC exists'
);
select is(
  has_function_privilege('authenticated', 'erp.export_report_rows(text,text,jsonb,date,date,uuid,integer)', 'EXECUTE'),
  true,
  'Authenticated operators can execute official exports'
);
select is(
  has_function_privilege('anon', 'erp.export_report_rows(text,text,jsonb,date,date,uuid,integer)', 'EXECUTE'),
  false,
  'Anonymous clients cannot execute official exports'
);
select is(
  has_function_privilege('public', 'erp.export_report_rows(text,text,jsonb,date,date,uuid,integer)', 'EXECUTE'),
  false,
  'Public role cannot execute official exports'
);
select is(
  has_function_privilege('service_role', 'erp.export_report_rows(text,text,jsonb,date,date,uuid,integer)', 'EXECUTE'),
  false,
  'Service role is not an application export principal'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '00000000-0000-0000-0000-000000000000',
  'e5000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'reports-owner@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Reports Owner"}'::jsonb, now(), now()
),
(
  '00000000-0000-0000-0000-000000000000',
  'e5000000-0000-0000-0000-000000000002',
  'authenticated', 'authenticated', 'reports-no-export@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Reports Without Export"}'::jsonb, now(), now()
);
update erp.profiles
set organization_id = '10000000-0000-0000-0000-000000000001'
where id in (
  'e5000000-0000-0000-0000-000000000001',
  'e5000000-0000-0000-0000-000000000002'
);
insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values
(
  '10000000-0000-0000-0000-000000000001',
  'e5000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'e5000000-0000-0000-0000-000000000001'
),
(
  '10000000-0000-0000-0000-000000000001',
  'e5000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000002',
  'e5000000-0000-0000-0000-000000000002'
);

set local role postgres;
insert into erp.organizations (id, legal_name, display_name)
values ('e5100000-0000-0000-0000-000000000001', 'Foreign Export Org', 'Foreign Export Org');
insert into erp.branches (id, organization_id, code, name)
values (
  'e5200000-0000-0000-0000-000000000001',
  'e5100000-0000-0000-0000-000000000001',
  'FOREIGN', 'Foreign Export Branch'
);
insert into erp.audit_events (
  organization_id, branch_id, actor_user_id, schema_name, table_name,
  record_id, action, reason, metadata
) values
(
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'e5000000-0000-0000-0000-000000000001',
  'erp', 'audit_test', 'export-record-001', 'execute', 'First audit fixture',
  '{"numeric_value":42,"nullable_value":null}'::jsonb
),
(
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'e5000000-0000-0000-0000-000000000001',
  'erp', 'audit_test', 'export-record-002', 'execute', 'Second audit fixture',
  '{"numeric_value":7,"nullable_value":null}'::jsonb
);
reset role;

select set_config('request.jwt.claim.sub', 'e5000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

create temp table report_export_result(value jsonb) on commit drop;
insert into report_export_result(value)
select erp.export_report_rows(
  'audit', 'Export audit fixtures',
  '{"schema":"erp","table":"audit_test","action":"execute","status":"success","search":"export"}'::jsonb,
  null, null, '20000000-0000-0000-0000-000000000001', 1
);
select is((select value->>'report_code' from report_export_result), 'audit', 'Export response identifies the requested report');
select is((select (value->>'row_count')::integer from report_export_result), 1, 'Export response reports the bounded row count');
select is((select jsonb_array_length(value->'rows') from report_export_result), (select (value->>'row_count')::integer from report_export_result), 'row_count equals the returned rows length');
select is((select (value->>'truncated')::boolean from report_export_result), true, 'Export response reports truncation when the limit clips rows');
select is((select jsonb_typeof(value->'row_count') from report_export_result), 'number', 'row_count remains a JSON number');
select is((select jsonb_typeof(value->'rows') from report_export_result), 'array', 'rows remains a JSON array');

select is(
  (select count(*) from erp.audit_events
   where organization_id = '10000000-0000-0000-0000-000000000001'
     and branch_id = '20000000-0000-0000-0000-000000000001'
     and table_name = 'report_exports'
     and action = 'execute'
     and reason = 'Export audit fixtures'),
  1::bigint,
  'Each export creates exactly one report_exports execute audit event'
);
select is(
  (select metadata->>'report_code' from erp.audit_events where table_name = 'report_exports' and reason = 'Export audit fixtures' order by id desc limit 1),
  'audit',
  'Audit metadata records the report code'
);
select is(
  (select metadata->>'format' from erp.audit_events where table_name = 'report_exports' and reason = 'Export audit fixtures' order by id desc limit 1),
  'csv',
  'Audit metadata records the export format'
);
select is(
  ((select metadata from erp.audit_events where table_name = 'report_exports' and reason = 'Export audit fixtures' order by id desc limit 1)->>'row_count')::integer,
  1,
  'Audit metadata records the exported row count'
);
select is(
  ((select metadata from erp.audit_events where table_name = 'report_exports' and reason = 'Export audit fixtures' order by id desc limit 1)->>'truncated')::boolean,
  true,
  'Audit metadata records truncation'
);
select ok(
  not ((select metadata from erp.audit_events where table_name = 'report_exports' and reason = 'Export audit fixtures' order by id desc limit 1) ? 'rows'),
  'Audit metadata does not embed complete exported rows'
);

select lives_ok(
  $$select erp.export_report_rows('iva_ventas', 'IVA sales export', '{}'::jsonb, null, null, '20000000-0000-0000-0000-000000000001', 10)$$,
  'IVA sales is an allowlisted report'
);
select lives_ok(
  $$select erp.export_report_rows('iva_compras', 'IVA purchases export', '{}'::jsonb, null, null, '20000000-0000-0000-0000-000000000001', 10)$$,
  'IVA purchases is an allowlisted report'
);
select lives_ok(
  $$select erp.export_report_rows('trial_balance', 'Trial balance export', '{}'::jsonb, null, null, '20000000-0000-0000-0000-000000000001', 10)$$,
  'Trial balance is an allowlisted report'
);
select lives_ok(
  $$select erp.export_report_rows('profitability', 'Profitability export', '{}'::jsonb, null, null, '20000000-0000-0000-0000-000000000001', 10)$$,
  'Profitability is an allowlisted report'
);
select throws_ok(
  $$select erp.export_report_rows('not_allowlisted', 'Unknown report', '{}'::jsonb, null, null, '20000000-0000-0000-0000-000000000001', 10)$$,
  '22023', 'unsupported ERP report code',
  'Unknown report codes are rejected'
);
select throws_ok(
  $$select erp.export_report_rows('audit', 'no', '{}'::jsonb, null, null, '20000000-0000-0000-0000-000000000001', 10)$$,
  '22023', 'an export reason of at least 3 characters is required',
  'Export reasons shorter than three characters are rejected'
);
select throws_ok(
  $$select erp.export_report_rows('audit', 'Bad limit', '{}'::jsonb, null, null, '20000000-0000-0000-0000-000000000001', 0)$$,
  '22023', 'row_limit must be between 1 and 5000',
  'Zero row limits are rejected'
);
select throws_ok(
  $$select erp.export_report_rows('audit', 'Inverted dates', '{}'::jsonb, '2026-09-20', '2026-09-19', '20000000-0000-0000-0000-000000000001', 10)$$,
  '22023', 'date_from cannot be after date_to',
  'Inverted date ranges are rejected'
);
select throws_ok(
  $$select erp.export_report_rows('audit', 'Unknown filter', '{"not_allowed":true}'::jsonb, null, null, '20000000-0000-0000-0000-000000000001', 10)$$,
  '22023', 'unsupported filter key: not_allowed',
  'Unknown audit filters are rejected'
);
select throws_ok(
  $$select erp.export_report_rows('audit', 'Array filters', '[]'::jsonb, null, null, '20000000-0000-0000-0000-000000000001', 10)$$,
  '22023', 'filters must be a JSON object',
  'Non-object filters are rejected'
);
select throws_ok(
  $$select erp.export_report_rows('audit', 'Foreign branch', '{}'::jsonb, null, null, 'e5200000-0000-0000-0000-000000000001', 10)$$,
  '22023', 'target branch does not belong to the active organization',
  'A branch from another organization is rejected without exposing rows'
);
reset role;

select set_config('request.jwt.claim.sub', 'e5000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select erp.export_report_rows('audit', 'No export permission', '{}'::jsonb, null, null, '20000000-0000-0000-0000-000000000001', 10)$$,
  '42501', 'reports.export permission is required for the target branch',
  'A seeded role without reports.export cannot export organizational data'
);
reset role;

select * from finish();
rollback;
