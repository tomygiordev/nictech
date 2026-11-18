import { useState, useEffect, useMemo, useCallback, useId } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Field, FieldError, FormError } from "../../components/erp/FormFeedback";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { toUserMessage } from "../../lib/errors";
import { formatCurrency, formatDate } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";
import {
  QuoteOverview,
  listQuotes,
  createRepairQuote,
  issueRepairQuote,
  respondQuoteDecision,
  CreateQuoteInput,
} from "./api";
import {
  createQuoteSchema,
  emptyCreateQuote,
  emptyQuoteDecision,
  emptyQuoteLine,
  isZeroPrice,
  quoteDecisionSchema,
  type CreateQuoteFormValues,
  type QuoteDecisionFormInput,
  type QuoteDecisionFormValues,
  type QuoteLineFormValues,
} from "./schemas";

interface RepairOrderOption {
  id: string;
  order_code: string;
  customer_name: string;
  brand: string;
  model: string;
  status: string;
}

export const QuotesWorkspace = () => {
  const { hasPermission } = useErpAuth();
  const canManageQuotes = hasPermission("quotes.manage");

  const [quotes, setQuotes] = useState<QuoteOverview[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Detail Modal
  const [selectedQuote, setSelectedQuote] = useState<QuoteOverview | null>(null);

  // New Quote Modal
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [repairOrders, setRepairOrders] = useState<RepairOrderOption[]>([]);
  const [isLoadingQuotePrerequisites, setIsLoadingQuotePrerequisites] = useState(false);
  const [quotePrerequisitesError, setQuotePrerequisitesError] = useState<string | null>(null);

  // Decision Modal
  const [decisionModalQuote, setDecisionModalQuote] = useState<QuoteOverview | null>(null);
  const decisionGroupId = useId();
  const approvedRadioId = `${decisionGroupId}-approved`;
  const rejectedRadioId = `${decisionGroupId}-rejected`;
  const decisionErrorId = `${decisionGroupId}-error`;

  // Products for line selector
  const [availableProducts, setAvailableProducts] = useState<Array<{ id: string; internal_name: string; internal_code: string; item_kind: "product" | "service" }>>([]);

  const createForm = useForm<CreateQuoteFormValues>({
    resolver: zodResolver(createQuoteSchema),
    defaultValues: emptyCreateQuote(),
  });
  const { fields: lineFields, append: appendLine, remove: removeLine } = useFieldArray({
    control: createForm.control,
    name: "lines",
  });
  const watchedLines = createForm.watch("lines");
  const watchedCurrency = createForm.watch("currencyCode");
  const createErrors = createForm.formState.errors;
  const submittingQuote = createForm.formState.isSubmitting;

  const decisionForm = useForm<QuoteDecisionFormInput, unknown, QuoteDecisionFormValues>({
    resolver: zodResolver(quoteDecisionSchema),
    defaultValues: emptyQuoteDecision(),
  });
  const selectedDecision = decisionForm.watch("decision");
  const decisionErrors = decisionForm.formState.errors;
  const submittingDecision = decisionForm.formState.isSubmitting;

  const fetchQuotesData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listQuotes();
      setQuotes(data);
    } catch (err) {
      console.error("Error al cargar presupuestos:", err);
      setFeedback({
        type: "error",
        message: toUserMessage(err, "Error al conectar con la base de datos de presupuestos."),
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
    setIsLoadingQuotePrerequisites(true);
    setQuotePrerequisitesError(null);
    try {
      const [ordersRes, prodsRes] = await Promise.all([
        supabase
          .from("repair_orders_overview")
          .select("id, order_code, customer_name, brand:brand_snapshot, model:model_snapshot, status:status_name, status_is_terminal")
          .eq("status_is_terminal", false)
          .order("opened_at", { ascending: false }),
        supabase
          .from("products")
          .select("id, internal_name, internal_code, item_kind")
          .eq("is_active", true)
          .order("internal_name", { ascending: true }),
      ]);

      if (ordersRes.error) throw ordersRes.error;
      if (prodsRes.error) throw prodsRes.error;
      const ordersList: RepairOrderOption[] = (ordersRes.data ?? []).flatMap((order) => {
        if (!order.id || !order.order_code) return [];
        return [{
          id: order.id,
          order_code: order.order_code,
          customer_name: order.customer_name ?? "Cliente taller",
          brand: order.brand ?? "",
          model: order.model ?? "",
          status: order.status ?? "En taller",
        }];
      });
      setRepairOrders(ordersList);
      setAvailableProducts((prodsRes.data || []).filter((product) => product.item_kind === "product" || product.item_kind === "service"));
    } catch (e) {
      setQuotePrerequisitesError(toUserMessage(e, "No se pudieron cargar las órdenes y los productos."));
    } finally {
      setIsLoadingQuotePrerequisites(false);
    }
  }, []);

  useEffect(() => {
    if (isNewModalOpen) {
      void loadNewQuotePrerequisites();
    }
  }, [isNewModalOpen, loadNewQuotePrerequisites]);

  const openNewQuoteModal = () => {
    if (!canManageQuotes) return;
    createForm.reset(emptyCreateQuote());
    setIsNewModalOpen(true);
  };

  const closeNewQuoteModal = () => {
    if (!submittingQuote) setIsNewModalOpen(false);
  };

  const openDecisionModal = (quote: QuoteOverview) => {
    if (!canManageQuotes) return;
    decisionForm.reset(emptyQuoteDecision());
    setDecisionModalQuote(quote);
  };

  const closeDecisionModal = () => {
    if (!submittingDecision) setDecisionModalQuote(null);
  };

  const computedTotals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    watchedLines.forEach((l) => {
      const qty = Number(l.quantity);
      const price = Number(l.unitPrice);
      const validQty = Number.isFinite(qty) && qty > 0 ? qty : 0;
      const validPrice = Number.isFinite(price) && price >= 0 ? price : 0;
      const lineSub = validQty * validPrice;
      const lineTax = (lineSub * 21) / 100;
      subtotal += lineSub;
      tax += lineTax;
    });
    return {
      subtotal,
      tax,
      total: subtotal + tax,
    };
  }, [watchedLines]);

  const handleCreateQuote = async (values: CreateQuoteFormValues) => {
    if (!canManageQuotes) return;
    createForm.clearErrors("root.server");
    try {
      const input: CreateQuoteInput = {
        repairOrderId: values.repairOrderId,
        currencyCode: values.currencyCode,
        reason: values.reason,
        lines: values.lines.map((l) => {
          const selectedProduct = l.kind === "free_concept"
            ? undefined
            : availableProducts.find((p) => p.id === l.productId);
          const description = l.kind === "free_concept"
            ? l.description
            : l.description || (selectedProduct ? `${selectedProduct.internal_name} (${selectedProduct.internal_code})` : "");
          return {
            kind: l.kind,
            product_id: l.kind === "free_concept" ? undefined : l.productId,
            description,
            quantity: Number(l.quantity),
            unit_price: Number(l.unitPrice),
            unit_cost: l.kind === "product" ? 0 : Number(l.unitCost || 0),
            tax_rate_percent: 21,
          };
        }),
      };

      await createRepairQuote(input);
      setFeedback({
        type: "success",
        message: "¡Presupuesto versionado creado exitosamente en base de datos!",
      });
      setIsNewModalOpen(false);
      createForm.reset(emptyCreateQuote());
      await fetchQuotesData();
    } catch (err) {
      createForm.setError("root.server", {
        message: toUserMessage(err, "No se pudo guardar el presupuesto. Reintentá."),
      });
    }
  };

  // Issue Quote & Share WhatsApp (Finding H20)
  const handleIssueAndSendWhatsApp = async (q: QuoteOverview) => {
    if (!q.issued_at && !canManageQuotes) return;
    try {
      let token = "";
      if (!q.issued_at) {
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

      const statusIntro = isApproved
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
      setFeedback({
        type: "error",
        message: toUserMessage(err, "No se pudo emitir o compartir el presupuesto."),
      });
    }
  };

  // Submit Client Decision (Finding H06)
  const handleSubmitDecision = async (values: QuoteDecisionFormValues) => {
    if (!decisionModalQuote || !canManageQuotes) return;
    decisionForm.clearErrors("root.server");

    try {
      await respondQuoteDecision(decisionModalQuote.id, values.decision, values.notes || undefined);
      setFeedback({
        type: "success",
        message: `Decisión "${values.decision === "approved" ? "Aprobado" : "Rechazado"}" registrada exitosamente para la orden ${decisionModalQuote.order_code} v${decisionModalQuote.version}.`,
      });
      if (selectedQuote?.id === decisionModalQuote.id) {
        setSelectedQuote(null);
      }
      setDecisionModalQuote(null);
      decisionForm.reset(emptyQuoteDecision());
      await fetchQuotesData();
    } catch (err) {
      decisionForm.setError("root.server", {
        message: toUserMessage(err, "No se pudo registrar la decisión del cliente. Reintentá."),
      });
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
  const totalPresupuestadoArs = useMemo(() => {
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
        title="Presupuestos comerciales"
        description="Presupuestos técnicos versionados vinculados a órdenes de servicio, líneas detalladas de repuestos y mano de obra, emisión trazable y registro formal de respuesta del cliente."
        badge={`${quotes.length} Presupuestos registrados`}
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
          label="Total presupuestado ARS"
          value={formatCurrency(totalPresupuestadoArs, "ARS")}
          trend={{ text: "Presupuestado", positive: true }}
          sublabel="Valor total de propuestas vigentes"
        />

        <KpiCard
          icon={CheckCircle}
          iconVariant="navy"
          label="Presupuestos aprobados"
          value={approvedCount}
          trend={{ text: "Confirmados", positive: true }}
          sublabel="Aprobados formalmente por el cliente"
        />

        <KpiCard
          icon={TrendingUp}
          iconVariant="steel"
          label="Tasa de cierre"
          value={rateConversion}
          trend={{ text: "Conversión", positive: true }}
          sublabel="Aprobados sobre total de presupuestos"
        />
      </div>

      {/* Main Table Card */}
      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Listado de presupuestos formales</h2>
            <p className="flow-card__subtitle">Historial de versiones, estado de validez y decisiones del cliente</p>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <div className="flow-search-pill" style={{ width: "260px" }}>
              <Search size={15} aria-hidden="true" />
              <input
                type="text"
                placeholder="Buscar por orden, cliente..."
                aria-label="Buscar presupuestos por orden o cliente"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button
              type="button"
              className="pag-btn"
              onClick={() => void fetchQuotesData()}
              title="Recargar datos"
              aria-label="Recargar datos"
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} aria-hidden="true" />
            </button>

            <button
              type="button"
              className="btn-primary"
              onClick={openNewQuoteModal}
              disabled={!canManageQuotes}
              title={!canManageQuotes ? "Necesitás permiso para gestionar presupuestos." : undefined}
            >
              <Plus size={16} aria-hidden="true" /> Nuevo presupuesto
            </button>
          </div>
        </div>

        <div style={{ padding: "12px 16px", background: "var(--bg-app)", borderBottom: "1px solid var(--border-line)", display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-muted)" }}>
          <Receipt size={15} style={{ color: "var(--brand-primary)", flexShrink: 0 }} aria-hidden="true" />
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
                <th>Estado comercial</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    Cargando presupuestos desde la base de datos central...
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
                  const cannotIssueDraft = !q.issued_at && !canManageQuotes;
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
                            <Check size={11} aria-hidden="true" /> Aprobado
                          </span>
                        ) : q.decision === "rejected" ? (
                          <span className="flow-status-pill failed" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <XCircle size={11} aria-hidden="true" /> Rechazado
                          </span>
                        ) : isExpired ? (
                          <span className="flow-status-pill cancelled" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <Clock size={11} aria-hidden="true" /> Vencido
                          </span>
                        ) : q.issued_at ? (
                          <span className="flow-status-pill confirmed" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <Clock size={11} aria-hidden="true" /> Emitido / Pendiente
                          </span>
                        ) : (
                          <span className="flow-status-pill pending" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <FileText size={11} aria-hidden="true" /> Borrador
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
                            <Eye size={12} aria-hidden="true" /> Ver
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
                            disabled={cannotIssueDraft}
                            title={
                              cannotIssueDraft
                                ? "Necesitás permiso para emitir presupuestos."
                                : q.issued_at
                                ? "Compartir por WhatsApp"
                                : "Emitir y enviar por WhatsApp"
                            }
                          >
                            <Send size={12} aria-hidden="true" /> {q.issued_at ? "WhatsApp" : "Emitir"}
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
                              onClick={() => openDecisionModal(q)}
                              disabled={!canManageQuotes}
                              title={
                                !canManageQuotes
                                  ? "Necesitás permiso para registrar decisiones de presupuestos."
                                  : "Registrar decisión del cliente"
                              }
                            >
                              <Check size={12} aria-hidden="true" /> Decisión
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
          scrollBody
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Status overview bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-subtle)", padding: "12px 16px", borderRadius: "8px" }}>
              <div>
                <span className="stat-label">Estado de decisión</span>
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
                <span className="stat-label">Total presupuestado</span>
                <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--brand-primary)", marginTop: "2px" }}>
                  {formatCurrency(selectedQuote.total_amount, selectedQuote.currency_code as "ARS" | "USD")}
                </div>
              </div>
            </div>

            {/* Lines Table */}
            <div>
              <h4 style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 600 }}>Líneas del presupuesto</h4>
              <div className="flow-table-wrapper">
                <table className="flow-table" style={{ fontSize: "12px" }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Tipo</th>
                      <th>Descripción</th>
                      <th>Cant.</th>
                      <th>Precio unit.</th>
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
                            {l.kind === "product" ? "Repuesto" : l.kind === "service" ? "Mano de obra" : "Concepto"}
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
                      <td colSpan={6} style={{ textAlign: "right", fontWeight: 700, fontSize: "14px" }}>Total general:</td>
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
                  disabled={!selectedQuote.issued_at && !canManageQuotes}
                  title={
                    !selectedQuote.issued_at && !canManageQuotes
                      ? "Necesitás permiso para emitir presupuestos."
                      : "Compartir por WhatsApp"
                  }
                >
                  <Send size={14} aria-hidden="true" /> Compartir por WhatsApp
                </button>

                {!selectedQuote.decision && (
                  <button
                    type="button"
                    className="pag-btn"
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--emerald-success)" }}
                    onClick={() => openDecisionModal(selectedQuote)}
                    disabled={!canManageQuotes}
                    title={
                      !canManageQuotes
                        ? "Necesitás permiso para registrar decisiones de presupuestos."
                        : "Registrar decisión del cliente"
                    }
                  >
                    <Check size={14} aria-hidden="true" /> Registrar decisión
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

      {/* Modal: Registrar Decisión del Cliente */}
      {decisionModalQuote && (
        <Modal
          isOpen={Boolean(decisionModalQuote)}
          onClose={closeDecisionModal}
          title="Registrar decisión del cliente"
          subtitle={`Orden: ${decisionModalQuote.order_code} • Versión ${decisionModalQuote.version} (${formatCurrency(decisionModalQuote.total_amount, decisionModalQuote.currency_code as "ARS" | "USD")})`}
          icon={CheckCircle}
          maxWidth="480px"
          scrollBody
        >
          <form
            onSubmit={decisionForm.handleSubmit(handleSubmitDecision, () => decisionForm.clearErrors("root.server"))}
            noValidate
            style={{ display: "flex", flexDirection: "column", gap: "14px" }}
          >
            <FormError message={decisionErrors.root?.server?.message ?? null} />
            <fieldset disabled={submittingDecision} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: "14px" }}>
              <fieldset
                style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}
                aria-describedby={decisionErrors.decision?.message ? decisionErrorId : undefined}
              >
                <legend className="erp-form-label">Resultado de la decisión (obligatorio)</legend>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <label
                    htmlFor={approvedRadioId}
                    className={`pag-btn ${selectedDecision === "approved" ? "active-filter" : ""}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      padding: "10px",
                      fontWeight: 600,
                      cursor: "pointer",
                      borderColor: selectedDecision === "approved" ? "var(--emerald-success)" : "var(--border-line)",
                      color: selectedDecision === "approved" ? "var(--emerald-success)" : "var(--text-main)",
                    }}
                  >
                    <input
                      id={approvedRadioId}
                      type="radio"
                      value="approved"
                      {...decisionForm.register("decision")}
                      style={{ accentColor: "var(--emerald-success)" }}
                    />
                    <Check size={16} aria-hidden="true" /> Aprobado
                  </label>
                  <label
                    htmlFor={rejectedRadioId}
                    className={`pag-btn ${selectedDecision === "rejected" ? "active-filter" : ""}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      padding: "10px",
                      fontWeight: 600,
                      cursor: "pointer",
                      borderColor: selectedDecision === "rejected" ? "var(--rose-accent)" : "var(--border-line)",
                      color: selectedDecision === "rejected" ? "var(--rose-accent)" : "var(--text-main)",
                    }}
                  >
                    <input
                      id={rejectedRadioId}
                      type="radio"
                      value="rejected"
                      {...decisionForm.register("decision")}
                      style={{ accentColor: "var(--rose-accent)" }}
                    />
                    <XCircle size={16} aria-hidden="true" /> Rechazado
                  </label>
                </div>
                {decisionErrors.decision?.message && (
                  <FieldError id={decisionErrorId} message={decisionErrors.decision.message} />
                )}
              </fieldset>

              <Field label="Mensaje o notas del cliente (opcional)" error={decisionErrors.notes?.message}>
                {(a11y) => (
                  <textarea
                    {...a11y}
                    rows={3}
                    placeholder="Ej: Cliente autorizó por llamada telefónica / Rechazado por presupuesto excedido..."
                    className="erp-form-textarea"
                    {...decisionForm.register("notes")}
                  />
                )}
              </Field>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", borderTop: "1px solid var(--border-line)", paddingTop: "12px" }}>
                <button
                  type="button"
                  className="pag-btn"
                  onClick={closeDecisionModal}
                  disabled={submittingDecision}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={submittingDecision}
                >
                  {submittingDecision ? "Registrando..." : "Confirmar decisión"}
                </button>
              </div>
            </fieldset>
          </form>
        </Modal>
      )}

      {/* Modal: Nuevo Presupuesto */}
      <Modal
        isOpen={isNewModalOpen}
        onClose={closeNewQuoteModal}
        title="Nuevo presupuesto"
        subtitle="Presupuesto formal vinculado a una orden de taller con líneas de repuestos y servicios"
        icon={Receipt}
        maxWidth="900px"
        scrollBody
      >
        <form
          onSubmit={createForm.handleSubmit(handleCreateQuote, () => createForm.clearErrors("root.server"))}
          noValidate
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          <FormError message={createErrors.root?.server?.message ?? null} />
          <fieldset disabled={submittingQuote} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "12px" }}>
              <Field label="Orden de reparación" required error={createErrors.repairOrderId?.message}>
                {(a11y) => (
                  <>
                    <select
                      {...a11y}
                      className="erp-form-select"
                      disabled={isLoadingQuotePrerequisites || Boolean(quotePrerequisitesError) || repairOrders.length === 0}
                      required
                      {...createForm.register("repairOrderId")}
                    >
                      <option value="">
                        {isLoadingQuotePrerequisites ? "Cargando órdenes abiertas…" : "Seleccionar orden abierta…"}
                      </option>
                      {repairOrders.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.order_code} — {o.customer_name} ({o.brand} {o.model})
                        </option>
                      ))}
                    </select>
                    {isLoadingQuotePrerequisites && (
                      <span role="status" style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                        Consultando órdenes que siguen abiertas…
                      </span>
                    )}
                    {!isLoadingQuotePrerequisites && quotePrerequisitesError && (
                      <div role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", color: "var(--rose-accent)", fontSize: "12px" }}>
                        <span>No se pudo consultar la lista de órdenes. {quotePrerequisitesError}</span>
                        <button type="button" className="pag-btn" onClick={() => void loadNewQuotePrerequisites()}>Reintentar</button>
                      </div>
                    )}
                    {!isLoadingQuotePrerequisites && !quotePrerequisitesError && repairOrders.length === 0 && (
                      <div role="status" style={{ padding: "10px 12px", border: "1px solid var(--border-line)", borderRadius: "8px", background: "var(--surface-subtle)", fontSize: "12px", color: "var(--text-muted)" }}>
                        <strong style={{ display: "block", marginBottom: "3px", color: "var(--text-main)" }}>No hay órdenes abiertas elegibles</strong>
                        <span>Las órdenes cerradas o finalizadas no aparecen en esta lista. Abrí una orden desde Taller y volvé a crear el presupuesto.</span>
                      </div>
                    )}
                  </>
                )}
              </Field>

              <Field label="Moneda del presupuesto" required error={createErrors.currencyCode?.message}>
                {(a11y) => (
                  <select
                    {...a11y}
                    className="erp-form-select"
                    required
                    {...createForm.register("currencyCode")}
                  >
                    <option value="ARS">ARS ($)</option>
                    <option value="USD">USD (Dólares)</option>
                  </select>
                )}
              </Field>
            </div>

            <Field label="Motivo o razón de emisión" required error={createErrors.reason?.message}>
              {(a11y) => (
                <input
                  {...a11y}
                  type="text"
                  className="erp-form-input"
                  placeholder="Ej: Presupuesto inicial tras diagnóstico de placa"
                  required
                  {...createForm.register("reason")}
                />
              )}
            </Field>

            {/* Lines Editor */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                <strong style={{ fontSize: "13px" }}>Líneas de repuestos, servicios y conceptos</strong>
                <button
                  type="button"
                  className="pag-btn"
                  style={{ fontSize: "12px", padding: "5px 10px" }}
                  onClick={() => appendLine(emptyQuoteLine())}
                >
                  <Plus size={13} aria-hidden="true" /> Agregar ítem
                </button>
              </div>

              {createErrors.lines?.root?.message && (
                <FieldError id="quote-lines-root-error" message={createErrors.lines.root.message} />
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {lineFields.map((field, index) => {
                  const line = watchedLines[index] ?? field;
                  const lineErrors = createErrors.lines?.[index];
                  const resetZeroPrice = () => createForm.setValue(`lines.${index}.confirmZeroPrice`, false);
                  const rowGridStyle = {
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))",
                    gap: "10px",
                  };

                  return (
                    <fieldset
                      key={field.id}
                      style={{
                        minWidth: 0,
                        display: "grid",
                        gap: "10px",
                        padding: "12px",
                        borderRadius: "8px",
                        border: "1px solid var(--border-line)",
                        background: "var(--surface-subtle)",
                      }}
                    >
                      <legend style={{ paddingInline: "4px", fontSize: "13px", fontWeight: 600 }}>Línea {index + 1}</legend>

                      <div style={rowGridStyle}>
                        <Field label="Tipo" error={lineErrors?.kind?.message}>
                          {(a11y) => (
                            <select
                              {...a11y}
                              className="erp-form-select"
                              {...createForm.register(`lines.${index}.kind`, {
                                onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                                  const nextKind = e.target.value as QuoteLineFormValues["kind"];
                                  createForm.setValue(`lines.${index}.productId`, "");
                                  createForm.setValue(`lines.${index}.description`, "");
                                  if (nextKind === "product") {
                                    createForm.setValue(`lines.${index}.unitCost`, "");
                                  }
                                },
                              })}
                            >
                              <option value="service">Mano de obra</option>
                              <option value="product">Repuesto</option>
                              <option value="free_concept">Concepto</option>
                            </select>
                          )}
                        </Field>

                        {(line.kind === "product" || line.kind === "service") ? (
                          <Field
                            label={line.kind === "service" ? "Servicio" : "Repuesto"}
                            required
                            error={lineErrors?.productId?.message}
                          >
                            {(a11y) => (
                              <select
                                {...a11y}
                                className="erp-form-select"
                                required
                                {...createForm.register(`lines.${index}.productId`, {
                                  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                                    const found = availableProducts.find((p) => p.id === e.target.value);
                                    createForm.setValue(
                                      `lines.${index}.description`,
                                      found ? `${found.internal_name} (${found.internal_code})` : "",
                                    );
                                  },
                                })}
                              >
                                <option value="">
                                  {line.kind === "service" ? "-- Seleccionar servicio --" : "-- Seleccionar repuesto --"}
                                </option>
                                {availableProducts.filter((p) => p.item_kind === line.kind).map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.internal_name} ({p.internal_code})
                                  </option>
                                ))}
                              </select>
                            )}
                          </Field>
                        ) : (
                          <Field label="Descripción" required error={lineErrors?.description?.message}>
                            {(a11y) => (
                              <input
                                {...a11y}
                                type="text"
                                placeholder="Descripción del trabajo..."
                                className="erp-form-input"
                                required
                                {...createForm.register(`lines.${index}.description`)}
                              />
                            )}
                          </Field>
                        )}
                      </div>

                      <div style={rowGridStyle}>
                        <Field label="Cantidad" required error={lineErrors?.quantity?.message}>
                          {(a11y) => (
                            <input
                              {...a11y}
                              type="number"
                              min="1"
                              step="any"
                              placeholder="Ej: 1"
                              className="erp-form-input"
                              required
                              {...createForm.register(`lines.${index}.quantity`)}
                            />
                          )}
                        </Field>

                        {line.kind === "product" ? (
                          <div className="erp-form-group">
                            <span className="erp-form-label">Costo unitario</span>
                            <span style={{ fontSize: "12px", color: "var(--text-muted)", paddingTop: "8px" }}>
                              Costo ERP automático
                            </span>
                          </div>
                        ) : (
                          <Field label="Costo unitario" error={lineErrors?.unitCost?.message}>
                            {(a11y) => (
                              <input
                                {...a11y}
                                type="number"
                                min="0"
                                step="any"
                                placeholder="0"
                                className="erp-form-input"
                                {...createForm.register(`lines.${index}.unitCost`)}
                              />
                            )}
                          </Field>
                        )}

                        <Field label="Precio unitario" required error={lineErrors?.unitPrice?.message}>
                          {(a11y) => (
                            <input
                              {...a11y}
                              type="number"
                              min="0"
                              step="any"
                              placeholder="0"
                              className="erp-form-input"
                              required
                              {...createForm.register(`lines.${index}.unitPrice`, { onChange: resetZeroPrice })}
                            />
                          )}
                        </Field>

                        <div className="erp-form-group">
                          <span className="erp-form-label">IVA</span>
                          <span style={{ fontSize: "12px", color: "var(--text-muted)", paddingTop: "8px" }}>
                            +21% IVA
                          </span>
                        </div>
                      </div>

                      {isZeroPrice(line.unitPrice) && (
                        <Field
                          label="Confirmo el precio de $0 para esta línea"
                          required
                          error={lineErrors?.confirmZeroPrice?.message}
                        >
                          {(a11y) => (
                            <input
                              {...a11y}
                              type="checkbox"
                              required
                              {...createForm.register(`lines.${index}.confirmZeroPrice`)}
                            />
                          )}
                        </Field>
                      )}

                      {lineFields.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="pag-btn"
                          style={{ justifySelf: "start", color: "var(--rose-accent)" }}
                        >
                          Quitar línea {index + 1}
                        </button>
                      )}
                    </fieldset>
                  );
                })}
              </div>

              {/* Totals Summary */}
              <div
                style={{
                  marginTop: "4px",
                  padding: "10px 14px",
                  background: "var(--canvas-bg)",
                  borderRadius: "8px",
                  display: "flex",
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                  gap: "24px",
                  fontSize: "13px",
                }}
              >
                <div>
                  <span style={{ color: "var(--text-muted)" }}>Subtotal: </span>
                  <strong>{formatCurrency(computedTotals.subtotal, watchedCurrency)}</strong>
                </div>
                <div>
                  <span style={{ color: "var(--text-muted)" }}>IVA: </span>
                  <strong>{formatCurrency(computedTotals.tax, watchedCurrency)}</strong>
                </div>
                <div>
                  <span style={{ color: "var(--text-muted)" }}>Total: </span>
                  <strong style={{ color: "var(--brand-primary)", fontSize: "15px" }}>
                    {formatCurrency(computedTotals.total, watchedCurrency)}
                  </strong>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", borderTop: "1px solid var(--border-line)", paddingTop: "12px" }}>
              <button
                type="button"
                className="pag-btn"
                onClick={closeNewQuoteModal}
                disabled={submittingQuote}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={submittingQuote || isLoadingQuotePrerequisites}
              >
                {submittingQuote ? "Guardando..." : "Guardar presupuesto formal"}
              </button>
            </div>
          </fieldset>
        </form>
      </Modal>
    </div>
  );
};
