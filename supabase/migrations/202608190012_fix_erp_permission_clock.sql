create or replace function erp.has_permission(
  permission_code text,
  target_branch_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = erp, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  current_organization_id uuid;
  permission_check_time timestamptz := now();
begin
  if auth.role() = 'service_role' then return true; end if;
  select profile.organization_id into current_organization_id
  from erp.profiles profile where profile.id = current_user_id and profile.is_active;
  if current_user_id is null or current_organization_id is null then return false; end if;
  if target_branch_id is not null and not exists (
    select 1 from erp.branches branch
    where branch.id = target_branch_id
      and branch.organization_id = current_organization_id and branch.is_active
  ) then return false; end if;
  if exists (
    select 1 from erp.profile_permission_overrides override_grant
    join erp.permissions permission on permission.id = override_grant.permission_id
    where override_grant.profile_id = current_user_id
      and override_grant.organization_id = current_organization_id
      and permission.code = permission_code and permission.is_active
      and override_grant.effect = 'deny'
      and override_grant.valid_from <= permission_check_time
      and (override_grant.valid_until is null or override_grant.valid_until > permission_check_time)
      and (override_grant.branch_id is null or override_grant.branch_id = target_branch_id)
  ) then return false; end if;
  if exists (
    select 1 from erp.profile_permission_overrides override_grant
    join erp.permissions permission on permission.id = override_grant.permission_id
    where override_grant.profile_id = current_user_id
      and override_grant.organization_id = current_organization_id
      and permission.code = permission_code and permission.is_active
      and override_grant.effect = 'allow'
      and override_grant.valid_from <= permission_check_time
      and (override_grant.valid_until is null or override_grant.valid_until > permission_check_time)
      and (override_grant.branch_id is null or override_grant.branch_id = target_branch_id)
  ) then return true; end if;
  return exists (
    select 1 from erp.profile_roles profile_role
    join erp.roles role on role.id = profile_role.role_id and role.is_active
    join erp.role_permissions role_permission
      on role_permission.role_id = role.id and role_permission.is_active
    join erp.permissions permission on permission.id = role_permission.permission_id
    where profile_role.profile_id = current_user_id
      and profile_role.organization_id = current_organization_id
      and role.organization_id = current_organization_id
      and permission.code = permission_code and permission.is_active
      and profile_role.valid_from <= permission_check_time
      and (profile_role.valid_until is null or profile_role.valid_until > permission_check_time)
      and (profile_role.branch_id is null or profile_role.branch_id = target_branch_id)
  );
end;
$$;
