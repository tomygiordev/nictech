-- Guard direct ERP writes as well as RPC publication; legacy rows are not rewritten.
create or replace function erp.enforce_published_catalog_price()
returns trigger language plpgsql security definer set search_path=pg_catalog,erp,pg_temp as $$
declare parent erp.products%rowtype;
begin
 if tg_table_name='products' then
  if new.is_active and new.publish_on_web and new.allow_online_sale and new.can_sell then
   if new.base_sale_price<=0 or new.base_sale_price<>round(new.base_sale_price,2) then raise exception using errcode='23514',message='published price must be positive and have at most two decimals'; end if;
   if exists(select 1 from erp.product_variants v where v.organization_id=new.organization_id and v.product_id=new.id and v.is_active and v.final_price_ars is not null and (v.final_price_ars<=0 or v.final_price_ars<>round(v.final_price_ars,2))) then raise exception using errcode='23514',message='published variant price must be positive and have at most two decimals'; end if;
  end if;
 else
  select * into parent from erp.products where id=new.product_id and organization_id=new.organization_id;
  if parent.is_active and parent.publish_on_web and parent.allow_online_sale and parent.can_sell and new.is_active and new.final_price_ars is not null and (new.final_price_ars<=0 or new.final_price_ars<>round(new.final_price_ars,2)) then raise exception using errcode='23514',message='published variant price must be positive and have at most two decimals'; end if;
 end if;
 return new;
end $$;
create trigger published_product_price_guard before insert or update of base_sale_price,publish_on_web,allow_online_sale,is_active,can_sell on erp.products for each row execute function erp.enforce_published_catalog_price();
create trigger published_variant_price_guard before insert or update of final_price_ars,is_active,product_id on erp.product_variants for each row execute function erp.enforce_published_catalog_price();
revoke all on function erp.enforce_published_catalog_price() from public,anon,authenticated;
