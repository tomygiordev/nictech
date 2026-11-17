-- =============================================================================
-- Etapa 4: rollback del corte de promociones
-- =============================================================================
-- REQUISITOS PREVIOS:
--   1. Mantener ERP_CHECKOUT_PAUSED=true durante la reversión.
--   2. Ejecutar como rol de servicio/postgres (p. ej. psql).
--
-- Comportamiento:
--   - Desactiva (is_active = false, sin borrar filas) las promociones creadas
--     por stage4-promotions-cutover.sql según erp.cutover_promotions_log.
--   - Restaura erp.products.base_sale_price y los tags ('CYBERMONDAY') al estado
--     previo registrado en erp.cutover_promotions_log.
--   - Concilia precios y estado final antes de confirmar.
--
-- Uso:
--   Dry-run (predeterminado, no modifica datos):
--     psql -f scripts/cutover/stage4-promotions-rollback.sql
--   Aplicar rollback:
--     psql -v apply=true -f scripts/cutover/stage4-promotions-rollback.sql
-- =============================================================================

\set ON_ERROR_STOP on
\if :{?apply}
\else
\set apply false
\endif

\echo 'Etapa 4: rollback de promociones (predeterminado: dry-run; usar -v apply=true para aplicar)'

begin;
select pg_advisory_xact_lock(hashtextextended('erp.cutover.stage4_promotions', 0));

do $$
begin
  if to_regclass('erp.cutover_promotions_log') is null then
    raise exception 'No existe erp.cutover_promotions_log; no hay corte Etapa 4 para revertir.';
  end if;
  if not exists (select 1 from erp.cutover_promotions_log where rolled_back_at is null) then
    raise exception 'No hay ningún corte activo (rolled_back_at is null) en erp.cutover_promotions_log.';
  end if;
end $$;

create temp table stage4_rollback_targets on commit drop as
with active_batch as (
  select cutover_batch_id
  from erp.cutover_promotions_log
  where rolled_back_at is null
  order by applied_at desc, id desc
  limit 1
)
select
  l.id as log_id,
  l.cutover_batch_id,
  l.organization_id,
  l.product_id,
  l.promotion_id,
  coalesce(nullif(ep.public_name, ''), ep.internal_name) as product_name,
  l.previous_base_sale_price,
  l.new_base_sale_price,
  l.previous_public_price,
  l.previous_public_tags,
  l.previous_erp_tags,
  l.previous_sheet_fields_initialized,
  l.removed_tag,
  ep.base_sale_price as current_base_sale_price,
  pr.name as promotion_name,
  pr.is_active as promotion_is_active
from erp.cutover_promotions_log l
join active_batch b on b.cutover_batch_id = l.cutover_batch_id
join erp.products ep on ep.id = l.product_id and ep.organization_id = l.organization_id
join erp.promotions pr on pr.id = l.promotion_id and pr.organization_id = l.organization_id
where l.rolled_back_at is null;

\echo '--- Resumen de rollback (solo conteos) ---'
select
  count(*) as promociones_a_desactivar,
  count(*) filter (where promotion_is_active) as promociones_actualmente_activas,
  count(*) filter (where removed_tag = 'CYBERMONDAY') as tags_cybermonday_a_restaurar
from stage4_rollback_targets;

\echo '--- Productos incluidos en el rollback ---'
select
  product_id,
  product_name,
  promotion_id,
  promotion_name,
  current_base_sale_price,
  previous_base_sale_price as restored_base_sale_price,
  removed_tag
from stage4_rollback_targets
order by product_name;

\if :apply

\echo 'Aplicando rollback de Etapa 4...'

do $$
declare
  v_rec record;
  v_resolved jsonb;
  v_resolved_price numeric;
  v_resolved_promo uuid;
  v_deactivated integer := 0;
  v_restored_prices integer := 0;
  v_restored_tags integer := 0;
begin
  -- 1. Desactivar promociones creadas por el corte (sin borrar filas)
  update erp.promotions p
  set is_active = false,
      updated_at = now()
  from stage4_rollback_targets t
  where p.id = t.promotion_id
    and p.organization_id = t.organization_id
    and p.is_active;
  get diagnostics v_deactivated = row_count;

  -- 2. Restaurar tags ('CYBERMONDAY') y precio público previo en public.products
  -- Se ejecuta antes de restaurar erp.products para que project_catalog_sheet
  -- preserve previous_public_tags cuando sheet_fields_initialized era false.
  update public.products w
  set tags = case
               when t.removed_tag is not null
                    and not (t.removed_tag = any(coalesce(w.tags, '{}'::text[])))
               then array_append(coalesce(w.tags, '{}'::text[]), t.removed_tag)
               else w.tags
             end,
      price = t.previous_public_price
  from stage4_rollback_targets t
  where w.id = t.product_id
    and (
      w.price is distinct from t.previous_public_price
      or (
        t.removed_tag is not null
        and not (t.removed_tag = any(coalesce(w.tags, '{}'::text[])))
      )
    );
  get diagnostics v_restored_tags = row_count;

  -- 3. Restaurar base_sale_price y campos de ficha previos en erp.products
  update erp.products ep
  set base_sale_price = t.previous_base_sale_price,
      tags = t.previous_erp_tags,
      sheet_fields_initialized = t.previous_sheet_fields_initialized
  from stage4_rollback_targets t
  where ep.id = t.product_id
    and ep.organization_id = t.organization_id
    and (
      ep.base_sale_price is distinct from t.previous_base_sale_price
      or ep.tags is distinct from t.previous_erp_tags
      or ep.sheet_fields_initialized is distinct from t.previous_sheet_fields_initialized
    );
  get diagnostics v_restored_prices = row_count;

  -- 4. Marcar lote como revertido en erp.cutover_promotions_log
  update erp.cutover_promotions_log l
  set rolled_back_at = clock_timestamp()
  from stage4_rollback_targets t
  where l.id = t.log_id;

  -- 5. Conciliación post-rollback
  for v_rec in
    select * from stage4_rollback_targets order by product_name
  loop
    if exists (
      select 1
      from erp.promotions p
      where p.id = v_rec.promotion_id
        and p.is_active
    ) then
      raise exception 'Rollback fallido: promoción % sigue activa para %.',
        v_rec.promotion_id, v_rec.product_name;
    end if;

    if exists (
      select 1
      from erp.products ep
      where ep.id = v_rec.product_id
        and ep.organization_id = v_rec.organization_id
        and ep.base_sale_price is distinct from v_rec.previous_base_sale_price
    ) then
      raise exception 'Rollback fallido: base_sale_price no restaurado para % (%).',
        v_rec.product_name, v_rec.product_id;
    end if;

    if v_rec.removed_tag is not null and exists (
      select 1
      from public.products w
      where w.id = v_rec.product_id
        and not (v_rec.removed_tag = any(coalesce(w.tags, '{}'::text[])))
    ) then
      raise exception 'Rollback fallido: tag % no restaurado en public.products para % (%).',
        v_rec.removed_tag, v_rec.product_name, v_rec.product_id;
    end if;

    v_resolved := erp.resolve_catalog_price_for_channel(
      v_rec.organization_id,
      v_rec.product_id,
      null,
      now(),
      'web'
    );
    v_resolved_price := (v_resolved->>'final_price_ars')::numeric;
    v_resolved_promo := (v_resolved->>'promotion_id')::uuid;

    if v_resolved_promo = v_rec.promotion_id then
      raise exception 'Rollback fallido: promoción % sigue aplicando en resolver para %.',
        v_rec.promotion_id, v_rec.product_name;
    end if;

    if v_resolved_price is distinct from round(coalesce(v_rec.previous_base_sale_price, 0), 2) then
      raise exception 'Conciliación post-rollback fallida para % (%): esperado %, resuelto %.',
        v_rec.product_name, v_rec.product_id, round(coalesce(v_rec.previous_base_sale_price, 0), 2), v_resolved_price;
    end if;
  end loop;

  raise notice 'Rollback Etapa 4 conciliado OK: % promos desactivadas, % filas public actualizadas, % filas ERP restauradas.',
    v_deactivated, v_restored_tags, v_restored_prices;
end $$;

\echo '--- Verificación post-rollback ---'
select
  t.product_id,
  t.product_name,
  ep.base_sale_price as erp_base_sale_price,
  w.price as public_price,
  w.tags as public_tags,
  pr.is_active as cutover_promo_active,
  (erp.resolve_catalog_price_for_channel(t.organization_id, t.product_id, null, now(), 'web')->>'final_price_ars')::numeric as erp_resolved_web_price
from stage4_rollback_targets t
join erp.products ep on ep.id = t.product_id and ep.organization_id = t.organization_id
join public.products w on w.id = t.product_id
join erp.promotions pr on pr.id = t.promotion_id
order by t.product_name;

commit;
\echo 'Rollback Etapa 4 aplicado y conciliado.'

\else
rollback;
\echo 'Dry-run de rollback completado; no se modificó ningún dato.'
\endif
