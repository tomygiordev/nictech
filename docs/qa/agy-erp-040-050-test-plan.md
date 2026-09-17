Objetivo: agregar cobertura pgTAP dedicada para las migraciones ERP 20260916004000_erp_integration_recovery.sql y 20260916005000_erp_report_exports.sql. No modificar migraciones de producción, frontend, seeds, tipos ni configuración. Crear solamente:
- supabase/tests/database/erp_integration_recovery.test.sql
- supabase/tests/database/erp_report_exports.test.sql

Usá los fixtures y estilo de los tests SQL existentes. Cada archivo debe ser autocontenido, empezar con begin; crear la extensión pgtap si hace falta, usar plan(...) y terminar con rollback;. No dejar datos persistentes. Usá UUIDs únicos. Creá usuarios auth, perfiles y profile_roles siguiendo el patrón existente, asociados a la organización/branch seed ERP y al rol owner para el actor autorizado. Configurá request.jwt.claim.sub y request.jwt.claim.role y role authenticated para RPCs del usuario. Para workers usá role service_role y role postgres solamente para preparar fixtures. No uses sleeps: para claim_due insertá como postgres una retry request determinista con available_at <= clock_timestamp().

Cobertura obligatoria para erp_integration_recovery.test.sql:
1. Verificar existencia de tablas/RPCs nuevas y privilegios: request_integration_retry y move_integration_to_dead_letter ejecutables por authenticated; claim_due_integration_retries, record_claimed_integration_attempt y record_integration_attempt ejecutables por service_role y no authenticated.
2. Preparar al menos tres integration_outbox aislados: request/idempotencia, claim/worker y dead-letter. Registrar el intento inicial failed con record_integration_attempt bajo service_role.
3. Bajo authenticated owner probar request_integration_retry retry; repetir misma operation_key y datos devuelve el mismo UUID; reutilizar operation_key con datos distintos falla integrity_constraint_violation. Verificar rechazo de un usuario autenticado sin integrations.retry, sin alterar permisos globales.
4. Bajo authenticated verificar que claim_due_integration_retries y record_claimed_integration_attempt rechazan con insufficient_privilege.
5. Para worker preparar retry request vencida como postgres, reclamar bajo service_role, comprobar claim_token/request/outbox, registrar succeeded y verificar segundo intento con retry_request_id y worker_claim_token. Repetir resultado idéntico devuelve el mismo intento.
6. Para dead-letter registrar failed y, bajo authenticated owner, mover a dead letter; repetir mismo motivo es idempotente y cambiar motivo falla integrity_constraint_violation. Comprobar que un evento con retry pendiente no pueda moverse a dead letter.
7. Cubrir validaciones básicas de claim y de failed sin error / succeeded con error.

Cobertura obligatoria para erp_report_exports.test.sql:
1. Verificar export_report_rows y que authenticated puede ejecutarlo pero anon/public no.
2. Bajo authenticated owner ejecutar export_report_rows audit con razón válida y verificar JSON rows/row_count/truncated, límite, y exactamente un audit_events table_name report_exports/action execute con metadata report_code audit, format csv, row_count y truncated, sin filas completas en metadata.
3. Probar filtros audit permitidos y branch seed; rechazar código desconocido, razón corta, row_limit 0, rango invertido, filtro desconocido, filters no objeto y branch inexistente.
4. Crear usuario autenticado con rol seed sin reports.export y comprobar export organizacional falla insufficient_privilege. Verificar permisos y elegir un rol adecuado.
5. Probar target_branch_id de otra organización o UUID inexistente: falla sin exponer datos.

No hagas afirmaciones sin aserciones pgTAP reales. Si nombres/tipos difieren, inspeccioná migraciones y adaptá el test al contrato real sin tocar producción. Informá archivos creados y supuestos.
