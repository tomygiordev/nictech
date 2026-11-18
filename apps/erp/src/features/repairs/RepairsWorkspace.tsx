import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { repairNoteSchema, type RepairNoteInput } from "./schemas";
import { RepairIntakeModal } from "./RepairIntakeModal";
import { RepairLaborModal } from "./RepairLaborModal";
import { RepairPaymentModal } from "./RepairPaymentModal";
import { RepairPartModal } from "./RepairPartModal";
import { RepairDeliveryModal } from "./RepairDeliveryModal";
import { RepairWarrantyClaimModal } from "./RepairWarrantyClaimModal";
import {
  Wrench,
  Search,
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  Smartphone,
  FileText,
  Phone,
  Send,
  Loader2,
  RefreshCw,
  Edit2,
  ClipboardCheck,
  ShieldCheck,
  Eye,
  FileCheck,
  ShieldAlert,
  Award,
  RotateCcw,
  User,
  CheckCircle,
  XCircle,
  Banknote,
  BriefcaseBusiness,
} from "lucide-react";
import {
  WorkspaceHeader,
  WorkspaceModuleTabs,
  StatePanel,
  Modal,
  FeedbackAlert,
  KpiCard,
  ConfirmDialog,
} from "../../components/erp/WorkspaceUi";
import { Field, FormError } from "../../components/erp/FormFeedback";
import { type ErpModuleId } from "@nictech/domain";
import { formatCurrency, formatDate, formatDateTime } from "../../lib/formatters";
import { REPAIR_STATUS_LABELS, labelOf } from "../../lib/labels";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { supabase } from "../../lib/supabase";
import { toUserMessage } from "../../lib/errors";
import {
  listRepairOrders,
  listRepairStateEvents,
  listRepairNotes,
  searchRepairsByDocument,
  addRepairNote,
  type RepairNote,
  listAvailableTransitions,
  transitionRepairOrder,
  getActiveTestTemplate,
  recordRepairTestRun,
  listRepairTestRuns,
  reverseRepairPart,
  listRepairParts,
  listWarranties,
  listWarrantyClaims,
  listRepairLabor,
  listRepairPayments,
  reverseRepairPayment,
  type RepairOrderOverview,
  type RepairStateEvent,
  type RepairTransitionOption,
  type TestRunRecord,
  type WarrantyRecord,
  type WarrantyClaimRecord,
  type ConsumedPartRecord,
  type TestTemplateVersion,
  type RepairLaborRecord,
  type RepairPaymentRecord,
} from "./api";

const operationKey = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

const STATUS_PILL_CLASSES: Record<string, string> = {
  received: "flow-status-pill pending",
  diagnosis: "flow-status-pill processing",
  waiting_parts: "flow-status-pill processing",
  repair: "flow-status-pill processing",
  ready: "flow-status-pill completed",
  delivered: "flow-status-pill completed",
};

const formatRepairStatus = (
  statusName?: string | null,
  statusCode?: string | null,
  isDelivered?: boolean,
): string => {
  if (isDelivered) return REPAIR_STATUS_LABELS.delivered;
  const byName = statusName ? labelOf(REPAIR_STATUS_LABELS, statusName, "") : "";
  if (byName) return byName;
  const byCode = statusCode ? labelOf(REPAIR_STATUS_LABELS, statusCode, "") : "";
  if (byCode) return byCode;
  return statusName || "Sin estado";
};

export interface RepairsWorkspaceProps {
  activeModuleId?: "repairs" | "repair-tests" | "warranties";
  onSelectModule?: (id: ErpModuleId) => void;
}

export const RepairsWorkspace: React.FC<RepairsWorkspaceProps> = ({
  activeModuleId = "repairs",
  onSelectModule,
}) => {
  const { organizationId, branchIds, hasPermission } = useErpAuth();
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; branch_id: string; name: string; code: string }>>([]);

  // Repairs list state
  const [repairs, setRepairs] = useState<RepairOrderOverview[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("active");
  const [search, setSearch] = useState<string>("");
  const [documentMatches, setDocumentMatches] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    const document = search.trim();
    setDocumentMatches([]);
    if (!/^[0-9]{7,8}$/.test(document) || !hasPermission("customers.view_sensitive")) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchRepairsByDocument(document).then((ids) => {
        if (!cancelled) setDocumentMatches(ids);
      }).catch(() => {
        if (!cancelled) setFeedback({ type: "error", message: "No se pudo buscar por DNI." });
      });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [search, hasPermission]);

  // Selected Ticket Detail & Tabs
  const [selectedTicket, setSelectedTicket] = useState<RepairOrderOverview | null>(null);
  const detailRequest = useRef(0);
  const [ticketNotes, setTicketNotes] = useState<RepairNote[]>([]);
  const noteForm = useForm<RepairNoteInput>({ resolver: zodResolver(repairNoteSchema), defaultValues: { content: "", isPublic: false } });
  const { reset: resetNoteForm } = noteForm;
  const [ticketEvents, setTicketEvents] = useState<RepairStateEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState<boolean>(false);
  const [availableTransitions, setAvailableTransitions] = useState<RepairTransitionOption[]>([]);
  const [ticketParts, setTicketParts] = useState<ConsumedPartRecord[]>([]);
  const [ticketLabor, setTicketLabor] = useState<RepairLaborRecord[]>([]);
  const [ticketPayments, setTicketPayments] = useState<RepairPaymentRecord[]>([]);
  const [loadingParts, setLoadingParts] = useState<boolean>(false);
  const [loadingWork, setLoadingWork] = useState<boolean>(false);
  const [detailTab, setDetailTab] = useState<"info" | "parts" | "work" | "history">("info");

  useEffect(() => {
    resetNoteForm({ content: "", isPublic: false });
  }, [selectedTicket?.id, resetNoteForm]);

  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);

  // QC Test Modal
  const [isQcModalOpen, setIsQcModalOpen] = useState<boolean>(false);
  const [qcTargetTicket, setQcTargetTicket] = useState<RepairOrderOverview | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<TestTemplateVersion | null>(null);
  const [qcChecks, setQcChecks] = useState<Record<string, "pass" | "fail">>({});
  const [qcNotes, setQcNotes] = useState<string>("");
  const [submittingQc, setSubmittingQc] = useState<boolean>(false);
  const [qcError, setQcError] = useState<string | null>(null);

  // Transition confirmation dialog
  const [pendingTransition, setPendingTransition] = useState<RepairTransitionOption | null>(null);
  const [transitionNote, setTransitionNote] = useState<string>("");
  const [submittingTransition, setSubmittingTransition] = useState<boolean>(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const [isPartModalOpen, setIsPartModalOpen] = useState(false);
  const [isLaborModalOpen, setIsLaborModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const canRecordPayment = hasPermission("repairs.manage");
  const canRecordLabor = canRecordPayment && hasPermission("costs.manage");
  const canConsumePart = canRecordPayment && hasPermission("stock.move");

  const [paymentToReverse, setPaymentToReverse] = useState<RepairPaymentRecord | null>(null);
  const [reversingPayment, setReversingPayment] = useState(false);
  const [reversalOperationKey, setReversalOperationKey] = useState(() => operationKey("repair-payment-reversal"));

  // Delivery Modal
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState<boolean>(false);

  // Sub-sections states
  const [testRuns, setTestRuns] = useState<TestRunRecord[]>([]);
  const [loadingTests, setLoadingTests] = useState<boolean>(false);
  const [warranties, setWarranties] = useState<WarrantyRecord[]>([]);
  const [loadingWarranties, setLoadingWarranties] = useState<boolean>(false);
  const [claims, setClaims] = useState<WarrantyClaimRecord[]>([]);
  const [isClaimModalOpen, setIsClaimModalOpen] = useState<boolean>(false);

  // Fetch all repairs
  const fetchRepairsData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listRepairOrders();
      setRepairs(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al consultar reparaciones";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRepairsData();
  }, [fetchRepairsData]);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    const loadOperatingContext = async () => {
      try {
        const [branchResult, locationResult] = await Promise.all([
          supabase.from("branches").select("id,name,code").eq("is_active", true).order("name"),
          supabase.from("locations").select("id,branch_id,name,code").eq("is_active", true).order("name"),
        ]);
        if (branchResult.error) throw branchResult.error;
        if (locationResult.error) throw locationResult.error;
        if (cancelled) return;
        const nextBranches = (branchResult.data || []) as Array<{ id: string; name: string; code: string }>;
        const nextLocations = (locationResult.data || []) as Array<{ id: string; branch_id: string; name: string; code: string }>;
        setBranches(nextBranches);
        setLocations(nextLocations);
      } catch (contextError) {
        if (!cancelled) {
          setError(contextError instanceof Error ? contextError.message : "No se pudo cargar sucursales y ubicaciones.");
        }
      }
    };
    void loadOperatingContext();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  // Fetch ticket details when selecting a ticket
  const loadTicketDetails = useCallback(async (ticket: RepairOrderOverview) => {
    const requestId = ++detailRequest.current;
    try {
      setLoadingEvents(true);
      setLoadingParts(true);
      setLoadingWork(true);
      const [events, notes, transitions, parts, labor, payments] = await Promise.all([
        listRepairStateEvents(ticket.id),
        listRepairNotes(ticket.id),
        listAvailableTransitions(ticket.status_id),
        listRepairParts(ticket.id),
        hasPermission("costs.view") ? listRepairLabor(ticket.id) : Promise.resolve([]),
        listRepairPayments(ticket.id),
      ]);
      if (requestId !== detailRequest.current) return;
      setTicketEvents(events);
      setTicketNotes(notes);
      setAvailableTransitions(transitions);
      setTicketParts(parts);
      setTicketLabor(labor);
      setTicketPayments(payments);
    } catch (e) {
      if (requestId !== detailRequest.current) return;
      setFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "No se pudo cargar el detalle de la reparación.",
      });
    } finally {
      if (requestId === detailRequest.current) {
        setLoadingEvents(false);
        setLoadingParts(false);
        setLoadingWork(false);
      }
    }
  }, [hasPermission]);

  const handleSelectTicket = (ticket: RepairOrderOverview) => {
    setTicketEvents([]);
    setTicketNotes([]);
    setTicketParts([]);
    setTicketLabor([]);
    setTicketPayments([]);
    setAvailableTransitions([]);
    setSelectedTicket(ticket);
    setDetailTab("info");
    void loadTicketDetails(ticket);
  };

  // Handle Transition
  const requestTransition = (transition: RepairTransitionOption) => {
    if (!selectedTicket) return;

    // Gate: if transition requires final tests and QC has not passed, block and prompt QC
    if (transition.requires_final_tests && !selectedTicket.qc_passed) {
      setFeedback({
        type: "error",
        message: "Para avanzar a este estado es obligatorio completar y aprobar el control de calidad final.",
      });
      void openQcModal(selectedTicket);
      return;
    }

    setTransitionNote("");
    setTransitionError(null);
    setPendingTransition(transition);
  };

  const confirmTransition = async () => {
    if (!selectedTicket || !pendingTransition || submittingTransition) return;
    const targetLabel = formatRepairStatus(pendingTransition.to_status_name, pendingTransition.to_status_code);
    const trimmedNote = transitionNote.trim();

    try {
      setSubmittingTransition(true);
      setTransitionError(null);
      await transitionRepairOrder(
        selectedTicket.id,
        pendingTransition.to_status_id,
        trimmedNote || undefined,
        trimmedNote || `Transición a ${targetLabel}`,
      );
      setPendingTransition(null);
      setTransitionNote("");
      setFeedback({ type: "success", message: `Orden ${selectedTicket.order_code} avanzada a "${targetLabel}".` });
      await fetchRepairsData();
      const updatedList = await listRepairOrders();
      const updated = updatedList.find((r) => r.id === selectedTicket.id);
      if (updated) {
        setSelectedTicket(updated);
        void loadTicketDetails(updated);
      }
    } catch (err) {
      setTransitionError(toUserMessage(err, "No se pudo actualizar el estado de la reparación. Reintentá."));
    } finally {
      setSubmittingTransition(false);
    }
  };

  // Open QC Modal
  const openQcModal = async (ticket: RepairOrderOverview) => {
    setQcTargetTicket(ticket);
    setQcError(null);
    try {
      const template = await getActiveTestTemplate("final");
      setActiveTemplate(template);
      setQcChecks({});
      setQcNotes("");
      setIsQcModalOpen(true);
    } catch (err) {
      setFeedback({ type: "error", message: toUserMessage(err, "Error al cargar plantilla de pruebas.") });
    }
  };

  // Submit QC Test Run
  const handleQcSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qcTargetTicket || !activeTemplate) return;
    setQcError(null);

    const requiredItems = activeTemplate.definition.filter((item) => item.required !== false);
    const resultsArray: Array<{ item_key: string; result: "pass" | "fail" }> = [];
    for (const item of requiredItems) {
      const result = qcChecks[item.key];
      if (!result) {
        setQcError("Registrá un resultado para cada control obligatorio antes de confirmar el control de calidad.");
        return;
      }
      resultsArray.push({ item_key: item.key, result });
    }

    if (resultsArray.length === 0) {
      setQcError("La plantilla de control de calidad no tiene controles obligatorios para registrar.");
      return;
    }

    try {
      setSubmittingQc(true);
      await recordRepairTestRun(qcTargetTicket.id, activeTemplate.id, resultsArray, qcNotes.trim() || undefined);

      const allPassed = resultsArray.every((r) => r.result === "pass");
      setFeedback({
        type: allPassed ? "success" : "error",
        message: allPassed
          ? `¡Control de calidad aprobado para ${qcTargetTicket.order_code}!`
          : `Control de calidad registrado con fallas para ${qcTargetTicket.order_code}. Se requiere corrección técnica.`,
      });
      setIsQcModalOpen(false);
      await fetchRepairsData();
      if (selectedTicket?.id === qcTargetTicket.id) {
        const updatedList = await listRepairOrders();
        const updated = updatedList.find((r) => r.id === selectedTicket.id);
        if (updated) {
          setSelectedTicket(updated);
          void loadTicketDetails(updated);
        }
      }
    } catch (err) {
      setQcError(toUserMessage(err, "No se pudo registrar el control de calidad. Reintentá."));
    } finally {
      setSubmittingQc(false);
    }
  };

  const handlePartConsumed = async (ticket: RepairOrderOverview) => {
    setFeedback({
      type: "success",
      message: `Repuesto consumido e incorporado a la orden ${ticket.order_code}. Nota: el control de calidad anterior queda invalidado y debe repetirse.`,
    });
    const requestId = detailRequest.current;
    let updated = ticket;
    try {
      const orders = await listRepairOrders();
      setRepairs(orders);
      updated = orders.find((order) => order.id === ticket.id) ?? ticket;
    } catch (error) {
      setError(toUserMessage(error, "El repuesto se descontó, pero no se pudo actualizar el listado de reparaciones."));
    }
    if (requestId === detailRequest.current) {
      setSelectedTicket(updated);
      void loadTicketDetails(updated);
    }
  };

  const handleReversePayment = async (payment: RepairPaymentRecord) => {
    if (!selectedTicket || reversingPayment) return;
    try {
      setReversingPayment(true);
      await reverseRepairPayment({
        paymentId: payment.id,
        refundCashSessionId: payment.cash_session_id,
        operationKey: reversalOperationKey,
        reason: "Reversión operativa de cobro de reparación",
      });
      setFeedback({ type: "success", message: "Cobro revertido mediante contramovimiento auditable." });
      setPaymentToReverse(null);
      await loadTicketDetails(selectedTicket);
    } catch (reversalError) {
      setFeedback({ type: "error", message: reversalError instanceof Error ? reversalError.message : "No se pudo revertir el cobro." });
    } finally {
      setReversingPayment(false);
    }
  };

  // Handle Part Reversal
  const handleReversePart = async (stockDocId: string) => {
    if (!selectedTicket) return;
    try {
      await reverseRepairPart(selectedTicket.id, stockDocId, "Reversión de repuesto");
      setFeedback({ type: "success", message: "Consumo de repuesto revertido y stock restaurado en almacén." });
      await fetchRepairsData();
      const updatedList = await listRepairOrders();
      const updated = updatedList.find((r) => r.id === selectedTicket.id);
      if (updated) {
        setSelectedTicket(updated);
        void loadTicketDetails(updated);
      }
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "Error al revertir consumo." });
    }
  };

  // Handle Formal Delivery
  const handleDelivered = async (recipientName: string, warrantyDays: number) => {
    if (!selectedTicket) return;
    const ticketId = selectedTicket.id;
    setFeedback({
      type: "success",
      message: warrantyDays > 0
        ? `¡Equipo entregado formalmente a ${recipientName}! Se emitió póliza de garantía por ${warrantyDays} días.`
        : `¡Equipo entregado formalmente a ${recipientName}!`,
    });
    await fetchRepairsData();
    const updatedList = await listRepairOrders();
    const updated = updatedList.find((r) => r.id === ticketId);
    if (updated) {
      setSelectedTicket(updated);
      void loadTicketDetails(updated);
    }
  };

  // Load Test Runs Tab
  const loadTestRunsSection = useCallback(async () => {
    try {
      setLoadingTests(true);
      const data = await listRepairTestRuns();
      setTestRuns(data);
    } catch (e) {
      setFeedback({ type: "error", message: e instanceof Error ? e.message : "No se pudo cargar el historial de controles. Volvé a ingresar a la sección para reintentar." });
    } finally {
      setLoadingTests(false);
    }
  }, []);

  // Load Warranties Tab
  const loadWarrantiesSection = useCallback(async () => {
    try {
      setLoadingWarranties(true);
      const [wList, cList] = await Promise.all([listWarranties(), listWarrantyClaims()]);
      setWarranties(wList);
      setClaims(cList);
    } catch (e) {
      setFeedback({ type: "error", message: e instanceof Error ? e.message : "No se pudieron cargar las garantías. Volvé a ingresar a la sección para reintentar." });
    } finally {
      setLoadingWarranties(false);
    }
  }, []);

  useEffect(() => {
    if (activeModuleId === "repair-tests") void loadTestRunsSection();
    if (activeModuleId === "warranties") void loadWarrantiesSection();
  }, [activeModuleId, loadTestRunsSection, loadWarrantiesSection]);

  // Filtered repairs
  const filteredRepairs = useMemo(() => {
    return repairs.filter((r) => {
      const matchFilter =
        activeFilter === "active"
          ? !r.delivery_id
          : activeFilter === "delivered"
          ? Boolean(r.delivery_id)
          : activeFilter === "ready"
          ? r.status_code === "ready" && !r.delivery_id
          : r.status_code === activeFilter;

      const q = search.trim().toLowerCase();
      const matchSearch =
        !search.trim() ||
        r.order_code.toLowerCase().includes(q) ||
        r.public_tracking_code.toLowerCase().includes(q) ||
        documentMatches.includes(r.id) ||
        r.customer_name.toLowerCase().includes(q) ||
        (r.customer_phone && r.customer_phone.includes(q)) ||
        r.model_snapshot.toLowerCase().includes(q) ||
        r.reported_fault.toLowerCase().includes(q);

      return matchFilter && matchSearch;
    });
  }, [repairs, activeFilter, search, documentMatches]);

  // KPIs
  const activeTallerCount = repairs.filter((r) => !r.delivery_id && r.status_code !== "ready" && r.status_code !== "delivered").length;
  const readyCount = repairs.filter((r) => r.status_code === "ready" && !r.delivery_id).length;
  const qcPassedCount = repairs.filter((r) => r.qc_passed).length;
  const deliveredWithWarrantyCount = repairs.filter((r) => Boolean(r.delivery_id && r.warranty_id)).length;
  const requiredQcItems = activeTemplate?.definition.filter((item) => item.required !== false) ?? [];
  const completedQcItems = requiredQcItems.filter((item) => Boolean(qcChecks[item.key])).length;
  const isQcComplete =
    requiredQcItems.length > 0 && completedQcItems === requiredQcItems.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <WorkspaceHeader
        title="Taller & Servicio Técnico"
        description="Gestión integral de órdenes de reparación, controles de calidad obligatorios, consumo de repuestos y pólizas de garantía."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => setIsNewModalOpen(true)}
          >
            <Plus size={16} /> Nueva Reparación
          </button>
        }
      />

      <WorkspaceModuleTabs
        moduleIds={["repairs", "repair-tests", "warranties"] as const}
        activeModuleId={activeModuleId}
        onSelectModule={(id) => onSelectModule?.(id)}
      />

      {feedback && (
        <FeedbackAlert
          type={feedback.type}
          message={feedback.message}
          onClose={() => setFeedback(null)}
        />
      )}

      {/* VIEW: REPAIRS MAIN WORKSHOP */}
      {activeModuleId === "repairs" && (
        <>
          <div className="kpi-grid">
            <KpiCard
              icon={Wrench}
              iconVariant="amber"
              label="Equipos en Mesa Taller"
              value={activeTallerCount}
              trend={{ text: "En proceso", positive: true }}
              sublabel="Órdenes activas en diagnóstico/reparación"
            />
            <KpiCard
              icon={CheckCircle2}
              iconVariant="green"
              label="Listos para Retirar"
              value={readyCount}
              trend={{ text: "Esperando cliente", positive: true }}
              sublabel="Con control final aprobado, pendientes de retiro"
            />
            <KpiCard
              icon={ClipboardCheck}
              iconVariant="navy"
              label="Control final aprobado"
              value={qcPassedCount}
              trend={{ text: "Conformidad técnica", positive: true }}
              sublabel="Equipos que superaron control final"
            />
            <KpiCard
              icon={ShieldCheck}
              iconVariant="steel"
              label="Entregados con Garantía"
              value={deliveredWithWarrantyCount}
              trend={{ text: "Pólizas emitidas", positive: true }}
              sublabel="Entregas con póliza de garantía emitida"
            />
          </div>

          <div className="flow-card">
            <div className="flow-card__header">
              <div>
                <h2 className="flow-card__title">
                  {activeFilter === "delivered" ? "Reparaciones Entregadas" : "Órdenes de Reparación Activas"}
                </h2>
                <p className="flow-card__subtitle">
                  {activeFilter === "delivered"
                    ? "Órdenes con retiro formal registrado"
                    : "Trazabilidad completa desde ingreso hasta entrega con control de calidad"}
                </p>
              </div>
              <div className="flow-card__tools">
                <div className="search-box">
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder={hasPermission("customers.view_sensitive") ? "Buscar seguimiento, DNI, orden o cliente..." : "Buscar seguimiento, orden o cliente..."}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={fetchRepairsData}
                  title="Actualizar listado"
                >
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                </button>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flow-filter-bar" role="group" aria-label="Filtrar reparaciones por estado">
              {[
                { id: "active", label: "Activas" },
                { id: "received", label: REPAIR_STATUS_LABELS.received },
                { id: "diagnosis", label: REPAIR_STATUS_LABELS.diagnosis },
                { id: "waiting_parts", label: REPAIR_STATUS_LABELS.waiting_parts },
                { id: "repair", label: REPAIR_STATUS_LABELS.repair },
                { id: "ready", label: REPAIR_STATUS_LABELS.ready },
                { id: "delivered", label: REPAIR_STATUS_LABELS.delivered },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setActiveFilter(f.id)}
                  className={`btn-pill ${activeFilter === f.id ? "btn-pill--active" : ""}`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Table */}
            {loading ? (
              <div style={{ padding: "40px", textAlign: "center" }}>
                <Loader2 className="animate-spin" size={32} style={{ margin: "0 auto 12px" }} />
                <p>Cargando órdenes de taller...</p>
              </div>
            ) : filteredRepairs.length === 0 ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
                <Wrench size={40} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                <p>No se encontraron reparaciones para los filtros seleccionados.</p>
              </div>
            ) : (
              <div className="flow-table-container">
                <table className="flow-table flow-table--actions">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Fecha</th>
                      <th>Cliente</th>
                      <th>Dispositivo</th>
                      <th>Falla Declarada</th>
                      <th>Estado</th>
                      <th>Control de calidad</th>
                      <th>Presupuesto</th>
                      <th>Repuestos</th>
                      <th style={{ textAlign: "right" }}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRepairs.map((r) => {
                      const isDelivered = Boolean(r.delivery_id);
                      const statusPillClass = isDelivered
                        ? STATUS_PILL_CLASSES.delivered
                        : STATUS_PILL_CLASSES[r.status_code] || "flow-status-pill pending";

                      return (
                        <tr
                          key={r.id}
                          className="interactive-row"
                          role="button"
                          tabIndex={0}
                          aria-label={`Abrir reparación ${r.order_code} de ${r.customer_name}`}
                          onClick={() => handleSelectTicket(r)}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              handleSelectTicket(r);
                            }
                          }}
                        >
                          <td style={{ fontWeight: 700, color: "var(--accent-mint)" }}>
                            <div>{r.order_code}</div>
                            <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 500, fontFamily: "monospace" }}>
                              {r.public_tracking_code}
                            </div>
                          </td>
                          <td style={{ fontSize: "12px" }}>
                            {formatDate(r.opened_at)}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{r.customer_name}</div>
                            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                              {r.customer_phone || "Sin teléfono registrado"}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <Smartphone size={14} style={{ color: "var(--text-muted)" }} />
                              <span style={{ fontWeight: 600 }}>{r.brand_snapshot} {r.model_snapshot}</span>
                            </div>
                          </td>
                          <td style={{ maxWidth: "200px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: "12px" }} title={r.reported_fault}>
                            {r.reported_fault}
                          </td>
                          <td>
                            <span className={statusPillClass}>
                              {formatRepairStatus(r.status_name, r.status_code, isDelivered)}
                            </span>
                          </td>
                          <td>
                            {r.qc_passed ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "12px", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", fontSize: "11px", fontWeight: 600 }}>
                                <CheckCircle size={12} /> Aprobado
                              </span>
                            ) : (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "12px", background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b", fontSize: "11px", fontWeight: 600 }}>
                                <Clock size={12} /> Pendiente
                              </span>
                            )}
                          </td>
                          <td>
                            {r.latest_quote ? (
                              <div>
                                <div style={{ fontWeight: 600, fontSize: "12px" }}>
                                  {formatCurrency(r.latest_quote.total_amount, r.latest_quote.currency_code as "ARS" | "USD")}
                                </div>
                                <div style={{ fontSize: "10px", color: r.latest_quote.decision === "approved" ? "#10b981" : r.latest_quote.decision === "rejected" ? "#ef4444" : "var(--text-muted)" }}>
                                  {r.latest_quote.decision === "approved" ? "✓ Aceptado" : r.latest_quote.decision === "rejected" ? "✕ Rechazado" : "Enviado"}
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>—</span>
                            )}
                          </td>
                          <td>
                            <span style={{ fontSize: "12px", color: r.active_parts_count > 0 ? "var(--accent-mint)" : "var(--text-muted)" }}>
                              {r.active_parts_count} pieza{r.active_parts_count !== 1 ? "s" : ""}
                            </span>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className="btn-ghost"
                              style={{ padding: "4px 8px", fontSize: "12px" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectTicket(r);
                              }}
                            >
                              <Eye size={14} /> Ficha
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
        </>
      )}

      {/* VIEW: QC & TESTS TAB */}
      {activeModuleId === "repair-tests" && (
        <div className="flow-card">
          <div className="flow-card__header">
            <div>
              <h2 className="flow-card__title">Controles de calidad finales</h2>
              <p className="flow-card__subtitle">Registro inmutable de inspecciones de laboratorio y criterios de conformidad</p>
            </div>
          </div>

          {loadingTests ? (
            <div style={{ padding: "40px", textAlign: "center" }}>
              <Loader2 className="animate-spin" size={32} style={{ margin: "0 auto 12px" }} />
              <p>Cargando controles de calidad…</p>
            </div>
          ) : testRuns.length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              <ClipboardCheck size={40} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
              <p>Aún no hay protocolos de prueba registrados en el taller.</p>
            </div>
          ) : (
            <div className="flow-table-container">
              <table className="flow-table">
                <thead>
                  <tr>
                    <th>Secuencia</th>
                    <th>Orden</th>
                    <th>Tipo</th>
                    <th>Fecha de Inspección</th>
                    <th>Resultado General</th>
                    <th>Observaciones</th>
                  </tr>
                </thead>
                <tbody>
                  {testRuns.map((tr) => {
                    const allPassed = tr.results.every((r) => r.result === "pass");
                    return (
                      <tr key={tr.id}>
                        <td style={{ fontWeight: 700 }}>#{tr.run_sequence}</td>
                        <td style={{ color: "var(--accent-mint)", fontWeight: 600 }}>{tr.order_code || "—"}</td>
                        <td>
                          <span style={{ padding: "2px 8px", borderRadius: "10px", fontSize: "11px", background: "rgba(255,255,255,0.08)" }}>
                            {tr.kind === "final" ? "Prueba Final (Egreso)" : "Ingreso"}
                          </span>
                        </td>
                        <td style={{ fontSize: "12px" }}>{formatDateTime(tr.completed_at)}</td>
                        <td>
                          {allPassed ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 10px", borderRadius: "12px", background: "rgba(16, 185, 129, 0.2)", color: "#10b981", fontSize: "12px", fontWeight: 600 }}>
                              <CheckCircle size={14} /> 100% Conforme
                            </span>
                          ) : (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 10px", borderRadius: "12px", background: "rgba(239, 68, 68, 0.2)", color: "#ef4444", fontSize: "12px", fontWeight: 600 }}>
                              <XCircle size={14} /> Falla detectada
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: "12px", color: "var(--text-muted)" }}>{tr.run_notes || "Sin observaciones adicionales"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEW: WARRANTIES & RMA TAB */}
      {activeModuleId === "warranties" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div className="flow-card">
            <div className="flow-card__header">
              <div>
                <h2 className="flow-card__title">Pólizas de Garantía Emitidas</h2>
                <p className="flow-card__subtitle">Garantías derivadas de entregas formales con verificación de vigencia en tiempo real</p>
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setIsClaimModalOpen(true)}
              >
                <ShieldAlert size={16} /> Abrir reclamo de garantía
              </button>
            </div>

            {loadingWarranties ? (
              <div style={{ padding: "40px", textAlign: "center" }}>
                <Loader2 className="animate-spin" size={32} style={{ margin: "0 auto 12px" }} />
                <p>Cargando pólizas de garantía...</p>
              </div>
            ) : warranties.length === 0 ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
                <ShieldCheck size={40} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                <p>Aún no hay pólizas de garantía emitidas por entrega de taller.</p>
              </div>
            ) : (
              <div className="flow-table-container">
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>Orden</th>
                      <th>Cliente</th>
                      <th>Dispositivo</th>
                      <th>Inicio Cobertura</th>
                      <th>Vencimiento</th>
                      <th>Estado</th>
                      <th>Términos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warranties.map((w) => (
                      <tr key={w.id}>
                        <td style={{ fontWeight: 700, color: "var(--accent-mint)" }}>{w.order_code}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{w.customer_name}</div>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{w.customer_phone || "—"}</div>
                        </td>
                        <td style={{ fontWeight: 600 }}>{w.equipment_model}</td>
                        <td style={{ fontSize: "12px" }}>{formatDate(w.starts_at)}</td>
                        <td style={{ fontSize: "12px", fontWeight: 600 }}>{formatDate(w.ends_at)}</td>
                        <td>
                          {w.is_active ? (
                            <span style={{ padding: "3px 10px", borderRadius: "12px", background: "rgba(16, 185, 129, 0.2)", color: "#10b981", fontSize: "11px", fontWeight: 600 }}>
                              Vigente
                            </span>
                          ) : (
                            <span style={{ padding: "3px 10px", borderRadius: "12px", background: "rgba(239, 68, 68, 0.2)", color: "#ef4444", fontSize: "11px", fontWeight: 600 }}>
                              Vencida
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: "12px", maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={w.terms_snapshot}>
                          {w.terms_snapshot}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Claims History */}
          <div className="flow-card">
            <div className="flow-card__header">
              <div>
                <h3 className="flow-card__title">Reclamos de garantía registrados</h3>
                <p className="flow-card__subtitle">Historial independiente de reclamos sin alterar la orden de servicio previa</p>
              </div>
            </div>
            {claims.length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                No se encontraron reclamos de garantía en esta consulta.
              </div>
            ) : (
              <div className="flow-table-container">
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>Código de reclamo</th>
                      <th>Orden Origen</th>
                      <th>Cliente</th>
                      <th>Fecha Apertura</th>
                      <th>Falla Reclamada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((c) => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 700, color: "#f59e0b" }}>{c.claim_code}</td>
                        <td style={{ color: "var(--accent-mint)" }}>{c.order_code || "—"}</td>
                        <td>{c.customer_name || "—"}</td>
                        <td style={{ fontSize: "12px" }}>{formatDate(c.opened_at)}</td>
                        <td style={{ fontSize: "12px" }}>{c.reported_issue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: TICKET DETAIL & MANAGEMENT */}
      {selectedTicket && (
        <Modal
          isOpen={Boolean(selectedTicket)}
          onClose={() => { detailRequest.current++; setSelectedTicket(null); setTicketNotes([]); }}
          title={`Ficha de Reparación: ${selectedTicket.order_code}`}
          maxWidth="780px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Header info bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", border: "1px solid var(--border-line)" }}>
              <div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase" }}>Dispositivo</div>
                <div style={{ fontWeight: 700, fontSize: "16px" }}>{selectedTicket.brand_snapshot} {selectedTicket.model_snapshot}</div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Cliente: <strong>{selectedTicket.customer_name}</strong> ({selectedTicket.customer_phone || "sin teléfono registrado"})</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase" }}>Estado Actual</div>
                <div style={{ marginTop: "4px" }}>
                  <span className={selectedTicket.delivery_id ? STATUS_PILL_CLASSES.delivered : STATUS_PILL_CLASSES[selectedTicket.status_code] || "flow-status-pill pending"}>
                    {formatRepairStatus(selectedTicket.status_name, selectedTicket.status_code, Boolean(selectedTicket.delivery_id))}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", border: "1px solid var(--border-line)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  Código de seguimiento web:{" "}
                  <strong style={{ fontFamily: "monospace", fontSize: "14px", color: "var(--accent-mint)", letterSpacing: "0.04em" }}>
                    {selectedTicket.public_tracking_code}
                  </strong>
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  El cliente verá en <code style={{ fontSize: "11px" }}>/seguimiento</code>:{" "}
                  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "999px", background: "rgba(0, 168, 232, 0.14)", color: "#38bdf8", fontWeight: 600 }}>
                    {selectedTicket.status_public_stage
                      ? labelOf(REPAIR_STATUS_LABELS, selectedTicket.status_public_stage, selectedTicket.status_public_stage)
                      : "Sin etapa pública"}
                  </span>
                </div>
              </div>
              <button type="button" className="btn-ghost" onClick={() => window.print()}>
                <FileText size={14} /> Imprimir comprobante de ingreso
              </button>
              <div className="repair-print-receipt">
                <h1>Comprobante de ingreso — NicTech</h1>
                <p><strong>Orden:</strong> {selectedTicket.order_code}</p>
                <p><strong>Fecha de ingreso:</strong> {formatDateTime(selectedTicket.opened_at)}</p>
                <p><strong>Cliente:</strong> {selectedTicket.customer_name}</p>
                <p><strong>Equipo:</strong> {selectedTicket.brand_snapshot} {selectedTicket.model_snapshot}</p>
                <p><strong>Falla declarada:</strong> {selectedTicket.reported_fault}</p>
                <p><strong>Código de seguimiento:</strong> <strong>{selectedTicket.public_tracking_code}</strong></p>
                <p>
                  <strong>Estado web actual:</strong>{" "}
                  {selectedTicket.status_public_stage
                    ? labelOf(REPAIR_STATUS_LABELS, selectedTicket.status_public_stage, selectedTicket.status_public_stage)
                    : REPAIR_STATUS_LABELS.received}
                </p>
                <p>Consultá el estado en /seguimiento con este código o tu DNI.</p>
              </div>
              <style>{` .repair-print-receipt { display: none; } @media print { body * { visibility: hidden !important; } .repair-print-receipt, .repair-print-receipt * { visibility: visible !important; } .repair-print-receipt { display: block; position: fixed; inset: 0; padding: 24px; color: black; background: white; z-index: 99999; } } `}</style>
            </div>
            <section aria-label="Notas de reparación" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", border: "1px solid var(--border-line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>Notas de taller y seguimiento ({ticketNotes.length})</h3>
              </div>
              {ticketNotes.length === 0 ? (
                <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>Todavía no hay notas cargadas en esta orden.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "180px", overflowY: "auto" }}>
                  {ticketNotes.map((note) => (
                    <div key={note.id} style={{ padding: "8px 10px", borderRadius: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-line)", fontSize: "12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <span style={{ padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 600, background: note.is_public ? "rgba(16, 185, 129, 0.16)" : "rgba(148, 163, 184, 0.16)", color: note.is_public ? "#10b981" : "var(--text-muted)" }}>
                          {note.is_public ? "Pública · visible en /seguimiento" : "Interna · solo taller"}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{formatDateTime(note.created_at)}</span>
                      </div>
                      <p style={{ margin: 0 }}>{note.content}</p>
                    </div>
                  ))}
                </div>
              )}
              {hasPermission("repairs.manage") && <form style={{ display: "flex", flexDirection: "column", gap: "8px" }} onSubmit={noteForm.handleSubmit(async (values) => {
                const requestId = detailRequest.current;
                try {
                  await addRepairNote(selectedTicket.id, values.content, values.isPublic);
                  const notes = await listRepairNotes(selectedTicket.id);
                  if (requestId !== detailRequest.current) return;
                  setTicketNotes(notes);
                  noteForm.reset({ content: "", isPublic: false });
                } catch (error) {
                  if (requestId !== detailRequest.current) return;
                  setFeedback({ type: "error", message: error instanceof Error ? error.message : "No se pudo guardar la nota." });
                }
              })}>
                <label className="erp-form-group" style={{ margin: 0 }}>
                  Nueva nota
                  <textarea className="erp-form-input" rows={2} placeholder="Escribí una observación técnica o para el cliente..." {...noteForm.register("content")} />
                </label>
                {noteForm.formState.errors.content && <p role="alert" style={{ margin: 0, fontSize: "12px", color: "#ef4444" }}>{noteForm.formState.errors.content.message}</p>}
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
                    <input type="checkbox" {...noteForm.register("isPublic")} /> El cliente la ve en la web
                  </label>
                  <button type="submit" className="btn-primary" disabled={noteForm.formState.isSubmitting}>
                    {noteForm.formState.isSubmitting ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />} Guardar nota
                  </button>
                </div>
              </form>}
            </section>
            {/* Status Workflow Action Bar */}
            {!selectedTicket.delivery_id && (
              <div style={{ padding: "16px", background: "rgba(0, 168, 232, 0.05)", borderRadius: "8px", border: "1px solid rgba(0, 168, 232, 0.2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--accent-mint)" }}>Acciones de Transición de Ciclo</div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                      {availableTransitions.length > 0 ? "Seleccioná el próximo paso según protocolo de taller:" : "No hay transiciones automáticas pendientes."}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {availableTransitions.map((tr) => (
                      <button
                        key={tr.id}
                        type="button"
                        className="btn-primary"
                        style={{ padding: "6px 14px", fontSize: "12px" }}
                        onClick={() => requestTransition(tr)}
                      >
                        Avanzar a {formatRepairStatus(tr.to_status_name, tr.to_status_code)}
                      </button>
                    ))}
                    {selectedTicket.status_code === "ready" && !selectedTicket.delivery_id && (
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ background: "#10b981", borderColor: "#10b981", color: "#fff", padding: "6px 14px", fontSize: "12px" }}
                        onClick={() => setIsDeliveryModalOpen(true)}
                      >
                        <CheckCircle size={14} /> Entregar al Cliente
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ padding: "6px 12px", fontSize: "12px" }}
                      onClick={() => openQcModal(selectedTicket)}
                    >
                      <ClipboardCheck size={14} /> {selectedTicket.qc_passed ? "Reinspeccionar equipo" : "Iniciar control final"}
                    </button>
                  </div>
                </div>

                {/* QC Warning if not passed */}
                {!selectedTicket.qc_passed && (
                  <div style={{ marginTop: "10px", fontSize: "12px", color: "#f59e0b", display: "flex", alignItems: "center", gap: "6px" }}>
                    <AlertCircle size={14} />
                    <span>Control de Calidad: El equipo aún no tiene una prueba final aprobada para habilitar retiro.</span>
                  </div>
                )}
              </div>
            )}

            {/* Tab navigation inside ticket */}
            <div className="flow-detail-tabs" role="tablist" aria-label="Detalle de la reparación">
              <button
                type="button"
                role="tab"
                aria-selected={detailTab === "info"}
                className={`flow-detail-tab ${detailTab === "info" ? "active" : ""}`}
                onClick={() => setDetailTab("info")}
              >
                Información de Ingreso
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={detailTab === "parts"}
                className={`flow-detail-tab ${detailTab === "parts" ? "active" : ""}`}
                onClick={() => setDetailTab("parts")}
              >
                Repuestos & Stock ({ticketParts.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={detailTab === "history"}
                className={`flow-detail-tab ${detailTab === "history" ? "active" : ""}`}
                onClick={() => setDetailTab("history")}
              >
                Historial de Trazabilidad ({ticketEvents.length})
              </button>
            </div>

            {/* TAB CONTENT: INFO */}
            {detailTab === "info" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", fontSize: "13px" }}>
                <div>
                  <div style={{ color: "var(--text-muted)", marginBottom: "2px" }}>Falla Reportada:</div>
                  <div style={{ fontWeight: 600, padding: "8px", background: "rgba(255,255,255,0.02)", borderRadius: "4px" }}>
                    {selectedTicket.reported_fault}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-muted)", marginBottom: "2px" }}>Condición Frecuente / Estética:</div>
                  <div style={{ fontWeight: 600, padding: "8px", background: "rgba(255,255,255,0.02)", borderRadius: "4px" }}>
                    {selectedTicket.intake_condition || "Sin detalles"}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-muted)", marginBottom: "2px" }}>Daño Físico Visible:</div>
                  <div style={{ padding: "8px", background: "rgba(255,255,255,0.02)", borderRadius: "4px" }}>
                    {selectedTicket.intake_damage || "Ninguno declarado"}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-muted)", marginBottom: "2px" }}>Accesorios Recibidos:</div>
                  <div style={{ padding: "8px", background: "rgba(255,255,255,0.02)", borderRadius: "4px" }}>
                    {Array.isArray(selectedTicket.intake_accessories) && selectedTicket.intake_accessories.length > 0
                      ? selectedTicket.intake_accessories.join(", ")
                      : "Sin accesorios"}
                  </div>
                </div>
                {selectedTicket.delivery_id && (
                  <div style={{ gridColumn: "span 2", padding: "12px", background: "rgba(16, 185, 129, 0.1)", borderRadius: "6px", border: "1px solid rgba(16, 185, 129, 0.3)" }}>
                    <div style={{ fontWeight: 600, color: "#10b981" }}>Equipo Entregado Formalmente</div>
                    <div style={{ fontSize: "12px", marginTop: "4px" }}>
                      Retirado por <strong>{selectedTicket.recipient_name}</strong> el {formatDateTime(selectedTicket.delivered_at || "")}.
                      {selectedTicket.warranty_id && (
                        <span> Póliza de Garantía activa hasta el <strong>{formatDate(selectedTicket.warranty_ends_at || "")}</strong>.</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: PARTS */}
            {detailTab === "parts" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                    Repuestos imputados a esta orden y descontados del inventario:
                  </div>
                  {canConsumePart && !selectedTicket.delivery_id && (
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ padding: "4px 10px", fontSize: "12px" }}
                      onClick={() => setIsPartModalOpen(true)}
                    >
                      <Plus size={14} /> Consumir repuesto
                    </button>
                  )}
                </div>

                {loadingParts ? (
                  <div style={{ padding: "20px", textAlign: "center" }}><Loader2 className="animate-spin" size={24} /></div>
                ) : ticketParts.length === 0 ? (
                  <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                    No se han registrado repuestos consumidos para esta orden.
                  </div>
                ) : (
                  <div className="flow-table-container">
                    <table className="flow-table">
                      <thead>
                        <tr>
                          <th>Acción</th>
                          <th>Comprobante Stock</th>
                          <th>Fecha</th>
                          <th style={{ textAlign: "right" }}>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ticketParts.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <span style={{ padding: "2px 8px", borderRadius: "10px", fontSize: "11px", background: p.action === "consumed" ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)", color: p.action === "consumed" ? "#10b981" : "#ef4444" }}>
                                {p.action === "consumed" ? "Consumido" : "Revertido"}
                              </span>
                            </td>
                            <td style={{ fontSize: "12px", fontFamily: "monospace" }}>
                              {p.stock_document_id?.slice(0, 8) || "—"}
                            </td>
                            <td style={{ fontSize: "12px" }}>{formatDateTime(p.occurred_at)}</td>
                            <td style={{ textAlign: "right" }}>
                              {p.action === "consumed" && !selectedTicket.delivery_id && p.stock_document_id && (
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  style={{ padding: "2px 6px", fontSize: "11px", color: "#ef4444" }}
                                  onClick={() => handleReversePart(p.stock_document_id!)}
                                >
                                  <RotateCcw size={12} /> Revertir
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <section aria-label="Mano de obra y cobros">
              <h3>Mano de obra y cobros</h3>
              <div className="flow-tabs-nav">
                {canRecordLabor && <button type="button" className="btn-primary" onClick={() => setIsLaborModalOpen(true)}><BriefcaseBusiness size={16} /> Registrar trabajo</button>}
                {canRecordPayment && <button type="button" className="btn-primary" onClick={() => setIsPaymentModalOpen(true)}><Banknote size={16} /> Registrar cobro o seña</button>}
              </div>
              {loadingWork ? <p role="status">Cargando movimientos…</p> : <>
                {ticketLabor.map((labor) => <p key={labor.id}>{labor.description} · {labor.quantity_hours} h · costo {formatCurrency(labor.total_cost_base)}</p>)}
                {ticketPayments.map((payment) => <p key={payment.id}>
                  {formatDateTime(payment.occurred_at)} · {formatCurrency(payment.amount, payment.currency_code)} · {payment.reason}
                  {hasPermission("repairs.manage") && !payment.reversal_of_payment_id && !ticketPayments.some((entry) => entry.reversal_of_payment_id === payment.id) && <button type="button" className="btn-ghost" onClick={() => { setReversalOperationKey(operationKey("repair-payment-reversal")); setPaymentToReverse(payment); }}>Revertir cobro</button>}
                </p>)}
                {ticketLabor.length === 0 && ticketPayments.length === 0 && <p>No hay trabajos ni cobros registrados.</p>}
              </>}
            </section>
            <ConfirmDialog
              isOpen={paymentToReverse !== null}
              title="Revertir cobro"
              message={`Se registrará una devolución de ${paymentToReverse ? formatCurrency(paymentToReverse.amount, paymentToReverse.currency_code) : ""}. El cobro original se conservará en el historial. La caja debe estar abierta.`}
              confirmLabel="Confirmar reversión"
              isPending={reversingPayment}
              onCancel={() => { if (!reversingPayment) setPaymentToReverse(null); }}
              onConfirm={() => { if (paymentToReverse) void handleReversePayment(paymentToReverse); }}
            />

            {/* TAB CONTENT: HISTORY */}
            {detailTab === "history" && (
              <div>
                {loadingEvents ? (
                  <div style={{ padding: "20px", textAlign: "center" }}><Loader2 className="animate-spin" size={24} /></div>
                ) : ticketEvents.length === 0 ? (
                  <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                    Sin eventos registrados en la trazabilidad.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {ticketEvents.map((ev) => (
                      <div key={ev.id} style={{ display: "flex", gap: "12px", padding: "10px 14px", background: "rgba(255,255,255,0.02)", borderRadius: "6px" }}>
                        <Clock size={16} style={{ color: "var(--accent-mint)", marginTop: "2px", flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <strong style={{ fontSize: "13px" }}>{formatRepairStatus(ev.status_name, ev.status_code)}</strong>
                            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{formatDateTime(ev.occurred_at)}</span>
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>{ev.public_message}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      <RepairLaborModal
        isOpen={canRecordLabor && isLaborModalOpen}
        orderId={selectedTicket?.id}
        onClose={() => setIsLaborModalOpen(false)}
        onRecorded={() => {
          setFeedback({ type: "success", message: "Mano de obra registrada con trazabilidad de costos." });
          if (selectedTicket) void loadTicketDetails(selectedTicket);
        }}
      />
      <RepairPaymentModal
        isOpen={canRecordPayment && isPaymentModalOpen}
        orderId={selectedTicket?.id}
        branchId={selectedTicket?.branch_id}
        onClose={() => setIsPaymentModalOpen(false)}
        onRecorded={() => {
          setFeedback({ type: "success", message: "Cobro registrado y conciliado con la reparación." });
          if (selectedTicket) void loadTicketDetails(selectedTicket);
        }}
      />

      <RepairIntakeModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreated={(orderCode) => {
          setFeedback({ type: "success", message: `Orden ${orderCode} ingresada.` });
          void fetchRepairsData();
        }}
        branches={branches.filter((branch) => branchIds.includes(branch.id))}
        organizationId={organizationId}
        hasPermission={hasPermission}
      />

      {/* MODAL: QC TEST RUN */}
      {isQcModalOpen && activeTemplate && qcTargetTicket && (
        <Modal
          isOpen={isQcModalOpen}
          onClose={() => { if (!submittingQc) { setQcError(null); setIsQcModalOpen(false); } }}
          title={`Control de calidad: ${qcTargetTicket.order_code}`}
          maxWidth="580px"
        >
          <form onSubmit={handleQcSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: "6px" }}>
              Equipo: <strong>{qcTargetTicket.brand_snapshot} {qcTargetTicket.model_snapshot}</strong> | Plantilla: <strong>{activeTemplate.template_name}</strong>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {requiredQcItems.map((item) => (
                <div
                  key={item.key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 14px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: "6px",
                    border: "1px solid var(--border-line)",
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: "13px" }}>
                    {item.label}
                    {!qcChecks[item.key] && (
                      <span style={{ display: "block", color: "var(--text-muted)", fontSize: "11px", fontWeight: 500 }}>
                        Resultado pendiente
                      </span>
                    )}
                  </span>
                  <div style={{ display: "flex", gap: "8px" }} role="group" aria-label={`Resultado de ${item.label}`}>
                    <button
                      type="button"
                      onClick={() => setQcChecks((prev) => ({ ...prev, [item.key]: "pass" }))}
                      aria-pressed={qcChecks[item.key] === "pass"}
                      style={{
                        padding: "4px 12px",
                        borderRadius: "14px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        border: "1px solid #10b981",
                        background: qcChecks[item.key] === "pass" ? "#10b981" : "transparent",
                        color: qcChecks[item.key] === "pass" ? "#fff" : "#10b981",
                      }}
                    >
                      Aprobado
                    </button>
                    <button
                      type="button"
                      onClick={() => setQcChecks((prev) => ({ ...prev, [item.key]: "fail" }))}
                      aria-pressed={qcChecks[item.key] === "fail"}
                      style={{
                        padding: "4px 12px",
                        borderRadius: "14px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        border: "1px solid #ef4444",
                        background: qcChecks[item.key] === "fail" ? "#ef4444" : "transparent",
                        color: qcChecks[item.key] === "fail" ? "#fff" : "#ef4444",
                      }}
                    >
                      Falla
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <label htmlFor="repair-qc-notes" style={{ fontSize: "12px", color: "var(--text-muted)" }}>Notas de Inspección (opcional)</label>
              <textarea
                id="repair-qc-notes"
                className="form-input"
                rows={2}
                value={qcNotes}
                onChange={(e) => setQcNotes(e.target.value)}
                placeholder="Observaciones de laboratorio técnico..."
              />
            </div>

            <FormError message={qcError} />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => { if (!submittingQc) { setQcError(null); setIsQcModalOpen(false); } }}
                disabled={submittingQc}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={submittingQc || !isQcComplete}
              >
                {submittingQc ? <Loader2 className="animate-spin" size={16} /> : <ClipboardCheck size={16} />}
                {isQcComplete
                  ? "Guardar control de calidad"
                  : `Completar controles (${completedQcItems}/${requiredQcItems.length})`}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <RepairPartModal
        isOpen={canConsumePart && isPartModalOpen && !selectedTicket?.delivery_id}
        order={selectedTicket ?? undefined}
        locations={locations.filter((location) => location.branch_id === selectedTicket?.branch_id)}
        onClose={() => setIsPartModalOpen(false)}
        onConsumed={() => { if (selectedTicket) void handlePartConsumed(selectedTicket); }}
      />

      <RepairDeliveryModal
        isOpen={isDeliveryModalOpen}
        order={selectedTicket ?? undefined}
        onClose={() => setIsDeliveryModalOpen(false)}
        onDelivered={(recipientName, warrantyDays) => { void handleDelivered(recipientName, warrantyDays); }}
      />

      <RepairWarrantyClaimModal
        isOpen={isClaimModalOpen}
        warranties={warranties}
        onClose={() => setIsClaimModalOpen(false)}
        onCreated={(claimId) => {
          setFeedback({ type: "success", message: `Reclamo de garantía registrado con ID: ${claimId}` });
          void loadWarrantiesSection();
        }}
      />

      {pendingTransition && selectedTicket && (
        <Modal
          isOpen={Boolean(pendingTransition)}
          onClose={() => { if (!submittingTransition) { setTransitionError(null); setPendingTransition(null); } }}
          title={`Pasar a ${formatRepairStatus(pendingTransition.to_status_name, pendingTransition.to_status_code)}`}
          maxWidth="440px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <p style={{ margin: 0, fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.5 }}>
              Confirmá el cambio de estado de la orden <strong>{selectedTicket.order_code}</strong> a{" "}
              <strong>{formatRepairStatus(pendingTransition.to_status_name, pendingTransition.to_status_code)}</strong>.
            </p>
            <Field label="Nota (opcional)">
              {(a11y) => (
                <textarea
                  {...a11y}
                  className="erp-form-input"
                  rows={2}
                  value={transitionNote}
                  onChange={(e) => setTransitionNote(e.target.value)}
                  placeholder="Motivo o aclaración sobre el cambio de estado…"
                  disabled={submittingTransition}
                />
              )}
            </Field>
            <FormError message={transitionError} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="pag-btn"
                data-autofocus
                onClick={() => { setTransitionError(null); setPendingTransition(null); }}
                disabled={submittingTransition}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void confirmTransition()}
                disabled={submittingTransition}
              >
                {submittingTransition ? "Actualizando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
