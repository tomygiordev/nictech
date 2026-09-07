# Auditoría ERP: Inventario y Compras

Fecha: **2026-09-07**.

Modalidad: **revisión estática, no runtime**. Informe completo de la auditoría de catálogo, stock y compras en `A:\nictech`. Persistido sin repetir la auditoría ni modificar código.

## Hallazgos

**No recomendaría entregar estos módulos como ERP operativo para gestionar fundas con variantes.** Los problemas históricos siguen presentes en el código actual. La base SQL tiene capacidades reales que las pantallas revisadas no utilizan.

No encontré evidencia suficiente para clasificar un **P0**. Los **P1** siguientes bloquean la entrega funcional o pueden generar una confirmación engañosa de operaciones.

La revisión fue estática y de solo lectura. No ejecuté tests, comandos de base de datos, instalaciones ni accesos remotos. No modifiqué archivos durante la auditoría. Los resultados describen el código y las migraciones disponibles, no certifican el estado de una base desplegada. La persistencia posterior de este informe es exclusivamente documental.

### 1. P1: Catálogo y stock no operan sobre el modelo ERP definido por las migraciones

**Evidencia**
- `apps/erp/src/features/catalog/CatalogWorkspace.tsx:79-82`: consulta `products` con columnas `name`, `price`, `price_usd`, `stock`.
- `apps/erp/src/features/catalog/CatalogWorkspace.tsx:136-145`: alta en esa misma tabla.
- `apps/erp/src/features/stock/StockWorkspace.tsx:66-78`: consulta `inventory_movements` y `products`.
- `apps/erp/src/lib/supabase.ts:20-26`: el cliente no configura `db.schema: "erp"`. Los componentes tampoco usan `.schema("erp")`.
- `supabase/migrations/202608190002_erp_master_data.sql:175-243`: el catálogo ERP real es `erp.products`, con `internal_code`, `internal_name`, tipo de producto, unidad, etc.
- `supabase/migrations/202608190003_erp_inventory_ledger.sql:153-188`: el inventario ERP usa `erp.stock_movements` y `erp.stock_balances`.

**Escenario e impacto:** se crea una funda desde “Catálogo Maestro” esperando que forme parte del inventario y las compras ERP. La pantalla escribe en el contrato legacy, no en el maestro ERP. En una instalación construida únicamente con las migraciones suministradas, esas tablas legacy no están definidas; si existen en otra base, son un contrato distinto.

**Reglas y triggers:** no encontré en las migraciones suministradas tablas, vistas o triggers que conecten `public.products`/`inventory_movements` con ese ledger ERP. Esto **no demuestra** que una base remota carezca de triggers adicionales.

**Recomendación / aceptación:** conectar las pantallas al modelo ERP o documentar e implementar explícitamente un puente transaccional. Un producto creado desde UI debe poder consultarse con el mismo identificador en catálogo, orden de compra, recepción y saldo ERP, sin altas duplicadas.

### 2. P1: No existe identificación operativa de variantes en catálogo, stock ni compras

**Evidencia**
- `apps/erp/src/features/catalog/CatalogWorkspace.tsx:25-38`: el tipo de producto no contiene variantes, modelo ni identificadores comerciales.
- `apps/erp/src/features/catalog/CatalogWorkspace.tsx:136-145`: el alta solo registra nombre, precios, stock, descripción y estado.
- `apps/erp/src/features/stock/StockWorkspace.tsx:46`: el selector conserva únicamente `id`, `name`, `stock`.
- `apps/erp/src/features/stock/StockWorkspace.tsx:117-125`: el movimiento no envía `variant_id`.
- `apps/erp/src/features/purchases/PurchasesWorkspace.tsx:22-29`: los artículos comprados son un único `string`.
- `supabase/migrations/202608190002_erp_master_data.sql:246-285`: sí existen variantes con atributos e identificadores asociados a variante en el modelo ERP.

**Escenario:** “Funda iPhone 13” tiene cinco negras y dos rosas. El operador quiere recibir tres rosas o descontar una negra dañada.

**Impacto:** las pantallas no permiten seleccionar ni demostrar cuál variante se está operando. Un saldo total de siete unidades no resuelve esa necesidad. Tampoco se puede registrar desde estas pantallas un identificador escaneable por combinación.

**Recomendación / aceptación:** toda línea relevante debe conservar `product_id` y, cuando corresponda, `variant_id`, mostrando modelo/color/tipo e identificador inequívoco. Recibir tres rosas debe modificar exclusivamente su saldo; descontar una negra debe dejar intacto el rosa.

### 3. P1: Compras y proveedores son registros locales con datos ficticios presentados como operativos

**Evidencia**
- `apps/erp/src/features/purchases/PurchasesWorkspace.tsx:42-52`: órdenes y proveedores precargados, incluidos importes y deuda.
- `apps/erp/src/features/purchases/PurchasesWorkspace.tsx:65-73`: carga desde `localStorage`, con esos defaults.
- `apps/erp/src/features/purchases/PurchasesWorkspace.tsx:93-99`: la persistencia consiste en escribir esas dos claves.
- `apps/erp/src/features/purchases/PurchasesWorkspace.tsx:130-131` y `153-154`: confirma emisión/registro tras cambiar estado React.
- `apps/erp/src/features/purchases/PurchasesWorkspace.tsx:149`: todo proveedor nuevo nace con saldo cero.
- `apps/erp/src/features/purchases/PurchasesWorkspace.tsx:350-351`: saldo cero se muestra como “Al día”.

**Escenario:** el dueño registra un proveedor y una compra desde su computadora; posteriormente entra desde otro navegador o pierde el almacenamiento del sitio.

**Impacto:** los registros no están persistidos en el ERP. En un navegador nuevo aparecen compras y proveedores ficticios. “Al día” no representa una conciliación de obligaciones reales. Las claves tampoco están separadas por organización o usuario.

**Recomendación / aceptación:** persistir proveedores y órdenes en sus entidades ERP y calcular deuda desde hechos contables. Un navegador nuevo debe recuperar exactamente los registros del negocio; un entorno sin datos debe mostrarse vacío, no precargado con compras demo.

### 4. P1: No hay recepción, ni parcial ni total, desde la UI de compras

Es distinto del problema de almacenamiento: reemplazar `localStorage` por una tabla **no completaría** el circuito.

**Evidencia**
- `apps/erp/src/features/purchases/PurchasesWorkspace.tsx:120-128`: toda orden nueva queda en `approved`.
- `apps/erp/src/features/purchases/PurchasesWorkspace.tsx:275-293`: la tabla solo muestra las órdenes; no ofrece recibir, registrar cantidades ni completar pendientes.
- `apps/erp/src/features/purchases/PurchasesWorkspace.tsx:385-403`: proveedor y mercadería son texto libre.
- `apps/erp/src/features/purchases/PurchasesWorkspace.tsx:117-125`: costos representados por totales manuales, sin cantidades/costos por línea.
- `supabase/migrations/202608190004_erp_purchases_costs_pricing.sql:904-910`: existe `erp.post_purchase_receipt`, pero este workspace no lo invoca.

**Escenario:** se encargan veinte fundas negras y veinte rosas; llegan ocho negras y doce rosas, con un flete.

**Impacto:** no se puede registrar lo recibido, mantener el pendiente, asignar flete por línea, actualizar costo ni generar la obligación al proveedor desde esta pantalla. El estado demo “Recibido en Stock” no prueba que se haya producido ningún ingreso.

**Recomendación / aceptación:** orden con proveedor referenciado y líneas estructuradas; recepción por línea/variante y ubicación; cantidades pendientes; costos, gastos y obligación ligados al recibo. La segunda recepción debe completar el remanente y un reintento no debe duplicar stock, costo ni deuda.

### 5. P1: Stock confirma éxito aunque fallen sus escrituras

**Evidencia**
- `apps/erp/src/features/stock/StockWorkspace.tsx:111-125`: ejecuta el `update` y el `insert` sin inspeccionar `error`.
- `apps/erp/src/features/stock/StockWorkspace.tsx:127-133`: muestra éxito, cierra el formulario y recarga.
- `apps/erp/src/features/stock/StockWorkspace.tsx:66-72`: tampoco inspecciona errores al consultar movimientos.
- `apps/erp/src/features/stock/StockWorkspace.tsx:281-285`: una consulta fallida que devuelva `data: null` termina presentada como “No hay movimientos registrados”.

**Escenario:** PostgREST devuelve un error de permisos, validación o tabla inexistente. Esas respuestas normales del cliente no necesitan lanzar una excepción.

**Impacto:** el operador recibe una confirmación que no acredita persistencia. El `catch` existente no corrige el descarte de errores devueltos como resultado.

**Recomendación / aceptación:** comprobar resultados de lectura y escritura y confirmar únicamente la operación realmente persistida. Simular rechazo de cada escritura debe mostrar error, preservar los datos del formulario y no producir un mensaje de éxito.

### 6. P2: Depósitos y conteos muestran capacidades que no están implementadas

**Evidencia**
- `apps/erp/src/features/stock/StockWorkspace.tsx:215-217`: “Depósito Principal” usa cantidades multiplicadas por `1.5` y artículos por `0.8`; el laboratorio muestra `45` artículos y `110` unidades constantes.
- `apps/erp/src/features/stock/StockWorkspace.tsx:248`: “Ver Movimientos” no filtra por depósito.
- `apps/erp/src/features/stock/StockWorkspace.tsx:346-367`: conteos consiste en texto informativo y abrir el mismo ajuste.
- `apps/erp/src/features/stock/StockWorkspace.tsx:103-104`: el tipo `adjustment` siempre transforma la cantidad en positiva.

**Escenario:** el dueño consulta dónde están sus fundas o usa “Ajuste de Auditoría” para corregir un faltante.

**Impacto:** las existencias por depósito no corresponden a ubicaciones persistidas. No hay sesión de conteo, stock teórico capturado, cantidad contada ni cálculo de diferencias; la modalidad de auditoría no permite por sí misma un ajuste negativo.

**Recomendación / aceptación:** mostrar únicamente ubicaciones y saldos reales. Un conteo de ocho frente a diez debe proponer `-2`, conservar la evidencia y registrar un documento identificable. Si no se implementa, no presentarlo como capacidad disponible.

### 7. P2: Las etiquetas no codifican el producto ni generan las copias solicitadas

**Evidencia**
- `apps/erp/src/features/stock/StockWorkspace.tsx:400-404`: el formato no tiene estado ni tratamiento.
- `apps/erp/src/features/stock/StockWorkspace.tsx:422-430`: se muestra un icono `Barcode`, ocho caracteres del UUID y la cantidad como texto.
- `apps/erp/src/features/stock/StockWorkspace.tsx:439`: la acción es `window.print()`.
- `apps/erp/src/features/stock/StockWorkspace.tsx:463`, `473`, `483`, `493`: los lotes rápidos únicamente muestran `alert`.

**Escenario:** imprimir veinte etiquetas de una variante para identificar físicamente las fundas.

**Impacto:** el dibujo no codifica un identificador escaneable del artículo; la cantidad no genera veinte etiquetas. Los lotes no ejecutan lo que anuncian.

**Recomendación / aceptación:** generar un código real a partir del identificador persistido de producto/variante y renderizar las copias/formato pedidos. Un escáner debe recuperar inequívocamente la variante etiquetada.

### 8. P2: Catálogo y selectores pueden omitir artículos silenciosamente al superar el límite de filas

**Evidencia**
- `apps/erp/src/features/catalog/CatalogWorkspace.tsx:79-82`: carga sin paginación.
- `apps/erp/src/features/catalog/CatalogWorkspace.tsx:106-120`: búsqueda y totalización se hacen sobre lo descargado.
- `apps/erp/src/features/stock/StockWorkspace.tsx:75-78`: selector de productos también sin paginación.
- `supabase/config.toml:7`: límite local `max_rows = 1000`.

**Escenario:** el catálogo crece por combinaciones de modelos y accesorios y supera mil productos.

**Impacto:** la búsqueda puede no encontrar artículos existentes y los indicadores dejan de representar el catálogo completo. La selección de stock puede excluir productos sin advertencia.

**Recomendación / aceptación:** búsqueda/paginación del lado servidor y agregados independientes de la página. Con 1.001 artículos, el último debe ser localizable y operable; los totales deben incluirlos todos.

### 9. P2: El SQL no aplica la regla de unidades indivisibles

**Hecho del backend SQL; no demostrado mediante la UI actual.**

**Evidencia**
- `supabase/migrations/202608190002_erp_master_data.sql:142`: `units_of_measure.allows_decimals` existe y por defecto es `false`.
- `supabase/migrations/202608190004_erp_purchases_costs_pricing.sql:749-764`: la orden valida cantidad positiva, pero no consulta esa regla.
- `supabase/migrations/202608190004_erp_purchases_costs_pricing.sql:1083-1087`: la recepción exige cantidad uno para serializados; los productos `quantity` no tienen control de integralidad.
- `supabase/migrations/202608190003_erp_inventory_ledger.sql:451-477`: la contabilización permite cantidades positivas fraccionarias para productos `quantity`.

La búsqueda en las migraciones encontró `allows_decimals` únicamente en su declaración.

**Escenario:** un cliente de la API registra `0.5` de una funda cuya unidad no admite decimales.

**Impacto:** el modelo permite generar existencias y valorizaciones de fracciones de unidades indivisibles.

**Recomendación / aceptación:** validar la unidad de medida en comandos de compra, recepción y stock. `0.5` debe rechazarse sin efectos para “unidad” y admitirse únicamente para unidades configuradas para fracciones.

## Riesgos Condicionados

Estos puntos tienen evidencia en el cliente, pero **no afirmo que hayan corrompido una base real**. Para resolver el resultado exacto faltan las reglas desplegadas del esquema legacy.

| Candidato | Evidencia y escenario | Validación / aceptación |
|---|---|---|
| **P1: pérdida de actualizaciones y operación partida** | `StockWorkspace.tsx:106-125` calcula un saldo desde estado local y realiza dos requests independientes. Dos pestañas que leen diez y suman dos pueden enviar ambas doce. Una escritura puede quedar confirmada y la otra fallar. | Revisar los triggers del contrato efectivamente desplegado. Preferir un único comando transaccional con delta, bloqueo e idempotencia. El resultado de dos ingresos debe ser catorce y cada operación debe tener su documento. |
| **P1: saldo e historial incompatibles al exceder existencias** | `StockWorkspace.tsx:104-121`: con saldo dos y egreso cinco envía saldo cero, pero movimiento `-5`. La saturación con `Math.max` oculta el exceso en lugar de rechazarlo. | Verificar si el backend rechaza o transforma ambos pasos. Un egreso imposible debe rechazarse íntegramente; no aceptarse con saldo truncado. |
| **P1: editar precios puede sobrescribir stock reciente** | `CatalogWorkspace.tsx:165-185`: el modal captura stock al abrirse y lo vuelve a enviar incluso si solo se cambió el precio. | Comprobar protección de concurrencia legacy. Una actualización de precios no debe escribir stock; los ajustes físicos deben usar su operación dedicada. |

No corresponde afirmar “doble descuento por trigger” o “stock negativo permitido en ERP” sin esa evidencia. El ledger ERP inspeccionado tiene controles diferentes y más fuertes.

## Reglas Reales

Estas capacidades **sí existen en el SQL revisado**, aunque las pantallas auditadas no las usan:

| Aspecto | Evidencia |
|---|---|
| Proveedor válido y activo al crear una orden | `202608190004_erp_purchases_costs_pricing.sql:712-714`. FK de proveedor en `:96-97`. |
| Variante perteneciente al producto y organización | Validación al crear orden en `:759-763`; FK compuesta de línea en `:119-120`. |
| Recepción de una orden aprobada | `:1029-1030`. |
| Recepciones parciales sin superar lo pedido | `:1096-1106`: acumula recepciones previas y líneas del mismo request. |
| Serialización e idempotencia de recepción | `:1020-1027`: advisory lock, bloqueo de orden y clave/hash. |
| Gastos conciliados y costo por línea | `:1043-1061` y `:1112-1123`. |
| Stock, costos y deuda dentro del comando de recepción | `:1191-1259`. |
| Puente de costos mediante trigger | `202608190005_erp_stock_cost_ledger.sql:253-255`. **Este trigger sí resuelve la creación del hecho de costo asociado.** |
| Stock disponible y reservas | `202608190003_erp_inventory_ledger.sql:543-559`: bloqueo y control sobre disponible. |
| Excepción de stock negativo protegida | `:371-372` exige permiso; `:551-553` exige además habilitación de la ubicación. La valorización añade controles en `202608190005_erp_stock_cost_ledger.sql:385-448`. |
| Maestros con permisos y auditoría | `202608190002_erp_master_data.sql:538-543`, `613-627`. Escribir directamente un maestro no es por sí mismo un bug si estas reglas aplican. |

Rutas de la tabla relativas a `supabase/migrations/`.

## Matriz Funcional

| Módulo | Estado de la UI actual | Persistencia / capacidad efectiva |
|---|---|---|
| Catálogo | **Parcial, contrato legacy** | Lee/crea/edita productos simples; no utiliza el maestro ERP. |
| Fundas con variantes | **No operativo en estas pantallas** | No hay selección, alta ni movimientos por variante. Modelo SQL disponible. |
| Precios | **Parcial** | `CatalogWorkspace.tsx:204-214` cambia el modo/título, pero conserva el CRUD de precios legacy. No conecta listas, snapshots ni preview/apply ERP. |
| Stock y movimientos | **Parcial, riesgoso** | Lecturas legacy y ajuste en dos requests con errores ignorados. |
| Ubicaciones y traslados | **Demo/parcial** | Depósitos fabricados; no hay elección de origen y destino para un traslado real. |
| Conteos físicos | **Placeholder/parcial** | Texto informativo y ajuste genérico, sin circuito de conteo. |
| Etiquetas | **Demo/parcial** | Vista con icono e impresión de página; lotes con alertas. |
| Órdenes de compra | **Demo con almacenamiento local** | Texto e importes en `localStorage`. |
| Recepción y costos | **No conectados a UI** | Backend SQL real con recepción parcial y valorización. |
| Proveedores y deuda | **Demo con almacenamiento local** | Alta local y saldo fijo; entidades y hechos ERP disponibles pero no utilizados. |

## Tests Y Gaps

**Tests existentes, no ejecutados en esta revisión:**

| Archivo | Cobertura encontrada |
|---|---|
| `supabase/tests/database/erp_master_data.test.sql:5` | Plan de 28 assertions. Maestros, permisos, identificadores y permanencia de códigos; identificadores en `:153-238`. |
| `supabase/tests/database/erp_inventory_ledger.test.sql:5` | Plan de 77. Documentos, reservas, reversiones y serializados. Rechazo de egreso excesivo en `:334-349`. |
| `supabase/tests/database/erp_purchases_costs_pricing.test.sql:5` | Plan de 85. Parciales, idempotencia, costos y deuda en `:212-249`; exceso en `:265-275`; segunda recepción y promedio en `:279-292`. |
| `supabase/tests/database/erp_stock_cost_ledger.test.sql:5` | Plan de 67. Ledger de costos, permisos, transferencias, reversiones y valoración. |
| `apps/erp/src/App.test.tsx:91-99` | Comprueba navegación hacia catálogo y su título, no persistencia ni consistencia. |
| `packages/domain/src/modules.test.ts` y `permissions.test.ts` | Registro de módulos/workspaces y permisos. No implementan ni prueban reglas de compra/stock. |

Los planes declarados **no equivalen a tests aprobados**.

**Gaps prioritarios para el coordinador:**
1. Integración UI → API → SQL: demostrar que el alta y ajuste modifican las entidades ERP correctas.
2. Circuito completo de fundas: dos colores, recepción parcial, merma de uno, remanente y costos separados.
3. Errores HTTP/RLS de lectura y escritura: nunca presentar vacío o éxito cuando hubo fallo.
4. Atomicidad y reintentos: fallo intermedio sin efectos parciales ni duplicados.
5. Concurrencia real entre conexiones/pestañas: dos ingresos, recepción simultánea del remanente y edición de precio mientras cambia stock.
6. Recepciones con varias líneas de variantes, gastos y ubicaciones, verificando correspondencia entre cada línea, movimiento y costo.
7. Rechazo de cantidades fraccionarias para unidades indivisibles.
8. Catálogo superior a mil artículos y búsqueda de variantes.
9. Impresión con número real de etiquetas y lectura del código generado.
10. Recuperación de compras/proveedores desde otro navegador y ausencia de datos demo en producción.

**Prioridad de entrega:** primero unificar el circuito de persistencia y hacer obligatoria la identidad de variante; después conectar recepción/costos y corregir la confirmación de stock. Los tests SQL existentes son una base útil, pero no compensan que las pantallas actuales no invoquen ese backend.
