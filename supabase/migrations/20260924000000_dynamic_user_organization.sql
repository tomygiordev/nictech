create or replace function erp.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  default_org_id uuid := '10000000-0000-0000-0000-000000000001';
  owner_role_id uuid := '40000000-0000-0000-0000-000000000001';
begin
  -- Crear el perfil asociado a la organizacion por defecto
  insert into erp.profiles (id, organization_id, display_name)
  values (
    new.id,
    default_org_id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Usuario'
    )
  )
  on conflict (id) do update set organization_id = default_org_id;

  -- Asignar rol de 'owner' por defecto a este usuario
  insert into erp.profile_roles (organization_id, profile_id, role_id)
  values (
    default_org_id,
    new.id,
    owner_role_id
  )
  on conflict do nothing;

  return new;
end;
$$;
