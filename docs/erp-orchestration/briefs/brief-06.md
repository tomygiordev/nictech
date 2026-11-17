# Brief 06 — Preparación de cortes: banderas, canarios, stock por el ERP, módulos de salida y runbook (Etapa 3 + infraestructura del ciclo §1 + Etapa 0B K + Etapa 7 acceso)

**Sos un agente Codex trabajando en `A:\nictech`. No hay otra conversación: este archivo es todo tu contexto.**
Orden: última tarea, después de 01–05 (ya terminadas). Nadie trabaja en paralelo con vos.

## 1. Qué cubre del plan

`docs/erp-admin-unification-plan.md`:
- §1 "Regla que ordena todo", pasos 3 a 5 del ciclo de cada etapa (ocultar pestaña detrás de una **bandera de servidor**, **canario** que registra escrituras legacy, **bloqueo** en base) — se construye la infraestructura, **todo apagado por defecto**.
- **Etapa 3 — Stock y ventas rápidas por el ERP** (construcción: filas Migraciones, Antes de apagar, `inventory_movements`).
- §2 quater ajuste **K** (ocultar módulos sin uso) y §1 "Alcance mínimo": la salida a producción usa solo catálogo, punto de venta, caja y reparaciones.
- **Etapa 7**, fila "Acceso" (rol "Contenido web") y la verificación de punta a punta de pedidos web (fila "Pedidos y dashboard"). **No** se hace el reemplazo de tablas `public` por vistas ni el borrado de restos legacy (Etapa 7 "Catálogo público como vistas" y "Cierre técnico"): dependen de que el usuario haya hecho todos los cortes con canario en cero; solo se documentan en el runbook.
- Etapa 5 (multimodelo) y USD siguen postergadas.

Estado verificado:
- `src/pages/Admin.tsx` (con cambios sin commitear del usuario: tutoriales, pestañas móviles; preservalos) tiene las pestañas `dashboard`, `repairs`, `inventory`, `products`, `cases`, `variants`, `promos`, `banners`, `blog` + `DollarSettings`. No existe ninguna bandera de servidor.
- `erp.capture_storefront_stock_delta` (`supabase/migrations/20260923050002_erp_storefront_legacy_stock_capture.sql`) convierte escrituras directas de stock en `public` en ajustes del ERP.
- `packages/domain/src/modules.ts` define `ERP_MODULES` (30 módulos) con permisos; no hay visibilidad configurable por organización.
- Las tareas anteriores dejaron migraciones `2026111410*` (catálogo), `2026111420*` (reparaciones), `2026111430*` (precio único), `2026111440*` (promos), y scripts en `scripts/` y `scripts/cutover/`. Leelos: el runbook los ordena.

## 2. Objetivo

1. **Migración `2026111450*` — banderas y canarios**:
   - Tabla `erp.storefront_cutover_groups` (organización, `group_code` en {`catalog`, `stock`, `prices_promos`, `repairs`, `dashboard`}, `admin_tab_hidden bool default false`, `legacy_write_mode` en {`off`, `observe`, `block`} default `off`, actor/fecha del último cambio, motivo) con filas iniciales por organización (`on conflict do nothing`), RPC `erp.set_storefront_cutover_group(...)` con permiso de administración (revisá permisos existentes de configuración) y auditoría.
   - RPC `public.get_admin_cutover_flags()` para `authenticated` (solo lectura, devuelve qué pestañas del admin ocultar). Mapeo: `catalog` → `products`, `variants`, `cases` y alta/edición de `inventory`; `stock` → `inventory` y los modales de venta/reposición rápida; `prices_promos` → `promos` y `DollarSettings`; `repairs` → `repairs`; `dashboard` → `dashboard`.
   - Tabla `erp.legacy_write_canary_events` (grupo, tabla, operación, columnas tocadas, id de fila, `auth.uid()`, rol, fecha) y triggers sobre `public.products`, `public.product_variants`, `public.categories`, `public.brands`, `public.models` (y `public.repairs`/`repair_logs` para el grupo `repairs`) que, según el modo del grupo de los campos tocados: `off` → no hacen nada; `observe` → registran el evento si la escritura **no** viene de la proyección del ERP (usá el mismo mecanismo de guarda del puente para distinguirlo) y dejan pasar; `block` → rechazan con mensaje claro ("Este dato se gestiona desde el ERP"). Todo en `off` por defecto: la migración no cambia ningún comportamiento actual.
   - Etapa 3: `erp.capture_storefront_stock_delta` respeta el modo del grupo `stock`: `off` = comportamiento actual (convierte en ajuste), `observe` = convierte y además registra canario, `block` = rechaza escrituras directas de stock salvo las de la proyección. `public.inventory_movements` queda como histórico: en `block` del grupo `stock`, nuevas escrituras se rechazan; nada se borra.
   - Rol "Contenido web" (Etapa 7): si existe un catálogo de roles en `erp`, agregalo por organización sin permisos de catálogo, stock, precios ni reparaciones (solo lo necesario para entrar al admin de banners/blog si aplica). Explicá en el reporte cómo autoriza hoy `/admin` (revisá `src/pages/Admin.tsx`, `src/contexts/AuthContext.tsx` y las RLS de `posts`, `hero_banners`, `carousel_settings` que encuentres) y qué faltaría para que ese rol sea efectivo; no cambies RLS de `public` sin necesidad.
2. **Admin web**: hook `src/hooks/use-admin-cutover-flags.ts` (TanStack Query) que llama `get_admin_cutover_flags`; `Admin.tsx` oculta solo las pestañas cuyo grupo tenga `admin_tab_hidden = true`, **mostrando todo si el RPC falla o no existe** (fallo abierto: no puede dejar al local sin admin). Si la pestaña activa guardada en `localStorage` queda oculta, cae a la primera visible. Mostrá un acceso "Ir al ERP" (URL desde variable de entorno pública, p. ej. `VITE_ERP_URL`, documentada en `.env.example` sin valores reales). Tipos en `src/integrations/supabase/types.extensions.ts`.
3. **Módulos de salida (K)** en el ERP: visibilidad de módulos configurable por organización (setting en el mecanismo de configuración existente del ERP — revisá `apps/erp/src/features/system/**` y las tablas de settings —, o en la migración `2026111450*` si no hay uno) con un **perfil de salida** que muestre: catálogo, existencias, punto de venta, caja, pedidos online, reparaciones, clientes (si POS/reparaciones lo requieren), centro operativo, usuarios, configuración, sucursales y auditoría; el resto oculto pero reactivable desde Configuración. Ocultar no quita permisos ni borra nada. Implementalo en `packages/domain/src/modules.ts` (helper puro + tests en `modules.test.ts`) y en la navegación del ERP. Decidí el default (perfil de salida o todo visible) y justificálo en el reporte; el usuario debe poder cambiarlo desde la UI.
4. **Carga rápida (Etapa 3 "Antes de apagar")**: revisá `apps/erp/src/features/catalog/StockIntakeModal.tsx` y `apps/erp/src/features/pos/PosWorkspace.tsx` contra `src/components/admin/QuickRestockModal.tsx` y `QuickSaleModal.tsx`. Medí pasos/clics de: (a) ingreso de mercadería sin orden de compra; (b) venta de mostrador con caja abierta. Si el ERP es más lento, agregá lo mínimo (p. ej. buscar por código de barras con Enter, cantidad por defecto 1, recordar ubicación/caja). No toques la lógica de cobro, caja ni documentos de stock: solo flujo de UI. Reportá la comparación.
5. **Pedidos web de punta a punta (Etapa 7)**: test pgTAP `supabase/tests/database/erp_storefront_order_end_to_end.test.sql` que encadene pago aprobado (`erp.process_mercadopago_payment`) → `erp.web_orders` creado → stock reservado → `erp.fulfill_web_order` → stock final y documentos correctos, usando los fixtures de los tests existentes (`erp_fulfill_online_order.test.sql`, `erp_online_order_lifecycle.test.sql`).
6. **Conciliación**: `scripts/erp-cutover-reconciliation.sql` (solo lectura, rollback): por grupo, diferencias `erp` vs `public` (campos de catálogo de la tarea 01, precios de la 04, promos de la 05, stock proyectado), conteo de eventos de canario por grupo, y los conteos de filas por tabla que pide la aceptación de la Etapa 0B (para comparar antes/después de aplicar migraciones). No modifiques `scripts/check-erp-catalog-baseline.sql` (es del usuario); podés invocarlo/referenciarlo.
7. **Runbook** `docs/erp-cutover-runbook.md` (en español, conciso): (a) puesta en marcha — orden exacto de aplicación de todas las migraciones nuevas `2026111410*`…`2026111450*` primero en un entorno de prueba (el plan recomienda un segundo proyecto Supabase; hoy no existe), regenerar tipos (`npm run types:erp`, `npx supabase gen types …`) y retirar los overlays cuando corresponda, despliegue de Edge Functions en orden (migración → función → frontend), scripts de backfill con dry-run; (b) checklist previo al uso real: usuarios y roles, medios de pago, caja, piloto de una jornada en paralelo con el admin (Etapa 3) y conciliación al cierre; (c) por cada corte (catálogo, precios, reparaciones, stock y ventas, promos): precondiciones, comandos, bandera a cambiar, período de canario `observe` (1–2 semanas), paso a `block`, criterio de aceptación de la etapa y rollback; (d) lo que queda para después de todos los cortes: Etapa 7 (vistas sobre `erp`, borrado de restos legacy del punto H, revocar escrituras, borrar componentes del admin), Etapa 5, USD, 1B, 1C; (e) decisiones abiertas del usuario (§5 del plan: entorno de prueba, 494 unidades en productos inactivos, promos sin fin, sucursales, costos).
8. **Tests**: pgTAP `supabase/tests/database/erp_storefront_cutover_flags.test.sql` (por defecto todo `off` y ninguna escritura legacy cambia de comportamiento; `observe` registra y deja pasar; `block` rechaza; la proyección del ERP nunca queda bloqueada ni registrada; permisos de las RPC). Vitest para el hook de banderas (fallo abierto) y el filtrado de pestañas de `Admin.tsx`, y para el helper de módulos.

## 3. Archivos

- **Permitidos**: `supabase/migrations/2026111450*.sql` (nuevos), `supabase/tests/database/erp_storefront_cutover_flags.test.sql` y `erp_storefront_order_end_to_end.test.sql` (nuevos), `scripts/erp-cutover-reconciliation.sql` (nuevo), `scripts/cutover/**` (nuevos; no modifiques los de las tareas 03 y 05 salvo bugs, que reportás), `docs/erp-cutover-runbook.md` (nuevo), `src/pages/Admin.tsx`, `src/hooks/use-admin-cutover-flags.ts` (nuevo) + test, `src/integrations/supabase/types.extensions.ts`, `.env.example` (solo agregar `VITE_ERP_URL` vacío o con placeholder), `packages/domain/src/modules.ts` + tests, la navegación del ERP (`apps/erp/src/App.tsx` / `apps/erp/src/components/**` donde se arma el menú) + tests, `apps/erp/src/features/system/**`, `apps/erp/src/features/catalog/StockIntakeModal.tsx`, `apps/erp/src/features/pos/PosWorkspace.tsx` (solo flujo de UI) + tests, `apps/erp/src/lib/supabase.ts`.
- **Prohibidos**: tipos generados, migraciones existentes, `src/components/admin/**` (no borres ni cambies los modales del admin), `supabase/functions/**`, `supabase/config.toml`, `scripts/check-erp-catalog-baseline.sql`, cualquier cambio que active un canario, un bloqueo u oculte una pestaña por defecto.

## 4. Criterio de terminado

- Con la migración aplicada y sin tocar banderas, la tienda, el admin y el ERP se comportan exactamente igual que hoy (cubierto por tests).
- `npm run build`, `npm run typecheck:erp`, `npm run build:erp`, `npm run test:erp:desktop` OK; `npx vitest run` sin fallas nuevas; lint y `tsc -p tsconfig.app.json` sin errores nuevos en tus archivos.
- Runbook completo y coherente con las migraciones y scripts que realmente existen en el repo (verificá cada nombre de archivo citado con `ls`).

## 5. Riesgo

RIESGO: migración con triggers sobre tablas de la tienda en vivo y cambio en la captura de stock (`capture_storefront_stock_delta`), además de `Admin.tsx`, que el local usa a diario. Mitigación exigida: todo apagado por defecto, fallo abierto en el admin, y tests que prueben que el modo `off` no cambia nada.

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
