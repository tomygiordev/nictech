import { useEffect, useMemo, useState } from "react";
import { Smartphone, Search, Eye, Plus, ShieldCheck, RefreshCw, DollarSign } from "lucide-react";
import { WorkspaceHeader, Modal, FeedbackAlert, KpiCard } from "../../components/erp/WorkspaceUi";
import { formatCurrency, formatDateTime } from "../../lib/formatters";
import {
  listTradeIns,
  intakeTradeInDirect,
  reviewTradeInProvenance,
  requestTradeInImeiCheck,
  recordTradeInImeiManualFallback,
  createTradeInEvaluation,
  reviewTradeInEvaluation,
  recordTradeInRefurbishment,
  releaseTradeInToStock,
  applyTradeInSalePayment,
  reverseTradeInSalePayment,
  getTradeInCosts,
  isTradeInRejected,
  isImeiVerified,
  type TradeInOverview,
  type ImeiManualFallbackStatus,
} from "./api";

const STAGE_MAP: Record<string, { label: string; pillClass: string }> = {
  quarantine: { label: "En Cuarentena", pillClass: "flow-status-pill pending" },
  evaluating: { label: "En Evaluación", pillClass: "flow-status-pill processing" },
  ready_for_stock: { label: "Listo para Stock", pillClass: "flow-status-pill confirmed" },
  applied_to_sale: { label: "Aplicado a Venta", pillClass: "flow-status-pill completed" },
  rejected: { label: "Rechazado", pillClass: "flow-status-pill cancelled" },
};

const IMEI_LABELS: Record<string, string> = {
  clear: "Limpio",
  blocked: "Bloqueado",
  checking: "Verificando",
  unavailable: "No disponible",
  error: "Error",
  not_required: "No requerido",
};

const IMEI_REGEX = /^[0-9]{14,16}$/;

interface Feedback {
  type: "success" | "error" | "info";
  message: string;
}

const stageOf = (t: TradeInOverview): string => (isTradeInRejected(t) ? "rejected" : t.stage);

export const TradeInsWorkspace = () => {
  const [items, setItems] = useState<TradeInOverview[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);

  // Formulario de recepción
  const [branchId, setBranchId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [deviceSerial, setDeviceSerial] = useState("");
  const [deviceImei, setDeviceImei] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [declarationText, setDeclarationText] = useState("");
  const [declaredValue, setDeclaredValue] = useState("");
  const [evidenceDoc, setEvidenceDoc] = useState("");
  const [intakeReason, setIntakeReason] = useState("");

  // Campos de acciones sobre el detalle
  const [reason, setReason] = useState("");
  const [providerName, setProviderName] = useState("");
  const [fallbackStatus, setFallbackStatus] = useState<ImeiManualFallbackStatus>("clear");
  const [fallbackDoc, setFallbackDoc] = useState("");
  const [conditionNotes, setConditionNotes] = useState("");
  const [batteryHealth, setBatteryHealth] = useState("");
  const [appraisedValue, setAppraisedValue] = useState("");
  const [refurbEstimate, setRefurbEstimate] = useState("");
  const [refurbDesc, setRefurbDesc] = useState("");
  const [refurbCost, setRefurbCost] = useState("");
  const [repairOrderId, setRepairOrderId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [saleId, setSaleId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [costsResult, setCostsResult] = useState<string | null>(null);

  const loadTradeIns = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTradeIns();
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los canjes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTradeIns();
  }, []);

  const selectedItem = useMemo(
    () => items.find((t) => t.id === selectedId) ?? null,
    [items, selectedId]
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (activeFilter !== "all" && stageOf(item) !== activeFilter) return false;
      if (!q) return true;
      const haystack = [
        item.customer_name ?? "",
        item.customer_code ?? "",
        item.product_name ?? "",
        item.product_code ?? "",
        item.variant_name ?? "",
        item.imei ?? "",
        item.serial_number ?? "",
        item.id,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, activeFilter, search]);

  const totalValuado = useMemo(
    () => items.reduce((acc, t) => acc + (t.appraised_value_base ?? t.declared_value_base ?? 0), 0),
    [items]
  );
  const imeiVerificados = useMemo(() => items.filter((t) => t.imei_status === "clear").length, [items]);
  const liberados = useMemo(() => items.filter((t) => t.release_id !== null).length, [items]);
  const enRevision = useMemo(
    () => items.filter((t) => t.stage === "quarantine" || t.stage === "evaluating").length,
    [items]
  );

  const runAction = async (fn: () => Promise<unknown>, successMessage: string) => {
    if (actionBusy) return;
    setActionBusy(true);
    setFeedback(null);
    try {
      await fn();
      await loadTradeIns();
      setFeedback({ type: "success", message: successMessage });
    } catch (e) {
      setFeedback({ type: "error", message: e instanceof Error ? e.message : "La operación no pudo completarse." });
    } finally {
      setActionBusy(false);
    }
  };

  const resetIntakeForm = () => {
    setBranchId("");
    setCustomerId("");
    setProductId("");
    setVariantId("");
    setDeviceSerial("");
    setDeviceImei("");
    setOwnerName("");
    setDeclarationText("");
    setDeclaredValue("");
    setEvidenceDoc("");
    setIntakeReason("");
  };

  const handleIntake = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId.trim() || !customerId.trim() || !productId.trim()) {
      setFeedback({ type: "error", message: "Sucursal, cliente y producto son obligatorios." });
      return;
    }
    if (!ownerName.trim() || !declarationText.trim()) {
      setFeedback({ type: "error", message: "El nombre del titular y la declaración de procedencia son obligatorios." });
      return;
    }
    const value = Number(declaredValue);
    if (!declaredValue.trim() || Number.isNaN(value) || value <= 0) {
      setFeedback({ type: "error", message: "El valor declarado debe ser un número mayor a cero." });
      return;
    }
    const imei = deviceImei.trim();
    if (imei !== "" && !IMEI_REGEX.test(imei)) {
      setFeedback({ type: "error", message: "El IMEI debe contener entre 14 y 16 dígitos numéricos." });
      return;
    }
    await runAction(
      () =>
        intakeTradeInDirect({
          branchId: branchId.trim(),
          customerId: customerId.trim(),
          productId: productId.trim(),
          variantId: variantId.trim() === "" ? null : variantId.trim(),
          deviceSerial: deviceSerial.trim() === "" ? null : deviceSerial.trim(),
          deviceImei: imei === "" ? null : imei,
          ownerName: ownerName.trim(),
          declarationText: declarationText.trim(),
          declaredValue: value,
          evidenceDoc: evidenceDoc.trim() === "" ? null : evidenceDoc.trim(),
          operationReason: intakeReason.trim() === "" ? undefined : intakeReason.trim(),
        }),
      "Equipo recibido en canje correctamente."
    );
    setIsModalOpen(false);
    resetIntakeForm();
  };

  const parseDocJson = (raw: string): Record<string, string | number | boolean | null> | null => {
    if (raw.trim() === "") return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
      return parsed as Record<string, string | number | boolean | null>;
    } catch {
      return null;
    }
  };

  const handleProvenance = (decision: "approved" | "rejected") => {
    if (!selectedItem) return;
    if (selectedItem.provenance_decision !== null) {
      setFeedback({ type: "error", message: "La procedencia de este canje ya fue revisada." });
      return;
    }
    void runAction(
      () => reviewTradeInProvenance(selectedItem.id, decision, reason.trim() === "" ? undefined : reason.trim()),
      decision === "approved" ? "Procedencia aprobada." : "Procedencia rechazada."
    );
  };

  const handleImeiCheck = () => {
    if (!selectedItem) return;
    if (selectedItem.provenance_decision !== "approved") {
      setFeedback({ type: "error", message: "Primero debe aprobarse la procedencia del equipo." });
      return;
    }
    if (!providerName.trim()) {
      setFeedback({ type: "error", message: "Indicá el proveedor de verificación IMEI." });
      return;
    }
    void runAction(
      () => requestTradeInImeiCheck(selectedItem.id, providerName.trim(), reason.trim() === "" ? undefined : reason.trim()),
      "Verificación IMEI solicitada."
    );
  };

  const handleImeiFallback = () => {
    if (!selectedItem) return;
    if (selectedItem.provenance_decision !== "approved") {
      setFeedback({ type: "error", message: "Primero debe aprobarse la procedencia del equipo." });
      return;
    }
    const doc = parseDocJson(fallbackDoc);
    if (!doc || Object.keys(doc).length === 0) {
      setFeedback({ type: "error", message: "La documentación debe ser un objeto JSON no vacío." });
      return;
    }
    void runAction(
      () =>
        recordTradeInImeiManualFallback(
          selectedItem.id,
          fallbackStatus,
          doc,
          reason.trim() === "" ? undefined : reason.trim()
        ),
      "Respaldo manual de IMEI registrado."
    );
  };

  const handleCreateEvaluation = () => {
    if (!selectedItem) return;
    if (!isImeiVerified(selectedItem)) {
      setFeedback({ type: "error", message: "El IMEI debe estar verificado antes de tasar el equipo." });
      return;
    }
    const appraised = Number(appraisedValue);
    const refurb = Number(refurbEstimate);
    if (Number.isNaN(appraised) || appraised <= 0) {
      setFeedback({ type: "error", message: "El valor tasado debe ser mayor a cero." });
      return;
    }
    if (Number.isNaN(refurb) || refurb < 0) {
      setFeedback({ type: "error", message: "El costo estimado de reacondicionamiento no puede ser negativo." });
      return;
    }
    const battery = batteryHealth.trim() === "" ? null : Number(batteryHealth.trim());
    if (battery !== null && (Number.isNaN(battery) || battery < 1 || battery > 100)) {
      setFeedback({ type: "error", message: "La salud de batería debe estar entre 1 y 100." });
      return;
    }
    const snapshot: Record<string, string | number | boolean | null> = {
      notes: conditionNotes.trim() === "" ? null : conditionNotes.trim(),
      battery_health: battery,
    };
    void runAction(
      () =>
        createTradeInEvaluation(
          selectedItem.id,
          snapshot,
          appraised,
          refurb,
          reason.trim() === "" ? undefined : reason.trim()
        ),
      "Tasación del equipo registrada."
    );
  };

  const handleReviewEvaluation = (decision: "approved" | "rejected") => {
    if (!selectedItem) return;
    if (!selectedItem.evaluation_id) {
      setFeedback({ type: "error", message: "Este canje aún no tiene tasación para revisar." });
      return;
    }
    if (selectedItem.evaluation_decision !== null) {
      setFeedback({ type: "error", message: "La tasación ya fue revisada." });
      return;
    }
    void runAction(
      () =>
        reviewTradeInEvaluation(
          selectedItem.evaluation_id as string,
          decision,
          reason.trim() === "" ? undefined : reason.trim()
        ),
      decision === "approved" ? "Tasación aprobada." : "Tasación rechazada."
    );
  };

  const handleRefurbishment = () => {
    if (!selectedItem) return;
    if (selectedItem.evaluation_decision !== "approved") {
      setFeedback({ type: "error", message: "La tasación debe estar aprobada antes de registrar el reacondicionamiento." });
      return;
    }
    if (!refurbDesc.trim()) {
      setFeedback({ type: "error", message: "Describí el trabajo de reacondicionamiento." });
      return;
    }
    const cost = Number(refurbCost);
    if (Number.isNaN(cost) || cost < 0) {
      setFeedback({ type: "error", message: "El costo real no puede ser negativo." });
      return;
    }
    void runAction(
      () =>
        recordTradeInRefurbishment(
          selectedItem.id,
          refurbDesc.trim(),
          cost,
          repairOrderId.trim() === "" ? null : repairOrderId.trim(),
          true,
          reason.trim() === "" ? undefined : reason.trim()
        ),
      "Reacondicionamiento registrado."
    );
  };

  const handleRelease = () => {
    if (!selectedItem) return;
    if (selectedItem.provenance_decision !== "approved") {
      setFeedback({ type: "error", message: "La procedencia debe estar aprobada para liberar a stock." });
      return;
    }
    if (selectedItem.evaluation_decision !== "approved") {
      setFeedback({ type: "error", message: "La tasación debe estar aprobada para liberar a stock." });
      return;
    }
    if (!isImeiVerified(selectedItem)) {
      setFeedback({ type: "error", message: "El IMEI debe estar verificado para liberar a stock." });
      return;
    }
    if (!locationId.trim()) {
      setFeedback({ type: "error", message: "Indicá el depósito de destino." });
      return;
    }
    void runAction(
      () => releaseTradeInToStock(selectedItem.id, locationId.trim(), reason.trim() === "" ? undefined : reason.trim()),
      "Equipo liberado a stock."
    );
  };

  const handleApplyPayment = () => {
    if (!selectedItem) return;
    if (!selectedItem.release_id) {
      setFeedback({ type: "error", message: "El equipo debe liberarse a stock antes de aplicarlo a una venta." });
      return;
    }
    if (!saleId.trim()) {
      setFeedback({ type: "error", message: "Indicá la venta destino." });
      return;
    }
    const amount = Number(paymentAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      setFeedback({ type: "error", message: "El monto del pago debe ser mayor a cero." });
      return;
    }
    void runAction(
      () =>
        applyTradeInSalePayment(
          selectedItem.id,
          saleId.trim(),
          amount,
          reason.trim() === "" ? undefined : reason.trim()
        ),
      "Canje aplicado como pago de la venta."
    );
  };

  const handleReversePayment = () => {
    if (!selectedItem) return;
    if (!selectedItem.payment_id) {
      setFeedback({ type: "error", message: "Este canje no tiene pagos aplicados para revertir." });
      return;
    }
    void runAction(
      () => reverseTradeInSalePayment(selectedItem.payment_id as string, reason.trim() === "" ? undefined : reason.trim()),
      "Pago aplicado revertido."
    );
  };

  const handleCosts = () => {
    if (!selectedItem) return;
    setCostsResult(null);
    void runAction(async () => {
      const data = await getTradeInCosts(selectedItem.id);
      setCostsResult(JSON.stringify(data, null, 2));
    }, "Costos del canje consultados.");
  };

  const shortId = (id: string) => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Equipos Usados & Canjes en Parte de Pago (Trade-in)"
        description="Recepción de usados, revisión de procedencia, verificación IMEI, tasación, liberación a stock y aplicación a ventas."
        badge={`${items.length} Canjes Registrados`}
      />

      {feedback && (
        <FeedbackAlert type={feedback.type} message={feedback.message} onClose={() => setFeedback(null)} />
      )}

      {error && (
        <FeedbackAlert
          type="error"
          message="No se pudieron cargar los canjes."
          submessage={error}
          action={
            <button type="button" className="pag-btn" onClick={() => void loadTradeIns()}>
              Reintentar
            </button>
          }
        />
      )}

      <div className="kpi-grid">
        <KpiCard
          icon={Smartphone}
          iconVariant="green"
          label="Equipos Recibidos"
          value={items.length}
          trend={{ text: "Canjes", positive: true }}
          sublabel={`${enRevision} en revisión`}
        />
        <KpiCard
          icon={DollarSign}
          iconVariant="navy"
          label="Valuación Total"
          value={formatCurrency(totalValuado, "ARS")}
          trend={{ text: "Tasado o declarado", positive: true }}
          sublabel="Crédito a favor de clientes"
        />
        <KpiCard
          icon={ShieldCheck}
          iconVariant="steel"
          label="Verificación IMEI"
          value={`${imeiVerificados} Verificados`}
          trend={{ text: "Control IMEI", positive: true }}
          sublabel="Estado clear según backend"
        />
        <KpiCard
          icon={RefreshCw}
          iconVariant="dark"
          label="Liberados a Stock"
          value={liberados}
          trend={{ text: "Stock Usados", positive: true }}
          sublabel="Garantía 90 días"
        />
      </div>

      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Registro de Equipos en Parte de Pago</h2>
            <p className="flow-card__subtitle">Trazabilidad de origen, verificación IMEI y tasación técnica</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div className="flow-search-pill" style={{ width: "260px" }}>
              <Search size={15} />
              <input
                type="text"
                placeholder="Buscar por cliente, producto, IMEI o serie..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button type="button" className="btn-primary" onClick={() => setIsModalOpen(true)}>
              <Plus size={16} />
              Recibir Equipo Usado
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", overflowX: "auto" }}>
          {[
            { id: "all", label: "Todos los Canjes" },
            { id: "quarantine", label: "En Cuarentena" },
            { id: "evaluating", label: "En Evaluación" },
            { id: "ready_for_stock", label: "Listos para Stock" },
            { id: "applied_to_sale", label: "Aplicados a Venta" },
            { id: "rejected", label: "Rechazados" },
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
                <th>ID</th>
                <th>Cliente</th>
                <th>Producto</th>
                <th>IMEI / Serie</th>
                <th>Etapa</th>
                <th>Valores</th>
                <th className="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    Cargando canjes…
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    No hay equipos en canje registrados con este criterio.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const stKey = stageOf(item);
                  const st = STAGE_MAP[stKey] ?? STAGE_MAP.quarantine;
                  return (
                    <tr key={item.id} style={{ cursor: "pointer" }} onClick={() => setSelectedId(item.id)}>
                      <td>
                        <span className="type-badge purple" style={{ fontFamily: "monospace" }} title={item.id}>
                          {shortId(item.id)}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <strong>{item.customer_name ?? "—"}</strong>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            {[item.customer_code, item.customer_phone].filter(Boolean).join(" • ") || "Sin datos"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <Smartphone size={15} color="var(--brand-primary)" />
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <strong>{item.product_name ?? "—"}</strong>
                            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                              {[item.product_code, item.variant_name ?? item.variant_code].filter(Boolean).join(" • ") ||
                                "Sin variante"}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{ fontSize: "12px", fontFamily: "monospace" }}>{item.imei ?? "—"}</span>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "monospace" }}>
                            Serie: {item.serial_number ?? "—"}
                          </span>
                          {item.imei_status && (
                            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)" }}>
                              IMEI: {IMEI_LABELS[item.imei_status] ?? item.imei_status}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={st.pillClass}>{st.label}</span>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <strong style={{ color: "var(--brand-primary)" }}>
                            {formatCurrency(item.appraised_value_base ?? item.declared_value_base, "ARS")}
                          </strong>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            Declarado: {formatCurrency(item.declared_value_base, "ARS")}
                          </span>
                        </div>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="pag-btn"
                          style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(item.id);
                          }}
                          title="Ver detalle del canje"
                        >
                          <Eye size={12} /> Detalle
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedItem && (
        <Modal
          isOpen={Boolean(selectedItem)}
          onClose={() => {
            setSelectedId(null);
            setCostsResult(null);
          }}
          title={`Canje: ${selectedItem.product_name ?? shortId(selectedItem.id)}`}
          subtitle={`Cliente: ${selectedItem.customer_name ?? "—"} • Recibido: ${formatDateTime(selectedItem.received_at)}`}
          icon={Smartphone}
          maxWidth="680px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {isTradeInRejected(selectedItem) && (
              <FeedbackAlert type="error" message="Canje rechazado por procedencia o tasación." />
            )}

            <div style={{ padding: "12px", background: "var(--canvas-bg)", borderRadius: "10px" }}>
              <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase" }}>
                Progreso del canje
              </span>
              <ol style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "13px" }}>
                <li>Procedencia: {selectedItem.provenance_decision ?? "pendiente"}</li>
                <li>
                  IMEI: {selectedItem.imei_status ? `${IMEI_LABELS[selectedItem.imei_status] ?? selectedItem.imei_status}` : "pendiente"}
                  {selectedItem.imei_source ? ` (${selectedItem.imei_source})` : ""}
                </li>
                <li>
                  Tasación:{" "}
                  {selectedItem.evaluation_id
                    ? `${formatCurrency(selectedItem.appraised_value_base, "ARS")} • ${selectedItem.evaluation_decision ?? "pendiente de revisión"}`
                    : "pendiente"}
                </li>
                <li>Liberación: {selectedItem.release_id ? formatDateTime(selectedItem.released_at) : "pendiente"}</li>
                <li>
                  Pago aplicado:{" "}
                  {selectedItem.payment_id
                    ? `${formatCurrency(selectedItem.payment_amount, "ARS")} • ${formatDateTime(selectedItem.payment_applied_at)}`
                    : "pendiente"}
                </li>
              </ol>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
              <div>
                <span className="stat-label">Procedencia</span>
                <strong style={{ display: "block", fontSize: "13px" }}>
                  {selectedItem.provenance_decision ?? "Pendiente"}
                  {selectedItem.provenance_reviewed_at ? ` • ${formatDateTime(selectedItem.provenance_reviewed_at)}` : ""}
                </strong>
              </div>
              <div>
                <span className="stat-label">IMEI</span>
                <strong style={{ display: "block", fontSize: "13px", fontFamily: "monospace" }}>
                  {selectedItem.imei ?? "—"}
                </strong>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  {selectedItem.imei_checked_at ? `Verificado: ${formatDateTime(selectedItem.imei_checked_at)}` : "Sin verificación"}
                </span>
              </div>
              <div>
                <span className="stat-label">Tasación / Reacondicionamiento est.</span>
                <strong style={{ display: "block", fontSize: "13px" }}>
                  {formatCurrency(selectedItem.appraised_value_base, "ARS")} /{" "}
                  {formatCurrency(selectedItem.estimated_refurbishment_cost_base, "ARS")}
                </strong>
              </div>
              <div>
                <span className="stat-label">Liberación / Pago</span>
                <strong style={{ display: "block", fontSize: "13px" }}>
                  {selectedItem.release_id ? `Liberado ${formatDateTime(selectedItem.released_at)}` : "Sin liberar"} •{" "}
                  {selectedItem.payment_id ? formatCurrency(selectedItem.payment_amount, "ARS") : "Sin pago"}
                </strong>
              </div>
            </div>

            <div className="erp-form-group">
              <label className="erp-form-label">Motivo operativo (para cualquier acción)</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="erp-form-input"
                placeholder="Ej: Revisión de documentación del titular"
              />
            </div>

            <div style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
              <strong style={{ fontSize: "13px" }}>1. Revisar procedencia</strong>
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button type="button" className="btn-primary" disabled={actionBusy} onClick={() => handleProvenance("approved")}>
                  Aprobar
                </button>
                <button type="button" className="pag-btn" disabled={actionBusy} onClick={() => handleProvenance("rejected")}>
                  Rechazar
                </button>
              </div>
            </div>

            <div style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
              <strong style={{ fontSize: "13px" }}>2. Verificación IMEI</strong>
              <div className="erp-form-group" style={{ marginTop: "8px" }}>
                <label className="erp-form-label">Proveedor</label>
                <input
                  type="text"
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  className="erp-form-input"
                  placeholder="Ej: ENACOM"
                />
              </div>
              <button type="button" className="btn-primary" disabled={actionBusy} onClick={handleImeiCheck}>
                Solicitar verificación
              </button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "8px", marginTop: "12px" }}>
                <div className="erp-form-group">
                  <label className="erp-form-label">Respaldo manual</label>
                  <select
                    value={fallbackStatus}
                    onChange={(e) => setFallbackStatus(e.target.value as ImeiManualFallbackStatus)}
                    className="erp-form-select"
                  >
                    <option value="clear">clear</option>
                    <option value="not_required">not_required</option>
                  </select>
                </div>
                <div className="erp-form-group">
                  <label className="erp-form-label">Documentación (JSON no vacío)</label>
                  <input
                    type="text"
                    value={fallbackDoc}
                    onChange={(e) => setFallbackDoc(e.target.value)}
                    className="erp-form-input"
                    placeholder='Ej: {"acta":"123","verificado_por":"taller"}'
                  />
                </div>
              </div>
              <button type="button" className="pag-btn" disabled={actionBusy} onClick={handleImeiFallback}>
                Registrar respaldo manual
              </button>
            </div>

            <div style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
              <strong style={{ fontSize: "13px" }}>3. Tasación y revisión</strong>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "8px" }}>
                <div className="erp-form-group">
                  <label className="erp-form-label">Valor tasado (base)</label>
                  <input
                    type="number"
                    min="0"
                    value={appraisedValue}
                    onChange={(e) => setAppraisedValue(e.target.value)}
                    className="erp-form-input"
                  />
                </div>
                <div className="erp-form-group">
                  <label className="erp-form-label">Costo reacond. estimado</label>
                  <input
                    type="number"
                    min="0"
                    value={refurbEstimate}
                    onChange={(e) => setRefurbEstimate(e.target.value)}
                    className="erp-form-input"
                  />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
                <div className="erp-form-group">
                  <label className="erp-form-label">Estado / condición</label>
                  <input
                    type="text"
                    value={conditionNotes}
                    onChange={(e) => setConditionNotes(e.target.value)}
                    className="erp-form-input"
                    placeholder="Ej: Muy bueno, sin detalles"
                  />
                </div>
                <div className="erp-form-group">
                  <label className="erp-form-label">Batería (%)</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={batteryHealth}
                    onChange={(e) => setBatteryHealth(e.target.value)}
                    className="erp-form-input"
                  />
                </div>
              </div>
              <button type="button" className="btn-primary" disabled={actionBusy} onClick={handleCreateEvaluation}>
                Crear tasación
              </button>
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button type="button" className="pag-btn" disabled={actionBusy} onClick={() => handleReviewEvaluation("approved")}>
                  Aprobar tasación
                </button>
                <button type="button" className="pag-btn" disabled={actionBusy} onClick={() => handleReviewEvaluation("rejected")}>
                  Rechazar tasación
                </button>
              </div>
            </div>

            <div style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
              <strong style={{ fontSize: "13px" }}>4. Reacondicionamiento</strong>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px", marginTop: "8px" }}>
                <div className="erp-form-group">
                  <label className="erp-form-label">Descripción</label>
                  <input
                    type="text"
                    value={refurbDesc}
                    onChange={(e) => setRefurbDesc(e.target.value)}
                    className="erp-form-input"
                    placeholder="Ej: Cambio de batería y limpieza"
                  />
                </div>
                <div className="erp-form-group">
                  <label className="erp-form-label">Costo real</label>
                  <input
                    type="number"
                    min="0"
                    value={refurbCost}
                    onChange={(e) => setRefurbCost(e.target.value)}
                    className="erp-form-input"
                  />
                </div>
              </div>
              <div className="erp-form-group">
                <label className="erp-form-label">Orden de reparación (opcional)</label>
                <input
                  type="text"
                  value={repairOrderId}
                  onChange={(e) => setRepairOrderId(e.target.value)}
                  className="erp-form-input"
                  placeholder="UUID de la orden"
                />
              </div>
              <button type="button" className="pag-btn" disabled={actionBusy} onClick={handleRefurbishment}>
                Registrar reacondicionamiento
              </button>
            </div>

            <div style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
              <strong style={{ fontSize: "13px" }}>5. Liberar a stock y aplicar a venta</strong>
              <div className="erp-form-group" style={{ marginTop: "8px" }}>
                <label className="erp-form-label">Depósito destino</label>
                <input
                  type="text"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="erp-form-input"
                  placeholder="UUID del depósito"
                />
              </div>
              <button type="button" className="btn-primary" disabled={actionBusy} onClick={handleRelease}>
                Liberar a stock
              </button>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px", marginTop: "12px" }}>
                <div className="erp-form-group">
                  <label className="erp-form-label">Venta destino</label>
                  <input
                    type="text"
                    value={saleId}
                    onChange={(e) => setSaleId(e.target.value)}
                    className="erp-form-input"
                    placeholder="UUID de la venta"
                  />
                </div>
                <div className="erp-form-group">
                  <label className="erp-form-label">Monto</label>
                  <input
                    type="number"
                    min="0"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="erp-form-input"
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" className="pag-btn" disabled={actionBusy} onClick={handleApplyPayment}>
                  Aplicar pago
                </button>
                <button type="button" className="pag-btn" disabled={actionBusy} onClick={handleReversePayment}>
                  Revertir pago
                </button>
                <button type="button" className="pag-btn" disabled={actionBusy} onClick={handleCosts}>
                  Ver costos
                </button>
              </div>
              {costsResult && (
                <pre style={{ marginTop: "8px", fontSize: "11px", whiteSpace: "pre-wrap" }}>{costsResult}</pre>
              )}
            </div>
          </div>
        </Modal>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Recibir Equipo en Parte de Pago"
        subtitle="Alta formal con declaración de procedencia"
        icon={Smartphone}
        maxWidth="560px"
      >
        <form onSubmit={(e) => void handleIntake(e)} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Sucursal (ID) *</label>
              <input
                type="text"
                required
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="erp-form-input"
                placeholder="UUID de sucursal"
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Cliente (ID) *</label>
              <input
                type="text"
                required
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="erp-form-input"
                placeholder="UUID de cliente"
              />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Producto (ID) *</label>
              <input
                type="text"
                required
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="erp-form-input"
                placeholder="UUID de producto"
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Variante (ID, opcional)</label>
              <input
                type="text"
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                className="erp-form-input"
                placeholder="UUID de variante"
              />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Serie del equipo</label>
              <input
                type="text"
                value={deviceSerial}
                onChange={(e) => setDeviceSerial(e.target.value)}
                className="erp-form-input"
                placeholder="Nro de serie (opcional)"
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">IMEI (14-16 dígitos)</label>
              <input
                type="text"
                value={deviceImei}
                onChange={(e) => setDeviceImei(e.target.value)}
                className="erp-form-input"
                placeholder="Opcional"
              />
            </div>
          </div>
          <div className="erp-form-group">
            <label className="erp-form-label">Titular del equipo *</label>
            <input
              type="text"
              required
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="erp-form-input"
              placeholder="Nombre de quien entrega"
            />
          </div>
          <div className="erp-form-group">
            <label className="erp-form-label">Declaración de procedencia *</label>
            <textarea
              rows={3}
              required
              value={declarationText}
              onChange={(e) => setDeclarationText(e.target.value)}
              className="erp-form-textarea"
              placeholder="Declaro que el equipo es de mi propiedad y de origen lícito…"
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Valor declarado (base) *</label>
              <input
                type="number"
                required
                min="0"
                value={declaredValue}
                onChange={(e) => setDeclaredValue(e.target.value)}
                className="erp-form-input"
                placeholder="Ej: 350000"
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Documento de evidencia</label>
              <input
                type="text"
                value={evidenceDoc}
                onChange={(e) => setEvidenceDoc(e.target.value)}
                className="erp-form-input"
                placeholder="Referencia opcional"
              />
            </div>
          </div>
          <div className="erp-form-group">
            <label className="erp-form-label">Motivo operativo</label>
            <input
              type="text"
              value={intakeReason}
              onChange={(e) => setIntakeReason(e.target.value)}
              className="erp-form-input"
              placeholder="Ej: Recepción en mostrador"
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={actionBusy}>
              Registrar Canje
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
