## 1. Archivos tocados

**Migraciones de esta tarea**

- `20261114100200_erp_catalog_media_codes.sql` — grants de lectura, prefijos con acentos y marca Genérico para organizaciones nuevas.
- `20261114100500_erp_catalog_save_sheet.sql` — alias, validaciones legacy, normalización de condición y tags, códigos de variante y detalle de concurrencia.
- `20261114100600_erp_catalog_sheet_bridge.sql` — compatibilidad con columnas legacy ausentes, preservación de condiciones no estándar y trigger para activación tardía.
- `20261114100700_erp_catalog_colors_active_views.sql` — vista activa con columnas explícitas no sensibles.
- `20261114100900_erp_catalog_active_getter.sql` — conserva el precio del padre inactivo.

**Scripts**

- `scripts/erp-stage1-backfill-catalog-sheet.sql` — reporte de cambios y condiciones no estándar, más decisiones explícitas.
- `scripts/erp-stage1-catalog-cleanup.sql` — reporte de precios, actor para apply y candidatos más acotados.

**Tests SQL**

- Nuevos: `erp_catalog_no_storefront.test.sql` y `erp_catalog_audit_bridge_regressions.test.sql`.
- Ajustados: `erp_catalog_sheet_media_publish.test.sql`, `erp_storefront_bridge.test.sql`, `erp_storefront_catalog_import.test.sql`, `erp_storefront_catalog_batches.test.sql`, `erp_storefront_stock_projection.test.sql`, `erp_phase_b_case_variants.test.sql` y `erp_pos_internal_invoice_issuance.test.sql`.

No edité el overlay compartido, `supabase/seed.sql`, migraciones de reparaciones ni migraciones anteriores.

## 2. Estado de los hallazgos

| ID | Estado |
|---|---|
| **B1** | **Resuelto:** alias de la consulta final renombrado. |
| **B2** | **Resuelto en DB:** grants por columna y vista explícita sin los tres campos sensibles. **Tipo del overlay pendiente** abajo. |
| **B3** | **Resuelto:** el test prueba el trigger como dueño y vuelve al rol `authenticated`. |
| **I1** | **Resuelto:** lectura defensiva de campos opcionales y fixtures actualizados. También se instala el trigger correcto si el puente se activa después de crear `public.products`. |
| **I2** | **Resuelto:** la lectura legacy es dinámica y está protegida por `to_regclass`. |
| **I3** | **Resuelto:** se conserva el valor web no estándar; el backfill lo excluye salvo decisión explícita. |
| **I4** | **Resuelto:** el getter conserva el precio del padre inactivo. El modal que permite reactivar debe pedir `p_include_inactive: true`. |
| **I5** | **Resuelto:** marca y categoría se validan en altas o cuando se modifican expresamente. |
| **I6** | **Resuelto según el fix solicitado:** el cleanup reporta precios publicados con más de dos decimales. Deben corregirse antes de aplicar la guarda. |
| **M1** | **Resuelto:** transliteración antes de `upper`, probada bajo locale `C`. |
| **M2** | **Resuelto con alternativa:** no edité el seed prohibido; un trigger crea Genérico con código determinístico al crear una organización. Con el puente activo puede proyectarse a la tienda. |
| **M3** | **Resuelto:** revocados los permisos públicos de ejecución del trigger de medios. |
| **M4** | **Resuelto:** condición normalizada y error `22023` claro para valores inválidos. |
| **M5** | **Resuelto:** tags deduplicados conservando la primera aparición y su orden. |
| **M6** | **Resuelto:** comparación insensible a mayúsculas para códigos legacy; probado con una variante `WEB-…`. |
| **M7** | **Resuelto:** conflicto distinguible mediante `detail = 'concurrency_conflict'`. El cliente debe enviar el timestamp exacto de la DB, sin truncarlo mediante `Date`. |
| **M8** | **Resuelto en el archivo:** apply requiere actor con `catalog.manage`; candidatos acotados por categoría, marca y nombre. |
| **M9** | **Resuelto en el archivo:** conteos y listado de medios a crear. |
| **M10** | **Pendiente del otro agente:** cambios exactos del overlay al final. No edité ese archivo. |

## 3. Verificación real

Se construyó una base local con las **99 migraciones previas y el seed**, y se clonó para ejecutar las diez migraciones corregidas en bases limpias y simulaciones tipo producción, con y sin puente. Las diez aplicaron en las cuatro bases. La comparación antes/después de `public.products` y `public.product_variants` dio **0 diferencias** en ambas simulaciones.

**Salvedad del seed:** el trabajo paralelo agregó una llamada a una función de reparaciones ausente de esas 99 migraciones. Para ejecutar el seed íntegro se usó una función no-op temporal en el clúster aislado y luego se quitó. Esto **no valida reparaciones**.

### PostgreSQL local

| Pruebas | Resultado |
|---|---:|
| Ficha/media/publicación, limpia y producción simulada | 50/50 en cada base |
| Storefront bridge | 27/27 |
| Bridge sin columnas opcionales legacy | 24/24 |
| Catálogo sin `public.products` | 6/6 |
| Regresiones de puente y condición legacy | 11/11 |
| Importación, batches y proyección de stock | 19/19, 3/3 y 14/14 |
| Variantes fase B y factura POS | 14/14 y 29/29 |
| Compatibilidad de catálogo, precio final y POS autoritativo | 3 suites DO **PASS** en cada una de dos bases |

Total: **247 aserciones tipo pgTAP, 0 fallas**, más seis ejecuciones DO exitosas. Se utilizó el **shim parcial de pgTAP** del auditor, ampliado localmente para las comprobaciones de funciones y columnas; no es la extensión completa. Las suites DO informaron ramas omitidas por falta de perfiles con determinados permisos o de un actor en una organización sin puente.

### Verificación de aplicación

| Comando | Resultado |
|---|---|
| `npm run typecheck:erp` | OK |
| `npm run build:erp` | OK; warning de chunk |
| `npm run build` | OK; warning de chunk |
| `npx vitest run` | 36 archivos OK, 1 falla conocida (`scripts/release-erp.test.mjs`); **324 tests OK** |

## 4. No verificado

No ejecuté los scripts de datos: siguen sujetos a la instrucción anterior de dejarlos como archivos. Falta probarlos —primero en dry-run— cuando se autorice expresamente, y repetir las ramas DO omitidas con fixtures de permisos adecuados. También conviene correr la suite con pgTAP completo en un entorno aislado.

El clúster quedó **detenido y el puerto 56432 cerrado**. Se solicitó parada `fast` y, ante un checkpoint prolongado del clúster descartable, se completó con `immediate`; necesitará recuperación al volver a iniciarse.

## 5. Riesgos y pendientes

- No hubo conexión remota, despliegue ni commit. La validación local no autoriza aplicar a producción.
- Corregir los precios que informe el cleanup antes de aplicar la guarda de dos decimales.
- La marca **Genérico** puede aparecer en la tienda al proyectarse con el puente activo.
- El admin legacy todavía puede republicar sin pasar por el checklist; el auditor lo identificó como brecha pendiente del corte.
- `publish_catalog_product` también establece `can_sell = true`; queda pendiente confirmar ese efecto de negocio.

## 6. Cambios de overlay pendientes

Diff propuesto para `apps/erp/src/lib/supabase.ts`, sin aplicarlo sobre el archivo que edita el otro agente:

```diff
- active_catalog_products: { Row: ErpDatabase["erp"]["Tables"]["products"]["Row"]; Relationships: [] };
+ active_catalog_products: {
+   Row: Omit<
+     ErpDatabase["erp"]["Tables"]["products"]["Row"],
+     "base_cost" | "purchase_currency" | "target_margin_percent"
+   >;
+   Relationships: [];
+ };

- "record_repair_payment" | "intake_trade_in_direct" | "record_trade_in_refurbishment"
+ "record_repair_payment" | "intake_trade_in_direct" | "record_trade_in_refurbishment"
+ | "create_catalog_product_with_variants"
     > & {
+      create_catalog_product_with_variants: Omit<
+        ErpFunctions["create_catalog_product_with_variants"],
+        "Args"
+      > & {
+        Args: Omit<
+          ErpFunctions["create_catalog_product_with_variants"]["Args"],
+          "p_internal_code"
+        > & { p_internal_code: string | null };
+      };

- unpublish_catalog_product: { Args: { p_product_id: string }; Returns: { product_id: string; web_status: "paused" } };
+ unpublish_catalog_product: { Args: { p_product_id: string }; Returns: { product_id: string; web_status: "paused" | "draft" } };
```

Además, documentar junto al tipo que la UI debe usar `web_status`, no interpretar `publish_on_web = true` como visible; que el modal de variantes debe pedir `p_include_inactive: true`; y que `p_expected_updated_at` debe conservar el string exacto devuelto por PostgreSQL.

## Key Learnings:

1. El parseo estático no detectó el alias ambiguo ni los grants por columna; las pruebas reales locales fueron necesarias.
2. El puente debe cubrir tanto la ausencia de columnas legacy como la activación posterior a la migración.
3. Las condiciones legacy no reconocidas requieren preservar la proyección web hasta una decisión explícita.