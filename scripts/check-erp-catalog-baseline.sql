-- ============================================================================
-- scripts/check-erp-catalog-baseline.sql
-- ============================================================================
-- NIC-TECH: Conciliación Read-Only de Baseline Catálogo / Precios / Stock (S1)
--
-- Propósito:
--   Ejecutar una consulta de SOLO LECTURA (un único SELECT estructurado con CTEs)
--   que audita y devuelve en un único documento JSON el estado de paridad entre
--   el storefront público (public.*) y el ERP central (erp.*).
--
-- Invariantes de Seguridad y Auditoría:
--   - 100% idempotente y de SOLO LECTURA (SELECT puro, sin DDL/DML, sin mutaciones).
--   - Cero datos personales o identificatorios de clientes (cumple privacidad).
--   - Sin secretos ni credenciales expuestas.
--   - Respeta estrictamente los filtros de ubicación física del ERP:
--     erp.locations.is_active = true AND erp.locations.contributes_to_web_stock = true.
--   - Contempla la regla contable de inventario:
--     NUNCA sumar unidades padre + variantes (evita doble conteo).
--     El stock global on-hand del ERP (499) incluye depósitos no web/servicio
--     y no es directamente comparable al stock proyectado web (435).
--
-- Referencia: Engram #1221 / Baseline verificado 2026-10-20 (target tuzpcofywkhglkqplhnn)
-- ============================================================================

WITH
-- 1. Ubicaciones que califican para el stock web
web_locations AS (
  SELECT
    l.id,
    l.organization_id,
    l.name,
    l.code
  FROM erp.locations l
  WHERE l.is_active = true
    AND l.contributes_to_web_stock = true
),

-- 2. Conteos brutos de entidades principales
baseline_counts AS (
  SELECT
    (SELECT count(*)::integer FROM public.products) AS public_products_count,
    (SELECT count(*)::integer FROM public.product_variants) AS public_variants_count,
    (SELECT count(*)::integer FROM erp.products) AS erp_products_count,
    (SELECT count(*)::integer FROM erp.product_variants) AS erp_variants_count,
    (SELECT coalesce(sum(quantity_on_hand), 0)::numeric(18, 4) FROM erp.stock_balances) AS erp_total_on_hand,
    (SELECT coalesce(sum(quantity_reserved), 0)::numeric(18, 4) FROM erp.stock_balances) AS erp_total_reserved
),

-- 3. Conciliación de mapeo por UUID compartido
shared_uuids AS (
  SELECT
    (SELECT count(*)::integer FROM public.products pp JOIN erp.products ep ON ep.id = pp.id) AS shared_products_count,
    (SELECT count(*)::integer FROM public.products pp WHERE NOT EXISTS (SELECT 1 FROM erp.products ep WHERE ep.id = pp.id)) AS unmapped_public_products_count,
    (SELECT count(*)::integer FROM erp.products ep WHERE NOT EXISTS (SELECT 1 FROM public.products pp WHERE pp.id = ep.id)) AS erp_only_products_count,
    (SELECT count(*)::integer FROM public.product_variants pv JOIN erp.product_variants ev ON ev.id = pv.id) AS shared_variants_count,
    (SELECT count(*)::integer FROM public.product_variants pv WHERE NOT EXISTS (SELECT 1 FROM erp.product_variants ev WHERE ev.id = pv.id)) AS unmapped_public_variants_count,
    (SELECT count(*)::integer FROM erp.product_variants ev WHERE NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.id = ev.id)) AS erp_only_variants_count
),

-- 4. Paridad de precios, impuestos y promociones
price_and_tax AS (
  SELECT
    (SELECT count(*)::integer
     FROM public.products pp
     JOIN erp.products ep ON ep.id = pp.id
     WHERE pp.price <> ep.base_sale_price) AS shared_products_price_diff_count,
    (SELECT count(*)::integer FROM erp.price_entries) AS erp_price_entries_count,
    (SELECT count(*)::integer FROM public.products WHERE price_usd IS NOT NULL) AS legacy_usd_products_count,
    (SELECT coalesce(
       json_agg(
         json_build_object(
           'product_id', p.id,
           'price_ars', p.price,
           'price_usd', p.price_usd,
           'implied_exchange_rate', round(p.price / p.price_usd, 4)
         )
       ), '[]'::json)
     FROM public.products p
     WHERE p.price_usd IS NOT NULL) AS legacy_usd_samples,
    (SELECT count(*)::integer FROM public.products WHERE original_price IS NOT NULL) AS active_promos_count,
    (SELECT count(*)::integer
     FROM public.products pp
     JOIN erp.products ep ON ep.id = pp.id
     WHERE ep.tax_rate_percent = 21) AS shared_tax_21_count,
    (SELECT count(*)::integer
     FROM public.products pp
     JOIN erp.products ep ON ep.id = pp.id
     WHERE ep.tax_rate_percent <> 21) AS shared_tax_non_21_count
),

-- 5. Cálculo fila a fila de proyección de stock para productos padre
parent_stock_calc AS (
  SELECT
    pp.id AS product_id,
    pp.name AS product_name,
    pp.stock AS public_stock,
    coalesce(sum(b.quantity_on_hand - b.quantity_reserved), 0)::integer AS projected_stock
  FROM public.products pp
  JOIN erp.products ep ON ep.id = pp.id
  LEFT JOIN erp.stock_balances b
    ON b.organization_id = ep.organization_id
   AND b.product_id = ep.id
   AND b.location_id IN (SELECT id FROM web_locations WHERE organization_id = ep.organization_id)
  GROUP BY pp.id, pp.name, pp.stock
),

-- 6. Cálculo fila a fila de proyección de stock para variantes
variant_stock_calc AS (
  SELECT
    pv.id AS variant_id,
    pv.product_id AS parent_product_id,
    pv.color AS variant_color,
    pv.stock AS public_stock,
    coalesce(sum(b.quantity_on_hand - b.quantity_reserved), 0)::integer AS projected_stock
  FROM public.product_variants pv
  JOIN erp.product_variants ev ON ev.id = pv.id
  LEFT JOIN erp.stock_balances b
    ON b.organization_id = ev.organization_id
   AND b.product_id = ev.product_id
   AND b.variant_id = ev.id
   AND b.location_id IN (SELECT id FROM web_locations WHERE organization_id = ev.organization_id)
  GROUP BY pv.id, pv.product_id, pv.color, pv.stock
),

-- 7. Consolidación de proyección y detección de discrepancias por fila
stock_projection AS (
  SELECT
    (SELECT count(*)::integer FROM web_locations) AS web_qualifying_locations_count,
    (SELECT coalesce(sum(projected_stock), 0)::integer FROM parent_stock_calc) AS total_projected_parent_units,
    (SELECT coalesce(sum(public_stock), 0)::integer FROM parent_stock_calc) AS total_public_parent_units,
    (SELECT count(*)::integer FROM parent_stock_calc WHERE public_stock <> projected_stock) AS parent_stock_mismatches_count,
    (SELECT coalesce(
       json_agg(
         json_build_object(
           'type', 'parent_product',
           'product_id', product_id,
           'public_stock', public_stock,
           'projected_stock', projected_stock,
           'discrepancy', public_stock - projected_stock
         )
       ), '[]'::json)
     FROM parent_stock_calc
     WHERE public_stock <> projected_stock) AS parent_discrepancy_rows,
    (SELECT coalesce(sum(projected_stock), 0)::integer FROM variant_stock_calc) AS total_projected_variant_units,
    (SELECT coalesce(sum(public_stock), 0)::integer FROM variant_stock_calc) AS total_public_variant_units,
    (SELECT count(*)::integer FROM variant_stock_calc WHERE public_stock <> projected_stock) AS variant_stock_mismatches_count,
    (SELECT coalesce(
       json_agg(
         json_build_object(
           'type', 'variant',
           'variant_id', variant_id,
           'parent_product_id', parent_product_id,
           'public_stock', public_stock,
           'projected_stock', projected_stock,
           'discrepancy', public_stock - projected_stock
         )
       ), '[]'::json)
     FROM variant_stock_calc
     WHERE public_stock <> projected_stock) AS variant_discrepancy_rows
),

-- 8. Banderas de sincronización del puente y monedas operativas
sync_and_currencies AS (
  SELECT
    (SELECT count(*)::integer FROM erp.organizations WHERE is_active = true) AS active_organizations_count,
    (SELECT count(*)::integer FROM erp.storefront_catalog_sync) AS catalog_sync_orgs_count,
    (SELECT count(*)::integer FROM erp.storefront_stock_projection) AS stock_projection_orgs_count,
    (SELECT count(*)::integer FROM erp.storefront_stock_capture) AS stock_capture_orgs_count,
    (SELECT coalesce(
       json_agg(
         json_build_object(
           'currency_code', currency_code,
           'is_base', is_base,
           'is_active', is_active
         )
       ), '[]'::json)
     FROM erp.organization_currencies) AS currencies,
    (SELECT version
     FROM supabase_migrations.schema_migrations
     ORDER BY version DESC
     LIMIT 1) AS latest_migration
),

-- 9. Verificación de integridad de esquema y metadatos
schema_metadata AS (
  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'erp' AND table_name = 'products' AND column_name = 'attributes'
    ) AS erp_products_has_attributes_column,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'erp' AND table_name = 'price_entries' AND column_name = 'kind'
    ) AS erp_price_entries_has_kind_column,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'erp' AND table_name = 'price_entries' AND column_name = 'valid_until'
    ) AS erp_price_entries_has_valid_until_column,
    (SELECT count(*)::integer FROM erp.product_variants WHERE price_delta <> 0) AS erp_variants_with_nonzero_price_delta,
    (SELECT count(*)::integer FROM public.products WHERE tags IS NOT NULL AND cardinality(tags) > 0) AS public_products_with_tags,
    (SELECT count(*)::integer FROM public.products WHERE additional_images IS NOT NULL AND cardinality(additional_images) > 0) AS public_products_with_gallery,
    (SELECT count(*)::integer FROM public.products WHERE brand_id IS NOT NULL OR model_id IS NOT NULL) AS public_products_with_brand_or_model
)

-- Reporte JSON consolidado
SELECT json_build_object(
  'generated_at', now(),
  'target_environment', 'production/remote qatkzvlomuaoaxlfgjfa',
  'baseline_counts', (SELECT row_to_json(baseline_counts) FROM baseline_counts),
  'shared_uuids', (SELECT row_to_json(shared_uuids) FROM shared_uuids),
  'price_and_tax', (SELECT row_to_json(price_and_tax) FROM price_and_tax),
  'stock_projection', (
    SELECT json_build_object(
      'web_qualifying_locations_count', sp.web_qualifying_locations_count,
      'total_projected_parent_units', sp.total_projected_parent_units,
      'total_public_parent_units', sp.total_public_parent_units,
      'parent_stock_mismatches_count', sp.parent_stock_mismatches_count,
      'parent_discrepancy_rows', sp.parent_discrepancy_rows,
      'total_projected_variant_units', sp.total_projected_variant_units,
      'total_public_variant_units', sp.total_public_variant_units,
      'variant_stock_mismatches_count', sp.variant_stock_mismatches_count,
      'variant_discrepancy_rows', sp.variant_discrepancy_rows,
      'inventory_accounting_rule', 'NUNCA sumar unidades padre + variantes (doble conteo). El saldo global ERP (499) incluye depósitos fuera de la web y no es directamente comparable a las 435 unidades proyectadas web.'
    )
    FROM stock_projection sp
  ),
  'sync_and_currencies', (SELECT row_to_json(sync_and_currencies) FROM sync_and_currencies),
  'schema_metadata_verification', (SELECT row_to_json(schema_metadata) FROM schema_metadata)
) AS baseline_report;
