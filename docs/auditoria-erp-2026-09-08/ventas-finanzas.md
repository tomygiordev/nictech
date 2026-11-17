# Auditoría ERP: ventas, caja, cuentas y reportes

Fecha: 2026-09-08. Revisión estática del código y migraciones acumuladas hasta 202609070013. Sin modificar implementación ni acceder a producción. No se afirma ejecución de pruebas en este parcial. Prioridades: P1 bloquea entrega fiable; P2 debe resolverse o delimitarse expresamente.

## Hallazgos demostrables

### VF-01 · P1 · El POS no puede vender teléfonos/notebooks serializados
- Evidencia: `apps/erp/src/features/pos/PosWorkspace.tsx:403` construye todas las líneas sin `inventory_unit_id`; tampoco consulta `inventory_tracking` ni ofrece selector IMEI/serie. `supabase/migrations/202608190003_erp_inventory_ledger.sql:473` exige unidad y cantidad 1 para serial/imei. Ese cuerpo sigue vigente como `post_stock_document_core`, envuelto por las migraciones 004/005.
- Reproducción: cargar teléfono con seguimiento IMEI y stock; agregarlo y cobrar. El RPC rechaza la venta con `serialized stock lines require one inventory unit and quantity 1`.
- Corrección: selección/búsqueda de unidad disponible por IMEI/serie, línea individual por unidad, estado y ubicación verificados en servidor.

### VF-02 · P1 · Dashboard consulta columnas/tabla del storefront en el schema ERP
- Evidencia: `apps/erp/src/lib/supabase.ts:23` fija schema erp. `DashboardOverview.tsx:320` consulta products(id,name,price,stock), inexistentes en erp.products; `:330` consulta repairs en lugar de repair_orders/overview. No inspecciona error y convierte data null en [].
- Impacto: indicadores de productos, existencias, reparación y valuación muestran ceros como si fueran datos válidos después de migrar.
- Corrección: consultas ERP y agregados reales, mostrar fallos; probar con datos distintos de cero.

### VF-03 · P1 · Ventas POS desconectadas del libro contable
- Evidencia: `202608190006_erp_sales_cash_orders.sql:1101` create_sale registra venta/stock/cuenta cliente/pago y termina `return sale_id` sin posteo contable; no hay trigger de posteo en sales/payments en migraciones. Única integración automática encontrada: fulfill_online_order en 070012.
- Escenario: vender $100.000 en efectivo; caja registra pago pero contabilidad no registra ventas ni caja ni costo. Reporte de balance puede quedar vacío.
- Corrección: posteo idempotente transaccional desde los hechos de venta/pago/costo y sus reversos. No pedir asientos manuales para cada venta a una persona que atiende el negocio.

### VF-04 · P1 · Financiaciones son un subsistema separado de las deudas y caja
- Evidencia: `202608190010_erp_finance_accounting.sql:493` create_financing_contract no recibe sale_id/receivable_id; crea contrato/cuotas y auditoría. `202608190011_erp_finance_accounting_stage9_completion.sql:151` record_receivable_payment solo crea receivable_payments, asigna cuotas y audita; sin payment_method/cash_session, sin cash_movements ni customer_account_entries ni asiento.
- Escenario: cobrar cuota en efectivo reduce el plan pero no aumenta caja ni reduce cuenta cliente original. Anticipo del contrato tampoco genera ingreso. No existe enlace que evite duplicar deuda financiada y deuda de la venta.
- Corrección: vincular financiación a obligación original y registrar anticipo/cobros/reversos con medio, caja, moneda y asientos en una transacción.

### VF-05 · P1 · No existe flujo operativo UI de anulación/reembolso/cobro pendiente
- Evidencia: búsquedas completas en apps/erp/src no encuentran llamadas a cancel_sale, reverse_sale_payment ni record_sale_payment. SQL sí ofrece RPC en `202608190006_erp_sales_cash_orders.sql:1390` aprox. y `:1502`. POS conserva solo último ticket en estado React (`PosWorkspace.tsx:98`, `:455`) y no brinda historial recuperable.
- Escenario: error de cobro o devolución al día siguiente requiere intervención técnica/RPC manual. Tampoco cobrar saldo de una venta en cuenta corriente desde UI; AccountsWorkspace trabaja solo con contratos.
- Corrección: historial de ventas y detalle, anulación completa con motivo y caja de devolución, cobro de saldo; definir si se requieren devoluciones parciales (no hay flujo parcial identificado). Cancelación SQL revierte stock/pagos/deuda, pero no asientos online.

### VF-06 · P1 · IVA y rentabilidad siguen sumando ventas anuladas
- Evidencia: `202609070013_erp_reporting_views.sql:20` une sale_lines/sales sin estado; `:67` sales_agg suma todas las líneas. `202608190006_erp_sales_cash_orders.sql:1502` cancel_sale conserva venta/líneas y añade evento cancelled, además de reversar stock/pagos.
- Escenario: vender y anular íntegramente; reportes siguen mostrando ingreso, unidades e IVA originales. Una anulación no reduce margen.
- Corrección: integrar hechos de reverso/nota de crédito según fecha efectiva, no borrar historia; pruebas venta + anulación + período distinto.

### VF-07 · P1 · Vistas financieras ignoran RLS a pesar del comentario
- Evidencia: `202609070013_erp_reporting_views.sql:20`, `:32`, `:44`, `:66` CREATE VIEW no configura security_invoker; `:119` concede SELECT authenticated. No ALTER posterior. Comentario de cabecera afirma lo contrario.
- Impacto: la vista ejecuta con permisos del propietario de migraciones, por lo que usuario autenticado sin permisos financieros puede leer finanzas. Relevante incluso con un cliente único: autenticación no equivale a acceso ERP.
- Corrección: security_invoker=true y validar grants/RLS subyacentes; prueba authenticated sin perfil/rol y operador autorizado. Tests actuales verifican permiso SELECT y datos como administrador, no aislamiento negativo.

### VF-08 · P1 · Informes mezclan monedas sin conversión
- Evidencia: `202609070013_erp_reporting_views.sql:72` suma line_total sin unir sales/exchange_rate, contra landed_cost_base de compras (:80), que sí está en moneda base. v_iva_ventas y v_iva_compras omiten moneda y conversión. v_trial_balance suma debit/credit sin exchange_rate. `AccountsWorkspace.tsx:131` suma principal y financed de contratos ARS y USD como una cifra; UI la muestra ARS.
- Escenario: venta USD 100 con costo ARS 60.000 produce margen -59.900 en lugar de convertir USD al snapshot. Contratos ARS 100 y USD 100 aparecen como 200 pesos.
- Corrección: mantener moneda transaccional y valor base histórico explícitos, agregar en base o agrupar por moneda; definir contrato contable de debit/credit (actual post_journal_entry acepta moneda/tipo de cambio pero el reporte no los usa).

### VF-09 · P2 · POS descarta impuestos configurados
- Evidencia: `PosWorkspace.tsx:137` consulta tax_rate_percent pero mapeo no lo conserva; `:413` y :414 mandan siempre tax_rate_percent=0 y tax_amount=0.
- Impacto: catálogo con impuesto configurado genera venta sin impuesto y reporte IVA 0. Puede ser configuración deliberada sin discriminación fiscal para este cliente; no debe dejarse como comportamiento silencioso universal.
- Corrección: definir precio neto/final y régimen operativo con cliente/contador, aplicar cálculo coherente servidor/UI y documentar alcance del comprobante. No se emite opinión normativa.

### VF-10 · P2 · Transferencia bancaria se registra como MercadoPago
- Evidencia: `PosWorkspace.tsx:394` agrupa qr y transfer con payment_method_id terminado 003. `supabase/seed.sql:474` define ese id MERCADOPAGO settlement_kind wallet.
- Escenario: transferencia bancaria muestra etiqueta Transferencia en ticket local pero persistencia indica MP. Conciliación por medio queda incorrecta.
- Corrección: medio transferencia real y selección desde catálogo por identidad estable, con referencia opcional/obligatoria definida.

### VF-11 · P1 · Reintento de POS puede duplicar una venta cobrada
- Evidencia: `PosWorkspace.tsx:417` genera nueva clave dentro de cada handleCheckout; si RPC commitió pero se perdió respuesta, catch conserva carrito. Segundo click genera otra clave. Backend create_sale sí ofrece idempotencia (:1168), pero la UI la invalida al reintentar.
- Corrección: clave estable por intento lógico, conservar hasta resolución; recuperar venta por clave ante respuesta incierta. Test pérdida de respuesta tras commit y segundo click: una venta, un débito stock, un pago.

### VF-12 · P2 · POS muestra stock reservado como vendible y solo ubicación fija
- Evidencia: `PosWorkspace.tsx:163` suma quantity_on_hand sin restar quantity_reserved aun habiéndolo consultado; :84 y :85 fijan ubicación/sucursal seed. Variantes y simple aplican mismo cálculo.
- Escenario: 5 fundas físicas, 5 reservadas web: muestra 5 disponibles y permite cargar carrito; servidor correctamente rechaza salida. Stock en depósito no aparece vendible sin transferencia al mostrador.
- Corrección: mostrar disponible = físico - reservado y distinguir ubicaciones; resolver sucursal/ubicación del contexto operativo, no UUIDs de demo.

### VF-13 · P1 · Compras fiscales cuentan órdenes que nunca se recibieron
- Evidencia: `202609070013_erp_reporting_views.sql:32` v_iva_compras nace de purchase_order_lines/purchase_orders sin recepción ni estado, fecha ordered_at. No es libro de comprobantes de compra.
- Escenario: crear orden pendiente/rechazada/no recibida con impuesto: aparece como IVA compras. Tampoco reconoce fecha documental real ni reversos.
- Corrección: usar documentos de compra efectivos con estado, fecha, impuesto y moneda; hasta implementarlo, no presentar esta vista como libro fiscal listo.

### VF-14 · P2 · Margen histórico cambia por compras futuras y no usa costo de salida
- Evidencia: `202609070013_erp_reporting_views.sql:76` promedia todas las recepciones del producto, sin fecha ni variante, y multiplica cantidad histórica vendida. Ya existe stock cost ledger, pero vista no lo usa.
- Escenario: vender unidad costo 100 y luego comprar otra a 300: costo imputado a venta vieja pasa a 200. Variantes de funda de costos distintos comparten promedio. Compras revertidas pueden seguir en origen agregado.
- Corrección: reportar costo efectivamente consumido por movimiento/venta y reverso; si se desea estimación a costo promedio actual, etiquetarla explícitamente y no llamarla ganancia histórica real.

### VF-15 · P1 · Contabilización online deja cuenta a cobrar aunque ya cobró
- Evidencia: `202609070012_erp_fulfill_online_order.sql:126` siempre debita receivable y acredita sales_income por total; fulfill_web_order ya registró pago completo. No asiento de cobranza ni costo/impuesto, tampoco reverso desde cancel_sale. Además utiliza current_date, no fecha original de la operación, e importe transaccional sin convertir.
- Escenario: orden MP pagada y cumplida: submayor cliente neto 0; mayor contable deudores +total. Conciliación necesariamente difiere.
- Corrección: ciclo completo venta/cobranza/comisiones/costo/impuestos aplicables/reversos con cuenta de medio real y snapshot.

### VF-16 · P2 · Lecturas financieras convierten fallos en datos vacíos
- Evidencia: `apps/erp/src/features/finance/api.ts:95` y múltiples list*: catch/error devuelven []. `listProfitabilityByLine` también lo hace; AccountingWorkspace sí tiene panel isError pero nunca recibe estos errores.
- Impacto: migración faltante/grant incorrecto/conexión caída se muestra como ausencia de deuda/asientos/rentabilidad y puede exportarse vacío.
- Corrección: propagar error; reservar [] para consulta válida sin filas y probar cada fallo.

## Fechas y cuenta corriente: observaciones adicionales
- `AccountsWorkspace.tsx:133` y `AccountingWorkspace.tsx:680` usan fecha UTC vía toISOString. En Argentina después de las 21 h toman mañana: vencimientos se marcan antes y asientos default caen en siguiente día/mes. `v_iva_ventas` confirmed_at::date depende timezone DB, no zona del comercio. P2: fecha comercial America/Argentina/Buenos_Aires explícita.
- `CustomersWorkspace.tsx:83` consulta sales.status completed inexistente (estado por eventos), ignora salesRes.error; totales cliente quedan 0. `:133` fuerza creditBalanceArs=0. Coordinar con auditor de clientes para evitar duplicación.
- Datos serializados, permisos y ventas con variantes cuentan con validaciones SQL reales; no se debe confundir UI incompleta con inexistencia absoluta del backend.
- No se confirma bug de aprobación online obsoleta: wrapper busca evento paid, pero fulfill_web_order verifica estado de pago más reciente y rechaza reembolsado.

## Cobertura y pruebas faltantes para cierre

Existen pruebas SQL erp_sales_cash_orders, erp_finance_accounting, erp_phase_c_purchases_pos_cash, erp_fulfill_online_order, erp_reporting_views. FinanceWorkspace.test.tsx mockea APIs (líneas 19-34), sus comprobaciones básicas no prueban transacciones reales. No se identificó test de componente POS/Caja completo.

Mínimo de aceptación: venta cantidad y variante con reserva; teléfono/notebook por unidad; efectivo apertura/cierre/devolución; tarjeta/transferencia/MP distinguidos; respuesta perdida/reintento; factura anulada y reportes revertidos; deuda venta -> financiación -> anticipo -> cuotas -> caja/asientos; ARS y USD; operación a las 21:30 local y fin de mes; usuario authenticated sin acceso; UI con errores de consultas y datos > límite de página. Comparar saldos DB antes/después, no solo ausencia de excepción. No se considera aprobada esta aceptación por tener build/tests unitarios verdes.
