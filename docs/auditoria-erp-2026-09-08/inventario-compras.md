# Auditoría ERP: catálogo, inventario, compras y proveedores

Revisión estática del frontend actual y de las migraciones acumuladas. No se modificó código ni se ejecutaron escrituras remotas. Las referencias corresponden al checkout del 8/9/2026. Los escenarios siguientes deben convertirse en pruebas de aceptación contra una base local migrada; no se afirma ejecución E2E.

## Bloqueos y errores comprobables

### INV-01 · P1 · El alta de proveedores omite la organización obligatoria

- Evidencia: `apps/erp/src/features/purchases/PurchasesWorkspace.tsx:463` inserta código/nombre/datos, sin `organization_id`. `supabase/migrations/202608190002_erp_master_data.sql:60` exige la columna NOT NULL, sin default; la política INSERT de la línea 568 exige organización actual. No hay migración posterior que agregue default o trigger de asignación para suppliers.
- Escenario: dueño autenticado → Proveedores → Nuevo → Guardar. La petición falla por RLS/columna obligatoria; no puede iniciar compras con un proveedor nuevo.
- Solución: RPC con organización derivada de sesión o payload de organización validado, manteniendo RLS. Probar alta desde la UI con dueño y rechazo fuera de organización. El test SQL `erp_phase_b_case_variants.test.sql:33` inserta el proveedor manualmente con organización y por eso no cubre este defecto.

### INV-02 · P1 · Todas las deudas de proveedor aparecen como cero por una columna inexistente

- Evidencia: `PurchasesWorkspace.tsx:147` solicita `supplier_id, pending_amount_base` en `supplier_payables`. La definición real `202608190004_erp_purchases_costs_pricing.sql:322` contiene `amount_base`, `amount_currency`, sin `pending_amount_base`; ninguna migración posterior crea esa columna. La respuesta ignora `error`, reduce `data || []`, y presenta cero como saldo real (líneas 150–162).
- Escenario: recibir mercadería a crédito; aun con payable creado, ficha y KPI indican al día. Impide al dueño controlar obligaciones.
- Solución: consultar una proyección real de saldo que descuente pagos/reversiones, no reemplazar ciegamente por el importe original; propagar errores. Prueba con deuda inicial, pago parcial, pago total y error de consulta.

### INV-03 · P1 · No se pueden recibir notebooks/teléfonos con trazabilidad serial o IMEI

- Evidencia: `PurchasesWorkspace.tsx:400–417` solo envía línea de compra, cantidad y ubicación; nunca `inventory_unit_id`. La RPC exige unidad registrada en cuarentena y cantidad 1 para tracking serial/imei (`202608190004_erp_purchases_costs_pricing.sql:1086–1101`). No hay invocación de `register_inventory_unit` en apps/erp/src.
- Además, `CatalogWorkspace.tsx:235` fuerza todo producto nuevo a `quantity`; no existe campo para tracking ni edición posterior.
- Escenario: recepción de notebook serializada importada al catálogo falla; notebook creada por UI pierde identidad individual. El dueño no puede completar recepción con números de serie.
- Solución: alta configurable de tracking, captura/validación de serial/IMEI por unidad y recepción vinculada atómica. Probar dos unidades del mismo modelo, serial repetido y posterior venta de unidad específica.

### INV-04 · P1 · Las etiquetas no codifican un código de barras estándar

- Evidencia: `StockWorkspace.tsx:69–83` transforma bits de caracteres ASCII en barras con guardas inventadas, sin codificador de simbología ni checksum. La UI afirma «100% escaneable» en línea 679. No es una implementación de Code128/EAN.
- También, el fallback `${code}-${vCode}` de líneas 268–272 no se registra como identificador pese a afirmar «Código Real Persistido».
- Solución: codificador de simbología real, identificador persistido y validado, prueba de ida/vuelta con decodificador independiente y lector físico hacia POS; barcode vacío debe generar y guardar uno o impedir impresión.

### INV-05 · P1 · Los ajustes positivos ingresan stock gratuitamente y alteran el costo promedio

- Evidencia: `StockWorkspace.tsx:222` envía siempre `unit_cost: 0`. `202608190005_erp_stock_cost_ledger.sql:350–363` usa ese costo para entradas de cantidad; líneas 405–435 recalculan cantidad/costo promedio.
- Escenario: 10 fundas a costo 100, ajuste de +10 unidades encontradas → valor sigue 1000, costo promedio pasa a 50. Distorsiona margen/costo de futuras ventas. No hay campo de costo ni política explícita de valoración.
- Solución: costo de ingreso explícito o regla aprobada basada en costo vigente; reservar cero para altas gratuitas deliberadas. Probar saldo/costo antes y después de ajuste positivo y su reversión.

### INV-06 · P1/P2 · No existe mantenimiento operativo de variantes ya creadas

- Evidencia: `CatalogWorkspace.tsx:271–300` permite editar solo nombre, precio base y actividad del producto. Las variantes se crean únicamente en el alta; no hay actualización, agregado, baja ni edición de barcode/diferencia de precio. `price_delta` existe en estado/payload pero no tiene input visible (formulario líneas 688–750).
- Escenario: un proveedor entrega una funda azul nueva para modelo existente: no se puede agregar el color desde ERP; tampoco corregir barcode o precio del color. Duplicar producto fragmenta historial/stock.
- Solución: CRUD de variantes sin borrar historial, actividad y barcode únicos, delta de precio editable; prueba crear color luego de compras y ventas previas sin alterar las otras variantes.

## Brechas funcionales y coherencia de información

### INV-07 · P2 · «Listas de Precios, Monedas & Cotizaciones» es el mismo catálogo ARS

- `CatalogWorkspace.tsx:306–317`: isPricingMode únicamente cambia título/descripción. No hay acciones de listas, márgenes, cotizaciones ni actualización masiva. Editar precio escribe directamente base_sale_price. Compras fija ARS (`PurchasesWorkspace.tsx:305,322`) y gastos vacíos (`:431`), aunque el SQL soporta snapshots/gastos prorrateados.
- Escenario: notebook comprada en USD con flete; no puede registrarse fielmente moneda/costo final desde esta UI. Solución: conectar los flujos existentes o delimitar explícitamente alcance ARS con costo final manual. Aceptación: operación completa en monedas comprometidas, flete y reconciliación de costo/deuda.

### INV-08 · P2 · Inventario inicial y conteos no tienen flujo propio

- `StockWorkspace.tsx:205` exige targetRow de stock_balances; el selector solo ofrece balances existentes. Un artículo recién creado sin saldo no puede recibir inventario inicial mediante ajuste. La pestaña stock-counts usa exactamente la misma pantalla; no llama comandos de conteo ni registra cantidades contadas/esperadas. Tampoco hay transferencia/reversión de documentos accesible.
- Solución: selección producto/variante/ubicación independiente del balance; saldo inicial valorado; conteo y compensación trazables. Probar migración de existencias sin simular compras/deudas, conteo discrepante y corrección de ingreso erróneo.

### INV-09 · P2 · Filtros y KPIs del catálogo representan solo 25 productos

- `CatalogWorkspace.tsx:134` pagina servidor, pero categorías/filtro/valorización/bajo stock/sin stock se calculan sobre la página (`:159–192`). `:493` usa find para stock de variante y pierde ubicaciones adicionales. La valorización usa precio de venta base sin delta, no costo.
- Escenario: 26+ productos; cambiar página cambia el total valorizado y categorías disponibles. Variante con 2 unidades en local y 3 en depósito muestra 2 o 3, no 5. Se usa quantity_on_hand sin descontar reservas para mensajes de disponibilidad.
- Solución: filtros servidor, agregados globales con significado comercial explícito y suma por variante; prueba >25 artículos, dos ubicaciones, reservas y delta de precio.

### INV-10 · P2 · Compras/inventario se truncan sin paginación

- `PurchasesWorkspace.tsx:136–149,176–196,205–211` y `StockWorkspace.tsx:144–161` no paginan; búsquedas posteriores solo filtran lo cargado. El catálogo tiene paginación, pero selector de compra, saldos, identificadores y proveedores no. El límite Data API configurado debe comprobarse: cuando se supera, artículos/stock se vuelven inaccesibles o parciales sin aviso.
- Solución: búsqueda paginada servidor y agregados DB; prueba conjunto mayor al límite configurado, identificadores al final y múltiples variantes por producto.

### INV-11 · P2 · Claves idempotentes no sobreviven a reintentos

- `PurchasesWorkspace.tsx:309,347,423` y `StockWorkspace.tsx:215` generan una clave nueva en cada submit.
- Escenario: respuesta perdida después del commit; el dueño reintenta y crea otra compra o ajuste. La idempotencia SQL no protege porque cambió la clave. Solución: clave estable durante la intención, conservar en fallo ambiguo y consultar resultado; prueba commit exitoso con respuesta fallida seguido de reintento.

### INV-12 · P2 · Impresión ignora formato y cantidad solicitada

- `StockWorkspace.tsx:135,598` guarda formato pero no lo usa para dimensiones; `:733` limita render a 100 aunque botón/texto anuncien labelQty; impresión es window.print (`:665`), sin reglas @media print ni aislamiento de `printable-labels-area` en estilos. Contenedor tiene maxHeight/overflow (:726–728).
- Solución: plantilla física en mm con paginación/estilos print, respetar cantidad o limitar input explícitamente. Prueba PDF y papel en cada tamaño, 1/100/150 etiquetas, sin navegación/KPIs.

### INV-13 · P2 · Dependencia del ID de sucursal de seed

- `PurchasesWorkspace.tsx:310` y `StockWorkspace.tsx:216` fijan `20000000-0000-0000-0000-000000000001`. Una instalación con IDs reales distintos falla aunque la sesión/ubicación sea correcta. No es un requisito multicliente: afecta el alta inicial del único cliente.
- Solución: obtener sucursal del contexto autenticado y filtrar ubicaciones; prueba una instalación válida con UUID distinto al seed.

### INV-14 · P2 · Proveedores no admite corrección o baja

- Pantalla de proveedores solo tiene alta y ficha de lectura (`PurchasesWorkspace.tsx:452–487` y modal final). No hay edición/contactos/cambio de condición/baja. Filtra activos y no permite reactivar.
- Solución: edición con validación/auditoría, baja lógica sin perder compras; prueba corregir CUIT/teléfono y conservar historial.

## Pruebas mínimas para cerrar este alcance

1. Base local con todas las migraciones + bootstrap productivo; alta de proveedor desde UI, no fixture SQL.
2. Funda modelo A, colores negro/rosa; compra 10/5, recepción parcial 4/2, remanente; verificar stock, costo y deuda; alta posterior azul y cambio de barcode.
3. Notebook serializada y teléfono IMEI, dos unidades, recepción individual y venta de unidad elegida.
4. Inventario inicial con costo, ajuste positivo/negativo, transferencia y reversión; reserva impide consumir disponibilidad ajena.
5. Pago parcial y total de proveedor reflejado inmediatamente en ficha/compras.
6. Etiqueta decodificable y búsqueda POS; formatos físicos/cantidad correcta.
7. Pérdida de respuesta tras commit y reintento sin duplicación.
8. Más de una página/límite API, stock en dos ubicaciones y reservas; agregados reconciliados con SQL.

La suite SQL existente aporta validaciones de invariantes, pero no sustituye estos recorridos UI: el caso de proveedores usa INSERT con organization_id explícito, precisamente distinto al payload defectuoso real. No se encontraron tests específicos del comportamiento de CatalogWorkspace/PurchasesWorkspace/StockWorkspace en apps/erp.
