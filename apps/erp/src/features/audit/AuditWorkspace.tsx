import { useEffect, useMemo, useState } from "react";
import { Search, Shield, User, Key, Terminal, Download } from "lucide-react";
import { WorkspaceHeader, StatePanel } from "../../components/erp/WorkspaceUi";
import { formatDateTime } from "../../lib/formatters";
import {
  extractActorDetail,
  extractActorLabel,
  extractIp,
  listAuditEvents,
  type AuditEventRow,
} from "./api";

interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: string;
  action: string;
  schema: string;
  entity: string;
  entityId: string;
  ipAddress: string | null;
  status: "success" | "warning";
  details: string;
}

const toEntry = (row: AuditEventRow): AuditLogEntry => ({
  id: row.id.toString(),
  timestamp: formatDateTime(row.occurred_at),
  actorName: extractActorLabel(row),
  actorRole: extractActorDetail(row),
  action: row.action.toUpperCase(),
  schema: row.schema_name,
  entity: row.table_name || "Tabla",
  entityId: row.record_id || row.correlation_id.slice(0, 8) || "—",
  ipAddress: extractIp(row),
  status: row.action === "delete" || row.action === "reject" ? "warning" : "success",
  details: row.reason || `Operación ${row.action} sobre ${row.table_name || "entidad"}`,
});

const csvEscape = (value: string): string => {
  if (/[",;\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
};

const buildCsv = (logs: AuditLogEntry[]): string => {
  const header = "timestamp,operador,rol,accion,schema,tabla,entidad_id,ip,detalle";
  const lines = logs.map((l) =>
    [
      l.timestamp,
      l.actorName,
      l.actorRole,
      l.action,
      l.schema,
      l.entity,
      l.entityId,
      l.ipAddress ?? "—",
      l.details,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...lines].join("\n");
};

const PAGE_SIZE = 100;

export const AuditWorkspace = () => {
  const [rows, setRows] = useState<AuditEventRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actorColumnAvailable, setActorColumnAvailable] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [schemaFilter, setSchemaFilter] = useState<string>("all");
  const [tableFilter, setTableFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await listAuditEvents(PAGE_SIZE);
        if (cancelled) return;
        setRows(result.rows);
        setActorColumnAvailable(result.actorColumnAvailable);
      } catch (e) {
        if (cancelled) return;
        setRows([]);
        setError(e instanceof Error ? e.message : "No se pudo leer erp.audit_events.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const logs = useMemo(() => rows.map(toEntry), [rows]);
  const schemas = useMemo(() => Array.from(new Set(logs.map((l) => l.schema))).sort(), [logs]);
  const tables = useMemo(() => Array.from(new Set(logs.map((l) => l.entity))).sort(), [logs]);
  const actions = useMemo(() => Array.from(new Set(logs.map((l) => l.action))).sort(), [logs]);

  const filteredLogs = useMemo(() => {
    const q = search.toLowerCase();
    return logs.filter((log) => {
      if (activeFilter !== "all" && log.status !== activeFilter) return false;
      if (schemaFilter !== "all" && log.schema !== schemaFilter) return false;
      if (tableFilter !== "all" && log.entity !== tableFilter) return false;
      if (actionFilter !== "all" && log.action !== actionFilter) return false;
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

  const handleExportCsv = () => {
    const csv = buildCsv(filteredLogs);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "auditoria-erp.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Libro de Auditoría & Trazabilidad Inmutable"
        description="Registro cronológico de cada operación, cambio de stock, autenticación y modificación contable (erp.audit_events)."
        badge="Auditoría ERP"
      />

      {!actorColumnAvailable && !loading && (
        <StatePanel
          type="info"
          title="Actor limitado por permisos"
          message="Nota: la columna actor_user_id no está visible para este rol (RLS/grant sobre erp.audit_events); el operador se deriva de metadata cuando existe, si no se muestra Sistema."
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
            <span className="flow-kpi-card__sub">Tabla central erp.audit_events (últimos 100)</span>
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
            <span className="flow-kpi-card__sub">Lectura sujeta a permiso audit.view</span>
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

            <button
              type="button"
              className="pag-btn"
              style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
              onClick={handleExportCsv}
              disabled={filteredLogs.length === 0}
            >
              <Download size={14} /> Exportar CSV ({filteredLogs.length})
            </button>
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
          <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Schema{" "}
            <select value={schemaFilter} onChange={(e) => setSchemaFilter(e.target.value)}>
              <option value="all">Todos</option>
              {schemas.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Tabla{" "}
            <select value={tableFilter} onChange={(e) => setTableFilter(e.target.value)}>
              <option value="all">Todas</option>
              {tables.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Acción{" "}
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="all">Todas</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <StatePanel type="loading" message="Cargando eventos de auditoría desde erp.audit_events..." />
        ) : error ? (
          <StatePanel type="error" title="No se pudo leer la auditoría" message={error} />
        ) : filteredLogs.length === 0 ? (
          <StatePanel
            type="empty"
            title="Sin eventos"
            message="No se encontraron eventos de auditoría registrados en erp.audit_events para los filtros aplicados."
          />
        ) : (
          <div className="flow-table-wrapper">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Operador</th>
                  <th>Acción Realizada</th>
                  <th>Entidad</th>
                  <th>IP Origen</th>
                  <th>Detalle del Evento</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontSize: "12px", color: "var(--text-muted)", fontFamily: "monospace" }}>
                      {log.timestamp}
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <strong>{log.actorName}</strong>
                        <span style={{ fontSize: "11px", color: "var(--text-light)" }}>{log.actorRole}</span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`type-badge ${log.status === "warning" ? "orange" : "green"}`}
                        style={{ fontSize: "10px", fontFamily: "monospace" }}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
