# Auditoría ERP — seguridad, acceso y preparación para Supabase

Fecha: 2026-09-08. Inspección estática de migraciones acumuladas y clientes ERP. No se modificó implementación ni se accedió al proyecto remoto. Docker no respondió (`dockerDesktopLinuxEngine` no existe), por lo que estos hallazgos no representan una ejecución exitosa del esquema desde cero.

## Hallazgos

### SEG-01 — P1 — Cuatro vistas de reportes omiten RLS y autorización

Evidencia: `supabase/migrations/202609070013_erp_reporting_views.sql:20`, `:32`, `:44`, `:66` crean vistas sin `WITH (security_invoker=true)`. `:120` concede SELECT a authenticated. Las consultas no filtran `current_organization_id()` ni `has_permission()`. El comentario de líneas 4–6 asegura lo contrario de lo implementado. No hay ALTER VIEW posterior.

Impacto: en el despliegue normal con propietario postgres, las vistas usan privilegios del propietario y omiten RLS de las tablas base. Un usuario Auth sin asignación ERP puede consultar ventas, compras, costos y contabilidad; tener un único cliente no evita usuarios Auth sin autorización. El front no es frontera de seguridad.

Corrección: configurar security_invoker explícitamente, completar los grants mínimos de columnas a las tablas subyacentes sin revelar costos a roles incorrectos y probar por REST cuatro identidades: anon, autenticado sin perfil ERP, operador restringido y dueño. Probar también dos organizaciones y una denegación explícita de costos. No basta probar con owner.

### SEG-02 — P1 — Primer dueño de la guía no obtiene acceso funcional en la UI

Evidencia: `supabase/migrations/202608190001_erp_foundation.sql:603` bootstrap_owner solo asigna organización/profile_roles. `supabase/migrations/202608190010_erp_finance_accounting.sql:369` get_current_erp_context devuelve org/user, sin permisos. `apps/erp/src/auth/ErpAuthProvider.tsx:81` usa app_metadata.permissions o role de metadata. No existe sincronización SQL de estos metadatos. `supabase/README.md:61` documenta solo bootstrap_owner.

Reproducción: crear usuario Auth nuevo sin metadata, ejecutar bootstrap_owner desde service_role, iniciar ERP. DB tiene owner pero hasPermission devuelve false para todos los módulos.

Corrección: contexto RPC debe devolver permisos efectivos calculados desde tablas, incluyendo overrides y vigencias; frontend debe consumirlos. Eliminar dependencia de user_metadata.role (editable por el usuario). Esa metadata hoy puede habilitar controles visuales, aunque no demuestra por sí sola una evasión del RLS. No corregir esto agregando roles manuales duplicados a JWT porque perpetúa divergencia y revocaciones obsoletas.

### SEG-03 — P2 — Vistas de canjes/armados revelan costos con permiso de lectura ordinario

Evidencia: `202609070006_erp_phase_e_pc_tradeins_fixes.sql:478` / `:581`: vistas definer. Sí filtran org y trade_ins.view/pc_builds.view en líneas 575–576 y 655–656, pero exponen appraised_value_base (:510), total_components_cost (:601,630) y seriales (:494,:612). En contraste, `202608190008_erp_pc_tradeins_imei.sql:835–843` exige costs.view y registra lectura sensible en get_pc_build_costs/get_trade_in_costs.

Impacto: el endpoint overview evita el permiso de costos y su auditoría. Menor impacto inmediato en uso unipersonal, pero contradice controles implementados y la pantalla de permisos.

Corrección: separar proyección pública del módulo y proyección sensible protegida; mantener chequeo costs.view y auditoría. Probar con rol lector sin costos.

### SEG-04 — P2 — Error al recuperar sesión puede dejar carga infinita

Evidencia: `apps/erp/src/auth/ErpAuthProvider.tsx:57–61`: si getSession retorna error, setError pero no setLoading(false); `ErpAccessGate.tsx:38–43` evalúa loading antes que error. La promesa tampoco tiene catch. Errores de contexto no limpian organizationId y una sesión nula no limpia error.

Impacto: fallo de sesión/almacenamiento puede dejar al único operador en Cargando sesión sin acceso a recuperación; errores de contexto pueden persistir hasta recargar.

Corrección: transiciones de estado explícitas, limpiar contexto/error al cambiar sesión, finalizar loading en todos los caminos y descartar respuestas de contexto obsoletas. Prueba del provider real con getSession error/rechazo, logout y token refresh.

### MIG-01 — P1 si estos módulos se incluyen en entrega — Integraciones externas son contratos, no sistemas operativos

Evidencia: solo existen Functions create-mercadopago-preference, mercadopago-webhook y get-dollar-rate. No hay workers/adapters ERP para PDF/Storage, mensajería, fiscal o IMEI. `202608190009_erp_documents_communications.sql:701` declara que PDF y upload son adapters externos. `apps/erp/src/features/documents/api.ts:211–232` emite metadatos con private_object_path null; DocumentsWorkspace.tsx:204 calcula hash de JSON, no PDF. WhatsApp api.ts:228 únicamente queue_customer_message. Los callbacks SQL service_role no hacen requests a proveedores por sí mismos.

Impacto: migrar a Supabase no produce comprobantes PDF, envío WhatsApp, autorización fiscal ni consulta IMEI automática. Pueden quedar solicitudes en cola indefinidamente. Si el alcance comercial no incluye estos servicios, deben retirarse/identificarse como no operativos y ofrecer flujo manual honesto; no prometerlos completos.

Corrección: implementar y desplegar los adapters incluidos en alcance, secretos server-side, webhooks verificados, worker/reintentos/idempotencia y alertas. Para documentos/media: bucket privado, reglas, upload real, hash de bytes PDF y descarga firmada autorizada. No hay declaraciones storage.buckets/storage.objects en las migraciones actuales.

### MIG-02 — P1 de entrega — No existe procedimiento completo reproducible de instalación productiva

Evidencia: `supabase/README.md:3` declara desarrollo exclusivamente local; `:61` guía bootstrap local. Config expone erp localmente (`supabase/config.toml:5`), no acredita exposición del schema en un proyecto alojado. seed crea organización, sucursal, roles/permisos, estados de reparación, plantillas y clave de cifrado: no son detalles prescindibles. Pasar migraciones sin seed deja al sistema sin datos esenciales para owner y flujos.

Faltantes de cierre: proyecto identificado; respaldo y diff si hay esquema existente; ensayo de migraciones completas + seed en entorno descartable; configuración de Data API para erp; variables frontend para hosting; creación del usuario y bootstrap; datos reales del negocio; claves y proveedores; prueba de restauración; smoke tests ERP autenticados; comprobación que ningún valor local del build quedó incrustado. Es una condición de entrega, no evidencia de que la migración necesariamente falle.

Clave de equipos: el seed SÍ crea 32 bytes aleatorios (`supabase/seed.sql:776`). SQL `202608190007_erp_repairs_quotes_warranties.sql:1543` dice explícitamente que el material actual es una base local y que la integración externa KMS/Vault no está implementada. Definir custodia/backup/restauración de la clave; no afirmar que ya existe un KMS ni que la clave está ausente. No requerir una arquitectura empresarial innecesaria: sí garantizar que restaurar datos restaura capacidad de descifrado y que los backups sensibles se protegen.

### MIG-03 — P2 — Sin recuperación de acceso para el único operador

El login ERP solo implementa signInWithPassword (`ErpAccessGate.tsx:19–34`). No se encontró resetPasswordForEmail ni flujo para establecer nueva contraseña en apps/erp/src. Falta camino documentado de recuperación o funcionalidad; si el dueño pierde acceso depende del desarrollador/dashboard.

## Controles positivos verificados estáticamente

- Schema erp revoca uso a anon/public, privilegios predeterminados revocan ejecución pública y tablas disponen políticas RLS.
- bootstrap_owner exige service_role y evita reasignar perfiles existentes.
- Funciones de permisos consultan datos de perfil/roles/overrides en DB; no confían en user_metadata.
- Callbacks de proveedores relevantes requieren service_role y se revocaron grants públicos en fixes acumulados. No reportar versiones previas ya corregidas.
- repair_orders_overview sí declara security_invoker=true.
- Credenciales de reparación se cifran, no se exponen directamente a roles API y lectura sensible se audita; tokens públicos tienen RPC dedicadas.

## Verificación pendiente y límites

No se certifica ausencia total de vulnerabilidades ni migración exitosa. Se requiere ejecutar migrations+seed y tests SQL contra instancia descartable; inspeccionar pg_class.reloptions, políticas y permisos efectivos para las vistas; consultas REST bajo usuarios de prueba, sin confiar en mocks de hasPermission. No se accedió ni alteró producción.
