-- Catalog sheet resources. Existing records and stock are never removed.
alter table erp.products add column media_initialized boolean not null default false;
alter table erp.products add column sheet_fields_initialized boolean not null default false;
alter table erp.product_categories add column code_prefix text;
update erp.product_categories
set code_prefix = coalesce(nullif(left(regexp_replace(upper(translate(name,'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')), '[^A-Z0-9]', '', 'g'), 3), ''), 'PRO');
create or replace function erp.default_catalog_category_prefix()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if new.code_prefix is null or btrim(new.code_prefix)='' then
  new.code_prefix:=coalesce(nullif(left(regexp_replace(upper(translate(new.name,'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),'[^A-Z0-9]','','g'),3),''),'PRO');
 end if;
 return new;
end $$;
create trigger category_default_prefix before insert on erp.product_categories for each row execute function erp.default_catalog_category_prefix();
revoke all on function erp.default_catalog_category_prefix() from public,anon,authenticated;
alter table erp.product_categories alter column code_prefix set not null;
alter table erp.product_categories add constraint product_categories_prefix_check check (code_prefix ~ '^[A-Z0-9]{1,8}$');

create table erp.catalog_code_counters (
 organization_id uuid not null references erp.organizations(id), prefix text not null,
 last_value bigint not null default 0 check (last_value >= 0), primary key (organization_id,prefix),
 check (prefix ~ '^[A-Z0-9]{1,8}$')
);
alter table erp.catalog_code_counters enable row level security;
revoke all on erp.catalog_code_counters from public, anon, authenticated;

create table erp.colors (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references erp.organizations(id),
 name text not null check (btrim(name) <> ''), hex text check (hex is null or hex ~ '^#[0-9A-Fa-f]{6}$'),
 is_active boolean not null default true, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
 unique(id, organization_id)
);
create unique index colors_org_name_unique on erp.colors (organization_id, lower(btrim(name)));
alter table erp.product_variants add column color_id uuid;
alter table erp.product_variants add constraint product_variants_color_fk foreign key (color_id,organization_id) references erp.colors(id,organization_id);

create table erp.product_media (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references erp.organizations(id),
 product_id uuid not null, variant_id uuid, storage_path text not null check (btrim(storage_path) <> ''),
 sort_order integer not null check (sort_order >= 0), is_primary boolean not null default false,
 alt_text text, is_active boolean not null default true, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
 constraint product_media_product_fk foreign key (product_id,organization_id) references erp.products(id,organization_id),
 constraint product_media_variant_fk foreign key (variant_id,product_id,organization_id) references erp.product_variants(id,product_id,organization_id)
);
comment on column erp.product_media.storage_path is 'URL pública de un objeto existente del bucket product_images; no se cargan archivos mediante el RPC.';
create unique index product_media_order_unique on erp.product_media(organization_id,product_id,sort_order) where is_active;
create unique index product_media_product_primary_unique on erp.product_media(organization_id,product_id) where is_active and is_primary and variant_id is null;
create unique index product_media_variant_primary_unique on erp.product_media(organization_id,product_id,variant_id) where is_active and is_primary and variant_id is not null;
create trigger colors_touch before update on erp.colors for each row execute function erp.touch_updated_at();
create trigger colors_audit after insert or update on erp.colors for each row execute function erp.audit_row_change();
create trigger product_media_touch before update on erp.product_media for each row execute function erp.touch_updated_at();
create trigger product_media_audit after insert or update on erp.product_media for each row execute function erp.audit_row_change();
alter table erp.colors enable row level security;
alter table erp.product_media enable row level security;
create policy colors_read on erp.colors for select to authenticated using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.view'));
create policy media_read on erp.product_media for select to authenticated using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.view'));
revoke all on erp.colors, erp.product_media from public, anon, authenticated, service_role;
grant select on erp.colors, erp.product_media to authenticated;

-- Preserve existing brands and create a generic reference only where missing.
insert into erp.brands (organization_id,code,name)
select o.id, 'GENERICO', 'Genérico'
from erp.organizations o
where not exists (select 1 from erp.brands b where b.organization_id=o.id and lower(b.name) in ('genérico','generico'))
on conflict do nothing;

create or replace function erp.next_catalog_product_code(p_category_id uuid)
returns text language plpgsql security definer set search_path = pg_catalog, erp, pg_temp as $$
declare org_id uuid := erp.current_organization_id(); v_prefix text; n bigint; candidate text;
begin
 if org_id is null or auth.uid() is null or not erp.has_permission('catalog.manage') then
   raise exception using errcode='42501',message='catalog.manage permission is required';
 end if;
 select c.code_prefix into v_prefix from erp.product_categories c where c.id=p_category_id and c.organization_id=org_id;
 if v_prefix is null then raise exception using errcode='22023',message='categoría válida requerida para generar código'; end if;
 loop
   insert into erp.catalog_code_counters as ctr (organization_id,prefix,last_value) values(org_id,v_prefix,1)
   on conflict on constraint catalog_code_counters_pkey do update set last_value=ctr.last_value+1 returning last_value into n;
   candidate := v_prefix || '-' || lpad(n::text, greatest(4,length(n::text)), '0');
   exit when not exists(select 1 from erp.products p where p.organization_id=org_id and p.normalized_internal_code=upper(candidate));
 end loop;
 return candidate;
end $$;
revoke all on function erp.next_catalog_product_code(uuid) from public,anon,authenticated;

-- Private per-transaction capability: a client-settable GUC alone is not authorization.
create table erp.catalog_recode_capabilities (
 backend_pid integer not null, transaction_id bigint not null, token uuid not null,
 product_id uuid not null, organization_id uuid not null,
 primary key(backend_pid)
);
alter table erp.catalog_recode_capabilities enable row level security;
revoke all on erp.catalog_recode_capabilities from public,anon,authenticated,service_role;
create or replace function erp.prevent_product_code_reassignment()
returns trigger language plpgsql security definer set search_path=pg_catalog,erp,pg_temp as $$
begin
 if new.organization_id <> old.organization_id then
   raise exception using errcode='23000', message='product organization cannot change';
 end if;
 if new.internal_code <> old.internal_code and not exists (
   select 1 from erp.catalog_recode_capabilities c where c.backend_pid=pg_backend_pid()
    and c.transaction_id=txid_current() and c.product_id=old.id and c.organization_id=old.organization_id
    and c.token::text = current_setting('erp.catalog_recode_token',true)
 ) then
   raise exception using errcode='23000',message='product internal codes are permanent; use recode_catalog_product';
 end if;
 return new;
end $$;
create or replace function erp.recode_catalog_product(p_product_id uuid,p_new_code text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,erp,pg_temp as $$
declare org_id uuid := erp.current_organization_id(); v_token uuid := gen_random_uuid(); old_code text; new_code text := upper(btrim(p_new_code));
begin
 if org_id is null or auth.uid() is null or not erp.has_permission('catalog.manage') then raise exception using errcode='42501',message='catalog.manage permission is required'; end if;
 if new_code is null or new_code !~ '^[A-Z0-9][A-Z0-9-]{1,39}$' then raise exception using errcode='22023',message='código inválido'; end if;
 select internal_code into old_code from erp.products where id=p_product_id and organization_id=org_id for update;
 if not found then raise exception using errcode='P0002',message='producto no encontrado'; end if;
 insert into erp.catalog_recode_capabilities (backend_pid,transaction_id,token,product_id,organization_id)
 values(pg_backend_pid(),txid_current(),v_token,p_product_id,org_id)
 on conflict(backend_pid) do update set transaction_id=excluded.transaction_id,token=excluded.token,product_id=excluded.product_id,organization_id=excluded.organization_id;
 perform set_config('erp.catalog_recode_token',v_token::text,true);
 update erp.products set internal_code=new_code,updated_by=auth.uid() where id=p_product_id and organization_id=org_id;
 update erp.catalog_recode_capabilities set token=gen_random_uuid() where backend_pid=pg_backend_pid() and transaction_id=txid_current();
 perform set_config('erp.catalog_recode_token','',true);
 return jsonb_build_object('product_id',p_product_id,'old_code',old_code,'internal_code',new_code);
end $$;
revoke all on function erp.recode_catalog_product(uuid,text) from public,anon;
grant execute on function erp.recode_catalog_product(uuid,text) to authenticated,service_role;

-- The organization can also be created by the seed after migrations.
create or replace function erp.ensure_generic_brand_for_organization()
returns trigger language plpgsql security definer set search_path=pg_catalog,erp,pg_temp as $$
begin
 if not exists(select 1 from erp.brands where organization_id=new.id and lower(name) in ('genérico','generico')) then
  insert into erp.brands(organization_id,code,name) values(new.id,'GENERICO','Genérico') on conflict do nothing;
 end if;
 return new;
end $$;
create trigger organization_generic_brand after insert on erp.organizations for each row execute function erp.ensure_generic_brand_for_organization();
revoke all on function erp.ensure_generic_brand_for_organization() from public,anon,authenticated,service_role;
grant select (tags,condition,capacity,sheet_template,web_status,media_initialized,sheet_fields_initialized) on erp.products to authenticated;
