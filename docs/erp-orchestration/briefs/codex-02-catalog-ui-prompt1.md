# Brief 02 — Catálogo ERP: ficha guiada y publicación (Etapa 0B B/C/F/G + Etapa 1, pantallas)

**Sos un agente Codex trabajando en `A:\nictech`. No hay otra conversación: este archivo es todo tu contexto.**
Orden: después de la tarea 01 (capa DB del catálogo, ya terminada). Puede correr **en paralelo** con la tarea 03 (reparaciones: `apps/erp/src/features/repairs/**`, `apps/erp/src/lib/supabase.ts`, migraciones `2026111420*`) y la 04 (precio único: tienda `src/`, Edge Functions, migraciones `2026111430*`). No toques sus archivos.

## 1. Qué cubre del plan

`docs/erp-admin-unification-plan.md`:
- §2 ter (problemas de carga reales y su corrección) y §2 quater ajustes **B** (un único estado Borrador / Publicado / Pausado), **C** (un solo nombre/descripción/foto en la ficha), **F** (modelo único vs compatibilidad según tipo), **G** (inactivos ocultos por defecto con filtro "ver inactivos"), **E** (color como eje de variante).
- **Etapa 1**: filas "Pantallas ERP", "Ficha guiada" y "Códigos" (parte de pantalla). Etapas 1B (importación por planilla) y 1C (usados con IMEI) **no** se hacen.

## 2. Insumos de la tarea 01

Leé primero `apps/erp/src/lib/supabase.ts` (overlay de tipos) y las migraciones `supabase/migrations/2026111410*.sql` para conocer los contratos: `erp.save_catalog_product_sheet`, `erp.publish_catalog_product`, `erp.get_catalog_publish_checklist`, pausa/despublicación, `erp.product_media`, `erp.colors`, plantilla de producto (`celular` / `accesorio` / `funda`), `tags`, `condition`, `capacity`, códigos cortos y `erp.recode_catalog_product`. Si algún contrato falta o no alcanza, **no edites esas migraciones ni el overlay**: adaptá la UI a lo que hay y reportá el hueco.

Estado verificado: `apps/erp/src/features/catalog/` tiene `CatalogWorkspace.tsx`, `CreateProductModal.tsx` (usa `create_catalog_product_with_variants`), `ProductEditModal.tsx`, `ProductVariantsModal.tsx` (`manage_product_variants`), `ProductCompatibilityModal.tsx` (`set_product_compatible_models`), `ProductDetailModal.tsx`, `StockIntakeModal.tsx`, `PricingWorkspace.tsx`, `schemas.ts` (+ tests). Ninguno tiene fotos, tags, condición, capacidad ni estado de publicación.

## 3. Objetivo

1. **Ficha guiada única** (reemplaza las cinco pantallas del admin; no las copies): crear/editar producto con **plantilla por tipo** (Celular, Accesorio, Funda), cada una muestra solo sus campos y marca obligatorios. Marca obligatoria (con opción "Genérico"), costo obligatorio en el alta (aunque sea estimado), categoría, precio final ARS con IVA incluido (regla del contrato §4), nombre **sugerido** (tipo + marca + modelo + especificación) editable, que no se resetea al cambiar precio o foto, con espacios normalizados. Un solo nombre, una descripción y una foto principal visibles (C); el nombre/descr. pública distinta solo detrás de un "personalizar para la web" explícito.
2. **Bloque "Publicación web"**: subida de fotos al bucket de Storage `product_images` (principal + galería, orden arrastrable o con botones, foto por variante opcional), descripción, tags (solo características; ayuda que aclare que las campañas no van en tags), capacidad y condición según plantilla. Guardado con `save_catalog_product_sheet` en una sola llamada después de subir las fotos; si la subida falla no se llama al RPC y se informa qué foto falló.
3. **Estado y publicación**: badge Borrador / Publicado / Pausado en listado y ficha; botón Publicar que primero consulta el checklist y lista los faltantes (foto, precio > 0 con 2 decimales, categoría, nombre, marca); Pausar/Reanudar.
4. **Color como variante** (E): en lugar de duplicar el producto, "Agregar color" crea una variante con color del catálogo `erp.colors`, stock y foto propios. Precio de la variante: propio (`final_price_ars`) o heredado; `price_delta` no se muestra más.
5. **Modelo vs compatibilidad** (F): Celular muestra "Modelo" (`model_id`); Accesorio/Funda muestran "Sirve para" (compatibilidad N:M con el modal existente). Nunca los dos.
6. **Códigos**: el código corto se muestra y se asigna solo; acción explícita "Recodificar" (con confirmación) que usa `recode_catalog_product`; campo de código de barras pensado para lector (foco y Enter) usando los identificadores de variante existentes.
7. **Inactivos ocultos por defecto** (G): `CatalogWorkspace`, los selectores de producto de Existencias y los listados de stock/reportes del ERP que lean productos excluyen inactivos por defecto, con un control "Ver inactivos". Revisá `apps/erp/src/features/stock/**` y reportes; tocá solo las consultas de listado/filtro, no la lógica de movimientos.
8. **Schemas Zod** en `apps/erp/src/features/catalog/schemas.ts` (o archivo nuevo en la misma carpeta) por plantilla, con tests en `schemas.test.ts`; tests de componentes en `CatalogModals.test.tsx` (crear en borrador, publicar con faltantes muestra la lista, editar descripción no cambia el nombre, agregar color crea variante). Aprovechá para que `apps/erp/src/App.test.tsx > switches workspace and displays respective header` (falla preexistente: busca el texto "Catálogo Maestro de Productos") vuelva a pasar si la causa está en el header del catálogo; si no, reportalo.
9. Accesibilidad básica de formularios (labels, mensajes de error asociados, foco al primer error) y diseño consistente con el resto del ERP (`apps/erp/DESIGN.md`).

## 4. Archivos

- **Permitidos**: `apps/erp/src/features/catalog/**`, `apps/erp/src/features/stock/**` (solo consultas/filtros de listado), consultas de listados de catálogo en `apps/erp/src/features/dashboard/**` o reportes si filtran productos, `apps/erp/src/components/**` (solo componentes nuevos reutilizables, p. ej. subidor de imágenes, si no existe uno), `apps/erp/src/App.test.tsx`, archivos nuevos de test en esas carpetas.
- **Prohibidos**: `apps/erp/src/lib/supabase.ts` y tipos generados (si te falta un tipo, definí un tipo local en la feature derivado del overlay, sin `any`), `supabase/**` (migraciones, funciones, tests SQL), `src/**` (tienda), `apps/erp/src/features/repairs/**`, `apps/erp/src/features/pos/**`, `packages/domain/**`.

## 5. Criterio de terminado

- Un producto creado desde la ficha queda en Borrador; Publicar sin foto muestra los faltantes; editar descripción no toca stock ni resetea el nombre (cubierto por tests de componentes con el cliente Supabase mockeado como en los tests existentes).
- `npm run typecheck:erp`, `npm run build:erp` OK; `npx vitest run` sin fallas nuevas (idealmente con `App.test.tsx` arreglado); `npm run lint` sin errores nuevos en tus archivos (el error preexistente de `ProductCompatibilityModal.tsx:114`, `useMemo` condicional, arreglalo si tocás ese archivo).

## 6. Riesgo

Medio-bajo: solo pantallas del ERP. Las pantallas escriben en la base de producción en cuanto alguien use el ERP con el `.env` actual, pero las migraciones de la tarea 01 todavía no están aplicadas: la ficha nueva solo funcionará cuando el usuario las aplique. Reportá qué pasa si la UI corre contra una base sin esas migraciones (idealmente, mensaje claro y no pantalla rota).

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

---
## Addendum del orquestador (vale por encima del brief)
- La tarea 01 (base del catálogo) está TERMINADA y auditada: migraciones 20261114100000..100900, scripts/erp-stage1-*. Leé su reporte final en C:\Users\Gime\AppData\Local\Temp\claude\d36df3ccd66b24bf\a0008f39-37b6-4aa8-a076-995924bb68db\scratchpad\codex-01c.md (y codex-01b.md) para conocer los contratos reales (RPC, vistas, firmas, errores). No edites esos archivos; si encontrás un bug en ellos, documentalo en tu reporte con el fix propuesto.
- En paralelo corren otros agentes. La tarea 03 (reparaciones: migraciones 2026111420*, apps/erp/src/features/repairs/**, src/pages/Seguimiento*, seed.sql) es la ÚNICA que edita apps/erp/src/lib/supabase.ts en esta ronda: vos NO lo edites. Si te falta un tipo del overlay, definilo localmente en tu feature (sin `any`) y anotá en el reporte el cambio de overlay que haría falta. Respetá estrictamente los archivos permitidos de tu brief.
- VALIDACIÓN SQL REAL: hay binarios de PostgreSQL 18 y un shim de Supabase y pgTAP en A:\_audit_pg\work\. La metodología está en C:\Users\Gime\AppData\Local\Temp\claude\d36df3ccd66b24bf\a0008f39-37b6-4aa8-a076-995924bb68db\scratchpad\audit-01.md. Usá TU PROPIO clúster: initdb en A:\_audit_pg_02\data, con el puerto 56435, solo localhost. Aplicá todas las migraciones + seed + las tuyas y corré los pgTAP relevantes hasta que pasen. Al terminar, pg_ctl stop. Nunca te conectes a hosts remotos. Si C: no tiene espacio, poné TEMP/TMP en A:\_audit_pg_02\tmp.
- No cierres en un estado parcial: completá el brief entero. Si algo no puede verificarse, escribilo igual con cuidado y cubrilo con tests.
