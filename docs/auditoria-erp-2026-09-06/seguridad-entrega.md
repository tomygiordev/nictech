# Auditoría De Seguridad Y Entrega ERP

**Fecha:** 2026-09-07.  
**Modalidad:** revisión estática de solo lectura, sin verificación runtime.  
**Persistencia:** informe anterior completo, guardado por solicitud del usuario; esta documentación no constituye una nueva auditoría.

**Veredicto: el ERP actual no está listo para entrega operativa ni para promoverlo a remoto.** Hay controles SQL relevantes implementados, pero la aplicación mezcla ese modelo con tablas heredadas de `public`, autenticación simulada y módulos que anuncian resultados exitosos sin persistencia ni integración real.

No identifiqué un **P0 demostrado**. Sí identifiqué defectos **P1 de seguridad, integridad y entrega**, además de problemas P2. El candidato `ensure_open_period` queda **condicionado a las ACL iniciales/instaladas**, con reconstrucción explícita de privilegios; no lo presento como explotación comprobada de la base actual.

La auditoría fue estática, sobre el contenido actual del worktree, incluidos archivos modificados y no versionados. No edité archivos, no ejecuté tests/builds/instalaciones, no inicié Docker y no consulté DB ni servicios remotos. No abrí archivos `.env` ni almacenes de credenciales. Los valores de claves no se reproducen en este informe. La lista de cambios de Git al finalizar coincide con la inicial.

Las rutas siguientes son relativas a `A:\nictech`.

## Hallazgos P1

### H01. La Asignación De Roles Puede Omitir La Protección De Permisos Sensibles

**Tipo:** autorización real en DB, no bypass visual.

**Evidencia:**
- `supabase/migrations/202608190001_erp_foundation.sql:876-889`: `profile_roles_manage` permite insertar si el rol aparentemente no tiene permisos sensibles, o si el actor tiene `users.assign_sensitive`.
- `supabase/migrations/202608190001_erp_foundation.sql:891-918`: el mismo patrón aparece al actualizar asignaciones.
- `supabase/migrations/202608190001_erp_foundation.sql:828-837`: las consultas a `permissions` y `role_permissions` están filtradas por `users.view`.
- `supabase/migrations/202608190001_erp_foundation.sql:993`: `authenticated` recibe privilegios de inserción/actualización sobre estas tablas.

**Escenario:** un administrador delegado tiene `users.manage`, pero no `users.view` ni `users.assign_sensitive`. Al insertar una asignación a un rol sensible conocido de su organización, el subquery `NOT EXISTS` no ve los permisos ocultos por RLS. Interpreta “no puedo verlos” como “no existen”.

La condición puede permitir autoasignarse un rol privilegiado. El catálogo de permisos del rol sigue existiendo y `has_permission()`, como función `SECURITY DEFINER`, sí lo verá después.

**Impacto:** escalada de privilegios dentro del tenant, saltando la separación explícita entre gestionar usuarios y asignar permisos sensibles. No requiere romper la UI.

**Confianza:** alta por análisis de políticas. No ejecuté el escenario. La combinación de permisos del administrador delegado es una precondición, no una propiedad de todos los usuarios seed.

**Criterio de aceptación:** con `users.manage` y sin `users.assign_sensitive`, asignar o modificar una asignación hacia un rol sensible debe fallar tanto con `users.view` como sin él, incluyendo denegaciones y permisos por sucursal. La comprobación de sensibilidad debe consultar información autoritativa no ocultable por la RLS del solicitante.

### H02. `ensure_open_period` No Queda Cerrada Por La Revocación Por Esquema

**Tipo:** riesgo de acceso real a DB, **condicionado a las ACL iniciales/instaladas**.

**Evidencia:**
- `supabase/migrations/202608190010_erp_finance_accounting.sql:386-412`: función `SECURITY DEFINER` que recibe `target_organization_id`, consulta/bloquea períodos e inserta uno si no existe.
- No verifica `auth.uid()`, pertenencia al tenant ni `accounting.post`.
- `supabase/migrations/202608190001_erp_foundation.sql:989-1008`: ACL generales.
- No encontré revocación específica posterior para esta función en las migraciones versionadas.

**Reconstrucción de privilegios:**

| Paso | Efecto |
|---|---|
| Foundation revoca acceso al esquema a `PUBLIC` y `anon` | El anónimo no obtiene acceso directo al esquema por esa vía. |
| Foundation concede `USAGE` a `authenticated` y `service_role` | Un usuario autenticado puede resolver funciones del esquema si dispone de `EXECUTE`. |
| Foundation ejecuta `REVOKE ALL ON ALL FUNCTIONS ...` | Afecta funciones existentes entonces; `ensure_open_period` se crea después, en 010. |
| Foundation usa `ALTER DEFAULT PRIVILEGES IN SCHEMA erp REVOKE EXECUTE ...` | Una revocación por esquema no sustrae el privilegio global predeterminado de PostgreSQL que concede ejecución de funciones a `PUBLIC`. |
| Migración 010 crea la función | Con defaults globales estándar, hereda ejecución por `PUBLIC`. |
| Migraciones posteriores | No encontré una revocación específica ni una corrección global que cierre esta función. |

No encontré cambios versionados de roles/membresías que permitan sustituir esa conclusión por otra ACL efectiva. **Tampoco inspeccioné `pg_default_acl`, propietario, `proacl` ni membresías reales de la instalación.**

**Escenario:** con defaults globales estándar, un usuario `authenticated`, incluso sin perfil ERP autorizado, puede invocar la función con un UUID de organización conocida y una fecha sin período existente.

**Impacto:** creación no autorizada de períodos contables en otro tenant y bloqueo de filas existentes. No equivale a poder publicar asientos arbitrarios.

**Conclusión del candidato:** no se descarta por el `REVOKE ALL` inicial ni por el default por esquema. Es un defecto estático de endurecimiento con una vía de explotación bajo defaults estándar; **la exposición efectiva de la DB actual permanece sin confirmar**.

**Criterio de aceptación:** las ACL efectivas deben impedir ejecución directa por roles de aplicación no autorizados. Debe verificarse `has_function_privilege` y una llamada real negativa con `authenticated`, además de mantener operativos los comandos contables autorizados que usan el helper.

### H03. El Cliente Puede Conectarse A Remoto Sin Configuración Explícita

**Evidencia:**
- `apps/erp/src/lib/supabase.ts:5-6`: destino remoto y clave pública predeterminados.
- `apps/erp/src/lib/supabase.ts:12-18`: sustituyen variables ausentes.
- `apps/erp/src/lib/supabase.ts:20-26`: si falla la validación, se construye igualmente otro cliente con los defaults.
- `apps/erp/src/lib/supabase.ts:28`: `supabaseConfigError` siempre es `null`.
- `apps/erp/vite.config.ts:7`: el ERP toma variables desde la raíz compartida.

**Escenario:** abrir el ERP en desarrollo sin configurar variables, o con URL inválida, puede provocar llamadas al proyecto remoto embebido en lugar de detenerse.

**Impacto:** ruptura del aislamiento local/remoto. Si existe una sesión válida para ese destino y las ACL lo permiten, las operaciones pueden afectar datos reales.

**Distinción importante:** una clave pública no equivale a `service_role`. El problema es el destino implícito y la continuación ante una configuración inválida, no que una clave de cliente conceda privilegios administrativos.

**Criterio de aceptación:** ausencia o invalidez de configuración debe impedir crear el cliente y efectuar llamadas. El entorno local debe seleccionar su destino explícitamente; ninguna ruta de error puede sustituirlo por remoto.

### H04. Contexto Y Finanzas Consultan `public`, Pero Sus Contratos Están En `erp`

**Evidencia:**
- `apps/erp/src/lib/supabase.ts:20-26`: no configura `db.schema`.
- `apps/erp/src/auth/ErpAuthProvider.tsx:92`: invoca `client.rpc("get_current_erp_context")` sin seleccionar esquema.
- `supabase/migrations/202608190010_erp_finance_accounting.sql:369-384`: la función existe como `erp.get_current_erp_context`.
- `apps/erp/src/features/finance/api.ts:32-95` y `:97-183`: tablas y RPC sin selección de esquema.
- `supabase/config.toml:5`: expone `erp`, pero eso no lo convierte en el esquema predeterminado del cliente.

**Escenario:** conectar la aplicación a una base reconstruida con estas migraciones. El cliente busca el contexto y las tablas financieras en `public`, donde no están definidos por esta cadena.

**Impacto:** bloqueo del contexto autenticado en producción y consultas/comandos financieros dirigidos al contrato incorrecto. En desarrollo, el manejo permisivo de errores puede ocultarlo.

Además, otras pantallas esperan deliberadamente columnas del modelo heredado de `public`; **añadir simplemente `db.schema = "erp"` a todo el cliente no resuelve el desacople**.

**Criterio de aceptación:** separar explícitamente los clientes/contratos ERP y legacy o migrar los consumidores. La autenticación y las operaciones financieras deben demostrar que llegan al esquema correcto, sin depender de wrappers no versionados.

### H05. El Bootstrap DB No Produce Los Permisos Que Exige La UI Y Falta El Ingreso ERP

**Evidencia:**
- `apps/erp/src/auth/ErpAuthProvider.tsx:138-143`: autorización visual basada exclusivamente en `session.user.app_metadata.permissions`.
- `supabase/migrations/202608190010_erp_finance_accounting.sql:382`: el contexto devuelve sólo organización y usuario.
- `supabase/migrations/202608190001_erp_foundation.sql:634-655`: `bootstrap_owner` actualiza perfil y asigna un rol DB, pero no sincroniza metadata Auth.
- `supabase/README.md:61-74`: ése es el procedimiento documentado para el primer responsable.
- `apps/erp/src/auth/ErpAccessGate.tsx:19-26`: sin sesión muestra una instrucción de iniciar sesión, pero no ofrece un flujo de ingreso.
- En `apps/erp/src` no encontré implementación de `signIn` ni un puente versionado de permisos DB a claims.

**Escenario:** registrar un usuario local y ejecutar el bootstrap documentado. La DB puede reconocerlo como owner, pero la UI no obtiene su matriz de permisos. Un navegador nuevo tampoco tiene un mecanismo de ingreso implementado en el ERP.

**Impacto:** entrega no utilizable por un operador nuevo y divergencia entre permisos visuales y efectivos. Las revocaciones, vencimientos y alcances por sucursal de DB tampoco están representados por ese array plano.

**Criterio de aceptación:** completar el recorrido navegador nuevo → ingreso → contexto → módulos autorizados usando el RBAC efectivo. Probar bootstrap, usuario desactivado, revocación y rol limitado a sucursal. La solución debe documentar cómo se actualizan los permisos, sin confiar en metadata modificable del lado cliente.

### H06. La Cadena Actual Tiene Un Bloqueo De Instalación Limpia

**Evidencia:**
- `supabase/migrations/202608190009_erp_documents_communications.sql:556`: define `record_provider_webhook` con argumentos `provider`, `provider_event_id`, `event_type`, `payload_sha256`, `signature_valid`.
- `supabase/migrations/202608260004_erp5_documents_permissions.sql:155-162`: usa `CREATE OR REPLACE FUNCTION` con los mismos tipos, pero cambia esos nombres a `target_*`.
- `supabase/migrations/202608260005_erp5_documents_permissions_followup.sql:1-6`: reconoce modificaciones añadidas después de registrar 004 y recién allí incorpora el `DROP`.

**Escenario:** aplicar los archivos actuales en orden sobre una base vacía.

PostgreSQL no permite renombrar argumentos de entrada existentes mediante ese `CREATE OR REPLACE`. El error esperado es `cannot change name of input parameter`, antes de alcanzar el `DROP` de 005.

**Impacto:** una base histórica que recibió otra versión de 004 puede funcionar mientras una reconstrucción limpia con el repositorio actual falla. Una migración posterior no repara un paso anterior que impide llegar a ella.

**Confianza:** alta por incompatibilidad DDL; no es una ejecución observada en esta sesión.

**Criterio de aceptación:** tanto replay limpio como actualización desde la base histórica deben completar y converger en definiciones y ACL. La solución requiere reconciliar la historia aplicada; no basta con añadir otro parche al final ni debe reescribirse a ciegas lo ya aplicado.

### H07. Sistema Simula Altas, Bajas, RBAC, MFA Y Caducidad De Sesión

**Evidencia:**
- `apps/erp/src/features/system/SystemWorkspace.tsx:48-70`: usuarios en `localStorage`.
- `:72-97`: alta/baja sólo modifican estado local, pero anuncian creación y baja del sistema.
- `:64-66`, `:99-101`: preferencias en estado React y “guardado” que sólo muestra un mensaje.
- `:242-268`: afirma 2FA obligatorio y cierre por inactividad sin implementación correspondiente.

**Escenario:** un administrador “da de baja” a un operador o cree haber activado MFA. No se desactiva ningún perfil, asignación ni sesión real.

**Impacto:** falsa aplicación de controles de seguridad. Un operador real no pierde acceso por esa baja visual; MFA y timeout no quedan impuestos.

**Distinción:** crear un “Administrador” en esa pantalla tampoco concede privilegios reales en DB. Ambos sentidos son simulados.

**Criterio de aceptación:** conectar gestión de usuarios y permisos a operaciones autorizadas/auditadas; mostrar éxito sólo tras confirmación. MFA y timeout deben tener enforcement verificable. Mientras no exista, las funciones deben quedar marcadas inequívocamente como demo y no presentarse como controles activos.

### H08. Auditoría Presenta Datos De Ejemplo Como Evidencia Inmutable Verificada

**Evidencia:**
- `apps/erp/src/features/audit/AuditWorkspace.tsx:31-44`: cinco eventos fijos.
- `:61-78`: afirma registro criptográfico, “100% Auditado” y hash SHA-256 verificado.
- `:115-120`: cero anomalías fijo.
- `:148`: imprime ese contenido.
- `supabase/migrations/202608190001_erp_foundation.sql:210-232`: existe una tabla real de auditoría, pero esta pantalla no la consulta.

**Escenario:** ocurren cambios de permisos o incidentes operativos. La pantalla sigue mostrando los mismos ejemplos y puede imprimirse como si fuera un registro probatorio.

**Impacto:** incapacidad de investigar actividad real y generación de evidencia engañosa. No encontré en la cadena revisada una verificación criptográfica del libro que justifique esas afirmaciones.

**Criterio de aceptación:** leer eventos reales con aislamiento y permiso `audit.view`; distinguir vacío, error y datos demo. Toda afirmación de verificación criptográfica debe corresponder a un mecanismo implementado y comprobado.

### H09. Salud De Integraciones Y Reintentos No Tienen Backend

**Evidencia:**
- `apps/erp/src/features/integrations/IntegrationHealthWorkspace.tsx:41-55`: servicios, latencias y eventos fijos.
- `:61-67`: “reintentar” cambia el estado a `delivered`; “reverificar” espera 600 ms.
- `:75`, `:98-99`, `:121-125`: ecosistema operativo, Online, garantía Exactly-Once y DLQ vacía sin consulta.
- `apps/erp/src/features/whatsapp/WhatsappWorkspace.tsx:85-100`: enviar sólo agrega un mensaje local marcado `sent`.
- `:118`: declara WhatsApp conectado.

**Escenario:** proveedor caído, webhook inválido o evento detenido. La UI permanece verde; pulsar reintento no reejecuta trabajo real.

**Impacto:** ocultamiento de fallos de pagos, mensajería y emisión fiscal, y falsa confirmación de recuperación.

**Criterio de aceptación:** estados derivados de intentos/resultados persistidos, con fecha de observación y estado desconocido cuando no hay medición. Reintentos autorizados con `integrations.retry`, idempotentes y auditados. “Entregado” debe depender de evidencia real, no de `setState`.

### H10. Documentos Genera CAE Aleatorios Y Los Declara Autorizados

Este módulo se contrastó como dependencia directa de las afirmaciones de integración y entrega.

**Evidencia:**
- `apps/erp/src/features/documents/DocumentsWorkspace.tsx:135-151`: genera numeración y CAE con `Math.random`, asigna `status: "authorized"` y una ruta PDF construida.
- `:154-155`: anuncia emisión y autorización.
- `:162-169`: la anulación también es local.
- `:201-202`: se presenta como facturación oficial conectada a ARCA.
- `supabase/seed.sql:730-732`: el punto fiscal seed es `local_stub`.

**Escenario:** un operador emite una factura desde la pantalla y entrega el resultado como comprobante fiscal autorizado.

**Impacto:** uso de documentos sin autorización fiscal real, numeración no autoritativa y riesgo operativo/tributario.

**Criterio de aceptación:** un CAE sólo puede provenir de una respuesta validada del proveedor y persistirse por el flujo fiscal autorizado. El stub debe ser inequívocamente no fiscal, sin mensajes ni impresión que aparenten autorización oficial.

### H11. POS Y Stock Pueden Anunciar Éxito Sin Una Operación Íntegra

**Evidencia:**
- `apps/erp/src/features/pos/PosWorkspace.tsx:174-220`: actualiza stock producto por producto e inserta movimientos por separado; no comprueba los errores devueltos por esas operaciones.
- `:182`: calcula stock desde la copia del navegador y lo recorta a cero.
- `:218-220`: emite ticket, vacía carrito y anuncia venta exitosa.
- `apps/erp/src/features/stock/StockWorkspace.tsx:98-130`: mismo patrón para ajustes.
- `apps/erp/src/features/cash/CashWorkspace.tsx:28-65`: caja y arqueo son sólo locales.

**Escenario:** la DB rechaza una actualización por RLS o falla la inserción del movimiento. El código continúa porque un resultado Supabase con `error` no se convierte automáticamente en una excepción. También pueden competir dos terminales usando el mismo stock inicial.

**Impacto:** ventas aparentes no registradas, actualizaciones parciales, pérdida de movimientos y divergencia entre caja, stock y contabilidad. No se están usando los comandos transaccionales ERP que implementan esas garantías.

**Distinción:** no afirmo que la RLS de `public` permita escrituras indebidas; no está acreditada aquí. Incluso si las rechaza correctamente, el falso éxito de UI permanece.

**Criterio de aceptación:** venta/pagos/stock mediante comandos autoritativos atómicos e idempotentes. Cualquier rechazo debe conservar el carrito y no emitir éxito. Probar competencia entre terminales y conciliación de libros.

## Hallazgos P2

### H12. El Modo DEV Abre La UI Sin Una Identidad ERP Válida

**Evidencia:** `ErpAuthProvider.tsx:59-61`, `:76-109`, `:138-143`; `ErpAccessGate.tsx:16-20`.

En desarrollo se restaura el mock al no haber sesión, se silencian errores de contexto y `hasPermission` devuelve `true` para el mock. Cerrar sesión y recargar vuelve a ese estado.

**Impacto:** una demostración local o una prueba visual puede aparentar validación de auth/RBAC sin haberla realizado. Al coexistir con un cliente real, no es un sandbox aislado.

**No implica:** el token ficticio no se instala como una sesión válida de Supabase, no falsifica `auth.uid()` ni concede permisos DB.

**Aceptación:** modo demo explícito, identificado y sin backend real; modo integrado local con autenticación y denegaciones reales. Logout debe terminar el acceso, no sustituirlo por un operador ficticio.

### H13. Una Denegación De Sucursal Se Neutraliza En `branches_update`

**Evidencia:**
- `supabase/migrations/202608190001_erp_foundation.sql:784-799`: permite `has_permission('locations.manage', id) OR has_permission('locations.manage')`.
- `supabase/migrations/202608190012_fix_erp_permission_clock.sql:25-35`: la denegación de sucursal se evalúa cuando coincide el branch objetivo.

**Escenario:** usuario con permiso global de gestionar ubicaciones y un `deny` específico para una sucursal. La comprobación con sucursal devuelve falso, pero la global vuelve a permitir actualizarla.

**Impacto:** incumplimiento de la excepción explícita sobre ese registro. Es acceso DB real, limitado a esa política, no una fuga general entre tenants.

**Aceptación:** el `deny` local debe prevalecer también ante un grant global. Probar actualización directa de la sucursal denegada y una permitida.

### H14. Datos Locales Sin Aislamiento Por Organización Ni Usuario

**Evidencia:**
- `SystemWorkspace.tsx:49-70`: `erp_users_list_v1`.
- `CustomersWorkspace.tsx:45-69`: `erp_customers_list_v1`.
- `DocumentsWorkspace.tsx:108-129`: `erp_fiscal_docs_v1`.
- `App.tsx:217-224`: logout no elimina esos registros.

**Escenario:** distintos operadores u organizaciones usan el mismo perfil del navegador y origen. Las pantallas recuperan las mismas listas, incluidos los datos reales que se hayan introducido.

**Impacto:** contaminación de datos y exposición local entre sesiones. La RLS no protege datos que nunca llegan a la DB.

Los `JSON.parse` sin validación agregan una fragilidad: un valor corrupto puede romper el montaje del módulo.

**Aceptación:** no almacenar datos empresariales reales en colecciones demo globales; separar contexto y ciclo de vida de datos locales, validar lo recuperado y comprobar cambio de usuario/tenant.

### H15. Finanzas Oculta Errores Y Ofrece Sólo Sucursales Inválidas

**Evidencia:**
- `apps/erp/src/features/finance/api.ts:32-95`: errores de consulta terminan como `[]`.
- `AccountsWorkspace.tsx:17-18`, `:30-31`, `:46`: identificadores `dev-*`.
- `AccountsWorkspace.tsx:241-242`, `:327-328`: las opciones de sucursal provienen de esa lista.
- `apps/erp/src/features/finance/schemas.ts:7-8`, `:20-21`: exige UUID válidos.

**Escenario:** seleccionar cualquiera de las sucursales disponibles e intentar crear financiación o registrar un cobro. La validación rechaza el identificador. Separadamente, una consulta fallida aparenta un libro sin registros.

**Impacto:** bloqueo funcional y diagnóstico engañoso, aun después de corregir el esquema del cliente.

**Aceptación:** selectores con IDs reales autorizados; envío exitoso usando esas opciones. Un error de permisos, red o contrato no debe mostrarse como “no hay financiaciones/asientos”.

### H16. La Documentación De Entrega Acredita Funciones No Demostradas

**Evidencia:**
- `docs/guia-erp-nictech.html:1764-1799`: ARCA oficial operativo y auditoría SHA-256 firmada con IP.
- `:1810-1811`: verificaciones ya marcadas como aprobadas.
- `docs/errores-erp.md:158-163`: afirma que no se crea cliente ante configuración inválida, contrario al código actual.
- `docker/nginx/spa.conf:11-14`: `/health` siempre devuelve 200.
- `docker-compose.apps.yml:32-36`: el healthcheck ERP consulta ese endpoint.

**Impacto:** aprobar una entrega usando capturas, checks históricos o salud del servidor estático como prueba de autenticación, DB o integraciones.

**Aceptación:** documentación asociada a una revisión concreta, con demo/stub/real y verificado/pendiente diferenciados. Separar salud HTTP de readiness DB y de disponibilidad de proveedores; ninguna casilla de cumplimiento debe estar aprobada sin evidencia.

## Controles Y Candidatos Revalidados

| Área | Resultado estático |
|---|---|
| Guards de módulos | `App.tsx:614-617` mantiene `ErpAccessGate` alrededor del contenido. Los accesos rápidos no prueban por sí mismos un bypass del guard. |
| Tabs por permiso | `WorkspaceModuleTabs.tsx:24-28` filtra submódulos. Es control visual, no autorización DB. |
| Identidad tenant | `current_organization_id()` deriva del perfil asociado a `auth.uid()`, no de un tenant arbitrario enviado por el navegador. |
| Permisos efectivos | La versión de `has_permission` en 012 conserva perfil activo, rol activo, vigencia, deny y branch activo. El problema histórico del reloj está corregido en esa definición. |
| FK de tenant/branch | Hay referencias compuestas en asignaciones, configuración y auditoría. No basta con indicar que existe `organization_id`; aquí sí hay restricciones relevantes. |
| Auditoría real | Foundation implementa triggers append-only, RLS y revocación de escritura a `authenticated`; también revoca `TRUNCATE` a `service_role` sobre las tablas existentes. No equivale a una firma criptográfica. |
| Datos sensibles | Se separan detalles privados y se restringen columnas/RPC. La auditoría de reparaciones evita volcar payloads sensibles completos (`007:1327-1331`). |
| `provision_repair_credential_key` | El grant a `authenticated` de `202608260001:103` se revoca en `202608260003:3`. No lo reporto como exposición vigente basándome sólo en el grant intermedio. |
| Webhook y automatización | `202608260007:2-5` cierra explícitamente ejecución de los dos comandos indicados a `PUBLIC`, `authenticated` y `anon`, manteniendo servicio. |
| SELECT de tokens de presupuesto | `202608260015:20` concede SELECT, pero la tabla tiene RLS y no encontré una política SELECT para `authenticated`. El grant aislado no demuestra lectura de tokens. |
| Revocación de tokens anteriores | El followup 020 intenta ampliar revocación a todos los presupuestos anteriores. Su aplicación final requiere verificar la definición instalada, no inferirla del nombre del archivo. |
| Acceso anónimo | Hay RPC públicas específicas de seguimiento/respuesta por token. No equivalen a acceso general a tablas ERP. |
| Tablas heredadas | No extrapolé las garantías RLS de `erp` a `public.products`, `public.orders` o `public.repairs`. Son superficies distintas. |

**Observación adicional:** desactivar una organización no participa en las comprobaciones revisadas de `current_organization_id()` y `has_permission()`. Sí se comprueba actividad del perfil y, cuando corresponde, de la sucursal. Si `organizations.is_active=false` debe suspender todo el tenant, esa semántica necesita definirse y probarse; no doy por existente ese mecanismo.

## Matriz De Demos

Esta matriz describe la implementación visible en código, no ejecuciones realizadas.

| Área | Implementación actual | Qué se puede afirmar |
|---|---|---|
| Shell, navegación y perfil | Guards visuales y datos de perfil parcialmente fijos | Demo de navegación; no certificación RBAC. |
| Sistema/usuarios | Estado y `localStorage` | Maqueta de gestión, sin altas/bajas Auth reales. |
| Seguridad/MFA/timeout | Estado React | No hay enforcement demostrado. |
| Auditoría | Eventos/KPI fijos | Demo, no registro real. |
| Integraciones/outbox | Constantes y cambios de estado local | No mide salud ni reintenta trabajo. |
| WhatsApp | Conversaciones demo y envío local | No acredita entrega al proveedor. |
| Documentos/ARCA | `localStorage`, CAE aleatorio | No apto como comprobante fiscal. |
| Caja | Apertura/cierre locales | No concilia caja persistida. |
| Clientes, compras, presupuestos y PC | Colecciones locales; algunas consultas auxiliares | No constituyen flujos ERP transaccionales completos. |
| Canjes | Colección local y cotización auxiliar | No demuestra procedencia/IMEI/cuarentena del backend. |
| POS y stock | Acceso a tablas heredadas, escrituras separadas | Interacción DB posible; integridad ERP no garantizada. |
| Catálogo, pedidos y reparaciones | Consultas/escrituras del modelo heredado | No asumir protección ni trazabilidad del esquema ERP. |
| Cuentas/contabilidad | APIs financieras existentes, pero esquema/IDs/error handling problemáticos | Integración incompleta; no demostrada operativamente. |
| SQL ERP | Modelo, RPC, restricciones, auditoría y suites presentes | Base de implementación sustancial, no prueba de ejecución actual. |

## Migraciones, Seed Y Tests

**Migraciones**
Hay **32 archivos de migración** en la cadena examinada. Los followups no deben considerarse evidencia de convergencia sólo por existir.

Además del bloqueo concreto H06, varios usan `pg_get_functiondef` y sustituciones de texto sin comprobar que el fragmento esperado haya sido encontrado. Ejemplos: `202608260008:6-20`, `202608260018:10-16` y `202608260020:10-16`. Una definición histórica diferente puede producir un parche sin efecto y aun así registrar la migración.

Para reconciliar drift hay que comparar el catálogo final, incluyendo cuerpos, firmas, ACL, políticas y triggers, no únicamente el listado de versiones.

**Seed**
- Crea organización, sucursal, roles y permisos, pero **no usuarios Auth**, coherente con `supabase/README.md:63`.
- Contiene ocho ubicaciones al incluir cuarentena, no siete.
- Contiene cuatro medios de pago al incluir canje; no corresponde recuperar esos candidatos antiguos como fallos actuales.
- El punto fiscal es `local_stub` y la automatización de comunicaciones queda desactivada.
- No debe reutilizarse indiscriminadamente como inicialización productiva: reactiva permisos/roles seed, restablece parámetros y fuerza el punto fiscal al entorno local.

**Tests**
Encontré **10 suites SQL con 1.111 aserciones planificadas**. Eso no significa que se hayan ejecutado ni aprobado.

- Inventario, ventas, reparaciones, documentos y canjes contienen casos con roles SQL, privilegios efectivos y escenarios adversariales útiles.
- Foundation, maestros y finanzas dependen mucho de comprobaciones estructurales.
- `supabase/tests/erp_finance_accounting.test.sql:110-117` verifica fragmentos de cuerpos SQL; eso no demuestra cierre, reversión o conciliación correctos en ejecución.
- No encontré cobertura del escenario H01 ni de ACL efectivas de `ensure_open_period`.
- La suite financiera está en `supabase/tests/`, mientras las demás están en `supabase/tests/database/`; la próxima ejecución debe acreditar explícitamente qué archivos descubre.
- `App.test.tsx:19-25` sustituye el contexto Auth. Sus comprobaciones de navegación no validan `ErpAuthProvider`.
- `supabaseConfig.test.ts` prueba el resolver, no que el constructor del cliente respete sus rechazos.
- Los tests financieros sustituyen las APIs y no acreditan el envío real con los selectores actuales.

Los PASS históricos de la documentación no se trasladan automáticamente al worktree auditado.

## Readiness Local → Remoto

| Puerta | Estado actual | Evidencia requerida para aprobar |
|---|---|---|
| Demo visual aislada | No aislada del todo | Modo explícito sin conexiones reales y sin afirmaciones fiscales/operativas. |
| Cliente local seguro | Bloqueado | Configuración obligatoria, destino explícito y ausencia de fallback remoto. |
| Instalación limpia | Bloqueo estático H06 | Replay completo en instancia desechable, sin alterar la base de trabajo. |
| Convergencia histórica | No acreditada | Comparación de catálogo y ACL entre replay limpio e instalación histórica. |
| Ingreso de operador | Incompleto | Navegador nuevo, login real, bootstrap/contexto y permisos efectivos. |
| RLS/tenant/branch | Controles presentes, defectos pendientes | Pruebas directas de H01/H02/H13 y matriz de roles sin bypass UI. |
| Operación local | No lista | Venta, caja, stock, cobros y auditoría persistidos y conciliados. |
| Auditoría/observabilidad | Pantallas simuladas | Eventos reales, errores visibles y estados desconocidos ante falta de medición. |
| Integraciones sandbox | No acreditadas | Firma real del adaptador, duplicados, reordenamiento, timeout, reintento y DLQ. |
| Build y tests actuales | No ejecutados | Evidencia vinculada al contenido exacto que se entregará. |
| Artefacto desplegable ERP | Parcial | Build/output explícitos del ERP y configuración propia del destino. |
| Backup/restauración | No acreditados | Ensayo de restauración, RPO/RTO y plan de rollback/corte. |
| Remoto | No autorizado ni listo | Resolver bloqueantes, identificar proyecto, reconciliar esquema/datos, respaldar y obtener autorización expresa. |

## Límites Y Conclusión

Sin runtime no puedo afirmar el estado real de las ACL, qué versión recibió la base existente, si un proveedor está conectado, si las suites pasan ni si una operación concreta produjo datos íntegros. Tampoco certifico que toda la superficie SQL esté libre de otros fallos: la presencia de controles y tests no sustituye su ejercicio adversarial.

**La prioridad no es terminar la apariencia del dashboard.** Es cerrar la separación entre demo y operación real, corregir autorización y configuración, recuperar una instalación reproducible y conectar las pantallas a los contratos transaccionales correctos.

Hasta entonces, presentar este estado como **“ERP operativo completo, fiscalmente autorizado y auditado”** no está sustentado por el código revisado.
