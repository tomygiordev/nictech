-- W3 parte 1: grupos de corte admin web -> ERP y RPC de banderas.
-- Todo nace en off / false; aplicar esta migración no altera ningún comportamiento actual.

create table if not exists erp.storefront_cutover_groups (
  organization_id uuid not null references erp.organizations (id) on delete restrict,
  group_code text not null check (group_code in ('catalog', 'stock', 'prices_promos', 'repairs', 'dashboard')),
  admin_tab_hidden boolean not null default false,
  legacy_write_mode text not null default 'off' check (legacy_write_mode in ('off', 'observe', 'block')),
  reason text check (reason is null or btrim(reason) <> ''),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint storefront_cutover_groups_pkey primary key (organization_id, group_code)
);

comment on table erp.storefront_cutover_groups is
  'Estado de corte por grupo funcional entre el admin legacy de la tienda y el ERP.';

drop trigger if exists storefront_cutover_groups_touch on erp.storefront_cutover_groups;
create trigger storefront_cutover_groups_touch
  before update on erp.storefront_cutover_groups
  for each row execute function erp.touch_updated_at();

create or replace function erp.ensure_storefront_cutover_groups_for_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, erp, pg_temp
as $$
begin
  insert into erp.storefront_cutover_groups (organization_id, group_code)
  values
    (new.id, 'catalog'),
    (new.id, 'stock'),
    (new.id, 'prices_promos'),
    (new.id, 'repairs'),
    (new.id, 'dashboard')
  on conflict (organization_id, group_code) do nothing;
  return new;
end;
$$;

revoke all on function erp.ensure_storefront_cutover_groups_for_organization() from public, anon, authenticated, service_role;

drop trigger if exists organization_storefront_cutover_groups on erp.organizations;
create trigger organization_storefront_cutover_groups
  after insert on erp.organizations
  for each row execute function erp.ensure_storefront_cutover_groups_for_organization();

insert into erp.storefront_cutover_groups (organization_id, group_code)
select
  o.id,
  g.group_code
from erp.organizations o
cross join (
  values
    ('catalog'),
    ('stock'),
    ('prices_promos'),
    ('repairs'),
    ('dashboard')
) as g(group_code)
on conflict (organization_id, group_code) do nothing;

alter table erp.storefront_cutover_groups enable row level security;

drop policy if exists storefront_cutover_groups_select on erp.storefront_cutover_groups;
create policy storefront_cutover_groups_select
  on erp.storefront_cutover_groups
  for select
  to authenticated
  using (
    organization_id = erp.current_organization_id()
    and erp.has_permission('configuration.view')
  );

revoke all on table erp.storefront_cutover_groups from public, anon, authenticated;
grant select on table erp.storefront_cutover_groups to authenticated;
grant select, insert, update, delete on table erp.storefront_cutover_groups to service_role;

create or replace function erp.set_storefront_cutover_group(
  p_group_code text,
  p_admin_tab_hidden boolean,
  p_legacy_write_mode text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, erp, pg_temp
as $$
declare
  v_org uuid := erp.current_organization_id();
  v_actor uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_prev erp.storefront_cutover_groups%rowtype;
  v_next erp.storefront_cutover_groups%rowtype;
begin
  if v_actor is null or v_org is null or not erp.has_permission('configuration.manage') then
    raise exception 'Se requiere el permiso configuration.manage' using errcode = '42501';
  end if;

  if p_group_code is null or p_group_code not in ('catalog', 'stock', 'prices_promos', 'repairs', 'dashboard') then
    raise exception 'Código de grupo inválido' using errcode = '22023';
  end if;

  if p_admin_tab_hidden is null then
    raise exception 'p_admin_tab_hidden es obligatorio' using errcode = '22023';
  end if;

  if p_legacy_write_mode is null or p_legacy_write_mode not in ('off', 'observe', 'block') then
    raise exception 'Modo de escritura legacy inválido' using errcode = '22023';
  end if;

  if v_reason is null then
    raise exception 'El motivo es obligatorio' using errcode = '22023';
  end if;

  select *
    into v_prev
  from erp.storefront_cutover_groups g
  where g.organization_id = v_org
    and g.group_code = p_group_code
  for update;

  insert into erp.storefront_cutover_groups (
    organization_id,
    group_code,
    admin_tab_hidden,
    legacy_write_mode,
    reason,
    updated_by,
    updated_at
  )
  values (
    v_org,
    p_group_code,
    p_admin_tab_hidden,
    p_legacy_write_mode,
    v_reason,
    v_actor,
    now()
  )
  on conflict (organization_id, group_code) do update
  set admin_tab_hidden = excluded.admin_tab_hidden,
      legacy_write_mode = excluded.legacy_write_mode,
      reason = excluded.reason,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  returning * into v_next;

  insert into erp.audit_events (
    organization_id,
    branch_id,
    actor_user_id,
    schema_name,
    table_name,
    record_id,
    action,
    reason,
    request_id,
    old_values,
    new_values,
    metadata
  )
  values (
    v_org,
    null,
    v_actor,
    'erp',
    'storefront_cutover_groups',
    p_group_code,
    case when v_prev.organization_id is null then 'insert' else 'update' end,
    v_reason,
    nullif(current_setting('request.id', true), ''),
    case when v_prev.organization_id is null then null else to_jsonb(v_prev) end,
    to_jsonb(v_next),
    jsonb_build_object(
      'group_code', p_group_code,
      'rpc', 'set_storefront_cutover_group'
    )
  );
end;
$$;

revoke all on function erp.set_storefront_cutover_group(text, boolean, text, text) from public, anon, authenticated, service_role;
grant execute on function erp.set_storefront_cutover_group(text, boolean, text, text) to authenticated;

create or replace function public.get_admin_cutover_flags()
returns table(
  group_code text,
  admin_tab_hidden boolean,
  legacy_write_mode text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, erp, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then
    return;
  end if;

  v_org := erp.current_organization_id();

  -- Fallback only for the legacy storefront admin (same gate as ProtectedRoute):
  -- any other authenticated account without an ERP profile receives nothing.
  if v_org is null then
    if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
       and not exists (
      select 1
      from erp.profiles p
      where p.id = v_uid
        and not p.is_active
    ) then
      select min(o.id::text)::uuid
        into v_org
      from erp.organizations o
      having count(*) = 1;
    end if;
  end if;

  if v_org is null then
    return;
  end if;

  return query
  select
    g.group_code,
    g.admin_tab_hidden,
    g.legacy_write_mode
  from erp.storefront_cutover_groups g
  where g.organization_id = v_org
  order by g.group_code;
end;
$$;

revoke all on function public.get_admin_cutover_flags() from public, anon, authenticated, service_role;
grant execute on function public.get_admin_cutover_flags() to authenticated;
