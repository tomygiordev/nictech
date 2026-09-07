begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- Setup: usuario propietario con acceso total (rol owner del seed).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '88000000-0000-0000-0000-000000000096',
  'authenticated', 'authenticated', 'system-test@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"System Test Staff"}'::jsonb, now(), now()
);

update erp.profiles
   set organization_id = '10000000-0000-0000-0000-000000000001'
 where id = '88000000-0000-0000-0000-000000000096';

insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  '88000000-0000-0000-0000-000000000096',
  '40000000-0000-0000-0000-000000000001',
  '88000000-0000-0000-0000-000000000096'
);

-- Setup: segunda organizacion con usuario propio (para RLS entre orgs).
insert into erp.organizations (id, legal_name, display_name)
values ('90000000-0000-0000-0000-000000000001', 'Otra Org', 'Otra Org');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '88000000-0000-0000-0000-000000000095',
  'authenticated', 'authenticated', 'system-other@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"System Other Org"}'::jsonb, now(), now()
);

update erp.profiles
   set organization_id = '90000000-0000-0000-0000-000000000001'
 where id = '88000000-0000-0000-0000-000000000095';

-- Setup: usuario de la org principal sin permisos (para RLS de escritura).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '88000000-0000-0000-0000-000000000094',
  'authenticated', 'authenticated', 'system-noperm@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"System Sin Permisos"}'::jsonb, now(), now()
);

update erp.profiles
   set organization_id = '10000000-0000-0000-0000-000000000001'
 where id = '88000000-0000-0000-0000-000000000094';

-- Autenticarse como propietario.
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000096',true);
set local role authenticated;

-- 1. Insert global (branch_id null).
select lives_ok(
  $$insert into erp.system_settings (organization_id, branch_id, key, value)
    values ('10000000-0000-0000-0000-000000000001', null, 'security.two_factor', '{"habilitado": true}'::jsonb)$$,
  'Insert de ajuste global (branch null) permitido con system.manage'
);

-- 2. Insert por sucursal.
select lives_ok(
  $$insert into erp.system_settings (organization_id, branch_id, key, value)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'security.two_factor', '{"habilitado": false}'::jsonb)$$,
  'Insert de ajuste por sucursal permitido con system.manage'
);

-- 3. La misma clave convive en alcance global y por sucursal.
select is(
  (select count(*)::int from erp.system_settings where key = 'security.two_factor'),
  2,
  'La misma clave existe una vez global y una vez por sucursal'
);

-- 4. Clave global duplicada rechazada.
select throws_ok(
  $$insert into erp.system_settings (organization_id, branch_id, key, value)
    values ('10000000-0000-0000-0000-000000000001', null, 'security.two_factor', '{"habilitado": true}'::jsonb)$$,
  '23505',
  'duplicate key value violates unique constraint "system_settings_scope_pkey"',
  'Clave global duplicada viola la PK de alcance'
);

-- 5. Clave por sucursal duplicada rechazada.
select throws_ok(
  $$insert into erp.system_settings (organization_id, branch_id, key, value)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'security.two_factor', '{"habilitado": true}'::jsonb)$$,
  '23505',
  'duplicate key value violates unique constraint "system_settings_scope_pkey"',
  'Clave por sucursal duplicada viola la PK de alcance'
);

-- 6. Formato de clave invalido rechazado.
select throws_ok(
  $$insert into erp.system_settings (organization_id, branch_id, key, value)
    values ('10000000-0000-0000-0000-000000000001', null, 'SIN-FORMATO', '{"x": 1}'::jsonb)$$,
  '23514',
  'new row for relation "system_settings" violates check constraint "system_settings_key_format"',
  'Clave con formato invalido viola el check de formato'
);

-- 7. Update del valor global.
select lives_ok(
  $$update erp.system_settings set value = '{"habilitado": false}'::jsonb
    where organization_id = '10000000-0000-0000-0000-000000000001'
      and branch_id is null and key = 'security.two_factor'$$,
  'Update de ajuste global permitido con system.manage'
);

-- 8. Valor actualizado correctamente.
select is(
  (select value from erp.system_settings
    where organization_id = '10000000-0000-0000-0000-000000000001'
      and branch_id is null and key = 'security.two_factor'),
  '{"habilitado": false}'::jsonb,
  'El valor global actualizado persiste'
);

-- 9. RLS: usuario de otra organizacion no ve los ajustes.
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000095',true);

select is(
  (select count(*)::int from erp.system_settings),
  0,
  'RLS oculta los ajustes a usuarios de otra organizacion'
);

-- 10. RLS: usuario sin system.manage no puede insertar.
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000094',true);

select throws_ok(
  $$insert into erp.system_settings (organization_id, branch_id, key, value)
    values ('10000000-0000-0000-0000-000000000001', null, 'security.session_timeout', '{"minutos": 30}'::jsonb)$$,
  '42501',
  'new row violates row-level security policy for table "system_settings"',
  'RLS rechaza el insert sin permiso system.manage'
);

-- 11. RLS: usuario sin system.manage no modifica (0 filas, sin error).
select lives_ok(
  $$update erp.system_settings set value = '{"habilitado": true}'::jsonb
    where organization_id = '10000000-0000-0000-0000-000000000001'
      and branch_id is null and key = 'security.two_factor'$$,
  'Update sin permiso no altera filas en lugar de fallar'
);

-- 12. El valor sigue intacto tras el intento sin permiso.
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000096',true);

select is(
  (select value from erp.system_settings
    where organization_id = '10000000-0000-0000-0000-000000000001'
      and branch_id is null and key = 'security.two_factor'),
  '{"habilitado": false}'::jsonb,
  'El valor no cambio tras el update sin permiso'
);

select * from finish();
rollback;
