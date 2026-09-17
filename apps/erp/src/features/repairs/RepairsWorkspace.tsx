import React, { useState, useEffect, useMemo, useCallback } from "react";
import { z } from "zod";
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
import { type ErpModuleId } from "@nictech/domain";
import { formatCurrency, formatDate, formatDateTime } from "../../lib/formatters";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { supabase } from "../../lib/supabase";
import { listOpenCashSessions } from "../cash/api";
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
  listRepairLabor,
  recordRepairLabor,
  listRepairPayments,
  listRepairPaymentMethods,
  listRepairExchangeSnapshots,
  recordRepairPayment,
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
  type RepairPaymentMethod,
  type RepairExchangeSnapshot,
} from "./api";

const intakeSchema = z.object({
  branchId: z.string().uuid("Seleccioná una sucursal válida."),
  customerId: z.string().uuid("Seleccioná un cliente válido."),
  model: z.string().trim().min(2, "Indicá el modelo del equipo.").max(160),
  reportedFault: z.string().trim().min(5, "Describí la falla con al menos 5 caracteres.").max(1000),
  serialNumber: z.string().trim().max(120).optional(),
  imei: z.string().trim().max(30).optional(),
}).superRefine((value, context) => {
  if (value.serialNumber || value.imei) return;
  context.addIssue({
    code: "custom",
    path: ["serialNumber"],
    message: "Ingresá el número de serie o el IMEI del equipo.",
  });
});

const laborSchema = z.object({
  description: z.string().trim().min(5, "Describí el trabajo realizado.").max(1000),
  hours: z.coerce.number().positive("Las horas deben ser mayores a cero.").max(1000),
  unitCost: z.coerce.number().min(0, "El costo no puede ser negativo.").max(1_000_000_000),
});

const paymentSchema = z.object({
  paymentMethodId: z.string().uuid("Seleccioná un medio de pago."),
  amount: z.coerce.number().positive("El importe debe ser mayor a cero."),
  currency: z.string().trim().min(3).max(3),
  exchangeSnapshotId: z.string().uuid("Seleccioná una cotización registrada."),
  reason: z.string().trim().min(5, "Indicá el motivo del cobro.").max(300),
});

const operationKey = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

const createRepairCustomer = async (input: {
  displayName: string;
  phone: string | null;
  identityDocument: string | null;
}): Promise<string> => {
  const { data, error } = await supabase.rpc("create_customer_with_private_details", {
    new_kind: "person",
    new_display_name: input.displayName,
    new_legal_name: undefined,
    new_email: undefined,
    new_phone: input.phone ?? undefined,
    new_tax_id: undefined,
    new_identity_document: input.identityDocument ?? undefined,
    new_address: {},
    new_internal_notes: undefined,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("La base no devolvió el identificador del cliente creado.");
  return data;
};

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
  const { organizationId, hasPermission } = useErpAuth();
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; branch_id: string; name: string; code: string }>>([]);
  const [currentBranchId, setCurrentBranchId] = useState<string>("");

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
  const [ticketLabor, setTicketLabor] = useState<RepairLaborRecord[]>([]);
  const [ticketPayments, setTicketPayments] = useState<RepairPaymentRecord[]>([]);
  const [loadingParts, setLoadingParts] = useState<boolean>(false);
  const [loadingWork, setLoadingWork] = useState<boolean>(false);
  const [detailTab, setDetailTab] = useState<"info" | "parts" | "work" | "history">("info");

  // New Repair Intake Modal & Form
  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);
  const [customers, setCustomers] = useState<Array<{ id: string; display_name: string; phone: string | null }>>([]);
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
  const [partLocationId, setPartLocationId] = useState<string>("");
  const [submittingPart, setSubmittingPart] = useState<boolean>(false);

  // Labor and repair payments
  const [isLaborModalOpen, setIsLaborModalOpen] = useState<boolean>(false);
  const [laborDescription, setLaborDescription] = useState<string>("");
  const [laborHours, setLaborHours] = useState<string>("1");
  const [laborUnitCost, setLaborUnitCost] = useState<string>("");
  const [laborOperationKey, setLaborOperationKey] = useState<string>(() => operationKey("repair-labor"));
  const [submittingLabor, setSubmittingLabor] = useState<boolean>(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState<boolean>(false);
  const [paymentMethods, setPaymentMethods] = useState<RepairPaymentMethod[]>([]);
  const [exchangeSnapshots, setExchangeSnapshots] = useState<RepairExchangeSnapshot[]>([]);
  const [cashSessions, setCashSessions] = useState<Array<{ id: string; branch_id: string }>>([]);
  const [paymentMethodId, setPaymentMethodId] = useState<string>("");
  const [paymentAmount, setPaymentAmount] = useState<string>("");
  const [paymentCurrency, setPaymentCurrency] = useState<string>("ARS");
  const [paymentSnapshotId, setPaymentSnapshotId] = useState<string>("");
  const [paymentCashSessionId, setPaymentCashSessionId] = useState<string>("");
  const [paymentReason, setPaymentReason] = useState<string>("Cobro de reparación");
  const [paymentOperationKey, setPaymentOperationKey] = useState<string>(() => operationKey("repair-payment"));
  const [submittingPayment, setSubmittingPayment] = useState<boolean>(false);
  const [paymentToReverse, setPaymentToReverse] = useState<RepairPaymentRecord | null>(null);
  const [reversingPayment, setReversingPayment] = useState(false);
  const [reversalOperationKey, setReversalOperationKey] = useState(() => operationKey("repair-payment-reversal"));

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
        setCurrentBranchId((current) => current || nextBranches[0]?.id || "");
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

  // Load customers for intake
  const loadCustomers = useCallback(async () => {
    try {
      const { data, error: customerError } = await supabase
        .from("customers")
        .select("id, display_name, phone")
        .eq("is_active", true)
        .order("display_name", { ascending: true });
      if (customerError) throw customerError;
      setCustomers(data || []);
      if (data && data.length > 0 && !selectedCustomerId) {
        setSelectedCustomerId(data[0].id);
      }
    } catch (e) {
      setFeedback({ type: "error", message: e instanceof Error ? e.message : "No se pudieron cargar los clientes. Cerrá y volvé a abrir el ingreso para reintentar." });
    }
  }, [selectedCustomerId]);

  // Load products for parts consumption
  const loadProducts = useCallback(async () => {
    try {
      const { data, error: productError } = await supabase
        .from("products")
        .select("id, internal_name, internal_code")
        .eq("is_active", true)
        .order("internal_name", { ascending: true });
      if (productError) throw productError;
      setAvailableProducts(data || []);
      if (data && data.length > 0 && !selectedProductId) {
        setSelectedProductId(data[0].id);
      }
      if (selectedTicket) {
        const branchLocations = locations.filter((location) => location.branch_id === selectedTicket.branch_id);
        setPartLocationId((current) => branchLocations.some((location) => location.id === current) ? current : branchLocations[0]?.id || "");
      }
    } catch (e) {
      setFeedback({ type: "error", message: e instanceof Error ? e.message : "No se pudieron cargar los repuestos." });
    }
  }, [locations, selectedProductId, selectedTicket]);

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
      setLoadingWork(true);
      const [events, transitions, parts, labor, payments] = await Promise.all([
        listRepairStateEvents(ticket.id),
        listAvailableTransitions(ticket.status_id),
        listRepairParts(ticket.id),
        hasPermission("costs.view") ? listRepairLabor(ticket.id) : Promise.resolve([]),
        listRepairPayments(ticket.id),
      ]);
      setTicketEvents(events);
      setAvailableTransitions(transitions);
      setTicketParts(parts);
      setTicketLabor(labor);
      setTicketPayments(payments);
    } catch (e) {
      setFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "No se pudo cargar el detalle de la reparación.",
      });
    } finally {
      setLoadingEvents(false);
      setLoadingParts(false);
      setLoadingWork(false);
    }
  }, [hasPermission]);

  const handleSelectTicket = (ticket: RepairOrderOverview) => {
    setTicketEvents([]);
    setTicketParts([]);
    setTicketLabor([]);
    setTicketPayments([]);
    setAvailableTransitions([]);
    setSelectedTicket(ticket);
    setDetailTab("info");
    void loadTicketDetails(ticket);
  };

  // Handle Intake
  const handleIntakeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId) {
      setFeedback({ type: "error", message: "La sesión no tiene una organización activa. Volvé a iniciar sesión." });
      return;
    }
    const selectedIntakeCustomer = isNewCustomer ? crypto.randomUUID() : selectedCustomerId;
    const intakeValidation = intakeSchema.safeParse({
      branchId: currentBranchId,
      customerId: selectedIntakeCustomer,
      model: deviceModel,
      reportedFault,
      serialNumber: deviceSerial,
      imei: deviceImei,
    });
    if (!intakeValidation.success) {
      setFeedback({ type: "error", message: intakeValidation.error.issues[0]?.message ?? "Revisá los datos de ingreso." });
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
        const normalizedIdentityDocument = newCustomerDni.replace(/\D/g, "");
        if (normalizedIdentityDocument && (normalizedIdentityDocument.length < 7 || normalizedIdentityDocument.length > 8)) {
          setFeedback({ type: "error", message: "El DNI debe tener 7 u 8 dígitos." });
          return;
        }
        if (normalizedIdentityDocument && !hasPermission("customers.view_sensitive")) {
          setFeedback({ type: "error", message: "Tu rol no permite registrar documentos privados." });
          return;
        }
        custId = await createRepairCustomer({
          displayName: newCustomerName.trim(),
          phone: newCustomerPhone.trim() || null,
          identityDocument: normalizedIdentityDocument || null,
        });
      }

      const accessoriesArray = intakeAccessories
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      const result = await intakeRepairOrder({
        branchId: intakeValidation.data.branchId,
        customerId: custId,
        equipmentType: deviceType,
        brandName: deviceBrand,
        modelName: intakeValidation.data.model,
        serialNumber: deviceSerial.trim() || undefined,
        imei: deviceImei.trim() || undefined,
        accessories: accessoriesArray,
        intakeCondition: intakeCondition.trim() || "Recibido en taller",
        intakeDamage: intakeDamage.trim() || undefined,
        intakeNotes: intakeNotes.trim() || undefined,
        reportedFault: intakeValidation.data.reportedFault,
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
      setQcChecks({});
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

    const requiredItems = activeTemplate.definition.filter((item) => item.required !== false);
    const resultsArray: Array<{ item_key: string; result: "pass" | "fail" }> = [];
    for (const item of requiredItems) {
      const result = qcChecks[item.key];
      if (!result) {
        setFeedback({
          type: "error",
          message: "Registrá un resultado para cada control obligatorio antes de confirmar el protocolo QC.",
        });
        return;
      }
      resultsArray.push({ item_key: item.key, result });
    }

    if (resultsArray.length === 0) {
      setFeedback({
        type: "error",
        message: "La plantilla QC no contiene controles obligatorios para registrar.",
      });
      return;
    }

    try {
      setSubmittingQc(true);
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
    if (!selectedTicket || !selectedProductId || !partLocationId) {
      setFeedback({ type: "error", message: "Seleccioná un repuesto y una ubicación de stock." });
      return;
    }

    try {
      setSubmittingPart(true);
      await consumeRepairPart(
        selectedTicket.id,
        partLocationId,
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

  const openLaborModal = () => {
    setLaborOperationKey(operationKey("repair-labor"));
    setIsLaborModalOpen(true);
  };

  const handleLaborSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTicket) return;
    const parsed = laborSchema.safeParse({
      description: laborDescription,
      hours: laborHours,
      unitCost: laborUnitCost,
    });
    if (!parsed.success) {
      setFeedback({ type: "error", message: parsed.error.issues[0]?.message ?? "Revisá la mano de obra." });
      return;
    }
    try {
      setSubmittingLabor(true);
      await recordRepairLabor(
        selectedTicket.id,
        parsed.data.description,
        parsed.data.hours,
        parsed.data.unitCost,
        laborOperationKey,
      );
      setFeedback({ type: "success", message: "Mano de obra registrada con trazabilidad de costos." });
      setIsLaborModalOpen(false);
      setLaborDescription("");
      setLaborHours("1");
      setLaborUnitCost("");
      setLaborOperationKey(operationKey("repair-labor"));
      await loadTicketDetails(selectedTicket);
    } catch (laborError) {
      setFeedback({ type: "error", message: laborError instanceof Error ? laborError.message : "No se pudo registrar la mano de obra." });
    } finally {
      setSubmittingLabor(false);
    }
  };

  const openPaymentModal = async () => {
    if (!selectedTicket) return;
    try {
      const [methods, snapshots, sessions] = await Promise.all([
        listRepairPaymentMethods(),
        listRepairExchangeSnapshots(),
        listOpenCashSessions(),
      ]);
      setPaymentMethods(methods);
      setExchangeSnapshots(snapshots);
      setCashSessions(
        sessions
          .filter((session) => session.branch_id === selectedTicket.branch_id)
          .map((session) => ({ id: session.id, branch_id: session.branch_id })),
      );
      const firstMethod = methods[0];
      const preferredCurrency = snapshots.some((snapshot) => snapshot.quote_currency === "ARS") ? "ARS" : snapshots[0]?.quote_currency || "ARS";
      setPaymentMethodId(firstMethod?.id || "");
      setPaymentCurrency(preferredCurrency);
      setPaymentSnapshotId(snapshots.find((snapshot) => snapshot.quote_currency === preferredCurrency)?.id || "");
      setPaymentCashSessionId("");
      setPaymentOperationKey(operationKey("repair-payment"));
      setIsPaymentModalOpen(true);
    } catch (paymentConfigError) {
      setFeedback({ type: "error", message: paymentConfigError instanceof Error ? paymentConfigError.message : "No se pudo preparar el cobro." });
    }
  };

  const handlePaymentCurrencyChange = (currency: string) => {
    setPaymentCurrency(currency);
    setPaymentSnapshotId(exchangeSnapshots.find((snapshot) => snapshot.quote_currency === currency)?.id || "");
  };

  const handlePaymentSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTicket) return;
    const method = paymentMethods.find((candidate) => candidate.id === paymentMethodId);
    const parsed = paymentSchema.safeParse({
      paymentMethodId,
      amount: paymentAmount,
      currency: paymentCurrency,
      exchangeSnapshotId: paymentSnapshotId,
      reason: paymentReason,
    });
    if (!parsed.success) {
      setFeedback({ type: "error", message: parsed.error.issues[0]?.message ?? "Revisá los datos del cobro." });
      return;
    }
    if (method?.requires_cash_session && !paymentCashSessionId) {
      setFeedback({ type: "error", message: "Este medio de pago requiere una caja abierta de la misma sucursal." });
      return;
    }
    try {
      setSubmittingPayment(true);
      await recordRepairPayment({
        repairOrderId: selectedTicket.id,
        paymentMethodId: parsed.data.paymentMethodId,
        cashSessionId: method?.requires_cash_session ? paymentCashSessionId : null,
        amount: parsed.data.amount,
        currency: parsed.data.currency,
        exchangeSnapshotId: parsed.data.exchangeSnapshotId,
        operationKey: paymentOperationKey,
        reason: parsed.data.reason,
      });
      setFeedback({ type: "success", message: "Cobro registrado y conciliado con la reparación." });
      setIsPaymentModalOpen(false);
      setPaymentAmount("");
      setPaymentOperationKey(operationKey("repair-payment"));
      await loadTicketDetails(selectedTicket);
    } catch (paymentError) {
      setFeedback({ type: "error", message: paymentError instanceof Error ? paymentError.message : "No se pudo registrar el cobro." });
    } finally {
      setSubmittingPayment(false);
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
  const openDeliveryModal = () => {
    if (!selectedTicket) return;
    setDeliveryRecipientName(selectedTicket.customer_name);
    setDeliveryDocumentSuffix("");
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
      if (wList.length > 0 && !selectedWarrantyId) {
        setSelectedWarrantyId(wList[0].id);
      }
    } catch (e) {
      setFeedback({ type: "error", message: e instanceof Error ? e.message : "No se pudieron cargar las garantías. Volvé a ingresar a la sección para reintentar." });
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
  const requiredQcItems = activeTemplate?.definition.filter((item) => item.required !== false) ?? [];
  const completedQcItems = requiredQcItems.filter((item) => Boolean(qcChecks[item.key])).length;
  const isQcComplete =
    requiredQcItems.length > 0 && completedQcItems === requiredQcItems.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <WorkspaceHeader
        title="Taller & Servicio Técnico"
        description="Gestión integral de órdenes de reparación, protocolos QC obligatorios, consumo de repuestos y pólizas de garantía."
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
                            {r.order_code}
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
                No se encontraron reclamos de garantía en esta consulta.
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
                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Cliente: <strong>{selectedTicket.customer_name}</strong> ({selectedTicket.customer_phone || "sin teléfono registrado"})</div>
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

            <section aria-label="Mano de obra y cobros">
              <h3>Mano de obra y cobros</h3>
              <div className="flow-tabs-nav">
                {hasPermission("repairs.manage") && hasPermission("costs.manage") && <button type="button" className="btn-primary" onClick={openLaborModal}><BriefcaseBusiness size={16} /> Registrar trabajo</button>}
                {hasPermission("repairs.manage") && <button type="button" className="btn-primary" onClick={() => void openPaymentModal()}><Banknote size={16} /> Registrar cobro o seña</button>}
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

      <Modal isOpen={isLaborModalOpen} onClose={() => setIsLaborModalOpen(false)} title="Registrar mano de obra">
        <form onSubmit={handleLaborSubmit}>
          <label className="erp-form-group">Trabajo realizado<input className="erp-form-input" required value={laborDescription} onChange={(event) => setLaborDescription(event.target.value)} /></label>
          <label className="erp-form-group">Horas<input className="erp-form-input" type="number" min="0.01" step="0.01" required value={laborHours} onChange={(event) => setLaborHours(event.target.value)} /></label>
          <label className="erp-form-group">Costo por hora en moneda base<input className="erp-form-input" type="number" min="0" step="0.01" required value={laborUnitCost} onChange={(event) => setLaborUnitCost(event.target.value)} /></label>
          <button className="btn-primary" type="submit" disabled={submittingLabor}>Registrar trabajo</button>
        </form>
      </Modal>
      <Modal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} title="Cobro o seña de reparación">
        <form onSubmit={handlePaymentSubmit}>
          <label className="erp-form-group">Medio de pago<select className="erp-form-input" required value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)}><option value="">Seleccionar</option>{paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label>
          <label className="erp-form-group">Moneda<select className="erp-form-input" value={paymentCurrency} onChange={(event) => handlePaymentCurrencyChange(event.target.value)}>{Array.from(new Set(exchangeSnapshots.map((snapshot) => snapshot.quote_currency))).map((currency) => <option key={currency}>{currency}</option>)}</select></label>
          <label className="erp-form-group">Cotización<select className="erp-form-input" required value={paymentSnapshotId} onChange={(event) => setPaymentSnapshotId(event.target.value)}><option value="">Seleccionar</option>{exchangeSnapshots.filter((snapshot) => snapshot.quote_currency === paymentCurrency).map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.rate_to_base} · {snapshot.source} · {formatDateTime(snapshot.quoted_at)}</option>)}</select></label>
          <label className="erp-form-group">Importe<input className="erp-form-input" type="number" min="0.01" step="0.01" required value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label>
          {paymentMethods.find((method) => method.id === paymentMethodId)?.requires_cash_session && <label className="erp-form-group">Caja abierta<select className="erp-form-input" required value={paymentCashSessionId} onChange={(event) => setPaymentCashSessionId(event.target.value)}><option value="">Seleccionar</option>{cashSessions.map((session) => <option key={session.id} value={session.id}>{session.id}</option>)}</select></label>}
          <label className="erp-form-group">Motivo<input className="erp-form-input" required value={paymentReason} onChange={(event) => setPaymentReason(event.target.value)} /></label>
          <button className="btn-primary" type="submit" disabled={submittingPayment}>Registrar cobro</button>
        </form>
      </Modal>

      {/* MODAL: NEW REPAIR INTAKE */}
      <Modal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        title="Ingreso de Reparación a Taller"
        maxWidth="720px"
      >
        <form onSubmit={handleIntakeSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <label className="erp-form-group">Sucursal<select className="erp-form-input" required value={currentBranchId} onChange={(event) => setCurrentBranchId(event.target.value)}><option value="">Seleccionar</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
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
                    {c.display_name}{c.phone ? ` — ${c.phone}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: hasPermission("customers.view_sensitive") ? "1fr 1fr 1fr" : "1fr 1fr", gap: "10px" }}>
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
                {hasPermission("customers.view_sensitive") && <div>
                  <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>DNI</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newCustomerDni}
                    onChange={(e) => setNewCustomerDni(e.target.value)}
                    placeholder="Ej. 38123456"
                  />
                </div>}
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
                <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Número de Serie (opcional si ingresás IMEI)</label>
              <input
                type="text"
                className="form-input"
                value={deviceSerial}
                onChange={(e) => setDeviceSerial(e.target.value)}
                placeholder="Ej. F2LXXXXX"
              />
            </div>
            <div>
                <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>IMEI (opcional si ingresás serie)</label>
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
                disabled={submittingQc || !isQcComplete}
              >
                {submittingQc ? <Loader2 className="animate-spin" size={16} /> : <ClipboardCheck size={16} />}
                {isQcComplete
                  ? "Confirmar Registro QC"
                  : `Completar controles (${completedQcItems}/${requiredQcItems.length})`}
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
            <label className="erp-form-group">Ubicación de stock<select className="erp-form-input" required value={partLocationId} onChange={(event) => setPartLocationId(event.target.value)}><option value="">Seleccionar</option>{locations.filter((location) => location.branch_id === selectedTicket.branch_id).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
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
