-- Ejecutar con psql como postgres. Respaldar antes de aplicar; probar dry-run primero.
-- Por defecto revierte la transaccion. Aplicar: psql -v apply=true -f <archivo>.
-- Auditoria: no se modifican ni borran eventos existentes; los triggers pueden
-- agregar nuevos eventos del cambio y eso esta aceptado.
\set ON_ERROR_STOP on
\if :{?apply}
\else
\set apply false
\endif
begin;
select pg_advisory_xact_lock(hashtextextended('erp.cutover.storage_host', 0));
lock table erp.products, erp.product_variants, public.products, public.product_variants,
  public.hero_banners, public.posts in share row exclusive mode;
set local erp.projecting_storefront_catalog = 'on';
create temp table storage_candidates (table_name text, column_name text, row_id uuid, old_value jsonb, new_value jsonb) on commit drop;
insert into storage_candidates select 'erp.products', 'web_image_path', id, to_jsonb(web_image_path), to_jsonb('https://qatkzvlomuaoaxlfgjfa.supabase.co/' || substr(t.web_image_path, length('https://tuzpcofywkhglkqplhnn.supabase.co/') + 1)) from erp.products t where left(t.web_image_path, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/';
insert into storage_candidates select 'erp.product_variants', 'image_path', id, to_jsonb(image_path), to_jsonb('https://qatkzvlomuaoaxlfgjfa.supabase.co/' || substr(t.image_path, length('https://tuzpcofywkhglkqplhnn.supabase.co/') + 1)) from erp.product_variants t where left(t.image_path, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/';
insert into storage_candidates select 'public.products', 'image_url', id, to_jsonb(image_url), to_jsonb('https://qatkzvlomuaoaxlfgjfa.supabase.co/' || substr(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/') + 1)) from public.products t where left(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/';
insert into storage_candidates select 'public.products', 'additional_images', id, to_jsonb(additional_images), to_jsonb(array(select case when left(x, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/' then 'https://qatkzvlomuaoaxlfgjfa.supabase.co/' || substr(x, length('https://tuzpcofywkhglkqplhnn.supabase.co/') + 1) else x end from unnest(t.additional_images) with ordinality as u(x,n) order by n)) from public.products t where exists (select 1 from unnest(t.additional_images) x where left(x, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/');
insert into storage_candidates select 'public.product_variants', 'image_url', id, to_jsonb(image_url), to_jsonb('https://qatkzvlomuaoaxlfgjfa.supabase.co/' || substr(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/') + 1)) from public.product_variants t where left(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/';
insert into storage_candidates select 'public.hero_banners', 'image_url', id, to_jsonb(image_url), to_jsonb('https://qatkzvlomuaoaxlfgjfa.supabase.co/' || substr(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/') + 1)) from public.hero_banners t where left(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/';
insert into storage_candidates select 'public.posts', 'image_url', id, to_jsonb(image_url), to_jsonb('https://qatkzvlomuaoaxlfgjfa.supabase.co/' || substr(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/') + 1)) from public.posts t where left(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/';
\echo 'Conteos por columna:'
select v.table_name, v.column_name, count(c.row_id) as filas from (values
  ('erp.products', 'web_image_path'),
  ('erp.product_variants', 'image_path'),
  ('public.products', 'image_url'),
  ('public.products', 'additional_images'),
  ('public.product_variants', 'image_url'),
  ('public.hero_banners', 'image_url'),
  ('public.posts', 'image_url')
) v(table_name,column_name) left join storage_candidates c using (table_name,column_name)
group by v.table_name,v.column_name order by v.table_name,v.column_name;

do $$
declare n bigint;
begin
 if to_regclass('storage.objects') is null then
   raise notice 'storage.objects no existe: se omite verificacion de objetos';
 else
   execute $q$select count(*) from (
      select a.v from storage_candidates c cross join lateral jsonb_array_elements(case when jsonb_typeof(c.new_value)='array' then c.new_value else jsonb_build_array(c.new_value) end) a(v)
   ) x cross join lateral (select regexp_match(x.v #>> '{}', '^https://qatkzvlomuaoaxlfgjfa[.]supabase[.]co/storage/v1/object/public/([^/]+)/(.+)$') as parts) p
   where p.parts is not null and not exists (select 1 from storage.objects o where o.bucket_id=p.parts[1] and o.name=p.parts[2])$q$ into n;
   raise notice 'Paths sin objeto en storage.objects: %', n;
 end if;
end $$;
create temp table storage_columns_before on commit drop as
select 'erp.products'::text as table_name, 'web_image_path'::text as column_name, id as row_id, to_jsonb(web_image_path) as value from erp.products
union all
select 'erp.product_variants'::text as table_name, 'image_path'::text as column_name, id as row_id, to_jsonb(image_path) as value from erp.product_variants
union all
select 'public.products'::text as table_name, 'image_url'::text as column_name, id as row_id, to_jsonb(image_url) as value from public.products
union all
select 'public.products'::text as table_name, 'additional_images'::text as column_name, id as row_id, to_jsonb(additional_images) as value from public.products
union all
select 'public.product_variants'::text as table_name, 'image_url'::text as column_name, id as row_id, to_jsonb(image_url) as value from public.product_variants
union all
select 'public.hero_banners'::text as table_name, 'image_url'::text as column_name, id as row_id, to_jsonb(image_url) as value from public.hero_banners
union all
select 'public.posts'::text as table_name, 'image_url'::text as column_name, id as row_id, to_jsonb(image_url) as value from public.posts;
create temp table storage_before on commit drop as
select 'erp.products'::text as table_name, id, to_jsonb(t) - array['web_image_path','updated_at'] as rest from erp.products t
union all
select 'erp.product_variants'::text as table_name, id, to_jsonb(t) - array['image_path','updated_at'] as rest from erp.product_variants t
union all
select 'public.products'::text as table_name, id, to_jsonb(t) - array['image_url','additional_images','updated_at'] as rest from public.products t
union all
select 'public.product_variants'::text as table_name, id, to_jsonb(t) - array['image_url','updated_at'] as rest from public.product_variants t
union all
select 'public.hero_banners'::text as table_name, id, to_jsonb(t) - array['image_url','updated_at'] as rest from public.hero_banners t
union all
select 'public.posts'::text as table_name, id, to_jsonb(t) - array['image_url','updated_at'] as rest from public.posts t;
\if :apply

create table if not exists erp.cutover_storage_host_log (
  id bigint generated always as identity primary key,
  batch_id uuid not null,
  table_name text not null,
  column_name text not null,
  row_id uuid not null,
  old_value jsonb not null,
  new_value jsonb not null,
  applied_at timestamptz not null default clock_timestamp(),
  rolled_back_at timestamptz
);
alter table erp.cutover_storage_host_log enable row level security;
revoke all on erp.cutover_storage_host_log from public, anon, authenticated, service_role;
insert into erp.cutover_storage_host_log(batch_id,table_name,column_name,row_id,old_value,new_value) select (select gen_random_uuid()),table_name,column_name,row_id,old_value,new_value from storage_candidates;

do $$
declare r record; n bigint;
begin
  for r in select * from storage_candidates order by case when table_name like 'erp.%' then 0 else 1 end, table_name, column_name, row_id loop
    execute format('update %s set %I = (jsonb_populate_record(null::%s, jsonb_build_object(%L, $1))).%I where id = $2 and to_jsonb(%I) is distinct from $1', r.table_name,r.column_name,r.table_name,r.column_name,r.column_name,r.column_name)
      using r.new_value, r.row_id;
  end loop;
end $$;

do $$ declare r record; n bigint; begin
 for r in select distinct table_name,column_name from storage_columns_before loop
  execute format('select count(*) from storage_columns_before b join %s t on t.id=b.row_id left join storage_candidates c on (c.table_name,c.column_name,c.row_id)=(b.table_name,b.column_name,b.row_id) where b.table_name=$1 and b.column_name=$2 and to_jsonb(t.%I) is distinct from case when c.row_id is null then b.value else c.new_value end',r.table_name,r.column_name) into n using r.table_name,r.column_name;
  if n<>0 then raise exception 'Proyeccion modifico % valores inesperados de %.%; rollback', n,r.table_name,r.column_name; end if;
 end loop;
end $$;
do $$
declare r record; n bigint;
begin
  for r in select distinct table_name,column_name from storage_candidates loop
    execute format('select count(*) from storage_candidates c left join %s t on t.id=c.row_id where c.table_name=$1 and c.column_name=$2 and (t.id is null or to_jsonb(t.%I) is distinct from c.new_value)',r.table_name,r.column_name) into n using r.table_name,r.column_name;
    if n <> 0 then raise exception 'No concilian % filas de %.%; rollback', n,r.table_name,r.column_name; end if;
  end loop;
end $$;
do $$ begin if exists (select 1 from (select * from storage_before where table_name='erp.products') b full join erp.products t on b.table_name='erp.products' and b.id=t.id where (b.table_name='erp.products' or t.id is not null) and (b.id is null or t.id is null or b.rest is distinct from (to_jsonb(t) - array['web_image_path','updated_at']))) then raise exception 'Cambios secundarios detectados en erp.products; rollback'; end if; end $$;
do $$ begin if exists (select 1 from (select * from storage_before where table_name='erp.product_variants') b full join erp.product_variants t on b.table_name='erp.product_variants' and b.id=t.id where (b.table_name='erp.product_variants' or t.id is not null) and (b.id is null or t.id is null or b.rest is distinct from (to_jsonb(t) - array['image_path','updated_at']))) then raise exception 'Cambios secundarios detectados en erp.product_variants; rollback'; end if; end $$;
do $$ begin if exists (select 1 from (select * from storage_before where table_name='public.products') b full join public.products t on b.table_name='public.products' and b.id=t.id where (b.table_name='public.products' or t.id is not null) and (b.id is null or t.id is null or b.rest is distinct from (to_jsonb(t) - array['image_url','additional_images','updated_at']))) then raise exception 'Cambios secundarios detectados en public.products; rollback'; end if; end $$;
do $$ begin if exists (select 1 from (select * from storage_before where table_name='public.product_variants') b full join public.product_variants t on b.table_name='public.product_variants' and b.id=t.id where (b.table_name='public.product_variants' or t.id is not null) and (b.id is null or t.id is null or b.rest is distinct from (to_jsonb(t) - array['image_url','updated_at']))) then raise exception 'Cambios secundarios detectados en public.product_variants; rollback'; end if; end $$;
do $$ begin if exists (select 1 from (select * from storage_before where table_name='public.hero_banners') b full join public.hero_banners t on b.table_name='public.hero_banners' and b.id=t.id where (b.table_name='public.hero_banners' or t.id is not null) and (b.id is null or t.id is null or b.rest is distinct from (to_jsonb(t) - array['image_url','updated_at']))) then raise exception 'Cambios secundarios detectados en public.hero_banners; rollback'; end if; end $$;
do $$ begin if exists (select 1 from (select * from storage_before where table_name='public.posts') b full join public.posts t on b.table_name='public.posts' and b.id=t.id where (b.table_name='public.posts' or t.id is not null) and (b.id is null or t.id is null or b.rest is distinct from (to_jsonb(t) - array['image_url','updated_at']))) then raise exception 'Cambios secundarios detectados en public.posts; rollback'; end if; end $$;
create temp table storage_remaining (table_name text, column_name text, row_id uuid, old_value jsonb, new_value jsonb) on commit drop;
insert into storage_remaining select 'erp.products', 'web_image_path', id, to_jsonb(web_image_path), to_jsonb('https://qatkzvlomuaoaxlfgjfa.supabase.co/' || substr(t.web_image_path, length('https://tuzpcofywkhglkqplhnn.supabase.co/') + 1)) from erp.products t where left(t.web_image_path, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/';
insert into storage_remaining select 'erp.product_variants', 'image_path', id, to_jsonb(image_path), to_jsonb('https://qatkzvlomuaoaxlfgjfa.supabase.co/' || substr(t.image_path, length('https://tuzpcofywkhglkqplhnn.supabase.co/') + 1)) from erp.product_variants t where left(t.image_path, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/';
insert into storage_remaining select 'public.products', 'image_url', id, to_jsonb(image_url), to_jsonb('https://qatkzvlomuaoaxlfgjfa.supabase.co/' || substr(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/') + 1)) from public.products t where left(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/';
insert into storage_remaining select 'public.products', 'additional_images', id, to_jsonb(additional_images), to_jsonb(array(select case when left(x, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/' then 'https://qatkzvlomuaoaxlfgjfa.supabase.co/' || substr(x, length('https://tuzpcofywkhglkqplhnn.supabase.co/') + 1) else x end from unnest(t.additional_images) with ordinality as u(x,n) order by n)) from public.products t where exists (select 1 from unnest(t.additional_images) x where left(x, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/');
insert into storage_remaining select 'public.product_variants', 'image_url', id, to_jsonb(image_url), to_jsonb('https://qatkzvlomuaoaxlfgjfa.supabase.co/' || substr(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/') + 1)) from public.product_variants t where left(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/';
insert into storage_remaining select 'public.hero_banners', 'image_url', id, to_jsonb(image_url), to_jsonb('https://qatkzvlomuaoaxlfgjfa.supabase.co/' || substr(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/') + 1)) from public.hero_banners t where left(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/';
insert into storage_remaining select 'public.posts', 'image_url', id, to_jsonb(image_url), to_jsonb('https://qatkzvlomuaoaxlfgjfa.supabase.co/' || substr(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/') + 1)) from public.posts t where left(t.image_url, length('https://tuzpcofywkhglkqplhnn.supabase.co/')) = 'https://tuzpcofywkhglkqplhnn.supabase.co/';
do $$ begin if exists(select 1 from storage_remaining) then raise exception 'Quedan referencias antiguas; rollback'; end if; end $$;
\echo 'Aplicado: conciliacion satisfactoria.'
commit;
\else
\echo 'Dry-run: no se modificaron datos.'
rollback;
\endif
