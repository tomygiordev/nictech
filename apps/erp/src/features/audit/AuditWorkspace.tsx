import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, Shield, User, Key, Terminal } from "lucide-react";
import { WorkspaceHeader, StatePanel } from "../../components/erp/WorkspaceUi";
import { OfficialCsvExportButton } from "../../components/erp/OfficialCsvExportButton";
import { formatDateTime } from "../../lib/formatters";
import { AUDIT_ACTION_LABELS, auditTableLabel, labelOf } from "../../lib/labels";
import { toUserMessage } from "../../lib/errors";
import { supabase } from "../../lib/supabase";
import { useErpAuth } from "../../auth/ErpAuthContext";
import {
  exportAuditEvents,
  extractIp,
  listAuditEvents,
  type AuditEventRow,
} from "./api";

interface AuditLogEntry {
  id: string;
  correlationId: string | null;
  timestamp: string;
  actorName: string;
  actorRole: string | null;
  rawAction: string;
  action: string;
  schema: string;
  rawTable: string;
  entity: string;
  entityId: string;
  ipAddress: string | null;
  status: "success" | "warning";
  hasReason: boolean;
  details: string;
}

interface AuditLogGroup {
  key: string;
  correlationId: string | null;
  entries: AuditLogEntry[];
}

const metaString = (metadata: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
};

const resolveActorName = (row: AuditEventRow, profileNames: ReadonlyMap<string, string>): string => {
  if (row.actor_user_id) {
    const profileName = profileNames.get(row.actor_user_id);
    if (profileName) return profileName;
  }
  const fromMeta = metaString(row.metadata, ["actor_name", "actor", "user_email", "created_by"]);
  return fromMeta ?? "Usuario del sistema";
};

const resolveActorRole = (row: AuditEventRow): string | null =>
  metaString(row.metadata, ["role", "actor_role"]);

const fetchProfileNames = async (rows: readonly AuditEventRow[]): Promise<Map<string, string>> => {
  const names = new Map<string, string>();
  const actorIds = Array.from(
    new Set(
      rows
        .map((row) => row.actor_user_id)
        .filter((id): id is string => typeof id === "string" && id.trim() !== ""),
    ),
  );
  if (actorIds.length === 0 || !supabase) return names;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", actorIds);
    if (error || !Array.isArray(data)) return names;
    for (const profile of data) {
      if (profile && typeof profile.id === "string" && typeof profile.display_name === "string") {
        const displayName = profile.display_name.trim();
        if (displayName) names.set(profile.id, displayName);
      }
    }
  } catch {
    // Si profiles no es accesible por permisos, cae al nombre por defecto.
  }

  return names;
};

const toEntry = (row: AuditEventRow, profileNames: ReadonlyMap<string, string>): AuditLogEntry => {
  const rawAction = row.action.trim().toLowerCase();
  const action = labelOf(AUDIT_ACTION_LABELS, rawAction, "Operación");
  const rawTable = row.table_name?.trim() || "";
  const entity = auditTableLabel(row.table_name);
  const correlationId =
    typeof row.correlation_id === "string" && row.correlation_id.trim() !== ""
      ? row.correlation_id.trim()
      : null;
  const reason = typeof row.reason === "string" ? row.reason.trim() : "";

  return {
    id: row.id.toString(),
    correlationId,
    timestamp: formatDateTime(row.occurred_at),
    actorName: resolveActorName(row, profileNames),
    actorRole: resolveActorRole(row),
    rawAction,
    action,
    schema: row.schema_name,
    rawTable,
    entity,
    entityId: row.record_id || (correlationId ? correlationId.slice(0, 8) : "") || "—",
    ipAddress: extractIp(row),
    status: rawAction === "delete" || rawAction === "reject" ? "warning" : "success",
    hasReason: reason !== "",
    details: reason || `${action} de ${entity}`,
  };
};

const PAGE_SIZE = 100;

export const AuditWorkspace = () => {
  const { hasPermission } = useErpAuth();
  const [rows, setRows] = useState<AuditEventRow[]>([]);
  const [profileNames, setProfileNames] = useState<Map<string, string>>(() => new Map());
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actorColumnAvailable, setActorColumnAvailable] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [schemaFilter, setSchemaFilter] = useState<string>("all");
  const [tableFilter, setTableFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await listAuditEvents(PAGE_SIZE);
        const names = await fetchProfileNames(result.rows);
        if (cancelled) return;
        setRows(result.rows);
        setProfileNames(names);
        setActorColumnAvailable(result.actorColumnAvailable);
      } catch (e) {
        if (cancelled) return;
        setRows([]);
        setProfileNames(new Map());
        setError(toUserMessage(e, "No se pudo cargar el registro de auditoría."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const logs = useMemo(() => rows.map((row) => toEntry(row, profileNames)), [rows, profileNames]);
  const schemas = useMemo(() => Array.from(new Set(logs.map((l) => l.schema))).sort(), [logs]);
  const tables = useMemo(() => {
    const map = new Map<string, string>();
    for (const log of logs) {
      if (log.rawTable && !map.has(log.rawTable)) map.set(log.rawTable, log.entity);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "es-AR"));
  }, [logs]);
  const actions = useMemo(() => {
    const map = new Map<string, string>();
    for (const log of logs) {
      if (log.rawAction && !map.has(log.rawAction)) map.set(log.rawAction, log.action);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "es-AR"));
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = search.toLowerCase();
    return logs.filter((log) => {
      if (activeFilter !== "all" && log.status !== activeFilter) return false;
      if (schemaFilter !== "all" && log.schema !== schemaFilter) return false;
      if (tableFilter !== "all" && log.rawTable !== tableFilter) return false;
      if (actionFilter !== "all" && log.rawAction !== actionFilter) return false;
      if (q === "") return true;
      return (
        log.actorName.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.entity.toLowerCase().includes(q) ||
        log.entityId.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q) ||
        (log.ipAddress ?? "").includes(q)
      );
    });
  }, [logs, search, activeFilter, schemaFilter, tableFilter, actionFilter]);

  const groupedLogs = useMemo<AuditLogGroup[]>(() => {
    const groups: AuditLogGroup[] = [];
    const byCorrelation = new Map<string, AuditLogGroup>();

    for (const entry of filteredLogs) {
      if (!entry.correlationId) {
        groups.push({
          key: `single-${entry.id}`,
          correlationId: null,
          entries: [entry],
        });
        continue;
      }
      const existing = byCorrelation.get(entry.correlationId);
      if (existing) {
        existing.entries.push(entry);
      } else {
        const group: AuditLogGroup = {
          key: `corr-${entry.correlationId}`,
          correlationId: entry.correlationId,
          entries: [entry],
        };
        byCorrelation.set(entry.correlationId, group);
        groups.push(group);
      }
    }

    return groups;
  }, [filteredLogs]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Libro de Auditoría & Trazabilidad Inmutable"
        description="Registro cronológico de operaciones, cambios de stock, accesos y movimientos contables."
      />

      {!actorColumnAvailable && !loading && (
        <StatePanel
          type="info"
          title="Actor limitado por permisos"
          message="Este perfil no puede ver quién realizó algunos eventos; cuando no hay datos disponibles, el operador figura como Usuario del sistema."
        />
      )}

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="flow-kpi-card">
          <div className="flow-kpi-card__icon-box green">
            <Shield size={22} />
          </div>
          <div className="flow-kpi-card__content">
            <span className="flow-kpi-card__label">Eventos Registrados</span>
            <div className="flow-kpi-card__val-row">
              <span className="flow-kpi-card__val">{logs.length}</span>
              <span className="flow-trend-tag positive">Persistidos</span>
            </div>
            <span className="flow-kpi-card__sub">Últimos 100 registros disponibles</span>
          </div>
        </div>

        <div className="flow-kpi-card">
          <div className="flow-kpi-card__icon-box navy">
            <User size={22} />
          </div>
          <div className="flow-kpi-card__content">
            <span className="flow-kpi-card__label">Operadores Auditados</span>
            <div className="flow-kpi-card__val-row">
              <span className="flow-kpi-card__val">{new Set(logs.map((l) => l.actorName)).size}</span>
              <span className="flow-trend-tag positive">Auditados</span>
            </div>
            <span className="flow-kpi-card__sub">Operadores distintos en la ventana</span>
          </div>
        </div>

        <div className="flow-kpi-card">
          <div className="flow-kpi-card__icon-box steel">
            <Key size={22} />
          </div>
          <div className="flow-kpi-card__content">
            <span className="flow-kpi-card__label">Permisos del Sistema</span>
            <div className="flow-kpi-card__val-row">
              <span className="flow-kpi-card__val">RBAC</span>
              <span className="flow-trend-tag positive">Activo</span>
            </div>
            <span className="flow-kpi-card__sub">Solo visible para responsables</span>
          </div>
        </div>

        <div className="flow-kpi-card">
          <div className="flow-kpi-card__icon-box dark">
            <Terminal size={22} />
          </div>
          <div className="flow-kpi-card__content">
            <span className="flow-kpi-card__label">Alertas de Auditoría</span>
            <div className="flow-kpi-card__val-row">
              <span className="flow-kpi-card__val">{logs.filter((l) => l.status === "warning").length}</span>
              <span className="flow-trend-tag positive">Eventos</span>
            </div>
            <span className="flow-kpi-card__sub">Advertencias detectadas</span>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Eventos de Auditoría Recientes</h2>
            <p className="flow-card__subtitle">Trazabilidad completa con operador e IP solo cuando el evento la trae</p>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <div className="flow-search-pill" style={{ width: "260px" }}>
              <Search size={15} />
              <input
                type="text"
                placeholder="Buscar evento o usuario..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {hasPermission("reports.export") && (
              <OfficialCsvExportButton
                filename="auditoria-erp.csv"
                label="Exportar CSV oficial"
                loadDataset={async (reason) => {
                  const exported = await exportAuditEvents({
                    reason,
                    search: search || undefined,
                    schema: schemaFilter === "all" ? undefined : schemaFilter,
                    table: tableFilter === "all" ? undefined : tableFilter,
                    action: actionFilter === "all" ? undefined : actionFilter,
                    status:
                      activeFilter === "success" || activeFilter === "warning"
                        ? activeFilter
                        : undefined,
                    rowLimit: 5000,
                  });
                  const exportNames = await fetchProfileNames(exported.rows);
                  const exportLogs = exported.rows.map((row) => toEntry(row, exportNames));
                  return {
                    headers: ["timestamp", "operador", "rol", "accion", "schema", "tabla", "entidad_id", "ip", "detalle"],
                    rows: exportLogs.map((log) => [
                      log.timestamp,
                      log.actorName,
                      log.actorRole ?? "—",
                      log.action,
                      log.schema,
                      log.entity,
                      log.entityId,
                      log.ipAddress ?? "—",
                      log.details,
                    ]),
                    truncated: exported.truncated,
                  };
                }}
              />
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
          {[
            { id: "all", label: "Todos los Registros" },
            { id: "success", label: "Operaciones Exitosas" },
            { id: "warning", label: "Advertencias" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`flow-select-pill ${activeFilter === tab.id ? "active" : ""}`}
              onClick={() => setActiveFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
          <label className="erp-form-group">
            <span className="erp-form-label">Esquema</span>
            <select className="erp-form-input" value={schemaFilter} onChange={(e) => setSchemaFilter(e.target.value)}>
              <option value="all">Todos</option>
              {schemas.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="erp-form-group">
            <span className="erp-form-label">Entidad</span>
            <select className="erp-form-input" value={tableFilter} onChange={(e) => setTableFilter(e.target.value)}>
              <option value="all">Todas</option>
              {tables.map(([rawTable, label]) => (
                <option key={rawTable} value={rawTable}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="erp-form-group">
            <span className="erp-form-label">Acción</span>
            <select className="erp-form-input" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="all">Todas</option>
              {actions.map(([rawAction, label]) => (
                <option key={rawAction} value={rawAction}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <StatePanel type="loading" message="Cargando eventos recientes…" />
        ) : error ? (
          <StatePanel type="error" title="No se pudo leer la auditoría" message={error} />
        ) : filteredLogs.length === 0 ? (
          <StatePanel
            type="empty"
            title="Sin eventos"
            message="No se encontraron eventos para los filtros aplicados."
          />
        ) : (
          <div className="flow-table-wrapper">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th>Operador</th>
                  <th>Acción realizada</th>
                  <th>Entidad</th>
                  <th>IP origen</th>
                  <th>Detalle del evento</th>
                </tr>
              </thead>
              <tbody>
                {groupedLogs.map((group) => {
                  if (group.entries.length === 1) {
                    const log = group.entries[0];
                    return (
                      <tr key={group.key}>
                        <td className="nowrap" style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                          {log.timestamp}
                        </td>
                        <td>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <strong>{log.actorName}</strong>
                            {log.actorRole && (
                              <span style={{ fontSize: "11px", color: "var(--text-light)" }}>{log.actorRole}</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`type-badge ${log.status === "warning" ? "orange" : "green"}`}
                            style={{ fontSize: "11px" }}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--brand-primary)" }}>
                            {log.entity} #{log.entityId}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "monospace" }}>
                            {log.ipAddress ?? "—"}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: "12px", color: "var(--text-main)" }}>{log.details}</span>
                        </td>
                      </tr>
                    );
                  }

                  const lead = group.entries[0];
                  const isExpanded = Boolean(expandedGroups[group.key]);
                  const hasWarning = group.entries.some((item) => item.status === "warning");
                  const uniqueActions = Array.from(new Set(group.entries.map((item) => item.action)));
                  const uniqueEntities = Array.from(new Set(group.entries.map((item) => item.entity)));
                  const groupSummary =
                    group.entries.find((item) => item.hasReason)?.details ??
                    `${uniqueActions.length === 1 ? uniqueActions[0] : "Operación"} con ${group.entries.length} cambios`;

                  return (
                    <Fragment key={group.key}>
                      <tr>
                        <td className="nowrap" style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                          {lead.timestamp}
                        </td>
                        <td>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <strong>{lead.actorName}</strong>
                            {lead.actorRole && (
                              <span style={{ fontSize: "11px", color: "var(--text-light)" }}>{lead.actorRole}</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                            <span
                              className={`type-badge ${hasWarning ? "orange" : "green"}`}
                              style={{ fontSize: "11px" }}
                            >
                              {uniqueActions.length === 1 ? uniqueActions[0] : "Operación"}
                            </span>
                            <span className="type-badge blue" style={{ fontSize: "11px" }}>
                              {group.entries.length} cambios
                            </span>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--brand-primary)" }}>
                            {uniqueEntities.length === 1
                              ? uniqueEntities[0]
                              : `${uniqueEntities[0]} (+${uniqueEntities.length - 1})`}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "monospace" }}>
                            {lead.ipAddress ?? "—"}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                            <span style={{ fontSize: "12px", color: "var(--text-main)" }}>{groupSummary}</span>
                            <button
                              type="button"
                              className="pag-btn"
                              aria-expanded={isExpanded}
                              onClick={() => toggleGroup(group.key)}
                              style={{ display: "inline-flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              {isExpanded ? "Ocultar cambios" : `Ver ${group.entries.length} cambios`}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded &&
                        group.entries.map((entry) => (
                          <tr key={entry.id} style={{ background: "var(--surface-subtle)" }}>
                            <td style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "monospace", paddingLeft: "24px" }}>
                              {entry.timestamp}
                            </td>
                            <td>
                              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{entry.actorName}</span>
                            </td>
                            <td>
                              <span
                                className={`type-badge ${entry.status === "warning" ? "orange" : "green"}`}
                                style={{ fontSize: "10px" }}
                              >
                                {entry.action}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)" }}>
                                {entry.entity} #{entry.entityId}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "monospace" }}>
                                {entry.ipAddress ?? "—"}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{entry.details}</span>
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
