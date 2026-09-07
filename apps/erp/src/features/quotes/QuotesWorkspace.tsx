import { useState, useEffect, useMemo, useCallback } from "react";
import {
  DollarSign,
  CheckCircle,
  TrendingUp,
  Search,
  Plus,
  Send,
  Receipt,
  Eye,
  Check,
  XCircle,
  AlertCircle,
  RefreshCw,
  Clock,
  FileText,
} from "lucide-react";
import {
  WorkspaceHeader,
  Modal,
  FeedbackAlert,
  KpiCard,
} from "../../components/erp/WorkspaceUi";
import { formatCurrency, formatDate } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";
import {
  QuoteOverview,
  QuoteLineRecord,
  listQuotes,
  createRepairQuote,
  issueRepairQuote,
  respondQuoteDecision,
  CreateQuoteInput,
} from "./api";

interface LineFormItem {
  id: string;
  kind: "product" | "service" | "free_concept";
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  taxRatePercent: number;
}

interface RepairOrderOption {
  id: string;
  order_code: string;
  customer_name: string;
  brand: string;
  model: string;
  status: string;
}

export const QuotesWorkspace = () => {
  const [quotes, setQuotes] = useState<QuoteOverview[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Detail Modal
  const [selectedQuote, setSelectedQuote] = useState<QuoteOverview | null>(null);

  // New Quote Modal
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [repairOrders, setRepairOrders] = useState<RepairOrderOption[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [quoteCurrency, setQuoteCurrency] = useState<"ARS" | "USD">("ARS");
  const [quoteReason, setQuoteReason] = useState<string>("Presupuesto inicial para reparación");
  const [lines, setLines] = useState<LineFormItem[]>([
    {
      id: "l-1",
      kind: "service",
      description: "Mano de obra diagnóstico y reparación",
      quantity: 1,
      unitPrice: 15000,
      unitCost: 0,
      taxRatePercent: 21,
    },
  ]);
  const [submitting, setSubmitting] = useState(false);

  // Decision Modal
  const [decisionModalQuote, setDecisionModalQuote] = useState<QuoteOverview | null>(null);
  const [decisionType, setDecisionType] = useState<"approved" | "rejected">("approved");
  const [decisionNotes, setDecisionNotes] = useState<string>("");
  const [submittingDecision, setSubmittingDecision] = useState<boolean>(false);

  // Products for line selector
  const [availableProducts, setAvailableProducts] = useState<Array<{ id: string; internal_name: string; internal_code: string }>>([]);

  const fetchQuotesData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listQuotes();
      setQuotes(data);
    } catch (err) {
      console.error("Error al cargar presupuestos:", err);
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Error al conectar con la base de datos de presupuestos.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchQuotesData();
  }, [fetchQuotesData]);

  // Load orders and products when opening new quote modal
  const loadNewQuotePrerequisites = useCallback(async () => {
    try {
      const [ordersRes, prodsRes] = await Promise.all([
        supabase
          .from("repair_orders_overview")
          .select("id, order_code, customer_name, brand, model, status, status_is_terminal")
          .order("created_at", { ascending: false }),
        supabase
          .from("products")
          .select("id, internal_name, internal_code")
          .eq("is_active", true)
          .order("internal_name", { ascending: true }),
      ]);

      const ordersList: RepairOrderOption[] = (ordersRes.data || []).map((o: any) => ({
        id: o.id,
        order_code: o.order_code,
        customer_name: o.customer_name || "Cliente taller",
        brand: o.brand || "",
        model: o.model || "",
        status: o.status || "En taller",
      }));
      setRepairOrders(ordersList);
      if (ordersList.length > 0 && !selectedOrderId) {
        setSelectedOrderId(ordersList[0].id);
      }

      setAvailableProducts(prodsRes.data || []);
    } catch (e) {
      console.warn("Aviso al cargar órdenes de reparación:", e);
    }
  }, [selectedOrderId]);

  useEffect(() => {
    if (isNewModalOpen) {
      void loadNewQuotePrerequisites();
    }
  }, [isNewModalOpen, loadNewQuotePrerequisites]);

  // Line item manipulation
  const handleAddLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: "service",
        description: "",
        quantity: 1,
        unitPrice: 0,
        unitCost: 0,
        taxRatePercent: 21,
      },
    ]);
  };

  const handleRemoveLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateLine = (index: number, patch: Partial<LineFormItem>) => {
    setLines((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, ...patch };
        if (patch.productId && availableProducts.length > 0) {
          const found = availableProducts.find((p) => p.id === patch.productId);
          if (found && !updated.description) {
            updated.description = `${found.internal_name} (${found.internal_code})`;
          }
        }
        return updated;
      })
    );
  };

  const computedTotals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    lines.forEach((l) => {
      const lineSub = Math.max(0, l.quantity) * Math.max(0, l.unitPrice);
      const lineTax = (lineSub * Math.max(0, l.taxRatePercent)) / 100;
      subtotal += lineSub;
      tax += lineTax;
    });
    return {
      subtotal,
      tax,
      total: subtotal + tax,
    };
  }, [lines]);

  // Submit New Quote
  const handleCreateQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderId) {
      setFeedback({ type: "error", message: "Seleccioná una orden de reparación válida." });
      return;
    }
    if (lines.length === 0) {
      setFeedback({ type: "error", message: "Agregá al menos una línea al presupuesto." });
      return;
    }
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.description.trim()) {
        setFeedback({ type: "error", message: `La línea ${i + 1} debe contener una descripción válida.` });
        return;
      }
      if (l.quantity <= 0 || l.unitPrice <= 0) {
        setFeedback({ type: "error", message: `La línea ${i + 1} debe tener cantidad y precio mayores a 0.` });
        return;
      }
    }

    try {
      setSubmitting(true);
      const input: CreateQuoteInput = {
        repairOrderId: selectedOrderId,
        currencyCode: quoteCurrency,
        reason: quoteReason,
        lines: lines.map((l) => ({
          kind: l.kind,
          product_id: l.productId,
          description: l.description.trim(),
          quantity: Number(l.quantity),
          unit_price: Number(l.unitPrice),
          unit_cost: Number(l.unitCost || 0),
          tax_rate_percent: Number(l.taxRatePercent || 0),
        })),
      };

      await createRepairQuote(input);
      setFeedback({
        type: "success",
        message: "¡Presupuesto versionado creado exitosamente en base de datos!",
      });
      setIsNewModalOpen(false);
      // Reset form
      setLines([
        {
          id: "l-1",
          kind: "service",
          description: "Mano de obra diagnóstico y reparación",
          quantity: 1,
          unitPrice: 15000,
          unitCost: 0,
          taxRatePercent: 21,
        },
      ]);
      await fetchQuotesData();
    } catch (err) {
      console.error(err);
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Error al guardar el presupuesto.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Issue Quote & Share WhatsApp (Finding H20)
  const handleIssueAndSendWhatsApp = async (q: QuoteOverview) => {
    try {
      let token = "";
      if (!q.issued_at) {
        // Issue quote officially
        const res = await issueRepairQuote(q.id);
        token = res.response_token;
        setFeedback({
          type: "success",
          message: `Presupuesto ${q.order_code} v${q.version} emitido formalmente con token de seguridad.`,
        });
        await fetchQuotesData();
      }

      const rawPhone = (q.customer_phone || "").replace(/[^0-9]/g, "");
      const isApproved = q.decision === "approved";
      const isRejected = q.decision === "rejected";

      let statusIntro = isApproved
        ? "✅ *Presupuesto Aprobado*"
        : isRejected
        ? "❌ *Presupuesto Rechazado*"
        : "📄 *Presupuesto Formal*";

      const linesSummary = q.lines
        .map((l) => `• ${l.description} (x${l.quantity}): ${formatCurrency(l.line_total, q.currency_code as "ARS" | "USD")}`)
        .join("\n");

      const msg = `¡Hola ${q.customer_name}! Te compartimos el detalle de tu presupuesto de taller en NicTech:\n\n${statusIntro}\n🔧 *Orden:* ${q.order_code} (Versión ${q.version})\n\n📋 *Detalle de Trabajos y Repuestos:*\n${linesSummary || "• Diagnóstico y servicio técnico"}\n\n💵 *Total Final:* ${formatCurrency(q.total_amount, q.currency_code as "ARS" | "USD")}${q.expires_at ? `\n📅 *Válido hasta:* ${formatDate(q.expires_at)}` : ""}\n\n${token ? `Para confirmar o revisar podés responder a este mensaje o ingresar a tu orden con código: ${q.order_code}` : ""}\n\nCualquier consulta quedamos a tu disposición. ¡Saludos de NicTech!`;

      const url = rawPhone
        ? `https://wa.me/${rawPhone}?text=${encodeURIComponent(msg)}`
        : `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;

      window.open(url, "_blank");
    } catch (err) {
      console.error(err);
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Error al emitir o compartir el presupuesto.",
      });
    }
  };

  // Submit Client Decision (Finding H06)
  const handleSubmitDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decisionModalQuote) return;

    try {
      setSubmittingDecision(true);
      await respondQuoteDecision(decisionModalQuote.id, decisionType, decisionNotes);
      setFeedback({
        type: "success",
        message: `Decisión "${decisionType === "approved" ? "Aprobado" : "Rechazado"}" registrada exitosamente para la orden ${decisionModalQuote.order_code} v${decisionModalQuote.version}.`,
      });
      setDecisionModalQuote(null);
      setDecisionNotes("");
      if (selectedQuote?.id === decisionModalQuote.id) {
        setSelectedQuote(null);
      }
      await fetchQuotesData();
    } catch (err) {
      console.error(err);
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Error al registrar la decisión del cliente.",
      });
    } finally {
      setSubmittingDecision(false);
    }
  };

  // Filtered Quotes
  const filteredQuotes = useMemo(() => {
    return quotes.filter((q) => {
      const text = `${q.order_code} ${q.customer_name} ${q.customer_phone || ""} v${q.version}`.toLowerCase();
      return text.includes(search.toLowerCase());
    });
  }, [quotes, search]);

  // KPI Computations
  const totalCotizadoArs = useMemo(() => {
    return quotes
      .filter((q) => q.currency_code === "ARS")
      .reduce((acc, q) => acc + q.total_amount, 0);
  }, [quotes]);

  const approvedCount = useMemo(() => {
    return quotes.filter((q) => q.decision === "approved").length;
  }, [quotes]);

  const rateConversion = useMemo(() => {
    if (quotes.length === 0) return "0%";
    return `${Math.round((approvedCount / quotes.length) * 100)}%`;
  }, [quotes, approvedCount]);

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Presupuestos & Cotizaciones Comerciales"
        description="Presupuestos técnicos versionados vinculados a órdenes de servicio, líneas detalladas de repuestos y mano de obra, emisión trazable y registro formal de respuesta del cliente."
        badge={`${quotes.length} Cotizaciones Registradas`}
      />

      {feedback && (
        <FeedbackAlert
          type={feedback.type}
          message={feedback.message}
          onClose={() => setFeedback(null)}
        />
      )}

      {/* KPI Cards */}
      <div className="kpi-grid">
        <KpiCard
          icon={DollarSign}
          iconVariant="green"
          label="Total Cotizado ARS"
          value={formatCurrency(totalCotizadoArs, "ARS")}
          trend={{ text: "Presupuestado", positive: true }}
          sublabel="Valor total de propuestas vigentes"
        />

        <KpiCard
          icon={CheckCircle}
          iconVariant="navy"
          label="Cotizaciones Aprobadas"
          value={approvedCount}
          trend={{ text: "Confirmadas", positive: true }}
          sublabel="Aprobadas formalmente por el cliente"
        />

        <KpiCard
          icon={TrendingUp}
          iconVariant="steel"
          label="Tasa de Cierre"
          value={rateConversion}
          trend={{ text: "Conversión", positive: true }}
          sublabel="Aprobadas sobre total de presupuestos"
        />
      </div>

      {/* Main Table Card */}
      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Listado de Presupuestos Formales</h2>
            <p className="flow-card__subtitle">Historial de versiones, estado de validez y decisiones del cliente</p>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <div className="flow-search-pill" style={{ width: "260px" }}>
              <Search size={15} />
              <input
                type="text"
                placeholder="Buscar por orden, cliente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button
              type="button"
              className="pag-btn"
              onClick={() => void fetchQuotesData()}
              title="Recargar datos"
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
            </button>

            <button
              type="button"
              className="btn-primary"
              onClick={() => setIsNewModalOpen(true)}
            >
              <Plus size={16} /> Nuevo Presupuesto
            </button>
          </div>
        </div>

        <div style={{ padding: "12px 16px", background: "var(--bg-app)", borderBottom: "1px solid var(--border-line)", display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-muted)" }}>
          <Receipt size={15} style={{ color: "var(--brand-primary)", flexShrink: 0 }} />
          <span>Cada presupuesto está formalmente vinculado a una orden de taller con líneas inmutables y congelamiento de costos en base de datos.</span>
        </div>

        <div className="flow-table-wrapper">
          <table className="flow-table">
            <thead>
              <tr>
                <th>Nro / Orden</th>
                <th>Cliente & Contacto</th>
                <th>Conceptos / Líneas</th>
                <th>Validez</th>
                <th>Total</th>
                <th>Estado Comercial</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    Cargando cotizaciones desde la base de datos central...
                  </td>
                </tr>
              ) : filteredQuotes.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    No hay presupuestos registrados en la base de datos central.
                  </td>
                </tr>
              ) : (
                filteredQuotes.map((q) => {
                  const isExpired = q.expires_at ? new Date(q.expires_at) < new Date() : false;
                  return (
                    <tr key={q.id}>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span className="type-badge green" style={{ fontFamily: "monospace", width: "fit-content" }}>
                            {q.order_code} (v{q.version})
                          </span>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            {formatDate(q.created_at)}
                          </span>
                        </div>
                      </td>
                      <td>
                        <strong>{q.customer_name}</strong>
                        {q.customer_phone && (
                          <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>
                            {q.customer_phone}
                          </span>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: "12px", color: "var(--text-main)" }}>
                          {q.lines.length} {q.lines.length === 1 ? "ítem" : "ítems"}
                          {q.lines.length > 0 && (
                            <span style={{ display: "block", color: "var(--text-muted)", fontSize: "11px" }}>
                              {q.lines[0].description}
                              {q.lines.length > 1 ? ` (+${q.lines.length - 1} más)` : ""}
                            </span>
                          )}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: "12px", color: isExpired ? "var(--rose-accent)" : "var(--text-muted)" }}>
                          {q.expires_at ? formatDate(q.expires_at) : "Sin vencimiento"}
                        </span>
                      </td>
                      <td>
                        <strong style={{ color: "var(--brand-primary)" }}>
                          {formatCurrency(q.total_amount, q.currency_code as "ARS" | "USD")}
                        </strong>
                      </td>
                      <td>
                        {q.decision === "approved" ? (
                          <span className="flow-status-pill completed" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <Check size={11} /> Aprobado
                          </span>
                        ) : q.decision === "rejected" ? (
                          <span className="flow-status-pill failed" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <XCircle size={11} /> Rechazado
                          </span>
                        ) : isExpired ? (
                          <span className="flow-status-pill cancelled" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <Clock size={11} /> Vencido
                          </span>
                        ) : q.issued_at ? (
                          <span className="flow-status-pill confirmed" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <Clock size={11} /> Emitido / Pendiente
                          </span>
                        ) : (
                          <span className="flow-status-pill pending" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <FileText size={11} /> Borrador
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        <div style={{ display: "inline-flex", gap: "6px" }}>
                          <button
                            type="button"
                            className="pag-btn"
                            style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                            onClick={() => setSelectedQuote(q)}
                            title="Ver detalle del presupuesto"
                          >
                            <Eye size={12} /> Ver
                          </button>

                          <button
                            type="button"
                            className="pag-btn"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              color: "var(--brand-primary)",
                              borderColor: "var(--brand-border)",
                            }}
                            onClick={() => void handleIssueAndSendWhatsApp(q)}
                            title={q.issued_at ? "Compartir por WhatsApp" : "Emitir y Enviar por WhatsApp"}
                          >
                            <Send size={12} /> {q.issued_at ? "WhatsApp" : "Emitir"}
                          </button>

                          {!q.decision && (
                            <button
                              type="button"
                              className="pag-btn"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                color: "var(--emerald-success)",
                                borderColor: "var(--border-line)",
                              }}
                              onClick={() => {
                                setDecisionModalQuote(q);
                                setDecisionType("approved");
                                setDecisionNotes("");
                              }}
                              title="Registrar decisión del cliente"
                            >
                              <Check size={12} /> Decisión
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Ver Detalle del Presupuesto */}
      {selectedQuote && (
        <Modal
          isOpen={Boolean(selectedQuote)}
          onClose={() => setSelectedQuote(null)}
          title={`Presupuesto: ${selectedQuote.order_code} (Versión ${selectedQuote.version})`}
          subtitle={`Cliente: ${selectedQuote.customer_name} • Fecha: ${formatDate(selectedQuote.created_at)}`}
          icon={Receipt}
          maxWidth="680px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Status overview bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-subtle)", padding: "12px 16px", borderRadius: "8px" }}>
              <div>
                <span className="stat-label">Estado de Decisión</span>
                <div style={{ marginTop: "4px" }}>
                  {selectedQuote.decision === "approved" ? (
                    <span className="flow-status-pill completed">Aprobado por el cliente</span>
                  ) : selectedQuote.decision === "rejected" ? (
                    <span className="flow-status-pill failed">Rechazado por el cliente</span>
                  ) : selectedQuote.issued_at ? (
                    <span className="flow-status-pill confirmed">Emitido (Esperando respuesta)</span>
                  ) : (
                    <span className="flow-status-pill pending">Borrador inicial</span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className="stat-label">Total Presupuestado</span>
                <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--brand-primary)", marginTop: "2px" }}>
                  {formatCurrency(selectedQuote.total_amount, selectedQuote.currency_code as "ARS" | "USD")}
                </div>
              </div>
            </div>

            {/* Lines Table */}
            <div>
              <h4 style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 600 }}>Líneas de la Cotización</h4>
              <div className="flow-table-wrapper">
                <table className="flow-table" style={{ fontSize: "12px" }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Tipo</th>
                      <th>Descripción</th>
                      <th>Cant.</th>
                      <th>Precio Unit.</th>
                      <th>IVA</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedQuote.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.line_number}</td>
                        <td>
                          <span className="type-badge blue">
                            {l.kind === "product" ? "Repuesto" : l.kind === "service" ? "Mano de Obra" : "Concepto"}
                          </span>
                        </td>
                        <td>{l.description}</td>
                        <td>{l.quantity}</td>
                        <td>{formatCurrency(l.unit_price, selectedQuote.currency_code as "ARS" | "USD")}</td>
                        <td>{l.tax_rate_percent}%</td>
                        <td className="text-right">
                          <strong>{formatCurrency(l.line_total, selectedQuote.currency_code as "ARS" | "USD")}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6} style={{ textAlign: "right", fontWeight: 600 }}>Subtotal:</td>
                      <td className="text-right">{formatCurrency(selectedQuote.subtotal_amount, selectedQuote.currency_code as "ARS" | "USD")}</td>
                    </tr>
                    <tr>
                      <td colSpan={6} style={{ textAlign: "right", fontWeight: 600 }}>IVA / Impuestos:</td>
                      <td className="text-right">{formatCurrency(selectedQuote.tax_amount, selectedQuote.currency_code as "ARS" | "USD")}</td>
                    </tr>
                    <tr>
                      <td colSpan={6} style={{ textAlign: "right", fontWeight: 700, fontSize: "14px" }}>Total General:</td>
                      <td className="text-right" style={{ fontWeight: 700, fontSize: "14px", color: "var(--brand-primary)" }}>
                        {formatCurrency(selectedQuote.total_amount, selectedQuote.currency_code as "ARS" | "USD")}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-line)", paddingTop: "12px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="pag-btn"
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--brand-primary)" }}
                  onClick={() => void handleIssueAndSendWhatsApp(selectedQuote)}
                >
                  <Send size={14} /> Compartir por WhatsApp
                </button>

                {!selectedQuote.decision && (
                  <button
                    type="button"
                    className="pag-btn"
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--emerald-success)" }}
                    onClick={() => {
                      setDecisionModalQuote(selectedQuote);
                      setDecisionType("approved");
                      setDecisionNotes("");
                    }}
                  >
                    <Check size={14} /> Registrar Decisión
                  </button>
                )}
              </div>

              <button type="button" className="pag-btn" onClick={() => setSelectedQuote(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Registrar Decisión del Cliente (Finding H06) */}
      {decisionModalQuote && (
        <Modal
          isOpen={Boolean(decisionModalQuote)}
          onClose={() => setDecisionModalQuote(null)}
          title="Registrar Decisión del Cliente"
          subtitle={`Orden: ${decisionModalQuote.order_code} • Versión ${decisionModalQuote.version} (${formatCurrency(decisionModalQuote.total_amount, decisionModalQuote.currency_code as "ARS" | "USD")})`}
          icon={CheckCircle}
          maxWidth="480px"
        >
          <form onSubmit={handleSubmitDecision} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Resultado de la Decisión *</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <button
                  type="button"
                  className={`pag-btn ${decisionType === "approved" ? "active-filter" : ""}`}
                  style={{
                    padding: "10px",
                    fontWeight: 600,
                    borderColor: decisionType === "approved" ? "var(--emerald-success)" : "var(--border-line)",
                    color: decisionType === "approved" ? "var(--emerald-success)" : "var(--text-main)",
                  }}
                  onClick={() => setDecisionType("approved")}
                >
                  <Check size={16} /> Aprobado
                </button>
                <button
                  type="button"
                  className={`pag-btn ${decisionType === "rejected" ? "active-filter" : ""}`}
                  style={{
                    padding: "10px",
                    fontWeight: 600,
                    borderColor: decisionType === "rejected" ? "var(--rose-accent)" : "var(--border-line)",
                    color: decisionType === "rejected" ? "var(--rose-accent)" : "var(--text-main)",
                  }}
                  onClick={() => setDecisionType("rejected")}
                >
                  <XCircle size={16} /> Rechazado
                </button>
              </div>
            </div>

            <div className="erp-form-group">
              <label className="erp-form-label">Mensaje o Notas del Cliente (Opcional)</label>
              <textarea
                rows={3}
                placeholder="Ej: Cliente autorizó por llamada telefónica / Rechazado por presupuesto excedido..."
                value={decisionNotes}
                onChange={(e) => setDecisionNotes(e.target.value)}
                className="erp-form-textarea"
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", borderTop: "1px solid var(--border-line)", paddingTop: "12px" }}>
              <button
                type="button"
                className="pag-btn"
                onClick={() => setDecisionModalQuote(null)}
                disabled={submittingDecision}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={submittingDecision}
              >
                {submittingDecision ? "Registrando..." : "Confirmar Decisión"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Nuevo Presupuesto */}
      <Modal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        title="Crear Presupuesto Técnico Versionado"
        subtitle="Presupuesto formal vinculado a una orden de taller con líneas de repuestos y servicios"
        icon={Receipt}
        maxWidth="760px"
      >
        <form onSubmit={handleCreateQuote} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Orden de Reparación *</label>
              <select
                value={selectedOrderId}
                onChange={(e) => setSelectedOrderId(e.target.value)}
                className="erp-form-select"
                required
              >
                {repairOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.order_code} — {o.customer_name} ({o.brand} {o.model})
                  </option>
                ))}
              </select>
            </div>

            <div className="erp-form-group">
              <label className="erp-form-label">Moneda de Cotización</label>
              <select
                value={quoteCurrency}
                onChange={(e) => setQuoteCurrency(e.target.value as "ARS" | "USD")}
                className="erp-form-select"
              >
                <option value="ARS">ARS ($)</option>
                <option value="USD">USD (Dólares)</option>
              </select>
            </div>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Motivo o Razón de Emisión</label>
            <input
              type="text"
              value={quoteReason}
              onChange={(e) => setQuoteReason(e.target.value)}
              className="erp-form-input"
              placeholder="Ej: Presupuesto inicial tras diagnóstico de placa"
            />
          </div>

          {/* Lines Editor */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <label className="erp-form-label" style={{ margin: 0 }}>Líneas de Repuestos y Mano de Obra</label>
              <button
                type="button"
                className="pag-btn"
                style={{ fontSize: "11px", padding: "4px 8px" }}
                onClick={handleAddLine}
              >
                <Plus size={12} /> Agregar Ítem
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "260px", overflowY: "auto" }}>
              {lines.map((item, idx) => (
                <div
                  key={item.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 2fr 80px 110px 70px 32px",
                    gap: "8px",
                    alignItems: "center",
                    background: "var(--surface-subtle)",
                    padding: "8px 10px",
                    borderRadius: "6px",
                  }}
                >
                  <select
                    value={item.kind}
                    onChange={(e) => handleUpdateLine(idx, { kind: e.target.value as any })}
                    className="erp-form-select"
                    style={{ fontSize: "11px", padding: "4px 6px" }}
                  >
                    <option value="service">Mano de Obra</option>
                    <option value="product">Repuesto</option>
                    <option value="free_concept">Concepto</option>
                  </select>

                  {item.kind === "product" && availableProducts.length > 0 ? (
                    <select
                      value={item.productId || ""}
                      onChange={(e) => handleUpdateLine(idx, { productId: e.target.value })}
                      className="erp-form-select"
                      style={{ fontSize: "11px", padding: "4px 6px" }}
                    >
                      <option value="">-- Seleccionar repuesto --</option>
                      {availableProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.internal_name} ({p.internal_code})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      placeholder="Descripción del trabajo..."
                      value={item.description}
                      onChange={(e) => handleUpdateLine(idx, { description: e.target.value })}
                      className="erp-form-input"
                      style={{ fontSize: "12px", padding: "4px 8px" }}
                      required
                    />
                  )}

                  <input
                    type="number"
                    min="1"
                    placeholder="Cant."
                    value={item.quantity}
                    onChange={(e) => handleUpdateLine(idx, { quantity: Number(e.target.value) })}
                    className="erp-form-input"
                    style={{ fontSize: "12px", padding: "4px 6px", textAlign: "center" }}
                    required
                  />

                  <input
                    type="number"
                    min="0"
                    placeholder="Precio"
                    value={item.unitPrice}
                    onChange={(e) => handleUpdateLine(idx, { unitPrice: Number(e.target.value) })}
                    className="erp-form-input"
                    style={{ fontSize: "12px", padding: "4px 6px", textAlign: "right" }}
                    required
                  />

                  <span style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center" }}>
                    +21% IVA
                  </span>

                  <button
                    type="button"
                    onClick={() => handleRemoveLine(idx)}
                    disabled={lines.length === 1}
                    className="pag-btn"
                    style={{
                      padding: "4px",
                      color: "var(--rose-accent)",
                      opacity: lines.length === 1 ? 0.3 : 1,
                    }}
                    title="Quitar línea"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {/* Totals Summary */}
            <div
              style={{
                marginTop: "12px",
                padding: "10px 14px",
                background: "var(--canvas-bg)",
                borderRadius: "8px",
                display: "flex",
                justifyContent: "flex-end",
                gap: "24px",
                fontSize: "13px",
              }}
            >
              <div>
                <span style={{ color: "var(--text-muted)" }}>Subtotal: </span>
                <strong>{formatCurrency(computedTotals.subtotal, quoteCurrency)}</strong>
              </div>
              <div>
                <span style={{ color: "var(--text-muted)" }}>IVA: </span>
                <strong>{formatCurrency(computedTotals.tax, quoteCurrency)}</strong>
              </div>
              <div>
                <span style={{ color: "var(--text-muted)" }}>Total: </span>
                <strong style={{ color: "var(--brand-primary)", fontSize: "15px" }}>
                  {formatCurrency(computedTotals.total, quoteCurrency)}
                </strong>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", borderTop: "1px solid var(--border-line)", paddingTop: "12px" }}>
            <button
              type="button"
              className="pag-btn"
              onClick={() => setIsNewModalOpen(false)}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting}
            >
              {submitting ? "Guardando..." : "Guardar Presupuesto Formal"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
