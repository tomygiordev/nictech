# Brief 03 — Reparaciones en el ERP con seguimiento web por código XXXX-XXXX (Etapa 0B ajuste I + Etapa 6, construcción)

**Sos un agente Codex trabajando en `A:\nictech`. No hay otra conversación: este archivo es todo tu contexto.**
Orden: después de la tarea 01. Puede correr **en paralelo** con la tarea 02 (pantallas de catálogo en `apps/erp/src/features/catalog/**` y `stock/**`) y la 04 (tienda `src/` salvo lo que se indica abajo, Edge Functions, migraciones `2026111430*`). Vos sos el único que edita `apps/erp/src/lib/supabase.ts` en esta ronda.

## 1. Qué cubre del plan

`docs/erp-admin-unification-plan.md`:
- §2 quater ajuste **I** (estados de reparación que no coinciden: web 5 pasos vs ERP 4 estados y 3 transiciones).
- **Etapa 6 — Reparaciones en el ERP y seguimiento en la web**: filas "Código de seguimiento", "Seguimiento web", "Estados", "Pantallas ERP" y la preparación del "Corte". Decisiones del usuario D3 y D5 (§5): el cliente sigue usando `/seguimiento` con código o DNI; no hay historial que migrar (las 4 filas de `public.repairs` están borradas).
- Pendiente del usuario que **no** resolvés: una o dos sucursales (Urdinarrain / Gilbert). No crees sucursales.

Estado verificado hoy:
- La web (`src/pages/Seguimiento.tsx:78`) llama `rpc('get_repair_by_tracking_code', { search_code })`; su forma de retorno está en `src/integrations/supabase/types.ts` (≈línea 455): `client_name, client_dni, created_at, device_brand, device_model, id, locality, notes, problem_description, status (enum public.repair_status: Recibido | Diagnóstico | Repuestos | Reparación | Finalizado), tracking_code, repair_logs[{id, created_at, content, is_public}]`. Esa función **no está en ninguna migración del repo** (se creó fuera; su cuerpo actual solo existe en producción).
- ERP: `erp.repair_orders`, `erp.repair_statuses`, `erp.repair_status_transitions`, `erp.repair_state_events`, tokens `erp.repair_tracking_tokens` y `public.get_repair_tracking(token)` en `supabase/migrations/202608190007_erp_repairs_quotes_warranties.sql`; `erp.intake_repair_order` (última def. `202609070003_erp_phase_d_repairs_lifecycle.sql:309`), `transition_repair_order`, vista `repair_orders_overview`. Los 4 estados (received/Recibido, diagnosis, repair, ready/Listo para entregar) están solo en `supabase/seed.sql`, no en migraciones; en producción existen como datos.
- `src/utils/generateTrackingCode.ts` define el formato (`XXXX-XXXX`, sin I, O, 0, 1).
- UI ERP: `apps/erp/src/features/repairs/RepairsWorkspace.tsx` y `api.ts`.

## 2. Objetivo

Migraciones con prefijo **`2026111420`** + tests pgTAP + UI ERP + scripts de corte (no ejecutados):

1. **Catálogo de estados (I)**: columna `public_stage` en `erp.repair_statuses` (check con los 5 pasos web: `Recibido`, `Diagnóstico`, `Repuestos`, `Reparación`, `Finalizado`). Agregar por organización existente, idempotente (`on conflict do nothing`), los estados "Esperando repuestos" (→ Repuestos) y "Entregado" (→ Finalizado, terminal), y las transiciones que falten para un flujo real: Recibido→Diagnóstico→(Esperando repuestos↔Reparación)→Listo para entregar→Entregado, con los permisos que ya usa `transition_repair_order`. Mapear los 4 existentes (Recibido→Recibido, Diagnóstico→Diagnóstico, Reparación→Reparación, Listo→Finalizado). Revisá cómo interactúa "Entregado" con `deliver_repair_order` / `repair_deliveries` (la entrega formal ya existe): definí una sola fuente de verdad y explicala en el reporte. Actualizá `supabase/seed.sql` en coherencia. No cambies ni borres los estados existentes.
2. **Código de seguimiento**: columna `erp.repair_orders.public_tracking_code text`, única por organización, formato `^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$` (misma regla que `generateTrackingCode()`), generado en servidor dentro de `erp.intake_repair_order` (reintento ante colisión). Backfill para órdenes ERP existentes (en producción hay 0, pero la migración debe soportarlo). Exponerlo en `repair_orders_overview` (partí de su definición más reciente). El token largo del ERP se mantiene para links.
3. **Función nueva para la web (sin corte)**: `public.get_repair_by_tracking_code_erp(search_code text)` (`security definer`, `search_path` fijo, `grant execute` a `anon` y `authenticated`) que busca por `public_tracking_code` o por DNI/documento del cliente ERP y devuelve **exactamente la misma forma** que hoy devuelve `get_repair_by_tracking_code` (mismos nombres de columnas y tipos; `status` como `public.repair_status` mapeado desde `public_stage`; `repair_logs` solo con eventos/notas **públicas**; `locality` desde la sucursal; `notes` solo lo público). Nunca devuelve notas internas. Un código inexistente devuelve vacío sin revelar nada. **Límite de intentos en servidor**: tabla de intentos (por hash del valor buscado y, si está disponible, IP desde `current_setting('request.headers', true)::json->>'x-forwarded-for'`) con ventana y tope configurables; superado el tope, devuelve vacío/error genérico. Documentá cómo se purga el registro de intentos sin borrar datos de negocio.
4. **Notas públicas/internas**: si el ERP no tiene notas de reparación con visibilidad, agregá lo mínimo (tabla `erp.repair_notes` con `is_public` o columna en eventos existentes) + RPC `erp.add_repair_note(p_repair_order_id, p_content, p_is_public)` con permisos `repairs.*` y auditoría.
5. **Scripts de corte (no se ejecutan; los corre el usuario el día del corte)** en `scripts/cutover/`:
   - `stage6-repairs-tracking-switch.sql`: en una transacción, guarda la definición actual de `public.get_repair_by_tracking_code` (`pg_get_functiondef`) en una tabla de respaldo (créala en la migración, p. ej. `erp.cutover_function_backups`), y redefine `public.get_repair_by_tracking_code(search_code)` para delegar en la versión ERP con la misma firma y retorno.
   - `stage6-repairs-tracking-rollback.sql`: restaura el cuerpo respaldado.
   - Ambos con chequeos previos (que la función exista con la firma esperada, que haya respaldo) y salida clara.
6. **UI ERP (`RepairsWorkspace.tsx`, `api.ts`)**: buscador por código de seguimiento y por DNI; el código visible en el detalle y en el comprobante/etiqueta de ingreso (revisá qué imprime hoy el ingreso y agregalo ahí); alta de notas públicas o internas tan fácil como en el admin (toggle visible "El cliente la ve en la web"); estados nuevos disponibles en las transiciones; indicador del paso web que verá el cliente. Formularios con Zod.
7. **Overlay de tipos**: agregá a `apps/erp/src/lib/supabase.ts` las columnas/RPC nuevas del esquema `erp`. Para la función `public.get_repair_by_tracking_code_erp` no hace falta tocar la tienda: la web no cambia (en el corte se redefine la función vieja con la misma forma).
8. **Tests**: pgTAP nuevos en `supabase/tests/database/erp_repairs_public_tracking.test.sql`: código generado con formato correcto y único; búsqueda por código y por DNI; mapeo correcto a los 5 pasos al cambiar de estado; ninguna nota interna en la respuesta; código inexistente no revela datos; límite de intentos; anon puede ejecutar la función web pero no leer tablas ERP; script de switch/rollback (al menos su lógica de respaldo). Vitest para helpers/schemas nuevos de la UI.

## 3. Archivos

- **Permitidos**: `supabase/migrations/2026111420*.sql` (nuevos), `supabase/tests/database/erp_repairs_public_tracking.test.sql` (nuevo) y ajustes justificados de tests de reparaciones existentes, `supabase/seed.sql` (solo estados/transiciones de reparación), `scripts/cutover/stage6-*.sql` (nuevos), `apps/erp/src/features/repairs/**`, `apps/erp/src/lib/supabase.ts`, `apps/erp/src/lib/supabase.test.ts`.
- **Prohibidos**: `src/**` (la tienda NO cambia: `Seguimiento.tsx`, `RepairTimeline` y `GlobalSearch` quedan igual hasta el corte), `src/pages/Admin.tsx` (no ocultes la pestaña `repairs`), `public.repairs`/`repair_logs` (ni DDL ni datos), `apps/erp/src/features/catalog/**`, `stock/**`, `pos/**`, `supabase/functions/**`, migraciones existentes, tipos generados.

## 4. Criterio de terminado

- Migraciones, tests pgTAP, scripts de corte y UI listos; el reporte incluye la firma exacta y un ejemplo de respuesta de `get_repair_by_tracking_code_erp`, y una comparación columna por columna con la forma actual de `get_repair_by_tracking_code`.
- `npm run typecheck:erp`, `npm run build:erp`, `npm run build` OK; `npx vitest run` sin fallas nuevas; lint sin errores nuevos en tus archivos.

## 5. Riesgo

RIESGO: esquema de DB nuevo y lo que el cliente final usa (`/seguimiento`) — mitigado porque la función web vieja no se toca hasta el corte, que es un script manual con rollback. El rollback depende de que el respaldo de la definición actual se tome en producción en el mismo script.

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
