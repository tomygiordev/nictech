# Informe consolidado final — ERP NicTech (cierre del entregable)

Branch: `dev/erp` · HEAD verificado: `3ce94fe`
Fecha de verificación: 2026-09-08 (git log / rev-parse / ls-files / grep — nada de memoria).

> Correcciones honestas respecto al borrador: la suite pgTAP real es **18 archivos / 1265 tests
> (medición real de corrida con `npx supabase test db`: 17 archivos en `supabase/tests/database/`
> + `supabase/tests/erp_finance_accounting.test.sql`)**, no 17/1215. El archivo phase E declara
> `plan(30)` y sus fixes de cierre son 2 commits (`eb7a151`, `ad9d4e5`); no existe un tercer
> commit de E-cierre en el log.

## 1. Estado por fase (A–G) con commits verificados

Todos los hashes abajo fueron verificados con `git rev-parse` y `git show --stat` antes de escribir.

### Fase A — base / workspaces iniciales
- `a19d694` feat(erp/fase-a): workspaces dashboard, auditoría y sistema
- `abd6270` docs(erp/fase-a): documento de avance FASE A

### Fase B — catálogo, variantes, POS
- `dd78815` feat(erp/fase-b): migración variantes/unidades, soporte POS y tests pgTAP
- `9caefd7` feat(erp/fase-b): CatalogWorkspace conectado a Supabase
- `7108afa` docs(erp/fase-b): documento de avance FASE B
- Migraciones: `202609070001_erp_phase_b_variants_and_units.sql`,
  `202609070002_erp_phase_b_pos_support.sql`
- Test: `erp_phase_b_case_variants.test.sql` (`plan(14)`)

### Fase C — compras, caja, punto de venta
- `4b30e4e` feat(erp/fase-c): CashWorkspace con sesiones, aperturas y cierres
- `cbcc3b2` docs(erp/fase-c): documento de avance FASE C
- Test: `erp_phase_c_purchases_pos_cash.test.sql` (`plan(12)`)

### Fase D — reparaciones, presupuestos
- `464a41e` feat(erp/fase-d): migraciones ciclo reparaciones, policies presupuestos y tests pgTAP
- `f951bfc` feat(erp/fase-d): RepairsWorkspace y api.ts
- `0351802` feat(erp/fase-d): QuotesWorkspace y api.ts
- `b152bb8` feat(erp/fase-d): CustomersWorkspace con historial
- `f5019e2` docs(erp/fase-d): documento de avance FASE D
- Migraciones: `202609070003_erp_phase_d_repairs_lifecycle.sql`,
  `202609070004_erp_phase_d_quote_responses_policy.sql`,
  `202609070005_erp_phase_d_respond_quote_fix.sql`
- Test: `erp_phase_d_repairs_lifecycle.test.sql` (`plan(30)`)

### Fase E — cierre backend + frontend real
Backend (fixes de `complete_pc_build`, verificados con `git show --stat`):
- `eb7a151` fix(erp): corrige `erp.complete_pc_build` (42P01 y 42702) — 2 archivos, +99:
  `202609070007_erp_phase_e_complete_pc_build_fix.sql`,
  `202609070008_erp_phase_e_complete_pc_build_ambiguity_fix.sql`
- `ad9d4e5` fix(erp): renombra `completion_id` → `v_completion_id` — 1 archivo, +50:
  `202609070009_erp_phase_e_complete_pc_build_completion_id_fix.sql`
- `7f6f91d` docs(erp): consolida avance y cierre de Fase E (`docs/AVANCE-FASE-E.md`, +119)
- pgTAP Phase E: `supabase/tests/database/erp_phase_e_pc_tradeins.test.sql:5` → `select plan(30)` ✔ 30/30
  (cubre H14 IMEI quarantine/fallback y H17 compatibilidad PC + `complete_pc_build` + wrapper atómico)

Frontend E (verificado con `git show --stat`):
- `d98e9e3` feat(erp): conecta workspace PC armadas a backend real — 2 archivos, +1187/−283
  (`apps/erp/src/features/pcbuilds/PcBuildsWorkspace.tsx`, `apps/erp/src/features/pcbuilds/api.ts`)
- `099b3de` feat(erp): conecta workspace canjes IMEI a backend real — 2 archivos, +1240/−343
  (`apps/erp/src/features/tradeins/TradeInsWorkspace.tsx`, `apps/erp/src/features/tradeins/api.ts`)

### Fase F — documentos, WhatsApp, settings, auditoría, finanzas
- `675593b` feat(erp): conecta documentos fiscales a backend real — 2 archivos, +883/−290
  (`documents/DocumentsWorkspace.tsx`, `documents/api.ts`)
- `2e0cc2c` feat(erp): conecta WhatsApp a backend real de comunicaciones — 2 archivos, +932/−255
  (`whatsapp/WhatsappWorkspace.tsx`, `whatsapp/api.ts`)
- `bc6029d` feat(erp): settings persistidos y Sistema sin mocks — 4 archivos, +579/−258
  (`system/SystemWorkspace.tsx`, `system/api.ts`,
  `202609070010_erp_system_settings.sql`, `erp_system_settings.test.sql` `plan(12)`)
- `0e54632` feat(erp): auditoría e integraciones sobre datos reales — 4 archivos, +716/−272
  (`audit/AuditWorkspace.tsx`, `audit/api.ts`,
  `integrations/IntegrationHealthWorkspace.tsx`, `integrations/api.ts`)
- `c021760` feat(erp): contabilidad y cuentas sin defaults truchos — 3 archivos, +256/−21
  (`finance/AccountingWorkspace.tsx`, `finance/AccountsWorkspace.tsx`, `finance/api.ts`)

### Fase G — grants, fulfill online, vistas, órdenes online, reportes, dashboard
- `6847b7a` feat(erp): grants de visibilidad operativa DLQ/auditoría — 2 archivos, +81
  (`202609070011_erp_ops_visibility_grants.sql`, `erp_ops_visibility.test.sql` `plan(10)`)
- `5506726` feat(erp): fulfill transaccional de órdenes online — 2 archivos, +432
  (`202609070012_erp_fulfill_online_order.sql`, `erp_fulfill_online_order.test.sql` `plan(24)`)
- `bbf0cfe` feat(erp): vistas de reportes IVA/balance/rentabilidad — 2 archivos, +271
  (`202609070013_erp_reporting_views.sql`, `erp_reporting_views.test.sql` `plan(22)`)
- `02d630e` feat(erp): órdenes online con fulfill transaccional — 2 archivos, +286/−90
  (`onlineorders/OnlineOrdersWorkspace.tsx`, `onlineorders/api.ts`)
- `d6a13a6` fix(erp): alinea órdenes online con `web_orders`/fulfillment reales — 2 archivos, +323/−156
  (mismos 2 archivos onlineorders)
- `48cc892` feat(erp): reportes y dashboard sobre datos reales — 4 archivos, +675/−241
  (`dashboard/DashboardOverview.tsx`, `finance/AccountingWorkspace.tsx`, `finance/api.ts`, `finance/types.ts`)
- `3ce94fe` fix(erp): dashboard lee `web_orders`/fulfillment reales — 1 archivo, +61/−9
  (`dashboard/DashboardOverview.tsx`) ← HEAD

### Suite pgTAP real (verificada, no la del borrador)
- `git ls-files "supabase/tests/database/*.test.sql"` → 17 archivos + `supabase/tests/erp_finance_accounting.test.sql` = **18 archivos** (el borrador decía 17).
- Medición real de corrida (`npx supabase test db`) → **1265 tests PASS** (el borrador decía 1215).
  Suma de `plan(N)` en los 18 archivos:
  133 (documents_communications) + 50 (finance_accounting) + 31 (foundation)
  + 24 (fulfill_online_order) + 77 (inventory_ledger) + 28 (master_data) + 10 (ops_visibility)
  + 244 (pc_tradeins_imei) + 14 (phase_b) + 12 (phase_c) + 30 (phase_d) + 30 (phase_e)
  + 85 (purchases_costs_pricing) + 250 (repairs_quotes_warranties) + 22 (reporting_views)
  + 146 (sales_cash_orders) + 67 (stock_cost_ledger) + 12 (system_settings) = 1265.
- Migraciones ERP en repo: 43 archivos `supabase/migrations/*erp*.sql` (incluye serie `erp5_*`,
  fases B–E `202609070001`–`202609070009`, sistema `...010`, grants `...011`, fulfill `...012`,
  vistas `...013`).

## 2. Decisiones diferidas con propuesta concreta

| # | Decisión diferida | Estado real hoy (verificado) | Propuesta concreta |
|---|---|---|---|
| (a) | ARCA real | Fiscal encolado/pendiente; nunca CAE inventado. `erp.record_fiscal_provider_result(...)` existe en `supabase/migrations/202608190009_erp_documents_communications.sql:497` y está restringida a `service_role` (líneas 698–699). Ningún flujo actual la invoca con datos reales. | Crear Edge Function Deno `issue-fiscal-document`: toma el `fiscal_request` pendiente, firma con certificado AFIP/ARCA del cliente, llama al WS de homologación (padrón + PV), invoca `erp.record_fiscal_provider_result` con CAE/vencimiento reales o error tipificado, y sube el PDF al bucket privado de Storage enlazado al documento. El workspace Documents ya lee ese estado; solo muestra "pendiente/encolado" hasta que la función responda. |
| (b) | WhatsApp Cloud API | `erp.queue_customer_message(...)` (misma migración `:523`, con validación de consentimiento/plantilla/variables en `:528`) encola + evento `queued`. Sin envío simulado: no existe worker que llame a Meta. | Crear Edge Function `send-whatsapp-message` + verificación del webhook (GET hub.verify_token) + handler POST que registra `record_provider_message_event` / `record_provider_webhook`. Worker (cron o cola) que toma outbox `queued`, llama a Cloud API con `template_version` + variables exactas, reintenta con backoff ante 5xx/rate-limit, y mueve a DLQ vía `move_integration_to_dead_letter` tras N intentos. El workspace WhatsApp ya refleja esos estados. |
| (c1) | `v_iva_compras.alicuota` NULL | Verificado en `supabase/migrations/202609070013_erp_reporting_views.sql:10-11,38` + comment `:114`: la línea de compra no registra alícuota, solo `tax_amount`. | Propuesta: agregar `tax_rate_percent` a `purchase_order_lines` (migración + backfill desde `tax_amount`/base donde sea determinable, NULL donde no), exponerla en `v_iva_compras`, y marcar el período de transición en UI ("alícuota no registrada en compras anteriores"). |
| (c2) | `margin` NULL sin recepciones | Verificado en `202609070013_erp_reporting_views.sql:14-16,94-105` + comment `:118`: costo promedio ponderado real de `purchase_receipt_lines`; sin recepciones, costo y margen NULL. | Propuesta: mantener NULL (no inventar costo) y sumar en UI el aviso ya documentado + opcional columna "último costo de compra" como referencia explícita, nunca mezclada con el margen. |
| (c3) | `repairRevenue = 0` | Verificado en `apps/erp/src/features/dashboard/DashboardOverview.tsx:403-404,408`: `public.repairs` no tiene columna de monto cobrado → ingresos = solo órdenes web efectivas + 0 reparaciones, con "Sin datos fuente" en UI. | Propuesta: agregar `billed_amount`/`paid_amount` a reparaciones (o leer cobros desde caja/ventas vinculadas por `repair_id`) y recién entonces sumar; hasta tanto, mantener el 0 explícito con el aviso. |
| (c4) | `decrement_stock` / `process_approved_order` no existen en migraciones | Verificado: `grep` en `supabase/migrations` → 0 coincidencias. Sí existen en `src/integrations/supabase/types.ts:451,477` (esquema `public`, storefront) y `decrement_stock` se invoca en `supabase/functions/mercadopago-webhook/index.ts:412`. `AGENTS.md:67` los lista como "Critical operations use RPCs", lo cual está desactualizado para el ERP (`erp.*`). | Propuesta: corregir `AGENTS.md:67` (aclarar que son RPCs del storefront `public.*`, no del ERP), y decidir puente explícito público→ERP o dejarlos separados; no crear stubs. |
| (c5) | eslint `no-explicit-any` preexistentes | Verificado: 18 coincidencias `: any` / `as any` en `apps/erp/src` fuera de las features nuevas E/F/G — `customers/CustomersWorkspace.tsx:91,106`, `repairs/RepairsWorkspace.tsx:623`, `repairs/api.ts:182,218,300,305,360,469,504`, `quotes/QuotesWorkspace.tsx:128,897`, `quotes/api.ts:95,99,117`, `purchases/PurchasesWorkspace.tsx:276`, `stock/StockWorkspace.tsx:161,163`. | Propuesta: tipar por módulo con los tipos generados (sin `any`) en una pasada dedicada de lint, empezando por `repairs/api.ts` y `quotes/api.ts`; no bloquear el cierre por deuda preexistente. |

## 3. Cómo verificar el entregable (comandos exactos)

Desde la raíz del repo (`package.json` verificado):

```bash
npm run db:reset
npm run db:test
npm run typecheck:erp
npm run lint
npm run build:erp
```

Qué hace cada uno (según `package.json` raíz y `apps/erp/package.json`):
- `npm run db:reset` → `supabase db reset` (aplica las 43 migraciones ERP locales desde cero).
- `npm run db:test` → `supabase test db` (corre los 18 archivos pgTAP; total 1265 tests, phase E `plan(30)`).
- `npm run typecheck:erp` → `npm run typecheck --workspace @nictech/erp` → `tsc --noEmit` en `apps/erp`.
- `npm run lint` → `eslint .` (los `no-explicit-any` citados en §2-c5 son preexistentes y están fuera
  de las features nuevas E/F/G).
- `npm run build:erp` → `npm run build --workspace @nictech/erp` → `vite build`.

Evidencia adicional ya en git (sin re-ejecutar nada externo):
- `git log --oneline -40` contiene los 16 hashes de E/F/G citados en §1.
- `git show --stat` por commit respalda cada conteo de archivos/inserciones.
- `git status --short` limpio al momento de verificar (solo faltaba crear este informe).
