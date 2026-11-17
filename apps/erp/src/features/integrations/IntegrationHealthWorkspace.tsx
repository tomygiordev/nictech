import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw, Inbox, CheckCircle2, AlertTriangle, ArchiveX } from "lucide-react";
import { WorkspaceHeader, StatePanel, Modal } from "../../components/erp/WorkspaceUi";
import { formatDateTime } from "../../lib/formatters";
import { useErpAuth } from "../../auth/ErpAuthContext";
import {
  listDeadLetters,
  listIntegrationAttempts,
  listIntegrationOutbox,
  listIntegrationRetryRequests,
  moveIntegrationToDeadLetter,
  requestIntegrationRetry,
  type IntegrationAttemptRow,
  type IntegrationOutboxRow,
  type IntegrationRetryAction,
  type IntegrationRetryRequestRow,
} from "./api";

type DeliveryStatus = "delivered" | "failed" | "retry_scheduled" | "pending" | "dead_letter";

const deriveStatus = (
  outboxId: string,
  attempts: IntegrationAttemptRow[],
  deadOutboxIds: Set<string>,
  pendingRetryOutboxIds: Set<string>,
): DeliveryStatus => {
  if (pendingRetryOutboxIds.has(outboxId)) return "retry_scheduled";
  if (deadOutboxIds.has(outboxId)) return "dead_letter";
  const mine = attempts.filter((a) => a.outbox_id === outboxId);
  if (mine.some((a) => a.status === "succeeded")) return "delivered";
  if (mine.some((a) => a.status === "failed")) return "failed";
  return "pending";
};

const statusLabel: Record<DeliveryStatus, string> = {
  delivered: "Entregado",
  failed: "Fallido",
  retry_scheduled: "Reintento programado",
  pending: "Pendiente",
  dead_letter: "Derivado a revisión manual",
};

const payloadSummary = (row: IntegrationOutboxRow): string => {
  const payload = row.payload ?? {};
  const messageId = typeof payload["message_id"] === "string" ? payload["message_id"] : null;
  const requestId = typeof payload["request_id"] === "string" ? payload["request_id"] : null;
  const ref = messageId ?? requestId;
  return ref ? `${row.aggregate_type} ${ref.slice(0, 8)}` : row.aggregate_type;
};

export const IntegrationHealthWorkspace = () => {
  const { hasPermission } = useErpAuth();
  const [outbox, setOutbox] = useState<IntegrationOutboxRow[]>([]);
  const [attempts, setAttempts] = useState<IntegrationAttemptRow[]>([]);
  const [deadOutboxIds, setDeadOutboxIds] = useState<Set<string>>(new Set());
  const [retryRequests, setRetryRequests] = useState<IntegrationRetryRequestRow[]>([]);
  const [deadLettersAvailable, setDeadLettersAvailable] = useState<boolean>(true);
  const [deadLettersNote, setDeadLettersNote] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [deadLetterTarget, setDeadLetterTarget] = useState<IntegrationOutboxRow | null>(null);
  const [deadLetterReason, setDeadLetterReason] = useState<string>("");
  const [retryTarget, setRetryTarget] = useState<IntegrationOutboxRow | null>(null);
  const [retryAction, setRetryAction] = useState<IntegrationRetryAction>("retry");
  const [retryReason, setRetryReason] = useState<string>("");
  const [retryOperationKey, setRetryOperationKey] = useState<string>("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const rows = await listIntegrationOutbox(100);
      const found = await listIntegrationAttempts(rows.map((r) => r.id));
      const dead = await listDeadLetters();
      const requests = await listIntegrationRetryRequests(rows.map((r) => r.id));
      setOutbox(rows);
      setAttempts(found);
      setDeadOutboxIds(new Set(dead.rows.map((d) => d.outbox_id)));
      setDeadLettersAvailable(dead.available);
      setDeadLettersNote(dead.available ? null : dead.errorMessage);
      setRetryRequests(requests);
    } catch (e) {
      setOutbox([]);
      setAttempts([]);
      setError(e instanceof Error ? e.message : "No se pudo leer la cola de integraciones.");
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

  const pendingRetryRequests = useMemo(() => {
    const completed = new Set(attempts.map((attempt) => attempt.retry_request_id).filter((id): id is string => id !== null));
    return retryRequests.filter((request) => !completed.has(request.id));
  }, [attempts, retryRequests]);

  const pendingRetryByOutbox = useMemo(() => {
    const map = new Map<string, IntegrationRetryRequestRow>();
    for (const request of pendingRetryRequests) {
      if (!map.has(request.outbox_id)) map.set(request.outbox_id, request);
    }
    return map;
  }, [pendingRetryRequests]);

  const pendingRetryOutboxIds = useMemo(() => new Set(pendingRetryByOutbox.keys()), [pendingRetryByOutbox]);

  const counters = useMemo(() => {
    let delivered = 0;
    let retrying = 0;
    let pending = 0;
    let dead = 0;
    for (const row of outbox) {
      const status = deriveStatus(row.id, attempts, deadOutboxIds, pendingRetryOutboxIds);
      if (status === "delivered") delivered += 1;
      else if (status === "failed" || status === "retry_scheduled") retrying += 1;
      else if (status === "pending") pending += 1;
      else dead += 1;
    }
    return { total: outbox.length, delivered, retrying, pending, dead };
  }, [outbox, attempts, deadOutboxIds, pendingRetryOutboxIds]);

  const failedAttempts = useMemo(() => attempts.filter((a) => a.status === "failed").length, [attempts]);

  const handleConfirmDeadLetter = async () => {
    if (!deadLetterTarget) return;
    try {
      setMovingId(deadLetterTarget.id);
      setActionError(null);
      setActionOk(null);
      await moveIntegrationToDeadLetter(deadLetterTarget.id, deadLetterReason);
      setActionOk(`Evento ${deadLetterTarget.id.slice(0, 8)} derivado a revisión manual.`);
      setDeadLetterTarget(null);
      setDeadLetterReason("");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "No se pudo derivar el evento a revisión manual.");
    } finally {
      setMovingId(null);
    }
  };

  const openRetry = (row: IntegrationOutboxRow, action: IntegrationRetryAction) => {
    setRetryTarget(row);
    setRetryAction(action);
    setRetryReason("");
    setRetryOperationKey(`integration-${action}-${crypto.randomUUID()}`);
    setActionError(null);
  };

  const handleConfirmRetry = async () => {
    if (!retryTarget) return;
    try {
      setMovingId(retryTarget.id);
      setActionError(null);
      setActionOk(null);
      await requestIntegrationRetry(retryTarget.id, retryAction, retryReason, retryOperationKey);
      setActionOk(
        retryAction === "recover"
          ? `Recuperación de ${retryTarget.id.slice(0, 8)} programada.`
          : `Reintento de ${retryTarget.id.slice(0, 8)} programado.`,
      );
      setRetryTarget(null);
      setRetryReason("");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "No se pudo programar la integración.");
    } finally {
      setMovingId(null);
    }
  };

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Estado de las integraciones"
        description="Seguimiento de eventos pendientes, intentos y errores registrados."
        badge="Integraciones"
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
          title="Eventos derivados sin acceso de lectura"
          message={`No se pudieron consultar los eventos derivados a revisión manual. Detalle: ${deadLettersNote ?? "permiso denegado"}`}
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
          <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>Eventos de integración sin intentos registrados</p>
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
            <strong style={{ fontSize: "13px", color: "#0f172a" }}>Revisión manual</strong>
          </div>
          <p style={{ margin: 0, fontSize: "24px", fontWeight: 800 }}>
            {deadLettersAvailable ? counters.dead : "—"}
          </p>
          <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>
            {deadLettersAvailable ? "Eventos derivados tras fallos" : "Sin permiso de lectura"}
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

      {/* Integration queue and manual review */}
      <div className="flow-card">
        <div className="flow-card__header">
          <div>
            <h2 className="flow-card__title">Cola de eventos para integraciones</h2>
            <p className="flow-card__subtitle">
              Intentos y respuestas registrados para cada evento. Los indicadores muestran el estado disponible, sin métricas de latencia ni disponibilidad.
            </p>
          </div>
        </div>

        {loading ? (
          <StatePanel type="loading" message="Leyendo eventos e intentos de integración…" />
        ) : error ? (
          <StatePanel type="error" title="No se pudo leer la cola de integraciones" message={error} />
        ) : outbox.length === 0 ? (
          <StatePanel
            type="empty"
            title="No hay eventos pendientes"
            message="La cola de integraciones está vacía o tu rol no tiene permiso para consultar los eventos."
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
                  const status = deriveStatus(row.id, attempts, deadOutboxIds, pendingRetryOutboxIds);
                  const lastFailed = mine.find((a) => a.status === "failed");
                  const pendingRequest = pendingRetryByOutbox.get(row.id);
                  const canManage = hasPermission("integrations.retry");
                  const canMove = canManage && status === "failed";
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
                        {status === "failed" && <span className="flow-status-pill cancelled">{statusLabel[status]}</span>}
                        {status === "retry_scheduled" && <span className="flow-status-pill processing">{statusLabel[status]}</span>}
                        {status === "pending" && <span className="flow-status-pill processing">{statusLabel[status]}</span>}
                        {status === "dead_letter" && <span className="flow-status-pill cancelled">{statusLabel[status]}</span>}
                      </td>
                      <td>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>{formatDateTime(row.created_at)}</span>
                      </td>
                      <td className="text-right">
                        <div style={{ display: "inline-flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "6px" }}>
                        {status === "failed" && canManage && <button
                          type="button"
                          className="pag-btn"
                          onClick={() => openRetry(row, "retry")}
                        >
                          <RotateCcw size={12} /> Reintentar
                        </button>}
                        {status === "dead_letter" && canManage && <button
                          type="button"
                          className="pag-btn"
                          onClick={() => openRetry(row, "recover")}
                        >
                          <RotateCcw size={12} /> Recuperar
                        </button>}
                        {pendingRequest && (
                          <span style={{ fontSize: "11px", color: "#475569" }}>
                            {pendingRequest.retry_sequence}/5 · {formatDateTime(pendingRequest.available_at)}
                          </span>
                        )}
                        {status === "failed" && canManage && <button
                          type="button"
                          className="pag-btn"
                          style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                          disabled={!canMove || movingId === row.id}
                          title={
                            canMove
                              ? "Derivar a revisión manual (requiere permiso para reintentar integraciones)"
                              : "Solo los eventos con intentos fallidos pueden derivarse a revisión manual"
                          }
                          onClick={() => {
                            setDeadLetterTarget(row);
                            setDeadLetterReason("");
                            setActionError(null);
                          }}
                        >
                          <RotateCcw size={12} /> Revisar manualmente
                        </button>}
                        {!canManage && <span style={{ fontSize: "11px", color: "#64748b" }}>Solo lectura</span>}
                        </div>
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
        title="Derivar evento a revisión manual"
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
              {movingId ? "Derivando…" : "Confirmar derivación"}
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

      <Modal
        isOpen={retryTarget !== null}
        onClose={() => {
          setRetryTarget(null);
          setRetryReason("");
        }}
        title={retryAction === "recover" ? "Recuperar evento derivado" : "Programar reintento"}
        subtitle={retryTarget ? `Evento ${retryTarget.id.slice(0, 8)} · máximo 5 intentos con backoff.` : undefined}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button type="button" className="pag-btn" onClick={() => setRetryTarget(null)} disabled={movingId !== null}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleConfirmRetry()}
              disabled={movingId !== null || retryReason.trim() === ""}
            >
              {movingId ? "Programando…" : retryAction === "recover" ? "Confirmar recuperación" : "Confirmar reintento"}
            </button>
          </div>
        }
      >
        <label style={{ display: "block", fontSize: "13px", color: "var(--text-muted)" }}>
          Motivo operativo (obligatorio)
          <textarea
            value={retryReason}
            onChange={(event) => setRetryReason(event.target.value)}
            rows={3}
            style={{ width: "100%", marginTop: "6px" }}
            placeholder="Ej.: proveedor restablecido; se verificó que no hubo entrega previa"
          />
        </label>
      </Modal>
    </div>
  );
};
