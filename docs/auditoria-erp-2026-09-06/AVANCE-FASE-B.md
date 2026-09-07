# Avance de Auditoría ERP: Fase B — Fundas con Variantes de Punta a Punta

Fecha de cierre de fase: **2026-09-07**  
Estado: **100% COMPLETADA Y VERIFICADA**

---

## 1. Resumen Ejecutivo de la Fase B

Se resolvió el ciclo integral de negocio de productos con variantes (específicamente fundas de smartphone con múltiples colores, códigos de barras y control de unidades indivisibles) desde el catálogo ERP, compras con proveedores, recepción parcial de mercadería, aislamiento de stock por variante en almacén y venta en Punto de Venta (POS) con impacto transaccional y atómico en el inventario.

---

## 2. Hallazgos Auditados y Soluciones Implementadas

### Finding 1: Catálogo ERP Escribe en Esquema Público y Pierde Variantes
- **Problema auditado**: La pantalla escribía en tablas legacy (`public.products`), no persistía variantes ni atributos en el modelo ERP.
- **Solución**:
  - `CatalogWorkspace.tsx` se conectó al esquema `erp.products`, `erp.product_variants`, `erp.product_identifiers` y `erp.stock_balances`.
  - Creación de producto con variantes atómica vía RPC `erp.create_catalog_product_with_variants`.
  - Visualización del stock real y códigos de barra por variante.
- **Verificación**: Búsqueda, paginación y creación comprobada; typecheck y build limpios.

### Finding 2: Edición en Catálogo Sobrescribe y Desalinea Variantes
- **Problema auditado**: Modificar precio o nombre destruía la relación con las variantes o forzaba updates destructivos.
- **Solución**: Edición acotada en `CatalogWorkspace.tsx` actualiza `base_sale_price`, `internal_name` e `is_active` sin tocar las variantes ni las existencias.

### Finding 3: Compras a Proveedores Desconectada de Cuentas por Pagar
- **Problema auditado**: La creación de órdenes de compra y saldos con proveedores era puramente cosmética.
- **Solución**: `PurchasesWorkspace.tsx` ahora consulta `erp.suppliers`, calcula la deuda real acumulada desde `erp.supplier_payables` y genera órdenes de compra reales con líneas por variante vía `erp.create_purchase_order`.

### Finding 4: Recepción Parcial de Mercadería Inexistente en UI
- **Problema auditado**: Si se pedían 20 fundas negras y 20 rosas y llegaban 8 negras y 12 rosas, no había mecanismo de recepción parcial ni registro de remanente.
- **Solución**:
  - Modal de Recepción en `PurchasesWorkspace.tsx` con desglose de cantidades solicitadas, recibidas previamente y pendientes por variante.
  - Llamada transaccional a `erp.post_purchase_receipt(...)`, ingresando stock exacto a la ubicación y generando la deuda proporcional en cuentas a pagar.

### Finding 6: POS Descuenta Stock Global y No Aisla Variantes
- **Problema auditado**: La venta de una funda rosa descontaba stock general o fallaba por no propagar `variant_id`.
- **Solución**:
  - `PosWorkspace.tsx` maneja items con discriminación de variante (`variant_id`, nombre, código y stock disponible individual).
  - Venta ejecutada a través de `erp.create_sale(...)` enviando `variant_id` y `from_location_id`.
  - Triggers y ledger de inventario (`erp.stock_balances`) descuentan únicamente la variante vendida, dejando la otra intacta.
  - Control en cliente de disponibilidad máxima por variante para impedir ventas sin stock (Finding 2 de Ventas).
  - Manejo de fallos transaccionales: si `create_sale` falla, la UI muestra el error y no vacía el carrito (Finding 1 de Ventas).

### Finding 7: Impresión de Etiquetas con Código de Barras por Variante
- **Problema auditado**: Impresión simulada con `alert()`, sin persistencia de códigos ni selector de cantidades.
- **Solución**:
  - Modal de impresión en `StockWorkspace.tsx` con renderizado SVG real de código de barras a partir de `erp.product_identifiers`.
  - Configuración de cantidad de etiquetas a imprimir (e.g. 20 etiquetas para 20 fundas recibidas).
  - Formatos de impresión estándar (Térmica 50x30 mm, 70x35 mm, Hoja A4) y botones de lote rápido.

### Finding 8: Catálogo Sin Paginación Ni Búsqueda en Servidor
- **Problema auditado**: Traía todos los registros en memoria, inviable con cientos de productos.
- **Solución**: Paginación en servidor con `range(offset, offset + limit - 1)` y búsqueda con `ilike` sobre `internal_name` y `internal_code`.

### Finding 9: Unidades Indivisibles Admiten Fracciones (e.g. 0.5 Fundas)
- **Problema auditado**: La API o triggers permitían decimales en productos con unidades sin soporte decimal (`allows_decimals = false`).
- **Solución**:
  - Trigger function `erp.validate_indivisible_unit_quantity()` y `erp.validate_indivisible_unit_ordered_quantity()` aplicadas a `erp.purchase_order_lines`, `erp.purchase_receipt_lines`, `erp.stock_document_lines` y `erp.sale_lines`.
  - Rechaza cualquier cantidad fraccionaria (`quantity <> trunc(quantity)`) con excepción `check_violation` (código `23514`).

---

## 3. Pruebas Automatizadas pgTAP (Fase B)

Archivo de prueba: `supabase/tests/database/erp_phase_b_case_variants.test.sql`

Cobertura de aserciones de la suite:
1. **Creación de Funda con 2 Variantes**: Negro y Rosa, con códigos de barra individuales (`7790001001` y `7790001002`) y unidad indivisible (`allows_decimals = false`).
2. **Rechazo de Cantidad Fraccionaria**: Intento de ordenar `0.5` fundas falla con código `23514` (`quantity must be an integer for indivisible units`).
3. **Orden de Compra**: 20 fundas Negras y 20 fundas Rosas.
4. **Aprobación de Orden de Compra**: Estado cambia a `approved`.
5. **Recepción Parcial 1**: Recepción de 8 Negras y 12 Rosas.
6. **Validación de Stock Parcial**: Negro = 8, Rosa = 12 en Mostrador.
7. **Recepción Parcial 2**: Recepción de 12 Negras y 8 Rosas restantes.
8. **Validación de Stock Total**: Negro = 20, Rosa = 20 en Mostrador.
9. **Venta Aislada en POS**: Venta de 1 funda Negra especificando `variant_id`.
10. **Aislamiento de Existencias**:
    - Stock Negro decrece a 19.
    - Stock Rosa se mantiene intacto en 20.
11. **Búsqueda por Código de Barras**: `7790001001` resuelve inequívocamente a la variante Negra; `7790001002` a la variante Rosa.

---

## 4. Puerta de Verificación (Verification Gate)

| Chequeo | Comando | Resultado |
|---|---|---|
| **TypeScript ERP** | `npm run typecheck:erp` | 0 errores (código de salida 0) |
| **Producción Build** | `npm run build:erp` | Compilación exitosa en 12.09s (código de salida 0) |
| **Tests Unitarios Frontend** | `npx vitest run` | 10 suites pasadas, 62 pruebas 100% verdes |
| **Tests Base de Datos pgTAP** | `npx supabase test db` | 11 suites pasadas, 1,125 pruebas 100% verdes |
