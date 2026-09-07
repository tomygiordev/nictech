# Auditoría ERP: Ventas y Finanzas

Fecha del informe: **2026-09-07**.

Modalidad: **revisión estática, no runtime**. Documento que preserva íntegramente el informe previo, incluidos sus 23 hallazgos, riesgos condicionados, referencias, escenarios, criterios de aceptación, controles, matrices, cobertura de pruebas y límites. Su persistencia no implica una nueva auditoría ni una verificación en ejecución.

**Dictamen**
**No recomendaría entregar estos módulos como ERP operativo integrado para llevar ventas, caja y contabilidad del negocio.** Hay un backend ERP con controles transaccionales importantes, pero las pantallas actuales mezclan operaciones sobre el esquema público, APIs ERP desconectadas, formularios bloqueados y datos de demostración presentados como reales.

No identifico un **P0 confirmado** con esta revisión estática. Sí hay **P1 que bloquean la entrega**, especialmente el falso éxito de una venta, la actualización de stock desde datos antiguos, la caja ficticia y los formularios financieros inutilizables.

La condición de negocio unipersonal no elimina estos problemas: basta una venta web simultánea, dos pestañas, una desconexión o un cobro que deba corregirse.

**Alcance Y Límites**
- Revisados los cinco directorios solicitados, sus APIs, schemas, montaje en `App.tsx`, cliente compartido, formateadores, migraciones relacionadas y pruebas existentes.
- Se contrastaron las definiciones SQL con sus constraints, triggers y correcciones posteriores presentes en el repositorio.
- Del storefront se revisó únicamente el contrato compartido de pedidos y procesamiento de pagos necesario para explicar efectos en el ERP.
- **No edité archivos, no ejecuté tests/build, no instalé dependencias ni consulté DB o sistemas remotos.** No se alteró el dirty worktree.
- “Confirmado” significa **confirmado por el código local**, no reproducido en ejecución ni comprobado en producción.
- No encontré en las migraciones locales el DDL de `public.products`, `public.orders`, `public.inventory_movements` ni la definición de `public.decrement_stock`. Por tanto, **no doy por demostrada la ausencia de triggers públicos en el entorno real** ni atribuyo efectos remotos que no pueda contrastar.

Para abreviar referencias SQL:

| Alias | Archivo |
|---|---|
| `SQL-Ventas` | `supabase/migrations/202608190006_erp_sales_cash_orders.sql` |
| `SQL-Costos` | `supabase/migrations/202608190005_erp_stock_cost_ledger.sql` |
| `SQL-Finanzas` | `supabase/migrations/202608190010_erp_finance_accounting.sql` |
| `SQL-Finanzas-Final` | `supabase/migrations/202608190011_erp_finance_accounting_stage9_completion.sql` |

Las referencias de frontend parten de `apps/erp/src/`.

**Hallazgos P1**

### 1. POS Declara Una Venta Exitosa Aunque Las Escrituras Fallen

**Estado: confirmado.**

**Evidencia:** `features/pos/PosWorkspace.tsx:174-220`.

El checkout espera dos operaciones por artículo, pero no inspecciona sus respuestas:

```ts
await supabase.from("products").update(...);
await supabase.from("inventory_movements").insert(...);
```

Después genera el comprobante local, vacía el carrito y muestra “Venta … completada con éxito”. Los errores devueltos en `{ error }` no activan el `catch`.

**Escenario:** falla el `UPDATE` por permisos o falla el `INSERT` por un constraint. La pantalla igualmente confirma la venta. En un carrito de varios artículos también pueden quedar escrituras parciales.

**Impacto:** entrega de mercadería sin registro confiable; stock y movimientos discrepantes; pérdida del carrito que permitía reconstruir la operación.

**Criterio de aceptación:** una confirmación debe depender de una única operación transaccional validada. Un fallo inducido en cualquier línea debe dejar cero efectos parciales y conservar una operación recuperable. Nunca mostrar éxito solamente porque terminó el bucle.

### 2. POS Sobrescribe Stock Con Una Foto Antigua Y Permite Vender Sin Existencias

**Estado: confirmado en el algoritmo cliente; efectos finales sujetos a los triggers públicos no disponibles.**

**Evidencia:** `features/pos/PosWorkspace.tsx:130-154,180-186,351-385`.

El carrito permite incrementar sin límite. El checkout calcula:

```ts
const nextStock = Math.max(0, item.product.stock - item.quantity);
```

No consulta el stock actual ni realiza un decremento condicionado a disponibilidad.

**Escenarios:**
- Dos pestañas cargan stock 5 y venden una unidad cada una. Ambas intentan escribir 4, en lugar de terminar en 3.
- El catálogo muestra stock 1 y el operador vende 3. El cálculo envía stock 0 y el movimiento declara salida de 3.
- Una venta web modifica stock mientras el producto permanece en el carrito POS.

**Impacto:** sobreventa, pérdida de actualizaciones y diferencias físicas imposibles de explicar con el saldo mostrado.

**Criterio de aceptación:** decisión de disponibilidad y salida dentro de una transacción, sobre stock actual, con identificación de variante/unidad cuando corresponda. Dos ventas concurrentes de la última unidad deben producir una sola venta aceptada.

### 3. El Flujo POS Montado No Usa La Venta ERP Ni Conserva El Cobro

**Estado: desconexión confirmada; un eventual puente remoto público no está verificado.**

**Evidencia:**
- `App.tsx:560-564` monta `PosWorkspace`.
- `features/pos/PosWorkspace.tsx:180-220` escribe productos/movimientos y mantiene el ticket en estado React.
- `features/pos/api.ts:27-40` define `createSale`, pero no hay llamadas desde la pantalla.
- `SQL-Ventas:1235-1353` implementa venta, líneas, stock, cuentas y pagos.

El medio seleccionado se utiliza solamente en el objeto local del ticket. No se envía con el movimiento de inventario. Tampoco se envía sesión de caja, importe recibido, referencia de tarjeta/transferencia o identidad persistente de venta.

El ticket usa un número aleatorio de seis dígitos sin reserva ni unicidad persistida. `lastTicket` desaparece al recargar.

**Impacto:** no hay trazabilidad cliente entre venta, cobro y caja; no se puede reconstruir el medio de pago desde esas escrituras; una reimpresión o devolución no tiene una venta ERP de origen disponible desde el flujo.

**Criterio de aceptación:** el checkout debe devolver un ID persistente de venta y permitir consultar sus líneas, pagos, stock, costo y comprobante después de recargar. Para tarjeta/QR/transferencia debe quedar claro si se registra un cobro externo confirmado o si se integra realmente con un proveedor.

**Sobre doble clic:** existe `submittingSale` y el botón se deshabilita (`:175,550`), lo cual reduce el doble clic normal en una misma pantalla. **No es idempotencia persistente** frente a recarga, dos pestañas, repetición de una operación incierta o recuperación tras un fallo parcial.

### 4. Caja Es Una Demostración Local Presentada Como Caja Real

**Estado: confirmado.**

**Evidencia:** `features/cash/CashWorkspace.tsx:16-65,73-74,90-103`.

Al iniciar sin datos locales se crea una caja ficticia con:
- Fondo inicial de $50.000.
- Saldo actual de $145.000.
- Estado abierto.

La persistencia completa es `localStorage["erp_cash_sessions_v1"]`. Abrir agrega un objeto local; cerrar cambia `status` a `"closed"` y anuncia “Arqueo y cierre de caja completado”.

No existe conteo físico, cálculo de diferencia, movimiento de retiro/aporte ni actualización desde ventas.

**Impacto:** el propietario puede interpretar como disponible dinero que nunca fue registrado; las ventas no cambian el saldo; otro navegador muestra una caja distinta; el cierre no constituye un arqueo.

**Criterio de aceptación:** caja persistente en servidor, sin saldos demo; apertura real, movimientos vinculados a pagos, conteo de cierre y diferencia comprobables después de cambiar de navegador.

El backend **sí contempla** estas operaciones: `SQL-Ventas:767-970`. El problema es su falta de integración con la pantalla.

### 5. APIs Financieras Apuntan Al Esquema Incorrecto

**Estado: confirmado contra el contrato versionado; wrappers remotos no verificados.**

**Evidencia:**
- `lib/supabase.ts:20-26`: el cliente se crea sin seleccionar `db.schema`.
- `features/finance/api.ts:34-95,97-183`: tablas y RPC sin `.schema("erp")`.
- `SQL-Finanzas:60,131` y `SQL-Finanzas-Final:3,151,382`: objetos definidos en `erp`.
- `supabase/config.toml:5-6`: expone ambos esquemas; eso no selecciona automáticamente `erp` para las peticiones cliente.

No encontré wrappers públicos para estas operaciones en las migraciones locales.

**Escenario:** ejecutar el frontend contra una DB construida con este contrato y consultar `financing_contracts` o llamar `post_journal_entry`.

**Impacto:** las lecturas financieras pueden parecer vacías y las mutaciones no encontrar su RPC. El mismo defecto afecta a las APIs de POS/caja si se conectan tal como están.

**Criterio de aceptación:** comprobar que las peticiones financieras llegan explícitamente a `erp`, con un test de contrato sobre el cliente real configurado, no con mocks de las funciones de `api.ts`.

### 6. Crear Financiación, Cobrar, Publicar Asiento Y Conciliar Están Bloqueados Por Sus Formularios

**Estado: confirmado. Independiente del problema de esquema anterior.**

**Evidencia:**
- `features/finance/AccountsWorkspace.tsx:16-18,27-50,237-295,307-351`.
- `features/finance/AccountingWorkspace.tsx:317-349,772-829,886-928`.
- `features/finance/schemas.ts:6-8,19-21,27-28,66-68`.

Problemas concretos:

| Operación | Bloqueo |
|---|---|
| Crear financiación | Solo permite sucursales `dev-branch-*`, inválidas para `uuid()`; `customerId` queda en `dev-cust-0001` y no hay selector de cliente |
| Registrar cobro | Todas las opciones de sucursal son UUID inválidos |
| Publicar asiento manual | `branchId` es obligatorio en el schema, pero no se inicializa ni se ofrece como campo |
| Conciliar | `branchId` contiene `dev-branch-0000` y no puede corregirse desde el formulario |

Además, se muestran errores de la mutación, pero no los errores de validación de esos campos. La mutación ni siquiera tiene por qué ejecutarse.

**Impacto:** botones aparentemente operativos que no completan operaciones esenciales, sin explicar al usuario cómo resolverlo.

**Criterio de aceptación:** completar cada operación desde la UI usando sucursal y cliente reales; comprobar el payload y visualizar todos los errores de validación. No basta con que se renderice el botón.

### 7. El Libro Diario No Está Integrado Automáticamente Con Los Hechos Operativos

**Estado: confirmado en el código y SQL versionados.**

**Evidencia:**
- `SQL-Ventas:1235-1353`: registra venta, stock, pagos y cuenta operativa, sin asiento.
- `SQL-Ventas:2238-2258`: triggers operativos de inmutabilidad/auditoría, no de contabilización.
- `SQL-Ventas:2391-2394`: distingue explícitamente el ledger operativo del libro mayor.
- `SQL-Finanzas-Final:126-147`: `post_erp_source_event` delega a un asiento con líneas entregadas por el llamador.
- `features/finance/api.ts:140-151`: wrapper sin consumidores productivos encontrados en el ERP.

La existencia de `post_erp_source_event` no prueba que ventas, cobros o costos la invoquen ni que exista una traducción automática de esos hechos.

**Escenario:** crear una venta ERP válida con salida de stock y costo. La ruta no genera por sí misma el asiento de ingreso, caja/cuenta por cobrar y costo de venta.

**Impacto:** un libro diario vacío o incompleto puede coexistir con actividad real y un indicador “Balance Cuadrado 100% OK”.

**Criterio de aceptación:** cada hecho operativo contabilizable debe tener vínculo único al asiento correspondiente, reglas de imputación y reversión, y un control visible de operaciones pendientes o fallidas. Si la contabilización será manual por decisión del negocio, debe declararse y existir una conciliación efectiva de completitud.

### 8. “Cuentas Corrientes” No Permite Cobrar La Deuda De Una Venta ERP Normal

**Estado: confirmado.**

**Evidencia:**
- `SQL-Ventas:1324-1336`: una venta con cliente genera `customer_receivables` y `customer_account_entries`.
- `features/finance/api.ts:32-37,114-123`: la pantalla consulta `financing_contracts` y cobra por `contractId`.
- `SQL-Finanzas:131-166`: los contratos no tienen vínculo a una venta o receivable operativo.
- `SQL-Finanzas-Final:203-264`: el cobro de cuotas aplica a cuotas y auditoría, sin movimiento de caja ni asiento.

**Escenario:** vender parcialmente a un cliente desde el comando ERP. Su saldo no aparece como deuda cobrable en la pantalla actual, salvo crear otra financiación independiente.

**Impacto:** posibilidad de duplicar deuda al reconstruirla manualmente; cobros de cuotas que no aumentan caja; anticipo contractual sin comprobante de ingreso asociado.

**Criterio de aceptación:** vender a cuenta, ver esa misma deuda, cobrarla desde el módulo y comprobar una sola reducción de saldo, un pago identificado y su efecto en caja/contabilidad. El contrato financiero debe vincularse al origen cuando financia una venta.

### 9. Pedidos Online Mezcla Pago Y Logística En Un Único Campo

**Estado: confirmado en frontend y webhook; aceptación de cada estado por la DB pública no verificada.**

**Evidencia:**
- `features/onlineorders/OnlineOrdersWorkspace.tsx:83-96,118-120,332-339`.
- `supabase/functions/mercadopago-webhook/index.ts:373-383`.

La UI escribe en `orders.status` valores de pago y logística: `"approved"`, `"preparing"`, `"shipped"`, `"delivered"`, `"cancelled"`. El webhook escribe en el mismo campo el estado recibido de Mercado Pago.

**Escenarios:**
- Marcar un pedido pagado como “En preparación” lo elimina de “Cobrado Online”, porque ese KPI solo acepta `approved/completed`.
- Una notificación posterior del proveedor sobrescribe `shipped` con `approved`.
- La UI ofrece marcar como aprobado un pedido pendiente sin verificar un cobro.
- Dos solicitudes de estado pueden sobrescribirse: no hay versión esperada ni bloqueo de mutación.

**Impacto:** pago y despacho se pisan; KPI de ingresos disminuye al preparar mercadería; el estado visible deja de ser prueba del pago.

**Criterio de aceptación:** estados financieros y logísticos independientes, transiciones verificadas en servidor, pago aprobado sustentado por un hecho de cobro y control de actualizaciones concurrentes. Preparar o entregar nunca debe modificar el importe cobrado.

No afirmo que el cambio manual actualmente pueda eludir la seguridad de la DB: las políticas y constraints públicos no están disponibles para comprobarlo.

### 10. El Webhook Marca Stock Procesado Antes De Completar Las Salidas

**Estado: confirmado en la secuencia del código; efecto exacto de `decrement_stock` no verificado.**

**Evidencia:** `supabase/functions/mercadopago-webhook/index.ts:369-371,393-418,439-441`.

Primero cambia `stock_decremented` a `true`. Después procesa los artículos con RPC separados. Si un decremento devuelve error, solo lo registra en consola y continúa.

**Escenario:** el primer artículo se procesa y el segundo falla, o el proceso se interrumpe después de adquirir la marca. En el siguiente webhook se observa `stock_decremented = true` y se omite la etapa.

**Impacto:** pedido señalado como procesado con stock incompleto, sin recuperación automática por reintento. Es un contrato indispensable para interpretar la bandeja ERP.

**Criterio de aceptación:** marca final y salidas atómicas, o procesamiento recuperable e idempotente por artículo. Inducir un fallo intermedio y demostrar que el reintento completa lo faltante sin repetir lo aplicado.

### 11. Rentabilidad E Informes Fiscales Muestran Resultados Inventados

**Estado: confirmado.**

**Evidencia:** `features/finance/AccountingWorkspace.tsx:56-155,159-195,219-265`.

Rentabilidad presenta porcentajes, ingresos, COGS y ganancias literales. Reportes muestra ventas netas, débito/crédito fiscal y saldo a pagar también literales.

Los cuatro botones de exportación solo llaman a `alert()`. No generan TXT, CSV, XLSX o PDF.

**Impacto:** decisiones de precio/retiro de dinero basadas en números ficticios; falsa expectativa de contar con documentación fiscal utilizable.

**Criterio de aceptación:** retirar estas pantallas del alcance entregable o marcarlas inequívocamente como demostración sin cifras que parezcan reales. Para declararlas operativas, las métricas deben reconciliar con fuentes persistentes y los archivos deben existir y validarse.

**Revalidación del indicio anterior:** “contabilidad es un alert” era demasiado amplio. El libro diario tiene APIs reales, aunque mal conectado y con formularios bloqueados. **Las exportaciones sí son `alert`, y rentabilidad/reportes sí son demostración.**

### 12. Dashboard No Calcula Una Facturación Consolidada Consistente

**Estado: confirmado.**

**Evidencia:** `features/dashboard/DashboardOverview.tsx:104-126,196-218,402-418`.

El KPI calcula:

```ts
Math.max(orderRevenue + repairRevenue, movementRevenue + repairRevenue, orderRevenue)
```

El gráfico, en cambio:
- Suma pedidos salvo `cancelled`, incluyendo pendientes o rechazados.
- Suma además los movimientos de venta.
- Suma presupuestos de reparaciones finalizadas por fecha de creación.

**Escenario numérico:** web cobrada 100 y POS independiente 50, sin reparaciones: KPI 100; gráfico 150. Si existe un pedido pendiente adicional, el gráfico también lo trata como facturación.

Si una misma venta web aparece como pedido y movimiento, el gráfico puede contarla dos veces. Esa duplicación concreta depende del contrato público; la falta de deduplicación está confirmada.

**Impacto:** cifras incompatibles en la misma pantalla y confusión entre presupuesto, pedido, venta y cobro.

**Criterio de aceptación:** definir y usar una fuente canónica por hecho, distinguir facturación de cobranza y unificar reglas de estado/fecha. KPI y gráfico deben reconciliar para el mismo período y no duplicar ventas omnicanal.

### 13. SQL Permite Dos Asientos Para Un Mismo Evento Fuente Bajo Concurrencia

**Estado: defecto confirmado por inspección; intercalado concurrente pendiente de reproducción.**

**Evidencia:** `SQL-Finanzas-Final:32-51,56-62,114-119`; `SQL-Finanzas:128`.

`post_journal_entry` consulta si existe el evento antes de adquirir el bloqueo del período. Dos transacciones con el mismo origen y distintas `operation_key` pueden superar esa consulta.

Cada una puede crear su asiento. Al insertar el vínculo de origen, la segunda usa:

```sql
on conflict (...) do nothing
```

El conflicto evita el segundo vínculo, **no revierte el segundo asiento**.

**Impacto:** doble contabilización del mismo hecho, con uno de los asientos sin vínculo autoritativo en `accounting_source_events`.

**Criterio de aceptación:** dos sesiones concurrentes publicando el mismo origen deben dejar exactamente un asiento primario. La deduplicación debe realizarse dentro de la sección protegida o hacer que el conflicto revierta la transacción completa.

### 14. SQL De Despacho Bloquea Después La Entrega Del Pedido

**Estado: confirmado en SQL versionado.**

**Evidencia:**
- `SQL-Ventas:2090-2102`: `fulfill_web_order` agrega estado `fulfilled` y entrega `dispatched`.
- `SQL-Ventas:1975-1984`: `record_web_order_event` rechaza cambios logísticos cuando el pedido está `fulfilled`.

**Escenario:** procesar correctamente un pedido pagado, despacharlo y luego intentar marcarlo entregado.

La transición `dispatched → delivered` está enumerada como válida, pero queda bloqueada antes por el estado `fulfilled`.

**Impacto:** incluso reconectando la UI al backend, el ciclo logístico no puede terminar por ese comando.

**Criterio de aceptación:** secuencia completa `preparing → fulfillment/despacho → delivered → returned`, cuando corresponda, conservando estados financieros y sin repetir movimientos de stock.

### 15. No Hay Un Circuito Operable De Devolución Completa Entre Las Pantallas Y El Backend

**Estado: confirmado en el alcance inspeccionado.**

**Evidencia:**
- `features/pos/PosWorkspace.tsx:200-220,261-276`: comprobante local, sin consulta/reversa de venta.
- `features/onlineorders/OnlineOrdersWorkspace.tsx:83-96,332-339`: cancelar únicamente cambia `status`.
- `SQL-Ventas:1502-1557`: sí existe cancelación total ERP con compensaciones.
- `supabase/tests/database/erp_sales_cash_orders.test.sql:588-609`: el refund de un pedido ya fulfilled se conserva como **unapplied**, indicando que falta un comando atómico de compensación.
- `SQL-Finanzas-Final:151-265`: el cobro de cuotas no ofrece aquí un comando compensatorio.

**Impacto:** no se puede resolver desde estas pantallas una devolución con devolución de dinero, restauración de stock/costo y corrección de deuda/contabilidad. Cambiar el estado o hacer un contrasiento manual no equivale a resolver todo el negocio.

**Criterio de aceptación:** seleccionar operación original y ejecutar devolución con motivo, trazabilidad y efectos compensatorios únicos. Diferenciar devolución física, anulación financiera y reembolso externo. Si devoluciones parciales quedan fuera del MVP, debe existir una limitación explícita y un procedimiento seguro para las totales.

**Hallazgos P2**

### 16. Errores De Lectura Se Convierten En “No Hay Datos”

**Estado: confirmado.**

**Evidencia:**
- `features/finance/api.ts:32-95`.
- `features/pos/api.ts:9-24`.
- `features/cash/api.ts:9-24`.
- `features/dashboard/DashboardOverview.tsx:365-400,426-428`.
- `features/pos/PosWorkspace.tsx:104-107,330-335`.

Finanzas devuelve `[]` ante errores. Dashboard ignora el campo `error` de sus consultas. POS registra errores de carga en consola y puede mostrar catálogo vacío.

**Impacto:** problemas de permisos, esquema o conexión parecen ausencia de deuda, asientos o productos.

**Criterio de aceptación:** diferenciar carga, vacío y error; conservar datos anteriores identificados como desactualizados y ofrecer reintento. Un error simulado no debe producir un “saldo cero” aparentemente válido.

### 17. Indicadores De Salud Y Balance Son Constantes

**Estado: confirmado.**

**Evidencia:**
- `features/dashboard/DashboardOverview.tsx:669-685`: “Caja 01 Abierta”, “Conectada”, rol y sucursal fijos.
- `features/finance/AccountingWorkspace.tsx:533-539`: “Balance Cuadrado 100% OK”.
- `features/finance/AccountsWorkspace.tsx:133-138`: “5.0% TNA/TEM” fijo.

**Impacto:** el sistema anuncia salud operativa sin haberla comprobado. La existencia de constraints de balance tampoco demuestra que se hayan contabilizado todas las operaciones.

**Criterio de aceptación:** derivar indicadores de datos verificables o no mostrarlos. Expresar “sin verificar/no disponible” cuando corresponda.

### 18. Idempotencia Financiera No Comprueba Que El Reintento Sea La Misma Operación

**Estado: confirmado en SQL.**

**Evidencia:**
- `SQL-Finanzas:527-528`.
- `SQL-Finanzas-Final:32-37,178-183,285-290`.
- `features/finance/AccountingWorkspace.tsx:455-457`.
- `features/finance/AccountsWorkspace.tsx:86-88`.

Varias funciones devuelven el ID existente por clave sin comparar monto, contrato, líneas u operación original. Además, reabrir ciertos formularios genera otra clave aunque el operador esté recuperando una operación incierta.

**Escenario:** reutilizar una clave de cobro con otro importe devuelve el pago anterior; reabrir un asiento tras perder la respuesta puede emitir otra clave para los mismos datos.

**Impacto:** confirmación aparente de cambios no aplicados o duplicación de una operación que el usuario considera un reintento.

**Criterio de aceptación:** misma clave y mismo contenido retorna el resultado original; misma clave con contenido distinto produce conflicto explícito; una operación incierta conserva su identidad hasta resolver su estado.

### 19. Conciliación “Exacta” Solo Compara Dos Importes Declarados

**Estado: confirmado en backend; la UI hoy además está bloqueada por el hallazgo 6.**

**Evidencia:** `SQL-Finanzas-Final:382-410`; `features/finance/AccountingWorkspace.tsx:897-915`.

La función acepta saldo de subdiario y saldo de mayor entregados por el usuario. Si coinciden, registra `matched`; no calcula el mayor ni consulta el subdiario.

**Escenario:** ingresar 0 y 0 para una cuenta con movimientos reales.

**Impacto:** registra una conciliación exitosa sin demostrar correspondencia con libros. El cierre solo busca conciliaciones existentes no coincidentes (`SQL-Finanzas-Final:368-374`), no asegura cobertura.

**Criterio de aceptación:** calcular el saldo interno desde hechos persistentes a la fecha de corte; identificar la fuente externa cuando corresponda y no denominar “conciliada” una simple igualdad manual sin evidencia.

### 20. Monedas, Centavos Y Cotización No Son Fiables Para Cobrar

**Estado: confirmado.**

**Evidencia:**
- `features/pos/PosWorkspace.tsx:75-90,166-172`.
- `lib/formatters.ts:5-14`.
- `features/finance/AccountsWorkspace.tsx:83-85,119-130,169-175`.

Problemas:
- Si no obtiene cotización, POS usa 1250 sin advertencia.
- Si hay precio ARS y USD, muestra ambos independientemente; pueden no ser equivalentes.
- Calcula USD por artículo redondeando a entero.
- `formatCurrency` elimina centavos incluso en totales operativos.
- Financiaciones suman contratos de todas las monedas y los muestran como ARS.

**Impacto:** el importe visible puede diferir del importe registrado; un total en dólares puede presentarse como pesos; cotización inválida convertida en precio aparentemente correcto.

**Criterio de aceptación:** preservar centavos en importes operativos, definir moneda de cobro y política de conversión, registrar snapshot cuando corresponda y nunca agregar monedas heterogéneas sin conversión explícita.

### 21. La Pantalla De Cuentas No Refleja Bien Saldo Ni Estado De La Financiación

**Estado: confirmado en contrato/UI versionados.**

**Evidencia:**
- `SQL-Finanzas:144,555-585`: el estado calculado existe como función separada.
- `SQL-Finanzas-Final:229-248`: el pago actualiza cuotas, no el estado del contrato.
- `features/finance/api.ts:35-37`: lee directamente el contrato.
- `features/finance/AccountsWorkspace.tsx:96,113,163,198-203`.

Se presenta `contract.status`, originalmente `current`, sin utilizar `calculate_financing_status`. La cuota distingue solo pagada versus pendiente; no muestra monto pendiente o distribución del pago parcial. Los totales son capital/financiado original, no deuda restante.

**Impacto:** contratos cancelados financieramente pueden seguir figurando vigentes; difícil decidir cuánto cobrar y a quién reclamar.

**Criterio de aceptación:** después de un pago parcial y uno final, UI y backend deben coincidir en saldo, mora, cuotas y estado del contrato, por moneda.

### 22. Consultas Completas Sin Paginación Truncan La Operación Al Crecer

**Estado: confirmado contra configuración local.**

**Evidencia:**
- `supabase/config.toml:7`: máximo 1000 filas.
- `features/onlineorders/OnlineOrdersWorkspace.tsx:64-67`.
- `features/dashboard/DashboardOverview.tsx:365-398`.
- `features/pos/PosWorkspace.tsx:80-84`.
- `features/finance/api.ts:32-95`.

Se carga un conjunto limitado y después se buscan registros o calculan totales en memoria.

**Impacto:** pedidos antiguos dejan de encontrarse; productos fuera de la primera página no se venden desde POS; dashboard y finanzas presentan acumulados parciales sin advertirlo.

**Criterio de aceptación:** pruebas con más de 1000 registros; búsqueda/paginación servidor y agregados independientes del tamaño de página. Identificar claramente cualquier período o límite aplicado.

### 23. API De “Cajas Abiertas” Incluye Sesiones Cerradas

**Estado: confirmado, actualmente latente porque la pantalla no utiliza esta API.**

**Evidencia:** `features/cash/api.ts:9-19`; `SQL-Ventas:802-807,105-119`.

`listOpenCashSessions` consulta todas las sesiones. En el modelo SQL el cierre está en `cash_closures`, no en un campo de la sesión, y no se excluye.

**Impacto:** al conectar la pantalla sin corregir el contrato, se ofrecerían sesiones cerradas como abiertas; los cobros serían rechazados por el backend.

**Criterio de aceptación:** abrir, cerrar y volver a consultar: la sesión cerrada no puede aparecer en la lista de disponibles.

**Matriz De Madurez**

| Módulo/capacidad | Estado actual | Qué existe realmente | Qué impide entregarlo como operativo |
|---|---|---|---|
| POS catálogo/carrito | Parcial real | Lee catálogo público y calcula carrito | Stock/precios antiguos, sin variantes/unidades identificadas en el checkout |
| POS venta/cobro | Parcial inseguro | Escrituras independientes y ticket local | No usa venta transaccional, ignora errores, no conserva medio de pago |
| Caja | Demo persistida localmente | Objetos en localStorage | Saldo ficticio, sin ledger ni arqueo real |
| Backend ventas/caja | Implementación real en SQL, no verificada en ejecución | Locks, pagos, stock/costo, cierre y cancelación | Pantallas desconectadas y puente contable faltante |
| Cuentas corrientes | Parcial bloqueado | Lectura de contratos y RPC de cuotas | UUID inválidos, esquema equivocado, sin deuda de venta integrada |
| Libro diario | Parcial bloqueado | APIs de asiento, reversa, período y conciliación | Formularios, esquema, automatización e idempotencia incompletos |
| Rentabilidad | Demo | Tablas y KPI literales | No usa ingresos/costos reales |
| Informes fiscales/exportación | Demo | Presentación y `alert()` | No genera archivos ni importes reales |
| Pedidos online | Parcial real sobre contrato público | Lectura y edición de `orders` | Mezcla pago/logística, sin fulfillment ERP conectado |
| Backend pedidos ERP | Parcial real | Reservas, eventos de proveedor y fulfillment | Entrega post-fulfillment bloqueada; refund posterior sin compensación |
| Dashboard | Parcial real con indicadores ficticios | Lecturas públicas | Fórmulas inconsistentes, errores silenciados, caja/conexión fijas |

**Trazabilidad Actual**

| Paso | Pantalla actual | Backend ERP disponible |
|---|---|---|
| Venta | No crea una venta ERP desde POS | `create_sale` persiste cabecera y líneas |
| Cobro | Medio de pago solo en ticket React | `record_sale_payment_core` registra pagos y controla sobrepago |
| Stock | `UPDATE` absoluto + movimiento separado | Documento transaccional, ubicación, variante/unidad y reservas |
| Costo | No se invoca desde POS actual | `SQL-Costos:513-518` integra procesamiento de costo |
| Caja | Saldo local independiente | Movimientos por pago y cierre por moneda |
| Cuenta del cliente | Nombre libre en ticket | Receivable y entradas operativas por venta/pago |
| Contabilidad | Manual, actualmente bloqueada | RPC de asientos, sin automatización operativa encontrada |
| Devolución | Sin circuito integrado | Cancelación total ERP existente, con huecos en web/financiación |

**Controles Que Sí Existen**
No corresponde describir todo el backend como un mock ni afirmar que carece de protección:

- `SQL-Ventas:1163-1167` protege creación de venta con lock y clave/hash.
- `SQL-Ventas:212-217` contrasta matemáticamente descuento, impuesto y total de línea. **No es correcto afirmar que el SQL acepta cualquier impuesto incoherente.**
- `SQL-Ventas:999-1046` bloquea la venta para cobrar, exige sesión adecuada y rechaza sobrepago.
- `SQL-Ventas:919-969` coordina cierre y movimientos y exige contar las monedas abiertas.
- `SQL-Ventas:1528-1546` compensa stock, pagos y cuenta en cancelación total.
- Los triggers y grants de `SQL-Ventas:2231-2388` protegen hechos operativos y separan eventos del proveedor de las acciones del operador.
- `SQL-Costos:513-518` enlaza el documento físico con el procesamiento de costo.

Estas garantías pertenecen a los comandos ERP; **no se trasladan automáticamente a escrituras sobre otras tablas desde las pantallas**.

**Pruebas Y Gaps**

| Evidencia existente | Cobertura estática observada | Gap relevante |
|---|---|---|
| `features/finance/FinanceWorkspace.test.tsx:17-31,46-92` | Estados vacíos, permisos, render de campos/acciones, validación de ID y existencia de wrapper | No envía formularios reales; mocks ocultan esquema y UUID inválidos |
| `App.test.tsx:66-137` | Navegación y encabezados | No demuestra que una venta, caja o pedido funcione |
| `supabase/tests/database/erp_sales_cash_orders.test.sql:231-283` | Venta mixta, pagos parciales, receivable, stock/costo e idempotencia secuencial | No cubre el checkout que monta la aplicación |
| Mismo test `:328-376` | Arqueo y devolución a caja abierta posterior | No cubre localStorage ni integración UI |
| Mismo test `:541-609` | Preparación, fulfillment y refund no aplicado | No intenta la entrega posterior que el SQL bloquea |
| Mismo test `:615-637` | Cancelación total y compensación | No prueba devoluciones desde la UI ni devolución parcial |
| `supabase/tests/erp_finance_accounting.test.sql:7-117` | Predominan existencia de tablas/funciones/constraints, RLS y búsqueda de texto en funciones | No demuestra creación/pago/asiento exitosos, concurrencia ni conciliación de negocio |
| `supabase/tests/database/erp_stock_cost_ledger.test.sql` | WAC, costo serializado, reversión histórica y atomicidad de valoración | No demuestra que POS público use ese ledger |

No encontré tests dedicados de `PosWorkspace`, `CashWorkspace`, `OnlineOrdersWorkspace` o `DashboardOverview` en `apps/erp`. Los tests SQL revisados no constituyen una prueba multi-sesión de concurrencia.

**No ejecuté ninguno y no atribuyo estado aprobado o fallido a las suites.**

**Verificación Del Coordinador**
Antes de una entrega, priorizaría estas comprobaciones locales:

1. Obtener el DDL real del contrato público: tablas, triggers, policies y `decrement_stock`; resolver si hay algún puente público→ERP y documentarlo.
2. Venta POS con fallo en la segunda línea: comprobar rollback, mensaje y recuperación.
3. Última unidad vendida simultáneamente por POS y web; repetir desde dos pestañas.
4. Reintentar una venta/cobro después de perder la respuesta, verificando una única operación persistente.
5. Apertura, venta en efectivo, cobro no efectivo, retiro y cierre con diferencia; repetir consultas desde otro navegador.
6. Crear financiación, cobrar parcial/final, publicar asiento, revertirlo y conciliar usando los formularios visibles.
7. Dos transacciones publicando el mismo evento contable con distintas claves.
8. Pedido pagado → preparación → despacho → entrega → devolución, comprobando independencia de pago/logística.
9. Fallo intermedio del webhook y recuperación sin stock omitido ni duplicado.
10. Dataset superior a 1000 registros y operaciones con centavos y monedas distintas.

**Conclusión Para Entrega**
El problema principal no es falta de sofisticación empresarial: **los circuitos básicos no están cerrados**. Para un propietario único, el mínimo sigue siendo poder vender una vez, saber qué cobró, descontar exactamente lo entregado, cerrar una caja real y corregir un error sin perder trazabilidad.

El backend existente ofrece una base aprovechable. La entrega debe condicionarse a conectar y verificar esos circuitos, retirar las demostraciones engañosas y resolver los bloqueos de formularios y contratos. Hasta entonces, la interfaz actual no debería presentarse como fuente autoritativa de ventas, efectivo disponible, deuda, rentabilidad o obligaciones fiscales.
