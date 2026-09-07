import React, { useState, useEffect, useMemo, useCallback } from "react";
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
  Check,
  ClipboardCheck,
  ShieldCheck,
  Eye,
  FileCheck,
  ShieldAlert,
  Award,
  Package,
  RotateCcw,
  User,
  CheckCircle,
  XCircle,
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
import { type ErpModuleId } from "@nictech/domain";
import { formatCurrency, formatDate, formatDateTime } from "../../lib/formatters";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { supabase } from "../../lib/supabase";
import {
  listRepairOrders,
  listRepairStateEvents,
  listAvailableTransitions,
  intakeRepairOrder,
  transitionRepairOrder,
  getActiveTestTemplate,
  recordRepairTestRun,
  listRepairTestRuns,
  consumeRepairPart,
  reverseRepairPart,
  listRepairParts,
  deliverRepairOrder,
  listWarranties,
  listWarrantyClaims,
  openWarrantyClaim,
  type RepairOrderOverview,
  type RepairStateEvent,
  type RepairTransitionOption,
  type TestRunRecord,
  type WarrantyRecord,
  type WarrantyClaimRecord,
  type ConsumedPartRecord,
  type TestTemplateVersion,
} from "./api";

const STATUS_MAP: Record<string, { label: string; pillClass: string }> = {
  received: { label: "Recibido", pillClass: "flow-status-pill pending" },
  diagnosis: { label: "Diagnóstico", pillClass: "flow-status-pill processing" },
  repair: { label: "En Reparación", pillClass: "flow-status-pill processing" },
  ready: { label: "Listo para Retirar", pillClass: "flow-status-pill completed" },
  delivered: { label: "Entregado", pillClass: "flow-status-pill completed" },
};

export interface RepairsWorkspaceProps {
  activeModuleId?: "repairs" | "repair-tests" | "warranties";
  onSelectModule?: (id: ErpModuleId) => void;
}

export const RepairsWorkspace: React.FC<RepairsWorkspaceProps> = ({
  activeModuleId = "repairs",
  onSelectModule,
}) => {
  const { organizationId } = useErpAuth();
  const currentBranchId = "20000000-0000-0000-0000-000000000001";

  // Repairs list state
  const [repairs, setRepairs] = useState<RepairOrderOverview[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Selected Ticket Detail & Tabs
  const [selectedTicket, setSelectedTicket] = useState<RepairOrderOverview | null>(null);
  const [ticketEvents, setTicketEvents] = useState<RepairStateEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState<boolean>(false);
  const [availableTransitions, setAvailableTransitions] = useState<RepairTransitionOption[]>([]);
  const [ticketParts, setTicketParts] = useState<ConsumedPartRecord[]>([]);
  const [loadingParts, setLoadingParts] = useState<boolean>(false);
  const [detailTab, setDetailTab] = useState<"info" | "parts" | "history">("info");

  // New Repair Intake Modal & Form
  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);
  const [customers, setCustomers] = useState<Array<{ id: string; display_name: string; code: string; phone: string | null }>>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [isNewCustomer, setIsNewCustomer] = useState<boolean>(false);
  const [newCustomerName, setNewCustomerName] = useState<string>("");
  const [newCustomerDni, setNewCustomerDni] = useState<string>("");
  const [newCustomerPhone, setNewCustomerPhone] = useState<string>("");
  const [deviceType, setDeviceType] = useState<string>("Smartphone");
  const [deviceBrand, setDeviceBrand] = useState<string>("Apple");
  const [deviceModel, setDeviceModel] = useState<string>("");
  const [deviceSerial, setDeviceSerial] = useState<string>("");
  const [deviceImei, setDeviceImei] = useState<string>("");
  const [reportedFault, setReportedFault] = useState<string>("");
  const [intakeCondition, setIntakeCondition] = useState<string>("Buen estado general");
  const [intakeDamage, setIntakeDamage] = useState<string>("");
  const [intakeAccessories, setIntakeAccessories] = useState<string>("funda");
  const [intakeNotes, setIntakeNotes] = useState<string>("");
  const [submittingIntake, setSubmittingIntake] = useState<boolean>(false);

  // QC Test Modal
  const [isQcModalOpen, setIsQcModalOpen] = useState<boolean>(false);
  const [qcTargetTicket, setQcTargetTicket] = useState<RepairOrderOverview | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<TestTemplateVersion | null>(null);
  const [qcChecks, setQcChecks] = useState<Record<string, "pass" | "fail">>({});
  const [qcNotes, setQcNotes] = useState<string>("");
  const [submittingQc, setSubmittingQc] = useState<boolean>(false);

  // Part Consumption Modal
  const [isPartModalOpen, setIsPartModalOpen] = useState<boolean>(false);
  const [availableProducts, setAvailableProducts] = useState<Array<{ id: string; internal_name: string; internal_code: string }>>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [partQuantity, setPartQuantity] = useState<number>(1);
  const [partReason, setPartReason] = useState<string>("Reemplazo de módulo por reparación");
  const [submittingPart, setSubmittingPart] = useState<boolean>(false);

  // Delivery Modal
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState<boolean>(false);
  const [deliveryRecipientName, setDeliveryRecipientName] = useState<string>("");
  const [deliveryDocumentSuffix, setDeliveryDocumentSuffix] = useState<string>("");
  const [deliveryWarrantyDays, setDeliveryWarrantyDays] = useState<number>(90);
  const [deliveryWarrantyTerms, setDeliveryWarrantyTerms] = useState<string>("Garantía de 90 días sobre mano de obra y repuestos instalados.");
  const [submittingDelivery, setSubmittingDelivery] = useState<boolean>(false);

  // Sub-sections states
  const [testRuns, setTestRuns] = useState<TestRunRecord[]>([]);
  const [loadingTests, setLoadingTests] = useState<boolean>(false);
  const [warranties, setWarranties] = useState<WarrantyRecord[]>([]);
  const [loadingWarranties, setLoadingWarranties] = useState<boolean>(false);
  const [claims, setClaims] = useState<WarrantyClaimRecord[]>([]);
  const [isClaimModalOpen, setIsClaimModalOpen] = useState<boolean>(false);
  const [selectedWarrantyId, setSelectedWarrantyId] = useState<string>("");
  const [claimIssue, setClaimIssue] = useState<string>("");
  const [submittingClaim, setSubmittingClaim] = useState<boolean>(false);

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

  // Load customers for intake
  const loadCustomers = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("customers")
        .select("id, display_name, code, phone")
        .eq("is_active", true)
        .order("display_name", { ascending: true });
      setCustomers(data || []);
      if (data && data.length > 0 && !selectedCustomerId) {
        setSelectedCustomerId(data[0].id);
      }
    } catch (e) {
      console.warn("Aviso al cargar clientes:", e);
    }
  }, [selectedCustomerId]);

  // Load products for parts consumption
  const loadProducts = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("products")
        .select("id, internal_name, internal_code")
        .eq("is_active", true)
        .order("internal_name", { ascending: true });
      setAvailableProducts(data || []);
      if (data && data.length > 0 && !selectedProductId) {
        setSelectedProductId(data[0].id);
      }
    } catch (e) {
      console.warn("Aviso al cargar repuestos:", e);
    }
  }, [selectedProductId]);

  useEffect(() => {
    if (isNewModalOpen) void loadCustomers();
  }, [isNewModalOpen, loadCustomers]);

  useEffect(() => {
    if (isPartModalOpen) void loadProducts();
  }, [isPartModalOpen, loadProducts]);

  // Fetch ticket details when selecting a ticket
  const loadTicketDetails = useCallback(async (ticket: RepairOrderOverview) => {
    try {
      setLoadingEvents(true);
      setLoadingParts(true);
      const [events, transitions, parts] = await Promise.all([
        listRepairStateEvents(ticket.id),
        listAvailableTransitions(ticket.status_id),
        listRepairParts(ticket.id),
      ]);
      setTicketEvents(events);
      setAvailableTransitions(transitions);
      setTicketParts(parts);
    } catch (e) {
      console.error("Error al cargar detalles de la orden:", e);
    } finally {
      setLoadingEvents(false);
      setLoadingParts(false);
    }
  }, []);

  const handleSelectTicket = (ticket: RepairOrderOverview) => {
    setSelectedTicket(ticket);
    setDetailTab("info");
    void loadTicketDetails(ticket);
  };

  // Handle Intake
  const handleIntakeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceModel.trim() || !reportedFault.trim()) {
      setFeedback({ type: "error", message: "Modelo del equipo y falla reportada son obligatorios." });
      return;
    }

    try {
      setSubmittingIntake(true);
      let custId = selectedCustomerId;

      // Inline customer creation if needed
      if (isNewCustomer) {
        if (!newCustomerName.trim()) {
          setFeedback({ type: "error", message: "Ingrese el nombre del nuevo cliente." });
          return;
        }
        const { data: newCust, error: custErr } = await supabase
          .from("customers")
          .insert([
            {
              organization_id: "10000000-0000-0000-0000-000000000001",
              code: newCustomerDni.trim() || `CLI-${Date.now().toString().slice(-6)}`,
              kind: "person",
              display_name: newCustomerName.trim(),
              phone: newCustomerPhone.trim() || null,
              is_active: true,
            },
          ])
          .select("id")
          .single();

        if (custErr) throw custErr;
        custId = newCust.id;
      }

      const accessoriesArray = intakeAccessories
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      const result = await intakeRepairOrder({
        branchId: currentBranchId,
        customerId: custId,
        equipmentType: deviceType,
        brandName: deviceBrand,
        modelName: deviceModel.trim(),
        serialNumber: deviceSerial.trim() || undefined,
        imei: deviceImei.trim() || undefined,
        accessories: accessoriesArray,
        intakeCondition: intakeCondition.trim() || "Recibido en taller",
        intakeDamage: intakeDamage.trim() || undefined,
        intakeNotes: intakeNotes.trim() || undefined,
        reportedFault: reportedFault.trim(),
      });

      setFeedback({
        type: "success",
        message: `¡Orden de Servicio ingresada con éxito! Código: ${result.order_code}`,
      });
      setIsNewModalOpen(false);
      // Reset form
      setDeviceModel("");
      setDeviceSerial("");
      setDeviceImei("");
      setReportedFault("");
      setIntakeDamage("");
      setIntakeNotes("");
      setIsNewCustomer(false);
      setNewCustomerName("");
      setNewCustomerDni("");
      setNewCustomerPhone("");

      await fetchRepairsData();
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "Error al ingresar la orden." });
    } finally {
      setSubmittingIntake(false);
    }
  };

  // Handle Transition
  const handleTransition = async (transition: RepairTransitionOption) => {
    if (!selectedTicket) return;

    // Gate: if transition requires final tests and QC has not passed, block and prompt QC
    if (transition.requires_final_tests && !selectedTicket.qc_passed) {
      setFeedback({
        type: "error",
        message: "Para avanzar a este estado es obligatorio realizar y aprobar el Protocolo QC (Pruebas Finales).",
      });
      openQcModal(selectedTicket);
      return;
    }

    try {
      await transitionRepairOrder(
        selectedTicket.id,
        transition.to_status_id,
        `Avance de estado: ${transition.to_status_name}`,
        `Transición a ${transition.to_status_name}`
      );
      setFeedback({ type: "success", message: `Orden ${selectedTicket.order_code} avanzada a "${transition.to_status_name}".` });
      await fetchRepairsData();
      // Re-fetch current ticket
      const updatedList = await listRepairOrders();
      const updated = updatedList.find((r) => r.id === selectedTicket.id);
      if (updated) {
        setSelectedTicket(updated);
        void loadTicketDetails(updated);
      }
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "Error al actualizar estado." });
    }
  };

  // Open QC Modal
  const openQcModal = async (ticket: RepairOrderOverview) => {
    setQcTargetTicket(ticket);
    try {
      const template = await getActiveTestTemplate("final");
      setActiveTemplate(template);
      const initialChecks: Record<string, "pass" | "fail"> = {};
      (template?.definition || []).forEach((item) => {
        initialChecks[item.key] = "pass";
      });
      setQcChecks(initialChecks);
      setQcNotes("");
      setIsQcModalOpen(true);
    } catch (err) {
      setFeedback({ type: "error", message: "Error al cargar plantilla de pruebas." });
    }
  };

  // Submit QC Test Run
  const handleQcSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qcTargetTicket || !activeTemplate) return;

    try {
      setSubmittingQc(true);
      const resultsArray = Object.entries(qcChecks).map(([key, res]) => ({
        item_key: key,
        result: res,
      }));

      await recordRepairTestRun(qcTargetTicket.id, activeTemplate.id, resultsArray, qcNotes.trim() || undefined);

      const allPassed = resultsArray.every((r) => r.result === "pass");
      setFeedback({
        type: allPassed ? "success" : "error",
        message: allPassed
          ? `¡Protocolo QC completado y APROBADO para ${qcTargetTicket.order_code}!`
          : `Protocolo QC registrado con fallas para ${qcTargetTicket.order_code}. Se requiere corrección técnica.`,
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
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "Error al registrar QC." });
    } finally {
      setSubmittingQc(false);
    }
  };

  // Handle Part Consumption
  const handleConsumePartSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !selectedProductId) return;

    try {
      setSubmittingPart(true);
      const tallerLocationId = "30000000-0000-0000-0000-000000000002"; // Warehouse/Taller
      await consumeRepairPart(
        selectedTicket.id,
        tallerLocationId,
        selectedProductId,
        undefined,
        partQuantity,
        partReason.trim() || "Instalación de repuesto en taller"
      );

      setFeedback({
        type: "success",
        message: `Repuesto consumido e incorporado a la orden ${selectedTicket.order_code}. Nota: cualquier QC previo queda invalidado para garantizar control de calidad.`,
      });
      setIsPartModalOpen(false);
      await fetchRepairsData();
      const updatedList = await listRepairOrders();
      const updated = updatedList.find((r) => r.id === selectedTicket.id);
      if (updated) {
        setSelectedTicket(updated);
        void loadTicketDetails(updated);
      }
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "Error al consumir repuesto." });
    } finally {
      setSubmittingPart(false);
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
  const openDeliveryModal = () => {
    if (!selectedTicket) return;
    setDeliveryRecipientName(selectedTicket.customer_name);
    setDeliveryDocumentSuffix(selectedTicket.customer_code?.slice(-4) || "0000");
    setDeliveryWarrantyDays(90);
    setDeliveryWarrantyTerms("Garantía de 90 días sobre mano de obra y repuestos instalados en NicTech.");
    setIsDeliveryModalOpen(true);
  };

  const handleDeliverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !deliveryRecipientName.trim()) return;

    try {
      setSubmittingDelivery(true);
      await deliverRepairOrder(
        selectedTicket.id,
        deliveryRecipientName.trim(),
        deliveryDocumentSuffix.trim() || "0000",
        deliveryWarrantyDays,
        deliveryWarrantyTerms.trim()
      );

      setFeedback({
        type: "success",
        message: `¡Equipo entregado formalmente a ${deliveryRecipientName.trim()}! Se emitió póliza de garantía por ${deliveryWarrantyDays} días.`,
      });
      setIsDeliveryModalOpen(false);
      await fetchRepairsData();
      const updatedList = await listRepairOrders();
      const updated = updatedList.find((r) => r.id === selectedTicket.id);
      if (updated) {
        setSelectedTicket(updated);
        void loadTicketDetails(updated);
      }
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "Error al procesar la entrega." });
    } finally {
      setSubmittingDelivery(false);
    }
  };

  // Load Test Runs Tab
  const loadTestRunsSection = useCallback(async () => {
    try {
      setLoadingTests(true);
      const data = await listRepairTestRuns();
      setTestRuns(data);
    } catch (e) {
      console.warn("Aviso al cargar historial QC:", e);
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
      if (wList.length > 0 && !selectedWarrantyId) {
        setSelectedWarrantyId(wList[0].id);
      }
    } catch (e) {
      console.warn("Aviso al cargar garantías:", e);
    } finally {
      setLoadingWarranties(false);
    }
  }, [selectedWarrantyId]);

  useEffect(() => {
    if (activeModuleId === "repair-tests") void loadTestRunsSection();
    if (activeModuleId === "warranties") void loadWarrantiesSection();
  }, [activeModuleId, loadTestRunsSection, loadWarrantiesSection]);

  // Handle New Warranty Claim
  const handleOpenClaimSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWarrantyId || !claimIssue.trim()) return;

    try {
      setSubmittingClaim(true);
      const claimId = await openWarrantyClaim(selectedWarrantyId, claimIssue.trim());
      setFeedback({ type: "success", message: `Reclamo de garantía registrado con ID: ${claimId}` });
      setIsClaimModalOpen(false);
      setClaimIssue("");
      void loadWarrantiesSection();
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "Error al abrir reclamo." });
    } finally {
      setSubmittingClaim(false);
    }
  };

  // Filtered repairs
  const filteredRepairs = useMemo(() => {
    return repairs.filter((r) => {
      const matchFilter =
        activeFilter === "all"
          ? true
          : activeFilter === "delivered"
          ? Boolean(r.delivery_id)
          : activeFilter === "ready"
          ? r.status_code === "ready" && !r.delivery_id
          : r.status_code === activeFilter;

      const q = search.toLowerCase();
      const matchSearch =
        !search.trim() ||
        r.order_code.toLowerCase().includes(q) ||
        r.customer_name.toLowerCase().includes(q) ||
        (r.customer_phone && r.customer_phone.includes(q)) ||
        r.model_snapshot.toLowerCase().includes(q) ||
        r.reported_fault.toLowerCase().includes(q);

      return matchFilter && matchSearch;
    });
  }, [repairs, activeFilter, search]);

  // KPIs
  const activeTallerCount = repairs.filter((r) => !r.delivery_id && r.status_code !== "ready").length;
  const readyCount = repairs.filter((r) => r.status_code === "ready" && !r.delivery_id).length;
  const qcPassedCount = repairs.filter((r) => r.qc_passed).length;
  const deliveredCount = repairs.filter((r) => Boolean(r.delivery_id)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <WorkspaceHeader
        title="Taller & Servicio Técnico"
        description="Gestión integral de órdenes de reparación, protocolos QC obligatorios, consumo de repuestos y pólizas de garantía."
        badge="FASE D: Operativo"
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
        onSelectModule={(id) => onSelectModule?.(id as any)}
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
              sublabel="Con QC aprobado, pendientes de retiro"
            />
            <KpiCard
              icon={ClipboardCheck}
              iconVariant="navy"
              label="QC Verificados"
              value={qcPassedCount}
              trend={{ text: "Conformidad técnica", positive: true }}
              sublabel="Equipos que superaron control final"
            />
            <KpiCard
              icon={ShieldCheck}
              iconVariant="steel"
              label="Entregados con Garantía"
              value={deliveredCount}
              trend={{ text: "Pólizas emitidas", positive: true }}
              sublabel="Retiros formalmente concretados"
            />
          </div>

          <div className="flow-card">
            <div className="flow-card__header">
              <div>
                <h2 className="flow-card__title">Órdenes de Reparación Activas</h2>
                <p className="flow-card__subtitle">Trazabilidad completa desde ingreso hasta entrega con control de calidad</p>
              </div>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <div className="search-box">
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="Buscar orden, cliente, modelo o falla..."
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
            <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--border-line)", display: "flex", gap: "8px", overflowX: "auto" }}>
              {[
                { id: "all", label: "Todas" },
                { id: "received", label: "Recibidos" },
                { id: "diagnosis", label: "En Diagnóstico" },
                { id: "repair", label: "En Reparación" },
                { id: "ready", label: "Listos para Retirar" },
                { id: "delivered", label: "Entregados" },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setActiveFilter(f.id)}
                  className={`btn-pill ${activeFilter === f.id ? "btn-pill--active" : ""}`}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "20px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    border: "1px solid var(--border-line)",
                    background: activeFilter === f.id ? "var(--accent-mint)" : "transparent",
                    color: activeFilter === f.id ? "#000" : "var(--text-muted)",
                  }}
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
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Fecha</th>
                      <th>Cliente</th>
                      <th>Dispositivo</th>
                      <th>Falla Declarada</th>
                      <th>Estado</th>
                      <th>Control QC</th>
                      <th>Presupuesto</th>
                      <th>Repuestos</th>
                      <th style={{ textAlign: "right" }}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRepairs.map((r) => {
                      const isDelivered = Boolean(r.delivery_id);
                      const statusInfo = isDelivered
                        ? STATUS_MAP.delivered
                        : STATUS_MAP[r.status_code] || { label: r.status_name, pillClass: "flow-status-pill pending" };

                      return (
                        <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => handleSelectTicket(r)}>
                          <td style={{ fontWeight: 700, color: "var(--accent-mint)" }}>
                            {r.order_code}
                          </td>
                          <td style={{ fontSize: "12px" }}>
                            {formatDate(r.opened_at)}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{r.customer_name}</div>
                            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                              {r.customer_phone || r.customer_code}
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
                            <span className={statusInfo.pillClass}>{statusInfo.label}</span>
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
              <h2 className="flow-card__title">Protocolos Técnicos & QC Final</h2>
              <p className="flow-card__subtitle">Registro inmutable de inspecciones de laboratorio y criterios de conformidad</p>
            </div>
          </div>

          {loadingTests ? (
            <div style={{ padding: "40px", textAlign: "center" }}>
              <Loader2 className="animate-spin" size={32} style={{ margin: "0 auto 12px" }} />
              <p>Cargando protocolos QC...</p>
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
                <ShieldAlert size={16} /> Abrir Reclamo RMA
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
                <h3 className="flow-card__title">Reclamos Técnicos (RMA) Registrados</h3>
                <p className="flow-card__subtitle">Historial independiente de reclamos sin alterar la orden de servicio previa</p>
              </div>
            </div>
            {claims.length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                Sin reclamos de RMA activos. Tasa de conformidad 100%.
              </div>
            ) : (
              <div className="flow-table-container">
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>Código RMA</th>
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
          onClose={() => setSelectedTicket(null)}
          title={`Ficha de Reparación: ${selectedTicket.order_code}`}
          maxWidth="780px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Header info bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", border: "1px solid var(--border-line)" }}>
              <div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase" }}>Dispositivo</div>
                <div style={{ fontWeight: 700, fontSize: "16px" }}>{selectedTicket.brand_snapshot} {selectedTicket.model_snapshot}</div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Cliente: <strong>{selectedTicket.customer_name}</strong> ({selectedTicket.customer_phone || selectedTicket.customer_code})</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase" }}>Estado Actual</div>
                <div style={{ marginTop: "4px" }}>
                  <span className={STATUS_MAP[selectedTicket.status_code]?.pillClass || "flow-status-pill pending"}>
                    {selectedTicket.delivery_id ? "Entregado" : selectedTicket.status_name}
                  </span>
                </div>
              </div>
            </div>

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
                        onClick={() => handleTransition(tr)}
                      >
                        Avanzar a {tr.to_status_name}
                      </button>
                    ))}
                    {selectedTicket.status_code === "ready" && !selectedTicket.delivery_id && (
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ background: "#10b981", borderColor: "#10b981", color: "#fff", padding: "6px 14px", fontSize: "12px" }}
                        onClick={openDeliveryModal}
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
                      <ClipboardCheck size={14} /> {selectedTicket.qc_passed ? "Re-inspeccionar QC" : "Ejecutar QC"}
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
            <div style={{ display: "flex", borderBottom: "1px solid var(--border-line)", gap: "16px" }}>
              <button
                type="button"
                className={`btn-pill ${detailTab === "info" ? "btn-pill--active" : ""}`}
                style={{ padding: "8px 12px", background: "transparent", border: "none", borderBottom: detailTab === "info" ? "2px solid var(--accent-mint)" : "none", color: detailTab === "info" ? "var(--accent-mint)" : "var(--text-muted)", cursor: "pointer", fontWeight: 600 }}
                onClick={() => setDetailTab("info")}
              >
                Información de Ingreso
              </button>
              <button
                type="button"
                className={`btn-pill ${detailTab === "parts" ? "btn-pill--active" : ""}`}
                style={{ padding: "8px 12px", background: "transparent", border: "none", borderBottom: detailTab === "parts" ? "2px solid var(--accent-mint)" : "none", color: detailTab === "parts" ? "var(--accent-mint)" : "var(--text-muted)", cursor: "pointer", fontWeight: 600 }}
                onClick={() => setDetailTab("parts")}
              >
                Repuestos & Stock ({ticketParts.length})
              </button>
              <button
                type="button"
                className={`btn-pill ${detailTab === "history" ? "btn-pill--active" : ""}`}
                style={{ padding: "8px 12px", background: "transparent", border: "none", borderBottom: detailTab === "history" ? "2px solid var(--accent-mint)" : "none", color: detailTab === "history" ? "var(--accent-mint)" : "var(--text-muted)", cursor: "pointer", fontWeight: 600 }}
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
                  {!selectedTicket.delivery_id && (
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ padding: "4px 10px", fontSize: "12px" }}
                      onClick={() => setIsPartModalOpen(true)}
                    >
                      <Plus size={14} /> Consumir Repuesto
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
                      <div key={ev.id} style={{ display: "flex", gap: "12px", padding: "10px 14px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", borderLeft: "3px solid var(--accent-mint)" }}>
                        <Clock size={16} style={{ color: "var(--accent-mint)", marginTop: "2px", flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <strong style={{ fontSize: "13px" }}>{ev.status_name}</strong>
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

      {/* MODAL: NEW REPAIR INTAKE */}
      <Modal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        title="Ingreso de Reparación a Taller"
        maxWidth="720px"
      >
        <form onSubmit={handleIntakeSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Customer Selection */}
          <div style={{ padding: "12px", background: "rgba(255,255,255,0.02)", borderRadius: "8px", border: "1px solid var(--border-line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <label style={{ fontWeight: 600, fontSize: "13px" }}>Cliente Titular</label>
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: "12px", padding: "2px 6px" }}
                onClick={() => setIsNewCustomer(!isNewCustomer)}
              >
                {isNewCustomer ? "← Seleccionar cliente existente" : "+ Crear nuevo cliente"}
              </button>
            </div>

            {!isNewCustomer ? (
              <select
                className="form-input"
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                required
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name} — DNI/CUIT: {c.code} {c.phone ? `(${c.phone})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Nombre Completo *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="Ej. Martín Gómez"
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>DNI / CUIT</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newCustomerDni}
                    onChange={(e) => setNewCustomerDni(e.target.value)}
                    placeholder="Ej. 38123456"
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Teléfono / WhatsApp</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    placeholder="Ej. 11 4444-5555"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Device & Identifiers */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Tipo de Equipo</label>
              <select
                className="form-input"
                value={deviceType}
                onChange={(e) => setDeviceType(e.target.value)}
              >
                <option value="Smartphone">Smartphone</option>
                <option value="Notebook">Notebook</option>
                <option value="Tablet">Tablet</option>
                <option value="Consola">Consola</option>
                <option value="PC">PC Armado</option>
                <option value="Otro">Otro Dispositivo</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Marca</label>
              <select
                className="form-input"
                value={deviceBrand}
                onChange={(e) => setDeviceBrand(e.target.value)}
              >
                <option value="Apple">Apple</option>
                <option value="Samsung">Samsung</option>
                <option value="Xiaomi">Xiaomi</option>
                <option value="Motorola">Motorola</option>
                <option value="Lenovo">Lenovo</option>
                <option value="ASUS">ASUS</option>
                <option value="HP">HP</option>
                <option value="Dell">Dell</option>
                <option value="Otra">Otra</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Modelo Exacto *</label>
              <input
                type="text"
                className="form-input"
                value={deviceModel}
                onChange={(e) => setDeviceModel(e.target.value)}
                placeholder="Ej. iPhone 13 Pro 128GB"
                required
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Número de Serie (opcional)</label>
              <input
                type="text"
                className="form-input"
                value={deviceSerial}
                onChange={(e) => setDeviceSerial(e.target.value)}
                placeholder="Ej. F2LXXXXX"
              />
            </div>
            <div>
              <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>IMEI (opcional)</label>
              <input
                type="text"
                className="form-input"
                value={deviceImei}
                onChange={(e) => setDeviceImei(e.target.value)}
                placeholder="15 dígitos numéricos"
              />
            </div>
          </div>

          {/* Fault & Condition */}
          <div>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Falla Declarada por el Cliente *</label>
            <textarea
              className="form-input"
              rows={2}
              value={reportedFault}
              onChange={(e) => setReportedFault(e.target.value)}
              placeholder="Ej. No enciende tras caída. Pantalla con líneas verticales."
              required
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Estado Estético de Ingreso</label>
              <input
                type="text"
                className="form-input"
                value={intakeCondition}
                onChange={(e) => setIntakeCondition(e.target.value)}
                placeholder="Ej. Rayones en tapa trasera"
              />
            </div>
            <div>
              <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Accesorios Dejados</label>
              <input
                type="text"
                className="form-input"
                value={intakeAccessories}
                onChange={(e) => setIntakeAccessories(e.target.value)}
                placeholder="Ej. funda, cargador original (separados por coma)"
              />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setIsNewModalOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submittingIntake}
            >
              {submittingIntake ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
              Ingresar al Taller
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: QC TEST RUN */}
      {isQcModalOpen && activeTemplate && qcTargetTicket && (
        <Modal
          isOpen={isQcModalOpen}
          onClose={() => setIsQcModalOpen(false)}
          title={`Protocolo de Control de Calidad (QC): ${qcTargetTicket.order_code}`}
          maxWidth="580px"
        >
          <form onSubmit={handleQcSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: "6px" }}>
              Equipo: <strong>{qcTargetTicket.brand_snapshot} {qcTargetTicket.model_snapshot}</strong> | Plantilla: <strong>{activeTemplate.template_name}</strong>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {activeTemplate.definition.map((item) => (
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
                  <span style={{ fontWeight: 600, fontSize: "13px" }}>{item.label}</span>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={() => setQcChecks((prev) => ({ ...prev, [item.key]: "pass" }))}
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
              <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Notas de Inspección (opcional)</label>
              <textarea
                className="form-input"
                rows={2}
                value={qcNotes}
                onChange={(e) => setQcNotes(e.target.value)}
                placeholder="Observaciones de laboratorio técnico..."
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setIsQcModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={submittingQc}
              >
                {submittingQc ? <Loader2 className="animate-spin" size={16} /> : <ClipboardCheck size={16} />}
                Confirmar Registro QC
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: CONSUME REPLACEMENT PART */}
      {isPartModalOpen && selectedTicket && (
        <Modal
          isOpen={isPartModalOpen}
          onClose={() => setIsPartModalOpen(false)}
          title={`Consumir Repuesto: ${selectedTicket.order_code}`}
          maxWidth="520px"
        >
          <form onSubmit={handleConsumePartSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Seleccionar Repuesto del Catálogo *</label>
              <select
                className="form-input"
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                required
              >
                {availableProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.internal_name} ({p.internal_code})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Cantidad</label>
                <input
                  type="number"
                  min="1"
                  className="form-input"
                  value={partQuantity}
                  onChange={(e) => setPartQuantity(parseInt(e.target.value, 10) || 1)}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Motivo Técnico</label>
                <input
                  type="text"
                  className="form-input"
                  value={partReason}
                  onChange={(e) => setPartReason(e.target.value)}
                />
              </div>
            </div>

            <div style={{ padding: "10px 12px", background: "rgba(245, 158, 11, 0.1)", borderRadius: "6px", fontSize: "12px", color: "#f59e0b" }}>
              <AlertCircle size={14} style={{ display: "inline", marginRight: "6px" }} />
              El stock se descontará atómicamente del almacén taller. Por política técnica H16, si la orden tenía QC previo, deberá re-inspeccionarse antes de la entrega.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setIsPartModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={submittingPart}
              >
                {submittingPart ? <Loader2 className="animate-spin" size={16} /> : <Package size={16} />}
                Descontar Repuesto
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: FORMAL DELIVERY */}
      {isDeliveryModalOpen && selectedTicket && (
        <Modal
          isOpen={isDeliveryModalOpen}
          onClose={() => setIsDeliveryModalOpen(false)}
          title={`Entrega Formal de Equipo: ${selectedTicket.order_code}`}
          maxWidth="560px"
        >
          <form onSubmit={handleDeliverySubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ padding: "12px", background: "rgba(16, 185, 129, 0.1)", borderRadius: "8px", border: "1px solid rgba(16, 185, 129, 0.3)" }}>
              <div style={{ fontWeight: 600, color: "#10b981", fontSize: "13px" }}>Acreditación de Retiro</div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                Dispositivo: <strong>{selectedTicket.brand_snapshot} {selectedTicket.model_snapshot}</strong> con QC Aprobado.
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Nombre del Receptor *</label>
                <input
                  type="text"
                  className="form-input"
                  value={deliveryRecipientName}
                  onChange={(e) => setDeliveryRecipientName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Terminación DNI *</label>
                <input
                  type="text"
                  className="form-input"
                  maxLength={8}
                  value={deliveryDocumentSuffix}
                  onChange={(e) => setDeliveryDocumentSuffix(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Días de Garantía</label>
                <select
                  className="form-input"
                  value={deliveryWarrantyDays}
                  onChange={(e) => setDeliveryWarrantyDays(parseInt(e.target.value, 10) || 90)}
                >
                  <option value={30}>30 días</option>
                  <option value={60}>60 días</option>
                  <option value={90}>90 días (Estándar)</option>
                  <option value={180}>180 días (Semestral)</option>
                  <option value={365}>365 días (Anual)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Términos de la Póliza</label>
                <input
                  type="text"
                  className="form-input"
                  value={deliveryWarrantyTerms}
                  onChange={(e) => setDeliveryWarrantyTerms(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setIsDeliveryModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn-primary"
                style={{ background: "#10b981", borderColor: "#10b981" }}
                disabled={submittingDelivery}
              >
                {submittingDelivery ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />}
                Confirmar Entrega y Póliza
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: OPEN RMA CLAIM */}
      {isClaimModalOpen && (
        <Modal
          isOpen={isClaimModalOpen}
          onClose={() => setIsClaimModalOpen(false)}
          title="Apertura de Reclamo Técnico (RMA)"
          maxWidth="560px"
        >
          <form onSubmit={handleOpenClaimSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Seleccionar Póliza Activa *</label>
              <select
                className="form-input"
                value={selectedWarrantyId}
                onChange={(e) => setSelectedWarrantyId(e.target.value)}
                required
              >
                {warranties
                  .filter((w) => w.is_active)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.order_code} — {w.customer_name} ({w.equipment_model}) | Hasta {formatDate(w.ends_at)}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Defecto o Falla Reportada por el Cliente *</label>
              <textarea
                className="form-input"
                rows={3}
                value={claimIssue}
                onChange={(e) => setClaimIssue(e.target.value)}
                placeholder="Describa el motivo del reingreso por garantía..."
                required
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setIsClaimModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={submittingClaim}
              >
                {submittingClaim ? <Loader2 className="animate-spin" size={16} /> : <ShieldAlert size={16} />}
                Emitir Reclamo RMA
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
