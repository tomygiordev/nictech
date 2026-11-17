-- New Auth accounts never receive ERP permissions automatically. With no unique
-- organization they remain without a profile until provisioned by an administrator.
create or replace function erp.handle_new_auth_user()
returns trigger language plpgsql security definer
set search_path = pg_catalog, erp, pg_temp as $$
declare
  org_id uuid;
begin
  select min(id::text)::uuid into org_id from erp.organizations having count(*) = 1;
  if org_id is null then
    return new;
  end if;
  insert into erp.profiles (id, organization_id, display_name)
  values (new.id, org_id, coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Usuario'))
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function erp.handle_new_auth_user() from public, anon, authenticated;

-- Explicit first-owner bootstrap: a trusted service must select an existing
-- profile. Subsequent role management belongs to the Users administration RPC.
create or replace function erp.bootstrap_first_owner(p_profile_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, erp, pg_temp as $$
declare
  org_id uuid;
  owner_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  select p.organization_id into org_id from erp.profiles p
  where p.id = p_profile_id and p.is_active;
  if org_id is null then
    raise exception using errcode = '22023', message = 'active organization profile required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('erp.bootstrap_first_owner:' || org_id::text, 0));
  if exists (select 1 from erp.profile_roles pr where pr.organization_id = org_id
    and pr.valid_from <= now() and (pr.valid_until is null or pr.valid_until > now())) then
    raise exception using errcode = '55000', message = 'organization already has active role assignments';
  end if;
  select r.id into owner_id from erp.roles r where r.organization_id = org_id
    and r.code = 'owner' and r.is_active;
  if owner_id is null then
    raise exception using errcode = '22023', message = 'active owner role required';
  end if;
  insert into erp.profile_roles (organization_id, profile_id, role_id)
  values (org_id, p_profile_id, owner_id);
end $$;
revoke all on function erp.bootstrap_first_owner(uuid) from public, anon, authenticated, service_role;
grant execute on function erp.bootstrap_first_owner(uuid) to service_role;
