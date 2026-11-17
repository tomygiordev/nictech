# Auditoría ERP: taller, clientes, presupuestos, armados, canjes y documentos

Fecha: 2026-09-08. Revisión estática de frontend y migraciones acumuladas; sin acceso a DB remota, sin afirmar ejecución E2E. Las migraciones posteriores de agosto/septiembre fueron contrastadas para evitar reportar fallos SQL ya corregidos. No se modificó implementación.

## Bloqueos y defectos comprobados

### RC-01 — P1: no se puede seleccionar una orden para crear presupuesto

`apps/erp/src/features/quotes/QuotesWorkspace.tsx:128` consulta `brand, model, status` y ordena por `created_at` en `repair_orders_overview`. La única definición final de esa vista, `supabase/migrations/202609070003_erp_phase_d_repairs_lifecycle.sql:488`, expone `brand_snapshot, model_snapshot, status_name, opened_at`. La respuesta PostgREST será error de columna inexistente. El código ignora `ordersRes.error` y convierte data nula en lista vacía, por lo que el usuario ve un selector sin órdenes y no puede presupuestar aunque existan reparaciones.

Solución: alinear selección y mapeo con la vista real, propagar errores y probar crear presupuesto desde una orden ingresada en UI.

### RC-02 — P1: reservar componentes de PC omite depósito obligatorio

`apps/erp/src/features/pcbuilds/PcBuildsWorkspace.tsx:297` construye líneas con producto, variante, unidad y cantidad, sin `location_id`; tampoco existe selector de depósito en esa operación. La API transmite esas líneas sin enriquecerlas (`pcbuilds/api.ts:235`). `reserve_pc_build_components`, en migración `202608190008_erp_pc_tradeins_imei.sql:568`, las pasa a `create_stock_reservation`. Esta última lee `line->>'location_id'` (`202608190003_erp_inventory_ledger.sql:694`) y verifica que exista una ubicación activa (`:725`), por lo que falla con `active reservation location not found`. Ninguna migración posterior redefine esta interfaz para inferir ubicación.

Impacto: armado creado → compatibilidad → reserva bloqueada → no testeo ni cierre. Además la reserva lee `revDrafts` vacío en vez de cargar los componentes persistidos de la revisión: obliga a reconstruirlos manualmente y puede mezclar borradores de otros proyectos.

Solución: cargar revisión vigente y existencias, elegir ubicación/unidad por componente, enviar location_id y permitir cambios mediante una revisión explícita.

### RC-03 — P1: no hay cobro de reparaciones conectado al taller

Existen RPC `record_repair_payment` y `reverse_repair_payment` (`202608190007_erp_repairs_quotes_warranties.sql:1138`, `:1154`), pero búsqueda en `apps`, `src` y funciones no encuentra consumidores. Reparaciones ofrece ingreso, estados, repuestos, QC, entrega y garantía, sin anticipo, saldo ni cobro. La entrega SQL exige estado terminal/QC, no pago; no hay en pantalla autorización de entregar con deuda. No afirmar que falta backend: falta integración operativa. Un cobro POS genérico no conserva el vínculo a la orden.

Solución: resumen presupuesto aprobado/anticipos/saldo, cobro por medio y caja real usando esas RPC, reversión y comprobante vinculado. Definir política explícita para entrega con saldo.

### RC-04 — P1: no hay devolución sin reparación en el circuito entregado

`supabase/seed.sql:21-37` instala únicamente received → diagnosis → repair → ready. Ready requiere QC final. `RepairsWorkspace.tsx:1078` solo ofrece entrega cuando `status_code === 'ready'`; garantía solo ofrece 30/60/90/180/365 días (`:1699`). Un equipo irreparable o presupuesto rechazado no puede retirarse formalmente sin pasar por reparación/QC aprobado y garantía. El motor permite otros estados terminales y cero días, pero la UI/bootstrap no los habilitan.

Solución: estados de cancelación/no reparado/rechazado con devolución física y cero garantía; conservar diagnóstico y costo de revisión si corresponde. Probar equipo que no enciende, presupuesto rechazado y retiro.

### RC-05 — P1: consumo de repuestos ligado a IDs de demo y sin variantes/unidades

`RepairsWorkspace.tsx:428-434` fija depósito `30000000-0000-0000-0000-000000000002` y envía variante undefined. Tras migrar a una organización/depósito propios falla; aun con seed no puede consumir la variante exacta de una pantalla/repuesto con stock solo en variante. La RPC directa tampoco recibe unidad serializada (`202609070003...sql:395-442`).

Solución: resolver depósito desde sucursal/configuración y listar productos, variantes y unidades con existencia; ampliar llamada para serializados si se consumen en taller. No asumir que un UUID seed es configuración de producción.

### RC-06 — P2: Clientes muestra historial y métricas incorrectas sin alertar

`CustomersWorkspace.tsx:82` repite selección de columnas inexistentes de la vista de reparaciones. `:85-87` pide `sales.status` y filtra completed, pero `erp.sales` (`202608190006_erp_sales_cash_orders.sql:140`) no tiene status; los estados están en `sale_state_events` con confirmed/cancelled. Solo verifica customersRes.error (`:90`). Resultado: historial vacío, reparaciones activas y ventas/gasto en cero incluso existiendo movimientos.

También el agregado suma nominales sin moneda ni conversión (`:105-112`), por lo que al arreglar consulta no debe sumar USD como ARS ni ignorar cancelaciones/devoluciones.

Solución: usar vistas consolidadas con estado efectivo y total base, verificar todos los errores y probar cliente con reparación, venta ARS, USD y devolución.

### RC-07 — P2: datos de cliente ofrecidos pero descartados

`CustomersWorkspace.tsx:580,589` ofrece localidad y saldo inicial. El insert `:157-169` no guarda ninguno; lectura fija `city: 'CABA'` y `creditBalanceArs: 0` (`:126-130`). Notas se guardan como legal_name, confundiendo razón social con observaciones. No hay edición ni reactivación en este módulo (solo creación y baja).

Solución: persistir dirección/nota en campos apropiados; saldo a través de movimiento contable autorizado con trazabilidad o retirar el campo; leer saldo de cuenta real. Agregar edición y recuperación de bajas accidentales. DNI/CUIT hoy se usa como code: separar identificación fiscal del código interno.

### RC-08 — P2: ingreso con nuevo cliente usa organización fija y no es atómico

`RepairsWorkspace.tsx:272` inserta cliente en organización seed aunque el usuario pertenezca a otra. Además inserta cliente antes del intake: si equipo/IMEI/RPC falla, el cliente queda creado y reintentar con mismo DNI falla por duplicado. La RPC intake genera una clave aleatoria nueva por invocación (`202609070003...sql:331`), sin clave del cliente estable: ante pérdida de respuesta repetir puede duplicar la orden.

Solución: usar organización autenticada; crear/reutilizar cliente e ingresar equipo en una única operación o conservar el ID tras crear; clave idempotente estable por formulario/intento y reintentos de red.

### RC-09 — P2: cotización USD automática ficticia

`quotes/api.ts:175` usa 1250 cuando no encuentra snapshot USD y lo captura como manual-system sin intervención del dueño. Esto altera valor base/costos con una tasa arbitraria. También ignora errores de captura/consulta. No requiere consultar el dólar actual para comprobar el defecto: es una constante monetaria impuesta.

Solución: pedir cotización confirmada al dueño o usar configuración vigente con fecha/fuente; bloquear si falta. ARS 1 es identidad, USD 1250 no.

### RC-10 — P2: el cliente no recibe seguimiento ni aprobación pública funcional desde ERP

`RepairsWorkspace.tsx:294-314` recibe tracking_token pero muestra solo order_code y lo descarta; no hay consumidor de get_repair_tracking/rotate_repair_tracking_token en frontend. `QuotesWorkspace.tsx:270-310` emite token, pero el WhatsApp contiene solo un código de orden, sin URL/token para responder; volver a enviar no recupera token. Hay registro de decisión manual, que sí puede ser un flujo válido para este dueño, pero no equivale a confirmación pública conectada.

Solución mínima: documentar aprobación por WhatsApp registrada por dueño y entregar comprobante/estado por canal manual. Si se promete autoservicio, URL real a seguimiento/aprobación ERP, conservación/rotación segura del token y prueba externa. No conectar por accidente al seguimiento antiguo del ecommerce.

### RC-11 — P2: el QC se declara aprobado por defecto

`RepairsWorkspace.tsx:372-375` inicializa todos los resultados a pass. Abrir y confirmar deja una inspección aprobada sin marcar prueba alguna. Esto debilita precisamente la barrera que bloquea entrega. Además cambiar 90 a 30/365 días no actualiza texto de términos inicial de 90 días (`:145-146`, `:1696-1711`), dejando fechas y póliza contradictorias.

Solución: estado pendiente inicial, confirmación explícita de cada ítem y términos coherentes con días elegidos. Pruebas opcionales/no aplicables según tipo de equipo.

## Faltantes funcionales y usabilidad para dueño único

- **Documentos:** `DocumentsWorkspace.tsx:192-223` solo arma metadatos y hash de JSON; `documents/api.ts:228` envía private_object_path null. No hay render/impresión/descarga en el módulo. Se registra “emitido” sin entregar archivo al cliente. Implementar comprobante de ingreso, presupuesto, pago, entrega/garantía con datos reales y PDF/impresión. ARCA puede quedar fuera si el circuito fiscal se acuerda externo; no presentar la cola como facturación resuelta.
- **UUID/JSON como operación cotidiana:** PC exige UUID de cliente/sucursal/producto/plantilla, resultados y garantía JSON (`PcBuildsWorkspace.tsx:436,811,817,861,931,942`); canjes exige UUID de depósito/venta y documentación JSON (`TradeInsWorkspace.tsx:775,898,912,963-997`); documentos pide UUID de dueño y sucursal (`DocumentsWorkspace.tsx:648,694`). Cambiar por selectores con nombres, contexto de sucursal automático, formularios de evidencia y checklist. No es una objeción estética: el comerciante no dispone de estos identificadores ni claves de plantilla.
- **Garantías/RMA:** apertura existe y SQL posterior corrige fecha. Tabla repair_warranty_claims (`202608190007...sql:570`) solo guarda apertura/falla y no tiene ciclo de resolución, estado, reparación de reingreso ni cierre. Falta gestionar diagnóstico, aceptación/rechazo, reparación vinculada y entrega de reclamo. Evitar crear reclamaciones eternamente abiertas.
- **Mano de obra:** RPC record_repair_labor existe (`202608190007...sql:1127`), pero sin consumidor UI. Falta costo real/hora/tarea para rentabilidad del taller; precio del presupuesto no sustituye costo real de trabajo.
- **Recepción técnica:** serial/IMEI se capturan, pero lectura por get_customer_equipment_identifiers no está en UI; plantillas de pruebas de ingreso, credenciales privadas, fotos/evidencia y etiqueta tienen backend parcial y ninguna operación completa en taller. Priorizar identificación visible y resguardo de condición/accesorios; fotos/etiquetas solo si forman parte de entrega acordada.
- **Canjes:** revisión de procedencia, valuación, IMEI manual, reacondicionamiento, liberación a stock y aplicación a venta sí tienen APIs/UI; no declarar ausentes. Las correcciones 202609070006 cubren varios defectos previos. El bloqueo para un dueño es que necesita operar UUID/JSON y el flujo externo IMEI depende del worker/proveedor revisado por otro frente. Un control documentado manual puede ser suficiente si se acuerda.
- **PC:** no confundir creación atómica/compatibilidad con ciclo terminado. Hay fixes posteriores de cierre :007/:008/:009 que reemplazan cuerpo; no reportar la vieja ambigüedad SQL como vigente. El bloqueo concreto nuevo sigue siendo reserva de UI sin ubicación.

## Prueba de aceptación mínima recomendada

1. Cliente nuevo y existente: ingreso de notebook y teléfono con serie/IMEI, condición y accesorios; comprobar recuperación del historial y comprobante.
2. Presupuestar mano de obra + repuesto variante; ARS y USD con tasa confirmada; emitir, aprobar/rechazar y nueva versión sin usar token viejo.
3. Anticipo, cambio de presupuesto, consumo/reversión de variante, labor, QC pendiente→fallo→aprobado; saldo y caja conciliados.
4. Entrega reparada con garantía coherente y retiro no reparado sin garantía; cerrar caja y verificar pagos.
5. Reingreso por garantía y resolución con trazabilidad sin duplicar cobro/venta.
6. PC: cargar componentes reales, compatibilidad, reserva por depósito/unidad, QC y cierre; confirmar consumos y costo.
7. Canje: recepción, rechazo/aprobación, IMEI manual documentado, valuación, reacondicionamiento, stock y aplicación/reversión de venta.
8. Repetir envíos tras timeout simulado y refrescar navegador a mitad del circuito; no duplicar cliente/orden/pago/consumo.

Tests SQL existentes (`erp_repairs_quotes_warranties.test.sql`, `erp_phase_d_repairs_lifecycle.test.sql`, `erp_pc_tradeins_imei.test.sql`, `erp_phase_e_pc_tradeins.test.sql`) cubren backend, pero no detectan estas consultas/serializaciones de UI. No hay pruebas frontend dedicadas de estos módulos entre los archivos revisados.
