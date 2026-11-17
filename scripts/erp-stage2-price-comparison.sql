begin read only;
-- Run as the database owner or service role before cutover; this only reports.
select p.organization_id, w.id as product_id, w.name, v.id as variant_id,
       v.name as variant_name, w.price as old_parent_price, resolved.price as new_price,
       v.final_price_ars is not null as has_own_price,
       case when p.id is null or sync.organization_id is null then 'sin_vinculo_erp'
            when not (p.is_active and p.publish_on_web and p.allow_online_sale and p.can_sell) then 'no_habilitado_erp'
            when w.price is distinct from resolved.price and v.final_price_ars is null then 'diferencia_inesperada'
            when w.price is distinct from resolved.price then 'precio_propio'
            else 'igual' end as comparison
from public.products w
left join erp.products p on p.id=w.id and p.item_kind='product'
left join erp.storefront_catalog_sync sync on sync.organization_id=p.organization_id
left join erp.product_variants v on v.product_id=p.id and v.organization_id=p.organization_id and v.is_active
cross join lateral (select case when sync.organization_id is not null then
  (erp.resolve_catalog_effective_price_internal(p.organization_id,p.id,v.id,now())->>'final_price_ars')::numeric
  else null end as price) resolved
where w.is_active
order by w.name,v.name nulls first,v.id;
-- Projection uses numeric(12,2), including inactive rows in the backfill.
select p.organization_id,p.id as product_id,v.id as variant_id,
       coalesce(v.final_price_ars,p.base_sale_price,0) as price,
       p.is_active as product_active,v.is_active as variant_active
from erp.product_variants v
join erp.products p on p.id=v.product_id and p.organization_id=v.organization_id
join erp.storefront_catalog_sync sync on sync.organization_id=p.organization_id
join public.product_variants w on w.id=v.id and w.product_id=p.id
where abs(coalesce(v.final_price_ars,p.base_sale_price,0)) > 9999999999.99
   or coalesce(v.final_price_ars,p.base_sale_price,0) <> round(coalesce(v.final_price_ars,p.base_sale_price,0),2)
order by p.id,v.id;
rollback;
