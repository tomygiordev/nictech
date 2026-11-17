begin;
create extension if not exists pgtap with schema extensions;
select plan(32);
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'erp.v_iva_ventas'::regclass), 'Sales tax view preserves RLS');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'erp.v_iva_compras'::regclass), 'Purchase tax view preserves RLS');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'erp.v_trial_balance'::regclass), 'Trial balance preserves RLS');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'erp.v_profitability_by_line'::regclass), 'Profitability preserves RLS');
select ok((select reloptions @> array['security_barrier=true'] from pg_class where oid = 'erp.trade_ins_overview'::regclass), 'Trade-in overview protects tenant predicates');
select ok((select reloptions @> array['security_barrier=true'] from pg_class where oid = 'erp.pc_build_projects_overview'::regclass), 'PC build overview protects tenant predicates');
select ok(not has_table_privilege('anon', 'erp.trade_ins_overview', 'select'), 'Anonymous cannot read trade-in overview');
select ok(not has_table_privilege('anon', 'erp.pc_build_projects_overview', 'select'), 'Anonymous cannot read PC build overview');
select ok(has_table_privilege('authenticated', 'erp.trade_ins_overview', 'select'), 'ERP members can read trade-in overview through RLS');
select ok(has_table_privilege('authenticated', 'erp.pc_build_projects_overview', 'select'), 'ERP members can read PC build overview through RLS');
select ok(not has_function_privilege('anon', 'erp.ensure_open_period(date,uuid)', 'execute'), 'Anonymous cannot create accounting periods');
select ok(not has_function_privilege('authenticated', 'erp.ensure_open_period(date,uuid)', 'execute'), 'Accounting helper is internal');
select ok(not has_function_privilege('anon', 'erp.get_current_erp_context()', 'execute'), 'Anonymous cannot read ERP context');
select ok(has_function_privilege('authenticated', 'erp.get_current_erp_context()', 'execute'), 'ERP members can request their authorization context');
select ok(not has_function_privilege('authenticated', 'erp.process_mercadopago_payment(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,numeric,text,text,jsonb,jsonb,timestamptz,jsonb)', 'execute'), 'Browser cannot forge provider payments');
select ok(has_function_privilege('service_role', 'erp.process_mercadopago_payment(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,numeric,text,text,jsonb,jsonb,timestamptz,jsonb)', 'execute'), 'Verified payment adapter can commit payments');
select ok((select relrowsecurity from pg_class where oid = 'erp.storefront_payment_syncs'::regclass), 'Payment sync receipts have RLS');
select ok(not has_table_privilege('authenticated', 'erp.storefront_payment_syncs', 'insert'), 'Browser cannot insert payment receipts');
select ok(not has_function_privilege('authenticated', 'erp.ensure_default_accounting_setup(uuid)', 'execute'), 'Accounting provisioning helper is internal');
select is((select count(*) from erp.chart_of_accounts where organization_id = '10000000-0000-0000-0000-000000000001'), 11::bigint, 'Seed organization receives the standard chart of accounts');
select is((select count(*) from erp.accounting_account_roles where organization_id = '10000000-0000-0000-0000-000000000001'), 11::bigint, 'Seed organization receives every standard accounting role');
insert into erp.organizations (id, legal_name, display_name)
values ('ee000000-0000-0000-0000-000000000001', 'ERP Provision Test', 'ERP Provision Test');
select is((
  select count(*)
  from erp.accounting_account_roles role
  join erp.chart_of_accounts account
    on account.id = role.account_id
   and account.organization_id = role.organization_id
  where role.organization_id = 'ee000000-0000-0000-0000-000000000001'
), 11::bigint, 'New organizations receive valid accounting defaults automatically');
select matches((select qual from pg_policies where schemaname = 'erp' and tablename = 'profiles' and policyname = 'profiles_select_allowed'), 'SELECT auth[.]uid','Profile self-access initializes auth.uid once per statement');
select matches((select qual from pg_policies where schemaname = 'erp' and tablename = 'profile_roles' and policyname = 'profile_roles_select_allowed'), 'SELECT auth[.]uid','Profile role self-access initializes auth.uid once per statement');
select matches((select qual from pg_policies where schemaname = 'erp' and tablename = 'profile_permission_overrides' and policyname = 'overrides_select_allowed'), 'SELECT auth[.]uid','Permission override self-access initializes auth.uid once per statement');
select is((select count(*) from pg_policies where schemaname = 'erp' and tablename = 'locations' and cmd = 'SELECT' and roles @> array['authenticated'::name]), 1::bigint, 'Locations expose one permissive SELECT policy');
select is((select count(*) from pg_policies where schemaname = 'erp' and tablename = 'roles' and cmd = 'SELECT' and roles @> array['authenticated'::name]), 1::bigint, 'Roles expose one permissive SELECT policy');
select is((select count(*) from pg_policies where schemaname = 'erp' and tablename = 'locations' and cmd in ('INSERT', 'UPDATE', 'DELETE') and roles @> array['authenticated'::name]), 3::bigint, 'Location management keeps explicit mutation policies');
select is((select count(*) from pg_policies where schemaname = 'erp' and tablename = 'roles' and cmd in ('INSERT', 'UPDATE', 'DELETE') and roles @> array['authenticated'::name]), 3::bigint, 'Role management keeps explicit mutation policies');
select matches((select qual from pg_policies where schemaname = 'erp' and tablename = 'roles' and policyname = 'roles_select_allowed'), 'users[.]manage','Role managers retain read access through the consolidated policy');
select ok(not has_schema_privilege('anon', 'erp', 'usage'), 'Anonymous clients cannot address the exposed ERP schema');
select is((
  select count(*)
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'erp'
    and has_function_privilege('anon', procedure.oid, 'execute')
), 0::bigint, 'Anonymous clients cannot execute ERP functions');
select * from finish();
rollback;
