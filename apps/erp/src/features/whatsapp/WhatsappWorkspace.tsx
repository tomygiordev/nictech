import { useState } from "react";
import {
  Search,
  Send,
  Phone,
  CheckCheck,
} from "lucide-react";
import { WorkspaceHeader } from "../../components/erp/WorkspaceUi";

interface ChatMessage {
  id: string;
  sender: "customer" | "agent" | "system";
  text: string;
  timestamp: string;
  status?: "sent" | "delivered" | "read";
}

interface ChatThread {
  id: string;
  customerName: string;
  customerPhone: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  relatedEntityCode?: string;
  consentOptIn: boolean;
  messages: ChatMessage[];
}

const DEMO_THREADS: ChatThread[] = [
  {
    id: "th-1",
    customerName: "Agustín Benítez",
    customerPhone: "+54 9 11 4829-1029",
    lastMessage: "Perfecto Tomás, confirmo el presupuesto del cambio de pantalla.",
    lastMessageTime: "14:22",
    unreadCount: 1,
    relatedEntityCode: "NT-8492-X",
    consentOptIn: true,
    messages: [
      { id: "m1", sender: "system", text: "🔧 NicTech Taller: Tu equipo iPhone 13 Pro ingresó a diagnóstico con tracking NT-8492-X.", timestamp: "28 Ago 14:30" },
      { id: "m2", sender: "agent", text: "Hola Agustín, el técnico revisó tu iPhone. El presupuesto total por el cambio de módulo display OLED original es de $165.000 con 90 días de garantía. ¿Avanzamos con la reparación?", timestamp: "14:15", status: "read" },
      { id: "m3", sender: "customer", text: "Perfecto Tomás, confirmo el presupuesto del cambio de pantalla.", timestamp: "14:22" },
    ],
  },
  {
    id: "th-2",
    customerName: "Lucía Fernández",
    customerPhone: "+54 9 11 5920-3341",
    lastMessage: "¿Tienen cargadores originales Apple de 20W en stock?",
    lastMessageTime: "12:10",
    unreadCount: 0,
    consentOptIn: true,
    messages: [
      { id: "m4", sender: "customer", text: "Hola! ¿Tienen cargadores originales Apple de 20W en stock?", timestamp: "12:10" },
      { id: "m5", sender: "agent", text: "¡Hola Lucía! Sí, tenemos stock disponible en el local a $42.000 ARS. Podés pasar a retirarlo o coordinar envío por Moto.", timestamp: "12:14", status: "read" },
    ],
  },
  {
    id: "th-3",
    customerName: "Martín Benítez",
    customerPhone: "+54 9 11 3918-2940",
    lastMessage: "📦 Tu pedido WEB-4421 fue despachado.",
    lastMessageTime: "Ayer",
    unreadCount: 0,
    relatedEntityCode: "ORD-4421",
    consentOptIn: true,
    messages: [
      { id: "m6", sender: "system", text: "📦 NicTech Store: Tu compra online #ORD-4421 fue aprobada y despachada por Correo Argentino. Código de seguimiento: 389201948.", timestamp: "Ayer 17:00" },
    ],
  },
];

const TEMPLATES = [
  { id: "t1", name: "Presupuesto Aprobación", text: "Hola {{nombre}}, tu {{equipo}} ya fue diagnosticado. El presupuesto total es de ${{monto}} ARS con garantía oficial de taller. ¿Confirmamos el trabajo?" },
  { id: "t2", name: "Equipo Listo para Retiro", text: "¡Hola {{nombre}}! Te avisamos que tu equipo ya pasó las pruebas de control de calidad (QC) y está listo para retirar en el local. Saludos, NicTech." },
  { id: "t3", name: "Pedido Despachado", text: "Hola {{nombre}}, tu orden #{{pedido}} fue empaquetada y entregada a la empresa de logística. Código de tracking: {{tracking}}." },
];

export const WhatsappWorkspace = () => {
  const [selectedThread, setSelectedThread] = useState<ChatThread>(DEMO_THREADS[0]);
  const [messageText, setMessageText] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const handleSendMessage = () => {
    if (!messageText.trim()) return;
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: "agent",
      text: messageText.trim(),
      timestamp: "Ahora",
      status: "sent",
    };
    setSelectedThread({
      ...selectedThread,
      messages: [...selectedThread.messages, newMsg],
      lastMessage: newMsg.text,
      lastMessageTime: "Ahora",
    });
    setMessageText("");
  };

  const handleApplyTemplate = (tplText: string) => {
    const replaced = tplText
      .replace("{{nombre}}", selectedThread.customerName.split(" ")[0])
      .replace("{{equipo}}", "equipo")
      .replace("{{monto}}", "165.000")
      .replace("{{pedido}}", selectedThread.relatedEntityCode || "WEB-001")
      .replace("{{tracking}}", selectedThread.relatedEntityCode || "NT-001");
    setMessageText(replaced);
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
        <strong>[Módulo DEMO / Simulador - FASE E]:</strong> Este buzón es un prototipo interactivo de atención por mensajería. La cola de salida persistida y la integración con Meta WhatsApp Cloud API se implementan en FASE E.
      </div>
      <WorkspaceHeader
        title="WhatsApp Business & Comunicaciones Omnicanal"
        description="Bandeja de mensajería para atención de clientes, envío de presupuestos, avisos automáticos de taller y seguimiento de pedidos."
        badge="Simulador WhatsApp"
      />

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "16px", height: "calc(100vh - 240px)", minHeight: "560px" }}>
        {/* Left: Threads List */}
        <div className="flow-card" style={{ display: "flex", flexDirection: "column", padding: "16px", margin: 0 }}>
          <div className="flow-search-pill" style={{ width: "100%", marginBottom: "12px" }}>
            <Search size={15} />
            <input
              type="text"
              placeholder="Buscar conversación..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
            {DEMO_THREADS.map((t) => {
              const isSelected = selectedThread.id === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedThread(t)}
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
                    <strong style={{ fontSize: "13px", color: "var(--text-main)" }}>{t.customerName}</strong>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{t.lastMessageTime}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.lastMessage}
                  </p>
                  {t.relatedEntityCode && (
                    <div style={{ marginTop: "6px", display: "flex", gap: "6px" }}>
                      <span className="type-badge green" style={{ fontSize: "10px", padding: "1px 6px" }}>
                        {t.relatedEntityCode}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Chat Box */}
        <div className="flow-card" style={{ display: "flex", flexDirection: "column", padding: "0", margin: 0, overflow: "hidden" }}>
          {/* Header */}
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-line)", background: "var(--canvas-bg)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 800 }}>{selectedThread.customerName}</h3>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{selectedThread.customerPhone}</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {selectedThread.consentOptIn && (
                <span className="flow-status-pill completed" style={{ fontSize: "11px" }}>
                  ✓ Opt-In Consentido
                </span>
              )}
              <a
                href={`https://wa.me/${selectedThread.customerPhone.replace(/[^0-9]/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="pag-btn"
                style={{ display: "inline-flex", alignItems: "center", gap: "6px", textDecoration: "none" }}
              >
                <Phone size={13} /> Abrir en WhatsApp Web
              </a>
            </div>
          </div>

          {/* Messages Area */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px", background: "var(--surface-subtle)", display: "flex", flexDirection: "column", gap: "12px" }}>
            {selectedThread.messages.map((m) => {
              const isMe = m.sender === "agent" || m.sender === "system";
              return (
                <div
                  key={m.id}
                  style={{
                    alignSelf: isMe ? "flex-end" : "flex-start",
                    maxWidth: "70%",
                    background: isMe ? "var(--brand-soft)" : "var(--surface-white)",
                    border: isMe ? "1px solid var(--brand-border)" : "1px solid var(--border-line)",
                    borderRadius: "12px",
                    padding: "10px 14px",
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  {m.sender === "system" && (
                    <span style={{ display: "block", fontSize: "10px", fontWeight: 700, color: "var(--brand-primary)", textTransform: "uppercase", marginBottom: "2px" }}>
                      🤖 Mensaje Automático
                    </span>
                  )}
                  <p style={{ margin: 0, fontSize: "13px", color: "var(--text-main)", lineHeight: "1.4" }}>{m.text}</p>
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "4px", marginTop: "4px" }}>
                    <span style={{ fontSize: "10px", color: "var(--text-light)" }}>{m.timestamp}</span>
                    {m.status === "read" && <CheckCheck size={13} color="var(--brand-primary)" />}
                    {m.status === "delivered" && <CheckCheck size={13} color="var(--text-light)" />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Template Bar */}
          <div style={{ padding: "8px 16px", background: "var(--canvas-bg)", borderTop: "1px solid var(--border-line)", display: "flex", alignItems: "center", gap: "8px", overflowX: "auto" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Plantillas:</span>
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="pag-btn"
                style={{ fontSize: "11px", padding: "4px 8px" }}
                onClick={() => handleApplyTemplate(tpl.text)}
              >
                {tpl.name}
              </button>
            ))}
          </div>

          {/* Input Box */}
          <div style={{ padding: "12px 16px", background: "var(--surface-white)", borderTop: "1px solid var(--border-line)", display: "flex", alignItems: "center", gap: "10px" }}>
            <input
              type="text"
              placeholder="Escribe un mensaje para el cliente..."
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              style={{
                flex: 1,
                minWidth: 0,
                border: "1px solid var(--border-line)",
                borderRadius: "8px",
                padding: "9px 14px",
                fontSize: "13px",
                outline: "none",
                background: "var(--surface-subtle)",
              }}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={handleSendMessage}
            >
              <Send size={15} /> Enviar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
