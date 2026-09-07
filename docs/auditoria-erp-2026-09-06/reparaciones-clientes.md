# Auditoría ERP Actual

Fecha: **2026-09-07**.

Metodología: **revisión estática, no runtime**. Este documento persiste íntegramente el informe de la auditoría anterior; su guardado no implica una nueva auditoría ni ejecución de verificaciones.

**El código actual no implementa un flujo ERP integrado de extremo a extremo para las áreas solicitadas.** Conviven operaciones contra tablas heredadas, registros exclusivamente locales y funciones SQL avanzadas que las pantallas no utilizan.

**Se revalidan los antecedentes principales:** siguen existiendo múltiples almacenes `localStorage`, generación aleatoria de CAE e invención de IMEI cuando se deja vacío. Además, aparecen defectos concretos en SQL que no se resuelven simplemente conectando las pantallas.

No clasifico ningún hallazgo como P0: no se constató un incidente activo, una explotación ni una destrucción general de datos. Los P1 siguientes sí justifican bloquear el uso de las capacidades afectadas como operaciones reales.

**Alcance Y Evidencia**
- Inspección del worktree actual de `A:\nictech`, incluyendo archivos modificados y no versionados que `App.tsx` monta efectivamente.
- Lectura de los siete workspaces, consumidores relacionados, migraciones, correcciones posteriores hasta `202608260020`, seed y tests.
- No se editaron archivos, ejecutaron tests/build/lint, instalaron paquetes ni consultaron DB o sistemas remotos.
- El listado de `git status --short` inicial y final es el mismo.
- «Confirmado» significa demostrable en el código inspeccionado. No significa reproducido en una DB desplegada.
- «Existe en SQL» significa declarado en las migraciones locales, no comprobado como aplicado en algún entorno.
- No se reproducen claves, tokens ni otros secretos. La evaluación de documentos se limita a la existencia de autorización real en el flujo técnico, no a un dictamen fiscal o legal.

Nota de persistencia: las afirmaciones anteriores sobre ausencia de ediciones y estado de Git corresponden a la auditoría original. Posteriormente, el usuario autorizó exclusivamente crear este documento mediante `apply_patch`.

## Hallazgos P1

### H01. Se fabrican CAE y autorizaciones sin consultar un proveedor

**Evidencia:** `apps/erp/src/features/documents/DocumentsWorkspace.tsx:131-155`.

El alta:
- Genera el número mediante `Math.random()`.
- Construye un supuesto CAE también mediante `Math.random()`.
- Asigna una fecha de vencimiento fija.
- Establece `status: "authorized"`.
- Informa que el comprobante fue «emitido y autorizado».

No hay petición HTTP, RPC, consulta de resultado ni importación de un cliente de integración en ese recorrido.

La presentación refuerza esa afirmación en `DocumentsWorkspace.tsx:201-202`, `237-240`, `404-406` y `515`: WebService ARCA, conexión homologada, CAE oficial y autorización en línea.

**Escenario:** emitir una Factura A/B/C desde el formulario. El resultado se presenta como autorizado aunque el navegador no haya contactado ningún servicio fiscal.

**Impacto:** se puede entregar o imprimir una representación de autorización inexistente. Los importes también pasan a «Total Facturado ARCA» a partir del estado local, no de una respuesta externa.

**Criterio de aceptación:** ningún documento debe mostrarse como autorizado hasta tener un resultado verificable del proveedor, asociado a la solicitud, punto de venta, ambiente y comprobante. Una simulación debe identificarse inequívocamente como tal y no producir un supuesto CAE oficial.

**Conclusión técnica:** los comprobantes creados por este handler **no obtienen autorización real**.

### H02. El canje inventa identidad y certifica verificaciones inexistentes

**Evidencia:** `apps/erp/src/features/tradeins/TradeInsWorkspace.tsx:167-186`, `279-282`, `483-485`.

Si no se ingresa IMEI/serie, se genera uno aleatorio. Con IMEI ingresado o inventado, el alta asigna incondicionalmente `imeiStatus: "clear"`.

Además:
- El indicador afirma «100% Limpios» de forma constante.
- La ficha afirma «Declaración Jurada: Firmada y Validada» de forma constante.
- El formulario no captura una declaración firmada ni su evidencia.

**Escenario:** registrar un equipo sin identificador ni documentación de procedencia. La ficha muestra un IMEI inventado, limpio, y una declaración supuestamente validada.

**Impacto:** falsa trazabilidad del equipo y de su procedencia; decisiones de aceptación basadas en controles que no ocurrieron.

**Criterio de aceptación:** conservar exclusivamente identificadores efectivamente capturados; ausencia o consulta pendiente no equivalen a limpio. La validación debe referenciar evidencia, actor, fecha y resultado de proveedor o alternativa manual autorizada.

### H03. Siete registros operativos viven en `localStorage`, sin aislamiento

**Evidencia actual:**

| Registro | Clave | Lectura / Escritura |
|---|---|---|
| Clientes | `erp_customers_list_v1` | `CustomersWorkspace.tsx:47`, `68` |
| Presupuestos | `erp_quotes_v1` | `QuotesWorkspace.tsx:42`, `64` |
| QC | `erp_qc_protocols_v1` | `RepairsWorkspace.tsx:878`, `893` |
| RMA | `erp_rma_claims_v1` | `RepairsWorkspace.tsx:1139`, `1149` |
| PC | `erp_pc_builds_v1` | `PcBuildsWorkspace.tsx:49`, `70` |
| Canjes | `erp_trade_ins_v1` | `TradeInsWorkspace.tsx:123`, `148` |
| Documentos | `erp_fiscal_docs_v1` | `DocumentsWorkspace.tsx:110`, `128` |

Los archivos están bajo `apps/erp/src/features/`, en sus carpetas correspondientes.

Las claves no contienen organización, sucursal ni usuario. El cierre de sesión en `apps/erp/src/App.tsx:217-224` no elimina estos registros.

**Escenario:** un operador registra un cliente, un presupuesto o un canje. Otra terminal no lo ve. Otro usuario que accede al mismo módulo desde el mismo origen y perfil de navegador recupera los registros anteriores.

**Impacto:** fragmentación entre terminales, mezcla entre cuentas, persistencia local de datos personales y ausencia de auditoría central. Las escrituras reemplazan arrays completos, sin coordinación entre pestañas.

**Criterio de aceptación:** persistencia transaccional central con ámbito organizacional y permisos; caché separada por identidad y contexto. Los datos de demostración no deben poblar registros presentados como operativos.

### H04. El padrón de clientes no alimenta el ingreso de reparación

**Evidencia:** `apps/erp/src/features/customers/CustomersWorkspace.tsx:75-90`; `apps/erp/src/features/repairs/RepairsWorkspace.tsx:164-180`.

El cliente recibe un identificador local `c-${Date.now()}`. La reparación vuelve a capturar nombre, teléfono y DNI como texto y escribe en `public.repairs`.

No se selecciona un `customer_id`, no se crea un `equipment_id` ni se registra titularidad. Los contadores de compras y reparaciones del cliente son valores iniciales o precargados, no agregaciones del taller.

**Escenario:** dar de alta un cliente y luego ingresar su teléfono al taller. La operación no actualiza su ficha ni su contador de reparaciones activas.

**Impacto:** no hay historial unificado cliente → equipo → órdenes; duplicados y desvinculación entre CRM, taller, canje y documentos.

**Criterio de aceptación:** la reparación referencia al cliente y al equipo persistidos, y el historial se deriva de esas relaciones. La identidad debe mantenerse durante presupuestos, entregas y reclamos.

### H05. El taller permite marcar “Finalizado” sin QC y no registra entrega

**Evidencia:** `apps/erp/src/features/repairs/RepairsWorkspace.tsx:212-234`, `578-586`, `831-921`.

Todos los estados se ofrecen directamente. El handler actualiza `public.repairs.status` sin comprobar transición, presupuesto aceptado, pruebas o entrega.

El QC:
- Se guarda en otro almacén local.
- Identifica la orden mediante texto libre.
- Inicia todos los controles en `true`.
- No distingue un protocolo de ingreso de uno de egreso.
- No participa en `handleUpdateStatus`.

`Finalizado` se presenta como «Listo para Retirar», no como un hecho de entrega. No existe en este workspace una operación que registre receptor, fecha efectiva de retiro y evidencia.

**Escenario:** crear una orden y pulsar directamente «Finalizado», sin protocolo o con un QC fallido.

**Impacto:** equipos presentados como listos sin cumplir el control técnico; imposibilidad de distinguir pendientes de retiro de equipos efectivamente entregados.

**Criterio de aceptación:** transiciones validadas en servidor; QC ligado al ID real y realizado explícitamente; entrega separada e inmutable. Los controles sin ejecutar deben ser pendientes, no aprobados.

### H06. El presupuesto no tiene aceptación real ni conexión con la reparación

**Evidencia:** `apps/erp/src/features/quotes/QuotesWorkspace.tsx:22-31`, `79-121`, `239-258`; `apps/erp/src/features/repairs/RepairsWorkspace.tsx:241-256`, `617`.

El módulo de presupuestos conserva nombre, concepto e importes globales. No contiene referencia a reparación, cliente persistido, líneas, variantes o versión.

Una cotización nueva pasa a `draft`; el envío la pasa a `sent`. No hay acción de aceptación ni consumidor de `public.respond_repair_quote`.

Por separado, el taller modifica un único `quoted_price` y lo presenta bajo «Presupuesto Aprobado», sin registrar una decisión del cliente.

**Escenario:** emitir una cotización para una reparación y que el cliente la confirme. Ese hecho no tiene recorrido implementado hasta la orden, sus repuestos o la facturación.

**Impacto:** un importe editado por el operador puede confundirse con un acuerdo aceptado. No queda prueba de qué versión aceptó el cliente.

**Criterio de aceptación:** presupuesto versionado, vinculado a la orden y con líneas congeladas; decisión trazable sobre una versión concreta; imposibilidad de sobrescribir silenciosamente lo aprobado.

### H07. “Repuestos” es un estado, no una operación de inventario

**Evidencia:** `apps/erp/src/features/repairs/RepairsWorkspace.tsx:212-228`, `578-586`.

No hay selección de repuestos, reserva, consumo, devolución ni asignación de variante/unidad. Tampoco se llaman los RPC correspondientes.

El ajuste relacionado de inventario utiliza solamente `product_id` y stock agregado: `apps/erp/src/features/stock/StockWorkspace.tsx:98-125`. No vincula el movimiento con la orden de reparación.

**Escenario:** reservar o colocar una batería o pantalla durante el trabajo. Cambiar la orden a «Repuestos» o «Reparación» no reserva ni descuenta esa pieza.

**Impacto:** materiales utilizados siguen disponibles en el sistema; no existe costo verificable por reparación ni trazabilidad del componente colocado.

**Criterio de aceptación:** reserva y consumo ligados a reparación, producto, variante y unidad cuando corresponda; movimiento físico y costo atómicos; reversión compensatoria y auditable.

### H08. Garantías/RMA no administra pólizas reales ni resolución del reclamo

**Evidencia:** `apps/erp/src/features/repairs/RepairsWorkspace.tsx:1136-1171`, `1181-1199`, `1255-1262`.

El alta acepta un código de orden libre. No busca una garantía, no comprueba vigencia ni titularidad y no enlaza con la entrega.

«Pólizas Emitidas: 124» y «Tasa de Retorno: 1.2%» son constantes. «Ver Póliza» abre un `alert` con datos del reclamo, no una póliza.

Los nuevos reclamos quedan en `open`; no hay transición operativa para revisión, reemplazo, crédito o cierre.

**Escenario:** registrar un reclamo para una orden inexistente o fuera de garantía. El componente lo incorpora igualmente.

**Impacto:** no se puede determinar cobertura, fecha inicial, pieza garantizada, antecedente o resolución efectiva.

**Criterio de aceptación:** reclamar sobre una garantía persistida derivada de una entrega, comprobar vigencia y vincular las resoluciones con sus efectos reales. Los reclamos deben conservar historial sin reescribir la reparación original.

### H09. PC “Listo/Testeado” no valida compatibilidad, componentes ni pruebas

**Evidencia:** `apps/erp/src/features/pcbuilds/PcBuildsWorkspace.tsx:20-32`, `73-107`, `254-259`, `341-386`.

CPU, GPU, RAM y almacenamiento son textos libres. No hay referencias a productos, variantes, unidades, stock o resultados de pruebas.

Se puede pasar de `assembly` directamente a `ready`. Placa madre y fuente aparecen como campos opcionales del tipo y en datos precargados, pero el alta no las captura ni valida.

**Escenario:** crear una configuración incompleta o incompatible y marcarla lista.

**Impacto:** el estado «Testeado» no acredita ninguna prueba; no se consumen componentes ni se obtiene trazabilidad para garantía o futuras reparaciones.

**Criterio de aceptación:** configuración versionada con componentes reales, compatibilidad evaluada, reserva exacta, pruebas de esa revisión y finalización que consuma inventario y congele su composición.

### H10. “Liberado a stock” y “Aplicado a venta” de canjes son solo etiquetas

**Evidencia:** `apps/erp/src/features/tradeins/TradeInsWorkspace.tsx:201-208`, `462-467`.

Cualquier estado puede asignarse desde cualquier otro. El handler únicamente modifica el array local.

Aunque existe `targetSaleId` en el tipo, no se solicita ni establece al aplicar un nuevo canje. No se registra una unidad de inventario ni un pago.

El POS montado tampoco utiliza la API ERP existente: `apps/erp/src/features/pos/PosWorkspace.tsx:174-220` modifica stock heredado y genera un recibo en memoria; no crea allí una venta ERP a la que aplicar el canje.

**Escenario:** pasar un canje recién recibido a «Aplicado a Venta».

**Impacto:** se presenta crédito aplicado sin venta ni pago verificables, y disponibilidad de stock sin ingreso real de la unidad.

**Criterio de aceptación:** liberación mediante controles de procedencia, IMEI y evaluación; ingreso de unidad/variante con costo. Aplicación únicamente a una venta real compatible, con pago idempotente y reversión controlada.

### H11. WhatsApp no envía mensajes y pierde los escritos al cambiar de hilo

**Evidencia:** `apps/erp/src/features/whatsapp/WhatsappWorkspace.tsx:80-110`, `118`, `135-140`.

«Enviar» agrega un objeto a `selectedThread.messages` y asigna `status: "sent"`. No contacta WhatsApp ni una cola de envío.

Al seleccionar un hilo se vuelve a tomar el objeto de `DEMO_THREADS`. Por eso los mensajes recién escritos desaparecen incluso al volver a seleccionar la misma conversación.

Las plantillas fijan el importe en `165.000`; los consentimientos y mensajes recibidos provienen de constantes.

**Escenario:** enviar una aprobación o aviso de retiro y cambiar de conversación.

**Impacto:** el operador cree haber notificado al cliente, pero no hubo envío; se pierde la evidencia local. «WhatsApp Conectado» no acredita conexión.

**Criterio de aceptación:** persistir un mensaje en cola, informar aceptación y estados reales del proveedor, conservar conversaciones y obtener las variables y consentimientos de registros efectivos.

### H12. La configuración permite conexión remota implícita y oculta errores

**Evidencia:** `apps/erp/src/lib/supabase.ts:12-28`.

El cliente sustituye variables ausentes por valores remotos embebidos. Si el validador rechaza la configuración, igualmente crea otro cliente con esos valores. `supabaseConfigError` queda siempre en `null`.

**Escenario:** iniciar la aplicación sin configuración local o con una URL inválida. No queda cerrada por falta de configuración: el código selecciona el destino alternativo.

**Impacto:** una sesión aparentemente local puede realizar operaciones contra otro entorno. También se pierde la capacidad de distinguir «sin configurar» de «operativo».

**Criterio de aceptación:** configuración explícita, sin sustitución silenciosa entre entornos, y fallo cerrado ante valores ausentes o inválidos.

No ejecuté la aplicación ni contacté ese destino.

### H13. Contexto y permisos del frontend no corresponden al contrato ERP local

**Evidencia:**
- `apps/erp/src/auth/ErpAuthProvider.tsx:92`, `103-105`, `138-144`.
- `apps/erp/src/lib/supabase.ts:20-26`.
- `supabase/migrations/202608190010_erp_finance_accounting.sql:369-382`.

El cliente no selecciona esquema `erp`. El proveedor solicita `get_current_erp_context` sin esquema, mientras la función local está declarada en `erp`, no en `public`.

Aun resolviendo ese punto, `hasPermission` utiliza exclusivamente `session.user.app_metadata.permissions`. El contexto SQL devuelve organización y usuario, no esa lista. La autorización DB se administra por tablas y `erp.has_permission`, no por esta lista del frontend.

En desarrollo, la sesión ficticia concede acceso y puede ocultar la diferencia.

**Escenario:** un usuario autorizado mediante roles ERP inicia sesión real sin una lista equivalente en `app_metadata`.

**Impacto:** contexto inaccesible conforme al contrato local o módulos denegados pese a roles válidos. La experiencia de desarrollo no demuestra que funcione el acceso real.

**Criterio de aceptación:** consumir explícitamente el esquema correcto y resolver permisos efectivos coherentes con DB, sucursal y revocaciones. Una sesión de demostración no debe confundirse con autenticación operativa.

### H14. SQL: la liberación de canjes admite un IMEI sin resultado

**Evidencia:** `supabase/migrations/202608190008_erp_pc_tradeins_imei.sql:767-782`.

El control utiliza:

```sql
if imei_status not in ('clear', 'not_required') then
  raise exception ...;
end if;
```

Cuando no existe resultado para la solicitud más reciente, `imei_status` es `NULL`. `NULL NOT IN (...)` no es verdadero, por lo que no se ejecuta el rechazo.

El trigger de la liberación, en el mismo archivo `:857-868`, valida la relación con stock y destino, pero no subsana el control IMEI.

**Escenario:** canje con procedencia y evaluación aprobadas, pero sin consulta IMEI o con una solicitud pendiente sin resultado.

**Impacto:** el procedimiento puede continuar hacia el ingreso a stock sin verificación efectiva. También afecta al equipo sin IMEI que todavía no tiene constancia de `not_required`.

**Criterio de aceptación:** ausencia, pendiente y desconocido deben bloquear. Solo un resultado efectivo permitido para la identidad y solicitud vigentes puede autorizar la liberación.

**Relacionado:** el fallback manual en `:705-708` repite el problema con `latest_provider_status NOT IN ('unavailable','error')`: una solicitud existente sin resultado puede habilitar el recorrido manual. Debe exigir explícitamente un resultado previo de error o indisponibilidad.

Estos defectos están en SQL aunque la pantalla actual no lo invoque.

### H15. SQL: el reacondicionamiento referencia una tabla no declarada

**Evidencia:** `supabase/migrations/202608190008_erp_pc_tradeins_imei.sql:730`.

`record_trade_in_refurbishment` comprueba entrega contra:

```sql
erp.repair_delivery_events
```

La tabla declarada es `erp.repair_deliveries`, en `supabase/migrations/202608190007_erp_repairs_quotes_warranties.sql:528`.

La búsqueda del conjunto de migraciones no encontró una definición de `repair_delivery_events` ni una corrección posterior de esa referencia.

**Escenario:** registrar reacondicionamiento asociado a una reparación mediante `target_repair_order_id`.

**Impacto:** sobre el esquema construido con estas migraciones, esa rama consulta una relación inexistente; no completa la vinculación y derivación del costo de reparación.

**Criterio de aceptación:** utilizar el hecho de entrega existente y verificar un recorrido que incluya reparación entregada, piezas/mano de obra y costo incorporado al canje.

No afirmo que se haya ejecutado esa rama en una DB desplegada.

### H16. SQL: cambiar repuestos después del QC no invalida la elegibilidad de entrega

**Evidencia:** `supabase/migrations/202608190007_erp_repairs_quotes_warranties.sql:870-895`, `1095-1124`, `1288`.

`repair_latest_final_test_passes` compara la fecha del último QC con eventos de estado no terminales.

El consumo o reversión de repuestos no forma parte de ese cálculo. Los procedimientos correspondientes tampoco exigen que la orden no esté ya en estado terminal.

**Escenario:** registrar QC aprobado, marcar la orden lista, consumir o revertir una pieza y entregar sin repetir las pruebas.

**Impacto:** la entrega se apoya en un QC anterior a la última modificación material del equipo.

**Criterio de aceptación:** toda intervención relevante posterior al QC debe invalidarlo o exigir otro control. La entrega debe comprobar que el QC cubre la última intervención, no únicamente el último cambio de estado.

### H17. SQL: la revisión de PC conserva referencias ambiguas a columnas y variables

**Evidencia:** `supabase/migrations/202608190008_erp_pc_tradeins_imei.sql:505`, `519-520`.

`create_pc_build_revision` declara variables `product_id` y `variant_id`, y luego utiliza nombres sin calificar en consultas sobre tablas que contienen esas mismas columnas.

Ejemplos:
- `product_id=create_pc_build_revision.product_id`
- `variant_key=coalesce(variant_id, ...)`
- `u.variant_id is not distinct from variant_id`

La tabla de costos declara ambos campos en `supabase/migrations/202608190004_erp_purchases_costs_pricing.sql:287-304`.

**Escenario:** crear una revisión con un componente de cantidad o serializado y consultar su costo autoritativo.

**Impacto:** con la resolución estándar de conflictos de PL/pgSQL, estas referencias son ambiguas. Cambiar globalmente la política de resolución tampoco demostraría que se esté seleccionando la variante correcta.

**Criterio de aceptación:** referencias inequívocas y escenarios de comportamiento con dos variantes del mismo producto, además de unidades serializadas.

No encontré una corrección posterior para esta función. Las correcciones de nombres de presupuestos no modifican automáticamente la función de PC.

## Hallazgos P2

### H18. El historial de reparación puede fallar silenciosamente o corresponder a otra ficha

**Evidencia:** `apps/erp/src/features/repairs/RepairsWorkspace.tsx:132-155`, `184-195`, `222-234`.

El alta y el cambio de estado hacen una segunda escritura para el log, pero no comprueban su error. Se informa éxito aunque falte el historial.

Además, `fetchLogs`:
- No vacía los logs anteriores al cambiar de orden.
- No presenta el error de consulta.
- No descarta respuestas pertenecientes a una selección anterior.

**Escenario:** abrir la orden A y luego B rápidamente; la respuesta de A llega última. O falla la consulta de B y permanecen los logs previos.

**Impacto:** avances incompletos o atribuidos visualmente a otro equipo; pérdida de confianza en la trazabilidad.

**Criterio de aceptación:** operación de negocio e historial atómicos; consultas identificadas por orden y respuestas obsoletas descartadas; errores visibles sin reutilizar datos ajenos.

### H19. Documentos: numeración, anulación y archivo no representan operaciones reales

**Evidencia:** `apps/erp/src/features/documents/DocumentsWorkspace.tsx:135-175`, `469-470`.

Problemas independientes dentro del recorrido:
- Elegir PV 0002 no cambia el `-0001-` del número generado.
- «Anular» solo establece `voided` en el array y afirma «anulado formalmente».
- «Imprimir / PDF» ejecuta `window.print()`.
- `pdfStoragePath` se construye, pero no se genera, sube ni recupera el archivo.

**Escenario:** emitir en PV 0002, anular y buscar después el archivo digital anunciado.

**Impacto:** identificación interna inconsistente, anulación sin evento externo o compensatorio y archivo digital que no existe en el recorrido implementado.

**Criterio de aceptación:** numeración asociada al punto y tipo correctos; distinguir anulación interna de cualquier operación externa; documento persistido y recuperable, con contenido y referencia verificables.

### H20. Enviar una cotización degrada una aprobación y afirma un envío no confirmado

**Evidencia:** `apps/erp/src/features/quotes/QuotesWorkspace.tsx:112-121`.

El handler establece `status: "sent"` para cualquier cotización, incluso una que figure como `approved`, antes de abrir WhatsApp.

**Escenario:** reenviar una cotización aprobada o cancelar el envío en la ventana de WhatsApp.

**Impacto:** se pierde el estado aprobado o se registra «enviado» sin que haya ocurrido.

**Criterio de aceptación:** compartir debe conservar la decisión comercial. Abrir un enlace debe registrarse como apertura/compartición, no como entrega confirmada del mensaje.

### H21. Validez e importes carecen de controles coherentes

**Evidencia:** `apps/erp/src/features/quotes/QuotesWorkspace.tsx:83-99`, `112-121`, `314-343`; `apps/erp/src/features/documents/DocumentsWorkspace.tsx:133-149`, `500-508`.

Se aceptan importes negativos en los formularios locales. En cotizaciones pueden ingresarse ARS y USD contradictorios, porque se conservan ambos sin validación de consistencia.

`validUntil` no participa en el estado ni bloquea el envío de una cotización vencida. La consulta de dólar ignora el campo `error` y puede mantener silenciosamente `1250` mientras el formulario habla de «dólar del día».

**Escenario:** emitir un presupuesto con ARS negativo, con dos montos incompatibles o enviarlo después de su fecha de validez.

**Impacto:** compromisos comerciales incorrectos y cotizaciones presentadas sin advertencia de vencimiento o tipo de cambio de respaldo.

**Criterio de aceptación:** validar importes y política de conversión, congelar origen/fecha de cambio y distinguir explícitamente vencido, vigente y tipo de cambio no disponible.

### H22. Fechas civiles pueden mostrarse un día antes

**Evidencia:** `apps/erp/src/lib/formatters.ts:35-44`; `apps/erp/src/features/quotes/QuotesWorkspace.tsx:97`, `230`.

Se guarda una fecha como `YYYY-MM-DD` y luego se convierte mediante `new Date(...)` para representarla en hora local.

**Escenario:** en Argentina, una fecha como `2026-09-14` representa medianoche UTC y puede visualizarse como `13/09/2026`.

**Impacto:** divergencia entre la fecha de vencimiento guardada y la comunicada al cliente. El patrón también aparece al presentar fechas de reclamos.

**Criterio de aceptación:** tratar las fechas sin hora como fechas civiles, sin conversión de zona horaria.

### H23. Identificadores aleatorios pequeños pueden afectar varios registros a la vez

**Evidencia:**
- `apps/erp/src/features/quotes/QuotesWorkspace.tsx:83`, `119`, `126`.
- `apps/erp/src/features/pcbuilds/PcBuildsWorkspace.tsx:77-79`, `100-113`.
- `apps/erp/src/features/tradeins/TradeInsWorkspace.tsx:167-173`, `201-213`.

Cotizaciones y PC utilizan solamente 900 números posibles para determinados identificadores. No hay comprobación de unicidad.

**Escenario:** se generan dos registros con el mismo ID. Los `map` y `filter` por ID modifican o eliminan ambos.

**Impacto:** pérdida o modificación conjunta de operaciones diferentes. No se afirma que ya haya ocurrido una colisión: la falta de unicidad y su consecuencia están implementadas en el código.

**Criterio de aceptación:** identificador único independiente de la numeración visible; numeración controlada y operaciones dirigidas a un único registro.

### H24. Datos locales inválidos pueden impedir abrir el módulo

**Evidencia:**
- `apps/erp/src/features/customers/CustomersWorkspace.tsx:46-49`.
- `apps/erp/src/features/pcbuilds/PcBuildsWorkspace.tsx:48-51`.
- `apps/erp/src/features/tradeins/TradeInsWorkspace.tsx:122-125`.
- `apps/erp/src/features/documents/DocumentsWorkspace.tsx:109-112`.
- `apps/erp/src/features/repairs/RepairsWorkspace.tsx:877-880`, `1138-1141`.

Se utiliza `JSON.parse` durante la inicialización sin captura ni validación del formato. Cotizaciones captura el error sintáctico, pero tampoco valida la estructura del resultado.

**Escenario:** una clave conserva JSON incompatible con la versión actual, JSON truncado o un objeto donde se espera un array.

**Impacto:** excepción durante el render o al filtrar/mapear datos, sin recuperación controlada del registro afectado.

**Criterio de aceptación:** validar estructura y versión, manejar corrupción explícitamente y no reemplazar silenciosamente datos operativos por demostraciones.

### H25. Los tests actuales no acreditan los flujos que anuncian

**Evidencia:**
- `apps/erp/src/App.test.tsx:109-136`: comprueba títulos al navegar por los nuevos módulos.
- `supabase/tests/database/erp_pc_tradeins_imei.test.sql:195-242`: comprueba comportamientos mediante `LIKE` sobre el texto de funciones.
- `apps/erp/src/lib/supabaseConfig.test.ts:11-16`: prueba el validador, no el cliente que actualmente introduce fallbacks.

**Escenario:** una función contiene la frase esperada de rechazo, pero su condición admite `NULL`; o una pantalla muestra su título, aunque todas sus operaciones sean locales.

**Impacto:** esas pruebas pueden no detectar exactamente los defectos descritos. Que existan no permite concluir que PC/canjes, facturación o integración funcionen.

**Criterio de aceptación:** escenarios de comportamiento que ejecuten los contratos con datos válidos y adversos, y pruebas del frontend que comprueben llamadas, persistencia, errores y efectos. No limitarse a títulos o existencia de texto.

**No ejecuté ninguna prueba.**

## Matriz Real/Demo/Parcial

Aquí «real» identifica una conexión u operación externa implementada en el código; no acredita disponibilidad del entorno ni éxito de la operación.

| Capacidad | Implementación actual | Clasificación |
|---|---|---|
| Padrón de clientes | Array precargado y altas/bajas en `localStorage` | **Demo local** |
| Historial unificado cliente/equipo | Sin relaciones entre CRM, taller y restantes módulos | **No conectado** |
| Ingreso de reparación | Inserta en `public.repairs` y luego en `public.repair_logs` | **Parcial, conexión heredada** |
| Avances de reparación | Logs reales contra tablas heredadas, con errores no atómicos | **Parcial** |
| Presupuesto dentro de orden | Un importe editable, sin aceptación | **Parcial** |
| Presupuestos comerciales | `localStorage`; solo dólar consultado externamente | **Demo local con lectura auxiliar** |
| Reserva/consumo de repuestos | No existe operación desde el taller | **No conectado** |
| QC | Protocolos locales con controles aprobados por defecto | **Demo local** |
| Listo para retiro | Cambio libre de estado heredado | **Parcial** |
| Entrega efectiva | Sin acción de entrega en la pantalla | **No conectado** |
| Garantía/RMA | Reclamos locales y métricas constantes | **Demo local** |
| PC | Textos libres y estados locales | **Demo local** |
| Identidad/IMEI de canje | Identificador opcional inventado y estado limpio automático | **Simulación incorrectamente presentada** |
| Liberación/aplicación del canje | Solo cambios de estado local | **Demo local** |
| Documentos/CAE | Numeración y autorización fabricadas | **Simulación, sin autorización real** |
| Archivo PDF | Impresión del navegador; ruta no utilizada | **Parcial, sin archivo implementado** |
| Bandeja WhatsApp | Conversaciones precargadas y mensajes en estado React | **Demo efímera** |
| Enlaces `wa.me` | Apertura de WhatsApp externo | **Acción real limitada; no confirma envío** |
| Seguimiento público | Usa RPC heredado `get_repair_by_tracking_code` | **Parcial, contrato heredado** |
| Backend ERP avanzado | Tablas y procedimientos locales, sin consumidor en estas pantallas | **Implementado en SQL, no integrado ni verificado en ejecución** |

## Flujo Reconstruido

### Cliente → Reparación

El CRM y el taller no comparten identidad. Se crea un cliente local y luego se vuelve a escribir su información en una reparación heredada.

La recepción sí intenta persistirse externamente, pero no utiliza el modelo ERP de equipo, titularidad, accesorios y condición de ingreso.

### Reparación → Presupuesto/Repuestos

Hay dos presupuestos independientes: el importe del ticket y el documento comercial local.

La confirmación de cliente no tiene recorrido integrado. El estado «Repuestos» tampoco genera reserva ni consumo.

### Repuestos → QC

No existe unión transaccional entre materiales y pruebas. El QC es un registro local con referencia libre a una orden.

Incluso el backend SQL necesita corregir la invalidación del QC posterior a intervenciones, descrita en H16.

### QC → Entrega

La pantalla puede marcar listo sin pruebas y termina allí. No registra un retiro efectivo ni receptor.

### Entrega → Garantía

La pantalla de garantías no deriva sus registros de una entrega. Los reclamos no comprueban póliza ni vigencia y carecen de cierre implementado.

**Resultado:** hoy no puede reconstruirse el ciclo solicitado usando una única cadena de hechos persistidos y verificables.

## SQL Sin Conectar

Las siguientes capacidades están declaradas localmente. No encontré consumidores en el código TS/JS de las aplicaciones para estos contratos avanzados.

| Área | Funciones/estructuras disponibles | Referencia |
|---|---|---|
| Datos privados de cliente | `get_customer_private_details`, `upsert_customer_private_details` | `supabase/migrations/202608190002_erp_master_data.sql:328`, `396` |
| Equipo y titularidad | `create_customer_equipment`, `transfer_customer_equipment` | `supabase/migrations/202608190007_erp_repairs_quotes_warranties.sql:699`, `744` |
| Ingreso y asignación | `create_repair_order`, `assign_repair_order` | Mismo archivo `:768`, `917` |
| Estados y pruebas | `transition_repair_order`, `record_repair_test_run` | Mismo archivo `:899`, `929` |
| Presupuestos | `create_repair_quote_version`, `issue_repair_quote`, `reissue_repair_quote_token`, `public.respond_repair_quote` | Mismo archivo `:953`, `1008`, `1025`, `1045` |
| Repuestos | `reserve_repair_parts`, `release_repair_parts`, `consume_repair_parts`, `reverse_repair_part_consumption` | Mismo archivo `:1074-1124` |
| Mano de obra y pagos | `record_repair_labor`, `record_repair_payment`, `reverse_repair_payment` | Mismo archivo `:1127-1164` |
| Seguimiento ERP | `public.get_repair_tracking`, rotación y revocación | Mismo archivo `:1243-1278` |
| Entrega y garantías | `deliver_repair_order`, `open_repair_warranty_claim` | Mismo archivo `:1281`, `1296` |
| PC | Proyecto, revisión, compatibilidad, reserva, pruebas y finalización | `supabase/migrations/202608190008_erp_pc_tradeins_imei.sql:491-630` |
| Canjes | Ingreso, procedencia, evaluación, IMEI, reacondicionamiento y liberación | Mismo archivo `:633-782` |
| Canje como pago | `apply_trade_in_sale_payment`, `reverse_trade_in_sale_payment` | Mismo archivo `:795`, `816` |
| Documento interno | `issue_document`, `void_document` | `supabase/migrations/202608190009_erp_documents_communications.sql:449`, `468` |
| Solicitud fiscal | `request_fiscal_issuance` | Definición posterior en `supabase/migrations/202608260002_erp5_correction_followup.sql:8-47` |
| Resultado fiscal | `record_fiscal_provider_result` | `supabase/migrations/202608190009_erp_documents_communications.sql:497-509` |
| Consentimiento y envío | `record_communication_consent`, `queue_customer_message` | Migración `202608190009…:512`; definición posterior de cola en `202608260004_erp5_documents_permissions.sql:3-146` |
| Recepción/estados de mensajes | Ingesta de webhook, mensaje entrante y eventos de proveedor | Migraciones `202608190009…` y correcciones `202608260005…`/`006…` |

Dos distinciones importantes:

1. **El seguimiento público sigue en el contrato heredado.** `src/pages/Seguimiento.tsx:75-80` llama a `get_repair_by_tracking_code`, no a `get_repair_tracking` con token ERP.
2. **Una cola no es una integración completada.** SQL produce eventos como `fiscal.issue.requested`, `message.send.requested` y `trade_in.imei.requested`. No encontré un consumidor de esos eventos en el código de aplicación inspeccionado. Las funciones Edge disponibles corresponden a MercadoPago y dólar, no a esas integraciones.

El SQL tampoco debe describirse como completo en todas las etapas: por ejemplo, hay apertura de reclamo de garantía, pero no identifiqué un contrato equivalente de resolución integral con reemplazo/crédito/cierre.

## Revalidación Histórica

| Antecedente | Resultado actual |
|---|---|
| Múltiples `localStorage` | **Confirmado:** siete registros dentro del alcance |
| CAE aleatorio | **Confirmado:** handler actual de documentos |
| IMEI aleatorio | **Confirmado:** fallback actual del alta de canje |
| IMEI limpio sin consulta | **Confirmado:** asignación incondicional |
| Módulos nuevos solo como placeholders no montados | **No:** están montados en `App.tsx:577-598`; el problema actual es su comportamiento |
| Funciones ERP sin conectar | **Confirmado:** los workspaces no consumen los contratos avanzados |
| Colisiones históricas en funciones de presupuestos/entrega | Hay correcciones posteriores; **no las reitero como si no existieran** |
| Revocación de tokens de presupuestos anteriores | Existe corrección final en `202608260020_erp5_quote_token_revoke_followup.sql:10-13` |
| Permisos de comandos de comunicación | Existen revocaciones posteriores en `202608260007_erp5_privilege_followup.sql:2-5` |
| Ausencia de fallback remoto en cliente | **No se mantiene:** el cliente actual volvió a introducirlo |
| Tests anteriores aprobados equivalen a estado actual correcto | **No verificable ni suficiente:** no se ejecutaron y parte de la cobertura no prueba comportamiento |

## Cobertura Y Límites

**Pruebas escritas que sí contienen escenarios de comportamiento:**
- Reparaciones: `supabase/tests/database/erp_repairs_quotes_warranties.test.sql` declara `plan(250)`. Incluye rechazo de QC fallido/antiguo, presupuestos versionados, consumo y reversión, entrega y apertura de garantía.
- Documentos/comunicaciones: `supabase/tests/database/erp_documents_communications.test.sql` declara `plan(133)`. Incluye idempotencia, consentimiento, estados de proveedor y autorización simulada.

**Cobertura que no debe confundirse con ejecución del flujo:**
- PC/canjes declara `plan(244)`, pero sus controles de comportamiento se basan en inspeccionar definiciones.
- Las pruebas de navegación verifican títulos.
- Los tests del validador no cubren la construcción actual del cliente Supabase.
- No encontré tests de comportamiento específicos de los siete workspaces que recorran las operaciones auditadas.

**Autorización fiscal en pruebas:** el seed establece el punto como `local_stub` en `supabase/seed.sql:730-732`. El test registra un CAE de ejemplo llamando directamente a la función de resultados en `erp_documents_communications.test.sql:276-279`. Eso prueba un contrato de almacenamiento, **no una autorización ARCA real**.

**No comprobado en esta auditoría:** migraciones efectivamente aplicadas, RLS/políticas de las tablas heredadas en el destino configurado, disponibilidad de servicios, infraestructura externa no presente en el repositorio, resultados de tests o comportamiento en navegador. No atribuyo fugas remotas ni operaciones financieras ejecutadas basándome solo en esta inspección.

## Conclusión

**No es solo una lista de funcionalidades pendientes.** Hay funciones visibles que afirman hechos que no ocurrieron: autorización fiscal, IMEI limpio, declaración firmada, PC testeada, mensaje enviado o canje aplicado.

La prioridad técnica es separar esas simulaciones de cualquier operación real, restablecer una fuente de datos e identidad común y corregir los defectos SQL antes de conectar los recorridos avanzados.

El backend local contiene una base sustancial reutilizable, pero **su existencia no convierte a las pantallas actuales en un ERP integrado ni acredita autorización fiscal, trazabilidad de equipos o cumplimiento del ciclo de taller**.
