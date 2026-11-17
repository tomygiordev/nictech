# Brief 01 — Catálogo ERP: base de datos (Etapa 0B + Etapa 1, capa DB/RPC)

**Sos un agente Codex trabajando en `A:\nictech`. No hay otra conversación: este archivo es todo tu contexto.**
Orden en la orquestación: primera tarea. Nadie más trabaja en paralelo con vos. Las tareas 02 (pantallas del catálogo), 03 (reparaciones) y 04 (precio único) dependen de los contratos que dejes acá.

## 1. Qué cubre del plan

`docs/erp-admin-unification-plan.md`:
- §2 quater, ajustes **B, C, D, E, F, G** (parte de base) de la **Etapa 0B**.
- **Etapa 1 — Ficha completa y borrador por defecto**, filas "Dónde vive cada dato", "Migraciones / RPC", "Códigos", "Datos" y "Saneamiento" (solo el script con dry-run). Las pantallas las hace la tarea 02.
- Regla D4 del §5: precios publicados en la web con máximo 2 decimales.

Estado verificado hoy en el código: nada de esto existe (no hay `product_media`, `save_catalog_product_sheet`, `publish_catalog_product`, columnas `tags/condition/capacity` en `erp.products`, ni catálogo de colores). El resolver vigente es `erp.resolve_catalog_effective_price` (última definición en `supabase/migrations/20261021220540_erp_pos_authoritative_gross_pricing_and_v2_contract.sql`; antes `20261021014019_...canonical_resolver.sql`). `erp.create_catalog_product_with_variants` (última def. en `20261021014019`) inserta con `publish_on_web = true`. El puente web↔ERP está en `20260923050000`…`20260923050006` (sincronización `erp.sync_*_to_storefront` / `erp.sync_storefront_*_to_erp`, proyección de stock, captura legacy). `products_prevent_code_reassignment` está en `202608190002_erp_master_data.sql`.

## 2. Objetivo

Crear una o más migraciones con prefijo **`2026111410`** (p. ej. `20261114100000_erp_catalog_sheet_and_media.sql`, `20261114100100_...`) más tests pgTAP, y los scripts de datos, que dejen:

1. **D — Resolver sin `price_delta`**: `erp.resolve_catalog_effective_price` usa una sola regla: `final_price_ars` de la variante si no es null, si no `base_sale_price` del producto. `price_delta` deja de participar en el cálculo (la columna queda, marcada obsoleta con `comment on column`). Debe devolver el mismo precio que hoy para todo producto cuyo `price_delta` sea 0 (en producción todas lo son). Partí del cuerpo más reciente y mantené firma, permisos y forma de retorno (lo usa el POS).
2. **Columnas de ficha en `erp.products`**: `tags text[] not null default '{}'`, `condition` (enum o check: `nuevo` / `usado` / `reacondicionado`, nullable), `capacity text` nullable. Reglas por tipo (ajuste F): documentá en `comment on column` que `model_id` = "es este modelo" (celulares) y `erp.product_compatible_models` = "sirve para" (accesorios); si es viable, validalo en el RPC de guardado según una plantilla de producto (ver punto 5).
3. **Estado único de publicación (B)**: función/columna derivada que exponga `web_status` = `draft` | `published` | `paused` a partir de `is_active`, `publish_on_web`, `allow_online_sale`, `can_sell` (sin borrar banderas). Los RPC de publicar/pausar mantienen las banderas consistentes. Un producto inactivo es `paused`/oculto, nunca `published`.
4. **Tabla `erp.product_media`**: `id`, `organization_id`, `product_id`, `variant_id` nullable, `storage_path text`, `sort_order int`, `is_primary bool`, `alt_text` opcional, timestamps, actor. Restricciones: a lo sumo una principal por producto (y por variante), orden único por producto, FK compuestas por organización como el resto del ERP. RLS: lectura `catalog.view`, escritura solo vía RPC (`catalog.manage`). Auditoría como las demás tablas del catálogo. Las fotos viven en el bucket de Storage `product_images` que ya usa el admin; no crees buckets nuevos salvo que sea imprescindible (si lo hacés, solo en migración y documentado).
5. **Colores (E)**: tabla `erp.colors` (organización, nombre, hex opcional, activo) y referencia opcional desde `erp.product_variants` (p. ej. `color_id`), manteniendo `name`/`attributes.color` que hoy usa el puente. Plantilla por tipo: `product_kind` o `sheet_template` (`celular` | `accesorio` | `funda`) en `erp.products` con default razonable para los existentes (celular si tiene `model_id` y categoría de smartphones; si no, accesorio) — calculado en migración sin borrar nada.
6. **RPC `erp.save_catalog_product_sheet(payload jsonb, p_expected_updated_at timestamptz default null)`**: guardado atómico de ficha + variantes + medios (alta o edición) en una sola transacción, con control optimista por `updated_at`, permisos `catalog.manage`, validaciones de servidor (marca obligatoria —permití una marca "Genérico" que la migración crea si no existe—, costo obligatorio > 0 en altas nuevas, nombre con espacios normalizados, campos requeridos por plantilla), y devolviendo el producto con variantes y medios. Las fotos se suben a Storage antes de llamar; el RPC solo registra rutas: si el RPC falla no queda ficha a medias. Editar descripción/fotos no debe tocar stock ni regenerar el nombre. Reutilizá `erp.manage_product_variants` / `set_product_compatible_models` internamente si conviene, sin duplicar lógica.
7. **Borrador por defecto**: `erp.create_catalog_product_with_variants` y el nuevo RPC crean con `publish_on_web = false` y `allow_online_sale = false` (estado `draft`). Los productos ya publicados quedan como están.
8. **RPC `erp.publish_catalog_product(p_product_id uuid)`** y **`erp.unpublish_catalog_product`/pausa**: checklist en servidor — foto principal, precio efectivo > 0 **con máximo 2 decimales** (también para variantes con `final_price_ars`), categoría, nombre público (o interno si no hay público), marca, al menos una variante activa si tiene variantes. Si falla devuelve error claro con la lista de faltantes (y además una función `erp.get_catalog_publish_checklist(p_product_id)` de solo lectura que devuelva los faltantes sin publicar, para la UI).
9. **Códigos**: generación de código interno corto con prefijo por categoría (`CAB-0012`): tabla de contadores por organización y prefijo, prefijo por categoría (columna nueva en `erp.product_categories`, con default derivado del nombre), asignación automática en altas nuevas. Comando explícito `erp.recode_catalog_product(p_product_id, p_new_code)` con permiso y auditoría, compatible con `products_prevent_code_reassignment` (no lo desactives globalmente; agregá la vía explícita). Campo de código de barras pensado para lector reutilizando los identificadores de variante que ya existen (revisá `erp.product_variants` y tablas de identificadores antes de crear nada).
10. **Proyección a la web**: extender `erp.sync_erp_product_to_storefront` (y el sentido inverso mientras exista el puente bidireccional) para `tags`, `condition`, `capacity`, `image_url` (foto principal de `product_media`, con fallback a `web_image_path`) y `additional_images` (resto de fotos ordenadas). La web sigue leyendo las mismas columnas de `public.products`. Evitá loops de triggers (usá el mismo mecanismo de guardas que ya tiene el puente).
11. **Filtro de inactivos (G, parte de base)**: las vistas/RPC de listado y reportes de catálogo y stock del ERP que existan en migraciones deben aceptar un parámetro o tener variante que excluya productos/variantes inactivos por defecto. Si eso es solo de pantalla (consultas directas desde el front), dejalo anotado para la tarea 02 en el reporte. No borres ni desactives nada.
12. **Scripts de datos (no se ejecutan)**:
    - `scripts/erp-stage1-backfill-catalog-sheet.sql`: backfill `public.products → erp.products` de `tags` (41 productos), `condition` y `capacity` (8 smartphones), y de `image_url`/`additional_images` a `erp.product_media`, con los mismos UUID. Dry-run por defecto (reporta qué cambiaría y termina en `rollback`), modo apply explícito, idempotente.
    - `scripts/erp-stage1-catalog-cleanup.sql`: saneamiento con dry-run (ver plan §2 ter y Etapa 1 "Saneamiento"): listar candidatos a unir como colores del mismo artículo (solo listado para revisión humana, nunca unión automática por nombre), productos sin marca, nombres con espacios/mayúsculas a normalizar, códigos `WEB-…` a recodificar; el modo apply solo aplica lo que el usuario haya cargado explícitamente en una tabla temporal/CTE de decisiones al principio del script. Cualquier pase de stock debe hacerse con documentos formales de stock (`erp.post_stock_document`), nunca con `update` directo. Nada de `delete`.
13. **Overlay de tipos**: agregá en `apps/erp/src/lib/supabase.ts` (patrón `ErpDatabase` ya existente) las columnas, tablas y RPC nuevos, para que la tarea 02 los consuma tipados.
14. **Tests pgTAP** nuevos en `supabase/tests/database/erp_catalog_sheet_media_publish.test.sql` (y otros si hace falta) que cubran: resolver igual que antes con `price_delta = 0` e ignorando `price_delta ≠ 0`; alta en borrador no visible en web; publicar sin foto falla con mensaje; publicar con precio de 3 decimales falla; guardado atómico que falla no deja filas; editar descripción no toca stock ni nombre; proyección de tags/condition/capacity/imagenes; permisos (usuario sin `catalog.manage` no puede); recodificación explícita. Si algún test existente asume `publish_on_web = true` por defecto o `price_delta` en el resolver, ajustalo y explicá por qué.

## 3. Archivos

- **Permitidos**: `supabase/migrations/2026111410*.sql` (nuevos), `supabase/tests/database/*.test.sql` (nuevos y ajustes justificados de existentes), `scripts/erp-stage1-*.sql` (nuevos), `apps/erp/src/lib/supabase.ts`, `apps/erp/src/lib/supabase.test.ts`, `supabase/seed.sql` (solo para agregar datos de referencia nuevos coherentes con la migración, p. ej. marca "Genérico", colores base).
- **Prohibidos**: cualquier archivo de `src/` (tienda), pantallas de `apps/erp/src/features/**` (las hace la tarea 02), `supabase/functions/**`, migraciones existentes (no se editan migraciones ya aplicadas en producción: todo cambio va en migraciones nuevas), tipos generados, `packages/domain/**`.

## 4. Criterio de terminado

- Migraciones y tests escritos, revisados estáticamente contra las definiciones vigentes.
- `npm run typecheck:erp` y `npm run build:erp` OK; `npx vitest run` sin fallas nuevas respecto del baseline.
- Overlay de tipos completo; el reporte lista los contratos exactos (firmas, payload JSON de `save_catalog_product_sheet` con ejemplo, códigos de error del checklist).
- Scripts con dry-run por defecto, sin `delete`/`truncate`.

## 5. Riesgo

RIESGO: esquema de DB, resolver de precios usado por el POS y triggers del puente que proyectan a la tienda en vivo. Nada se aplica: queda todo para que el usuario lo pruebe fuera de producción y lo aplique él.

---

## A. Contexto del repo (común a todas las tareas)

- Repo: `A:\nictech` (Windows). Rama `dev/erp`. Monorepo npm workspaces: tienda web en `src/` (React 18 + Vite + TS + shadcn/ui + Supabase + TanStack Query), ERP en `apps/erp/` (React + Vite + Electron, módulos en `apps/erp/src/features/*`), dominio compartido en `packages/domain/`, base en `supabase/` (migraciones en `supabase/migrations/`, tests pgTAP en `supabase/tests/database/`, Edge Functions Deno en `supabase/functions/`).
- Leé antes de empezar: `CLAUDE.md` / `AGENTS.md` (convenciones), `docs/erp-admin-unification-plan.md` (el plan; secciones 0, 1, 2 bis, 2 ter, 2 quater y la etapa que te toca), `docs/erp-admin-unification-context.md` y, si tocás precios o catálogo, `docs/erp-catalog-input-contract.md` §4 y §6.
- Regla rectora del plan (§1): **el ERP escribe, la web lee**. Cada etapa tiene "construcción" (se hace ahora) y "corte" (lo decide el usuario después, módulo por módulo). **Esta tarea es solo construcción**: no ocultes ni bloquees pestañas del admin, no actives canarios ni bloqueos, no cambies lo que ve la tienda en producción salvo que el brief lo diga explícitamente y sea retrocompatible.
- El árbol de trabajo tiene MUCHOS cambios sin commitear que son trabajo real del usuario (ver `git status`): Admin.tsx, CartContext, Checkout, Tienda, Promos, Combos, ProductCard, ProductDetailModal, QuickSale/QuickRestock, Edge Functions de Mercado Pago, `supabase/config.toml`, tests SQL, y migraciones sin trackear `20260922233226`…`20260924000000`. Si tenés que editar uno de esos archivos, editá encima de su estado actual y preservá esos cambios.
- Otros agentes pueden estar trabajando en paralelo en este mismo checkout sobre OTROS archivos. Tocá solo los archivos de tu lista de permitidos. Si un build/test falla en un archivo que no es tuyo, volvé a correrlo una vez; si persiste, reportalo sin arreglarlo.
- Tipos generados: `src/integrations/supabase/types.ts` y `apps/erp/src/types/supabase.ts` son generados y **no se editan a mano**. No hay base local corriendo para regenerarlos. Patrón documentado del repo para objetos nuevos de DB: el overlay de tipos de `apps/erp/src/lib/supabase.ts` (tipo `ErpDatabase` que extiende `Database` con columnas/RPC nuevas). Para la tienda, si hace falta, creá un overlay equivalente en un archivo nuevo (p. ej. `src/integrations/supabase/types.extensions.ts`) y usalo donde se necesite, sin `any` ni `as any` nuevos.
- Migraciones nuevas: archivos locales en `supabase/migrations/` con el prefijo de timestamp que te asigna el brief, **aditivas** (no `drop table`/`drop column` de `public`, no `delete`/`truncate` de datos existentes), idempotentes al reconstruir una base vacía, con `organization_id` vía `erp.current_organization_id()` en código nuevo (nunca el UUID literal), RLS/permisos con `erp.has_permission(...)` como el resto del ERP, y su test pgTAP en `supabase/tests/database/`. Los inserts de datos de referencia (p. ej. estados nuevos) van con `on conflict do nothing` y por organización existente.
- Scripts de migración/saneamiento de datos: van en `scripts/` como SQL con modo **dry-run por defecto** (solo `select`/reporte dentro de una transacción que termina en `rollback`) y un modo apply explícito que el usuario corre a mano. Vos no los ejecutás contra ninguna base.

## B. Reglas de código (obligatorias)

1. Sin `any` (tampoco `as any` nuevos). TypeScript estricto. Tipos de Supabase (o el overlay).
2. Guard clauses / early returns.
3. Todo formulario con React Hook Form + Zod (schemas en `apps/erp/src/features/<feature>/schemas.ts` o `src/hooks/use-<feature>-form.ts`).
4. shadcn/ui y los componentes existentes primero; no inventes componentes paralelos. En el ERP reutilizá los patrones de los modales existentes.
5. DRY: buscá hooks, helpers y selectores existentes antes de escribir nuevos.
6. Textos de UI en español rioplatense, como el resto de la app.
7. No reformatees archivos que no son tuyos ni hagas cambios cosméticos fuera de alcance.

## C. Qué NO hacer (no negociable)

- **No** `git commit`, `git push`, `git reset`, `git checkout -- …`, `git restore`, `git stash`, `git clean`, ni crear ramas/worktrees. No revertir ni sobrescribir cambios ajenos.
- **No tocar ninguna base remota.** El proyecto Supabase `tuzpcofywkhglkqplhnn` ("NicTech") es **PRODUCCIÓN con la tienda en vivo** (aunque `AGENTS.md` lo describa como "desarrollo": eso está desactualizado; manda el plan §2 bis). Prohibido: `supabase link`, `supabase db push`, `supabase migration up --linked`, `supabase functions deploy`, `supabase db reset` (local o remoto), `seed`, conectarse con `psql` a cualquier host remoto, usar el MCP de Supabase, o correr scripts que escriban datos.
- `apps/erp/.env` y el `.env` raíz apuntan a producción: **no levantes** `npm run dev`, `dev:erp`, Electron ni ningún navegador que opere datos reales con esas credenciales. No leas ni imprimas secretos de `.env` (ni service role, ni tokens de Mercado Pago).
- **No Docker** (ni `docker info`, ni `npm run db:start`, ni compose). No despliegues nada.
- No borrar datos ni registros (ni de `public` ni de `erp`), aunque parezcan de prueba.
- No ocultar/bloquear pestañas del admin ni activar canarios/bloqueos por tu cuenta.
- No modificar la configuración de Codex, Engram, MCP, `.claude/`, `.agents/` ni `skills-lock.json`. Si tenés herramientas `mem_*` de Engram disponibles podés registrar el cierre; si no, seguí sin ellas.
- No crear documentación extra salvo la que pide el brief.

## D. Verificación obligatoria (comparar contra este baseline, medido el 2026-11-14 antes de cualquier cambio)

Corré desde `A:\nictech` y reportá los números reales:

| Comando | Baseline |
|---|---|
| `npm run build` (tienda) | OK (solo warning de chunk > 500 kB) |
| `npm run typecheck:erp` | OK, 0 errores |
| `npm run build:erp` | OK (warning de chunk) |
| `npx vitest run` | 36 archivos: 34 ok / 2 fallan; 322 tests: 321 ok / 1 falla. Fallas preexistentes: `scripts/release-erp.test.mjs` ("No test suite found", es un test de `node:test` que vitest levanta) y `apps/erp/src/App.test.tsx > switches workspace and displays respective header` (no encuentra "Catálogo Maestro de Productos") |
| `npx tsc --noEmit -p tsconfig.app.json` (tienda, no lo exige el build) | 132 errores preexistentes. Regla: no agregar errores nuevos en los archivos que toques |
| `npm run lint` | 9 errores, 24 warnings preexistentes. Regla: 0 errores nuevos en tus archivos |
| `deno check index.ts` dentro de `supabase/functions/create-mercadopago-preference` y de `supabase/functions/mercadopago-webhook` (solo si tocás Edge Functions) | OK. Sus `domain.test.ts` corren con vitest |
| `npm run test:erp:desktop` | 10 ok |
| Tests SQL (`npx supabase test db`) | **No ejecutables**: no hay stack local (puertos 55421/55422 caídos) y Docker no se usa. Escribí los tests pgTAP igual. Solo si `npx supabase status` muestra un stack local YA corriendo podés aplicar tus migraciones con `npx supabase migration up --local` y correr `npx supabase test db`; si no, reportalos como "escritos, no ejecutados". Nunca lo arranques vos. |

Agregá tests vitest para la lógica nueva de UI/dominio (schemas Zod, helpers de precio, mapeos) y corré también `npx vitest run <archivos tuyos>`. No se acepta "terminado" si sube la cantidad de fallas respecto del baseline.

Revisión estática de SQL (en lugar de ejecutarlo): releé cada migración nueva contra las definiciones vigentes de las funciones que redefinís (buscá con `grep` la última migración que las define; usá `create or replace` partiendo del cuerpo más reciente, no de uno viejo) y verificá firmas, grants, `security definer` + `set search_path`, y que no dependa de objetos que no existen en migraciones del repo.

## E. Reporte final (formato obligatorio, en español)

1. **Archivos tocados**: lista con ruta y una línea de qué cambió (separá nuevos / modificados).
2. **Hecho**: cada punto del objetivo con estado (hecho / parcial / no hecho) y por qué.
3. **Verificación**: tabla con cada comando de la sección D, resultado real (números) y comparación con el baseline.
4. **No verificado**: qué no se pudo probar (como mínimo, tests SQL y migraciones si no hubo stack local) y cómo debería probarse.
5. **Riesgos y pendientes para el usuario**: decisiones abiertas, pasos manuales (aplicar migraciones, desplegar funciones, correr scripts en modo apply), y cualquier supuesto que tomaste.
6. **Contratos expuestos**: firmas de RPC/columnas/tipos nuevos que otras tareas van a consumir.
