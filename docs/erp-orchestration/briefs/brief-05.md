# Brief 05 — Campañas y promociones con vigencia en el ERP (Etapa 4, sin USD)

**Sos un agente Codex trabajando en `A:\nictech`. No hay otra conversación: este archivo es todo tu contexto.**
Orden: después de las tareas 01–04 (ya terminadas). Nadie trabaja en paralelo con vos.

## 1. Qué cubre del plan

`docs/erp-admin-unification-plan.md`, **Etapa 4 — Promos y dólar**: filas Campañas, Validación, Promos, Proyección, Pantallas ERP (solo promos) y Datos (solo script). La parte **USD queda postergada** (no hay productos en USD): no construyas `price_mode`/`price_usd` ni la bandeja de previews por dólar. Tampoco se apagan `PromoManagement` ni `DollarSettings` (eso es el corte, lo decide el usuario).

Pendiente del usuario que no resolvés: las 8 promos activas no tienen vencimiento → permití promos **sin fecha de fin** (`ends_at` nullable) y dejá que el usuario decida en el script de datos.

Estado verificado:
- Hoy `src/components/admin/PromoManagement.tsx` pisa `public.products.price` con el precio rebajado y guarda `original_price` y `sale_expires_at`; el puente copia ese precio a `erp.products.base_sale_price`, así que el POS cobra la promo.
- La tarea 04 dejó `erp.resolve_catalog_effective_price_internal(p_organization_id, p_product_id, p_variant_id, p_at)` (leé su migración `2026111430*`) usada por el RPC del POS, la proyección `public.product_variants.price` y el checkout. La tarea 01 dejó la ficha y el checklist (`2026111410*`).
- La web lee promos desde `original_price`/`sale_expires_at` en `src/pages/Tienda.tsx`, `src/pages/Promos.tsx`, `src/pages/Combos.tsx`, `src/components/shop/ProductCard.tsx`, `src/components/shop/ProductDetailModal.tsx` (con cambios sin commitear del usuario y de la tarea 04: preservalos).
- `apps/erp/src/features/catalog/PricingWorkspace.tsx` hoy solo captura cotizaciones.

## 2. Objetivo

1. **Migración `2026111440*`**:
   - `erp.campaigns` (organización, nombre, `starts_at`, `ends_at` nullable, estado, actor, timestamps) y `erp.promotions` (organización, campaña opcional, producto, variante opcional, `promo_price_ars` final con IVA **o** `discount_percent` (exactamente uno), `starts_at`, `ends_at` nullable, creada por, cancelada en/por/motivo). RLS por organización con `erp.has_permission` (reutilizá permisos de `pricing.*` existentes; revisá `packages/domain/src/permissions.ts` y las migraciones). Auditoría. Sin `delete`: la baja es cancelación.
   - RPC `erp.save_campaign`, `erp.save_promotion`, `erp.cancel_promotion`, `erp.list_active_promotions` (o vistas equivalentes). Validación en servidor: el precio promo resultante debe ser **menor** al precio de lista vigente (`base_sale_price` / `final_price_ars`) y con 2 decimales como máximo; fechas coherentes; no solapar dos promos activas para el mismo producto/variante.
   - El resolver interno pasa a devolver **precio de lista y precio vigente** según `p_at` (promo vigente si existe; al vencer vuelve solo al de lista, sin job ni acción manual). Mantené compatibles las firmas que consumen el POS, la proyección y el checkout (si agregás columnas al retorno, que sean al final y que los consumidores existentes sigan funcionando). Revisá el POS (`apps/erp/src/features/pos/pricing.ts` y su RPC) para que cobre precio vigente.
   - Proyección aditiva en `public.products`: `promo_price numeric(12,2)`, `promo_starts_at timestamptz`, `promo_ends_at timestamptz` (y lo mismo en `public.product_variants` si hay promos por variante), mantenidas por trigger desde `erp.promotions`. `public.products.price` **no** cambia de semántica todavía (mientras el admin siga activo lo sigue escribiendo `PromoManagement`); el cambio a "siempre precio de lista" ocurre en el corte.
2. **Script de corte** `scripts/cutover/stage4-promotions-cutover.sql` (no se ejecuta): dry-run por defecto; en modo apply, en una sola transacción y con la instrucción de poner `ERP_CHECKOUT_PAUSED=true` antes: para cada producto con `original_price` > `price`, fija `base_sale_price = original_price` y crea la fila en `erp.promotions` con el precio rebajado (fechas desde `sale_expires_at` o sin fin, según una CTE de decisiones al inicio); **detecta y no migra** promos invertidas (precio promo ≥ lista, p. ej. el Motorola G23) listándolas para el usuario; crea la campaña "Cyber Monday" y quita el tag `CYBERMONDAY` de los productos migrados (es modificar un array, no borrar registros); corta el sentido `public.products.price → erp.base_sale_price` del puente (mirá `erp.sync_storefront_product_to_erp`) para que el admin ya no pueda pisar el precio; y concilia al final (precio vigente ERP = lo que veía la web). Más un `stage4-promotions-rollback.sql` que vuelva a habilitar el sentido del puente y cancele las promos creadas por el script (sin borrar filas).
3. **Pantallas ERP** en `PricingWorkspace.tsx` (o componentes nuevos en `apps/erp/src/features/catalog/`): lista de campañas y promos vigentes / programadas / vencidas / canceladas, alta y cancelación con vigencia, buscador de producto/variante, mostrando precio de lista, precio promo y ahorro. Formularios con Zod (`schemas.ts` + tests). Tipos nuevos en el overlay `apps/erp/src/lib/supabase.ts`.
4. **Web** (retrocompatible antes y después del corte): helper único `src/lib/pricing/promo.ts` (o similar) que decide el precio a mostrar: si hay `promo_price` vigente por fecha (`promo_starts_at <= now < promo_ends_at` o sin fin), lo usa con `price` como precio tachado; si no hay columnas `promo_*` (migración no aplicada) o vienen null, cae a la lógica actual de `original_price`/`sale_expires_at`. Usalo en `Tienda`, `Promos` (lista productos de campañas vigentes cuando haya datos `promo_*`; si no, comportamiento actual), `Combos`, `ProductCard`, `ProductDetailModal`. El checkout ya cobra lo que diga el resolver (tarea 04): verificá que el carrito muestre el mismo precio vigente. Tipos en `src/integrations/supabase/types.extensions.ts` (creado por la tarea 04).
5. **Tests**: pgTAP `supabase/tests/database/erp_campaigns_promotions.test.sql` (promo vigente aplica en resolver y proyección; vencida deja de aplicarse sin tocar nada usando `p_at`; promo ≥ lista rechazada; solapamiento rechazado; cancelación; permisos; POS cobra lista salvo promo vigente). Vitest para el helper de la web (todas las combinaciones de fechas y fallback legacy), schemas del ERP y el workspace de precios.

## 3. Archivos

- **Permitidos**: `supabase/migrations/2026111440*.sql` (nuevos), `supabase/tests/database/erp_campaigns_promotions.test.sql` (nuevo) y ajustes justificados de tests de precios/POS/puente, `scripts/cutover/stage4-*.sql`, `apps/erp/src/features/catalog/PricingWorkspace.tsx` y archivos nuevos de promos en esa carpeta, `apps/erp/src/features/catalog/schemas.ts` + tests, `apps/erp/src/features/pos/pricing.ts` (solo si el precio vigente lo exige) + tests, `apps/erp/src/lib/supabase.ts`, `src/lib/pricing/**` (nuevo), `src/pages/Tienda.tsx`, `src/pages/Promos.tsx`, `src/pages/Combos.tsx`, `src/components/shop/ProductCard.tsx`, `src/components/shop/ProductDetailModal.tsx`, `src/contexts/CartContext.tsx` (solo si hace falta para el precio vigente), `src/integrations/supabase/types.extensions.ts`, `supabase/functions/create-mercadopago-preference/**` (solo si el retorno del resolver cambia).
- **Prohibidos**: `src/components/admin/**` y `src/pages/Admin.tsx` (no apagues `PromoManagement` ni `DollarSettings`), tipos generados, migraciones existentes, `supabase/functions/get-dollar-rate/**`, cualquier construcción de USD.

## 4. Criterio de terminado

- Una promo vencida deja de aplicarse en web (helper) y POS (resolver) sin tocar nada (tests con fecha simulada); el POS cobra lista salvo promo vigente; la web funciona igual que hoy si las columnas nuevas no existen.
- `npm run build`, `npm run typecheck:erp`, `npm run build:erp` OK; `npx vitest run` sin fallas nuevas; `deno check` si tocaste la Edge Function; lint y `tsc -p tsconfig.app.json` sin errores nuevos en tus archivos.

## 5. Riesgo

RIESGO ALTO en el corte (si queda una promo a medio migrar, el POS cobra mal): el script de corte va en una sola transacción, con dry-run, lista de promos invertidas y conciliación final, y se corre con `ERP_CHECKOUT_PAUSED=true`. La construcción en sí toca el resolver de precios y el POS.

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
