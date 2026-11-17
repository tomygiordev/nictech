-- Harden the ERP now that the custom schema is exposed through PostgREST.
-- Anonymous clients use public tokenized RPCs only; they never call erp.*.

begin;

revoke usage on schema erp from public, anon;
grant usage on schema erp to authenticated, service_role;

revoke all privileges on all tables in schema erp from public, anon;
revoke all privileges on all sequences in schema erp from public, anon;
revoke execute on all functions in schema erp from public, anon;

alter default privileges in schema erp revoke all on tables from public;
alter default privileges in schema erp revoke all on sequences from public;
alter default privileges in schema erp revoke execute on functions from public;

-- These two views intentionally mediate access to selected sensitive columns.
-- Their own tenant/permission predicates are protected from push-down by the
-- security barrier; making them invoker views would require granting raw IMEI,
-- serial and cost columns and would weaken the ERP's column-level controls.
alter view erp.trade_ins_overview
  set (security_invoker = false, security_barrier = true);
alter view erp.pc_build_projects_overview
  set (security_invoker = false, security_barrier = true);

commit;
