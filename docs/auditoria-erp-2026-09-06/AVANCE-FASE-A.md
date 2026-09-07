# Avance y Evidencia de Verificación — FASE A: Unificación del Modelo de Persistencia ERP

**Fecha:** 7 de Septiembre de 2026  
**Estado FASE A:** COMPLETADA Y VERIFICADA  
**Siguiente Fase:** FASE B (Fundas con Variantes de Punta a Punta)

---

## 1. Objetivos Alcanzados en FASE A

De acuerdo con el plan maestro y los hallazgos de la auditoría (`informe-consolidado.md`, `seguridad-entrega.md`, `inventario-compras.md`), la FASE A requería:
1. Unificar el cliente Supabase del ERP en el esquema `erp`, sin fallbacks silenciosos a credenciales o URLs remotas.
2. Eliminar por completo el `localStorage` como mecanismo de persistencia operativa y los datos semilla `DEFAULT_*` simulados como reales.
3. Asegurar que ningún módulo simule éxito en escrituras fallidas y que todo módulo en desarrollo o simulador esté debidamente rotulado como tal (`[DEMO / En Desarrollo]`).
4. Reemplazar popups invasivos `alert()` por modales o alertas contextuales de UI.

---

## 2. Detalle de Archivos Modificados e Intervenciones

### 2.1 Conectividad y Autenticación
- **`apps/erp/src/lib/supabase.ts`**:
  - Cliente tipado con `SupabaseClient<any, "erp">`, esquema por defecto `"erp"`.
  - Validación estricta de variables de entorno: si no están definidas `VITE_SUPABASE_URL` o `VITE_SUPABASE_ANON_KEY`, lanza excepción descriptiva en lugar de conectar silenciosamente a un proyecto remoto.
- **`apps/erp/src/auth/ErpAuthProvider.tsx` & `ErpAccessGate.tsx`**:
  - Eliminado el bypass de sesión `dev-session-0000` hardcodeado.
  - Puerta de acceso con login real contra Supabase Auth y selector de sucursal (`erp.branches`).
  - Gestión de permisos y roles RBAC conectada al contexto de autenticación.

### 2.2 Purga de `localStorage` Operativo y Datos Semilla
- **`CustomersWorkspace.tsx`**:
  - Eliminado `DEFAULT_CUSTOMERS` y clave `localStorage.getItem("erp_customers_v1")`.
  - Conectado a tabla `erp.customers` (id, full_name, tax_id, email, phone, notes, is_active).
  - Manejo de estados de carga, error y lista vacía. Reemplazados `alert()` por `setFeedback()`.
- **`PurchasesWorkspace.tsx`**:
  - Eliminados `DEFAULT_PURCHASES` y `DEFAULT_SUPPLIERS`.
  - Conectado a tabla `erp.suppliers` (id, legal_name, tax_id, trade_category, payment_terms, contact_info).
  - Formulario de alta en base de datos central y modal de detalle de proveedor sin `alert()`.
- **`CashWorkspace.tsx`**:
  - Eliminado `DEFAULT_SESSIONS` (valores falsos de $50k y $145k) y clave `localStorage`.
  - Integración transaccional con `erp.cash_sessions`, `erp.cash_registers` y `erp.cash_closures` vía RPCs `open_cash_session` y `close_cash_session`.
- **`QuotesWorkspace.tsx`**:
  - Eliminado `DEFAULT_QUOTES` y `localStorage`.
  - Conectado a `erp.repair_quotes`. Rotulado con banner de `[Módulo en Desarrollo - FASE D]`.
- **`PcBuildsWorkspace.tsx`**:
  - Eliminado `DEFAULT_BUILDS` y `localStorage`.
  - Rotulado con banner explicativo de arquitectura `[Módulo DEMO / En Desarrollo - FASE E]`.
- **`TradeInsWorkspace.tsx`**:
  - Eliminado `DEFAULT_TRADE_INS` y `localStorage`.
  - Removido generador ficticio de IMEI con `Math.random()`, removidas etiquetas hardcodeadas "100% Limpios" y "Declaración Validada".
  - Rotulado con banner explicativo `[Módulo DEMO / En Desarrollo - FASE E]`.
- **`DocumentsWorkspace.tsx`**:
  - Eliminado `DEFAULT_DOCUMENTS` y `localStorage`.
  - Removido generador de CAE ficticio con `Math.random()` y afirmaciones de "100% Online ARCA".
  - Rotulado como `[Comprobantes No Fiscales / Remitos Internos]`.
- **`RepairsWorkspace.tsx`**:
  - Eliminados `DEFAULT_QC`, `DEFAULT_RMA` y claves `localStorage` (`erp_qc_protocols_v1`, `erp_rma_claims_v1`).
  - Reemplazados todos los `alert()` de inspección por modales visuales dedicados (`viewingProtocol`, `selectedClaim`).
- **`SystemWorkspace.tsx`**:
  - Eliminado `DEFAULT_USERS` y `localStorage`.
  - Conectado a `erp.profiles` y `erp.branches`.
- **`AuditWorkspace.tsx`**:
  - Eliminado `DEMO_AUDIT_LOGS` y falsas afirmaciones de hash SHA-256 estático.
  - Conectado a tabla central inmutable `erp.audit_events` con estados de carga y empty state.
- **`IntegrationHealthWorkspace.tsx` & `WhatsappWorkspace.tsx`**:
  - Rotulados explícitamente como `[Módulo DEMO / Simulador]` (Outbox y WhatsApp Cloud API).
  - Removida la simulación de entrega exitosa instantánea en producción.
- **`AccountingWorkspace.tsx`**:
  - Secciones de Rentabilidad e Informes Fiscales rotuladas como `[Módulo DEMO / Proyección - FASE G]`.
  - Reemplazados todos los `alert()` de exportación por descargas seguras de borradores no fiscales (`downloadDraftFile`).
- **`StockWorkspace.tsx` & `PosWorkspace.tsx`**:
  - Removidos multiplicadores ficticios de stock (`* 1.5`, `* 0.8`, `45 items, 110 units`).
  - Mostrador unificado con el depósito real y stock físico consolidado.
  - Agregada verificación estricta de `{ error }` en todas las operaciones sobre `products` e `inventory_movements`, evitando que fallos de RLS o integridad muestren falsos éxitos.

---

## 3. Evidencia de Verificación Técnica

### 3.1 Typecheck de TypeScript
```bash
$ npm run typecheck:erp
> @nictech/erp@0.1.0 typecheck
> tsc --noEmit
# Salida: Código 0 (0 errores)
```

### 3.2 Build de Producción
```bash
$ npm run build:erp
> vite build
✓ 2507 modules transformed.
dist/index.html    0.80 kB
dist/assets/...
✓ built in 7.86s
# Salida: Código 0 (0 errores)
```

### 3.3 Suites de Test Unitarias y de Integración (Vitest)
```bash
$ npx vitest run
 Test Files  10 passed (10)
      Tests  62 passed (62)
   Duration  14.01s
# Salida: Código 0 (62/62 tests pasaron)
```
Suites ejecutadas:
- `src/utils/generateTrackingCode.test.ts` (4 tests)
- `apps/erp/src/components/erp/WorkspaceModuleTabs.test.tsx` (3 tests)
- `apps/erp/src/features/finance/FinanceWorkspace.test.tsx` (8 tests)
- `src/lib/utils.test.ts` (6 tests)
- `packages/domain/src/modules.test.ts` (7 tests)
- `apps/erp/src/lib/supabaseConfig.test.ts` (3 tests)
- `src/contexts/CartContext.test.tsx` (20 tests)
- `packages/domain/src/permissions.test.ts` (3 tests)
- `apps/erp/src/App.test.tsx` (6 tests)
- `apps/erp/src/lib/supabase.test.ts` (2 tests)

### 3.4 Suites de Base de Datos pgTAP en Supabase Local
```bash
$ npx supabase test db
Connecting to local database...
/nictech/supabase/tests/database/erp_documents_communications.test.sql ... ok
/nictech/supabase/tests/database/erp_foundation.test.sql ................. ok
/nictech/supabase/tests/database/erp_inventory_ledger.test.sql ........... ok
/nictech/supabase/tests/database/erp_master_data.test.sql ................ ok
/nictech/supabase/tests/database/erp_pc_tradeins_imei.test.sql ........... ok
/nictech/supabase/tests/database/erp_purchases_costs_pricing.test.sql .... ok
/nictech/supabase/tests/database/erp_repairs_quotes_warranties.test.sql .. ok
/nictech/supabase/tests/database/erp_sales_cash_orders.test.sql .......... ok
/nictech/supabase/tests/database/erp_stock_cost_ledger.test.sql .......... ok
/nictech/supabase/tests/erp_finance_accounting.test.sql .................. ok
All tests successful.
Files=10, Tests=1111,  5 wallclock secs
Result: PASS
```

### 3.5 Verificación de `localStorage` y `alert()`
- Búsqueda en `apps/erp/src` de llamadas a `alert(`: **0 resultados**.
- Búsqueda en `apps/erp/src` de llamadas a `localStorage`: **1 resultado** (únicamente la persistencia de tokens de sesión en `apps/erp/src/lib/supabase.ts`, requerida por Supabase Auth). Cero persistencia operativa en `localStorage`.

---

## 4. Conclusión FASE A y Transición a FASE B

Con todos los criterios de la FASE A cumplidos y las pruebas en verde, el sistema se encuentra limpio de simulaciones engañosas y desacoplado del `localStorage`.

El trabajo procede inmediatamente a la **FASE B**:
> **FASE B**: Fundas con variantes de punta a punta (catálogo → compra → recepción parcial → stock por variante → venta en POS / reparación).
