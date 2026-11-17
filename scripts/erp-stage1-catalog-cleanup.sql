\set ON_ERROR_STOP on
-- psql -v apply=true -v actor=UUID -f scripts/erp-stage1-catalog-cleanup.sql
-- Explicit decisions go in the INSERT below. Empty by default; no merge is automatic.
\if :{?apply}
\else
\set apply false
\endif
begin;
create temporary table catalog_cleanup_decisions (
 product_id uuid primary key, new_name text, new_brand_id uuid, new_category_id uuid, new_code text
) on commit drop;
-- INSERT INTO catalog_cleanup_decisions VALUES ('product UUID', 'approved name', 'brand UUID', 'category UUID', 'CAB-0001');

-- Candidates only: similar names are not proof of identical physical products.
select a.id,a.internal_name,b.id,b.internal_name from erp.products a join erp.products b
 on a.organization_id=b.organization_id and a.id<b.id
 and a.category_id is not distinct from b.category_id and a.brand_id is not distinct from b.brand_id
 and split_part(lower(a.internal_name),' ',1)=split_part(lower(b.internal_name),' ',1)
 and length(split_part(btrim(a.internal_name),' ',2))>=3
 and lower(split_part(btrim(a.internal_name),' ',2))=lower(split_part(btrim(b.internal_name),' ',2))
where a.is_active and b.is_active order by a.internal_name,b.internal_name;
select id,internal_code,internal_name from erp.products where brand_id is null order by internal_name;
select id,internal_name,regexp_replace(btrim(internal_name),'[[:space:]]+',' ','g') as normalized_spaces
from erp.products where internal_name is distinct from regexp_replace(btrim(internal_name),'[[:space:]]+',' ','g')
 or internal_name=upper(internal_name) order by internal_name;
select id,internal_code,internal_name from erp.products where internal_code like 'WEB-%' order by internal_name;
-- Correct these published prices before applying migration 20261114100800.
select id,internal_code,base_sale_price from erp.products where is_active and publish_on_web and allow_online_sale and can_sell and base_sale_price<>round(base_sale_price,2);
select v.id,v.product_id,v.final_price_ars from erp.product_variants v join erp.products p on p.id=v.product_id and p.organization_id=v.organization_id
 where p.is_active and p.publish_on_web and p.allow_online_sale and p.can_sell and v.is_active and v.final_price_ars is not null and v.final_price_ars<>round(v.final_price_ars,2);
select * from catalog_cleanup_decisions order by product_id;
\if :apply
\if :{?actor}
select set_config('request.jwt.claim.sub', :'actor', true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$ begin if auth.uid() is null or not erp.has_permission('catalog.manage') then raise exception 'actor requires catalog.manage'; end if; end $$;
\else
\echo 'ERROR: apply requiere -v actor=UUID de un usuario con catalog.manage'
\quit 3
\endif
-- Execute as an authenticated catalog manager for erp.recode_catalog_product.
update erp.products p set internal_name=coalesce(d.new_name,p.internal_name),brand_id=coalesce(d.new_brand_id,p.brand_id),category_id=coalesce(d.new_category_id,p.category_id),updated_by=auth.uid()
from catalog_cleanup_decisions d where p.id=d.product_id and p.organization_id=erp.current_organization_id()
 and (d.new_name is not null or d.new_brand_id is not null or d.new_category_id is not null);
select erp.recode_catalog_product(product_id,new_code) from catalog_cleanup_decisions where new_code is not null;
-- Stock moves are intentionally absent: use erp.post_stock_document with an explicit reviewed document.
commit;
\else
rollback;
\endif
