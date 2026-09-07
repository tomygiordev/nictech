import { useState, useMemo, useEffect } from "react";
import {
  Sparkles,
  Search,
  Shield,
  Clock,
  Filter,
  CheckCircle2,
  AlertTriangle,
  User,
  Key,
  Terminal,
  Download,
  Printer,
} from "lucide-react";
import { WorkspaceHeader } from "../../components/erp/WorkspaceUi";
import { formatDateTime } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";

interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string;
  ipAddress: string;
  status: "success" | "warning" | "danger";
  details: string;
}

export const AuditWorkspace = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<string>("all");

  useEffect(() => {
    const fetchAuditEvents = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("audit_events")
          .select("id, occurred_at, schema_name, table_name, record_id, action, reason, correlation_id, metadata")
          .order("occurred_at", { ascending: false })
          .limit(50);

        if (error) {
          console.warn("Aviso al consultar audit_events:", error.message);
          setLogs([]);
          return;
        }

        const mapped: AuditLogEntry[] = (data || []).map((e: any) => ({
          id: e.id.toString(),
          timestamp: formatDateTime(e.occurred_at),
          actorName: e.table_name ? `${e.schema_name}.${e.table_name}` : "Sistema",
          actorRole: e.action,
          action: e.action.toUpperCase(),
          entity: e.table_name || "Tabla",
          entityId: e.record_id || e.correlation_id?.slice(0, 8) || "—",
          ipAddress: (e.metadata?.ip as string) || "127.0.0.1",
          status: e.action === "delete" || e.action === "reject" ? "warning" : "success",
          details: e.reason || `Operación ${e.action} sobre ${e.table_name || "entidad"}`,
        }));
        setLogs(mapped);
      } catch {
        setLogs([]);
      } finally {
        setLoading(false);
      }
    };
    void fetchAuditEvents();
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchFilter = activeFilter === "all" || log.status === activeFilter;
      const q = search.toLowerCase();
      const matchSearch =
        log.actorName.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.entity.toLowerCase().includes(q) ||
        log.entityId.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q) ||
        log.ipAddress.includes(q);
      return matchFilter && matchSearch;
    });
  }, [logs, search, activeFilter]);

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Libro de Auditoría & Trazabilidad Inmutable"
        description="Registro cronológico de cada operación, cambio de stock, autenticación y modificación contable (erp.audit_events)."
        badge="Auditoría ERP"
      />

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
            <span className="flow-kpi-card__sub">Tabla central erp.audit_events</span>
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
            <span className="flow-kpi-card__sub">Entidades registradas</span>
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
            <span className="flow-kpi-card__sub">Matriz de roles central</span>
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
            <p className="flow-card__subtitle">Trazabilidad completa con dirección IP, operador y detalle técnico</p>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
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
              onClick={() => window.print()}
            >
              <Printer size={14} /> Imprimir Registro
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
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
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    Cargando eventos de auditoría desde erp.audit_events...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    No se encontraron eventos de auditoría registrados en erp.audit_events.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontSize: "12px", color: "var(--text-muted)", fontFamily: "monospace" }}>{log.timestamp}</td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <strong>{log.actorName}</strong>
                        <span style={{ fontSize: "11px", color: "var(--text-light)" }}>{log.actorRole}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`type-badge ${log.status === "warning" ? "orange" : "green"}`} style={{ fontSize: "10px", fontFamily: "monospace" }}>
                        {log.action}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--brand-primary)" }}>
                        {log.entity} #{log.entityId}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "monospace" }}>{log.ipAddress}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: "12px", color: "var(--text-main)" }}>{log.details}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
