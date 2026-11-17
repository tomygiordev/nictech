-- Etapa 7 (acceso): rol ERP "Contenido web" sin permisos operativos.
-- No existe actualmente en erp.permissions ningun permiso de contenido web (banners/blog);
-- por lo tanto, el rol se crea sin permisos asignados y sin ampliar el catalogo global.

create or replace function erp.ensure_web_content_role_for_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, erp, pg_temp
as $$
begin
  insert into erp.roles (
    organization_id,
    code,
    name,
    description,
    is_system
  )
  values (
    new.id,
    'web_content',
    'Contenido web',
    'Gestion de contenido web (banners y blog) sin permisos operativos del ERP.',
    true
  )
  on conflict on constraint roles_code_unique do nothing;

  return new;
end;
$$;

revoke all on function erp.ensure_web_content_role_for_organization() from public, anon, authenticated, service_role;

drop trigger if exists organization_web_content_role on erp.organizations;
create trigger organization_web_content_role
  after insert on erp.organizations
  for each row execute function erp.ensure_web_content_role_for_organization();

insert into erp.roles (
  organization_id,
  code,
  name,
  description,
  is_system
)
select
  o.id,
  'web_content',
  'Contenido web',
  'Gestion de contenido web (banners y blog) sin permisos operativos del ERP.',
  true
from erp.organizations o
on conflict on constraint roles_code_unique do nothing;
