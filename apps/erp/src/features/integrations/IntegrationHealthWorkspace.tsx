import { useState } from "react";
import {
  Activity,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
  Globe,
  Radio,
  Server,
  Layers,
  ArrowUpRight,
  RotateCcw,
} from "lucide-react";
import { WorkspaceHeader, StatusPill } from "../../components/erp/WorkspaceUi";

export interface IntegrationService {
  name: string;
  category: "database" | "payment" | "fiscal" | "messaging" | "forex";
  endpoint: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  uptimePercent: number;
  lastCheck: string;
}

export interface OutboxEvent {
  id: string;
  destination: string;
  eventType: string;
  payloadSummary: string;
  attempts: number;
  maxAttempts: number;
  status: "delivered" | "retrying" | "dead_letter";
  lastError?: string;
  createdAt: string;
}

const SERVICES: IntegrationService[] = [
  { name: "PostgreSQL & Supabase Realtime", category: "database", endpoint: "postgresql://127.0.0.1:54322/postgres", status: "healthy", latencyMs: 4, uptimePercent: 99.98, lastCheck: "Hace 10 seg" },
  { name: "Mercado Pago Webhooks & Preferences", category: "payment", endpoint: "https://api.mercadopago.com/checkout", status: "healthy", latencyMs: 142, uptimePercent: 99.95, lastCheck: "Hace 1 min" },
  { name: "Cotización Dólar API (Ámbito/DólarHoy)", category: "forex", endpoint: "https://dolarapi.com/v1/dolares/blue", status: "healthy", latencyMs: 85, uptimePercent: 99.90, lastCheck: "Hace 5 min" },
  { name: "ARCA Web Service (Factura Electrónica)", category: "fiscal", endpoint: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx", status: "healthy", latencyMs: 210, uptimePercent: 99.80, lastCheck: "Hace 2 min" },
  { name: "Meta WhatsApp Cloud API Gateway", category: "messaging", endpoint: "https://graph.facebook.com/v19.0/messages", status: "healthy", latencyMs: 165, uptimePercent: 99.99, lastCheck: "Hace 30 seg" },
  { name: "Supabase Edge Functions Runtime", category: "database", endpoint: "https://functions.supabase.co/v1/health", status: "healthy", latencyMs: 38, uptimePercent: 99.96, lastCheck: "Hace 12 seg" },
];

const DEMO_OUTBOX: OutboxEvent[] = [
  { id: "evt-901", destination: "MercadoPago Webhook", eventType: "payment.approved", payloadSummary: "Order WEB-2026-0819 ($1.927.000)", attempts: 1, maxAttempts: 5, status: "delivered", createdAt: "11:15:22" },
  { id: "evt-902", destination: "WhatsApp Cloud API", eventType: "repair.ready_notification", payloadSummary: "Ticket NT-8492-X to +5491148291029", attempts: 1, maxAttempts: 5, status: "delivered", createdAt: "11:35:10" },
  { id: "evt-903", destination: "ARCA Web Service", eventType: "fiscal.invoice_authorize", payloadSummary: "FACT-B-0001-00000841", attempts: 1, maxAttempts: 5, status: "delivered", createdAt: "11:15:30" },
  { id: "evt-904", destination: "Stock Sync Storefront", eventType: "stock.decrement", payloadSummary: "SKU-IPHONE-15PRO (-1 en mostrador)", attempts: 1, maxAttempts: 5, status: "delivered", createdAt: "11:16:01" },
];

export const IntegrationHealthWorkspace = () => {
  const [events, setEvents] = useState<OutboxEvent[]>(DEMO_OUTBOX);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const handleManualRetry = (id: string) => {
    setEvents(events.map((e) => (e.id === id ? { ...e, status: "delivered", attempts: e.attempts + 1 } : e)));
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 600);
  };

  return (
    <div className="flow-dashboard">
      <div style={{
        marginBottom: "16px",
        padding: "12px 16px",
        background: "#eff6ff",
        border: "1px solid #bfdbfe",
        borderRadius: "8px",
        color: "#1e40af",
        fontSize: "13px"
      }}>
        <strong>[Módulo DEMO / Simulador de Integraciones]:</strong> Este panel monitorea el estado proyectado del Outbox transaccional y la conectividad de pasarelas. Los registros de cola son simulados localmente y no envían tráfico real a proveedores externos.
      </div>
      <WorkspaceHeader
        title="Salud de Integraciones & Conectividad del Ecosistema"
        description="Monitoreo transaccional del Outbox, verificación de firmas de Webhooks, reintentos idempotentes y cola de fallos (DLQ)."
        badge="Simulador Outbox"
        actions={
          <button
            type="button"
            className="pag-btn"
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            onClick={handleRefresh}
          >
            <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
            Reverificar Conexiones
          </button>
        }
      />

      {/* Services Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginBottom: "20px" }}>
        {SERVICES.map((srv, idx) => (
          <div key={idx} className="flow-card" style={{ margin: 0, padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Server size={18} color="#0284c7" />
                <strong style={{ fontSize: "13px", color: "#0f172a" }}>{srv.name}</strong>
              </div>
              <span className="flow-status-pill completed" style={{ fontSize: "10px", padding: "2px 6px" }}>
                ✓ Online
              </span>
            </div>

            <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#64748b", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {srv.endpoint}
            </p>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #f1f5f9", paddingTop: "8px", fontSize: "11px", color: "#475569" }}>
              <span>Latencia: <strong>{srv.latencyMs}ms</strong></span>
              <span>Uptime: <strong>{srv.uptimePercent}%</strong></span>
              <span>{srv.lastCheck}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Outbox & Dead Letter Queue */}
      <div className="flow-card">
        <div className="flow-card__header">
          <div>
            <h2 className="flow-card__title">Bandeja Outbox de Eventos Transaccionales</h2>
            <p className="flow-card__subtitle">Registro de eventos sincronizados y entrega con garantía Exactly-Once / Idempotente</p>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <span className="type-badge green">Cola Limpia (0 en DLQ)</span>
          </div>
        </div>

        <div className="flow-table-wrapper">
          <table className="flow-table">
            <thead>
              <tr>
                <th>ID Evento</th>
                <th>Destino / Servicio</th>
                <th>Tipo de Evento</th>
                <th>Payload Resumen</th>
                <th>Reintentos</th>
                <th>Estado Entrega</th>
                <th>Hora</th>
                <th className="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt) => (
                <tr key={evt.id}>
                  <td>
                    <span className="type-badge purple" style={{ fontFamily: "monospace" }}>
                      {evt.id}
                    </span>
                  </td>
                  <td>
                    <strong>{evt.destination}</strong>
                  </td>
                  <td>
                    <span style={{ fontSize: "12px", fontFamily: "monospace", color: "#0f172a" }}>
                      {evt.eventType}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: "12px", color: "#475569" }}>
                      {evt.payloadSummary}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: "12px", color: "#334155" }}>
                      {evt.attempts} / {evt.maxAttempts}
                    </span>
                  </td>
                  <td>
                    {evt.status === "delivered" && (
                      <span className="flow-status-pill completed">Entregado</span>
                    )}
                    {evt.status === "retrying" && (
                      <span className="flow-status-pill processing">Reintentando</span>
                    )}
                    {evt.status === "dead_letter" && (
                      <span className="flow-status-pill cancelled">Fallo DLQ</span>
                    )}
                  </td>
                  <td>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>{evt.createdAt}</span>
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="pag-btn"
                      style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                      onClick={() => handleManualRetry(evt.id)}
                    >
                      <RotateCcw size={12} /> Reintentar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
