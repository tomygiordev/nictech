# AVANCE Y CIERRE — FASE E (PC armadas + Canjes IMEI)

Branch: `dev/erp`. Documento de consolidación con evidencia verificada en git/migraciones.
Fase E arranca en `9f6eb7e` (migración H14/H17, vistas overview, RPCs y pgTAP WIP 27/30) y se
cierra con los fixes 007–009 más los dos workspaces conectados a backend real.

## 1. Migraciones 007 / 008 / 009 — fixes de `erp.complete_pc_build`

Función definida originalmente en `202608190008_erp_pc_tradeins_imei.sql:592-631`.
Los 3 tests que fallaban (27–29: completion de PC armada, estado `completed` y serie en el
overview) caían por errores SQL encadenados dentro de esa función.

### 007 — `202609070007_erp_phase_e_complete_pc_build_fix.sql` (commit `eb7a151`)
- **Error:** `42P01` (missing FROM-clause). El cuerpo referenciaba
  `complete_pc_build.warranty_snapshot` (línea 618 del original) y
  `complete_pc_build.completion_id` (línea 629) como si fueran `tabla.columna`.
- **Causa raíz (2 líneas):** dentro de sentencias SQL Postgres no resuelve
  `nombre_de_funcion.columna`; lo interpreta como rango de tabla inexistente y responde 42P01.
- **Fix:** copia idéntica de la función salvo `warranty_snapshot` pelado (parámetro) y
  `completion_id` pelado (variable local del `DECLARE`).

### 008 — `202609070008_erp_phase_e_complete_pc_build_ambiguity_fix.sql` (commit `eb7a151`)
- **Error:** `42702` (ambigüedad) en el `CASE` del `INSERT...SELECT` a `pc_component_lineage`.
- **Causa raíz (2 líneas):** el parámetro se llama igual que la columna
  `erp.pc_build_components.warranty_snapshot` (alias `c` en el `SELECT`); el nombre pelado
  es ambiguo entre parámetro y columna.
- **Fix:** declara `v_warranty_snapshot jsonb`, la inicializa al inicio del `BEGIN`
  (`v_warranty_snapshot := warranty_snapshot`, sin tablas en scope → resuelve al parámetro)
  y el `CASE` usa el alias. Firma, permisos y lógica intactos.

### 009 — `202609070009_erp_phase_e_complete_pc_build_completion_id_fix.sql` (commit `ad9d4e5`)
- **Error:** `42702` residual en el `IF` de verificación post-`INSERT`
  (`l.completion_id = completion_id`).
- **Causa raíz (2 líneas):** la variable local `completion_id` colisiona con la columna
  `erp.pc_component_lineage.completion_id` cuando hay alias de tabla (`l`) en scope.
  (El `INSERT...SELECT` no fallaba porque `pc_build_components` no tiene columna
  `completion_id` y el nombre pelado resolvía a la variable.)
- **Fix:** la variable pasa a `v_completion_id` en `DECLARE`, `RETURNING INTO`, lista del
  `SELECT`, `IF` y `complete_stage7_command`; la columna del `INSERT` y `l.completion_id`
  quedan intactas. Firma y lógica intactas.

## 2. pgTAP Fase E + suite completa

- `supabase/tests/database/erp_phase_e_pc_tradeins.test.sql` → `select plan(30);` (línea 5),
  30/30 tras 007–009 (antes 27/30 según `9f6eb7e` y cuerpo de `eb7a151`/`ad9d4e5`).
- Suite completa: 13 archivos, `plan()` verificado uno por uno en git, suma **1147/1147**:

| Archivo | plan() |
|---|---|
| `erp_documents_communications.test.sql` | 133 |
| `erp_foundation.test.sql` | 31 |
| `erp_inventory_ledger.test.sql` | 77 |
| `erp_master_data.test.sql` | 28 |
| `erp_pc_tradeins_imei.test.sql` | 244 |
| `erp_phase_b_case_variants.test.sql` | 14 |
| `erp_phase_c_purchases_pos_cash.test.sql` | 12 |
| `erp_phase_d_repairs_lifecycle.test.sql` | 30 |
| `erp_phase_e_pc_tradeins.test.sql` | 30 |
| `erp_purchases_costs_pricing.test.sql` | 85 |
| `erp_repairs_quotes_warranties.test.sql` | 250 |
| `erp_sales_cash_orders.test.sql` | 146 |
| `erp_stock_cost_ledger.test.sql` | 67 |
| **Total** | **1147** |

## 3. Frontend — workspaces conectados a backend real

### PC armadas (commit `d98e9e3`)
- `apps/erp/src/features/pcbuilds/api.ts` (289 líneas, nuevo) + `PcBuildsWorkspace.tsx`
  reescrito (flujo secuencial revisión → compatibilidad → reserva → test → complete; tabla
  ID/Cliente/Título/Costo/Estado/Compatibilidad con búsqueda; sin delete).
- **Vista:** `pc_build_projects_overview` (único `.from()` del módulo).
- **RPCs (7, nombres exactos):** `create_pc_build_atomic`, `create_pc_build_revision`,
  `record_pc_compatibility_run`, `reserve_pc_build_components`, `record_pc_test_run`,
  `complete_pc_build`, `get_pc_build_costs`.
- Wrappers exportados: `listPcBuildProjects`, `createPcBuildAtomic`, `createPcBuildRevision`,
  `recordPcCompatibilityRun`, `reservePcBuildComponents`, `recordPcTestRun`, `completePcBuild`,
  `getPcBuildCosts`. Patrón supabase+guard+from/rpc sin prefijo `erp`, operation keys
  idempotentes. Elimina el DEMO previo (banner, feedback simulado, estados
  `assembly`/`benchmarking`/`ready` inexistentes, `priceArs` sin costo real).

### Canjes IMEI (commit `099b3de`)
- `apps/erp/src/features/tradeins/api.ts` (371 líneas, nuevo) + `TradeInsWorkspace.tsx`
  reescrito (form de recepción con validación IMEI `^[0-9]{14,16}$`, stepper con guards
  procedencia → IMEI → tasación → liberación → pago, tabla
  ID/Cliente/Producto/IMEI-Serie/Etapa/Valores, KPIs reales; sin deletes ni `dollar_settings`).
- **Vista:** `trade_ins_overview` (único `.from()` del módulo).
- **RPCs (11, nombres exactos):** `intake_trade_in_direct`, `review_trade_in_provenance`,
  `request_trade_in_imei_check`, `record_trade_in_imei_manual_fallback`,
  `create_trade_in_evaluation`, `review_trade_in_evaluation`, `record_trade_in_refurbishment`,
  `release_trade_in_to_stock`, `apply_trade_in_sale_payment`, `reverse_trade_in_sale_payment`,
  `get_trade_in_costs`.
- Wrappers exportados: `listTradeIns`, `intakeTradeInDirect`, `reviewTradeInProvenance`,
  `requestTradeInImeiCheck`, `recordTradeInImeiManualFallback`, `createTradeInEvaluation`,
  `reviewTradeInEvaluation`, `recordTradeInRefurbishment`, `releaseTradeInToStock`,
  `applyTradeInSalePayment`, `reverseTradeInSalePayment`, `getTradeInCosts`
  (+ helpers `isTradeInRejected`, `isImeiVerified`). Elimina el DEMO previo (banner demo,
  dólar hardcodeado 1250, heurística mock de declaración, `STATUS_MAP` con `rejected`
  inexistente).

## 4. Estado F/G pendiente

- **OnlineOrders sin backend real:** `apps/erp/src/features/onlineorders/` contiene solo
  `OnlineOrdersWorkspace.tsx`; no existe `api.ts` (a diferencia de cash/pos/documents/whatsapp,
  que sí lo tienen). Falta reclamo de pedidos e-commerce contra `orders`/MercadoPago.
- **Accounting DEMO Fase G:** `AccountingWorkspace.tsx` tiene banners
  `[Módulo DEMO / Proyección - FASE G]` (rentabilidad/márgenes/ticket) y
  `[Módulo DEMO / Informes Fiscales - FASE G]`; exporta borradores
  (`libro_iva_ventas_borrador.txt`, `balance_sumas_saldos_borrador.csv`,
  `estado_resultados_borrador.txt`, `rotacion_stock_borrador.csv`). Falta cálculo dinámico
  sobre asientos e integración ARCA/períodos cerrados.
- **IntegrationHealth simulado:** `IntegrationHealthWorkspace.tsx` usa `DEMO_OUTBOX` local
  (línea 50) con banner `[Módulo DEMO / Simulador de Integraciones]` (línea 81); los eventos
  de cola no consultan el outbox transaccional real ni envían tráfico a proveedores.
- **WhatsApp con fallback pendiente:** `2e0cc2c` conecta bandeja/mensajes/consentimiento
  (`queue_customer_message`, `record_communication_consent`, `assign_conversation`) pero
  conserva el link `wa.me` como fallback; falta el envío real por proveedor.
- **Documentos sin CAE real:** `675593b` expone `issue_document` / `void_document` /
  `request_fiscal_issuance` con "estado fiscal real sin inventar CAE"; falta la integración
  ARCA que devuelva CAE fiscal válido.
