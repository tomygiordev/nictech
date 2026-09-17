# Estado de correcciones del ERP

Actualización: 10 de septiembre de 2026. Trabajo local, sin despliegue ni acceso al Supabase de producción.

## Verificación ejecutada

- `npm run typecheck:erp`: aprobado después de las correcciones de reparaciones y presupuestos.
- `npx vitest run --maxWorkers=1`: 13 archivos, 70 pruebas aprobadas. La ejecución concurrente anterior tuvo un timeout de navegación; esa misma prueba pasó aislada y en la suite secuencial, sin aumentar el timeout.
- `npm run build:erp` y `npm run build:storefront`: aprobados durante esta revisión. Cambios posteriores menores en presupuestos y reparaciones tienen typecheck y suite aprobados; falta repetir build final tras cerrar todos los cambios.
- `npm run lint`: 0 errores, 23 advertencias durante esta revisión.
- `deno check`: ambos puntos de entrada de Mercado Pago aprobados.
- Auditoría de dependencias de producción ERP: 0 vulnerabilidades conocidas. Proyecto completo: 4 alertas moderadas en Quill/React Quill y React Router/React Router DOM.
- Docker arrancó y mostró la base local healthy, pero luego perdió conexión. Tras reiniciar devolvió error HTTP 500 y registros de espera del motor. No se confirma aplicación ni aprobación de la nueva migración. No se reseteó la base.

## Cambios implementados, con aceptación integral todavía pendiente

- POS: selección de contexto y medios de pago reales, disponibilidad descontando reservas, soporte de selección de unidades y clave de operación estable durante reintentos.
- Compras/proveedores: organización al crear proveedor, consultas de deuda corregidas y contexto operativo.
- Ajustes de stock: cantidad entera positiva, costo explícito de ingreso, motivo obligatorio, sucursal real y clave estable.
- Reparaciones: registro de mano de obra y cobros, control de permisos visible, confirmación de reversión, selección de ubicación de la sucursal, errores de consultas visibles y controles QC no preaprobados.
- Presupuestos: consulta de columnas reales de la vista de reparaciones, exclusión de órdenes terminales y propagación de errores. Eliminado fallback de cotización inventada.
- Finanzas: propagación de errores y separación de totales por moneda en cuentas.
- Interfaz: carga diferida de módulos, manejo de errores, foco de modales y navegación accesible.
- Mercado Pago: validación de variantes, firma y configuración explícita, puente transaccional ERP propuesto. Se bloquean productos no habilitados en ERP y modos de inventario distintos de cantidad. No hay cobros reales probados.
- Migración nueva: endurecimiento de permisos/vistas, contexto de autorización, validaciones de integridad y contabilización. Se agregaron 12 comprobaciones SQL de seguridad; todavía no se afirma que pasen.

## Pendientes que impiden declarar el ERP listo

1. Recuperar motor Docker y ejecutar migración y suite SQL completas, incluyendo operaciones y reversos con datos locales. Las pruebas SQL nuevas solo comprueban parte de los permisos; no sustituyen aceptación transaccional.
2. Dashboard: todavía contiene consultas de storefront contra esquema ERP y agregados que no representan toda la operación.
3. Armados PC: la reserva todavía no incluye selección/envío de ubicación.
4. Financiación: falta integración completa de obligación original, anticipo, cobros, caja y libro contable.
5. Ventas: falta historial operativo y UI completa de cobro de saldo/anulación/reembolso.
6. Etiquetas: continúa el generador no estándar; no se ha verificado escaneabilidad con decodificador ni lector físico.
7. Catálogo/inventario: faltan flujos completos de recepción serializada, mantenimiento de variantes, inventario inicial y conteos; revisar también paginación/agregados.
8. Documentos e integraciones: no se ha completado generación/almacenamiento PDF ni trabajadores reales ARCA, WhatsApp e IMEI.
9. Mercado Pago: falta resolver/probar correspondencia entre catálogo público y ERP, reservas previas al pago y reversos completos de reembolsos. No activar cobros reales basándose en este parcial.
10. Tipos ERP: el cliente sigue sin tipos generados del esquema. El typecheck actual no valida por sí solo todas las columnas de las consultas.
11. Pruebas end-to-end, permisos por rol/sucursal, monedas, conciliación y despliegue requieren validación final. Producción continúa fuera de alcance sin autorización expresa.

## Dictamen

Corrección parcial con compilaciones y pruebas unitarias verificadas. **No listo para producción ni auditoría cerrada.** Los cambios están conservados en el árbol de trabajo; no se crearon commits ni se publicó un despliegue. Las guías Supabase, QA e Impeccable orientaron los controles de permisos, validación y errores visibles; no constituyen una certificación.
