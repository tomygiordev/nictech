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
do $$ begin if to_regclass('erp.cutover_storage_host_log') is null then raise exception 'No existe el log de corte'; end if; end $$;
create temp table storage_candidates on commit drop as
select table_name,column_name,row_id,new_value as old_value,old_value as new_value from erp.cutover_storage_host_log where rolled_back_at is null;
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

do $$
declare r record; n bigint;
begin
 for r in select distinct table_name,column_name from storage_candidates loop
   if (r.table_name,r.column_name) not in (('erp.products','web_image_path'),('erp.product_variants','image_path'),('public.products','image_url'),('public.products','additional_images'),('public.product_variants','image_url'),('public.hero_banners','image_url'),('public.posts','image_url')) then raise exception 'Columna desconocida en log'; end if;
   execute format('select count(*) from storage_candidates c left join %s t on t.id=c.row_id where c.table_name=$1 and c.column_name=$2 and (t.id is null or to_jsonb(t.%I) is distinct from c.old_value)',r.table_name,r.column_name) into n using r.table_name,r.column_name;
   if n<>0 then raise exception 'Rollback rechazado: % valores cambiaron en %.%',n,r.table_name,r.column_name; end if;
 end loop;
end $$;
\if :apply

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
update erp.cutover_storage_host_log set rolled_back_at=clock_timestamp() where rolled_back_at is null;
\echo 'Rollback aplicado y conciliado.'
commit;
\else
\echo 'Dry-run de rollback.'
rollback;
\endif
