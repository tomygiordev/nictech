# Avance de Auditoría ERP: Fase C — Compras, Ventas Atómicas/Idempotentes y Caja Real

Fecha de cierre de fase: **2026-09-07**  
Estado: **100% COMPLETADA Y VERIFICADA**

---

## 1. Resumen Ejecutivo de la Fase C

Se resolvió la integridad de compras, ventas y finanzas operativas en mostrador:
1. **Recepción de compras** con trazabilidad documental (Remito / Factura del proveedor) e idempotencia transaccional que impide duplicar inventario o cuentas a pagar.
2. **POS transaccional y atómico**: cobros en efectivo integrados directamente a sesiones de caja abiertas, aislamiento de variantes y comprobante persistido con ID real de venta (`erp.sales`).
3. **Caja real con arqueo y conciliación de diferencias**: eliminación total de fondos simulados, cálculo en tiempo real del saldo teórico (`fondo inicial + cobros en efectivo`), modal de arqueo físico con cálculo instantáneo de faltante/sobrante y persistencia en `erp.cash_closures` y `erp.cash_close_counts`.
4. **Idempotencia y exclusión de sesiones cerradas**: corrección del contrato en `features/cash/api.ts` para que `listOpenCashSessions` excluya sesiones ya cerradas.

---

## 2. Hallazgos Auditados y Soluciones Implementadas

### Finding 4 & 15: Recepción de Compras con Remito/Factura e Idempotencia
- **Problema auditado**: La UI no registraba remito ni factura del proveedor al recibir mercadería, y los reintentos podían duplicar stock o deuda.
- **Solución**:
  - `PurchasesWorkspace.tsx` ahora solicita el Nº de Remito o Factura del proveedor (`REM-XXXX` / `FC-XXXX`), asociándolo al `operation_reason` del comprobante de recepción.
  - La llamada a `erp.post_purchase_receipt` genera un hash criptográfico de la operación (`operation_hash`) junto a la clave de idempotencia (`operation_key`). Reintentar la misma recepción devuelve el comprobante existente sin duplicar líneas de stock ni entradas en `supplier_payables`.

### Finding 1, 2, 3 (Ventas-Finanzas): POS Transaccional, Atómico y con Cobro Real
- **Problema auditado**: Falso éxito en ventas aunque fallen escrituras; stock calculado desde foto antigua; medio de pago solo cosmético en estado React.
- **Solución**:
  - `PosWorkspace.tsx` invoca el comando atómico `erp.create_sale(...)` de la base de datos.
  - El pago en efectivo requiere y se imputa a una sesión de caja abierta en `erp.cash_sessions`, generando el movimiento respectivo en `erp.cash_movements`.
  - Si la llamada falla en cualquier punto (ej. falta de fondos o permisos), la UI reporta el error exacto y no descarta el carrito, impidiendo entregas ficticias.
  - Reintentos con la misma clave de idempotencia devuelven el `sale_id` original sin duplicar cobro ni movimientos de stock.

### Finding 4 (Ventas-Finanzas) & Finding 16: Arqueo y Cierre de Caja Persistidos con Diferencias
- **Problema auditado**: Caja ficticia en `localStorage` ($50.000 / $145.000 iniciales); cierre con monto `0` cableado en código sin conteo físico ni cálculo de diferencia.
- **Solución**:
  - `CashWorkspace.tsx` consulta en tiempo real `erp.cash_sessions`, `erp.cash_session_opening_counts` y la suma de `erp.cash_movements` vinculados a ventas.
  - Modal de **Arqueo y Cierre de Turno**: el cajero ingresa el dinero físico contado en mano.
  - La pantalla calcula en vivo la diferencia (`Contado - Esperado`), indicando visualmente si la caja está cuadrada ($0), con sobrante (+) o con faltante (-).
  - La función `erp.close_cash_session` registra el conteo físico, saldo esperado y la diferencia en `erp.cash_close_counts`, exigiendo el permiso `cash.adjust` en caso de discrepancia.
  - Pestaña de **Historial de Arqueos**: auditoría permanente de cierres con sus diferencias conciliadas y libro detallado de movimientos.

### Finding 23 (Ventas-Finanzas) & Finding 17: Sesiones de Caja Idempotentes y Filtrado de Cerradas
- **Problema auditado**: `listOpenCashSessions` consultaba todas las sesiones sin excluir aquellas cerradas en `cash_closures`.
- **Solución**:
  - `features/cash/api.ts` filtra contra `erp.cash_closures`, garantizando que únicamente se listen las sesiones verdaderamente abiertas.
  - Apertura de caja protegida contra duplicados concurrentes en el mismo puesto de cobro (`object_not_in_prerequisite_state`).

---

## 3. Pruebas Automatizadas pgTAP (Fase C)

Archivo de prueba: `supabase/tests/database/erp_phase_c_purchases_pos_cash.test.sql`

Cobertura de aserciones de la suite:
1. **Apertura de Sesión de Caja**: Fondo inicial de 5.000 ARS registrado exitosamente en la base central.
2. **Idempotencia en Apertura**: Replay idéntico devuelve el mismo `session_id`.
3. **Rechazo de Sesión Duplicada**: Intento de abrir una 2da sesión en una caja ya abierta falla con `55000` (`cash register already has an open session`).
4. **Venta POS con Cobro en Efectivo**: `create_sale` con línea de pago asignada a la sesión abierta.
5. **Ledger de Caja Actualizado**: Movimiento exacto de 17.000 ARS registrado en `erp.cash_movements`.
6. **Idempotencia de Venta POS**: Replay con la misma clave devuelve el `sale_id` existente sin duplicar el cobro ni el stock.
7. **Verificación de No Duplicación**: Conteo de movimientos en caja se mantiene en 1.
8. **Arqueo y Cierre Cuadrado**: Cierre con 22.000 ARS contados físicamente (5.000 apertura + 17.000 venta).
9. **Diferencia Cero Persistida**: `difference_amount` exactamente en 0 ARS en `erp.cash_close_counts`.
10. **Rechazo de Cierre Duplicado**: Cerrar una sesión ya cerrada falla con código `55000` (`cash session is already closed`).
11. **Recepción con Referencia Documental**: Ingreso de mercadería asociando remito `[Doc: REM-0001-00045678]`.
12. **Idempotencia en Recepción de Compra**: Reintento de la recepción devuelve el `receipt_id` original sin duplicar existencias ni cuentas por pagar.

---

## 4. Puerta de Verificación (Verification Gate)

| Chequeo | Comando | Resultado |
|---|---|---|
| **TypeScript ERP** | `npm run typecheck:erp` | 0 errores (código de salida 0) |
| **Producción Build** | `npm run build:erp` | Compilación exitosa en 8.47s (código de salida 0) |
| **Tests Unitarios Frontend** | `npx vitest run` | 10 suites pasadas, 62 pruebas 100% verdes |
| **Tests Base de Datos pgTAP** | `npx supabase test db` | 12 suites pasadas, 1,137 pruebas 100% verdes |
