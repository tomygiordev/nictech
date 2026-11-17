# Brief 04 — Un solo precio en mostrador, web y checkout (Etapa 2)

**Sos un agente Codex trabajando en `A:\nictech`. No hay otra conversación: este archivo es todo tu contexto.**
Orden: después de la tarea 01 (que dejó el resolver sin `price_delta` y el checklist de publicación con 2 decimales en migraciones `2026111410*`). Puede correr **en paralelo** con la tarea 02 (`apps/erp/src/features/catalog/**`, `stock/**`) y la 03 (`apps/erp/src/features/repairs/**`, `apps/erp/src/lib/supabase.ts`, migraciones `2026111420*`). No toques sus archivos.

## 1. Qué cubre del plan

`docs/erp-admin-unification-plan.md`, **Etapa 2 — Un solo precio en mostrador, web y checkout** (filas Diseño, Edge Function, Web, Regla de publicación, Orden de despliegue, Aceptación) y la decisión D4 (§5). Reglas de negocio de `docs/erp-catalog-input-contract.md` §4 (precio final ARS con IVA incluido, un único resolver en servidor) y casos de redondeo §6.3 (deben pasar en los tres canales).

Estado verificado hoy:
- `supabase/functions/create-mercadopago-preference/index.ts` (con cambios sin commitear del usuario: `ERP_CHECKOUT_PAUSED`, filtro `is_active`, exigencia de variante) valida ítems con `validateCatalogItems` de `domain.ts` y cobra `products.price` del padre aunque la variante tenga precio propio. Inserta `public.orders` con `items[].unit_price`.
- `erp.resolve_catalog_effective_price` exige usuario autenticado con permisos ERP; la tienda anónima no puede llamarlo. `erp.product_variants.final_price_ars` existe (migración `20261021014019`) y no se proyecta a `public.product_variants`.
- Web: `src/components/shop/ProductCard.tsx`, `src/components/shop/ProductDetailModal.tsx`, `src/contexts/CartContext.tsx` (`validateCart()`), `src/pages/Checkout.tsx`, `src/pages/Tienda.tsx` muestran y guardan el precio del padre. Todos tienen cambios sin commitear del usuario que hay que preservar.
- El webhook (`supabase/functions/mercadopago-webhook/index.ts`) llama `erp.process_mercadopago_payment`; revisá que tome los importes de `orders.items` y que no recalcule con otra regla.

## 2. Objetivo

1. **Migración `2026111430*`**: 
   - Extraer el cálculo del resolver a una función interna `erp.resolve_catalog_effective_price_internal(p_organization_id uuid, p_product_id uuid, p_variant_id uuid default null, p_at timestamptz default now())` sin chequeo de permisos, `security definer`, `search_path` fijo, **sin** `execute` para `public`/`anon`/`authenticated` (solo `service_role` y dueño). El RPC actual del POS pasa a delegar en ella manteniendo su firma, sus permisos y su resultado (el POS no debe cambiar de comportamiento). Dejá el parámetro `p_at` porque la tarea 05 le agregará promociones por fecha.
   - Columna nueva `public.product_variants.price numeric(12,2)` (nullable, aditiva) con el precio efectivo ya resuelto de la variante, mantenida por trigger cuando cambian `erp.products.base_sale_price` o `erp.product_variants.final_price_ars` (enganchate al mecanismo de proyección del puente `erp.sync_erp_variant_to_storefront` / `sync_erp_product_to_storefront`, sin crear loops, y sin que una escritura en `public.product_variants.price` vuelva a `erp`: esa columna es solo de lectura/proyección). Backfill idempotente de la columna en la misma migración (es dato derivado, no borra nada).
   - Si hace falta, una función `public.get_storefront_cart_prices(p_items jsonb)` de solo lectura para `anon` que devuelva el precio de exhibición vigente por producto/variante (desde las columnas proyectadas, no del resolver) para que `validateCart()` revalide precio en una sola llamada. Opcional: si con `select` sobre `products`/`product_variants` alcanza, no la crees.
2. **Edge Function `create-mercadopago-preference`**: el `unit_price` de cada ítem sale del resolver interno con service role (`supabase.schema("erp").rpc("resolve_catalog_effective_price_internal", …)` usando `ERP_ORGANIZATION_ID`), por producto y variante. Nunca de `products.price` ni del frontend. Redondeo a 2 decimales según el contrato §6.3 (Mercado Pago cobra con 2 decimales); si el resolver devuelve más de 2 decimales, rechazá el ítem con error claro (el checklist de publicación ya lo impide). Si el resolver no está disponible, **fallá cerrado** con mensaje para el cliente (no cobres con otro precio). Mantené `ERP_CHECKOUT_PAUSED`. Mové la lógica pura (redondeo, armado de ítems) a `domain.ts` con tests en `domain.test.ts` (vitest), incluidos los casos de §6.3.
3. **Web** (sin romper nada si la columna `price` todavía no existe o viene null: fallback al precio del producto):
   - `ProductDetailModal`: muestra el precio de la variante elegida.
   - `ProductCard`: muestra "desde $X" si las variantes activas tienen precios distintos; precio único si no.
   - `CartContext`: cada ítem guarda el precio de su variante; `validateCart()` además de stock revalida precio y avisa al usuario si cambió (actualiza el ítem y lo informa con el mismo mecanismo de `adjustedItems`/toast que ya existe).
   - `Checkout.tsx`: total con los precios revalidados; el importe final es el que devuelve la preferencia.
   - `Tienda.tsx`, `Promos.tsx`, `Combos.tsx`: si arman tarjetas, pasan los datos de variantes necesarios para "desde $X". **No** cambies todavía cómo leen `original_price`/`sale_expires_at` (eso es la tarea 05).
   - Tipado: no edites `src/integrations/supabase/types.ts` ni `client.ts`. Creá `src/integrations/supabase/types.extensions.ts` con un tipo `StorefrontDatabase` que extienda `Database` (patrón del overlay de `apps/erp/src/lib/supabase.ts`) y un helper tipado que reutilice el cliente existente; usalo solo en los archivos que necesiten las columnas nuevas. Sin `any`.
4. **Webhook**: verificá (y ajustá solo si es necesario) que `orders.items[].unit_price` sea lo que se concilia en el ERP; reportá el hallazgo.
5. **Tests**: vitest para `domain.ts` (redondeo §6.3, precio por variante, fallo cerrado), `CartContext.test.tsx` (revalidación de precio y fallback sin columna), componentes de tarjeta/modal si ya tienen tests. pgTAP nuevo `supabase/tests/database/erp_unified_price_projection.test.sql`: la función interna no es ejecutable por `anon`/`authenticated`; el RPC del POS devuelve lo mismo que antes; `public.product_variants.price` se actualiza al cambiar `final_price_ars` o `base_sale_price` (heredado vs propio); escribir `public.product_variants.price` no modifica `erp`.
6. **Script de comparación** `scripts/erp-stage2-price-comparison.sql` (solo lectura, rollback): lista todo el catálogo activo con precio viejo (padre) vs nuevo (resolver) y marca las diferencias; según el plan, solo deberían diferir las variantes con precio propio. El usuario lo corre antes del corte.

## 3. Archivos

- **Permitidos**: `supabase/migrations/2026111430*.sql` (nuevos), `supabase/tests/database/erp_unified_price_projection.test.sql` (nuevo) y ajustes justificados de tests de puente/POS, `supabase/functions/create-mercadopago-preference/**`, `supabase/functions/mercadopago-webhook/**` (solo si el punto 4 lo exige), `src/components/shop/ProductCard.tsx`, `src/components/shop/ProductDetailModal.tsx`, `src/contexts/CartContext.tsx`, `src/contexts/CartContext.test.tsx`, `src/pages/Checkout.tsx`, `src/pages/Tienda.tsx`, `src/pages/Promos.tsx`, `src/pages/Combos.tsx`, `src/integrations/supabase/types.extensions.ts` (nuevo), tests nuevos junto a esos archivos, `scripts/erp-stage2-*.sql`.
- **Prohibidos**: `src/integrations/supabase/types.ts`, `src/integrations/supabase/client.ts`, `apps/erp/**` (incluido `apps/erp/src/lib/supabase.ts`: si el POS necesita un tipo nuevo, reportalo), `src/pages/Admin.tsx` y `src/components/admin/**`, migraciones existentes, `supabase/config.toml`.

## 4. Criterio de terminado

- Para una variante con precio propio, la tarjeta, el carrito, la preferencia de MP y `orders.items` usan el mismo importe (cubierto por tests de dominio y de contexto con mocks); los casos de §6.3 pasan.
- `npm run build`, `npm run typecheck:erp`, `npm run build:erp` OK; `npx vitest run` sin fallas nuevas; `deno check index.ts` OK en las funciones tocadas; `npx tsc --noEmit -p tsconfig.app.json` sin errores nuevos en tus archivos (si podés bajar los preexistentes de los archivos que tocás, mejor); lint sin errores nuevos.
- Reporte con el orden de despliegue exacto (migración → Edge Function → frontend) y cómo volver atrás (`ERP_CHECKOUT_PAUSED=true` + redeploy de la versión anterior de la función).

## 5. Riesgo

RIESGO ALTO: toca el cobro (Edge Function de Mercado Pago), el resolver de precios del POS y una migración que proyecta a la tienda en vivo. Nada se despliega ni se aplica: lo hace el usuario con el script de comparación corrido antes.

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
- VALIDACIÓN SQL REAL: hay binarios de PostgreSQL 18 y un shim de Supabase y pgTAP en A:\_audit_pg\work\. La metodología está en C:\Users\Gime\AppData\Local\Temp\claude\d36df3ccd66b24bf\a0008f39-37b6-4aa8-a076-995924bb68db\scratchpad\audit-01.md. Usá TU PROPIO clúster: initdb en A:\_audit_pg_04\data, con el puerto 56434, solo localhost. Aplicá todas las migraciones + seed + las tuyas y corré los pgTAP relevantes hasta que pasen. Al terminar, pg_ctl stop. Nunca te conectes a hosts remotos. Si C: no tiene espacio, poné TEMP/TMP en A:\_audit_pg_04\tmp.
- No cierres en un estado parcial: completá el brief entero. Si algo no puede verificarse, escribilo igual con cuidado y cubrilo con tests.
