# NicTech

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Personal de mostrador que vende, cobra, recibe equipos y responde consultas mientras atiende clientes.
- Tecnicos que diagnostican, documentan, presupuestan, consumen repuestos y entregan reparaciones.
- Responsables de compras, inventario y precios que necesitan trazabilidad por ubicacion y moneda.
- Administracion que controla caja, financiacion, proveedores, contabilidad, rentabilidad y permisos.
- Clientes de la tienda publica que compran productos o consultan el estado de una reparacion.

## Product Purpose

NicTech integra la tienda de tecnologia y el servicio tecnico con una gestion privada completa. El resultado esperado es que cada operacion comercial, fisica y financiera pueda seguirse desde su origen hasta stock, pagos, documentos, auditoria y contabilidad sin registros paralelos ni perdida de contexto.

## Positioning

Una misma trazabilidad conecta producto o equipo individual, ubicacion, cliente, reparacion, venta, pago, documento y asiento. La tienda publica consume una proyeccion controlada de esa operacion interna, no una administracion separada por planillas.

## Operating Context

- Venta presencial y online de celulares, accesorios, componentes y servicios.
- Recepcion y seguimiento de reparaciones con equipos fisicos, accesorios, pruebas, evidencia y aprobacion del cliente.
- Uso frecuente desde escritorio en administracion y desde movil o tablet en mostrador, deposito y taller.
- Operaciones en pesos argentinos y dolares con fuentes de cotizacion variables.
- Lectores de codigo, etiquetas, QR, impresoras, comprobantes, WhatsApp, Mercado Pago y futuras integraciones ARCA/IMEI.
- Conectividad externa potencialmente intermitente; los errores de integracion deben quedar visibles y ser reintentables.

## Capabilities and Constraints

- La tienda publica y la aplicacion ERP deben ser desplegables por separado.
- El alcance funcional completo esta definido por `cambios/Sistema de gestion.docx` y trazado en `docs/erp-program.md`.
- Supabase aporta PostgreSQL, autenticacion, almacenamiento y Edge Functions.
- La autorizacion debe aplicarse en base de datos con roles, permisos individuales y alcance operativo.
- Stock, pagos, caja y contabilidad requieren transacciones atomicas, idempotencia, auditoria y reversas.
- Los datos internos y sensibles de reparaciones nunca forman parte de la proyeccion publica.
- Durante el desarrollo actual no se puede consultar ni modificar el Supabase real sin revision y autorizacion expresa del usuario.
- Las integraciones externas se prueban localmente mediante adaptadores y dobles hasta ser autorizadas.

## Brand Commitments

- Nombre: NicTech.
- Identidad existente: azul principal intenso, azul profundo, fondos claros y lenguaje directo en espanol.
- La tienda publica conserva su orientacion comercial; el ERP prioriza velocidad, claridad, densidad y confianza operativa.
- No inventar precios, clientes, metricas comerciales, certificaciones ni capacidades de integraciones aun no conectadas.

## Evidence on Hand

- Requisitos completos: `cambios/Sistema de gestion.docx`.
- Programa y trazabilidad: `docs/erp-program.md`.
- Tienda y administracion prototipo existentes en `src/`.
- Codigo actual de Mercado Pago y cotizaciones en `supabase/functions/`.
- No hay evidencia local autoritativa del esquema, politicas RLS o datos desplegados en Supabase.

## Product Principles

1. Registrar una vez y conciliar en todos los libros afectados.
2. Mostrar a cada persona solo la informacion y las acciones que necesita y tiene permitidas.
3. Hacer visible el estado real, el siguiente paso y cualquier excepcion recuperable.
4. Preservar historia: corregir mediante versiones, anulaciones y reversas, nunca borrando hechos.
5. Mantener operables por separado la experiencia publica y la gestion privada.

## Accessibility & Inclusion

- Operable con teclado, foco visible y semantica correcta.
- Contraste WCAG AA como minimo.
- Estructura responsive para escritorio, tablet y movil sin ocultar acciones criticas.
- Estados no comunicados unicamente por color.
