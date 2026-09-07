import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw, Inbox, CheckCircle2, AlertTriangle, ArchiveX } from "lucide-react";
import { WorkspaceHeader, StatePanel, Modal } from "../../components/erp/WorkspaceUi";
import { formatDateTime } from "../../lib/formatters";
import {
  listDeadLetters,
  listIntegrationAttempts,
  listIntegrationOutbox,
  moveIntegrationToDeadLetter,
  type IntegrationAttemptRow,
  type IntegrationOutboxRow,
} from "./api";

type DeliveryStatus = "delivered" | "retrying" | "pending" | "dead_letter";

const deriveStatus = (
  outboxId: string,
  attempts: IntegrationAttemptRow[],
  deadOutboxIds: Set<string>,
): DeliveryStatus => {
  if (deadOutboxIds.has(outboxId)) return "dead_letter";
  const mine = attempts.filter((a) => a.outbox_id === outboxId);
  if (mine.some((a) => a.status === "succeeded")) return "delivered";
  if (mine.some((a) => a.status === "failed")) return "retrying";
  return "pending";
};

const statusLabel: Record<DeliveryStatus, string> = {
  delivered: "Entregado",
  retrying: "Reintentando",
  pending: "Pendiente",
  dead_letter: "Dead letter",
};

const payloadSummary = (row: IntegrationOutboxRow): string => {
  const payload = row.payload ?? {};
  const messageId = typeof payload["message_id"] === "string" ? payload["message_id"] : null;
  const requestId = typeof payload["request_id"] === "string" ? payload["request_id"] : null;
  const ref = messageId ?? requestId;
  return ref ? `${row.aggregate_type} ${ref.slice(0, 8)}` : row.aggregate_type;
};

export const IntegrationHealthWorkspace = () => {
  const [outbox, setOutbox] = useState<IntegrationOutboxRow[]>([]);
  const [attempts, setAttempts] = useState<IntegrationAttemptRow[]>([]);
  const [deadOutboxIds, setDeadOutboxIds] = useState<Set<string>>(new Set());
  const [deadLettersAvailable, setDeadLettersAvailable] = useState<boolean>(true);
  const [deadLettersNote, setDeadLettersNote] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [deadLetterTarget, setDeadLetterTarget] = useState<IntegrationOutboxRow | null>(null);
  const [deadLetterReason, setDeadLetterReason] = useState<string>("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const rows = await listIntegrationOutbox(100);
      const found = await listIntegrationAttempts(rows.map((r) => r.id));
      const dead = await listDeadLetters();
      setOutbox(rows);
      setAttempts(found);
      setDeadOutboxIds(new Set(dead.rows.map((d) => d.outbox_id)));
      setDeadLettersAvailable(dead.available);
      setDeadLettersNote(dead.available ? null : dead.errorMessage);
    } catch (e) {
      setOutbox([]);
      setAttempts([]);
      setError(e instanceof Error ? e.message : "No se pudo leer erp.integration_outbox.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const attemptsByOutbox = useMemo(() => {
    const map = new Map<string, IntegrationAttemptRow[]>();
    for (const a of attempts) {
      const list = map.get(a.outbox_id) ?? [];
      list.push(a);
      map.set(a.outbox_id, list);
    }
    return map;
  }, [attempts]);

  const counters = useMemo(() => {
    let delivered = 0;
    let retrying = 0;
    let pending = 0;
    let dead = 0;
    for (const row of outbox) {
      const status = deriveStatus(row.id, attempts, deadOutboxIds);
      if (status === "delivered") delivered += 1;
      else if (status === "retrying") retrying += 1;
      else if (status === "pending") pending += 1;
      else dead += 1;
    }
    return { total: outbox.length, delivered, retrying, pending, dead };
  }, [outbox, attempts, deadOutboxIds]);

  const failedAttempts = useMemo(() => attempts.filter((a) => a.status === "failed").length, [attempts]);

  const handleConfirmDeadLetter = async () => {
    if (!deadLetterTarget) return;
    try {
      setMovingId(deadLetterTarget.id);
      setActionError(null);
      setActionOk(null);
      await moveIntegrationToDeadLetter(deadLetterTarget.id, deadLetterReason);
      setActionOk(`Evento ${deadLetterTarget.id.slice(0, 8)} movido a dead letter.`);
      setDeadLetterTarget(null);
      setDeadLetterReason("");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "No se pudo mover a dead letter.");
    } finally {
      setMovingId(null);
    }
  };

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Salud de Integraciones & Outbox Transaccional"
        description="Cola real erp.integration_outbox con intentos de erp.integration_attempts y dead letters. Sin métricas inventadas."
        badge="Outbox real"
        actions={
          <button
            type="button"
            className="pag-btn"
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? "Actualizando…" : "Reverificar Conexiones"}
          </button>
        }
      />

      {actionError && <StatePanel type="error" title="Acción rechazada" message={actionError} />}
      {actionOk && <StatePanel type="info" title="Operación registrada" message={actionOk} />}
      {!deadLettersAvailable && !loading && (
        <StatePanel
          type="info"
          title="Dead letters sin acceso de lectura"
          message={`authenticated no tiene GRANT SELECT sobre erp.integration_dead_letters (solo service_role según 202608190009); el contador de muertos puede estar incompleto. Detalle: ${deadLettersNote ?? "permiso denegado"}`}
        />
      )}

      {/* Counters Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "20px" }}>
        <div className="flow-card" style={{ margin: 0, padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
            <Inbox size={18} color="#0284c7" />
            <strong style={{ fontSize: "13px", color: "#0f172a" }}>Pendientes</strong>
          </div>
          <p style={{ margin: 0, fontSize: "24px", fontWeight: 800 }}>{counters.pending}</p>
          <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>Outbox sin intentos registrados</p>
        </div>
        <div className="flow-card" style={{ margin: 0, padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
            <AlertTriangle size={18} color="#d97706" />
            <strong style={{ fontSize: "13px", color: "#0f172a" }}>Reintentando</strong>
          </div>
          <p style={{ margin: 0, fontSize: "24px", fontWeight: 800 }}>{counters.retrying}</p>
          <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>{failedAttempts} intentos fallidos en total</p>
        </div>
        <div className="flow-card" style={{ margin: 0, padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
            <ArchiveX size={18} color="#dc2626" />
            <strong style={{ fontSize: "13px", color: "#0f172a" }}>Dead letters</strong>
          </div>
          <p style={{ margin: 0, fontSize: "24px", fontWeight: 800 }}>
            {deadLettersAvailable ? counters.dead : "—"}
          </p>
          <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>
            {deadLettersAvailable ? "Eventos movidos a DLQ" : "Sin grant de lectura"}
          </p>
        </div>
        <div className="flow-card" style={{ margin: 0, padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
            <CheckCircle2 size={18} color="#16a34a" />
            <strong style={{ fontSize: "13px", color: "#0f172a" }}>Entregados</strong>
          </div>
          <p style={{ margin: 0, fontSize: "24px", fontWeight: 800 }}>{counters.delivered}</p>
          <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>
            {counters.total} eventos en ventana (100)
          </p>
        </div>
      </div>

      {/* Outbox & Dead Letter Queue */}
      <div className="flow-card">
        <div className="flow-card__header">
          <div>
            <h2 className="flow-card__title">Bandeja Outbox de Eventos Transaccionales</h2>
            <p className="flow-card__subtitle">
              Datos reales de erp.integration_outbox + erp.integration_attempts. Sin latencias ni uptimes simulados:
              integration_attempts no registra esas métricas.
            </p>
          </div>
        </div>

        {loading ? (
          <StatePanel type="loading" message="Leyendo erp.integration_outbox e intentos..." />
        ) : error ? (
          <StatePanel type="error" title="No se pudo leer el outbox" message={error} />
        ) : outbox.length === 0 ? (
          <StatePanel
            type="empty"
            title="Outbox vacío"
            message="No hay eventos en erp.integration_outbox para esta organización (permiso integrations.view requerido)."
          />
        ) : (
          <div className="flow-table-wrapper">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>ID Evento</th>
                  <th>Agregado</th>
                  <th>Tipo de Evento</th>
                  <th>Resumen</th>
                  <th>Intentos</th>
                  <th>Último error</th>
                  <th>Estado</th>
                  <th>Creado</th>
                  <th className="text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {outbox.map((row) => {
                  const mine = attemptsByOutbox.get(row.id) ?? [];
                  const status = deriveStatus(row.id, attempts, deadOutboxIds);
                  const lastFailed = mine.find((a) => a.status === "failed");
                  const canMove = status === "retrying";
                  return (
                    <tr key={row.id}>
                      <td>
                        <span className="type-badge purple" style={{ fontFamily: "monospace" }}>
                          {row.id.slice(0, 8)}
                        </span>
                      </td>
                      <td>
                        <strong>{row.aggregate_type}</strong>
                      </td>
                      <td>
                        <span style={{ fontSize: "12px", fontFamily: "monospace", color: "#0f172a" }}>
                          {row.event_type}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: "12px", color: "#475569" }}>{payloadSummary(row)}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: "12px", color: "#334155" }}>{mine.length}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: "12px", color: "#475569" }}>
                          {lastFailed?.error_message ?? "—"}
                        </span>
                      </td>
                      <td>
                        {status === "delivered" && <span className="flow-status-pill completed">{statusLabel[status]}</span>}
                        {status === "retrying" && <span className="flow-status-pill processing">{statusLabel[status]}</span>}
                        {status === "pending" && <span className="flow-status-pill processing">{statusLabel[status]}</span>}
                        {status === "dead_letter" && <span className="flow-status-pill cancelled">{statusLabel[status]}</span>}
                      </td>
                      <td>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>{formatDateTime(row.created_at)}</span>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="pag-btn"
                          style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                          disabled={!canMove || movingId === row.id}
                          title={
                            canMove
                              ? "Mover a dead letter (requiere integrations.retry)"
                              : "Solo los eventos con intentos fallidos pueden pasar a dead letter"
                          }
                          onClick={() => {
                            setDeadLetterTarget(row);
                            setDeadLetterReason("");
                            setActionError(null);
                          }}
                        >
                          <RotateCcw size={12} /> A DLQ
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={deadLetterTarget !== null}
        onClose={() => {
          setDeadLetterTarget(null);
          setDeadLetterReason("");
        }}
        title="Mover evento a dead letter"
        subtitle={
          deadLetterTarget
            ? `Evento ${deadLetterTarget.id.slice(0, 8)} · ${deadLetterTarget.event_type}. Requiere permiso integrations.retry y motivo.`
            : undefined
        }
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button
              type="button"
              className="pag-btn"
              onClick={() => {
                setDeadLetterTarget(null);
                setDeadLetterReason("");
              }}
              disabled={movingId !== null}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => void handleConfirmDeadLetter()}
              disabled={movingId !== null || deadLetterReason.trim() === ""}
            >
              {movingId ? "Moviendo…" : "Confirmar pase a DLQ"}
            </button>
          </div>
        }
      >
        <label style={{ display: "block", fontSize: "13px", color: "var(--text-muted)" }}>
          Motivo (obligatorio)
          <textarea
            value={deadLetterReason}
            onChange={(e) => setDeadLetterReason(e.target.value)}
            rows={3}
            style={{ width: "100%", marginTop: "6px" }}
            placeholder="Ej.: proveedor caído tras 5 reintentos, se deriva a revisión manual"
          />
        </label>
      </Modal>
    </div>
  );
};
