begin;
set local search_path = public, extensions, erp, pg_catalog;

select plan(65);

create temp table cutover_fixture as
select
  o.id as org1,
  gen_random_uuid() as org2,
  gen_random_uuid() as mgr_id,
  gen_random_uuid() as viewer_id,
  gen_random_uuid() as plain_id,
  gen_random_uuid() as legacy_id,
  gen_random_uuid() as other_org_user_id,
  gen_random_uuid() as mgr_role_id,
  gen_random_uuid() as viewer_role_id,
  gen_random_uuid() as plain_role_id
from erp.organizations o
order by o.created_at
limit 1;
grant select on cutover_fixture to authenticated, anon, service_role;

-- 1-2. Filas iniciales por organización existente en off / false para los 5 grupos.
select is(
  (select count(*)::int from erp.storefront_cutover_groups g join cutover_fixture f on f.org1 = g.organization_id),
  5,
  'Se crean 5 grupos iniciales de corte por organización'
);

select is(
  (
    select count(*)::int
    from erp.storefront_cutover_groups g
    join cutover_fixture f on f.org1 = g.organization_id
    where g.group_code in ('catalog', 'stock', 'prices_promos', 'repairs', 'dashboard')
      and g.admin_tab_hidden = false
      and g.legacy_write_mode = 'off'
  ),
  5,
  'Todos los grupos iniciales arrancan con admin_tab_hidden = false y legacy_write_mode = off'
);

-- Setup actores con roles propios (legacy_id queda sin fila en erp.profiles).
insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select mgr_id, 'authenticated', 'authenticated', 'cutover-mgr-' || mgr_id::text || '@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now() from cutover_fixture
union all
select viewer_id, 'authenticated', 'authenticated', 'cutover-viewer-' || viewer_id::text || '@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now() from cutover_fixture
union all
select plain_id, 'authenticated', 'authenticated', 'cutover-plain-' || plain_id::text || '@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now() from cutover_fixture;

insert into erp.profiles (id, organization_id, display_name)
select mgr_id, org1, 'Cutover Manager' from cutover_fixture
union all
select viewer_id, org1, 'Cutover Viewer' from cutover_fixture
union all
select plain_id, org1, 'Cutover Plain' from cutover_fixture
on conflict (id) do update
set organization_id = excluded.organization_id,
    is_active = true;

insert into erp.roles (id, organization_id, code, name)
select mgr_role_id, org1, 'cutover_mgr_' || substr(mgr_role_id::text, 1, 8), 'Gestor de corte' from cutover_fixture
union all
select viewer_role_id, org1, 'cutover_viewer_' || substr(viewer_role_id::text, 1, 8), 'Lector de configuración' from cutover_fixture
union all
select plain_role_id, org1, 'cutover_plain_' || substr(plain_role_id::text, 1, 8), 'Sin permisos de corte' from cutover_fixture;

insert into erp.role_permissions (organization_id, role_id, permission_id)
select f.org1, f.mgr_role_id, p.id
from cutover_fixture f
join erp.permissions p on p.code in ('configuration.manage', 'configuration.view')
union all
select f.org1, f.viewer_role_id, p.id
from cutover_fixture f
join erp.permissions p on p.code = 'configuration.view';

insert into erp.profile_roles (organization_id, profile_id, role_id)
select org1, mgr_id, mgr_role_id from cutover_fixture
union all
select org1, viewer_id, viewer_role_id from cutover_fixture
union all
select org1, plain_id, plain_role_id from cutover_fixture;

-- 3-6. Privilegios de ejecución para anon y authenticated.
select ok(
  not has_function_privilege('anon', 'erp.set_storefront_cutover_group(text, boolean, text, text)', 'execute'),
  'anon no tiene execute sobre erp.set_storefront_cutover_group'
);

select ok(
  not has_function_privilege('anon', 'public.get_admin_cutover_flags()', 'execute'),
  'anon no tiene execute sobre public.get_admin_cutover_flags'
);

select ok(
  has_function_privilege('authenticated', 'erp.set_storefront_cutover_group(text, boolean, text, text)', 'execute'),
  'authenticated tiene execute sobre erp.set_storefront_cutover_group'
);

select ok(
  has_function_privilege('authenticated', 'public.get_admin_cutover_flags()', 'execute'),
  'authenticated tiene execute sobre public.get_admin_cutover_flags'
);

-- 7-8. Invocación real como anon falla.
set local role anon;

select throws_ok(
  $$select erp.set_storefront_cutover_group('catalog', true, 'observe', 'Intento anónimo')$$,
  '42501',
  null,
  'anon no puede ejecutar erp.set_storefront_cutover_group'
);

select throws_ok(
  $$select * from public.get_admin_cutover_flags()$$,
  '42501',
  null,
  'anon no puede ejecutar public.get_admin_cutover_flags'
);

reset role;

-- 9-10. Usuario sin configuration.view ni configuration.manage.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select plain_id::text from cutover_fixture), true);
set local role authenticated;

select is(
  (select count(*)::int from erp.storefront_cutover_groups),
  0,
  'Usuario sin configuration.view no ve filas por RLS'
);

select throws_ok(
  $$select erp.set_storefront_cutover_group('catalog', true, 'observe', 'Sin permiso')$$,
  '42501',
  null,
  'Usuario sin configuration.manage recibe 42501'
);

-- 11-12. Usuario con configuration.view pero sin configuration.manage.
select set_config('request.jwt.claim.sub', (select viewer_id::text from cutover_fixture), true);

select is(
  (select count(*)::int from erp.storefront_cutover_groups),
  5,
  'Usuario con configuration.view lee los 5 grupos por RLS'
);

select throws_ok(
  $$select erp.set_storefront_cutover_group('catalog', true, 'observe', 'Solo lectura')$$,
  '42501',
  null,
  'Usuario con configuration.view pero sin configuration.manage recibe 42501'
);

-- 13-18. Usuario con configuration.manage: bloqueada escritura directa y rechazados valores inválidos.
select set_config('request.jwt.claim.sub', (select mgr_id::text from cutover_fixture), true);

select throws_ok(
  $$insert into erp.storefront_cutover_groups (organization_id, group_code) select org1, 'catalog' from cutover_fixture$$,
  '42501',
  null,
  'Escritura directa insert en storefront_cutover_groups rechazada para authenticated'
);

select throws_ok(
  $$update erp.storefront_cutover_groups set legacy_write_mode = 'block' where group_code = 'catalog'$$,
  '42501',
  null,
  'Escritura directa update en storefront_cutover_groups rechazada para authenticated'
);

select throws_ok(
  $$select erp.set_storefront_cutover_group('invalid_group', true, 'observe', 'Grupo inválido')$$,
  '22023',
  null,
  'Grupo inválido es rechazado con 22023'
);

select throws_ok(
  $$select erp.set_storefront_cutover_group('catalog', true, 'invalid_mode', 'Modo inválido')$$,
  '22023',
  null,
  'Modo legacy inválido es rechazado con 22023'
);

select throws_ok(
  $$select erp.set_storefront_cutover_group('catalog', null, 'observe', 'Hidden nulo')$$,
  '22023',
  null,
  'admin_tab_hidden nulo es rechazado con 22023'
);

select throws_ok(
  $$select erp.set_storefront_cutover_group('catalog', true, 'observe', '   ')$$,
  '22023',
  null,
  'Motivo vacío es rechazado con 22023'
);

-- 19-21. Con permiso configuration.manage cambia el modo, get_admin_cutover_flags lo refleja y registra auditoría.
select lives_ok(
  $$select erp.set_storefront_cutover_group('catalog', true, 'observe', 'Inicio de canario W3')$$,
  'Usuario con configuration.manage actualiza grupo de corte'
);

select is(
  (
    select count(*)::int
    from erp.storefront_cutover_groups g
    join cutover_fixture f on f.org1 = g.organization_id
    where g.group_code = 'catalog'
      and g.admin_tab_hidden = true
      and g.legacy_write_mode = 'observe'
      and g.reason = 'Inicio de canario W3'
      and g.updated_by = f.mgr_id
  ),
  1,
  'El grupo actualizado persiste estado, motivo y updated_by'
);

select is(
  (
    select count(*)::int
    from public.get_admin_cutover_flags()
    where (group_code = 'catalog' and admin_tab_hidden = true and legacy_write_mode = 'observe')
       or (group_code <> 'catalog' and admin_tab_hidden = false and legacy_write_mode = 'off')
  ),
  5,
  'get_admin_cutover_flags refleja el cambio en catalog y mantiene el resto en off/false'
);

-- 22. Una cuenta autenticada sin perfil ERP y sin app_metadata.role = admin no ve banderas.
select set_config('request.jwt.claim.sub', (select legacy_id::text from cutover_fixture), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select legacy_id from cutover_fixture), 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);

select is(
  (select count(*)::int from public.get_admin_cutover_flags()),
  0,
  'Cuenta autenticada sin perfil ERP ni claim admin no ve banderas'
);

-- 22b. Admin legacy puro (sin perfil ERP, app_metadata.role = admin) con exactamente una organización ve las banderas de esa única organización.
select set_config('request.jwt.claims', jsonb_build_object('sub', (select legacy_id from cutover_fixture), 'role', 'authenticated', 'app_metadata', jsonb_build_object('role', 'admin'))::text, true);

select is(
  (
    select count(*)::int
    from public.get_admin_cutover_flags()
    where (group_code = 'catalog' and admin_tab_hidden = true and legacy_write_mode = 'observe')
       or (group_code <> 'catalog' and admin_tab_hidden = false and legacy_write_mode = 'off')
  ),
  5,
  'Admin legacy sin perfil ERP ve las banderas de la única organización'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

-- 23. Se registra evento de auditoría en erp.audit_events con valores anteriores y nuevos.
select is(
  (
    select count(*)::int
    from erp.audit_events a
    join cutover_fixture f on f.org1 = a.organization_id
    where a.schema_name = 'erp'
      and a.table_name = 'storefront_cutover_groups'
      and a.record_id = 'catalog'
      and a.action = 'update'
      and a.reason = 'Inicio de canario W3'
      and a.actor_user_id = f.mgr_id
      and (a.old_values ->> 'legacy_write_mode') = 'off'
      and (a.new_values ->> 'legacy_write_mode') = 'observe'
  ),
  1,
  'Se registra evento de auditoría en erp.audit_events con valores anteriores y nuevos'
);

-- 24. Insertar segunda organización inicializa sus 5 grupos en off/false.
insert into erp.organizations (id, legal_name, display_name)
select org2, 'Segunda Org Cutover', 'Segunda Org Cutover' from cutover_fixture;

select is(
  (
    select count(*)::int
    from erp.storefront_cutover_groups g
    join cutover_fixture f on f.org2 = g.organization_id
    where g.admin_tab_hidden = false
      and g.legacy_write_mode = 'off'
  ),
  5,
  'Nueva organización recibe sus 5 grupos iniciales en off/false'
);

-- 25. Con más de una organización, admin legacy sin perfil ERP recibe vacío.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select legacy_id::text from cutover_fixture), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select legacy_id from cutover_fixture), 'role', 'authenticated', 'app_metadata', jsonb_build_object('role', 'admin'))::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.get_admin_cutover_flags()),
  0,
  'Admin legacy sin perfil ERP recibe vacío cuando hay más de una organización'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

-- 26. Usuario con perfil en la segunda organización ve solo sus propias banderas en off/false.
insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select other_org_user_id, 'authenticated', 'authenticated', 'cutover-org2-' || other_org_user_id::text || '@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()
from cutover_fixture;

insert into erp.profiles (id, organization_id, display_name)
select other_org_user_id, org2, 'Usuario Org 2' from cutover_fixture
on conflict (id) do update
set organization_id = excluded.organization_id,
    is_active = true;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select other_org_user_id::text from cutover_fixture), true);
set local role authenticated;

select is(
  (
    select count(*)::int
    from public.get_admin_cutover_flags()
    where admin_tab_hidden = false
      and legacy_write_mode = 'off'
  ),
  5,
  'Usuario de otra organización ve solo sus banderas en off/false'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

-- ============================================================================
-- W3 parte 2: canarios observe/block sobre tablas legacy y captura de stock.
-- ============================================================================

create temp table canary_fixture as
select
  f.org1,
  f.org2,
  f.mgr_id,
  f.mgr_role_id,
  f.plain_id,
  gen_random_uuid() as auditor_id,
  gen_random_uuid() as auditor_role_id,
  gen_random_uuid() as other_auditor_id,
  gen_random_uuid() as other_auditor_role_id,
  gen_random_uuid() as erp_cat_id,
  gen_random_uuid() as erp_brand_id,
  gen_random_uuid() as prod_id,
  gen_random_uuid() as var_id,
  gen_random_uuid() as repair_id,
  gen_random_uuid() as repair_log_id
from cutover_fixture f;
grant select on canary_fixture to authenticated, anon, service_role;

-- Permisos adicionales para mgr_id (catálogo + stock) y actores audit.view en org1 y org2.
insert into erp.role_permissions (organization_id, role_id, permission_id)
select f.org1, f.mgr_role_id, p.id
from canary_fixture f
join erp.permissions p on p.code in ('catalog.manage', 'stock.adjust', 'stock.move', 'costs.manage')
on conflict do nothing;

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select auditor_id, 'authenticated', 'authenticated', 'canary-auditor-' || auditor_id::text || '@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now() from canary_fixture
union all
select other_auditor_id, 'authenticated', 'authenticated', 'canary-auditor2-' || other_auditor_id::text || '@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now() from canary_fixture;

insert into erp.profiles (id, organization_id, display_name)
select auditor_id, org1, 'Canary Auditor Org1' from canary_fixture
union all
select other_auditor_id, org2, 'Canary Auditor Org2' from canary_fixture
on conflict (id) do update
set organization_id = excluded.organization_id,
    is_active = true;

insert into erp.roles (id, organization_id, code, name)
select auditor_role_id, org1, 'canary_aud_' || substr(auditor_role_id::text, 1, 8), 'Auditor Canario' from canary_fixture
union all
select other_auditor_role_id, org2, 'canary_aud2_' || substr(other_auditor_role_id::text, 1, 8), 'Auditor Canario Org2' from canary_fixture;

insert into erp.role_permissions (organization_id, role_id, permission_id)
select f.org1, f.auditor_role_id, p.id
from canary_fixture f
join erp.permissions p on p.code = 'audit.view'
union all
select f.org2, f.other_auditor_role_id, p.id
from canary_fixture f
join erp.permissions p on p.code = 'audit.view';

insert into erp.profile_roles (organization_id, profile_id, role_id)
select org1, auditor_id, auditor_role_id from canary_fixture
union all
select org2, other_auditor_id, other_auditor_role_id from canary_fixture;

-- Resetear catalog a off antes del setup de canarios (en assertion 19 quedó en observe).
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select mgr_id::text from cutover_fixture), true);
set local role authenticated;
select erp.set_storefront_cutover_group('catalog', false, 'off', 'Reset antes de setup de canarios');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

-- Tablas legacy mínimas si faltan (patrón to_regclass para base limpia vs prodlike).
do $$
begin
  if to_regclass('public.categories') is null then
    create table public.categories (
      id uuid primary key,
      name text not null,
      created_at timestamptz default now()
    );
  end if;
  if to_regclass('public.brands') is null then
    create table public.brands (
      id uuid primary key,
      name text not null,
      created_at timestamptz not null default now()
    );
  end if;
  if to_regclass('public.models') is null then
    create table public.models (
      id uuid primary key,
      brand_id uuid references public.brands(id),
      name text not null,
      created_at timestamptz not null default now()
    );
  end if;
  if to_regclass('public.products') is null then
    create table public.products (
      id uuid primary key,
      name text not null,
      description text,
      price numeric not null,
      original_price numeric,
      stock integer not null default 0 check (stock >= 0),
      image_url text,
      additional_images text[],
      tags text[],
      condition text,
      capacity text,
      category_id uuid,
      brand_id uuid,
      model_id uuid,
      is_active boolean not null default true,
      created_at timestamptz default now()
    );
  end if;
  if to_regclass('public.product_variants') is null then
    create table public.product_variants (
      id uuid primary key,
      product_id uuid references public.products(id),
      color text not null,
      stock integer not null default 0,
      price numeric(12, 2),
      image_url text,
      is_active boolean not null default true,
      created_at timestamptz not null default now()
    );
  end if;
  if to_regclass('public.repairs') is null then
    create table public.repairs (
      id uuid primary key,
      client_dni text not null,
      client_name text,
      device_model text not null,
      tracking_code text not null,
      notes text,
      created_at timestamptz default now()
    );
  end if;
  if to_regclass('public.repair_logs') is null then
    create table public.repair_logs (
      id uuid primary key,
      repair_id uuid references public.repairs(id),
      content text not null,
      is_public boolean default true,
      created_at timestamptz default now()
    );
  end if;
  grant select, insert, update, delete on
    public.categories, public.brands, public.models,
    public.products, public.product_variants,
    public.repairs, public.repair_logs
    to authenticated;
end;
$$;

select erp.install_legacy_write_canaries();

-- Seed de catálogo y stock ERP + activación del puente en org1.
insert into erp.product_categories (id, organization_id, code, name)
select erp_cat_id, org1, 'CANARY-CAT-' || substr(erp_cat_id::text, 1, 8), 'Accesorios Canario'
from canary_fixture;

insert into erp.brands (id, organization_id, code, name)
select erp_brand_id, org1, 'CANARY-BR-' || substr(erp_brand_id::text, 1, 8), 'Marca Canario'
from canary_fixture;

insert into erp.products (
  id, organization_id, product_type_id, item_kind, category_id, brand_id, unit_id,
  internal_code, internal_name, public_name, public_description, inventory_tracking,
  base_cost, base_sale_price, can_sell, publish_on_web, allow_online_sale, is_active, sheet_template
)
select
  prod_id, org1, '60000000-0000-0000-0000-000000000001', 'product', erp_cat_id, erp_brand_id, '50000000-0000-0000-0000-000000000001',
  'CANARY-' || substr(prod_id::text, 1, 8), 'Cable Canario', 'Cable Canario', 'Desc', 'quantity',
  500, 1000, true, true, true, true, 'accesorio'
from canary_fixture;

insert into erp.product_variants (
  id, organization_id, product_id, code, name, attributes, final_price_ars, is_active
)
select
  var_id, org1, prod_id, 'NEGRO-CANARY', 'Negro', '{"color":"Negro"}'::jsonb, 1200, true
from canary_fixture;

insert into public.categories (id, name)
select erp_cat_id, 'Accesorios Canario' from canary_fixture
on conflict (id) do nothing;

insert into public.brands (id, name)
select erp_brand_id, 'Marca Canario' from canary_fixture
on conflict (id) do nothing;

insert into public.products (id, name, price, stock, category_id, brand_id, is_active)
select prod_id, 'Cable Canario', 1000, 0, erp_cat_id, erp_brand_id, true from canary_fixture;

insert into public.product_variants (id, product_id, color, stock, price, is_active)
select var_id, prod_id, 'Negro', 0, 1200, true from canary_fixture;

insert into erp.configuration_values (organization_id, key, value, is_system)
select org1, 'storefront.initial_catalog_import', '{"test_fixture":true}'::jsonb, true from canary_fixture
where not exists (
  select 1 from erp.configuration_values c
  where c.organization_id = canary_fixture.org1
    and c.branch_id is null
    and c.key = 'storefront.initial_catalog_import'
);

select erp.activate_storefront_bridge(org1) from canary_fixture;

-- Dejar stock consistente en 5 unidades (solo producto sin variantes con stock separado) para probar captura de stock.
-- Usamos un producto adicional sin variantes para probar stock en public.products, y el producto con variantes para precios.
alter table canary_fixture add column if not exists stock_prod_id uuid;
update canary_fixture set stock_prod_id = gen_random_uuid();

insert into erp.products (
  id, organization_id, product_type_id, item_kind, category_id, brand_id, unit_id,
  internal_code, internal_name, public_name, inventory_tracking,
  base_cost, base_sale_price, can_sell, publish_on_web, allow_online_sale, is_active, sheet_template
)
select
  stock_prod_id, org1, '60000000-0000-0000-0000-000000000001', 'product', erp_cat_id, erp_brand_id, '50000000-0000-0000-0000-000000000001',
  'CANARY-STK-' || substr(stock_prod_id::text, 1, 8), 'Cargador Stock', 'Cargador Stock', 'quantity',
  400, 900, true, true, true, true, 'accesorio'
from canary_fixture;

insert into erp.stock_balances (
  organization_id, branch_id, location_id, product_id, variant_id, quantity_on_hand, quantity_reserved
)
select org1, '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', stock_prod_id, null, 5, 0
from canary_fixture;

insert into public.repairs (id, client_dni, client_name, device_model, tracking_code, notes)
select repair_id, '30111222', 'Cliente Canario', 'iPhone 13', 'CAN1-RY22', 'Nota inicial'
from canary_fixture;

-- 27. Orden de triggers: el canario se ordena antes del puente y de z_erp_*_price_projection.
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.products'::regclass
      and tgname = 'a_00_erp_legacy_write_canary'
      and tgname < 'a_storefront_catalog_sync'
      and tgname < 'z_storefront_stock_capture'
  ) and 'a_00_erp_legacy_write_canary' < 'z_erp_product_price_projection',
  'Trigger canario se ordena antes que los triggers del puente y de z_erp_*_price_projection'
);

-- 28. Seguridad: anon no tiene execute sobre funciones trigger/auxiliares nuevas.
select ok(
  not has_function_privilege('anon', 'erp.legacy_write_canary()', 'execute')
  and not has_function_privilege('anon', 'erp.install_legacy_write_canaries()', 'execute')
  and not has_function_privilege('anon', 'erp.capture_storefront_stock_delta(uuid, uuid, integer, integer)', 'execute'),
  'anon no tiene execute sobre funciones de canarios ni captura de stock'
);

-- 29. RLS: anon no puede leer ni escribir en erp.legacy_write_canary_events.
set local role anon;

select throws_ok(
  $$select count(*) from erp.legacy_write_canary_events$$,
  '42501',
  null,
  'anon no puede leer erp.legacy_write_canary_events'
);

reset role;

-- 30. Sin escritura directa para authenticated.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select plain_id::text from canary_fixture), true);
set local role authenticated;

select throws_ok(
  $$insert into erp.legacy_write_canary_events (organization_id, group_code, table_name, operation, actor_role)
    select org1, 'catalog', 'public.products', 'UPDATE', 'authenticated' from canary_fixture$$,
  '42501',
  null,
  'authenticated no puede insertar directamente en erp.legacy_write_canary_events'
);

-- Resetear catalog a off para probar modo off primero (en assertion 19 había quedado en observe).
reset role;
select set_config('request.jwt.claim.sub', (select mgr_id::text from canary_fixture), true);
set local role authenticated;
select erp.set_storefront_cutover_group('catalog', false, 'off', 'Reset para pruebas de canario');

-- 31-32. En off, un update de precio en public.products funciona igual y no registra.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select mgr_id from canary_fixture),
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', 'admin')
  )::text,
  true
);
select lives_ok(
  $$update public.products set price = 1050 where id = (select prod_id from canary_fixture)$$,
  'En off, update de precio en public.products se ejecuta sin bloqueo'
);
select set_config('request.jwt.claims', '', true);

reset role;
select is(
  (
    select count(*)::int
    from erp.legacy_write_canary_events e
    join canary_fixture f on f.org1 = e.organization_id
  ),
  0,
  'En off no se registran eventos de canario'
);

-- 33-35. En observe sobre prices_promos, registra y deja pasar; cambios solo de catalog (off) no registran.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select mgr_id::text from canary_fixture), true);
set local role authenticated;

select erp.set_storefront_cutover_group('prices_promos', false, 'observe', 'Observar precios');

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select mgr_id from canary_fixture),
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', 'admin')
  )::text,
  true
);
select lives_ok(
  $$update public.products set price = 1100 where id = (select prod_id from canary_fixture)$$,
  'En observe, update de precio en public.products deja pasar'
);
select set_config('request.jwt.claims', '', true);

reset role;
select is(
  (
    select count(*)::int
    from erp.legacy_write_canary_events e
    join canary_fixture f on f.org1 = e.organization_id
    where e.group_code = 'prices_promos'
      and e.table_name = 'public.products'
      and e.operation = 'UPDATE'
      and e.touched_columns = array['price']
      and e.row_id = f.prod_id::text
      and e.actor_user_id = f.mgr_id
      and e.actor_role = 'authenticated'
  ),
  1,
  'En observe se registra exactamente 1 evento en prices_promos con columna, row_id y actor'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select mgr_id::text from canary_fixture), true);
set local role authenticated;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select mgr_id from canary_fixture),
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', 'admin')
  )::text,
  true
);
select lives_ok(
  $$update public.products set name = 'Cable Canario Editado' where id = (select prod_id from canary_fixture)$$,
  'Con catalog en off y prices_promos en observe, editar name pasa sin registrar'
);
select set_config('request.jwt.claims', '', true);

reset role;
select is(
  (
    select count(*)::int
    from erp.legacy_write_canary_events e
    join canary_fixture f on f.org1 = e.organization_id
    where e.group_code = 'catalog'
  ),
  0,
  'No se registra evento en catalog mientras catalog está en off'
);

-- 36. En observe sobre repairs, registra y deja pasar.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select mgr_id::text from canary_fixture), true);
set local role authenticated;
select erp.set_storefront_cutover_group('repairs', false, 'observe', 'Observar reparaciones');
reset role;

select lives_ok(
  $$update public.repairs set notes = 'Nota observe' where id = (select repair_id from canary_fixture)$$,
  'En observe sobre repairs, update en public.repairs deja pasar'
);

select is(
  (
    select count(*)::int
    from erp.legacy_write_canary_events e
    join canary_fixture f on f.org1 = e.organization_id
    where e.group_code = 'repairs'
      and e.table_name = 'public.repairs'
      and e.operation = 'UPDATE'
      and 'notes' = any(e.touched_columns)
  ),
  1,
  'En observe sobre repairs se registra el evento con tabla y columna tocada'
);

-- 37-39. En block sobre prices_promos, rechaza price y original_price, pero deja pasar name si catalog está en off.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select mgr_id::text from canary_fixture), true);
set local role authenticated;
select erp.set_storefront_cutover_group('prices_promos', false, 'block', 'Bloquear precios legacy');

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select mgr_id from canary_fixture),
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', 'admin')
  )::text,
  true
);

select throws_ok(
  $$update public.products set price = 1150 where id = (select prod_id from canary_fixture)$$,
  '42501',
  'Este dato se gestiona desde el ERP',
  'En block sobre prices_promos, update de price es rechazado con 42501 y mensaje claro'
);

select throws_ok(
  $$update public.products set original_price = 1300 where id = (select prod_id from canary_fixture)$$,
  '42501',
  'Este dato se gestiona desde el ERP',
  'En block sobre prices_promos, update de original_price es rechazado'
);

select lives_ok(
  $$update public.products set name = 'Cable Solo Catalogo' where id = (select prod_id from canary_fixture)$$,
  'Con prices_promos en block y catalog en off, editar name sigue permitido'
);

-- 40-42. En block sobre catalog y repairs, rechaza escrituras en products, categories y repairs.
select erp.set_storefront_cutover_group('catalog', false, 'block', 'Bloquear catálogo legacy');
select erp.set_storefront_cutover_group('repairs', false, 'block', 'Bloquear reparaciones legacy');

select throws_ok(
  $$update public.products set name = 'Bloqueado' where id = (select prod_id from canary_fixture)$$,
  '42501',
  'Este dato se gestiona desde el ERP',
  'En block sobre catalog, update de name en public.products es rechazado'
);

select throws_ok(
  $$insert into public.categories (id, name) values (gen_random_uuid(), 'Cat Bloqueada')$$,
  '42501',
  'Este dato se gestiona desde el ERP',
  'En block sobre catalog, insert en public.categories es rechazado'
);

select set_config('request.jwt.claims', '', true);
reset role;
select throws_ok(
  $$update public.repairs set notes = 'Nota bloqueada' where id = (select repair_id from canary_fixture)$$,
  '42501',
  'Este dato se gestiona desde el ERP',
  'En block sobre repairs, update en public.repairs es rechazado'
);

-- 43-45. Escrituras de la proyección del ERP (guardar ficha y project_storefront_variant_prices) nunca se registran ni bloquean.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select mgr_id::text from canary_fixture), true);
set local role authenticated;

select lives_ok(
  $$select erp.save_catalog_product_sheet(jsonb_build_object(
      'id', prod_id,
      'internal_name', 'Cable Desde ERP',
      'public_name', 'Cable Desde ERP',
      'category_id', erp_cat_id,
      'brand_id', erp_brand_id,
      'sheet_template', 'accesorio',
      'base_sale_price', 1450
    )) from canary_fixture$$,
  'Guardar la ficha en el ERP proyecta a public.products sin bloquearse aunque catalog y prices_promos estén en block'
);

reset role;
select is(
  (select price::numeric from public.products where id = (select prod_id from canary_fixture)),
  1450::numeric,
  'La proyección de save_catalog_product_sheet actualiza el precio en public.products'
);

update erp.product_variants
set final_price_ars = 1550
where id = (select var_id from canary_fixture);

select lives_ok(
  $$select erp.project_storefront_variant_prices(org1, prod_id) from canary_fixture$$,
  'project_storefront_variant_prices proyecta sin bloquearse aunque prices_promos y catalog estén en block'
);

select is(
  (select price::numeric from public.product_variants where id = (select var_id from canary_fixture)),
  1550::numeric,
  'project_storefront_variant_prices actualiza public.product_variants.price'
);

select is(
  (
    select count(*)::int
    from erp.legacy_write_canary_events e
    join canary_fixture f on f.org1 = e.organization_id
    where e.group_code in ('catalog', 'prices_promos')
  ),
  1,
  'Las proyecciones del ERP no agregan eventos de canario (solo persiste el único evento previo de observe)'
);

-- 46-51. Captura de stock y proyecciones de stock en off / observe / block.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select mgr_id::text from canary_fixture), true);
set local role authenticated;

-- off: update de stock en public.products captura delta sin evento de canario.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select mgr_id from canary_fixture),
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', 'admin')
  )::text,
  true
);
select lives_ok(
  $$update public.products set stock = 6 where id = (select stock_prod_id from canary_fixture)$$,
  'En stock off, update de stock en public.products captura delta en ERP'
);
select set_config('request.jwt.claims', '', true);

reset role;
select is(
  (
    select count(*)::int
    from erp.legacy_write_canary_events e
    join canary_fixture f on f.org1 = e.organization_id
    where e.group_code = 'stock'
  ),
  0,
  'En stock off no se registra evento de canario'
);

-- observe: update en public.products registra 1 evento (sin duplicar en capture_storefront_stock_delta) y ajusta ERP.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select mgr_id::text from canary_fixture), true);
set local role authenticated;
select erp.set_storefront_cutover_group('stock', false, 'observe', 'Observar stock');

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select mgr_id from canary_fixture),
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', 'admin')
  )::text,
  true
);
select lives_ok(
  $$update public.products set stock = 7 where id = (select stock_prod_id from canary_fixture)$$,
  'En stock observe, update de stock deja pasar y captura ajuste en ERP'
);
select set_config('request.jwt.claims', '', true);

reset role;
select is(
  (
    select count(*)::int
    from erp.legacy_write_canary_events e
    join canary_fixture f on f.org1 = e.organization_id
    where e.group_code = 'stock'
  ),
  1,
  'En stock observe, update de stock registra exactamente 1 evento sin duplicación'
);

select is(
  (
    select sum(quantity_on_hand)::int
    from erp.stock_balances b
    join canary_fixture f on f.org1 = b.organization_id and f.stock_prod_id = b.product_id
  ),
  7,
  'En stock observe, el saldo en erp.stock_balances queda actualizado a 7'
);

-- observe: llamada directa a erp.capture_storefront_stock_delta registra 1 evento y ajusta ERP.
select lives_ok(
  $$select erp.capture_storefront_stock_delta(stock_prod_id, null, 7, 8) from canary_fixture$$,
  'En stock observe, llamada directa a capture_storefront_stock_delta deja pasar y captura ajuste'
);

select is(
  (
    select count(*)::int
    from erp.legacy_write_canary_events e
    join canary_fixture f on f.org1 = e.organization_id
    where e.group_code = 'stock'
  ),
  2,
  'En stock observe, llamada directa a capture_storefront_stock_delta registra el segundo evento'
);

-- block: update en public.products y llamada directa a capture_storefront_stock_delta son rechazados;
-- la proyección desde erp.stock_balances sigue funcionando sin registrarse ni bloquearse.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select mgr_id::text from canary_fixture), true);
set local role authenticated;
select erp.set_storefront_cutover_group('stock', false, 'block', 'Bloquear stock legacy');

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select mgr_id from canary_fixture),
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', 'admin')
  )::text,
  true
);
select throws_ok(
  $$update public.products set stock = 9 where id = (select stock_prod_id from canary_fixture)$$,
  '42501',
  'Este dato se gestiona desde el ERP',
  'En stock block, update directo de stock en public.products es rechazado'
);
select set_config('request.jwt.claims', '', true);

reset role;
select throws_ok(
  $$select erp.capture_storefront_stock_delta(stock_prod_id, null, 8, 9) from canary_fixture$$,
  '42501',
  'Este dato se gestiona desde el ERP',
  'En stock block, capture_storefront_stock_delta rechaza escrituras directas'
);

select lives_ok(
  $$update erp.stock_balances
    set quantity_on_hand = 10
    where product_id = (select stock_prod_id from canary_fixture)
      and location_id = '30000000-0000-0000-0000-000000000001'$$,
  'Con stock en block, la proyección desde erp.stock_balances no se bloquea'
);

select is(
  (select stock from public.products where id = (select stock_prod_id from canary_fixture)),
  10,
  'La proyección de stock actualiza public.products.stock a 10 aun con stock en block'
);

select is(
  (
    select count(*)::int
    from erp.legacy_write_canary_events e
    join canary_fixture f on f.org1 = e.organization_id
    where e.group_code = 'stock'
  ),
  2,
  'La proyección de stock desde el ERP no registra eventos de canario'
);

-- 52-54. RLS de lectura sobre erp.legacy_write_canary_events: audit.view por organización.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select plain_id::text from canary_fixture), true);
set local role authenticated;

select is(
  (select count(*)::int from erp.legacy_write_canary_events),
  0,
  'Usuario sin audit.view no ve eventos de canario'
);

select set_config('request.jwt.claim.sub', (select auditor_id::text from canary_fixture), true);

select is(
  (select count(*)::int from erp.legacy_write_canary_events),
  4,
  'Usuario con audit.view lee los 4 eventos de canario de su organización'
);

select set_config('request.jwt.claim.sub', (select other_auditor_id::text from canary_fixture), true);

select is(
  (select count(*)::int from erp.legacy_write_canary_events),
  0,
  'Usuario con audit.view de otra organización no ve eventos de org1'
);

reset role;

select * from finish();
rollback;
