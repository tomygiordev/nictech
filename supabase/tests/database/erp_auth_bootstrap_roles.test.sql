begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
create temporary table auth_test_ids (kind text primary key, id uuid not null);
insert into auth_test_ids values ('first',gen_random_uuid()),('second',gen_random_uuid()),('third',gen_random_uuid()),('bootstrap',gen_random_uuid()),('org',gen_random_uuid());
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id,'authenticated','authenticated',id::text||'@example.test','{}','{}',now(),now() from auth_test_ids where kind='first';
select ok(exists(select 1 from erp.profiles where id=(select id from auth_test_ids where kind='first') and organization_id is not null),'Una organización única crea perfil');
select ok(not exists(select 1 from erp.profile_roles where profile_id=(select id from auth_test_ids where kind='first')),'Usuario nuevo no recibe rol');
select set_config('request.jwt.claim.sub',(select id::text from auth_test_ids where kind='first'),true);
select set_config('request.jwt.claim.role','authenticated',true);
select ok(not erp.has_permission('catalog.manage') and not erp.has_permission('users.manage') and not erp.has_permission('stock.manage'),'Usuario nuevo no recibe permisos ERP');
set local role authenticated;
select is((select count(*) from erp.products),0::bigint,'El usuario nuevo no puede leer productos ERP');
reset role;
select ok(not has_function_privilege('authenticated','erp.bootstrap_first_owner(uuid)','execute') and not has_function_privilege('anon','erp.bootstrap_first_owner(uuid)','execute'),'Bootstrap no es ejecutable por clientes');
insert into erp.organizations(id,legal_name,display_name) select id,'Fixture organización','Fixture organización' from auth_test_ids where kind='org';
insert into erp.roles(organization_id,code,name) select id,'owner','Owner' from auth_test_ids where kind='org';
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id,'authenticated','authenticated',id::text||'@example.test','{}','{}',now(),now() from auth_test_ids where kind='bootstrap';
insert into erp.profiles(id,organization_id,display_name) select (select id from auth_test_ids where kind='bootstrap'),(select id from auth_test_ids where kind='org'),'Fixture';
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$select erp.bootstrap_first_owner((select id from auth_test_ids where kind='bootstrap'))$$,'Bootstrap explícito instala el primer owner');
select ok(exists(select 1 from erp.profile_roles pr join erp.roles r on r.id=pr.role_id where pr.profile_id=(select id from auth_test_ids where kind='bootstrap') and r.code='owner'),'Owner asignado explícitamente');
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id,'authenticated','authenticated',id::text||'@example.test','{}','{}',now(),now() from auth_test_ids where kind='second';
select ok(not exists(select 1 from erp.profile_roles where profile_id=(select id from auth_test_ids where kind='second')),'El segundo usuario no hereda owner');
select ok(exists(select 1 from erp.profile_roles pr join erp.roles r on r.id=pr.role_id where pr.profile_id=(select id from auth_test_ids where kind='bootstrap') and r.code='owner'),'Owner existente conserva el rol');
select throws_ok($$select erp.bootstrap_first_owner((select id from auth_test_ids where kind='bootstrap'))$$,'55000','organization already has active role assignments','Bootstrap no habilita otro owner');
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id,'authenticated','authenticated',id::text||'@example.test','{}','{}',now(),now() from auth_test_ids where kind='third';
select ok(not exists(select 1 from erp.profiles where id=(select id from auth_test_ids where kind='third')),'Con varias organizaciones no se asigna membresía');
select ok(not exists(select 1 from erp.profile_roles where profile_id=(select id from auth_test_ids where kind='third')),'Con varias organizaciones no se asigna rol');
select * from finish();
rollback;
