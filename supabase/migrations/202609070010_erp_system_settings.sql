-- Migration: 202609070010_erp_system_settings.sql
-- Description: Fase F - ajustes persistentes del sistema (erp.system_settings) con alcance
-- global (branch_id null) o por sucursal, gobernados por el permiso system.manage.
-- La PK usa branch_scope (coalesce(branch_id, 00000000-...)) porque una PK no admite
-- NULL: asi la misma key puede existir una vez global y una vez por cada sucursal.

set search_path = erp, pg_catalog;

-- Permiso de gestion de ajustes del sistema.
insert into erp.permissions (code, module, name, is_sensitive)
values ('system.manage', 'system', 'Gestionar ajustes del sistema', true)
on conflict (code) do update
set module = excluded.module,
    name = excluded.name,
    is_sensitive = excluded.is_sensitive,
    is_active = true;

create table erp.system_settings (
  organization_id uuid not null references erp.organizations (id) on delete restrict,
  branch_id uuid references erp.branches (id) on delete restrict,
  branch_scope uuid generated always as (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint system_settings_key_not_blank check (btrim(key) <> ''),
  constraint system_settings_key_format check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint system_settings_branch_organization_fk foreign key (branch_id, organization_id)
    references erp.branches (id, organization_id) on delete restrict,
  constraint system_settings_scope_pkey primary key (organization_id, branch_scope, key)
);

comment on table erp.system_settings is
  'Ajustes del sistema con alcance global (branch_id null) o por sucursal. Requieren system.manage para escritura.';
comment on column erp.system_settings.branch_scope is
  'coalesce(branch_id, 00000000-0000-0000-0000-000000000000): permite la PK global vs por sucursal pese al NULL.';

drop trigger if exists trg_system_settings_touch on erp.system_settings;
create trigger trg_system_settings_touch
  before update on erp.system_settings
  for each row execute function erp.touch_updated_at();

alter table erp.system_settings enable row level security;

create policy system_settings_select_own
on erp.system_settings for select to authenticated
using (organization_id = erp.current_organization_id());

create policy system_settings_insert
on erp.system_settings for insert to authenticated
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('system.manage', branch_id)
);

create policy system_settings_update
on erp.system_settings for update to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('system.manage', branch_id)
)
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('system.manage', branch_id)
);

revoke all on erp.system_settings from public, anon;
grant select, insert, update on erp.system_settings to authenticated;
grant all on erp.system_settings to service_role;
