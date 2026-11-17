-- Migration: 202609070011_erp_ops_visibility_grants.sql
-- Description: Visibilidad operativa de DLQ de integraciones y actor de auditoria.
-- (a) erp.integration_dead_letters tenia policy SELECT (integrations.view, migracion
-- 202608190009) pero GRANT SELECT solo a service_role: authenticated veia cero filas
-- aunque la policy lo autorizara. Se otorga SELECT a authenticated; la policy sigue
-- siendo el filtro por organizacion/permiso.
-- (b) erp.audit_events: verificado en DB local que authenticated ya tiene SELECT de
-- tabla y de columna actor_user_id, y que la policy audit_events_select_allowed
-- (audit.view) expone la fila completa incluido actor_user_id. No se recrea la
-- policy; se deja un GRANT de columnas explicito e idempotente como documentacion
-- viva de que actor_user_id debe permanecer legible.

set search_path = erp, pg_catalog;

-- (a) DLQ legible para operadores con integrations.view.
grant select on erp.integration_dead_letters to authenticated;

-- (b) Actor de auditoria explicitamente legible (ya lo era; sin cambios de policy).
grant select (
  id, organization_id, branch_id, actor_user_id, occurred_at,
  schema_name, table_name, record_id, action, reason,
  correlation_id, request_id, old_values, new_values, metadata
) on erp.audit_events to authenticated;
