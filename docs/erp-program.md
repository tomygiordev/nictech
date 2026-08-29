# Programa de implementacion del ERP NicTech

## Objetivo

Construir el sistema de gestion completo solicitado en `cambios/Sistema de gestion.docx` sin reducir su alcance. La tienda publica existente se conserva y el ERP se desarrolla como una aplicacion privada independiente, respaldada por contratos, migraciones y pruebas locales reproducibles.

Este documento ordena el trabajo por dependencias. Una etapa puede desplegarse por separado, pero ninguna etapa elimina requisitos posteriores.

## Restriccion de seguridad durante el desarrollo

- Todo cambio de base de datos se escribe primero en `supabase/migrations` y se valida contra Supabase local.
- No se ejecutan `supabase link`, `supabase db push`, comandos con `--linked`, SQL remoto ni herramientas MCP de mutacion.
- El `project_id` presente en `supabase/config.toml` se considera heredado y no autoriza operaciones remotas.
- Toda aplicacion remota futura requiere revision del usuario, reconciliacion del proyecto correcto, respaldo y autorizacion expresa.
- Integraciones externas se implementan detras de adaptadores y se prueban con dobles locales hasta disponer de credenciales y autorizacion.

## Principios no negociables

1. La tienda y el ERP son aplicaciones desplegables por separado.
2. La autorizacion se aplica en la base de datos; ocultar controles de UI no es seguridad.
3. Ventas, compras, pagos, stock y asientos se confirman de forma atomica e idempotente.
4. Los hechos publicados no se borran: se anulan o revierten con referencia al original.
5. Stock, costos, saldos y contabilidad se calculan desde libros de movimientos conciliables.
6. Los datos publicos de reparaciones se exponen mediante una proyeccion minima, nunca mediante tablas internas.
7. Cada integracion registra intentos, resultados, errores y reintentos.
8. Cada operacion monetaria conserva moneda, cotizacion, fuente y redondeo usados en ese momento.

## Arquitectura objetivo

```text
apps/
  storefront/       tienda publica
  erp/              aplicacion privada de gestion
packages/
  domain/           tipos, estados, permisos y reglas puras
  database/         tipos generados y clientes
  ui/               componentes compartidos sin logica de negocio
supabase/
  migrations/       esquema versionado
  seed.sql           datos deterministas de desarrollo
  tests/database/   pruebas pgTAP, RLS y transacciones
  functions/        adaptadores e integraciones de servidor
```

La migracion desde la SPA actual sera incremental. No se movera codigo por apariencia: cada modulo cambia de ubicacion cuando tenga contratos y pruebas que permitan hacerlo sin perder comportamiento.

## Etapas y puertas de calidad

### Etapa 0: linea base reproducible

Entregables:

- npm como gestor y `package-lock.json` como lockfile autoritativo.
- Scripts de lint, typecheck, tests y build independientes.
- Migraciones, seed y pruebas de base locales.
- Inventario de deriva entre tipos generados y uso actual.
- Documentacion versionada y politica explicita de no acceso remoto.

Puerta de salida:

- Una instalacion limpia puede reconstruir la base local.
- Lint, typecheck, tests y builds nuevos pasan sin depender de servicios remotos.
- Ningun comando de verificacion modifica un proyecto Supabase remoto.

### Etapa 1: identidad, permisos, auditoria y configuracion

Entregables:

- Perfiles, empleados, roles, permisos, asignaciones y excepciones individuales.
- Alcance por sucursal y ubicacion.
- Auditoria append-only con actor, accion, motivo, valores y correlacion.
- Registro de configuracion con controles esenciales protegidos.
- Almacenamiento privado y acceso firmado para datos sensibles.

Puerta de salida:

- Matriz RLS prueba acceso permitido y denegado por rol.
- Las llamadas directas no autorizadas fallan aunque la UI sea manipulada.
- Los eventos de auditoria no pueden modificarse ni eliminarse con roles de aplicacion.

### Etapa 2: maestros comerciales

Entregables:

- Sucursales, ubicaciones, clientes, domicilios, consentimientos y equipos.
- Proveedores y condiciones comerciales.
- Productos, servicios, categorias, marcas, modelos, atributos y variantes.
- Codigos internos, codigos de fabricante, alias, barras, series e IMEI unicos.
- Descripciones, imagenes y reglas separadas para uso interno y publicacion web.

Puerta de salida:

- No existen colisiones de codigos.
- Los servicios nunca generan stock.
- Los datos sensibles de clientes respetan permisos y auditoria.

### Etapa 3: inventario, reservas y etiquetas

Entregables:

- Libro inmutable de stock por ubicacion.
- Unidades serializadas, reservas, transferencias, transito y consumo en reparaciones.
- Ajustes autorizados y sesiones de inventario fisico con aprobacion de diferencias.
- Plantillas, lotes e historial de etiquetas de barras y QR.

Puerta de salida:

- Todo cambio de existencia tiene un movimiento y documento origen.
- Transferir no altera el total global.
- Pruebas concurrentes impiden sobreventa.
- Reintentar una orden no duplica movimientos.

### Etapa 4: compras, costos, monedas y precios

Entregables:

- Ordenes de compra, recepciones parciales, comprobantes y deuda con proveedores.
- Flete, impuestos y gastos distribuidos.
- Costo promedio ponderado y costo especifico para unidades serializadas.
- Fuentes e historial de cotizaciones, formulas, fallback manual y alertas.
- Listas de precios, metodos de pago, recargos, cuotas y cambios masivos con vista previa.

Puerta de salida:

- El costo distribuido concilia con el total recibido.
- Las operaciones historicas conservan su cotizacion.
- Confirmar dos veces una recepcion no duplica stock ni deuda.

### Etapa 5: ventas, POS, caja y pedidos web

Entregables:

- Venta persistida con lineas, servicios, conceptos libres, descuentos autorizados y cliente.
- Pagos multiples y parciales, medios configurables y cuentas por cobrar.
- Apertura, movimientos, retiros, aportes, gastos, arqueo y cierre por moneda.
- Estados independientes de pedido, pago y entrega.
- Reservas web con vencimiento, preparacion, despacho, devolucion y reembolso.
- Bandeja de sincronizacion con reintentos y errores visibles.

Puerta de salida:

- Venta, pagos, caja, stock, auditoria y asientos se confirman atomicos.
- El cierre concilia saldo esperado y contado.
- Los webhooks repetidos o fuera de orden no duplican operaciones.
- La variante elegida en tienda llega hasta reserva, pedido y despacho.

### Etapa 6: reparaciones, pruebas, presupuestos y garantias

Entregables:

- Orden numerada, cliente, equipo, serie/IMEI, accesorios, condicion y credenciales protegidas.
- Tecnico, diagnostico, estados configurables y transiciones autorizadas.
- Plantillas de prueba de ingreso y egreso con responsable y resultado.
- Presupuestos versionados, vencimiento y aprobacion/rechazo del cliente.
- Repuestos, mano de obra, costos, senas, pagos, firma, entrega y garantia.
- Carga temporal de fotos/video por QR, archivos privados e historial.
- Etiqueta interna y seguimiento publico por proyeccion segura.

Puerta de salida:

- El seguimiento no expone notas internas, credenciales, costos ni archivos privados.
- Editar un presupuesto crea una version y nunca registra una venta anticipada.
- El consumo de repuestos actualiza stock y costo en una sola transaccion.

### Etapa 7: proyectos PC, canjes e IMEI

Entregables:

- Proyectos de armado, compatibilidad, reservas, pruebas y equipo resultante.
- Ingreso de usados con procedencia, declaracion, evidencia, evaluacion y reacondicionamiento.
- Verificacion IMEI por proveedor y alternativa manual documentada.
- Cuarentena hasta aprobacion y costo total del equipo recibido.

Puerta de salida:

- Un canje no puede venderse antes de aprobar procedencia, IMEI y evaluacion.
- El equipo armado conserva componentes, series, costos y garantias.

### Etapa 8: documentos, ARCA, WhatsApp y notificaciones

Entregables:

- Plantillas versionadas y documentos almacenados para ventas, pagos, reparaciones, garantias, armados y canjes.
- Emision fiscal ARCA idempotente, numeracion, CAE, errores y reintentos.
- WhatsApp Business oficial con bandeja, asignacion, plantillas, adjuntos y estados.
- Automatizaciones configurables y registro de consentimiento/envio.

Puerta de salida:

- Reintentar no duplica comprobantes fiscales ni mensajes de negocio.
- Los documentos para clientes no contienen campos internos.
- Las firmas de webhooks y los estados de entrega estan probados.

### Etapa 9: financiacion y contabilidad de partida doble

Entregables:

- Cuentas corrientes, contratos, cuotas, intereses, vencimientos y mora.
- Plan de cuentas, periodos, asientos y reglas de contabilizacion.
- Cuentas por cobrar/pagar, impuestos, inventario, costo de ventas y diferencias de cambio.
- Conciliacion de caja, bancos, billeteras y tarjetas.

Puerta de salida:

- Debe iguala Haber en todo asiento publicado.
- Los asientos publicados solo se revierten.
- Inventario, caja, bancos, clientes y proveedores concilian con el mayor.
- Los periodos cerrados impiden contabilizacion retroactiva no autorizada.

### Etapa 10: gestion, reportes e inteligencia

Entregables:

- Dashboard configurable y sensible a permisos.
- Resultados, balance, flujo de fondos y reportes operativos conciliados.
- Exportacion PDF y Excel.
- Antiguedad, rotacion, cobertura, margen, capital inmovilizado y recomendaciones explicadas.
- Salud de integraciones, backups, restauracion y observabilidad.

Puerta de salida:

- Cada cifra se reconcilia con libros, no con calculos duplicados en componentes.
- Exportaciones y pantalla producen los mismos totales.
- Se ensaya restauracion y se demuestran RPO/RTO acordados.

### Etapa 11: migracion y puesta en marcha

Entregables:

- Importacion repetible de productos, variantes, pedidos, reparaciones, logs y archivos actuales.
- Informes de conciliacion y excepciones.
- Periodo paralelo para stock, caja y contabilidad.
- Corte controlado y plan de rollback.

Puerta de salida:

- El negocio aprueba conciliaciones de existencias, saldos, reparaciones y pedidos abiertos.
- No quedan defectos altos de seguridad o integridad.
- Backup, rollback y recuperacion se validan antes del corte.

## Trazabilidad de los 36 requisitos

| # | Area solicitada | Etapas principales |
|---:|---|---|
| 1 | Separacion tienda/gestion | 0, 1 |
| 2 | Usuarios, roles y permisos | 1 |
| 3 | Auditoria | 1 y todas |
| 4 | Productos y servicios | 2 |
| 5 | Codigos de barras y etiquetas | 2, 3 |
| 6 | Stock central y ubicaciones | 2, 3 |
| 7 | Inventarios fisicos | 3 |
| 8 | Compras y proveedores | 2, 4 |
| 9 | Monedas y cotizaciones | 4 |
| 10 | Listas de precios y medios de pago | 4, 5 |
| 11 | Punto de venta | 5 |
| 12 | Caja diaria | 5 |
| 13 | Administracion de tienda online | 2, 5 |
| 14 | Sincronizacion de stock web | 3, 5 |
| 15 | Pedidos online | 5 |
| 16 | Clientes | 2 |
| 17 | Ordenes de reparacion | 6 |
| 18 | Pruebas de ingreso/egreso | 6 |
| 19 | Fotos y videos por QR | 1, 6 |
| 20 | Etiquetas de reparacion | 3, 6 |
| 21 | Seguimiento web | 6 |
| 22 | Presupuestos | 5, 6 |
| 23 | Armados de PC | 7 |
| 24 | Equipos en parte de pago | 7 |
| 25 | Verificacion IMEI | 7 |
| 26 | Facturas, recibos y documentos | 8 |
| 27 | Garantias y devoluciones | 5, 6 |
| 28 | WhatsApp integrado | 8 |
| 29 | Financiacion y cuentas corrientes | 9 |
| 30 | Gestion financiera y contabilidad | 9 |
| 31 | Costos y rentabilidad | 4, 9, 10 |
| 32 | Dashboard | 10 |
| 33 | Reportes | 10 |
| 34 | Inteligencia de inventario | 10 |
| 35 | Configuracion general | 1 y cada modulo |
| 36 | Requisitos generales | Todas |

## Criterio de completitud

Un modulo no se considera terminado por tener pantallas. Debe incluir modelo versionado, permisos, auditoria, comandos atomicos, validaciones, estados y reversas, pruebas de dominio/base/UI, estados vacios y de error, accesibilidad, operacion movil cuando corresponda, observabilidad y documentacion de recuperacion.
