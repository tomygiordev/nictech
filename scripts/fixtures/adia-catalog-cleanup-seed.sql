-- Solo para adia_check: crear un candidato R4 sin sincronizar la ficha.
begin;
set local erp.projecting_storefront_catalog = 'on';
update public.products set condition='Reacondicionado'
where id=(select id from public.products where name ~* '\m(usado|reacondicionado)\M' and condition='Usado' order by id limit 1);
commit;
