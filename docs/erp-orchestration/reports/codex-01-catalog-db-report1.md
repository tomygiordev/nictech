## Estado: parcial — no listo para aplicar

No completé el Brief 01. Quedaron preparadas partes del precio, el borrador y las columnas básicas, pero faltan los contratos de ficha, medios, publicación y proyección de los que dependen las tareas 02–04. **No recomiendo aplicar estas migraciones ni avanzar con esas tareas como si el contrato estuviera cerrado.**

No me conecté a producción ni ejecuté migraciones o scripts de datos.

## 1. Archivos tocados

**Nuevos**

- `supabase/migrations/20261114100000_erp_catalog_draft_and_price.sql` — prepara el cálculo sin `price_delta` y la creación en borrador.
- `supabase/migrations/20261114100100_erp_catalog_sheet_columns.sql` — agrega columnas básicas de ficha y `web_status` derivado.
- `supabase/tests/database/erp_catalog_sheet_media_publish.test.sql` — diez aserciones pgTAP parciales, escritas pero no ejecutadas.

**Modificados**

- `apps/erp/src/lib/supabase.ts` — overlay de las columnas agregadas y ajuste del retorno tipado del resolver.
- `supabase/tests/database/erp_catalog_variant_final_price.test.sql` — expectativas ajustadas para que el precio heredado ignore `price_delta`.
- `supabase/tests/database/erp_pos_authoritative_gross_pricing.test.sql` — expectativas equivalentes para el resolver usado por POS.

## 2. Hecho

| Objetivo | Estado |
|---|---|
| 1. Resolver sin `price_delta` | **Parcial:** escrito y revisado estáticamente, no ejecutado. También ajusté los cálculos paralelos de `create_sale_with_invoice`, `get_catalog_product_variants` y las respuestas de creación/edición de variantes para evitar discrepancias con POS. |
| 2. Columnas de ficha | **Parcial:** escritas `tags`, `condition`, `capacity`, `sheet_template` y comentarios sobre modelos. Falta validación por plantilla en el RPC y la proyección al storefront. |
| 3. Estado de publicación | **Parcial:** `web_status` generado a partir de las banderas; faltan los RPC que las mantengan consistentes. |
| 4–6. Medios, colores y guardado atómico | **No hecho:** faltan tablas, seguridad, auditoría y RPC de ficha. |
| 7. Borrador por defecto | **Parcial:** ajustado el RPC existente; falta el nuevo RPC de ficha y verificarlo ejecutando SQL. |
| 8. Publicación y checklist | **No hecho**, incluida la validación de precios web con máximo dos decimales. |
| 9. Códigos | **No hecho:** faltan contadores, prefijos y recodificación explícita. Ya existe `erp.product_identifiers` para códigos de barras de variantes; no creé otra tabla. |
| 10. Proyección web | **No hecho:** el puente no sincroniza los campos nuevos. |
| 11. Filtro de inactivos | **No hecho.** |
| 12. Scripts de datos | **No hechos.** No se ejecutó ningún script. |
| 13. Overlay de tipos | **Parcial:** cubre las columnas escritas y el resolver, no los contratos aún inexistentes. |
| 14. Tests pgTAP | **Parcial:** diez aserciones nuevas y dos pruebas existentes ajustadas; falta la cobertura de medios, publicación, atomicidad, permisos y recodificación. Ninguna se ejecutó. |

## 3. Verificación

| Comando o control | Resultado | Comparación |
|---|---|---|
| `npm run build` | OK; warning de chunk | Igual al baseline |
| `npm run typecheck:erp` | OK, 0 errores | Igual |
| `npm run build:erp` | OK; warning de chunk | Igual |
| `npx vitest run` | 35 archivos OK / 1 falla; 322 tests OK | Mejor que el baseline observado: solo falló `scripts/release-erp.test.mjs`, por ser `node:test` |
| `npx vitest run apps/erp/src/lib/supabase.test.ts` | 1 archivo, 2 tests OK | Sin fallas |
| `npx tsc --noEmit -p tsconfig.app.json` | 132 errores | Igual al baseline |
| `npm run lint` | 9 errores y 24 warnings | Igual al baseline |
| ESLint del archivo ERP modificado | OK | Sin errores nuevos en ese archivo |
| `npm run test:erp:desktop` | 10 tests OK | Igual |
| Tests SQL | **No ejecutados** | Puertos locales 55421 y 55422 cerrados; no inicié Docker |
| `deno check` | No ejecutado | No se tocaron Edge Functions |
| Revisión SQL con `pglast` | Sintaxis SQL externa aceptada | No valida la ejecución de los cuerpos PL/pgSQL |

Comparé las cinco funciones redefinidas contra sus últimas definiciones del repositorio. Las firmas se conservaron; `CREATE OR REPLACE FUNCTION` preserva los permisos existentes, según la [documentación de PostgreSQL](https://www.postgresql.org/docs/current/sql-createfunction.html).

## 4. No verificado

Falta ejecutar las migraciones y pruebas SQL en un **entorno aislado de producción**, incluyendo RLS, triggers del puente, creación en borrador y confirmación POS con variantes de `price_delta` cero y no cero. La revisión sintáctica no sustituye esas pruebas.

## 5. Riesgos y pendientes

- El cambio de precio afecta una ruta financiera del POS y requiere pruebas transaccionales antes de cualquier aplicación.
- Las columnas nuevas **no están sincronizadas con la web**; el puente bidireccional sigue siendo el anterior.
- Falta implementar y revisar la mayor parte del brief, incluidos los scripts dry-run y el checklist de publicación.
- No hay pasos de despliegue preparados ni ejecutados. El siguiente paso es **terminar la implementación**, no aplicar lo escrito en producción.

## 6. Contratos escritos hasta ahora

- `erp.resolve_catalog_effective_price(p_product_id uuid, p_variant_id uuid default null) → jsonb`: conserva la firma; la migración preparada selecciona `final_price_ars` de variante o `base_sale_price` del producto. Los valores previstos de `price_source` son `variant_override`, `parent_inherited` y `parent_base`.
- `erp.products.tags text[]`, `condition text`, `capacity text`, `sheet_template text` y `web_status text` generado. Los valores previstos de `web_status` son `draft`, `published` y `paused`.
- `erp.create_catalog_product_with_variants(...) → jsonb`: conserva su firma; la migración preparada cambia las banderas iniciales a borrador.

**Todavía no existen** `save_catalog_product_sheet`, los RPC de publicar/pausar ni el checklist; por eso no hay payload JSON ni códigos de error que entregar de forma responsable.

## Key Learnings:

1. El resolver no era la única ruta de precio: POS y los RPC de variantes también sumaban `price_delta`.
2. El puente actual no proyecta los campos nuevos de ficha; agregar columnas por sí solo no completa el contrato ERP–tienda.