# Informe consolidado — Auditoría ERP (continuación 2026-09-07)

Fecha: **2026-09-07**.
Modalidad: **revisión estática, sin runtime**. No se aplicaron correcciones, no se tocó base de datos ni sistemas remotos. Solo documentación.
Evidencia histórica separada en `recuperacion-chat-codex.md` y `evidencia/`. Este informe consolida los cuatro informes por área sin re-ejecutar verificaciones.

## Veredicto

**El ERP no está listo para entrega operativa.** El patrón dominante es el mismo que dejó la auditoría Codex interrumpida el 2026-09-06: pantallas que afirman operaciones exitosas mientras persisten en `localStorage`, usan datos de demostración o escriben en tablas del contrato anterior sin pasar por los comandos transaccionales del ERP. Migrar Supabase por sí solo no cierra esas desconexiones.

No se clasifica ningún P0 (no se constató incidente activo, explotación ni destrucción de datos). Los P1 listados abajo bloquean el uso de las capacidades afectadas como operaciones reales.

## Documentos de la continuación (todo lo encontrado vive aquí)

- [Recuperación del chat Codex](recuperacion-chat-codex.md) — directiva, fuente, último mensaje visible, límites.
- [Inventario y compras](inventario-compras.md) — 5 P1 + 4 P2 + 3 riesgos condicionados.
- [Ventas y finanzas](ventas-finanzas.md) — 15 P1 + 8 P2.
- [Reparaciones y clientes](reparaciones-clientes.md) — 17 P1 + 8 P2.
- [Seguridad y entrega](seguridad-entrega.md) — 11 P1 + 5 P2 (H16 documentación/entrega).
- `evidencia/` — estado-inicial.txt, typecheck.log, build.log, eslint.log, vitest.log, persistencia-ui.txt (históricos del 2026-09-06).

## Bloqueantes P1 por área (resumen; el detalle con archivo:línea está en cada informe)

### Inventario, catálogo, compras (detalle en inventario-compras.md)

1. Catálogo/stock operan sobre contrato anterior (`products`, `inventory_movements`), no sobre `erp.products` / `erp.stock_movements` / `erp.stock_balances`; cliente sin `db.schema: "erp"`.
2. Sin identificación operativa de variantes en catálogo, stock ni compras, aunque el SQL sí define variantes.
3. Compras y proveedores en `localStorage` con datos ficticios presentados como operativos; "Al día" sin conciliación real.
4. Sin recepción (parcial/total) desde la UI; el backend `erp.post_purchase_receipt` existe pero no se invoca.
5. Stock confirma éxito aunque fallen escrituras (errores `{ error }` no inspeccionados); lectura fallida se presenta como "sin movimientos".
- Riesgos condicionados (requieren DDL desplegado del contrato anterior para cerrar): pérdida de actualizaciones / operación partida, saldo-historial incompatibles, edición de precios que reescribe stock.

### Ventas, caja, finanzas (detalle en ventas-finanzas.md)

1. POS declara venta exitosa aunque fallen escrituras; escrituras parciales por artículo.
2. POS calcula stock desde foto antigua (`Math.max(0, stock - qty)`), sin consulta fresca ni decremento condicionado; sobreventa y pérdida de actualizaciones.
3. POS montado no usa `createSale` ERP ni conserva cobro (medio de pago solo en ticket React, número aleatorio sin unicidad).
4. Caja ficticia en `localStorage` ($50.000/$145.000 iniciales); sin ledger ni arqueo real.
5. APIs financieras sin `.schema("erp")` aunque los objetos viven en `erp`.
6. Formularios de financiación/cobro/asiento/conciliación bloqueados por sucursales `dev-branch-*` inválidas y `branchId` sin inicializar.
7. Libro diario no integrado automáticamente con hechos operativos (`post_erp_source_event` existe pero sin invocadores productivos).
8. Cuentas corrientes no cobra la deuda de una venta ERP normal (contratos vs `customer_receivables`).
9. Pedidos online mezcla pago y logística en `orders.status`; webhook sobrescribe el mismo campo.
10. Webhook marca `stock_decremented=true` antes de completar salidas; fallo intermedio deja stock incompleto sin recuperación.
11. Rentabilidad e informes fiscales con cifras literales; exportaciones solo `alert()`.
12. Dashboard con KPI y gráfico inconsistentes entre sí; posible doble conteo omnicanal.
13. SQL permite doble asiento del mismo evento fuente bajo concurrencia (`on conflict do nothing` no revierte el segundo asiento).
14. SQL de despacho bloquea la entrega posterior (`fulfilled` antes de `delivered`).
15. Sin circuito operable de devolución completa entre pantallas y backend.

### Reparaciones, clientes y módulos asociados (detalle en reparaciones-clientes.md)

- H01: CAE/autorización fabricados con `Math.random()`, presentados como "emitido y autorizado" / ARCA.
- H02: canje inventa IMEI si vacío y certifica `imeiStatus: "clear"`, "100% Limpios", "Declaración Firmada y Validada" constantes.
- H03: siete registros operativos en `localStorage` sin aislamiento (clientes, presupuestos, QC, RMA, PC, canjes, documentos); logout no los limpia.
- H04: padrón de clientes no alimenta el ingreso de reparación (sin `customer_id`/`equipment_id`).
- H05: taller permite "Finalizado" sin QC y no registra entrega (retiro efectivo).
- H06: presupuesto sin aceptación real ni vínculo con la reparación; importe editable confundible con acuerdo.
- H07: "Repuestos" es estado, no operación de inventario (sin reserva/consumo).
- H08: garantías/RMA sin pólizas reales ni resolución ("Pólizas Emitidas: 124", "Tasa 1.2%" constantes; "Ver Póliza" es `alert`).
- H09: PC "Listo/Testeado" sin compatibilidad, componentes reales ni pruebas.
- H10: "Liberado a stock" / "Aplicado a venta" de canjes son etiquetas locales (sin unidad, pago ni venta).
- H11: WhatsApp no envía (solo estado React) y pierde mensajes al cambiar de hilo; "Conectado" no acreditado.
- H12: cliente Supabase con fallback remoto implícito y `supabaseConfigError` siempre `null`.
- H13: contexto/permisos frontend no corresponden al contrato ERP (`get_current_erp_context` sin esquema; `app_metadata.permissions` vs RBAC DB; mock DEV).
- H14 (SQL): liberación de canjes admite IMEI sin resultado (`NULL NOT IN (...)` no rechaza); fallback manual con el mismo patrón.
- H15 (SQL): reacondicionamiento referencia `erp.repair_delivery_events` no declarada (la tabla es `erp.repair_deliveries`).
- H16 (SQL): cambiar repuestos tras el QC no invalida elegibilidad de entrega.
- H17 (SQL): revisión de PC con referencias ambiguas producto/variante.
- P2 H18–H25: logs no atómicos/mezclados, numeración/anulación/archivo no reales, envío que degrada aprobación, importes/validez/cotización sin controles, fechas off-by-one por zona horaria, IDs aleatorios colisionables, `JSON.parse` sin validación, tests que no acreditan flujos.

### Seguridad y entrega (detalle en seguridad-entrega.md)

- H01: asignación de roles puede omitir protección de sensibles (RLS oculta permisos al `NOT EXISTS`).
- H02: `ensure_open_period` sin cierre por revocación de esquema; riesgo condicionado a ACL/ defaults de instalación, no explotación comprobada.
- H03: cliente conecta a remoto sin configuración explícita.
- H04: contexto y finanzas consultan `public`, contratos en `erp`.
- H05: bootstrap DB no produce permisos que exige la UI; falta ingreso ERP.
- H06: bloqueo de instalación limpia (rename de args vía `CREATE OR REPLACE` en 004 antes del `DROP` de 005).
- H07: sistema simula altas/bajas/RBAC/MFA/timeout.
- H08: auditoría con eventos fijos presentada como registro criptográfico verificado.
- H09: salud de integraciones/reintentos sin backend.
- H10: documentos con CAE aleatorio declarado autorizado (dependencia fiscal).
- H11: POS/stock anuncian éxito sin operación íntegra.
- P2 H12–H15 + H16: modo DEV con mock, denegación de sucursal neutralizada, datos locales sin aislamiento, finanzas con errores ocultos e IDs inválidos, documentación que acredita funciones no demostradas.

## Fundas con variantes: estado

**No operativo en las pantallas auditadas.** Sin selección/alta/movimiento por `variant_id`, sin identificadores escaneables por combinación, sin recepción parcial por variante, sin reserva/consumo ligado a reparación. El modelo SQL (variantes, recepción parcial, reservas, stock disponible) existe pero no lo consumen estas pantallas. Criterio mínimo: recibir 3 rosas mueve solo su saldo; descontar 1 negra no toca el rosa; cada línea conserva `product_id` + `variant_id`.

## Controles reales que sí existen (no llamar demo a todo)

- Compras: proveedor válido/activo, variante del producto, recepción aprobada, parciales sin exceso, lock + idempotencia, gastos/costo/deuda en el recibo, puente de costos por trigger.
- Inventario: stock disponible con bloqueo y reservas; negativo solo con permiso + ubicación habilitada.
- Ventas: lock + clave/hash, validación matemática de línea, bloqueo para cobro, cierre coordinado, cancelación total con compensaciones, triggers/auditoría, costo enlazado.
- Reparaciones/documentos/canjes: procedimientos avanzados declarados (equipos, estados, presupuestos versionados, repuestos, entrega, garantías, PC, IMEI, documento interno, solicitud/resultado fiscal, consentimiento/cola) — pero sin consumidores en las pantallas y con defectos H14–H17 pendientes.
- Fundación: tenant por perfil, `has_permission` con vigencia/deny/sucursal (reloj corregido en 012), FK compuestas, auditoría append-only con RLS, secretos separados; con defectos H01/H02/H13 y observación de `organizations.is_active` sin semántica probada.

## Verificación pendiente (no afirmable con revisión estática)

Migraciones aplicadas, pgTAP ejecutado, RLS del contrato anterior, `decrement_stock` y triggers `public`, ACL efectivas (`has_function_privilege`, llamada negativa), E2E en navegador, venta/caja/stock/cobro integrados, reparación completa, recepción de compras, fiscal/WhatsApp/impresión reales, backup/restore, despliegue. Puertas local→remoto en seguridad-entrega.md (todas bloqueadas o no acreditadas).

## Criterios de aceptación para entrega

1. Cada operación confirmada corresponde a un hecho persistido central, consultable tras recargar y desde otro navegador; entorno sin datos se muestra vacío, sin demos.
2. Venta/cobro/stock/caja/contabilidad atómicos e idempotentes; fallo inducido deja cero efectos parciales y conserva operación recuperable; nunca éxito por terminar un bucle.
3. Caja persistente con apertura, movimientos vinculados a pagos, conteo de cierre y diferencia; sin saldos demo.
4. Recepción por línea/variante/ubicación con pendientes, costos/gastos y deuda ligados al recibo; reintento sin duplicar.
5. Reparación con identidad cliente/equipo, presupuesto versionado aceptado, repuestos reservados/consumidos, QC que cubre la última intervención, entrega inmutable y garantía derivada de entrega.
6. Ningún documento como autorizado sin resultado verificable del proveedor; stubs inequívocamente no fiscales.
7. IMEI/consultas solo con evidencia; ausencia/pendiente jamás equivale a limpio.
8. Configuración explícita por entorno, sin fallback remoto; instalación limpia y convergencia histórica reproducibles.
9. Autorización efectiva probada con roles reales (incluye H01/H02/H13); demos de seguridad/auditoría/integraciones retiradas o marcadas.
10. Build/tests vinculados al contenido entregado; suites SQL (1.111 aserciones planificadas en 10 suites) ejecutadas, no solo existentes.

## Límites de este consolidado

No reproduce claves ni secretos. "Confirmado" = demostrable en código local, no reproducido en ejecución. Los riesgos condicionados requieren DDL/ACL del entorno desplegado. Los PASS históricos no se trasladan al worktree actual. No hay dictamen fiscal/legal, solo ausencia de autorización real en el flujo técnico.
