import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Smartphone, Search, Eye, Plus, ShieldCheck, RefreshCw, DollarSign } from "lucide-react";
import { WorkspaceHeader, Modal, FeedbackAlert, KpiCard, StatePanel } from "../../components/erp/WorkspaceUi";
import { Field, FormError } from "../../components/erp/FormFeedback";
import { formatCurrency, formatDateTime } from "../../lib/formatters";
import { toUserMessage } from "../../lib/errors";
import { labelOf, TRADE_IN_DECISION_LABELS } from "../../lib/labels";
import { supabase } from "../../lib/supabase";
import { useErpAuth } from "../../auth/ErpAuthContext";
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
  type TradeInCosts,
  type TradeInOverview,
} from "./api";
import {
  createTradeInIntakeSchema,
  emptyTradeInApplyPayment,
  emptyTradeInEvaluation,
  emptyTradeInImeiCheck,
  emptyTradeInImeiFallback,
  emptyTradeInIntake,
  emptyTradeInRefurbishment,
  emptyTradeInRelease,
  isZeroAmount,
  parseNonEmptyJsonObject,
  tradeInApplyPaymentSchema,
  tradeInEvaluationSchema,
  tradeInImeiCheckSchema,
  tradeInImeiFallbackSchema,
  tradeInRefurbishmentSchema,
  tradeInReleaseSchema,
  type TradeInApplyPaymentFormValues,
  type TradeInEvaluationFormValues,
  type TradeInImeiCheckFormValues,
  type TradeInImeiFallbackFormInput,
  type TradeInImeiFallbackFormValues,
  type TradeInIntakeFormValues,
  type TradeInProductTracking,
  type TradeInRefurbishmentFormValues,
  type TradeInReleaseFormValues,
} from "./schemas";

const NO_MANAGE_PERMISSION = "No tenés permiso para gestionar equipos usados.";
const NO_APPROVE_PERMISSION = "No tenés permiso para aprobar operaciones de equipos usados.";
const NO_REFURBISH_PERMISSION =
  "Necesitás permisos de gestión de equipos usados y costos para registrar reacondicionamientos.";
const NO_RELEASE_PERMISSION =
  "Necesitás permisos de aprobación, stock, compras y costos para liberar a stock.";
const NO_APPLY_PAYMENT_PERMISSION =
  "Necesitás permisos de gestión de equipos usados y creación de ventas para aplicar el pago.";
const NO_REVERSE_PAYMENT_PERMISSION =
  "Necesitás permisos de gestión de equipos usados y anulación de ventas para revertir el pago.";
const NO_COSTS_PERMISSION = "No tenés permiso para ver costos de equipos usados.";

const STAGE_MAP: Record<string, { label: string; pillClass: string }> = {
  quarantine: { label: "En cuarentena", pillClass: "flow-status-pill pending" },
  evaluating: { label: "En evaluación", pillClass: "flow-status-pill processing" },
  ready_for_stock: { label: "Listo para stock", pillClass: "flow-status-pill confirmed" },
  applied_to_sale: { label: "Aplicado a venta", pillClass: "flow-status-pill completed" },
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

const IMEI_SOURCE_LABELS: Record<string, string> = {
  provider: "Proveedor",
  manual: "Manual",
};

interface Feedback {
  type: "success" | "error" | "info";
  message: string;
}

interface TradeInProductOption {
  id: string;
  internal_code: string;
  internal_name: string;
  inventory_tracking: TradeInProductTracking;
}

interface TradeInBranchOption {
  id: string;
  code: string;
  name: string;
}

interface TradeInCustomerOption {
  id: string;
  code: string;
  display_name: string;
}

const stageOf = (t: TradeInOverview): string => (isTradeInRejected(t) ? "rejected" : t.stage);

const formatTradeInError = (error: unknown, fallback: string): string => {
  if (error && typeof error === "object") {
    const record = error as { code?: unknown; message?: unknown; details?: unknown };
    const code = typeof record.code === "string" ? record.code : "";
    const message =
      typeof record.message === "string"
        ? record.message
        : typeof record.details === "string"
          ? record.details
          : "";
    if (code === "23514" && message.toLowerCase().includes("inventory units")) {
      return "El producto seleccionado no admite recepción de equipos usados. Elegí un producto con seguimiento por serie o IMEI.";
    }
  }
  return toUserMessage(error, fallback);
};

export const TradeInsWorkspace = () => {
  const { hasPermission } = useErpAuth();
  const canManageTradeIns = hasPermission("trade_ins.manage");
  const canApproveTradeIns = hasPermission("trade_ins.approve");
  const canViewCosts = hasPermission("costs.view");
  const canRefurbishTradeIns = canManageTradeIns && hasPermission("costs.manage");
  const canReleaseTradeIns =
    canApproveTradeIns &&
    hasPermission("stock.move") &&
    hasPermission("purchases.manage") &&
    hasPermission("costs.manage");
  const canApplyPayment = canManageTradeIns && hasPermission("sales.create");
  const canReversePayment = canManageTradeIns && hasPermission("sales.cancel");

  const [items, setItems] = useState<TradeInOverview[]>([]);
  const [tradeInProducts, setTradeInProducts] = useState<TradeInProductOption[]>([]);
  const [branches, setBranches] = useState<TradeInBranchOption[]>([]);
  const [customers, setCustomers] = useState<TradeInCustomerOption[]>([]);
  const [isLoadingIntakeOptions, setIsLoadingIntakeOptions] = useState(false);
  const [intakeOptionsError, setIntakeOptionsError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailSuccess, setDetailSuccess] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [reason, setReason] = useState<string>("");
  const [costsResult, setCostsResult] = useState<TradeInCosts | null>(null);

  const productsRef = useRef<TradeInProductOption[]>([]);
  productsRef.current = tradeInProducts;

  const intakeSchema = useMemo(
    () =>
      createTradeInIntakeSchema(
        (id) => productsRef.current.find((product) => product.id === id)?.inventory_tracking ?? null,
      ),
    [],
  );

  const intakeForm = useForm<TradeInIntakeFormValues>({
    resolver: zodResolver(intakeSchema),
    defaultValues: emptyTradeInIntake(),
  });
  const watchedProductId = intakeForm.watch("productId");
  const watchedDeclaredValue = intakeForm.watch("declaredValue");

  const imeiCheckForm = useForm<TradeInImeiCheckFormValues>({
    resolver: zodResolver(tradeInImeiCheckSchema),
    defaultValues: emptyTradeInImeiCheck(),
  });

  const imeiFallbackForm = useForm<TradeInImeiFallbackFormInput, unknown, TradeInImeiFallbackFormValues>({
    resolver: zodResolver(tradeInImeiFallbackSchema),
    defaultValues: emptyTradeInImeiFallback(),
  });

  const evaluationForm = useForm<TradeInEvaluationFormValues>({
    resolver: zodResolver(tradeInEvaluationSchema),
    defaultValues: emptyTradeInEvaluation(),
  });
  const watchedAppraisedValue = evaluationForm.watch("appraisedValue");

  const refurbishmentForm = useForm<TradeInRefurbishmentFormValues>({
    resolver: zodResolver(tradeInRefurbishmentSchema),
    defaultValues: emptyTradeInRefurbishment(),
  });

  const releaseForm = useForm<TradeInReleaseFormValues>({
    resolver: zodResolver(tradeInReleaseSchema),
    defaultValues: emptyTradeInRelease(),
  });

  const applyPaymentForm = useForm<TradeInApplyPaymentFormValues>({
    resolver: zodResolver(tradeInApplyPaymentSchema),
    defaultValues: emptyTradeInApplyPayment(),
  });

  const loadTradeIns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTradeIns();
      setItems(data);
    } catch (e) {
      setError(formatTradeInError(e, "No se pudieron cargar los equipos usados."));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadIntakeOptions = useCallback(async () => {
    const [productsResult, branchesResult, customersResult] = await Promise.all([
      supabase
        .from("products")
        .select("id, internal_code, internal_name, inventory_tracking")
        .eq("item_kind", "product")
        .eq("is_active", true)
        .in("inventory_tracking", ["serial", "imei"])
        .order("internal_name", { ascending: true }),
      supabase.from("branches").select("id, code, name").order("name", { ascending: true }),
      supabase.from("customers").select("id, code, display_name").order("display_name", { ascending: true }),
    ]);
    const referenceError = productsResult.error ?? branchesResult.error ?? customersResult.error;
    if (referenceError) throw referenceError;
    const loadedProducts = (productsResult.data ?? []) as TradeInProductOption[];
    productsRef.current = loadedProducts;
    setTradeInProducts(loadedProducts);
    const nextBranches = (branchesResult.data ?? []) as TradeInBranchOption[];
    setBranches(nextBranches);
    setCustomers((customersResult.data ?? []) as TradeInCustomerOption[]);
    if (nextBranches.length === 1 && intakeForm.getValues("branchId").trim() === "") {
      intakeForm.setValue("branchId", nextBranches[0].id, { shouldValidate: false });
    }
  }, [intakeForm]);

  useEffect(() => {
    void loadTradeIns();
  }, [loadTradeIns]);

  const refreshIntakeOptions = useCallback(async () => {
    setIsLoadingIntakeOptions(true);
    setIntakeOptionsError(null);
    try {
      await loadIntakeOptions();
    } catch (loadError) {
      setIntakeOptionsError(
        formatTradeInError(loadError, "No se pudieron cargar los datos necesarios para recibir el equipo."),
      );
    } finally {
      setIsLoadingIntakeOptions(false);
    }
  }, [loadIntakeOptions]);

  const resetDetailForms = useCallback(() => {
    setReason("");
    setCostsResult(null);
    setDetailError(null);
    setDetailSuccess(null);
    imeiCheckForm.reset(emptyTradeInImeiCheck());
    imeiFallbackForm.reset(emptyTradeInImeiFallback());
    evaluationForm.reset(emptyTradeInEvaluation());
    refurbishmentForm.reset(emptyTradeInRefurbishment());
    releaseForm.reset(emptyTradeInRelease());
    applyPaymentForm.reset(emptyTradeInApplyPayment());
  }, [
    applyPaymentForm,
    evaluationForm,
    imeiCheckForm,
    imeiFallbackForm,
    refurbishmentForm,
    releaseForm,
  ]);

  const openDetailModal = (id: string) => {
    resetDetailForms();
    setSelectedId(id);
  };

  const closeDetailModal = () => {
    if (actionBusy) return;
    setSelectedId(null);
    resetDetailForms();
  };

  const openIntakeModal = () => {
    if (!canManageTradeIns) return;
    setIntakeError(null);
    intakeForm.reset(emptyTradeInIntake());
    setIsModalOpen(true);
    void refreshIntakeOptions();
  };

  const closeIntakeModal = () => {
    if (actionBusy || intakeForm.formState.isSubmitting) return;
    setIsModalOpen(false);
    setIntakeError(null);
    intakeForm.reset(emptyTradeInIntake());
  };

  const selectedItem = useMemo(
    () => items.find((t) => t.id === selectedId) ?? null,
    [items, selectedId],
  );

  const selectedProduct = useMemo(
    () => tradeInProducts.find((product) => product.id === watchedProductId) ?? null,
    [watchedProductId, tradeInProducts],
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
    [items],
  );
  const imeiVerificados = useMemo(() => items.filter((t) => t.imei_status === "clear").length, [items]);
  const liberados = useMemo(() => items.filter((t) => t.release_id !== null).length, [items]);
  const enRevision = useMemo(
    () => items.filter((t) => t.stage === "quarantine" || t.stage === "evaluating").length,
    [items],
  );

  const runDetailAction = async (fn: () => Promise<unknown>, successMessage: string): Promise<boolean> => {
    if (actionBusy) return false;
    setActionBusy(true);
    setDetailError(null);
    setDetailSuccess(null);
    setFeedback(null);
    try {
      await fn();
      await loadTradeIns();
      setDetailSuccess(successMessage);
      setFeedback({ type: "success", message: successMessage });
      return true;
    } catch (e) {
      setDetailError(formatTradeInError(e, "La operación no pudo completarse."));
      return false;
    } finally {
      setActionBusy(false);
    }
  };

  const handleIntake = async (values: TradeInIntakeFormValues) => {
    if (!canManageTradeIns) {
      setIntakeError(NO_MANAGE_PERMISSION);
      return;
    }
    if (!selectedProduct) {
      setIntakeError("Elegí un producto activo con seguimiento por serie o IMEI.");
      return;
    }
    setIntakeError(null);
    setFeedback(null);
    setActionBusy(true);
    try {
      await intakeTradeInDirect({
        branchId: values.branchId.trim(),
        customerId: values.customerId.trim(),
        productId: values.productId.trim(),
        variantId: values.variantId.trim() === "" ? null : values.variantId.trim(),
        deviceSerial: values.deviceSerial.trim() === "" ? null : values.deviceSerial.trim(),
        deviceImei: values.deviceImei.trim() === "" ? null : values.deviceImei.trim(),
        ownerName: values.ownerName.trim(),
        declarationText: values.declarationText.trim(),
        declaredValue: Number(values.declaredValue),
        evidenceDoc: values.evidenceDoc.trim() === "" ? null : values.evidenceDoc.trim(),
        operationReason: values.intakeReason.trim() === "" ? undefined : values.intakeReason.trim(),
      });
      await loadTradeIns();
      setFeedback({ type: "success", message: "Equipo recibido en parte de pago correctamente." });
      setIsModalOpen(false);
      intakeForm.reset(emptyTradeInIntake());
    } catch (e) {
      setIntakeError(formatTradeInError(e, "No se pudo registrar el equipo en parte de pago."));
    } finally {
      setActionBusy(false);
    }
  };

  const operationReasonValue = () => (reason.trim() === "" ? undefined : reason.trim());

  const handleProvenance = (decision: "approved" | "rejected") => {
    if (!canApproveTradeIns) {
      setDetailError(NO_APPROVE_PERMISSION);
      return;
    }
    if (!selectedItem) return;
    if (selectedItem.provenance_decision !== null) {
      setDetailError("La procedencia de este equipo ya fue revisada.");
      return;
    }
    void runDetailAction(
      () => reviewTradeInProvenance(selectedItem.id, decision, operationReasonValue()),
      decision === "approved" ? "Procedencia aprobada." : "Procedencia rechazada.",
    );
  };

  const handleImeiCheck = async (values: TradeInImeiCheckFormValues) => {
    if (!canManageTradeIns) {
      setDetailError(NO_MANAGE_PERMISSION);
      return;
    }
    if (!selectedItem) return;
    if (selectedItem.provenance_decision !== "approved") {
      setDetailError("Primero debe aprobarse la procedencia del equipo.");
      return;
    }
    const ok = await runDetailAction(
      () => requestTradeInImeiCheck(selectedItem.id, values.providerName.trim(), operationReasonValue()),
      "Verificación IMEI solicitada.",
    );
    if (ok) imeiCheckForm.reset(emptyTradeInImeiCheck());
  };

  const handleImeiFallback = async (values: TradeInImeiFallbackFormValues) => {
    if (!canApproveTradeIns) {
      setDetailError(NO_APPROVE_PERMISSION);
      return;
    }
    if (!selectedItem) return;
    if (selectedItem.provenance_decision !== "approved") {
      setDetailError("Primero debe aprobarse la procedencia del equipo.");
      return;
    }
    const doc = parseNonEmptyJsonObject(values.fallbackDoc);
    if (!doc) {
      setDetailError("La documentación debe ser un objeto JSON válido y no vacío.");
      return;
    }
    const ok = await runDetailAction(
      () =>
        recordTradeInImeiManualFallback(
          selectedItem.id,
          values.fallbackStatus,
          doc,
          operationReasonValue(),
        ),
      "Respaldo manual de IMEI registrado.",
    );
    if (ok) imeiFallbackForm.reset(emptyTradeInImeiFallback());
  };

  const handleCreateEvaluation = async (values: TradeInEvaluationFormValues) => {
    if (!canManageTradeIns) {
      setDetailError(NO_MANAGE_PERMISSION);
      return;
    }
    if (!selectedItem) return;
    if (!isImeiVerified(selectedItem)) {
      setDetailError("El IMEI debe estar verificado antes de tasar el equipo.");
      return;
    }
    const battery = values.batteryHealth.trim() === "" ? null : Number(values.batteryHealth.trim());
    const snapshot: Record<string, string | number | boolean | null> = {
      notes: values.conditionNotes.trim(),
      battery_health: battery,
    };
    const ok = await runDetailAction(
      () =>
        createTradeInEvaluation(
          selectedItem.id,
          snapshot,
          Number(values.appraisedValue),
          Number(values.refurbEstimate),
          operationReasonValue(),
        ),
      "Tasación del equipo registrada.",
    );
    if (ok) evaluationForm.reset(emptyTradeInEvaluation());
  };

  const handleReviewEvaluation = (decision: "approved" | "rejected") => {
    if (!canApproveTradeIns) {
      setDetailError(NO_APPROVE_PERMISSION);
      return;
    }
    if (!selectedItem) return;
    if (!selectedItem.evaluation_id) {
      setDetailError("Este equipo aún no tiene tasación para revisar.");
      return;
    }
    if (selectedItem.evaluation_decision !== null) {
      setDetailError("La tasación ya fue revisada.");
      return;
    }
    const evaluationId = selectedItem.evaluation_id;
    void runDetailAction(
      () => reviewTradeInEvaluation(evaluationId, decision, operationReasonValue()),
      decision === "approved" ? "Tasación aprobada." : "Tasación rechazada.",
    );
  };

  const handleRefurbishment = async (values: TradeInRefurbishmentFormValues) => {
    if (!canRefurbishTradeIns) {
      setDetailError(NO_REFURBISH_PERMISSION);
      return;
    }
    if (!selectedItem) return;
    if (selectedItem.evaluation_decision !== "approved") {
      setDetailError("La tasación debe estar aprobada antes de registrar el reacondicionamiento.");
      return;
    }
    const ok = await runDetailAction(
      () =>
        recordTradeInRefurbishment(
          selectedItem.id,
          values.refurbDesc.trim(),
          Number(values.refurbCost),
          values.repairOrderId.trim() === "" ? null : values.repairOrderId.trim(),
          true,
          operationReasonValue(),
        ),
      "Reacondicionamiento registrado.",
    );
    if (ok) refurbishmentForm.reset(emptyTradeInRefurbishment());
  };

  const handleRelease = async (values: TradeInReleaseFormValues) => {
    if (!canReleaseTradeIns) {
      setDetailError(NO_RELEASE_PERMISSION);
      return;
    }
    if (!selectedItem) return;
    if (selectedItem.provenance_decision !== "approved") {
      setDetailError("La procedencia debe estar aprobada para liberar a stock.");
      return;
    }
    if (selectedItem.evaluation_decision !== "approved") {
      setDetailError("La tasación debe estar aprobada para liberar a stock.");
      return;
    }
    if (!isImeiVerified(selectedItem)) {
      setDetailError("El IMEI debe estar verificado para liberar a stock.");
      return;
    }
    const ok = await runDetailAction(
      () => releaseTradeInToStock(selectedItem.id, values.locationId.trim(), operationReasonValue()),
      "Equipo liberado a stock.",
    );
    if (ok) releaseForm.reset(emptyTradeInRelease());
  };

  const handleApplyPayment = async (values: TradeInApplyPaymentFormValues) => {
    if (!canApplyPayment) {
      setDetailError(NO_APPLY_PAYMENT_PERMISSION);
      return;
    }
    if (!selectedItem) return;
    if (!selectedItem.release_id) {
      setDetailError("El equipo debe liberarse a stock antes de aplicarlo a una venta.");
      return;
    }
    const ok = await runDetailAction(
      () =>
        applyTradeInSalePayment(
          selectedItem.id,
          values.saleId.trim(),
          Number(values.paymentAmount),
          operationReasonValue(),
        ),
      "Equipo aplicado como pago de la venta.",
    );
    if (ok) applyPaymentForm.reset(emptyTradeInApplyPayment());
  };

  const handleReversePayment = () => {
    if (!canReversePayment) {
      setDetailError(NO_REVERSE_PAYMENT_PERMISSION);
      return;
    }
    if (!selectedItem) return;
    if (!selectedItem.payment_id) {
      setDetailError("Este equipo no tiene pagos aplicados para revertir.");
      return;
    }
    const paymentId = selectedItem.payment_id;
    void runDetailAction(
      () => reverseTradeInSalePayment(paymentId, operationReasonValue()),
      "Pago aplicado revertido.",
    );
  };

  const handleCosts = () => {
    if (!canViewCosts) {
      setDetailError(NO_COSTS_PERMISSION);
      return;
    }
    if (!selectedItem) return;
    setCostsResult(null);
    void runDetailAction(async () => {
      const data = await getTradeInCosts(selectedItem.id);
      setCostsResult(data);
    }, "Costos del equipo consultados.");
  };

  const shortId = (id: string) => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Equipos usados"
        description="Recepción de equipos en parte de pago, revisión de procedencia, verificación IMEI, tasación, liberación a stock y aplicación a ventas."
        badge={`${items.length} ${items.length === 1 ? "equipo usado" : "equipos usados"}`}
        badgeTone="neutral"
      />

      {feedback && (
        <FeedbackAlert type={feedback.type} message={feedback.message} onClose={() => setFeedback(null)} />
      )}

      {error && (
        <FeedbackAlert
          type="error"
          message="No se pudieron cargar los equipos usados."
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
          label="Equipos recibidos"
          value={items.length}
          trend={{ text: "En parte de pago", positive: true }}
          sublabel={`${enRevision} en revisión`}
        />
        <KpiCard
          icon={DollarSign}
          iconVariant="navy"
          label="Valuación total"
          value={canViewCosts ? formatCurrency(totalValuado, "ARS") : "Restringido"}
          trend={{ text: "Tasado o declarado", positive: true }}
          sublabel="Crédito a favor de clientes"
        />
        <KpiCard
          icon={ShieldCheck}
          iconVariant="steel"
          label="Verificación IMEI"
          value={imeiVerificados}
          trend={{ text: "Verificados", positive: true }}
          sublabel="Estado de verificación del IMEI"
        />
        <KpiCard
          icon={RefreshCw}
          iconVariant="dark"
          label="Liberados a stock"
          value={liberados}
          trend={{ text: "Stock usados", positive: true }}
          sublabel="Garantía 90 días"
        />
      </div>

      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Registro de equipos usados</h2>
            <p className="flow-card__subtitle">Trazabilidad de origen, verificación IMEI y tasación técnica</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div className="flow-search-pill" style={{ width: "260px" }}>
              <Search size={15} aria-hidden="true" />
              <input
                type="text"
                aria-label="Buscar equipos usados"
                placeholder="Cliente, producto, IMEI o serie…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={openIntakeModal}
              disabled={!canManageTradeIns}
              title={!canManageTradeIns ? NO_MANAGE_PERMISSION : undefined}
            >
              <Plus size={16} aria-hidden="true" />
              Recibir equipo en parte de pago
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", overflowX: "auto" }}>
          {[
            { id: "all", label: "Todos" },
            { id: "quarantine", label: "En cuarentena" },
            { id: "evaluating", label: "En evaluación" },
            { id: "ready_for_stock", label: "Listos para stock" },
            { id: "applied_to_sale", label: "Aplicados a venta" },
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
                <th className="num">Valores</th>
                <th className="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    Cargando equipos usados…
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    No hay equipos usados registrados con este criterio.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const stKey = stageOf(item);
                  const st = STAGE_MAP[stKey] ?? STAGE_MAP.quarantine;
                  return (
                    <tr
                      key={item.id}
                      className="interactive-row"
                      role="button"
                      tabIndex={0}
                      aria-label={`Abrir equipo usado ${item.product_name ?? shortId(item.id)}`}
                      onClick={() => openDetailModal(item.id)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openDetailModal(item.id);
                        }
                      }}
                    >
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
                          <Smartphone size={15} color="var(--brand-primary)" aria-hidden="true" />
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
                              IMEI: {labelOf(IMEI_LABELS, item.imei_status, item.imei_status)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={st.pillClass}>{st.label}</span>
                      </td>
                      <td className="num">
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                          <span className="amount-val">
                            {canViewCosts
                              ? formatCurrency(item.appraised_value_base ?? item.declared_value_base, "ARS")
                              : "Restringido"}
                          </span>
                          {canViewCosts && (
                            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                              Declarado: {formatCurrency(item.declared_value_base, "ARS")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="pag-btn"
                          style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetailModal(item.id);
                          }}
                          title="Ver detalle del equipo usado"
                        >
                          <Eye size={12} aria-hidden="true" /> Detalle
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
          onClose={closeDetailModal}
          title={`Equipo usado: ${selectedItem.product_name ?? shortId(selectedItem.id)}`}
          subtitle={`Cliente: ${selectedItem.customer_name ?? "—"} • Recibido: ${formatDateTime(selectedItem.received_at)}`}
          icon={Smartphone}
          maxWidth="680px"
          scrollBody
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {isTradeInRejected(selectedItem) && (
              <FeedbackAlert type="error" message="Equipo rechazado por procedencia o tasación." />
            )}

            {(detailSuccess || detailError) && (
              <div
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 3,
                  background: "var(--surface-card)",
                  paddingBottom: "4px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                {detailSuccess && (
                  <FeedbackAlert type="success" message={detailSuccess} onClose={() => setDetailSuccess(null)} />
                )}
                <FormError message={detailError} onDismiss={() => setDetailError(null)} />
              </div>
            )}

            <div style={{ padding: "12px", background: "var(--canvas-bg)", borderRadius: "10px" }}>
              <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase" }}>
                Progreso del equipo usado
              </span>
              <ol style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "13px" }}>
                <li>
                  Procedencia:{" "}
                  {labelOf(TRADE_IN_DECISION_LABELS, selectedItem.provenance_decision, "Pendiente")}
                </li>
                <li>
                  IMEI:{" "}
                  {selectedItem.imei_status
                    ? labelOf(IMEI_LABELS, selectedItem.imei_status, selectedItem.imei_status)
                    : "Pendiente"}
                  {selectedItem.imei_source
                    ? ` (${labelOf(IMEI_SOURCE_LABELS, selectedItem.imei_source, selectedItem.imei_source)})`
                    : ""}
                </li>
                <li>
                  Tasación:{" "}
                  {selectedItem.evaluation_id
                    ? canViewCosts
                      ? `${formatCurrency(selectedItem.appraised_value_base, "ARS")} • ${labelOf(
                          TRADE_IN_DECISION_LABELS,
                          selectedItem.evaluation_decision,
                          "Pendiente de revisión",
                        )}`
                      : `Registrada • ${labelOf(
                          TRADE_IN_DECISION_LABELS,
                          selectedItem.evaluation_decision,
                          "Pendiente de revisión",
                        )} (valor restringido)`
                    : "Pendiente"}
                </li>
                <li>Liberación: {selectedItem.release_id ? formatDateTime(selectedItem.released_at) : "Pendiente"}</li>
                <li>
                  Pago aplicado:{" "}
                  {selectedItem.payment_id
                    ? canViewCosts
                      ? `${formatCurrency(selectedItem.payment_amount, "ARS")} • ${formatDateTime(selectedItem.payment_applied_at)}`
                      : `Registrado • ${formatDateTime(selectedItem.payment_applied_at)}`
                    : "Pendiente"}
                </li>
              </ol>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
              <div>
                <span className="stat-label">Procedencia</span>
                <strong style={{ display: "block", fontSize: "13px" }}>
                  {labelOf(TRADE_IN_DECISION_LABELS, selectedItem.provenance_decision, "Pendiente")}
                  {selectedItem.provenance_reviewed_at ? ` • ${formatDateTime(selectedItem.provenance_reviewed_at)}` : ""}
                </strong>
              </div>
              <div>
                <span className="stat-label">IMEI</span>
                <strong style={{ display: "block", fontSize: "13px", fontFamily: "monospace" }}>
                  {selectedItem.imei ?? (canManageTradeIns || canApproveTradeIns ? "—" : "Restringido")}
                </strong>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  {selectedItem.imei
                    ? selectedItem.imei_checked_at
                      ? `Verificado: ${formatDateTime(selectedItem.imei_checked_at)}`
                      : "Sin verificación"
                    : canManageTradeIns || canApproveTradeIns
                      ? "Sin IMEI registrado"
                      : "Identificador restringido"}
                </span>
              </div>
              <div>
                <span className="stat-label">Tasación / Reacondicionamiento est.</span>
                <strong style={{ display: "block", fontSize: "13px" }}>
                  {canViewCosts
                    ? `${formatCurrency(selectedItem.appraised_value_base, "ARS")} / ${formatCurrency(selectedItem.estimated_refurbishment_cost_base, "ARS")}`
                    : "Valores restringidos"}
                </strong>
              </div>
              <div>
                <span className="stat-label">Liberación / Pago</span>
                <strong style={{ display: "block", fontSize: "13px" }}>
                  {selectedItem.release_id ? `Liberado ${formatDateTime(selectedItem.released_at)}` : "Sin liberar"} •{" "}
                  {selectedItem.payment_id
                    ? canViewCosts
                      ? formatCurrency(selectedItem.payment_amount, "ARS")
                      : "Pago registrado"
                    : "Sin pago"}
                </strong>
              </div>
            </div>

            <Field label="Motivo operativo (para cualquier acción)">
              {(a11y) => (
                <input
                  {...a11y}
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="erp-form-input"
                  placeholder="Ej: Revisión de documentación del titular"
                  disabled={actionBusy}
                />
              )}
            </Field>

            <div style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
              <strong style={{ fontSize: "13px" }}>1. Revisar procedencia</strong>
              <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!canApproveTradeIns || actionBusy}
                  title={!canApproveTradeIns ? NO_APPROVE_PERMISSION : undefined}
                  onClick={() => handleProvenance("approved")}
                >
                  Aprobar procedencia
                </button>
                <button
                  type="button"
                  className="pag-btn"
                  disabled={!canApproveTradeIns || actionBusy}
                  title={!canApproveTradeIns ? NO_APPROVE_PERMISSION : undefined}
                  onClick={() => handleProvenance("rejected")}
                >
                  Rechazar procedencia
                </button>
              </div>
            </div>

            <div style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
              <strong style={{ fontSize: "13px" }}>2. Verificación IMEI</strong>
              <form
                onSubmit={imeiCheckForm.handleSubmit(handleImeiCheck)}
                noValidate
                style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}
              >
                <Field
                  label="Proveedor"
                  required
                  error={imeiCheckForm.formState.errors.providerName?.message}
                >
                  {(a11y) => (
                    <input
                      {...a11y}
                      type="text"
                      className="erp-form-input"
                      placeholder="Ej: ENACOM"
                      required
                      disabled={!canManageTradeIns || actionBusy}
                      {...imeiCheckForm.register("providerName")}
                    />
                  )}
                </Field>
                <div>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={!canManageTradeIns || actionBusy}
                    title={!canManageTradeIns ? NO_MANAGE_PERMISSION : undefined}
                  >
                    Solicitar verificación
                  </button>
                </div>
              </form>

              <form
                onSubmit={imeiFallbackForm.handleSubmit(handleImeiFallback)}
                noValidate
                style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "8px" }}>
                  <Field
                    label="Respaldo manual"
                    required
                    error={imeiFallbackForm.formState.errors.fallbackStatus?.message}
                  >
                    {(a11y) => (
                      <select
                        {...a11y}
                        className="erp-form-select"
                        required
                        disabled={!canApproveTradeIns || actionBusy}
                        {...imeiFallbackForm.register("fallbackStatus")}
                      >
                        <option value="">Seleccionar resultado…</option>
                        <option value="clear">Limpio</option>
                        <option value="not_required">No requerido</option>
                      </select>
                    )}
                  </Field>
                  <Field
                    label="Documentación (JSON no vacío)"
                    required
                    error={imeiFallbackForm.formState.errors.fallbackDoc?.message}
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        type="text"
                        className="erp-form-input"
                        placeholder='Ej: {"acta":"123","verificado_por":"taller"}'
                        required
                        disabled={!canApproveTradeIns || actionBusy}
                        {...imeiFallbackForm.register("fallbackDoc")}
                      />
                    )}
                  </Field>
                </div>
                <div>
                  <button
                    type="submit"
                    className="pag-btn"
                    disabled={!canApproveTradeIns || actionBusy}
                    title={!canApproveTradeIns ? NO_APPROVE_PERMISSION : undefined}
                  >
                    Registrar respaldo manual
                  </button>
                </div>
              </form>
            </div>

            <div style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
              <strong style={{ fontSize: "13px" }}>3. Tasación y revisión</strong>
              <form
                onSubmit={evaluationForm.handleSubmit(handleCreateEvaluation)}
                noValidate
                style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <Field
                    label="Valor tasado (base)"
                    required
                    error={evaluationForm.formState.errors.appraisedValue?.message}
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        type="number"
                        min="0"
                        step="any"
                        className="erp-form-input"
                        required
                        disabled={!canManageTradeIns || actionBusy}
                        {...evaluationForm.register("appraisedValue", {
                          onChange: () => evaluationForm.setValue("confirmZeroAppraisedValue", false),
                        })}
                      />
                    )}
                  </Field>
                  <Field
                    label="Costo reacond. estimado"
                    required
                    error={evaluationForm.formState.errors.refurbEstimate?.message}
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        type="number"
                        min="0"
                        step="any"
                        className="erp-form-input"
                        required
                        disabled={!canManageTradeIns || actionBusy}
                        {...evaluationForm.register("refurbEstimate")}
                      />
                    )}
                  </Field>
                </div>

                {isZeroAmount(watchedAppraisedValue) && (
                  <Field
                    label="Confirmo el valor tasado de $0"
                    required
                    error={evaluationForm.formState.errors.confirmZeroAppraisedValue?.message}
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        type="checkbox"
                        required
                        disabled={!canManageTradeIns || actionBusy}
                        {...evaluationForm.register("confirmZeroAppraisedValue")}
                      />
                    )}
                  </Field>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
                  <Field
                    label="Estado / condición"
                    required
                    error={evaluationForm.formState.errors.conditionNotes?.message}
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        type="text"
                        className="erp-form-input"
                        placeholder="Ej: Muy bueno, sin detalles"
                        required
                        disabled={!canManageTradeIns || actionBusy}
                        {...evaluationForm.register("conditionNotes")}
                      />
                    )}
                  </Field>
                  <Field
                    label="Batería (%)"
                    error={evaluationForm.formState.errors.batteryHealth?.message}
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        type="number"
                        min="1"
                        max="100"
                        className="erp-form-input"
                        disabled={!canManageTradeIns || actionBusy}
                        {...evaluationForm.register("batteryHealth")}
                      />
                    )}
                  </Field>
                </div>
                <div>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={!canManageTradeIns || actionBusy}
                    title={!canManageTradeIns ? NO_MANAGE_PERMISSION : undefined}
                  >
                    Crear tasación
                  </button>
                </div>
              </form>

              <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="pag-btn"
                  disabled={!canApproveTradeIns || actionBusy}
                  title={!canApproveTradeIns ? NO_APPROVE_PERMISSION : undefined}
                  onClick={() => handleReviewEvaluation("approved")}
                >
                  Aprobar tasación
                </button>
                <button
                  type="button"
                  className="pag-btn"
                  disabled={!canApproveTradeIns || actionBusy}
                  title={!canApproveTradeIns ? NO_APPROVE_PERMISSION : undefined}
                  onClick={() => handleReviewEvaluation("rejected")}
                >
                  Rechazar tasación
                </button>
              </div>
            </div>

            <div style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
              <strong style={{ fontSize: "13px" }}>4. Reacondicionamiento</strong>
              <form
                onSubmit={refurbishmentForm.handleSubmit(handleRefurbishment)}
                noValidate
                style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
                  <Field
                    label="Descripción"
                    required
                    error={refurbishmentForm.formState.errors.refurbDesc?.message}
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        type="text"
                        className="erp-form-input"
                        placeholder="Ej: Cambio de batería y limpieza"
                        required
                        disabled={!canRefurbishTradeIns || actionBusy}
                        {...refurbishmentForm.register("refurbDesc")}
                      />
                    )}
                  </Field>
                  <Field
                    label="Costo real"
                    required
                    error={refurbishmentForm.formState.errors.refurbCost?.message}
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        type="number"
                        min="0"
                        step="any"
                        className="erp-form-input"
                        required
                        disabled={!canRefurbishTradeIns || actionBusy}
                        {...refurbishmentForm.register("refurbCost")}
                      />
                    )}
                  </Field>
                </div>
                <Field
                  label="Orden de reparación (opcional)"
                  error={refurbishmentForm.formState.errors.repairOrderId?.message}
                >
                  {(a11y) => (
                    <input
                      {...a11y}
                      type="text"
                      className="erp-form-input"
                      placeholder="UUID de la orden"
                      disabled={!canRefurbishTradeIns || actionBusy}
                      {...refurbishmentForm.register("repairOrderId")}
                    />
                  )}
                </Field>
                <div>
                  <button
                    type="submit"
                    className="pag-btn"
                    disabled={!canRefurbishTradeIns || actionBusy}
                    title={!canRefurbishTradeIns ? NO_REFURBISH_PERMISSION : undefined}
                  >
                    Registrar reacondicionamiento
                  </button>
                </div>
              </form>
            </div>

            <div style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
              <strong style={{ fontSize: "13px" }}>5. Liberar a stock y aplicar a venta</strong>
              <form
                onSubmit={releaseForm.handleSubmit(handleRelease)}
                noValidate
                style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}
              >
                <Field
                  label="Depósito destino"
                  required
                  error={releaseForm.formState.errors.locationId?.message}
                >
                  {(a11y) => (
                    <input
                      {...a11y}
                      type="text"
                      className="erp-form-input"
                      placeholder="UUID del depósito"
                      required
                      disabled={!canReleaseTradeIns || actionBusy}
                      {...releaseForm.register("locationId")}
                    />
                  )}
                </Field>
                <div>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={!canReleaseTradeIns || actionBusy}
                    title={!canReleaseTradeIns ? NO_RELEASE_PERMISSION : undefined}
                  >
                    Liberar a stock
                  </button>
                </div>
              </form>

              <form
                onSubmit={applyPaymentForm.handleSubmit(handleApplyPayment)}
                noValidate
                style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
                  <Field
                    label="Venta destino"
                    required
                    error={applyPaymentForm.formState.errors.saleId?.message}
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        type="text"
                        className="erp-form-input"
                        placeholder="UUID de la venta"
                        required
                        disabled={!canApplyPayment || actionBusy}
                        {...applyPaymentForm.register("saleId")}
                      />
                    )}
                  </Field>
                  <Field
                    label="Monto"
                    required
                    error={applyPaymentForm.formState.errors.paymentAmount?.message}
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        type="number"
                        min="0"
                        step="any"
                        className="erp-form-input"
                        required
                        disabled={!canApplyPayment || actionBusy}
                        {...applyPaymentForm.register("paymentAmount")}
                      />
                    )}
                  </Field>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="submit"
                    className="pag-btn"
                    disabled={!canApplyPayment || actionBusy}
                    title={!canApplyPayment ? NO_APPLY_PAYMENT_PERMISSION : undefined}
                  >
                    Aplicar pago
                  </button>
                  <button
                    type="button"
                    className="pag-btn"
                    disabled={!canReversePayment || actionBusy || !selectedItem.payment_id}
                    title={!canReversePayment ? NO_REVERSE_PAYMENT_PERMISSION : undefined}
                    onClick={handleReversePayment}
                  >
                    Revertir pago
                  </button>
                  <button
                    type="button"
                    className="pag-btn"
                    disabled={!canViewCosts || actionBusy}
                    title={!canViewCosts ? NO_COSTS_PERMISSION : undefined}
                    onClick={handleCosts}
                  >
                    Ver costos
                  </button>
                </div>
              </form>

              {costsResult && (
                <div
                  style={{
                    marginTop: "10px",
                    padding: "10px",
                    borderRadius: "8px",
                    background: "var(--canvas-bg)",
                    fontSize: "12px",
                  }}
                >
                  {costsResult.length === 0 ? (
                    <span>Sin datos de costos registrados.</span>
                  ) : (
                    costsResult.map((row, idx) => (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "6px" }}>
                        <div>
                          <span style={{ color: "var(--text-muted)" }}>Valor declarado: </span>
                          <strong>{formatCurrency(row.intake_declared_value_base, "ARS")}</strong>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-muted)" }}>Valor tasado aceptado: </span>
                          <strong>{formatCurrency(row.accepted_value_base, "ARS")}</strong>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-muted)" }}>Reacondicionamiento: </span>
                          <strong>{formatCurrency(row.refurbishment_cost_base, "ARS")}</strong>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-muted)" }}>Costo total: </span>
                          <strong>{formatCurrency(row.total_cost_base, "ARS")}</strong>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={closeIntakeModal}
        title="Recibir equipo en parte de pago"
        subtitle="Alta formal con declaración de procedencia"
        icon={Smartphone}
        maxWidth="560px"
        scrollBody
      >
        <form
          onSubmit={intakeForm.handleSubmit(handleIntake)}
          noValidate
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          <FormError message={intakeError} onDismiss={() => setIntakeError(null)} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field label="Sucursal" required error={intakeForm.formState.errors.branchId?.message}>
              {(a11y) => (
                <select
                  {...a11y}
                  required
                  className="erp-form-select"
                  {...intakeForm.register("branchId")}
                >
                  <option value="">Seleccionar sucursal…</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.code} · {branch.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Cliente" required error={intakeForm.formState.errors.customerId?.message}>
              {(a11y) => (
                <select
                  {...a11y}
                  required
                  className="erp-form-select"
                  {...intakeForm.register("customerId")}
                >
                  <option value="">Seleccionar cliente…</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.code} · {customer.display_name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {isLoadingIntakeOptions && (
                <StatePanel
                  type="loading"
                  title="Buscando productos elegibles"
                  message="Consultando productos activos con seguimiento por serie o IMEI…"
                />
              )}
              {!isLoadingIntakeOptions && intakeOptionsError && (
                <StatePanel
                  type="error"
                  title="No se pudieron cargar los productos"
                  message={intakeOptionsError}
                  action={
                    <button type="button" className="pag-btn" onClick={() => void refreshIntakeOptions()}>
                      Reintentar
                    </button>
                  }
                />
              )}
              {!isLoadingIntakeOptions && !intakeOptionsError && tradeInProducts.length === 0 && (
                <StatePanel
                  type="empty"
                  title="No hay productos elegibles"
                  message="Para recibir un equipo usado, necesitás un producto activo de tipo producto con seguimiento por serie o IMEI. Revisá o configurá el producto en Inventario › Productos."
                />
              )}
              <Field
                label="Producto compatible"
                required
                hint="Sólo se muestran productos activos con unidad física identificable."
                error={intakeForm.formState.errors.productId?.message}
              >
                {(a11y) => (
                  <select
                    {...a11y}
                    required
                    className="erp-form-select"
                    disabled={isLoadingIntakeOptions || Boolean(intakeOptionsError) || tradeInProducts.length === 0}
                    {...intakeForm.register("productId", {
                      onChange: () => {
                        intakeForm.setValue("variantId", "");
                        intakeForm.setValue("deviceSerial", "");
                        intakeForm.setValue("deviceImei", "");
                        intakeForm.clearErrors(["deviceSerial", "deviceImei", "variantId"]);
                      },
                    })}
                  >
                    <option value="">Seleccionar producto serial/IMEI…</option>
                    {tradeInProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.internal_code} · {product.internal_name} ·{" "}
                        {product.inventory_tracking === "imei" ? "IMEI" : "Serie"}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <Field label="Variante (ID, opcional)" error={intakeForm.formState.errors.variantId?.message}>
              {(a11y) => (
                <input
                  {...a11y}
                  type="text"
                  className="erp-form-input"
                  placeholder="UUID de variante"
                  {...intakeForm.register("variantId")}
                />
              )}
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field
              label="Serie del equipo"
              required={selectedProduct?.inventory_tracking === "serial"}
              error={intakeForm.formState.errors.deviceSerial?.message}
            >
              {(a11y) => (
                <input
                  {...a11y}
                  type="text"
                  className="erp-form-input"
                  placeholder={
                    selectedProduct?.inventory_tracking === "serial"
                      ? "Nro de serie obligatorio"
                      : "Nro de serie (opcional)"
                  }
                  required={selectedProduct?.inventory_tracking === "serial"}
                  {...intakeForm.register("deviceSerial")}
                />
              )}
            </Field>
            <Field
              label="IMEI (14-16 dígitos)"
              required={selectedProduct?.inventory_tracking === "imei"}
              error={intakeForm.formState.errors.deviceImei?.message}
            >
              {(a11y) => (
                <input
                  {...a11y}
                  type="text"
                  className="erp-form-input"
                  placeholder={selectedProduct?.inventory_tracking === "imei" ? "IMEI obligatorio" : "Opcional"}
                  required={selectedProduct?.inventory_tracking === "imei"}
                  {...intakeForm.register("deviceImei")}
                />
              )}
            </Field>
          </div>

          <Field
            label="Titular del equipo"
            required
            error={intakeForm.formState.errors.ownerName?.message}
          >
            {(a11y) => (
              <input
                {...a11y}
                type="text"
                required
                className="erp-form-input"
                placeholder="Nombre de quien entrega"
                {...intakeForm.register("ownerName")}
              />
            )}
          </Field>

          <Field
            label="Declaración de procedencia"
            required
            error={intakeForm.formState.errors.declarationText?.message}
          >
            {(a11y) => (
              <textarea
                {...a11y}
                rows={3}
                required
                className="erp-form-textarea"
                placeholder="Declaro que el equipo es de mi propiedad y de origen lícito…"
                {...intakeForm.register("declarationText")}
              />
            )}
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field
              label="Valor declarado (base)"
              required
              error={intakeForm.formState.errors.declaredValue?.message}
            >
              {(a11y) => (
                <input
                  {...a11y}
                  type="number"
                  required
                  min="0"
                  step="any"
                  className="erp-form-input"
                  placeholder="Ej: 350000"
                  {...intakeForm.register("declaredValue", {
                    onChange: () => intakeForm.setValue("confirmZeroDeclaredValue", false),
                  })}
                />
              )}
            </Field>
            <Field label="Documento de evidencia" error={intakeForm.formState.errors.evidenceDoc?.message}>
              {(a11y) => (
                <input
                  {...a11y}
                  type="text"
                  className="erp-form-input"
                  placeholder="Referencia opcional"
                  {...intakeForm.register("evidenceDoc")}
                />
              )}
            </Field>
          </div>

          {isZeroAmount(watchedDeclaredValue) && (
            <Field
              label="Confirmo el valor declarado de $0"
              required
              error={intakeForm.formState.errors.confirmZeroDeclaredValue?.message}
            >
              {(a11y) => (
                <input
                  {...a11y}
                  type="checkbox"
                  required
                  {...intakeForm.register("confirmZeroDeclaredValue")}
                />
              )}
            </Field>
          )}

          <Field label="Motivo operativo" error={intakeForm.formState.errors.intakeReason?.message}>
            {(a11y) => (
              <input
                {...a11y}
                type="text"
                className="erp-form-input"
                placeholder="Ej: Recepción en mostrador"
                {...intakeForm.register("intakeReason")}
              />
            )}
          </Field>

          <div className="erp-modal-footer">
            <button type="button" className="btn-secondary" onClick={closeIntakeModal} disabled={actionBusy}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={actionBusy || isLoadingIntakeOptions || Boolean(intakeOptionsError) || tradeInProducts.length === 0}
            >
              {actionBusy ? "Registrando…" : "Registrar recepción"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
