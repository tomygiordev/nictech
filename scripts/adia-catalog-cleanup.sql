-- Saneamiento Adia: ejecutar como postgres con respaldo previo.
-- Dry-run por defecto: psql -f scripts/adia-catalog-cleanup.sql
-- Aplicar: psql -v apply=true [-v replicas_mode=rename] -f scripts/adia-catalog-cleanup.sql
-- El bypass de proyección (como rewrite-legacy-storage-host.sql) se usa únicamente
-- para original_price legacy y campos sin vínculo ERP o aún no proyectados.
\set ON_ERROR_STOP on
\if :{?apply}
\else
\set apply false
\endif
\if :{?replicas_mode}
\else
\set replicas_mode unpublish
\endif
begin;
select pg_advisory_xact_lock(hashtextextended('adia.catalog_cleanup', 0));
create temp table adia_options (apply boolean, replicas_mode text) on commit drop;
insert into adia_options values (:'apply'::boolean, :'replicas_mode');
do $$ begin
 if (select replicas_mode not in ('unpublish','rename') from adia_options) then raise exception 'replicas_mode inválido'; end if;
 if (select count(*) from erp.storefront_catalog_sync) <> 1 then raise exception 'Se requiere exactamente una organización'; end if;
end $$;
create temp table adia_context on commit drop as
select s.organization_id,
 coalesce((select legacy_write_mode from erp.storefront_cutover_groups where organization_id=s.organization_id and group_code='catalog'),'off') catalog_mode,
 coalesce((select legacy_write_mode from erp.storefront_cutover_groups where organization_id=s.organization_id and group_code='prices_promos'),'off') prices_mode,
 (select count(*) from erp.legacy_write_canary_events) canaries_before
from erp.storefront_catalog_sync s;
\echo '--- Contexto ---'
select * from adia_context;
create temp table adia_candidates on commit drop as
select p.id,p.name,p.price,p.original_price,p.tags,p.condition,p.description,p.is_active, to_jsonb(p) public_before, to_jsonb(e) erp_before,
 e.id is not null as linked, e.sheet_fields_initialized initialized, e.tags erp_tags, e.condition erp_condition,
 e.public_name,e.public_description,e.allow_online_sale,e.base_sale_price,
 (p.original_price is not null and p.original_price <= p.price) r0,
 (coalesce('CYBERMONDAY'=any(p.tags),false) and (p.original_price is null or p.original_price<=p.price or (p.sale_expires_at is not null and p.sale_expires_at<=now())) and not exists(select 1 from public.storefront_promotion_prices s where s.product_id=p.id and s.promotion_id is not null)) r1,
 (p.name ~* '(r[eé]plica|airpods)') r2,
 (coalesce(p.description ~* 'precio[^\n]*\$\s*[0-9]',false)) r3,
 ((p.name ~* '\m(usado|reacondicionado)\M' or coalesce(p.condition ~* '(usado|reacondicionado)',false)) and p.condition is distinct from 'Usado') r4
from public.products p cross join adia_context c
left join erp.products e on e.id=p.id and e.organization_id=c.organization_id and e.item_kind='product';
create temp table adia_public_variants_before on commit drop as select id, to_jsonb(v)-'updated_at' row_data from public.product_variants v;
create temp table adia_erp_variants_before on commit drop as select id, to_jsonb(v)-'updated_at' row_data from erp.product_variants v;
\echo '--- R0 promo invertida ---'
select id,name from adia_candidates where r0 order by name;
\echo '--- R1 CYBERMONDAY ---'
select id,name,linked,initialized from adia_candidates where r1 order by name;
\echo '--- R2 réplicas ---'
select id,name,linked from adia_candidates where r2 order by name;
\echo '--- R3 precio en descripción ---'
select id,name,linked from adia_candidates where r3 order by name;
\echo '--- R4 condición ---'
select id,name,linked,initialized from adia_candidates where r4 order by name;
create temp table adia_erp_touched on commit drop as
select * from adia_candidates where linked and
 ((r1 and (coalesce(initialized,false) or coalesce('CYBERMONDAY'=any(erp_tags),false))) or r2 or r3 or (r4 and coalesce(initialized,false)));
\echo '--- Diferencias de precio ERP/web ---'
select id,name,price,base_sale_price from adia_erp_touched where price is distinct from base_sale_price order by name;
do $$ declare o adia_options%rowtype; c adia_context%rowtype; begin
 select * into o from adia_options; select * into c from adia_context;
 if o.apply and (select count(*) from adia_candidates where r2)<>2 then raise exception 'R2 requiere exactamente dos réplicas'; end if;
 if o.apply and exists(select 1 from adia_candidates where r2 and not linked) then raise exception 'R2 requiere vínculo ERP'; end if;
 if o.apply and exists(select 1 from adia_erp_touched where price is distinct from base_sale_price) then raise exception 'Precios ERP y web difieren'; end if;
 if o.apply and c.catalog_mode='block' and exists(select 1 from adia_candidates where (r1 or r4) and (not linked or not coalesce(initialized,false))) then raise exception 'catalog en block: inicializar fichas en ERP'; end if;
 if c.prices_mode='block' then raise notice 'R0 omitida: prices_promos en block'; end if;
end $$;
\pset format unaligned
\t on
\echo '--- ROLLBACK (guardar esta salida) ---'
select 'begin; set local erp.projecting_storefront_catalog = ''on'';' as rollback_sql
union all
select format('update erp.products set %s where id=%L;',concat_ws(', ',
 case when r1 then format('tags=%L::text[]',erp_tags) end,
 case when r4 and coalesce(initialized,false) then format('condition=%L',erp_condition) end,
 case when r2 and o.replicas_mode='rename' then format('public_name=%L',public_name) end,
 case when r3 or (r2 and o.replicas_mode='rename') then format('public_description=%L',public_description) end,
 case when r2 and o.replicas_mode='unpublish' then format('allow_online_sale=%L',allow_online_sale) end),id)
from adia_erp_touched cross join adia_options o
union all
select format('update public.products set %s where id=%L;',concat_ws(', ',
 case when r0 and x.prices_mode<>'block' then format('original_price=%L',original_price) end,
 case when r1 and (not linked or not coalesce(initialized,false)) then format('tags=%L::text[]',tags) end,
 case when r4 and (not linked or not coalesce(initialized,false)) then format('condition=%L',condition) end,
 case when r3 and not linked then format('description=%L',description) end),id)
from adia_candidates cross join adia_context x
where (r0 and x.prices_mode<>'block') or ((r1 or r4) and (not linked or not coalesce(initialized,false))) or (r3 and not linked)
union all select 'commit;';
\echo '--- FIN ROLLBACK ---'
\t off
\pset format aligned
\if :apply
-- R0 es exclusivamente legacy; el GUC evita sync y canario.
select set_config('erp.projecting_storefront_catalog','on',true);
update public.products p set original_price=null from adia_candidates c, adia_context x where p.id=c.id and c.r0 and x.prices_mode<>'block';
select set_config('erp.projecting_storefront_catalog','',true);
-- R1: la proyección usa tags ERP solo para fichas inicializadas.
update erp.products e set tags=array_remove(e.tags,'CYBERMONDAY') from adia_candidates c where e.id=c.id and c.r1 and c.linked and (coalesce(c.initialized,false) or coalesce('CYBERMONDAY'=any(c.erp_tags),false));
select set_config('erp.projecting_storefront_catalog','on',true);
update public.products p set tags=array_remove(p.tags,'CYBERMONDAY') from adia_candidates c where p.id=c.id and c.r1 and (not c.linked or not coalesce(c.initialized,false));
select set_config('erp.projecting_storefront_catalog','',true);
-- R2: solo campos ERP; la proyección mantiene los precios.
update erp.products e set allow_online_sale=false from adia_candidates c,adia_options o where e.id=c.id and c.r2 and c.linked and o.replicas_mode='unpublish';
update erp.products e set public_name=case when c.name ~* 'max' then 'Auriculares inalámbricos de vincha con cancelación de ruido' else 'Auriculares inalámbricos in-ear con cancelación de ruido' end,
 public_description=nullif(btrim((select string_agg(line,E'\n' order by ord) from regexp_split_to_table(coalesce(e.public_description,''),E'\n') with ordinality t(line,ord) where line !~* '(apple|airpods|siri|iphone|ipad|macbook|digital crown|magsafe|r[eé]plica|^\s*color\s*:)')),'')
from adia_candidates c,adia_options o where e.id=c.id and c.r2 and c.linked and o.replicas_mode='rename';
-- R3: si no existe vínculo, la descripción solo existe en legacy.
update erp.products e set public_description=btrim(regexp_replace(coalesce((select string_agg(line,E'\n' order by ord) from regexp_split_to_table(coalesce(e.public_description,''),E'\n') with ordinality t(line,ord) where line !~* 'precio[^\n]*\$\s*[0-9]'),''),E'\n[[:blank:]]*\n([[:blank:]]*\n)+',E'\n\n','g')) from adia_candidates c where e.id=c.id and c.r3 and c.linked;
select set_config('erp.projecting_storefront_catalog','on',true);
update public.products p set description=btrim(regexp_replace(coalesce((select string_agg(line,E'\n' order by ord) from regexp_split_to_table(coalesce(p.description,''),E'\n') with ordinality t(line,ord) where line !~* 'precio[^\n]*\$\s*[0-9]'),''),E'\n[[:blank:]]*\n([[:blank:]]*\n)+',E'\n\n','g')) from adia_candidates c where p.id=c.id and c.r3 and not c.linked;
select set_config('erp.projecting_storefront_catalog','',true);
-- R4: legacy sigue siendo la fuente mientras la ficha no está inicializada.
update erp.products e set condition='usado' from adia_candidates c where e.id=c.id and c.r4 and c.linked and coalesce(c.initialized,false);
select set_config('erp.projecting_storefront_catalog','on',true);
update public.products p set condition='Usado' from adia_candidates c where p.id=c.id and c.r4 and (not c.linked or not coalesce(c.initialized,false));
select set_config('erp.projecting_storefront_catalog','',true);
do $$ begin
 if exists(select 1 from adia_candidates c join public.products p using(id) where c.r0 and (select prices_mode from adia_context)<>'block' and p.original_price is not null) then raise exception 'Falló R0'; end if;
 if exists(select 1 from adia_candidates c join public.products p using(id) where c.r1 and 'CYBERMONDAY'=any(p.tags)) then raise exception 'Falló R1'; end if;
 if exists(select 1 from adia_candidates c join public.products p using(id) cross join adia_options o where c.r2 and ((o.replicas_mode='unpublish' and p.is_active is distinct from false) or (o.replicas_mode='rename' and p.name is distinct from case when c.name ~* 'max' then 'Auriculares inalámbricos de vincha con cancelación de ruido' else 'Auriculares inalámbricos in-ear con cancelación de ruido' end))) then raise exception 'Falló R2'; end if;
 if exists(select 1 from adia_candidates c join public.products p using(id) where c.r3 and p.description ~* 'precio[^\n]*\$\s*[0-9]') then raise exception 'Falló R3'; end if;
 if exists(select 1 from adia_candidates c join public.products p using(id) where c.r4 and p.condition is distinct from 'Usado') then raise exception 'Falló R4'; end if;
 if exists(select 1 from adia_candidates c join public.products p using(id) where (c.r0 or c.r1 or c.r2 or c.r3 or c.r4) and p.price is distinct from c.price) then raise exception 'Cambió el precio web'; end if;
 if exists(select 1 from adia_candidates c join public.products p using(id) cross join adia_options o
  where (to_jsonb(p) - array_remove(array['updated_at',case when c.r0 then 'original_price' end,case when c.r1 then 'tags' end,case when c.r4 then 'condition' end,case when c.r3 or (c.r2 and o.replicas_mode='rename') then 'description' end,case when c.r2 and o.replicas_mode='rename' then 'name' end,case when c.r2 and o.replicas_mode='unpublish' then 'is_active' end],null))
   is distinct from (c.public_before - array_remove(array['updated_at',case when c.r0 then 'original_price' end,case when c.r1 then 'tags' end,case when c.r4 then 'condition' end,case when c.r3 or (c.r2 and o.replicas_mode='rename') then 'description' end,case when c.r2 and o.replicas_mode='rename' then 'name' end,case when c.r2 and o.replicas_mode='unpublish' then 'is_active' end],null))) then raise exception 'La proyección alteró campos web ajenos a las reglas'; end if;
 if exists(select 1 from adia_candidates c join erp.products e using(id) where c.linked and (to_jsonb(e)-array['updated_at','web_status','tags','condition','public_name','public_description','allow_online_sale']) is distinct from (c.erp_before-array['updated_at','web_status','tags','condition','public_name','public_description','allow_online_sale'])) then raise exception 'Se alteraron campos ERP ajenos a las reglas'; end if;
 if exists ((select id,row_data from adia_public_variants_before except select id,to_jsonb(v)-'updated_at' from public.product_variants v) union all (select id,to_jsonb(v)-'updated_at' from public.product_variants v except select id,row_data from adia_public_variants_before)) then raise exception 'La proyección alteró variantes web'; end if;
 if exists ((select id,row_data from adia_erp_variants_before except select id,to_jsonb(v)-'updated_at' from erp.product_variants v) union all (select id,to_jsonb(v)-'updated_at' from erp.product_variants v except select id,row_data from adia_erp_variants_before)) then raise exception 'Se alteraron variantes ERP'; end if;
 if (select count(*) from erp.legacy_write_canary_events)<>(select canaries_before from adia_context) then raise exception 'Se generaron canarios'; end if;
end $$;
\endif
\echo '--- Resumen ---'
select rule,candidates,case when o.apply and not (rule='R0' and x.prices_mode='block') then candidates else 0 end applied,
 case when o.apply and not (rule='R0' and x.prices_mode='block') then 0 else candidates end omitted,o.replicas_mode,o.apply
from (select 'R0' rule,count(*) candidates from adia_candidates where r0 union all select 'R1',count(*) from adia_candidates where r1 union all select 'R2',count(*) from adia_candidates where r2 union all select 'R3',count(*) from adia_candidates where r3 union all select 'R4',count(*) from adia_candidates where r4) t cross join adia_options o cross join adia_context x order by rule;
select (select count(*) from erp.legacy_write_canary_events)-canaries_before as canary_delta from adia_context;
\if :apply
commit;
\else
rollback;
\endif





