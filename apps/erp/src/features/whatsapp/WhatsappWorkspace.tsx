import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Send, Phone, CheckCheck, ShieldCheck, UserCheck } from "lucide-react";
import { WorkspaceHeader, StatePanel, FeedbackAlert } from "../../components/erp/WorkspaceUi";
import { formatDateTime } from "../../lib/formatters";
import {
  assignConversation,
  listConversationAssignments,
  listConversationCustomers,
  listConversationMessages,
  listConversations,
  listCustomerConsents,
  listMessageEvents,
  listMessageTemplateVersions,
  listMessageTemplates,
  queueMessage,
  recordConsent,
  type AssignmentRecord,
  type CommunicationStatus,
  type ConsentRecord,
  type Conversation,
  type ConversationCustomer,
  type ConversationMessage,
  type MessageEvent,
  type MessageTemplate,
  type MessageTemplateVersion,
} from "./api";

interface Feedback {
  type: "success" | "error" | "info";
  message: string;
}

const STATUS_LABEL: Record<CommunicationStatus, string> = {
  queued: "En cola",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Fallido",
};

const errorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message.trim() !== "") return err.message;
  return fallback;
};

const digitsOnly = (value: string | null | undefined): string => (value ?? "").replace(/[^0-9]/g, "");

const latestStatusOf = (events: MessageEvent[]): CommunicationStatus | null => {
  if (events.length === 0) return null;
  let latest = events[0];
  for (const event of events) {
    if (event.event_sequence > latest.event_sequence) latest = event;
  }
  return latest.status;
};

export const WhatsappWorkspace = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [customers, setCustomers] = useState<ConversationCustomer[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [events, setEvents] = useState<MessageEvent[]>([]);
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [versions, setVersions] = useState<MessageTemplateVersion[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [recipient, setRecipient] = useState("");
  const [queueReason, setQueueReason] = useState("");

  const [consentGranted, setConsentGranted] = useState(true);
  const [consentSource, setConsentSource] = useState("");
  const [consentReason, setConsentReason] = useState("");

  const [assigneeId, setAssigneeId] = useState("");
  const [assignReason, setAssignReason] = useState("");

  const customersById = useMemo(() => {
    const map = new Map<string, ConversationCustomer>();
    for (const customer of customers) map.set(customer.id, customer);
    return map;
  }, [customers]);

  const eventsByMessage = useMemo(() => {
    const map = new Map<string, MessageEvent[]>();
    for (const event of events) {
      const list = map.get(event.message_id) ?? [];
      list.push(event);
      map.set(event.message_id, list);
    }
    return map;
  }, [events]);

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  const selectedCustomer = useMemo(() => {
    if (!selectedConversation?.customer_id) return null;
    return customersById.get(selectedConversation.customer_id) ?? null;
  }, [selectedConversation, customersById]);

  const activeConsent = useMemo(() => {
    if (consents.length === 0) return null;
    return consents[0];
  }, [consents]);

  const hasActiveConsent = activeConsent?.granted === true;

  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === versionId) ?? null,
    [versions, versionId]
  );

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const customer = c.customer_id ? customersById.get(c.customer_id) : undefined;
      const haystack = [customer?.display_name ?? "", customer?.phone ?? "", customer?.code ?? "", c.id]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [conversations, customersById, search]);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listConversations();
      setConversations(rows);
      if (rows.length > 0) {
        const customerIds = rows
          .map((row) => row.customer_id)
          .filter((id): id is string => id !== null);
        setCustomers(await listConversationCustomers(customerIds));
        setSelectedId((current) => current ?? rows[0].id);
      } else {
        setCustomers([]);
        setSelectedId(null);
      }
      setTemplates(await listMessageTemplates());
    } catch (err) {
      setError(errorMessage(err, "No se pudo cargar la bandeja de WhatsApp."));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (conversation: Conversation) => {
    setDetailLoading(true);
    try {
      const [msgs, consentRows, assignmentRows] = await Promise.all([
        listConversationMessages(conversation.id),
        conversation.customer_id ? listCustomerConsents(conversation.customer_id) : Promise.resolve([]),
        listConversationAssignments(conversation.id),
      ]);
      setMessages(msgs);
      setConsents(consentRows);
      setAssignments(assignmentRows);
      setEvents(await listMessageEvents(msgs.map((m) => m.id)));
      const customer = conversation.customer_id
        ? (await listConversationCustomers([conversation.customer_id]))[0]
        : undefined;
      setRecipient(customer?.phone ?? "");
    } catch (err) {
      setFeedback({ type: "error", message: errorMessage(err, "No se pudo cargar la conversación.") });
      setMessages([]);
      setEvents([]);
      setConsents([]);
      setAssignments([]);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    if (!selectedConversation) return;
    void loadDetail(selectedConversation);
  }, [selectedConversation, loadDetail]);

  const loadVersions = useCallback(async (targetTemplateId: string) => {
    if (targetTemplateId === "") {
      setVersions([]);
      setVersionId("");
      setVariableValues({});
      return;
    }
    try {
      const rows = await listMessageTemplateVersions(targetTemplateId);
      setVersions(rows);
      const latest = rows[0] ?? null;
      setVersionId(latest?.id ?? "");
      const initial: Record<string, string> = {};
      for (const key of latest?.variable_keys ?? []) initial[key] = "";
      setVariableValues(initial);
    } catch (err) {
      setFeedback({ type: "error", message: errorMessage(err, "No se pudieron cargar las versiones de la plantilla.") });
      setVersions([]);
      setVersionId("");
      setVariableValues({});
    }
  }, []);

  const handleSelectVersion = (targetVersionId: string) => {
    setVersionId(targetVersionId);
    const version = versions.find((v) => v.id === targetVersionId) ?? null;
    const initial: Record<string, string> = {};
    for (const key of version?.variable_keys ?? []) initial[key] = variableValues[key] ?? "";
    setVariableValues(initial);
  };

  const runAction = async (key: string, fn: () => Promise<string>, successPrefix: string) => {
    if (busy) return;
    setBusy(key);
    setFeedback(null);
    try {
      const id = await fn();
      setFeedback({ type: "success", message: `${successPrefix} Referencia: ${id}` });
    } catch (err) {
      setFeedback({ type: "error", message: errorMessage(err, "La operación no pudo completarse.") });
    } finally {
      setBusy(null);
    }
  };

  const handleRecordConsent = () => {
    if (!selectedConversation) {
      setFeedback({ type: "error", message: "Seleccioná una conversación para registrar el consentimiento." });
      return;
    }
    if (!selectedConversation.customer_id) {
      setFeedback({ type: "error", message: "La conversación no tiene cliente asociado." });
      return;
    }
    const branchId = selectedConversation.branch_id;
    const customerId = selectedConversation.customer_id;
    void runAction("consent", async () => {
      const id = await recordConsent({
        branchId,
        customerId,
        granted: consentGranted,
        source: consentSource,
        reason: consentReason,
      });
      setConsents(await listCustomerConsents(customerId));
      setConsentSource("");
      setConsentReason("");
      return id;
    }, "Consentimiento registrado.");
  };

  const handleQueueMessage = () => {
    if (!selectedConversation) {
      setFeedback({ type: "error", message: "Seleccioná una conversación para encolar el mensaje." });
      return;
    }
    if (!selectedConversation.customer_id) {
      setFeedback({ type: "error", message: "La conversación no tiene cliente asociado." });
      return;
    }
    if (!selectedVersion) {
      setFeedback({ type: "error", message: "Seleccioná una plantilla y su versión." });
      return;
    }
    if (!hasActiveConsent) {
      setFeedback({
        type: "error",
        message: "El cliente no tiene consentimiento vigente de WhatsApp. Registralo antes de encolar.",
      });
      return;
    }
    const missing = selectedVersion.variable_keys.filter((key) => (variableValues[key] ?? "").trim() === "");
    if (missing.length > 0) {
      setFeedback({
        type: "error",
        message: `Completá las variables exactas de la plantilla: ${missing.join(", ")}.`,
      });
      return;
    }
    const variables: Record<string, string> = {};
    for (const key of selectedVersion.variable_keys) variables[key] = variableValues[key].trim();
    const branchId = selectedConversation.branch_id;
    const customerId = selectedConversation.customer_id;
    const conversationId = selectedConversation.id;
    const templateVersionId = selectedVersion.id;
    void runAction("queue", async () => {
      const id = await queueMessage({
        branchId,
        customerId,
        conversationId,
        templateVersionId,
        recipientAddress: recipient,
        variables,
        reason: queueReason,
      });
      const msgs = await listConversationMessages(conversationId);
      setMessages(msgs);
      setEvents(await listMessageEvents(msgs.map((m) => m.id)));
      setQueueReason("");
      return id;
    }, "Mensaje encolado en estado queued. El envío lo procesa el worker de integración.");
  };

  const handleAssign = () => {
    if (!selectedConversation) {
      setFeedback({ type: "error", message: "Seleccioná una conversación para asignarla." });
      return;
    }
    const conversationId = selectedConversation.id;
    const userId = assigneeId.trim() === "" ? null : assigneeId.trim();
    void runAction("assign", async () => {
      const id = await assignConversation({ conversationId, userId, reason: assignReason });
      setAssignments(await listConversationAssignments(conversationId));
      setAssignReason("");
      return id;
    }, "Conversación asignada.");
  };

  if (loading) {
    return (
      <div className="flow-dashboard">
        <WorkspaceHeader
          title="WhatsApp Business & Comunicaciones"
          description="Bandeja de mensajería con cola de salida persistida y consentimientos."
          badge="Canal oficial"
        />
        <StatePanel type="loading" title="Cargando bandeja" message="Consultando conversaciones en Supabase…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flow-dashboard">
        <WorkspaceHeader
          title="WhatsApp Business & Comunicaciones"
          description="Bandeja de mensajería con cola de salida persistida y consentimientos."
          badge="Canal oficial"
        />
        <StatePanel
          type="error"
          title="Error al cargar la bandeja"
          message={error}
          action={
            <button type="button" className="btn-primary" onClick={() => void loadInbox()}>
              Reintentar
            </button>
          }
        />
      </div>
    );
  }

  const waDigits = digitsOnly(selectedCustomer?.phone ?? recipient);

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="WhatsApp Business & Comunicaciones"
        description="Bandeja real: conversaciones, consentimientos, plantillas versionadas y cola de salida. El estado de cada mensaje refleja communication_message_events; la integración con Meta WhatsApp Cloud API aún no está conectada, por lo que los mensajes quedan encolados sin simular envíos."
        badge="Canal oficial"
      />

      {feedback && (
        <FeedbackAlert
          type={feedback.type}
          message={feedback.message}
          onClose={() => setFeedback(null)}
        />
      )}

      <StatePanel
        type="info"
        title="Encolado real, sin simulación"
        message="Encolar crea la conversación (si falta), el mensaje outbound y el evento queued más el pedido message.send.requested al outbox. Nada se marca como enviado, entregado o leído desde este workspace."
      />

      {conversations.length === 0 ? (
        <StatePanel
          type="empty"
          title="Sin conversaciones"
          message="Todavía no hay conversaciones de WhatsApp. Se crean al encolar el primer mensaje o al recibir un inbound del proveedor."
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "16px", minHeight: "560px" }}>
          <div className="flow-card" style={{ display: "flex", flexDirection: "column", padding: "16px", margin: 0 }}>
            <div className="flow-search-pill" style={{ width: "100%", marginBottom: "12px" }}>
              <Search size={15} />
              <input
                type="text"
                placeholder="Buscar por cliente o teléfono…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
              {filteredConversations.map((c) => {
                const customer = c.customer_id ? customersById.get(c.customer_id) : undefined;
                const isSelected = selectedId === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    style={{
                      padding: "12px",
                      borderRadius: "10px",
                      cursor: "pointer",
                      background: isSelected ? "var(--brand-soft)" : "var(--surface-white)",
                      border: isSelected ? "1px solid var(--brand-border)" : "1px solid var(--border-light)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <strong style={{ fontSize: "13px", color: "var(--text-main)" }}>
                        {customer?.display_name ?? "Cliente sin identificar"}
                      </strong>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                        {formatDateTime(c.opened_at)}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
                      {customer?.phone ?? "Sin teléfono"} · {c.closed_at ? "Cerrada" : "Abierta"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flow-card" style={{ display: "flex", flexDirection: "column", padding: "0", margin: 0, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-line)", background: "var(--canvas-bg)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 800 }}>
                  {selectedCustomer?.display_name ?? "Conversación"}
                </h3>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  {selectedCustomer?.phone ?? "Sin teléfono registrado"}
                  {selectedConversation?.closed_at ? " · Cerrada" : " · Abierta"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {activeConsent ? (
                  <span className="flow-status-pill completed" style={{ fontSize: "11px" }}>
                    <ShieldCheck size={12} /> {activeConsent.granted ? "Opt-In vigente" : "Opt-Out vigente"}
                  </span>
                ) : (
                  <span className="flow-status-pill cancelled" style={{ fontSize: "11px" }}>
                    Sin consentimiento
                  </span>
                )}
                {waDigits !== "" && (
                  <a
                    href={`https://wa.me/${waDigits}`}
                    target="_blank"
                    rel="noreferrer"
                    className="pag-btn"
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", textDecoration: "none" }}
                  >
                    <Phone size={13} /> Abrir en WhatsApp Web
                  </a>
                )}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "20px", background: "var(--surface-subtle)", display: "flex", flexDirection: "column", gap: "12px", minHeight: "280px" }}>
              {detailLoading ? (
                <StatePanel type="loading" message="Cargando mensajes y eventos…" />
              ) : messages.length === 0 ? (
                <StatePanel
                  type="empty"
                  title="Sin mensajes"
                  message="Esta conversación aún no tiene mensajes registrados."
                />
              ) : (
                messages.map((m) => {
                  const msgEvents = eventsByMessage.get(m.id) ?? [];
                  const status = latestStatusOf(msgEvents);
                  const isOutbound = m.direction === "outbound";
                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: isOutbound ? "flex-end" : "flex-start",
                        maxWidth: "70%",
                        background: isOutbound ? "var(--brand-soft)" : "var(--surface-white)",
                        border: isOutbound ? "1px solid var(--brand-border)" : "1px solid var(--border-line)",
                        borderRadius: "12px",
                        padding: "10px 14px",
                        boxShadow: "var(--shadow-sm)",
                      }}
                    >
                      <span style={{ display: "block", fontSize: "10px", fontWeight: 700, color: "var(--brand-primary)", textTransform: "uppercase", marginBottom: "2px" }}>
                        {isOutbound ? "Saliente" : "Entrante"}
                      </span>
                      <p style={{ margin: 0, fontSize: "13px", color: "var(--text-main)", lineHeight: "1.4" }}>{m.body_snapshot}</p>
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "4px", marginTop: "4px" }}>
                        <span style={{ fontSize: "10px", color: "var(--text-light)" }}>{formatDateTime(m.created_at)}</span>
                        {status && (
                          <span style={{ fontSize: "10px", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: "2px" }}>
                            <CheckCheck size={13} /> {STATUS_LABEL[status]}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ padding: "16px 20px", background: "var(--canvas-bg)", borderTop: "1px solid var(--border-line)", display: "flex", flexDirection: "column", gap: "10px" }}>
              <strong style={{ fontSize: "13px" }}>Redactar con plantilla real y encolar</strong>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  Plantilla
                  <select
                    className="erp-form-select"
                    value={templateId}
                    onChange={(e) => {
                      setTemplateId(e.target.value);
                      void loadVersions(e.target.value);
                    }}
                  >
                    <option value="">Seleccionar…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  Versión
                  <select
                    className="erp-form-select"
                    value={versionId}
                    onChange={(e) => handleSelectVersion(e.target.value)}
                    disabled={versions.length === 0}
                  >
                    <option value="">Seleccionar…</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.version} · {v.language_code}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedVersion && (
                <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>
                  {selectedVersion.body}
                </p>
              )}
              {selectedVersion && selectedVersion.variable_keys.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  {selectedVersion.variable_keys.map((key) => (
                    <label key={key} style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                      {key}
                      <input
                        type="text"
                        className="erp-form-input"
                        value={variableValues[key] ?? ""}
                        onChange={(e) => setVariableValues((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder={`Valor de ${key}`}
                      />
                    </label>
                  ))}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "10px" }}>
                <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  Destinatario
                  <input
                    type="text"
                    className="erp-form-input"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="+54 9 …"
                  />
                </label>
                <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  Motivo (auditoría)
                  <input
                    type="text"
                    className="erp-form-input"
                    value={queueReason}
                    onChange={(e) => setQueueReason(e.target.value)}
                    placeholder="Ej.: aviso de presupuesto aprobado"
                  />
                </label>
              </div>
              <div>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleQueueMessage}
                  disabled={busy !== null}
                >
                  <Send size={15} /> {busy === "queue" ? "Encolando…" : "Encolar mensaje"}
                </button>
              </div>
            </div>

            <div style={{ padding: "16px 20px", background: "var(--surface-white)", borderTop: "1px solid var(--border-line)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <strong style={{ fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <ShieldCheck size={14} /> Consentimiento WhatsApp
                </strong>
                <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  Estado
                  <select
                    className="erp-form-select"
                    value={consentGranted ? "granted" : "revoked"}
                    onChange={(e) => setConsentGranted(e.target.value === "granted")}
                  >
                    <option value="granted">Otorgado (opt-in)</option>
                    <option value="revoked">Revocado (opt-out)</option>
                  </select>
                </label>
                <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  Origen
                  <input
                    type="text"
                    className="erp-form-input"
                    value={consentSource}
                    onChange={(e) => setConsentSource(e.target.value)}
                    placeholder="Ej.: mostrador, web, taller"
                  />
                </label>
                <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  Motivo (auditoría)
                  <input
                    type="text"
                    className="erp-form-input"
                    value={consentReason}
                    onChange={(e) => setConsentReason(e.target.value)}
                    placeholder="Ej.: cliente acepta avisos de taller"
                  />
                </label>
                <div>
                  <button
                    type="button"
                    className="pag-btn"
                    onClick={handleRecordConsent}
                    disabled={busy !== null}
                  >
                    {busy === "consent" ? "Registrando…" : "Registrar consentimiento"}
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <strong style={{ fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <UserCheck size={14} /> Asignación
                </strong>
                {assignments.length > 0 && (
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
                    Última: {assignments[0].assigned_user_id ?? "sin asignar"} · {formatDateTime(assignments[0].assigned_at)} · {assignments[0].reason}
                  </p>
                )}
                <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  ID de usuario (vacío = desasignar)
                  <input
                    type="text"
                    className="erp-form-input"
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    placeholder="UUID del agente"
                  />
                </label>
                <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  Motivo (auditoría)
                  <input
                    type="text"
                    className="erp-form-input"
                    value={assignReason}
                    onChange={(e) => setAssignReason(e.target.value)}
                    placeholder="Ej.: deriva a ventas"
                  />
                </label>
                <div>
                  <button
                    type="button"
                    className="pag-btn"
                    onClick={handleAssign}
                    disabled={busy !== null}
                  >
                    {busy === "assign" ? "Asignando…" : "Asignar conversación"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
