## Estado: implementación escrita; validación SQL pendiente

Continué el Brief 01 y dejé escritos los contratos, migraciones, scripts y pruebas solicitados. **No apliqué las migraciones, no ejecuté los scripts ni me conecté a ninguna base remota.** La implementación todavía necesita ejecutarse y probarse en un entorno aislado antes de considerarla apta para producción.

## 1. Archivos tocados

### Nuevos

- `supabase/migrations/20261114100000_erp_catalog_draft_and_price.sql` — precio sin `price_delta`, ajuste de POS y alta en borrador.
- `supabase/migrations/20261114100100_erp_catalog_sheet_columns.sql` — columnas de ficha, plantilla y estado web derivado.
- `supabase/migrations/20261114100200_erp_catalog_media_codes.sql` — medios, colores, RLS, auditoría, contadores y recodificación.
- `supabase/migrations/20261114100300_erp_catalog_publication.sql` — checklist, publicación y pausa.
- `supabase/migrations/20261114100400_erp_catalog_compatibility_history.sql` — conserva asociaciones de modelos omitidas como inactivas.
- `supabase/migrations/20261114100500_erp_catalog_save_sheet.sql` — guardado atómico de ficha, variantes, compatibilidades y medios.
- `supabase/migrations/20261114100600_erp_catalog_sheet_bridge.sql` — proyección bidireccional de los campos de ficha y fotos.
- `supabase/migrations/20261114100700_erp_catalog_colors_active_views.sql` — RPC de colores y vistas de catálogo y stock activos.
- `supabase/migrations/20261114100800_erp_catalog_published_price_guard.sql` — guardas de precio para productos publicados.
- `supabase/migrations/20261114100900_erp_catalog_active_getter.sql` — getter de variantes activas por defecto, con opción de incluir inactivas.
- `scripts/erp-stage1-backfill-catalog-sheet.sql` — reporte y backfill con rollback por defecto.
- `scripts/erp-stage1-catalog-cleanup.sql` — reporte de candidatos y decisiones explícitas, con rollback por defecto.
- `supabase/tests/database/erp_catalog_sheet_media_publish.test.sql` — 45 aserciones pgTAP escritas, no ejecutadas.

### Modificados

- `apps/erp/src/lib/supabase.ts` — overlay de columnas, tablas, vistas, payload y RPC.
- `supabase/tests/database/erp_catalog_variant_final_price.test.sql` — expectativas ajustadas para ignorar el delta.
- `supabase/tests/database/erp_pos_authoritative_gross_pricing.test.sql` — expectativas de POS ajustadas a la misma regla.
- `supabase/tests/database/erp_catalog_compatibility_and_variants.test.sql` — comprueba que las compatibilidades retiradas queden inactivas, no borradas.

## 2. Hecho

«Completo» en esta tabla significa **implementado y revisado estáticamente**, no ejecutado en PostgreSQL.

| Punto | Estado |
|---|---|
| Resolver sin `price_delta` | **Completo.** Ajusté también los cálculos paralelos de POS y de respuestas de variantes. |
| Columnas y plantilla | **Completo.** `tags`, `condition`, `capacity`, `sheet_template` y documentación de `model_id`/compatibilidades. |
| Estado web | **Completo.** `web_status` derivado y RPC de publicación y pausa. |
| Medios | **Completo.** Organización, variante opcional, orden, principal, RLS y auditoría. |
| Colores | **Completo.** Catálogo, RPC y referencia desde variantes. |
| Guardado atómico | **Completo.** Validaciones por plantilla, marca, costo en altas, concurrencia y guardado transaccional. |
| Borrador por defecto | **Completo.** Ambos caminos de alta preparados para crear sin publicación web. |
| Checklist y precisión | **Completo.** Publicación con faltantes y guardas para precios publicados de hasta dos decimales. |
| Códigos | **Completo.** Prefijos, contador por organización y recodificación explícita; se reutilizan identificadores de variantes para código de barras. |
| Proyección web | **Completo.** Incluye campos de ficha, fotos y variantes creadas durante el borrador. |
| Inactivos | **Completo en DB.** Hay vistas activas y getter filtrado. **La tarea 02 debe adoptar esos filtros:** las pantallas actuales consultan tablas directamente. |
| Scripts de datos | **Completo como archivos.** No se ejecutaron. El saneamiento no fusiona artículos ni mueve stock automáticamente. |
| Overlay | **Completo para los contratos agregados.** |
| pgTAP | **Escrito, no ejecutado.** Cubre los escenarios principales; la ejecución real sigue pendiente. |

## 3. Verificación

| Comando o control | Resultado | Comparación con baseline |
|---|---:|---|
| `npm run build` | OK; warning de chunk | Igual |
| `npm run typecheck:erp` | OK, 0 errores | Igual |
| `npm run build:erp` | OK; warning de chunk | Igual |
| `npx vitest run` | 35 archivos OK, 1 falla; 322 tests OK | Sin fallas nuevas; falla conocida de `scripts/release-erp.test.mjs` |
| `npx vitest run apps/erp/src/lib/supabase.test.ts` | 1 archivo, 2 tests OK | Sin fallas |
| `npx tsc --noEmit -p tsconfig.app.json` | 132 errores | Igual al baseline |
| `npm run lint` | 9 errores, 24 warnings | Igual al baseline |
| ESLint de `apps/erp/src/lib/supabase.ts` | OK | Sin errores nuevos |
| `npm run test:erp:desktop` | 10 tests OK | Igual |
| Tests SQL | **No ejecutados** | No se inició Docker ni se aplicaron migraciones |
| `deno check` | No ejecutado | No se tocaron Edge Functions |
| Análisis estático | SQL y cuerpos PL/pgSQL parseados; scripts sin `DELETE` ni `TRUNCATE` | No sustituye ejecución en DB |

Las 45 aserciones nuevas usan [pgTAP](https://pgtap.org/documentation.html); su resultado real sigue sin conocerse.

## 4. No verificado

Quedan por probar en una base aislada las migraciones completas, RLS y permisos, concurrencia del guardado y recodificación, triggers del puente en ambos sentidos, proyección de stock y variantes, y conciliación de datos. El análisis sintáctico no puede verificar esos efectos.

## 5. Riesgos y pendientes para el usuario

- **No aplicar todavía en producción:** primero hay que ejecutar migraciones y pgTAP en un entorno aislado y revisar la conciliación del puente.
- `product_media.storage_path` se interpreta como una **URL pública utilizable** de una imagen ya subida a `product_images`. El RPC registra la URL; no comprueba que el objeto exista.
- El checklist se exige al usar `publish_catalog_product`. Las escrituras legacy o directas de banderas no quedan reemplazadas por ese RPC; la tarea 02 debe publicar mediante el contrato nuevo.
- Los scripts requieren revisión humana. Ambos usan rollback por defecto; el modo apply es explícito. Las uniones de productos y pases de stock no están automatizados.
- Las consultas directas actuales de catálogo y stock deben cambiarse en la tarea 02 para excluir inactivos por defecto.

## 6. Contratos expuestos

### RPC principales

```sql
erp.save_catalog_product_sheet(payload jsonb, p_expected_updated_at timestamptz default null) → jsonb
erp.get_catalog_publish_checklist(p_product_id uuid) → jsonb
erp.publish_catalog_product(p_product_id uuid) → jsonb
erp.unpublish_catalog_product(p_product_id uuid) → jsonb
erp.recode_catalog_product(p_product_id uuid, p_new_code text) → jsonb
erp.save_catalog_color(p_name text, p_hex text default null,
                       p_color_id uuid default null, p_is_active boolean default true) → jsonb
erp.get_catalog_product_variants(p_product_id uuid, p_include_inactive boolean) → jsonb
```

La firma anterior de `get_catalog_product_variants(uuid)` permanece y excluye inactivas. El guardado devuelve `{ product, variants, media }`. Si se incluye `media`, el arreglo representa la colección activa completa de medios de la ficha.

Ejemplo de alta:

```json
{
  "internal_name": "Cable USB-C",
  "category_id": "UUID-CATEGORIA",
  "brand_id": "UUID-MARCA",
  "sheet_template": "accesorio",
  "base_cost": 1500,
  "base_sale_price": 2500,
  "tags": ["USB-C"],
  "variants": [
    {
      "code": "NEGRO",
      "name": "Negro",
      "color_id": "UUID-COLOR",
      "barcode": "7790000000000",
      "final_price_mode": "inherit"
    }
  ],
  "media": [
    {
      "storage_path": "https://ejemplo/storage/v1/object/public/product_images/cable.jpg",
      "sort_order": 0,
      "is_primary": true
    }
  ]
}
```

El checklist devuelve `{ product_id, ready, missing }`. Los códigos de `missing` son:

`missing_primary_image`, `invalid_base_price`, `base_price_precision`, `missing_category`, `missing_name`, `missing_brand`, `inactive_product`, `no_active_variant`, `invalid_variant_price` y `variant_price_precision`.

### Datos y vistas

- `erp.products`: `tags`, `condition`, `capacity`, `sheet_template`, `web_status` y marcadores de inicialización de la proyección.
- `erp.product_variants.color_id`; tablas `erp.colors` y `erp.product_media`.
- `erp.product_categories.code_prefix` y `erp.catalog_code_counters`.
- `erp.active_catalog_products`, `erp.active_catalog_variants` y `erp.active_stock_balances`.

## Key Learnings:

1. El precio de variante también se calculaba fuera del resolver, incluida la confirmación POS; esas rutas deben mantenerse alineadas.
2. Las variantes creadas mientras el producto es borrador necesitan proyectarse cuando se publica el padre.
3. Los campos web existentes necesitan preservarse hasta el backfill; agregar columnas ERP vacías y proyectarlas inmediatamente podría sobrescribirlos.