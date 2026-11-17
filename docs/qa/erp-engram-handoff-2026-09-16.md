# NicTech ERP — handoff completo para orquestador

Fecha de corte: 2026-09-16. Repositorio: A:\nictech. Rama: dev/erp.

## Intención y alcance obligatorio

El usuario pidió auditar, arreglar y preparar para entrega únicamente el ERP de NicTech. El alcance válido es:

- apps/erp
- packages/domain
- esquema, funciones, permisos, RLS y migraciones ERP de Supabase
- tests de ERP y Edge Functions que integren directamente con ERP

No modificar el storefront general (src/) salvo una integración ERP estrictamente necesaria. Datos sintéticos únicamente en local. No hacer mutaciones remotas hasta resolver owner, migraciones y gates.

El objetivo no es declarar GO por intuición: decidir con evidencia si el ERP puede entregarse al cliente y si se puede fusionar/desplegar en la base remota de Supabase.

## Criterio de orquestación y selección

Según AGENTS.md se usa la topología mínima útil:

- direct inline para verificar o cambiar 1–3 archivos sin decisión abierta;
- delegated direct para explorar 4+ archivos y para escribir 2+ archivos no triviales;
- no SDD salvo pedido explícito o ambigüedad sustancial.

Cada delegación debe ser acotada a un defecto/módulo, conservar ERP-only y devolver archivos, evidencia, riesgos y comandos. No lanzar workers redundantes ni resets concurrentes. Pruebas, lint, build y revisión pueden hacerse con workers frescos, pero la decisión de entrega se basa en resultados reproducibles.

Skills usados: Supabase, buenas prácticas Postgres de Supabase, QA expert y computer-use para base, seguridad, estrategia de pruebas y smoke browser. Este mensaje es el handoff para el nuevo orquestador.

## Auditoría de entrega

Archivo: docs/qa/erp-auditoria-entrega-2026-09-14.xml.

Versión 1.2, XML válido. Hash antes de los tres arreglos nuevos en curso:
84BAF55ABD5ED1357A5996EC00D4E23A1A3CC32ED3671A19196064BF87B2C30A

Estado registrado antes de las migraciones 040/050/060:

- 206 casos.
- 65 ejecutados; 46 PASS, 19 FAIL, 13 BLOCKED, 128 NOT_RUN.
- 31.55% ejecutado; 70.77% de pass entre ejecutados; 22.33% sobre el total.
- 35 defectos: 17 FIXED y 18 OPEN.
- OPEN: 1 P0, 13 P1 y 4 P2.
- Decisión: NO_GO.
- Gates fallidos: ejecución 100%, pass total >=80%, defectos, cobertura medible, recuperación/restore y UAT firmado.
- Seguridad parcial: RLS/anon/search_path revisados, pero faltan matriz dinámica de RPC/Auth y pruebas completas por roles.

No actualizar conteos ni marcar defectos como fixed hasta ejecutar las pruebas.

### Defectos ya corregidos

DEF-ERP-001, 002, 003, 004, 005, 006, 008, 020, 021, 022, 023, 024, 025, 026, 028, 029 y 035 quedaron FIXED con evidencia. Incluyen contratos DB/POS, privacidad, finanzas/reversiones, etiquetas hasta 500, CSV neutralizado y guards de UI/permisos.

### Defectos aún abiertos

- DEF-ERP-007: owner remoto/profiles no elegido.
- DEF-ERP-009: inventario físico/conteo y ajuste completo.
- DEF-ERP-010: pricing real, reglas y vigencias.
- DEF-ERP-011: administración operativa de usuarios/RBAC/sucursales.
- DEF-ERP-012: adaptadores/proveedores externos reales; no fingir delivery.
- DEF-ERP-013: UX de UUID/JSON y detalle operativo en módulos parciales.
- DEF-ERP-014: aislamiento/flakiness de tests.
- DEF-ERP-015: cobertura/E2E insuficiente; muchos casos NOT_RUN.
- DEF-ERP-016: restore/rollback/reconciliación no ensayados.
- DEF-ERP-017: vistas/datos sensibles pendientes de matriz completa.
- DEF-ERP-018: protección Auth contra filtración de credenciales/controles de cuenta.
- DEF-ERP-019: CI reproducible inexistente.
- DEF-ERP-027: alta avanzada de catálogo/variantes/identificadores.
- DEF-ERP-030: lifecycle real de pedidos online; código nuevo en curso, no verificado.
- DEF-ERP-031: presupuestos comerciales independientes/conversión a venta.
- DEF-ERP-032: lifecycle completo de garantías.
- DEF-ERP-033: exportes oficiales auditables; migration/UI nueva, no verificada.
- DEF-ERP-034: retry/requeue/recover; migration/UI nueva, no verificada.

## Evidencia verde previa

Antes de estas tres migraciones nuevas:

- npx supabase db reset --local pasó hasta 20260916003000.
- npx supabase test db: 20 archivos, 1363 tests PASS.
- npx supabase db lint --local --level error: cero errores.
- npm run typecheck:erp: PASS.
- npx vitest run apps/erp packages/domain supabase/functions: 15 archivos, 57 tests PASS.
- npx eslint apps/erp packages/domain supabase/functions --ext .ts,.tsx: PASS.
- npm run build:erp: PASS, 2340 módulos.
- 0 sourcemaps en producción.
- npm audit --workspace @nictech/erp --omit=dev: 0 vulnerabilidades.
- XML válido y refs correctas.
- Browser smoke ERP de login/dashboard.
- Browser local de pago parcial a proveedor y reversa: deuda volvió a ARS 10000; DB mostró 1 pago, 1 reversa y 2 journals balanceados.

## Cambios ya hechos

- POS ARS/ARS no depende de cotización USD; payloads tipados y RPC de inventario seguro.
- Dashboard/App shell sin notificaciones/perfil falsos; contexto real.
- Privacidad de detalles de clientes con migración/RPC/UI.
- Contratos DB para SKU, Mercado Pago, inventario y contabilidad interna de pedidos.
- Reversiones/refunds atómicos de venta, pago, stock, documento y asiento.
- Recibos, cobros de proveedor, reversas append-only, caja y submayores; canje excluido como método inválido.
- UI de compras probada: pago parcial, historial con referencia y reversa.
- CSV común neutraliza =, +, -, @, espacios/control chars y agrega BOM.
- Botones de exportación con reports.export como guard UX.
- Etiquetas hasta 500 y CSS de impresión corregidos.
- apps/erp/vite.config.ts no genera mapas de fuente.

## Tres bloques nuevos en curso

### 040 — recuperación de integraciones

Archivo: supabase/migrations/20260916004000_erp_integration_recovery.sql.

Incluye tablas append-only integration_retry_requests e integration_retry_claims; acciones retry/recover; motivo, operación/hash, snapshot, secuencia 1..5, available_at y backoff; RPC autenticado request_integration_retry; claim service-role con FOR UPDATE SKIP LOCKED; RPC de resultado reclamado; hardening de record_integration_attempt para impedir que un operador fabrique succeeded; DLQ con guards.

UI parcial:
- apps/erp/src/features/integrations/api.ts
- apps/erp/src/features/integrations/IntegrationHealthWorkspace.tsx

Validar reset, ACL/RLS, idempotencia, backoff/máximo, recuperación DLQ, claim/lease y typecheck. El worker/proveedor externo sigue fuera de esta migration: sólo se agenda y reclama trabajo; no se inventa entrega.

### 050 — exportación oficial

Archivo: supabase/migrations/20260916005000_erp_report_exports.sql.

RPC security-definer erp.export_report_rows con allowlist audit, iva_ventas, iva_compras, trial_balance y profitability; tenant/sucursal; reports.export más permisos fuente; filtros/fechas; límite 1..5000; respuesta JSON con report_code, rows, row_count y truncated; evento audit_events con motivo/filtros/conteo, nunca filas completas; exec sólo authenticated.

Archivos:
- apps/erp/src/lib/reportExports.ts
- apps/erp/src/components/erp/OfficialCsvExportButton.tsx
- apps/erp/src/features/finance/api.ts
- apps/erp/src/features/finance/AccountingWorkspace.tsx
- apps/erp/src/features/audit/api.ts
- apps/erp/src/features/audit/AuditWorkspace.tsx

El botón pide motivo y descarga la respuesta del RPC; csv.ts queda como neutralización final. Verificar que ningún export oficial serialice las filas visibles del browser, que action execute sea aceptado por la constraint, que vistas/columnas coincidan, que numeric/null reales pasen Zod y que filtros se normalicen.

### 060 — lifecycle de pedidos online

Archivo: supabase/migrations/20260916006000_erp_online_order_lifecycle.sql.

Máquina estricta: pending→preparing→ready; fulfillment/venta/stock/asiento sólo desde ready y produce dispatched; dispatched→delivered habilitado aun con order_state fulfilled; returned sólo mediante refund atómico; cancelación manual sólo placed/confirmed + payment_state unpaid; outbox por transición; guards tenant/RBAC/idempotencia/auditoría; refund exige delivery delivered.

Archivos:
- apps/erp/src/features/onlineorders/api.ts
- apps/erp/src/features/onlineorders/OnlineOrdersWorkspace.tsx
- apps/erp/src/features/onlineorders/schemas.ts
- apps/erp/src/features/onlineorders/schemas.test.ts

Verificar que fulfillment no rompa fixtures, argumentos nullable vs tipos generados, refund exija provider refunded no aplicado, devolución nunca llame returned genérico, operation key estable, timeline real y KPIs no inventados.

## Validación pendiente y orden

Un reset posterior fue abortado durante inicialización y no es evidencia. Docker Desktop volvió a estar disponible. Ejecutar un solo reset cuando el código esté quieto:

1. npx supabase db reset --local
2. npx supabase gen types typescript --local > apps/erp/src/types/supabase.ts
3. npx supabase test db
4. npx supabase db lint --local --level error
5. npm run typecheck:erp
6. npx vitest run apps/erp packages/domain supabase/functions
7. npx eslint apps/erp packages/domain supabase/functions --ext .ts,.tsx
8. npm run build:erp y confirmar 0 .map
9. Smoke browser ERP local con datos sintéticos.
10. Actualizar XML sólo con evidencia y recalcular stats/hash.

Errores conocidos de la primera compilación con tipos viejos:

- integration_retry_requests/request_integration_retry no estaban en tipos y daban error de PostgREST/deep instantiation; regenerar tipos después del reset y, si persiste, usar adaptador estrecho tipado, nunca any.
- onlineorders/api.ts tuvo errores por enviar null a argumentos generados como no-null; ya se aplicó cast estrecho para el RPC y hay que revisar luego de regenerar.

## Supabase remoto

Proyecto remoto: ref tuzpcofywkhglkqplhnn.

Preflight sólo lectura: remoto hasta 202609140001. Faltan localmente/remoto migraciones 20260915032943, 20260915032950, 20260915032957, 20260916001000, 20260916002000, 20260916003000, 20260916004000, 20260916005000 y 20260916006000. No hay profiles ERP remotos ni owner elegido.

No desplegar ni fusionar todavía. El owner remoto debe ser elegido explícitamente; no inferirlo a partir de usuarios candidatos. No subir secretos ni credenciales sintéticas.

## Criterio de “listo para cliente”

No alcanza con compilar. Se requiere:

- 100% del release set ejecutado o excepción formal.
- cero P0 y P1 aceptados explícitamente.
- RLS/ACL/tenant/branch por rol y RPC, sin anon.
- transacciones, idempotencia, reversas y conciliaciones.
- cobertura medible >=80%.
- restore/rollback/RTO/RPO ensayados.
- CI reproducible.
- UAT firmado por caja, stock, taller, administración y dirección.
- remoto con migraciones, owner/profiles y proveedores acordados.

Mientras falten owner remoto, UAT, recuperación y los defectos listados, la decisión correcta sigue siendo NO_GO.

## Instrucción para el nuevo orquestador

Continuar desde este archivo y el mensaje de Engram. No repetir la auditoría completa desde cero. Primero validar 040/050/060 en una única DB local limpia; corregir fallos; después actualizar el XML con evidencia. Mantener ERP-only. No tocar remoto ni elegir owner sin confirmación. No ocultar faltantes con mocks/KPIs inventados. Cada cambio material debe dejar pruebas y decir si cierra el defecto o sólo reduce su alcance.

## Actualización de cierre del chat — 2026-09-17

Esta sección es la fuente de continuidad para el próximo chat limpio. La campaña completa se ejecutó después del handoff anterior, usando Supabase local limpio y Edge interactivo con datos sintéticos. No se usó internet ni se tocaron datos remotos.

### Resultado de la campaña

- 23 archivos pgTAP, 1.485 tests de base de datos: PASS.
- 16 archivos Vitest, 60 tests: PASS.
- TypeScript/typecheck del ERP: PASS.
- Build del ERP: PASS.
- ESLint dirigido al alcance ERP: PASS; el lint completo conserva sólo 20 warnings preexistentes y ningún error.
- Smoke/E2E interactivo en Edge con usuario owner y usuario sales: PASS para los workspaces y flujos expuestos del ERP.
- Cobertura interactiva: dashboard, POS, caja, pedidos online, catálogo/precios, stock/Kárdex/etiquetas, compras/proveedores, clientes, presupuestos, reparaciones/QC/garantías/entrega, armado de PC, trade-ins, financiación/cuentas corrientes, contabilidad, documentos/ARCA, WhatsApp, integraciones, sistema/configuración y auditoría.

La campaña local queda verde como candidato a QA/UAT del cliente. No equivale a GO de producción: el proveedor ARCA local es un stub/outbox y sólo se verificó el estado `queued`; no se obtuvo CAE real.

### Auditoría final de Sol

El auditor Sol/Hilbert (`01a0ad33-81c4-76a3-b7dc-42c4c614a50a`) auditó los últimos hallazgos y confirmó:

- DEF-UAT4-006 RBAC de TradeIns: PASS.
- DEF-UAT4-007 etiqueta de caja: PASS.
- DEF-UAT4-008 fiscal/POS: PASS funcional; riesgo residual: el RPC fija actualmente `FACTURA_B` y toma el primer punto de venta fiscal activo. Confirmar la configuración fiscal real antes de producción.
- DEF-UAT4-009 KPI de Documentos: PASS después del RPC seguro.
- DEF-UAT4-010 Kárdex de Stock: PASS.

### Correcciones implementadas y verificadas en este chat

- Guardas y correcciones de UI para destino en recepción de compras.
- Precios ARS/USD y permisos.
- Guardas de concepto libre/servicio y correcciones de presupuestos.
- Permisos y migración del overview de reparaciones.
- UX para exigir serial/IMEI al ingresar una reparación.
- Mapeo canónico de códigos de slots de armado de PC.
- Trade-ins: filtrado de productos, mapeo de errores, carga lazy, gating por RBAC y redacción de datos sensibles.
- POS atómico venta + documento fiscal + outbox + descuento de stock:
  - `supabase/migrations/202609170004_erp_pos_fiscal_sale.sql`
  - `apps/erp/src/features/pos/api.ts`
  - `apps/erp/src/features/pos/PosWorkspace.tsx`
  - `apps/erp/src/types/supabase.ts` regenerado.
- Trade-ins sensibles:
  - `supabase/migrations/202609170005_erp_tradein_sensitive_overview.sql`
  - `apps/erp/src/features/tradeins/TradeInsWorkspace.tsx`
- Montos de Documentos mediante RPC seguro:
  - `supabase/migrations/202609170006_erp_document_sale_amounts.sql`
  - `apps/erp/src/features/documents/api.ts`
  - `apps/erp/src/features/documents/DocumentsWorkspace.tsx`
  - `erp.list_document_sale_amounts(uuid[])` valida permiso y calcula ARS del lado servidor.
- Caja: etiqueta corregida a “Movimientos netos de caja”.
- Stock/Kárdex: se eliminó `unit_cost` innecesario de la consulta/tipo, se captura error 403 y se muestra feedback con reintento.

### Evidencia interactiva importante

Con owner se creó una venta POS con documento y solicitud fiscal:

- sale `8e5dd973-2b7d-49b9-91d3-6383e7e04377`.
- document `731876e6-ef4f-44ea-adf5-7f40aa81758b`.
- fiscal request `427da851-3bf1-4345-9c19-9e242489e8ab`.
- importe ARS 242.

Documents mostró 1 documento, 1 solicitud fiscal, KPI `Total Documentado ARS 242,00`, fila POS, `FACTURA_B 1 · Encolado` y `ARS 242,00`. Sales también pudo ver ese monto mediante el RPC seguro.

Trade-ins mostró el IMEI y ARS 150.000 para owner; para sales mostró `—`/`Restringido`, y la respuesta REST de sales devolvió esos campos sensibles como null.

Stock/Kárdex mostró `OPENING QA Kárdex visible` y `QA Serial Kardex: 1 u.` después de retirar la columna inválida. Caja mostró la etiqueta corregida. POS confirmó “Comprobante generado y timbrado encolado (queued). Stock descontado atómicamente en ERP.”

### Estado real para el próximo chat

El próximo chat debe repetir la campaña completa desde una DB local limpia, no confiar ciegamente en este resumen, y usar este documento/Engram como contexto. Mantener el circuito: Luna ejecuta y prueba; Sol planifica, decide prioridades y audita; ante un hallazgo se conserva el contexto, se aplica una corrección acotada, se retestea el módulo afectado y luego se continúa con el resto.

Orden recomendado:

1. Verificar que Docker, Supabase local y el servidor ERP estén vivos.
2. Ejecutar un único `npx supabase db reset --local` y regenerar `apps/erp/src/types/supabase.ts`.
3. Repetir pgTAP, Vitest, typecheck, lint y build.
4. Levantar el ERP y recorrer cada workspace en Edge con owner y sales; registrar evidencia visible y errores de red/RPC.
5. Si aparece un defecto, no maquillarlo con datos o mocks: clasificarlo, pedir a Sol un plan, aplicar la corrección, ejecutar la regresión y continuar.
6. Revalidar especialmente 040/050/060 y los nuevos bloques 004/005/006.
7. Mantener sin deploy remoto hasta que exista owner/profiles reales, migraciones remotas alineadas, proveedores reales, configuración fiscal/ARCA real, backup/rollback ensayado, CI reproducible y UAT firmado.

### Veredicto de entrega

- Sí: entregable para demo y QA/UAT del cliente.
- No: todavía no declarar listo para operar en producción.

Los gates externos pendientes son: autorización real ARCA/CAE y punto de venta, credenciales/datos/sucursales reales, backup y rollback/restore, CI/release reproducible, pruebas con proveedores externos y aceptación formal de caja, stock, taller, administración y dirección.
