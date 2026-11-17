begin;
set local search_path = public, extensions, erp, pg_catalog;
select plan(14);
insert into erp.organizations (id, legal_name, display_name) values ('99000000-0000-0000-0000-000000000001', 'Otra organización', 'Otra organización');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('88000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid, 'authenticated', 'authenticated', 'role-fixture-' || i || '@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()
from generate_series(1,4) i;
insert into erp.profiles (id, organization_id, display_name) select ('88000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid, case when i=4 then '99000000-0000-0000-0000-000000000001'::uuid else '10000000-0000-0000-0000-000000000001'::uuid end, 'Operador ' || i from generate_series(1,4) i on conflict (id) do nothing;
update erp.profiles set organization_id = '10000000-0000-0000-0000-000000000001' where id in ('88000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-000000000002','88000000-0000-0000-0000-000000000003');
update erp.profiles set organization_id = '99000000-0000-0000-0000-000000000001' where id = '88000000-0000-0000-0000-000000000004';
insert into erp.roles (id, organization_id, code, name) values ('49000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','admin','Admin'), ('49000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','basic','Básico');
insert into erp.role_permissions (organization_id, role_id, permission_id)
select '10000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000001',id from erp.permissions where code='users.manage';
update erp.profile_roles set valid_until = greatest(clock_timestamp(),valid_from + interval '1 microsecond') where profile_id in ('88000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-000000000002','88000000-0000-0000-0000-000000000003');
insert into erp.profile_roles (organization_id, profile_id, role_id, branch_id, valid_from, valid_until)
values ('10000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',null,now(),null)
on conflict (profile_id, role_id) where branch_id is null do update set valid_from=excluded.valid_from, valid_until=null;
insert into erp.profile_roles (organization_id, profile_id, role_id) values ('10000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-000000000003','49000000-0000-0000-0000-000000000001');
select ok(not has_function_privilege('anon','erp.assign_profile_role(uuid,uuid)','execute'), 'anon no ejecuta');
select ok(not has_table_privilege('authenticated','erp.profile_roles','insert') and not has_table_privilege('authenticated','erp.profile_roles','update'), 'asignaciones directas revocadas');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select throws_ok($$select erp.assign_profile_role('88000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001')$$,'42501',null,'usuario sin rol rechazado');
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000001',true);
select throws_ok($$select erp.assign_profile_role('88000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002')$$,'42501',null,'no cambia rol propio');
select throws_ok($$select erp.assign_profile_role('88000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000002')$$,'22023',null,'no cambia perfil de otra organización');
select throws_ok($$select erp.assign_profile_role('88000000-0000-0000-0000-000000000002','49000000-0000-0000-0000-000000000099')$$,'22023',null,'rol inexistente rechazado');
select lives_ok($$select erp.assign_profile_role('88000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002')$$,'owner asigna rol');
reset role;
select is((select count(*)::int from erp.profile_roles where profile_id='88000000-0000-0000-0000-000000000002' and role_id='40000000-0000-0000-0000-000000000002' and valid_until is null),1,'rol global vigente');
set local role authenticated;
select lives_ok($$select erp.assign_profile_role('88000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003')$$,'owner cambia rol');
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000003',true);
select throws_ok($$select erp.assign_profile_role('88000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001')$$,'42501',null,'admin no asigna owner');
select throws_ok($$select erp.assign_profile_role('88000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003')$$,'42501',null,'admin no modifica owner');
select lives_ok($$select erp.assign_profile_role('88000000-0000-0000-0000-000000000002','49000000-0000-0000-0000-000000000002')$$,'admin asigna rol sin permisos sensibles');
reset role;
insert into erp.profile_permission_overrides (organization_id, profile_id, permission_id, branch_id, effect, reason, valid_from, valid_until)
select '10000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-000000000001',id,null,'deny','Bloqueo de users.manage para test',now(),null
from erp.permissions where code='users.manage';
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$select erp.assign_profile_role('88000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002')$$,'42501',null,'owner con override deny sobre users.manage es rechazado');
reset role;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000','88000000-0000-0000-0000-000000000005','authenticated','authenticated','role-fixture-5@test.invalid','','{}'::jsonb,'{}'::jsonb,now(),now());
insert into erp.profiles (id, organization_id, display_name)
values ('88000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','Operador 5') on conflict (id) do nothing;
insert into erp.roles (id, organization_id, code, name)
values ('49000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','custom_user_mgr','Gestor custom');
insert into erp.role_permissions (organization_id, role_id, permission_id)
select '10000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000003',id from erp.permissions where code='users.manage';
insert into erp.profile_roles (organization_id, profile_id, role_id)
values ('10000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-000000000005','49000000-0000-0000-0000-000000000003');
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000005',true);
set local role authenticated;
select throws_ok($$select erp.assign_profile_role('88000000-0000-0000-0000-000000000002','49000000-0000-0000-0000-000000000002')$$,'42501',null,'rol custom con users.manage sin ser owner o admin es rechazado');
select * from finish();
rollback;
