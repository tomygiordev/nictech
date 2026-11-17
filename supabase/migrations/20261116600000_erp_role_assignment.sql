-- Assign one global role without deleting role history. Only global owner/admin may call.
create or replace function erp.assign_profile_role(p_profile_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, erp, pg_temp
as $$
declare
  v_org uuid := erp.current_organization_id();
  v_actor uuid := auth.uid();
  v_owner boolean;
  v_admin boolean;
  v_target_code text;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or v_org is null then
    raise exception 'Se requiere una sesión activa' using errcode = '42501';
  end if;
  if not erp.has_permission('users.manage') then
    raise exception 'Se requiere el permiso users.manage' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text, 16600000));
  v_now := clock_timestamp();
  select coalesce(bool_or(r.code = 'owner'), false), coalesce(bool_or(r.code = 'admin'), false)
    into v_owner, v_admin
  from erp.profile_roles pr join erp.roles r on r.id = pr.role_id and r.organization_id = pr.organization_id
  where pr.profile_id = v_actor and pr.organization_id = v_org and pr.branch_id is null
    and pr.valid_from <= v_now and (pr.valid_until is null or pr.valid_until > v_now) and r.is_active;
  if not (v_owner or v_admin) then
    raise exception 'Solo owner o admin pueden asignar roles' using errcode = '42501';
  end if;
  if p_profile_id = v_actor then
    raise exception 'No podés cambiar tu propio rol' using errcode = '42501';
  end if;
  if not exists (select 1 from erp.profiles p where p.id = p_profile_id and p.organization_id = v_org and p.is_active) then
    raise exception 'Perfil activo no encontrado en la organización' using errcode = '22023';
  end if;
  select r.code into v_target_code from erp.roles r where r.id = p_role_id and r.organization_id = v_org and r.is_active;
  if v_target_code is null then
    raise exception 'Rol activo no encontrado en la organización' using errcode = '22023';
  end if;
  if exists (select 1 from erp.profile_roles pr where pr.profile_id = p_profile_id and pr.organization_id = v_org and pr.valid_from > v_now and (pr.valid_until is null or pr.valid_until > v_now)) then
    raise exception 'El perfil tiene asignaciones futuras; revisalas antes de cambiar el rol' using errcode = '22023';
  end if;
  if not v_owner and (
    v_target_code in ('owner', 'admin')
    or exists (select 1 from erp.profile_roles pr join erp.roles r on r.id = pr.role_id where pr.profile_id = p_profile_id and pr.organization_id = v_org and pr.valid_from <= v_now and (pr.valid_until is null or pr.valid_until > v_now) and r.code in ('owner', 'admin'))
    or exists (select 1 from erp.role_permissions rp join erp.permissions p on p.id = rp.permission_id where rp.role_id = p_role_id and rp.organization_id = v_org and rp.is_active and p.is_active and (p.is_sensitive or not erp.has_permission(p.code)))
  ) then
    raise exception 'El administrador no puede asignar ni modificar ese rol' using errcode = '42501';
  end if;
  update erp.profile_roles set valid_until = greatest(v_now, valid_from + interval '1 microsecond')
  where organization_id = v_org and profile_id = p_profile_id and valid_from <= v_now
    and (valid_until is null or valid_until > v_now);
  insert into erp.profile_roles (organization_id, profile_id, role_id, branch_id, valid_from, valid_until, created_by)
  values (v_org, p_profile_id, p_role_id, null, v_now, null, v_actor)
  on conflict (profile_id, role_id) where branch_id is null
  do update set valid_from = excluded.valid_from, valid_until = null, created_by = excluded.created_by;
end;
$$;
revoke all on function erp.assign_profile_role(uuid, uuid) from public, anon;
grant execute on function erp.assign_profile_role(uuid, uuid) to authenticated;

-- Role assignments must pass the checked RPC; historical rows remain readable.
revoke insert, update on erp.profile_roles from authenticated;
