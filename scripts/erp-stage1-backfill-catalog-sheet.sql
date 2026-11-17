-- psql -v apply=true -f scripts/erp-stage1-backfill-catalog-sheet.sql
-- Default: report only and ROLLBACK. Run only after taking and checking a backup.
\if :{?apply}
\else
\set apply false
\endif
begin;
create temporary table catalog_backfill_condition_decisions (
 product_id uuid primary key, normalized_condition text check (normalized_condition is null or normalized_condition in ('nuevo','usado','reacondicionado'))
) on commit drop;
-- INSERT INTO catalog_backfill_condition_decisions VALUES ('product UUID', 'usado');
select e.id, e.organization_id, p.tags as source_tags, p.condition as source_condition,
 p.capacity as source_capacity, p.image_url, p.additional_images,
 e.sheet_fields_initialized, e.media_initialized
from public.products p join erp.products e on e.id=p.id
where not e.sheet_fields_initialized or not e.media_initialized
order by e.internal_name;
-- Values outside the supported enum are left untouched until explicitly resolved.
select id,condition from public.products where condition is not null and btrim(condition)<>'' and lower(btrim(condition)) not in ('nuevo','usado','reacondicionado');
with raw_images as (
 select e.id product_id,e.organization_id,p.image_url path,0 ord,true principal
 from public.products p join erp.products e on e.id=p.id where not e.media_initialized and nullif(btrim(p.image_url),'') is not null
 union all
 select e.id,e.organization_id,x.path,x.ord::int,false from public.products p join erp.products e on e.id=p.id
 cross join lateral unnest(coalesce(p.additional_images,'{}'::text[])) with ordinality x(path,ord)
 where not e.media_initialized and nullif(btrim(x.path),'') is not null
), images as (
 select distinct on (organization_id,product_id,path) * from raw_images order by organization_id,product_id,path,ord
), eligible_images as (
 select i.* from images i where not exists(select 1 from erp.product_media m where m.organization_id=i.organization_id and m.product_id=i.product_id and m.is_active and m.variant_id is null and m.storage_path=i.path)
 and (not i.principal or not exists(select 1 from erp.product_media m where m.organization_id=i.organization_id and m.product_id=i.product_id and m.is_active and m.variant_id is null and m.is_primary))
), eligible_products as (
 select p.* from public.products p join erp.products e on e.id=p.id
 where not e.sheet_fields_initialized and (p.condition is null or btrim(p.condition)='' or lower(btrim(p.condition)) in ('nuevo','usado','reacondicionado') or exists(select 1 from catalog_backfill_condition_decisions d where d.product_id=e.id))
)
select (select count(*) from eligible_products where cardinality(coalesce(tags,'{}'))>0) tags_a_copiar,
 (select count(*) from eligible_products where condition is not null) condiciones,
 (select count(*) from eligible_products where capacity is not null) capacidades,
 (select count(*) from eligible_images) medios_a_crear;
with raw_images as (
 select e.id product_id,e.organization_id,p.image_url path,0 ord,true principal
 from public.products p join erp.products e on e.id=p.id where not e.media_initialized and nullif(btrim(p.image_url),'') is not null
 union all
 select e.id,e.organization_id,x.path,x.ord::int,false from public.products p join erp.products e on e.id=p.id
 cross join lateral unnest(coalesce(p.additional_images,'{}'::text[])) with ordinality x(path,ord)
 where not e.media_initialized and nullif(btrim(x.path),'') is not null
), images as (
 select distinct on (organization_id,product_id,path) * from raw_images order by organization_id,product_id,path,ord
)
select product_id,path as ruta,principal from images i
where not exists(select 1 from erp.product_media m where m.organization_id=i.organization_id and m.product_id=i.product_id and m.is_active and m.variant_id is null and m.storage_path=i.path)
 and (not i.principal or not exists(select 1 from erp.product_media m where m.organization_id=i.organization_id and m.product_id=i.product_id and m.is_active and m.variant_id is null and m.is_primary))
order by product_id,ruta;
\if :apply
update erp.products e set tags=coalesce(p.tags,'{}'),
 condition=case when exists(select 1 from catalog_backfill_condition_decisions d where d.product_id=e.id) then (select d.normalized_condition from catalog_backfill_condition_decisions d where d.product_id=e.id) when lower(btrim(p.condition)) in ('nuevo','usado','reacondicionado') then lower(btrim(p.condition)) else null end,
 capacity=p.capacity, sheet_fields_initialized=true
from public.products p where p.id=e.id and not e.sheet_fields_initialized
 and (p.condition is null or btrim(p.condition)='' or lower(btrim(p.condition)) in ('nuevo','usado','reacondicionado') or exists(select 1 from catalog_backfill_condition_decisions d where d.product_id=e.id));
with raw_images as (
 select e.id product_id,e.organization_id,p.image_url path,0 ord,true primary_image
 from public.products p join erp.products e on e.id=p.id where not e.media_initialized and nullif(btrim(p.image_url),'') is not null
 union all
 select e.id,e.organization_id,x.path,x.ord::int,false
 from public.products p join erp.products e on e.id=p.id
 cross join lateral unnest(coalesce(p.additional_images,'{}'::text[])) with ordinality x(path,ord)
 where not e.media_initialized and nullif(btrim(x.path),'') is not null
), images as (
 select distinct on (organization_id,product_id,path) * from raw_images order by organization_id,product_id,path,ord
), numbered as (
 select i.*, row_number() over(partition by i.organization_id,i.product_id order by i.ord)::int - 1 +
 coalesce((select max(m.sort_order)+1 from erp.product_media m where m.organization_id=i.organization_id and m.product_id=i.product_id and m.is_active),0) sort_order
 from images i
)
insert into erp.product_media(organization_id,product_id,storage_path,sort_order,is_primary)
select n.organization_id,n.product_id,n.path,n.sort_order,n.primary_image from numbered n
where not exists(select 1 from erp.product_media m where m.organization_id=n.organization_id and m.product_id=n.product_id and m.is_active and m.variant_id is null and m.storage_path=n.path)
on conflict do nothing;
update erp.products e set media_initialized=true from public.products p where p.id=e.id and not e.media_initialized;
commit;
\else
rollback;
\endif
