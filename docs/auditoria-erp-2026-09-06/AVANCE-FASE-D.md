# Avance de Auditoría ERP: Fase D — Taller, Reparaciones y Ciclo de Vida de Servicio

Fecha de cierre de fase: **2026-09-07**  
Estado: **100% COMPLETADA Y VERIFICADA**

---

## 1. Resumen Ejecutivo de la Fase D

Se resolvió la integridad operativa del taller y servicio técnico de punta a punta:
1. **Padrón unificado cliente → equipo → órdenes (H04)**: Eliminación del desacople donde la reparación capturaba clientes como texto plano. Alta atómica de equipo del cliente (`erp.customer_equipments`) y orden de reparación numerada (`erp.repair_orders`) con tracking code real. Enriquecimiento del directorio de clientes (`CustomersWorkspace.tsx`) con recuento y lista en tiempo real de reparaciones activas e historial de compras.
2. **Compuerta de Control de Calidad (QC) y Entrega Formal (H05)**: Prohibición absoluta de marcar "Finalizado" o entregar sin protocolo de pruebas ejecutado y aprobado. Validación técnica de checklist de ingreso/egreso con resultados binarios (`pass`/`fail`). Entrega formal inmutable (`erp.deliver_repair_order`) que registra receptor, firma/DNI, fecha efectiva y genera automáticamente póliza de garantía.
3. **Presupuestos Versionados con Aceptación Explícita y WhatsApp seguro (H06, H20, H21, H22)**: Presupuestos formales con líneas detalladas (repuestos, mano de obra, conceptos libres) y congelamiento de costos en base de datos. Token firmado de respuesta. Registro formal de la decisión del cliente ("Aprobado" / "Rechazado") mediante `respond_quote_direct`. Envío por WhatsApp sin degradar el estado comercial aprobado ni inventar confirmaciones inexistentes. Formateo civil de fechas sin desfases de huso horario.
4. **Consumo Real de Repuestos de Inventario (H07)**: La etapa de repuestos deja de ser un rótulo cosmético. Implementación de `erp.consume_repair_part_direct` que reserva y consume componentes del catálogo, generando documentos de stock y debitando costos según promedio ponderado (WAC) o unidad serializada.
5. **Garantías y Reclamos RMA Trazables (H08)**: Las garantías derivan automáticamente de las entregas formales con póliza y plazo de vigencia. Los reclamos técnicos (`open_warranty_claim`) se generan con código formal `WC-XXXX-XXXX` y auditan el reclamo sin alterar la orden original.
6. **Integridad SQL Corregida (H15, H16)**:
   - Corrección en `erp.record_trade_in_refurbishment` para referenciar la tabla autoritativa `erp.repair_deliveries` en vez de una tabla inexistente.
   - La función `erp.repair_latest_final_test_passes` invalida de inmediato la elegibilidad de entrega si se consume o revierte algún repuesto con posterioridad al último control de calidad.
   - Bloqueo de alteración de repuestos en órdenes ya entregadas (`55000`).

---

## 2. Hallazgos Auditados y Soluciones Implementadas

### Finding H04: Padrón de Clientes alimenta Ingreso de Taller
- **Problema auditado**: La reparación capturaba texto plano sin seleccionar cliente persistido ni equipo. En la ficha de cliente los contadores de reparaciones y compras eran 0 o fijos.
- **Solución**:
  - `RepairsWorkspace.tsx` permite seleccionar clientes activos del padrón o crearlos atómicamente.
  - La función `erp.intake_repair_order` crea el equipo en `erp.customer_equipments` y la orden numerada en `erp.repair_orders` con clave de idempotencia.
  - `CustomersWorkspace.tsx` consulta `repair_orders_overview` y `sales` para computar `activeRepairs`, compras completadas y gasto acumulado real, mostrando la lista de órdenes en la ficha del cliente.

### Finding H05 & H16: Control de Calidad Obligatorio antes de Entrega
- **Problema auditado**: Se podía saltar a "Finalizado" sin pruebas técnicas; el QC vivía en `localStorage` con checkboxes en `true` por defecto; cambiar repuestos post-QC no exigía nuevo test.
- **Solución**:
  - Plantillas de prueba dinámicas (`repair_test_template_versions`) cargadas desde DB.
  - Los ítems inician pendientes y exigen marcar individualmente `pass` o `fail`.
  - La entrega (`deliver_repair_order`) verifica `repair_latest_final_test_passes`. Si falta QC o hay ítems fallados, rechaza con código `55000`.
  - Si se consume o revierte un repuesto tras un QC aprobado, la elegibilidad de entrega queda invalidada hasta repetir y aprobar un nuevo control de calidad.

### Finding H06, H20, H21, H22: Presupuestos Comerciales Versionados
- **Problema auditado**: Importes globales sin líneas ni versiones; WhatsApp degradaba aprobaciones a "enviado"; fechas civiles se atrasaban 1 día por zona horaria UTC.
- **Solución**:
  - `QuotesWorkspace.tsx` integrado con `apps/erp/src/features/quotes/api.ts`.
  - Creación de versiones con líneas detalladas (producto, servicio, concepto libre), cálculo de subtotal e IVA.
  - Generación de token firmado (`issue_repair_quote`) y registro formal de respuesta del cliente (`respond_quote_direct`).
  - Compartir por WhatsApp preserva el estado comercial (no degrada aprobaciones).
  - Corrección en `formatDate` (`formatters.ts`) para tratar `YYYY-MM-DD` como fecha civil estricta sin desfase horario.

### Finding H07: Consumo Transaccional de Repuestos
- **Problema auditado**: "Repuestos" era solo un estado de texto sin movimiento físico ni costo.
- **Solución**:
  - Función atómica `erp.consume_repair_part_direct` que reserva y descuenta existencias del almacén en un único paso auditable.
  - Historial de repuestos consumidos y revertidos con costo unitario congelado.

### Finding H08: Pólizas de Garantía y Reclamos RMA
- **Problema auditado**: Garantías ficticias desconectadas de entregas reales; reclamos sin validación de vigencia.
- **Solución**:
  - `erp.deliver_repair_order` abre automáticamente la garantía oficial (`repair_warranties`) con vigencia calculada.
  - Modal de reclamos RMA (`open_warranty_claim`) valida póliza activa y genera reclamo inmutable con prefijo `WC-`.

### Finding H15: Corrección de Referencia en SQL
- **Problema auditado**: `record_trade_in_refurbishment` consultaba `erp.repair_delivery_events` (tabla inexistente).
- **Solución**:
  - Migración `202609070003` corrigió la consulta hacia `erp.repair_deliveries`.

---

## 3. Pruebas Automatizadas pgTAP (Fase D)

Archivo de prueba: `supabase/tests/database/erp_phase_d_repairs_lifecycle.test.sql`  
Total de aserciones de la suite: **30 pruebas (100% pasando)**.

Aserciones clave verificadas:
1. `erp.intake_repair_order` genera equipo del cliente y orden de reparación numerada atómicamente.
2. Estado inicial de la orden es `received`.
3. Transición de estado `received` -> `diagnosis`.
4. Transición de estado `diagnosis` -> `repair`.
5. Consumo directo de repuesto (`consume_repair_part_direct`) genera documento de stock y descuenta inventario.
6. Intento de entrega antes de control de calidad es rechazado con error `55000` (`delivery requires a passing final repair test`).
7. Control de calidad con ítems fallados es rechazado por la compuerta de entrega (`55000`).
8. Control de calidad aprobado habilita la elegibilidad de entrega.
9. **Verificación H16**: Consumo de un repuesto posterior al QC aprobado invalida inmediatamente la elegibilidad de entrega (`55000`).
10. Re-test completo aprobado restaura la elegibilidad de entrega.
11. Creación de presupuesto versionado con líneas de repuestos y mano de obra (`create_repair_quote_version`).
12. Emisión formal de presupuesto con token firmado.
13. Aprobación formal de presupuesto por el cliente (`respond_quote_direct`).
14. Entrega formal del equipo (`deliver_repair_order`) registra receptor, finaliza orden y abre garantía oficial.
15. **Verificación H16**: Intento de alterar o consumir repuestos en una orden ya entregada es rechazado con `55000`.
16. Apertura de reclamo de garantía RMA (`open_warranty_claim`) genera reclamo formal con código `WC-%`.
17. Vista `erp.repair_orders_overview` proyecta fielmente datos agregados de cliente, equipo, QC, presupuestos y garantía.

---

## 4. Puerta de Verificación (Verification Gate)

| Chequeo | Comando | Resultado |
|---|---|---|
| **TypeScript ERP** | `npm run typecheck:erp` | 0 errores (código de salida 0) |
| **Producción Build** | `npm run build:erp` | Compilación exitosa en 7.40s (código de salida 0) |
| **Tests Unitarios Frontend** | `npx vitest run` | 10 suites pasadas, 62 pruebas 100% verdes |
| **Tests Base de Datos pgTAP** | `npx supabase test db` | 13 suites pasadas, 1,167 pruebas 100% verdes |
