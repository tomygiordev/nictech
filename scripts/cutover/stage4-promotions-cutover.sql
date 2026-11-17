-- =============================================================================
-- Etapa 4: corte de promociones legacy (public.products) hacia el ERP (erp.promotions)
-- =============================================================================
-- REQUISITOS PREVIOS OBLIGATORIOS:
--   1. Activar modo mantenimiento de checkout: ERP_CHECKOUT_PAUSED=true.
--   2. Tomar un respaldo completo (pg_dump / snapshot) antes de correr con apply=true.
--   3. Ejecutar como rol de servicio/postgres (p. ej. psql).
--
-- Uso:
--   Dry-run (predeterminado, no modifica datos):
--     psql -f scripts/cutover/stage4-promotions-cutover.sql
--   Aplicar corte:
--     psql -v apply=true -f scripts/cutover/stage4-promotions-cutover.sql
-- =============================================================================

\set ON_ERROR_STOP on
\if :{?apply}
\else
\set apply false
\endif

\echo 'Etapa 4: corte de promociones (predeterminado: dry-run; usar -v apply=true para aplicar)'

begin;
select pg_advisory_xact_lock(hashtextextended('erp.cutover.stage4_promotions', 0));

-- -----------------------------------------------------------------------------
-- DECISIONES EDITABLES POR EL USUARIO
-- -----------------------------------------------------------------------------
-- open_ended_policy:
--   'create_null' -> (default) migrar promos sin sale_expires_at con ends_at = NULL
--   'skip'        -> omitir promos que no tengan sale_expires_at
--   'set_end'     -> asignar open_ended_ends_at a las promos sin sale_expires_at
-- excluded_product_ids:
--   array de UUIDs de public.products a excluir explícitamente del corte.
-- -----------------------------------------------------------------------------
create temp table stage4_decisions (
  open_ended_policy text not null check (open_ended_policy in ('create_null', 'skip', 'set_end')),
  open_ended_ends_at timestamptz null,
  excluded_product_ids uuid[] not null default '{}'::uuid[]
) on commit drop;

insert into stage4_decisions (open_ended_policy, open_ended_ends_at, excluded_product_ids)
values (
  'create_null',
  null,
  array[]::uuid[]
);

-- Pre-chequeos de esquema, decisiones y estado previo de corte
do $$
declare
  v_dec stage4_decisions%rowtype;
  v_now timestamptz := now();
begin
  if to_regclass('public.products') is null then
    raise exception 'No existe public.products; no aplica el corte de Etapa 4.';
  end if;
  if to_regclass('erp.promotions') is null or to_regclass('erp.promotion_targets') is null then
    raise exception 'Faltan erp.promotions o erp.promotion_targets (migración 20261114400000).';
  end if;
  if to_regprocedure('erp.resolve_catalog_price_for_channel(uuid,uuid,uuid,timestamptz,text)') is null then
    raise exception 'Falta erp.resolve_catalog_price_for_channel(uuid,uuid,uuid,timestamptz,text).';
  end if;
  if (select count(*) from stage4_decisions) <> 1 then
    raise exception 'stage4_decisions debe contener exactamente una fila.';
  end if;
  select * into strict v_dec from stage4_decisions;
  if v_dec.open_ended_policy = 'set_end' and (v_dec.open_ended_ends_at is null or v_dec.open_ended_ends_at <= v_now) then
    raise exception 'open_ended_policy = set_end requiere open_ended_ends_at > now().';
  end if;
  if to_regclass('erp.cutover_promotions_log') is not null then
    if exists (select 1 from erp.cutover_promotions_log where rolled_back_at is null) then
      raise exception 'Ya existe un corte activo en erp.cutover_promotions_log (ejecutar rollback antes de re-aplicar).';
    end if;
  end if;
end $$;

-- Clasificación de candidatos (sin exponer datos personales)
create temp table stage4_candidates on commit drop as
with dec as (
  select * from stage4_decisions
),
v_ref as (
  select now() as cutoff_at
)
select
  w.id as product_id,
  w.name as product_name,
  ep.organization_id,
  w.price as promo_price,
  w.original_price as list_price,
  ep.base_sale_price as erp_base_sale_price,
  w.sale_expires_at,
  case
    when w.sale_expires_at is not null then w.sale_expires_at
    when d.open_ended_policy = 'set_end' then d.open_ended_ends_at
    else null
  end as target_ends_at,
  coalesce(w.tags, '{}'::text[]) as public_tags,
  coalesce(ep.tags, '{}'::text[]) as erp_tags,
  coalesce(ep.sheet_fields_initialized, false) as sheet_fields_initialized,
  ('CYBERMONDAY' = any(coalesce(w.tags, '{}'::text[]))) as has_cybermonday,
  (ep.id is not null) as has_erp_link,
  case
    when w.original_price is null then 'sin_promo'
    when w.original_price <= w.price then 'invertida'
    when ep.id is null then 'sin_vinculo_erp'
    when w.id = any(d.excluded_product_ids) then 'excluida_decision'
    when w.sale_expires_at is not null and w.sale_expires_at <= r.cutoff_at then 'vencida_no_migrada'
    when w.sale_expires_at is null and d.open_ended_policy = 'skip' then 'sin_fin_omitida'
    else 'migrable'
  end as status
from public.products w
cross join dec d
cross join v_ref r
left join erp.products ep
  on ep.id = w.id
 and ep.item_kind = 'product'
where w.original_price is not null
   or 'CYBERMONDAY' = any(coalesce(w.tags, '{}'::text[]));

-- Validar que los migrables cumplan restricciones de erp.promotions y published_product_price_guard
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from stage4_candidates
  where status = 'migrable'
    and (
      promo_price is null
      or promo_price <= 0
      or promo_price <> round(promo_price, 2)
      or list_price is null
      or list_price <= 0
      or list_price <> round(list_price, 2)
      or btrim(coalesce(product_name, '')) = ''
    );
  if v_bad > 0 then
    raise exception 'Hay % producto(s) migrable(s) con precios inválidos (>2 decimales o <= 0) o nombre vacío.', v_bad;
  end if;
end $$;

\echo '--- Resumen de diagnóstico (solo conteos) ---'
select
  (select count(*) from public.products) as total_public_products,
  count(*) filter (where status <> 'sin_promo') as con_original_price,
  count(*) filter (where status = 'migrable') as a_migrar,
  count(*) filter (where status = 'invertida') as invertidas_no_migradas,
  count(*) filter (where status = 'excluida_decision') as excluidas_por_decision,
  count(*) filter (where status = 'sin_fin_omitida') as sin_fin_omitidas,
  count(*) filter (where status = 'vencida_no_migrada') as vencidas_no_migradas,
  count(*) filter (where status = 'sin_vinculo_erp') as sin_vinculo_erp,
  count(*) filter (where has_cybermonday) as productos_con_cybermonday,
  count(*) filter (where status = 'migrable' and has_cybermonday) as migrables_con_cybermonday
from stage4_candidates;

\echo '--- Promociones invertidas detectadas (NO se migran) ---'
select
  product_id,
  product_name,
  promo_price as current_price,
  list_price as original_price
from stage4_candidates
where status = 'invertida'
order by product_name;

\echo '--- Promociones a migrar ---'
select
  product_id,
  product_name,
  promo_price,
  list_price as new_base_sale_price,
  target_ends_at,
  has_cybermonday
from stage4_candidates
where status = 'migrable'
order by product_name;

\if :apply

\echo 'Aplicando corte de Etapa 4...'

create table if not exists erp.cutover_promotions_log (
  id bigint generated always as identity primary key,
  cutover_batch_id uuid not null,
  organization_id uuid not null references erp.organizations(id),
  product_id uuid not null references erp.products(id),
  promotion_id uuid not null references erp.promotions(id),
  previous_base_sale_price numeric(18, 4),
  new_base_sale_price numeric(18, 4) not null,
  previous_public_price numeric(12, 2) not null,
  previous_public_tags text[] not null default '{}'::text[],
  previous_erp_tags text[] not null default '{}'::text[],
  previous_sheet_fields_initialized boolean not null,
  removed_tag text,
  applied_at timestamptz not null default clock_timestamp(),
  rolled_back_at timestamptz
);
alter table erp.cutover_promotions_log enable row level security;
revoke all on erp.cutover_promotions_log from public, anon, authenticated, service_role;

do $$
declare
  v_batch_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_rec record;
  v_promo_id uuid;
  v_resolved jsonb;
  v_resolved_price numeric;
  v_resolved_list numeric;
  v_resolved_promo uuid;
  v_migrated integer := 0;
  v_tags_removed integer := 0;
begin
  -- 1. Fijar base_sale_price = original_price en ERP y crear promociones precio_fijo {web,pos}
  for v_rec in
    select * from stage4_candidates where status = 'migrable' order by product_name
  loop
    update erp.products
    set base_sale_price = v_rec.list_price
    where id = v_rec.product_id
      and organization_id = v_rec.organization_id;

    insert into erp.promotions (
      organization_id,
      name,
      kind,
      value,
      starts_at,
      ends_at,
      is_active,
      channels
    )
    values (
      v_rec.organization_id,
      left('[corte-etapa4] ' || btrim(v_rec.product_name), 120),
      'precio_fijo',
      round(v_rec.promo_price, 2),
      v_now,
      v_rec.target_ends_at,
      true,
      array['web', 'pos']::text[]
    )
    returning id into v_promo_id;

    insert into erp.promotion_targets (
      organization_id,
      promotion_id,
      product_id,
      variant_id,
      is_active
    )
    values (
      v_rec.organization_id,
      v_promo_id,
      v_rec.product_id,
      null,
      true
    );

    insert into erp.cutover_promotions_log (
      cutover_batch_id,
      organization_id,
      product_id,
      promotion_id,
      previous_base_sale_price,
      new_base_sale_price,
      previous_public_price,
      previous_public_tags,
      previous_erp_tags,
      previous_sheet_fields_initialized,
      removed_tag
    )
    values (
      v_batch_id,
      v_rec.organization_id,
      v_rec.product_id,
      v_promo_id,
      v_rec.erp_base_sale_price,
      v_rec.list_price,
      v_rec.promo_price,
      v_rec.public_tags,
      v_rec.erp_tags,
      v_rec.sheet_fields_initialized,
      case when v_rec.has_cybermonday then 'CYBERMONDAY' else null end
    );

    v_migrated := v_migrated + 1;
  end loop;

  -- 2. Quitar 'CYBERMONDAY' de los productos migrados (sin borrar filas)
  update public.products w
  set tags = array_remove(w.tags, 'CYBERMONDAY')
  from stage4_candidates c
  where c.status = 'migrable'
    and w.id = c.product_id
    and 'CYBERMONDAY' = any(coalesce(w.tags, '{}'::text[]));
  get diagnostics v_tags_removed = row_count;

  update erp.products ep
  set tags = array_remove(ep.tags, 'CYBERMONDAY')
  from stage4_candidates c
  where c.status = 'migrable'
    and ep.id = c.product_id
    and ep.organization_id = c.organization_id
    and 'CYBERMONDAY' = any(coalesce(ep.tags, '{}'::text[]));

  -- 3. Conciliación final obligatoria por cada producto migrado
  for v_rec in
    select l.product_id, l.organization_id, l.promotion_id, c.product_name, c.promo_price, c.list_price
    from erp.cutover_promotions_log l
    join stage4_candidates c on c.product_id = l.product_id and c.status = 'migrable'
    where l.cutover_batch_id = v_batch_id
    order by c.product_name
  loop
    v_resolved := erp.resolve_catalog_price_for_channel(
      v_rec.organization_id,
      v_rec.product_id,
      null,
      now(),
      'web'
    );
    v_resolved_price := (v_resolved->>'final_price_ars')::numeric;
    v_resolved_list := (v_resolved->>'list_price_ars')::numeric;
    v_resolved_promo := (v_resolved->>'promotion_id')::uuid;

    if v_resolved_price is distinct from round(v_rec.promo_price, 2) then
      raise exception 'Conciliación fallida para % (%): web previo %, ERP resuelto %',
        v_rec.product_name, v_rec.product_id, round(v_rec.promo_price, 2), v_resolved_price;
    end if;

    if v_resolved_list is distinct from round(v_rec.list_price, 2) then
      raise exception 'Conciliación de lista fallida para % (%): esperado %, ERP %',
        v_rec.product_name, v_rec.product_id, round(v_rec.list_price, 2), v_resolved_list;
    end if;

    if v_resolved_promo is distinct from v_rec.promotion_id then
      raise exception 'Conciliación de promo ganadora fallida para % (%): esperada %, resuelta %',
        v_rec.product_name, v_rec.product_id, v_rec.promotion_id, v_resolved_promo;
    end if;

    if exists (
      select 1
      from public.products w
      where w.id = v_rec.product_id
        and (
          'CYBERMONDAY' = any(coalesce(w.tags, '{}'::text[]))
          or (
            exists (select 1 from erp.storefront_catalog_sync s where s.organization_id = v_rec.organization_id)
            and w.price is distinct from round(v_rec.list_price, 2)
          )
        )
    ) then
      raise exception 'Conciliación de proyección web fallida para % (%)', v_rec.product_name, v_rec.product_id;
    end if;
  end loop;

  raise notice 'Corte Etapa 4 conciliado OK: % promociones migradas, % productos sin tag CYBERMONDAY (batch %).',
    v_migrated, v_tags_removed, v_batch_id;
end $$;

\echo '--- Conciliación post-corte (productos migrados) ---'
select
  c.product_id,
  c.product_name,
  c.promo_price as web_precio_anterior,
  (erp.resolve_catalog_price_for_channel(c.organization_id, c.product_id, null, now(), 'web')->>'final_price_ars')::numeric as erp_precio_web_actual,
  (erp.resolve_catalog_price_for_channel(c.organization_id, c.product_id, null, now(), 'web')->>'list_price_ars')::numeric as erp_precio_lista_actual,
  w.price as public_products_price,
  w.tags as public_products_tags
from stage4_candidates c
join public.products w on w.id = c.product_id
where c.status = 'migrable'
order by c.product_name;

\echo 'ADVERTENCIA: el puente public.products.price -> erp.base_sale_price solo queda cortado con la bandera prices_promos en block (migración 20261114500100).'
\echo 'Siguiente paso: confirmar prices_promos en block (debía estar así antes del apply) y ocultar la pestaña de promos del admin legacy.'

commit;
\echo 'Corte Etapa 4 aplicado y conciliado.'

\else
rollback;
\echo 'Dry-run completado; no se modificó ningún dato.'
\endif
