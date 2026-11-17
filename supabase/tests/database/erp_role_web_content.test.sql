begin;

create extension if not exists pgtap with schema extensions;

set local search_path = public, extensions, erp, pg_catalog;

select plan(11);

-- 1. Todas las organizaciones existentes tienen el rol web_content.
select is(
  (
    select count(*)::bigint
    from erp.organizations o
    where not exists (
      select 1
      from erp.roles r
      where r.organization_id = o.id
        and r.code = 'web_content'
        and r.name = 'Contenido web'
        and r.is_active
    )
  ),
  0::bigint,
  'Cada organizacion existente tiene el rol activo web_content (Contenido web)'
);

-- 2. Nueva organizacion recibe el rol web_content automaticamente.
insert into erp.organizations (id, legal_name, display_name)
values ('99180000-0000-0000-0000-000000000001', 'Org Contenido Web Test', 'Org Contenido Web Test');

select is(
  (
    select count(*)::bigint
    from erp.roles r
    where r.organization_id = '99180000-0000-0000-0000-000000000001'
      and r.code = 'web_content'
      and r.name = 'Contenido web'
      and r.is_active
  ),
  1::bigint,
  'Una organizacion nueva recibe automaticamente exactamente un rol web_content'
);

-- 3. Re-ejecucion idempotente con on conflict on constraint roles_code_unique do nothing.
insert into erp.roles (organization_id, code, name, description, is_system)
values (
  '99180000-0000-0000-0000-000000000001',
  'web_content',
  'Contenido web',
  'Reintento idempotente',
  true
)
on conflict on constraint roles_code_unique do nothing;

select is(
  (
    select count(*)::bigint
    from erp.roles r
    where r.organization_id = '99180000-0000-0000-0000-000000000001'
      and r.code = 'web_content'
  ),
  1::bigint,
  'El rol web_content es unico por organizacion y re-ejecutable'
);

-- 4. La unique constraint real impide duplicar (organization_id, code).
select throws_ok(
  $$
    insert into erp.roles (organization_id, code, name)
    values ('99180000-0000-0000-0000-000000000001', 'web_content', 'Contenido web duplicado')
  $$,
  '23505',
  null,
  'No se puede duplicar code = web_content dentro de la misma organizacion'
);

-- 5. El rol web_content no tiene permisos asignados.
select is(
  (
    select count(*)::bigint
    from erp.role_permissions rp
    join erp.roles r on r.id = rp.role_id
    where r.code = 'web_content'
  ),
  0::bigint,
  'El rol web_content no tiene permisos asignados en role_permissions'
);

-- 6. Sin permisos operativos (catalog.*, stock.*, pricing.*, repairs.*, sales.*, cash.*, users.*).
select is(
  (
    select count(*)::bigint
    from erp.role_permissions rp
    join erp.roles r on r.id = rp.role_id
    join erp.permissions p on p.id = rp.permission_id
    where r.code = 'web_content'
      and (
        p.code like 'catalog.%'
        or p.code like 'stock.%'
        or p.code like 'pricing.%'
        or p.code like 'repairs.%'
        or p.code like 'sales.%'
        or p.code like 'cash.%'
        or p.code like 'users.%'
      )
  ),
  0::bigint,
  'El rol web_content no posee permisos operativos ni de usuarios'
);

-- Fixtures para probar assign_profile_role y erp.has_permission.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '88180000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'web-content-owner@test.invalid',
    '',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '88180000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'web-content-editor@test.invalid',
    '',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into erp.profiles (id, organization_id, display_name, is_active)
values
  ('88180000-0000-0000-0000-000000000001', '99180000-0000-0000-0000-000000000001', 'Owner Test', true),
  ('88180000-0000-0000-0000-000000000002', '99180000-0000-0000-0000-000000000001', 'Editor Web Test', true)
on conflict (id) do update
set organization_id = excluded.organization_id,
    display_name = excluded.display_name,
    is_active = true;

insert into erp.roles (id, organization_id, code, name, is_system)
values ('49180000-0000-0000-0000-000000000001', '99180000-0000-0000-0000-000000000001', 'owner', 'Responsable Test', true);

insert into erp.role_permissions (organization_id, role_id, permission_id)
select '99180000-0000-0000-0000-000000000001', '49180000-0000-0000-0000-000000000001', p.id
from erp.permissions p
where p.code = 'users.manage';

insert into erp.profile_roles (organization_id, profile_id, role_id, branch_id, valid_from, valid_until)
values (
  '99180000-0000-0000-0000-000000000001',
  '88180000-0000-0000-0000-000000000001',
  '49180000-0000-0000-0000-000000000001',
  null,
  now(),
  null
);

-- 7. Un owner puede asignar el rol web_content con erp.assign_profile_role.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '88180000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$
    select erp.assign_profile_role(
      '88180000-0000-0000-0000-000000000002',
      (
        select r.id
        from erp.roles r
        where r.organization_id = '99180000-0000-0000-0000-000000000001'
          and r.code = 'web_content'
      )
    )
  $$,
  'Owner puede asignar el rol web_content mediante erp.assign_profile_role'
);

reset role;

-- 8. El usuario asignado tiene una membresia global vigente con web_content.
select is(
  (
    select count(*)::bigint
    from erp.profile_roles pr
    join erp.roles r on r.id = pr.role_id
    where pr.profile_id = '88180000-0000-0000-0000-000000000002'
      and pr.organization_id = '99180000-0000-0000-0000-000000000001'
      and r.code = 'web_content'
      and pr.branch_id is null
      and pr.valid_until is null
  ),
  1::bigint,
  'El usuario queda asignado al rol web_content de forma vigente'
);

-- 9-11. El usuario con web_content obtiene false en permisos operativos.
set local role authenticated;
select set_config('request.jwt.claim.sub', '88180000-0000-0000-0000-000000000002', true);

select is(
  erp.has_permission('catalog.manage'),
  false,
  'Usuario con rol web_content obtiene false en catalog.manage'
);

select is(
  erp.has_permission('stock.adjust'),
  false,
  'Usuario con rol web_content obtiene false en stock.adjust'
);

select is(
  erp.has_permission('pricing.manage')
  or erp.has_permission('repairs.manage')
  or erp.has_permission('sales.create')
  or erp.has_permission('cash.open')
  or erp.has_permission('users.manage'),
  false,
  'Usuario con rol web_content obtiene false en pricing, repairs, sales, cash y users'
);

reset role;

select * from finish();

rollback;
