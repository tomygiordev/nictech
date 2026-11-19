import { useState, useEffect, useCallback, useRef } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import {
  ShoppingCart,
  Search,
  Eye,
  Plus,
  Truck,
  Building,
  DollarSign,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  PackageCheck,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  WorkspaceHeader,
  WorkspaceModuleTabs,
  Modal,
  ConfirmDialog,
  FeedbackAlert,
  KpiCard,
} from "../../components/erp/WorkspaceUi";
import { Field, FormError } from "../../components/erp/FormFeedback";
import { type ErpModuleId } from "@nictech/domain";
import { todayIsoAR } from "../../lib/dates";
import { formatCurrency, formatDate } from "../../lib/formatters";
import { toUserMessage } from "../../lib/errors";
import { supabase } from "../../lib/supabase";
import { useErpAuth } from "../../auth/ErpAuthContext";

export interface DbPoLine {
  id: string;
  line_number: number;
  product_id: string;
  variant_id: string | null;
  ordered_quantity: number;
  unit_price: number;
  tax_amount: number;
  products?: { internal_name: string; internal_code: string } | null;
  product_variants?: { name: string; code: string } | null;
}

export interface DbReceiptLine {
  id: string;
  purchase_order_line_id: string;
  quantity: number;
}

export interface DbPurchaseReceipt {
  id: string;
  received_at: string;
  purchase_receipt_lines?: DbReceiptLine[];
}

export interface DbPurchaseOrder {
  id: string;
  branch_id: string;
  supplier_id: string;
  currency_code: string;
  exchange_rate: number;
  reason: string;
  ordered_at: string;
  suppliers?: { display_name: string; code: string } | null;
  purchase_order_lines?: DbPoLine[];
  purchase_approval_events?: Array<{ action: string; occurred_at: string }>;
  purchase_receipts?: DbPurchaseReceipt[];
}

export interface SupplierItem {
  id: string;
  name: string;
  cuit: string;
  category: string;
  terms: string;
  balanceArs: number;
  contact: string;
}

export interface ProductOption {
  id: string;
  name: string;
  code: string;
  variants: Array<{ id: string; name: string; code: string }>;
}

export interface PurchasesWorkspaceProps {
  activeModuleId?: "purchases" | "suppliers";
  onSelectModule?: (id: ErpModuleId) => void;
}

const poLinesSchema = z.array(z.object({
  productId: z.string().uuid("Elegí un producto."),
  variantId: z.string(),
  quantity: z.string().min(1, "Ingresá la cantidad.")
    .refine((value) => Number.isSafeInteger(Number(value)) && Number(value) > 0, "Ingresá una cantidad entera mayor que cero."),
  unitPrice: z.string().min(1, "Ingresá el costo unitario.")
    .refine((value) => {
      const cost = Number(value);
      return Number.isFinite(cost) && (cost === 0 || cost >= 0.0001);
    }, "Ingresá $0 o un costo de al menos $0,0001."),
  confirmZeroCost: z.boolean(),
}).superRefine((line, context) => {
  if (isZeroCost(line.unitPrice) && !line.confirmZeroCost) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmZeroCost"],
      message: "Confirmá el costo de $0.",
    });
  }
})).min(1, "Agregá al menos una línea de compra.");

const poSchema = z.object({
  branchId: z.string().uuid("Elegí una sucursal."),
  supplierId: z.string().uuid("Elegí un proveedor."),
  reason: z.string().trim().min(3, "Indicá un motivo de al menos 3 caracteres.")
    .max(240, "El motivo no puede superar 240 caracteres."),
  lines: poLinesSchema,
});

const emptyPoLine = () => ({ productId: "", variantId: "", quantity: "", unitPrice: "", confirmZeroCost: false });
const emptyPo = (branchId = "") => ({ branchId, supplierId: "", reason: "", lines: [emptyPoLine()] });

function isZeroCost(value: string) {
  return value !== "" && Number(value) === 0;
}

function purchaseOrderTotal(order: DbPurchaseOrder) {
  return (order.purchase_order_lines ?? []).reduce(
    (sum, line) => sum + Number(line.ordered_quantity) * Number(line.unit_price),
    0,
  );
}

function formatApprovalTotal(order: DbPurchaseOrder) {
  return formatCurrency(purchaseOrderTotal(order), order.currency_code);
}

const receiptSchema = z.object({
  locationId: z.string().uuid("Seleccioná una ubicación válida."),
  invoiceNumber: z.string().trim().max(80, "La referencia no puede superar 80 caracteres."),
});

const supplierSchema = z.object({
  name: z.string().trim().min(2, "Ingresá al menos 2 caracteres.").max(160, "El nombre no puede superar 160 caracteres."),
  taxId: z.string().trim().max(32, "El CUIT no puede superar 32 caracteres."),
  category: z.string().trim().max(120, "El rubro no puede superar 120 caracteres."),
  termsDays: z.coerce.number({ invalid_type_error: "Ingresá una cantidad de días válida." })
    .int("Ingresá un número entero de días.").min(0, "Ingresá cero días o más.").max(3650, "El plazo no puede superar 3650 días."),
  contact: z.string().trim().max(160, "El contacto no puede superar 160 caracteres."),
});

const supplierPaymentSchema = z.object({
  payableId: z.string().uuid("Seleccioná una deuda válida."),
  paymentMethodId: z.string().uuid("Seleccioná un medio de pago válido."),
  cashSessionId: z.union([z.string().uuid("Seleccioná una caja válida."), z.literal("")]),
  amount: z.coerce.number({ invalid_type_error: "Ingresá el monto." }).finite().positive("El monto debe ser mayor que cero."),
  reference: z.string().trim().max(120, "La referencia no puede superar 120 caracteres."),
  reason: z.string().trim().min(3, "Indicá un motivo de al menos 3 caracteres.").max(240, "El motivo no puede superar 240 caracteres."),
  requiresCashSession: z.boolean(),
}).superRefine((values, context) => {
  if (values.requiresCashSession && !values.cashSessionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cashSessionId"],
      message: "El medio seleccionado requiere una caja abierta compatible.",
    });
  }
  if (!values.requiresCashSession && values.cashSessionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cashSessionId"],
      message: "Este medio de pago no debe vincularse a una caja.",
    });
  }
});

const supplierPaymentReversalSchema = z.object({
  reason: z.string().trim().min(5, "Indicá un motivo de al menos 5 caracteres.").max(240, "El motivo no puede superar 240 caracteres."),
});

const nullableRpcString = (value: string | null): string => value as string;

type PoValues = z.infer<typeof poSchema>;
type PurchaseModal = "order" | "approval" | "receipt" | "supplier" | "supplierDetails" | "payment" | "reversal";
type ReceiptValues = z.infer<typeof receiptSchema>;
type SupplierValues = z.infer<typeof supplierSchema>;
type SupplierPaymentValues = z.infer<typeof supplierPaymentSchema>;
type SupplierPaymentReversalValues = z.infer<typeof supplierPaymentReversalSchema>;

interface SupplierPayableOption {
  id: string;
  branch_id: string;
  supplier_id: string;
  currency_code: string;
  due_at: string;
  amount_currency: number;
  outstanding_currency: number;
  outstanding_base: number;
}

interface SupplierPaymentMethodOption {
  id: string;
  code: string;
  name: string;
  settlement_kind: string;
  requires_cash_session: boolean;
}

interface SupplierCashSessionOption {
  id: string;
  branch_id: string;
  cash_register_code: string;
  cash_register_name: string;
  opened_at: string;
  currencies: string[];
}

interface SupplierPaymentHistoryItem {
  id: string;
  branch_id: string;
  amount_currency: number;
  currency_code: string;
  occurred_at: string;
  reference: string | null;
  reason: string;
  payment_methods: { name: string } | null;
  supplier_payment_reversals: Array<{ id: string }>;
}

export const PurchasesWorkspace: React.FC<PurchasesWorkspaceProps> = ({
  activeModuleId = "purchases",
  onSelectModule,
}) => {
  const { organizationId, hasPermission } = useErpAuth();
  const [search, setSearch] = useState("");
  const [purchases, setPurchases] = useState<DbPurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([]);
  const [productsCatalog, setProductsCatalog] = useState<ProductOption[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; branch_id: string; code: string; name: string; kind: string }>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [modalErrors, setModalErrors] = useState<Partial<Record<PurchaseModal, string | null>>>({});

  const setModalError = (modal: PurchaseModal, message: string | null) => {
    setModalErrors((previous) => ({ ...previous, [modal]: message }));
  };

  const renderModalError = (modal: PurchaseModal) => <FormError message={modalErrors[modal] ?? null} />;

  // Modal states
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
  const [approvalTarget, setApprovalTarget] = useState<DbPurchaseOrder | null>(null);
  const [approvingPo, setApprovingPo] = useState(false);
  const [isSupModalOpen, setIsSupModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [receiptTargetPo, setReceiptTargetPo] = useState<DbPurchaseOrder | null>(null);
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, number>>({});
  const [selectedSupplierInfo, setSelectedSupplierInfo] = useState<SupplierItem | null>(null);
  const [supplierPaymentTarget, setSupplierPaymentTarget] = useState<SupplierItem | null>(null);
  const [supplierPayables, setSupplierPayables] = useState<SupplierPayableOption[]>([]);
  const [supplierPaymentMethods, setSupplierPaymentMethods] = useState<SupplierPaymentMethodOption[]>([]);
  const [supplierCashSessions, setSupplierCashSessions] = useState<SupplierCashSessionOption[]>([]);
  const [supplierPaymentHistory, setSupplierPaymentHistory] = useState<SupplierPaymentHistoryItem[]>([]);
  const [loadingSupplierPaymentHistory, setLoadingSupplierPaymentHistory] = useState(false);
  const [supplierPaymentReversalTarget, setSupplierPaymentReversalTarget] = useState<SupplierPaymentHistoryItem | null>(null);
  const [loadingSupplierPayment, setLoadingSupplierPayment] = useState(false);
  const [submittingSupplierPayment, setSubmittingSupplierPayment] = useState(false);
  const [submittingSupplierPaymentReversal, setSubmittingSupplierPaymentReversal] = useState(false);

  const [submittingPo, setSubmittingPo] = useState(false);
  const [submittingReceipt, setSubmittingReceipt] = useState(false);

  const [savingSupplier, setSavingSupplier] = useState(false);
  const poOperationRef = useRef<{ signature: string; key: string } | null>(null);
  const supplierPaymentOperationRef = useRef<{ signature: string; key: string } | null>(null);
  const supplierPaymentReversalOperationRef = useRef<{ signature: string; key: string } | null>(null);
  const poForm = useForm<PoValues>({
    resolver: zodResolver(poSchema.superRefine(({ lines }, context) => {
      lines.forEach((line, index) => {
        const product = productsCatalog.find(({ id }) => id === line.productId);
        if (product?.variants.length && !product.variants.some(({ id }) => id === line.variantId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["lines", index, "variantId"],
            message: "Elegí una variante.",
          });
        }
      });
    })),
    defaultValues: emptyPo(),
  });
  const { fields: poLineFields, append: appendPoLine, remove: removePoLine } = useFieldArray({
    control: poForm.control,
    name: "lines",
  });
  const poLines = poForm.watch("lines");
  const { getValues: getPoValues, setValue: setPoValue } = poForm;
  const receiptForm = useForm<ReceiptValues>({
    resolver: zodResolver(receiptSchema),
    defaultValues: { locationId: "", invoiceNumber: "" },
  });
  const supplierForm = useForm<SupplierValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      name: "",
      taxId: "",
      category: "Accesorios & Fundas",
      termsDays: 30,
      contact: "",
    },
  });
  const supplierPaymentForm = useForm<SupplierPaymentValues>({
    resolver: zodResolver(supplierPaymentSchema),
    defaultValues: {
      payableId: "",
      paymentMethodId: "",
      cashSessionId: "",
      amount: 0,
      reference: "",
      reason: "Pago de cuenta corriente a proveedor",
      requiresCashSession: false,
    },
  });
  const supplierPaymentReversalForm = useForm<SupplierPaymentReversalValues>({
    resolver: zodResolver(supplierPaymentReversalSchema),
    defaultValues: { reason: "" },
  });
  const receiptLocationId = receiptForm.watch("locationId");
  const selectedSupplierPayableId = supplierPaymentForm.watch("payableId");
  const selectedSupplierPaymentMethodId = supplierPaymentForm.watch("paymentMethodId");

  const fetchSuppliers = useCallback(async () => {
    if (!organizationId) {
      setError("No hay una organización ERP activa para consultar proveedores.");
      return;
    }

    try {
      const { data, error: dbErr } = await supabase
        .from("suppliers")
        .select("id, code, display_name, legal_name, tax_id, email, phone, notes, payment_terms_days, is_active, created_at")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (dbErr) throw dbErr;

      const { data: accountEntriesData, error: accountEntriesError } = await supabase
        .from("supplier_account_entries")
        .select("supplier_id, amount_base_delta")
        .eq("organization_id", organizationId);

      if (accountEntriesError) {
        throw new Error(`No se pudo calcular la deuda con proveedores: ${accountEntriesError.message}`);
      }

      const debtMap: Record<string, number> = {};
      (accountEntriesData || []).forEach((entry) => {
        debtMap[entry.supplier_id] = (debtMap[entry.supplier_id] || 0) + Number(entry.amount_base_delta || 0);
      });

      const mapped: SupplierItem[] = (data || []).map((s) => ({
        id: s.id,
        name: s.display_name,
        cuit: s.tax_id || "—",
        category: s.notes || "General",
        terms: s.payment_terms_days ? `${s.payment_terms_days} días` : "Contado",
        balanceArs: debtMap[s.id] || 0,
        contact: s.email || s.phone || "—",
      }));
      setSuppliers(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar proveedores");
    }
  }, [organizationId]);

  const fetchPurchases = useCallback(async () => {
    if (!organizationId) {
      setLoading(false);
      setError("No hay una organización ERP activa para consultar compras.");
      return;
    }

    try {
      setLoading(true);
      const { data, error: dbErr } = await supabase
        .from("purchase_orders")
        .select(`
          id, branch_id, supplier_id, currency_code, exchange_rate, reason, ordered_at,
          suppliers(id, display_name, code),
          purchase_order_lines(
            id, line_number, product_id, variant_id, ordered_quantity, unit_price, tax_amount,
            products(internal_name, internal_code),
            product_variants(name, code)
          ),
          purchase_approval_events(action, occurred_at),
          purchase_receipts(
            id, received_at,
            purchase_receipt_lines(id, purchase_order_line_id, quantity)
          )
        `)
        .eq("organization_id", organizationId)
        .order("ordered_at", { ascending: false });

      if (dbErr) throw dbErr;
      setPurchases(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar órdenes de compra");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  const fetchCatalogAndLocations = useCallback(async () => {
    if (!organizationId) return;

    try {
      const [productResult, branchResult, locationResult] = await Promise.all([
        supabase
          .from("products")
          .select(`
            id, internal_name, internal_code,
            product_variants(id, name, code)
          `)
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("internal_name"),
        supabase
          .from("branches")
          .select("id, name")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("locations")
          .select("id, branch_id, code, name, kind")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("name"),
      ]);

      const firstError = [productResult.error, branchResult.error, locationResult.error].find(Boolean);
      if (firstError) throw firstError;

      const prodData = productResult.data;

      if (prodData) {
        const mapped: ProductOption[] = prodData.map((p) => ({
          id: p.id,
          name: p.internal_name,
          code: p.internal_code,
          variants: (p.product_variants as Array<{ id: string; name: string; code: string }>) || [],
        }));
        setProductsCatalog(mapped);
      }

      const branchData = branchResult.data || [];
      const locationData = locationResult.data || [];
      setBranches(branchData);
      setLocations(locationData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar el contexto operativo de compras");
    }
  }, [organizationId]);

  useEffect(() => {
    void fetchSuppliers();
    void fetchPurchases();
    void fetchCatalogAndLocations();
  }, [fetchSuppliers, fetchPurchases, fetchCatalogAndLocations]);

  useEffect(() => {
    if (isPoModalOpen && branches.length === 1 && !getPoValues("branchId")) {
      setPoValue("branchId", branches[0].id, { shouldValidate: true });
    }
  }, [branches, getPoValues, isPoModalOpen, setPoValue]);

  const openPoModal = () => {
    setModalError("order", null);
    poForm.reset(emptyPo(branches.length === 1 ? branches[0].id : ""));
    setIsPoModalOpen(true);
  };

  const closePoModal = () => {
    if (!submittingPo) setIsPoModalOpen(false);
  };

  const handleCreatePo = async ({ lines, ...values }: PoValues) => {
    if (submittingPo) return;

    try {
      setSubmittingPo(true);
      setModalError("order", null);

      // 1. Obtain or create active exchange snapshot
      const { data: snapId, error: snapErr } = await supabase.rpc("get_or_create_exchange_snapshot", {
        target_quote_currency: "ARS",
      });
      if (snapErr) throw snapErr;

      const linesPayload = lines.map((l) => ({
        product_id: l.productId,
        variant_id: l.variantId || null,
        quantity: Number(l.quantity),
        unit_price: Number(l.unitPrice),
      }));
      const signature = JSON.stringify({ ...values, lines: linesPayload });
      if (poOperationRef.current?.signature !== signature) {
        poOperationRef.current = { signature, key: `po-client-${crypto.randomUUID()}` };
      }

      const { data: orderId, error: poErr } = await supabase.rpc("create_purchase_order", {
        target_branch_id: values.branchId,
        target_supplier_id: values.supplierId,
        order_currency: "ARS",
        target_exchange_snapshot_id: snapId,
        operation_key: poOperationRef.current.key,
        operation_reason: values.reason,
        lines: linesPayload,
      });

      if (poErr) throw poErr;

      setFeedback({
        type: "success",
        message: `¡Orden de compra emitida correctamente en el ERP! (ID: ${String(orderId).slice(0, 8).toUpperCase()})`,
      });
      setIsPoModalOpen(false);
      poOperationRef.current = null;
      await fetchPurchases();
    } catch (err) {
      setModalError("order", toUserMessage(err, "No se pudo emitir la orden de compra."));
    } finally {
      setSubmittingPo(false);
    }
  };

  const closeApproval = () => {
    if (!approvingPo) setApprovalTarget(null);
  };

  const handleApprovePo = async () => {
    if (!approvalTarget || approvingPo) return;
    try {
      setApprovingPo(true);
      const { error: appErr } = await supabase.rpc("approve_purchase_order", {
        target_purchase_order_id: approvalTarget.id,
        operation_key: `appr-client-${approvalTarget.id}`,
        operation_reason: "Aprobada para recibir mercadería",
      });

      if (appErr) throw appErr;

      setFeedback({
        type: "success",
        message: "Orden de compra aprobada. Ya podés registrar la recepción.",
      });
      setApprovalTarget(null);
      await fetchPurchases();
    } catch (err) {
      setModalError("approval", toUserMessage(err, "Revisá la orden y volvé a intentar."));
    } finally {
      setApprovingPo(false);
    }
  };

  // Open Partial/Total Receipt Modal (Finding 4)
  const openReceiptModal = (po: DbPurchaseOrder) => {
    setModalError("receipt", null);
    setReceiptTargetPo(po);
    const initialQtys: Record<string, number> = {};

    (po.purchase_order_lines || []).forEach((line) => {
      let alreadyReceived = 0;
      (po.purchase_receipts || []).forEach((rcpt) => {
        (rcpt.purchase_receipt_lines || []).forEach((rl) => {
          if (rl.purchase_order_line_id === line.id) {
            alreadyReceived += Number(rl.quantity || 0);
          }
        });
      });
      const pending = Math.max(0, Number(line.ordered_quantity) - alreadyReceived);
      initialQtys[line.id] = pending; // default to receive remainder
    });

    setReceiptQuantities(initialQtys);
    const destination = locations.find((location) => location.branch_id === po.branch_id && location.code === "DEPOSITO" && location.kind !== "quarantine");
    receiptForm.reset({ locationId: destination?.id || "", invoiceNumber: "" });
    setIsReceiptModalOpen(true);
  };

  // Submit Partial Receipt calling post_purchase_receipt (Finding 4, 15)
  const handlePostReceipt = async (values: ReceiptValues) => {
    if (!receiptTargetPo || submittingReceipt) return;

    try {
      setSubmittingReceipt(true);
      setModalError("receipt", null);

      const receiptLinesPayload: Array<{
        line_number: number;
        purchase_order_line_id: string;
        to_location_id: string;
        quantity: number;
      }> = [];

      let lineNum = 1;
      for (const line of receiptTargetPo.purchase_order_lines || []) {
        const qtyToReceive = Math.round(Number(receiptQuantities[line.id] || 0));
        if (qtyToReceive > 0) {
          receiptLinesPayload.push({
            line_number: lineNum++,
            purchase_order_line_id: line.id,
            to_location_id: values.locationId,
            quantity: qtyToReceive,
          });
        }
      }

      if (receiptLinesPayload.length === 0) {
        throw new Error("Ingresá al menos una unidad para recibir.");
      }

      const opKey = `rcpt-client-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const docRef = values.invoiceNumber ? ` [Doc: ${values.invoiceNumber}]` : "";

      const { error: rcptErr } = await supabase.rpc("post_purchase_receipt", {
        target_purchase_order_id: receiptTargetPo.id,
        operation_key: opKey,
        operation_reason: `Recepción física de mercadería${docRef}`,
        lines: receiptLinesPayload,
        expenses: [],
        create_payable: true,
      });

      if (rcptErr) throw rcptErr;

      setFeedback({
        type: "success",
        message: "Recepción registrada. Se actualizaron el stock y la cuenta del proveedor.",
      });
      setIsReceiptModalOpen(false);
      setReceiptTargetPo(null);
      await fetchPurchases();
      await fetchSuppliers();
    } catch (err) {
      setModalError("receipt", toUserMessage(err, "No se pudo registrar la recepción."));
    } finally {
      setSubmittingReceipt(false);
    }
  };

  const closeReceipt = () => {
    if (submittingReceipt) return;
    setIsReceiptModalOpen(false);
    setReceiptTargetPo(null);
  };

  const handleCreateSupplier = async (values: SupplierValues) => {
    if (savingSupplier) return;
    if (!organizationId) {
      setModalError("supplier", "No hay una organización activa para registrar el proveedor.");
      return;
    }

    try {
      setSavingSupplier(true);
      setModalError("supplier", null);

      const code = `SUP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const normalizedContact = values.contact.trim();

      const { error: insertErr } = await supabase.from("suppliers").insert({
        organization_id: organizationId,
        code,
        display_name: values.name,
        tax_id: values.taxId || null,
        notes: values.category || null,
        payment_terms_days: values.termsDays,
        email: normalizedContact.includes("@") ? normalizedContact : null,
        phone: !normalizedContact.includes("@") && normalizedContact ? normalizedContact : null,
        is_active: true,
      });

      if (insertErr) throw insertErr;

      setFeedback({
        type: "success",
        message: `Proveedor registrado: ${values.name}.`,
      });
      setIsSupModalOpen(false);
      supplierForm.reset();
      await fetchSuppliers();
    } catch (err) {
      setModalError("supplier", toUserMessage(err, "No se pudo registrar el proveedor."));
    } finally {
      setSavingSupplier(false);
    }
  };

  const loadSupplierPaymentContext = async (payable: SupplierPayableOption) => {
    const [methodsResult, sessionsResult] = await Promise.all([
      supabase.rpc("list_supplier_payment_methods", { target_branch_id: payable.branch_id }),
      supabase.rpc("list_supplier_cash_sessions", { target_branch_id: payable.branch_id }),
    ]);
    if (methodsResult.error) throw methodsResult.error;
    if (sessionsResult.error) throw sessionsResult.error;

    const methods = (methodsResult.data || []) as SupplierPaymentMethodOption[];
    const sessions = (sessionsResult.data || []) as SupplierCashSessionOption[];
    const preferredMethod = methods.find((method) => !method.requires_cash_session) || methods[0];
    const compatibleSession = preferredMethod?.requires_cash_session
      ? sessions.find((session) => session.currencies.includes(payable.currency_code))
      : undefined;

    setSupplierPaymentMethods(methods);
    setSupplierCashSessions(sessions);
    supplierPaymentForm.setValue("paymentMethodId", preferredMethod?.id || "", { shouldValidate: true });
    supplierPaymentForm.setValue("requiresCashSession", preferredMethod?.requires_cash_session || false);
    supplierPaymentForm.setValue("cashSessionId", compatibleSession?.id || "", { shouldValidate: true });
  };

  const openSupplierPaymentModal = async (supplier: SupplierItem) => {
    try {
      setLoadingSupplierPayment(true);
      setModalError("payment", null);
      setSupplierPaymentTarget(supplier);
      setSelectedSupplierInfo(null);
      setSupplierPayables([]);
      setSupplierPaymentMethods([]);
      setSupplierCashSessions([]);
      supplierPaymentOperationRef.current = null;

      const { data, error: payablesError } = await supabase.rpc("list_supplier_open_payables", {
        target_supplier_id: supplier.id,
      });
      if (payablesError) throw payablesError;

      const payables = (data || []) as SupplierPayableOption[];
      if (payables.length === 0) {
        throw new Error("El proveedor no tiene comprobantes con saldo pendiente.");
      }
      const firstPayable = payables[0];
      setSupplierPayables(payables);
      supplierPaymentForm.reset({
        payableId: firstPayable.id,
        paymentMethodId: "",
        cashSessionId: "",
        amount: Number(firstPayable.outstanding_currency),
        reference: "",
        reason: `Pago a proveedor ${supplier.name}`,
        requiresCashSession: false,
      });
      await loadSupplierPaymentContext(firstPayable);
    } catch (err) {
      setModalError("payment", toUserMessage(err, "No se pudo preparar el pago al proveedor."));
    } finally {
      setLoadingSupplierPayment(false);
    }
  };

  const handleSupplierPayableChange = async (payableId: string) => {
    supplierPaymentForm.setValue("payableId", payableId, { shouldValidate: true });
    const payable = supplierPayables.find((item) => item.id === payableId);
    if (!payable) return;

    try {
      setLoadingSupplierPayment(true);
      setModalError("payment", null);
      supplierPaymentOperationRef.current = null;
      supplierPaymentForm.setValue("amount", Number(payable.outstanding_currency), { shouldValidate: true });
      supplierPaymentForm.setValue("paymentMethodId", "");
      supplierPaymentForm.setValue("cashSessionId", "");
      supplierPaymentForm.setValue("requiresCashSession", false);
      await loadSupplierPaymentContext(payable);
    } catch (err) {
      setModalError("payment", toUserMessage(err, "No se pudieron cargar los medios de pago."));
    } finally {
      setLoadingSupplierPayment(false);
    }
  };

  const handleSupplierPaymentMethodChange = (paymentMethodId: string) => {
    const method = supplierPaymentMethods.find((item) => item.id === paymentMethodId);
    const payable = supplierPayables.find((item) => item.id === supplierPaymentForm.getValues("payableId"));
    const compatibleSession = method?.requires_cash_session && payable
      ? supplierCashSessions.find((session) => session.currencies.includes(payable.currency_code))
      : undefined;

    supplierPaymentOperationRef.current = null;
    supplierPaymentForm.setValue("paymentMethodId", paymentMethodId, { shouldValidate: true });
    supplierPaymentForm.setValue("requiresCashSession", method?.requires_cash_session || false);
    supplierPaymentForm.setValue("cashSessionId", compatibleSession?.id || "", { shouldValidate: true });
  };

  const handleSupplierPayment = async (values: SupplierPaymentValues) => {
    setModalError("payment", null);
    const payable = supplierPayables.find((item) => item.id === values.payableId);
    if (!payable || !supplierPaymentTarget) return;
    if (values.amount > Number(payable.outstanding_currency)) {
      supplierPaymentForm.setError("amount", {
        type: "validate",
        message: `El monto no puede superar ${formatCurrency(Number(payable.outstanding_currency), payable.currency_code)}.`,
      });
      return;
    }

    try {
      setSubmittingSupplierPayment(true);
      const signature = JSON.stringify({
        payableId: values.payableId,
        paymentMethodId: values.paymentMethodId,
        cashSessionId: values.cashSessionId || null,
        amount: values.amount,
        reference: values.reference.trim(),
        reason: values.reason.trim(),
      });
      if (supplierPaymentOperationRef.current?.signature !== signature) {
        supplierPaymentOperationRef.current = {
          signature,
          key: `supplier-payment-client-${crypto.randomUUID()}`,
        };
      }

      const { error: paymentError } = await supabase.rpc("record_supplier_payment", {
        target_payable_id: values.payableId,
        target_payment_method_id: values.paymentMethodId,
        target_cash_session_id: nullableRpcString(values.cashSessionId || null),
        payment_amount: values.amount,
        payment_reference: nullableRpcString(values.reference.trim() || null),
        operation_key: supplierPaymentOperationRef.current.key,
        operation_reason: values.reason.trim(),
      });
      if (paymentError) throw paymentError;

      setFeedback({
        type: "success",
        message: `Pago a ${supplierPaymentTarget.name} registrado con impacto en cuenta corriente, tesorería y contabilidad.`,
      });
      setSupplierPaymentTarget(null);
      supplierPaymentOperationRef.current = null;
      supplierPaymentForm.reset();
      await fetchSuppliers();
    } catch (err) {
      setModalError("payment", toUserMessage(err, "No se pudo registrar el pago al proveedor."));
    } finally {
      setSubmittingSupplierPayment(false);
    }
  };

  const loadSupplierPaymentHistory = async (supplierId: string) => {
    try {
      setLoadingSupplierPaymentHistory(true);
      const { data, error: historyError } = await supabase
        .from("supplier_payments")
        .select(`
          id, branch_id, amount_currency, currency_code, occurred_at, reference, reason,
          payment_methods(name),
          supplier_payment_reversals(id)
        `)
        .eq("supplier_id", supplierId)
        .order("occurred_at", { ascending: false });
      if (historyError) throw historyError;
      setSupplierPaymentHistory((data || []) as SupplierPaymentHistoryItem[]);
    } catch (historyError) {
      setSupplierPaymentHistory([]);
      setModalError("supplierDetails", toUserMessage(historyError, "No se pudo cargar el historial de pagos."));
    } finally {
      setLoadingSupplierPaymentHistory(false);
    }
  };

  const openSupplierDetails = async (supplier: SupplierItem) => {
    setModalError("supplierDetails", null);
    setSelectedSupplierInfo(supplier);
    setSupplierPaymentHistory([]);
    await loadSupplierPaymentHistory(supplier.id);
  };

  const openSupplierPaymentReversal = (payment: SupplierPaymentHistoryItem) => {
    setModalError("reversal", null);
    supplierPaymentReversalOperationRef.current = null;
    supplierPaymentReversalForm.reset({ reason: "" });
    setSupplierPaymentReversalTarget(payment);
  };

  const handleSupplierPaymentReversal = async (values: SupplierPaymentReversalValues) => {
    if (!supplierPaymentReversalTarget) return;
    try {
      setSubmittingSupplierPaymentReversal(true);
      setModalError("reversal", null);
      const signature = JSON.stringify({
        supplierPaymentId: supplierPaymentReversalTarget.id,
        reason: values.reason.trim(),
      });
      if (supplierPaymentReversalOperationRef.current?.signature !== signature) {
        supplierPaymentReversalOperationRef.current = {
          signature,
          key: `supplier-payment-reversal-client-${crypto.randomUUID()}`,
        };
      }
      const { error: reversalError } = await supabase.rpc("reverse_supplier_payment", {
        target_supplier_payment_id: supplierPaymentReversalTarget.id,
        operation_key: supplierPaymentReversalOperationRef.current.key,
        operation_reason: values.reason.trim(),
      });
      if (reversalError) throw reversalError;

      setFeedback({
        type: "success",
        message: "Pago a proveedor revertido con restitución de deuda, tesorería y asiento contable.",
      });
      setSupplierPaymentReversalTarget(null);
      setSelectedSupplierInfo(null);
      supplierPaymentReversalOperationRef.current = null;
      supplierPaymentReversalForm.reset();
      await fetchSuppliers();
    } catch (reversalError) {
      setModalError("reversal", toUserMessage(reversalError, "No se pudo revertir el pago al proveedor."));
    } finally {
      setSubmittingSupplierPaymentReversal(false);
    }
  };

  const isSuppliersMode = activeModuleId === "suppliers";
  const selectedSupplierPayable = supplierPayables.find((item) => item.id === selectedSupplierPayableId);
  const selectedSupplierPaymentMethod = supplierPaymentMethods.find((item) => item.id === selectedSupplierPaymentMethodId);
  const compatibleSupplierCashSessions = selectedSupplierPayable
    ? supplierCashSessions.filter((session) => (
      session.branch_id === selectedSupplierPayable.branch_id
      && session.currencies.includes(selectedSupplierPayable.currency_code)
    ))
    : [];

  const totalSpentArs = purchases.reduce((acc, po) => acc + purchaseOrderTotal(po), 0);

  const approvalSupplierName = approvalTarget?.suppliers?.display_name
    || suppliers.find((supplier) => supplier.id === approvalTarget?.supplier_id)?.name
    || "este proveedor";

  const totalDebtArs = suppliers.reduce((acc, s) => acc + s.balanceArs, 0);

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title={isSuppliersMode ? "Maestro de Proveedores & Cuentas por Pagar" : "Gestión de Compras & Recepciones"}
        description={
          isSuppliersMode
            ? "Padrón unificado de proveedores mayoristas, condiciones comerciales, CUIT y deuda corriente."
            : "Emisión y seguimiento de órdenes de compra y recepción de mercadería."
        }
        badge={isSuppliersMode ? `${suppliers.length} Proveedores` : `${purchases.length} Órdenes ERP`}
        badgeTone="neutral"
      />

      {onSelectModule && (
        <WorkspaceModuleTabs
          moduleIds={["purchases", "suppliers"]}
          activeModuleId={activeModuleId}
          onSelectModule={onSelectModule}
        />
      )}

      {error && (
        <FeedbackAlert
          type="error"
          message={error}
          onClose={() => setError(null)}
        />
      )}

      {feedback && (
        <FeedbackAlert
          type={feedback.type}
          message={feedback.message}
          onClose={() => setFeedback(null)}
        />
      )}

      <div className="kpi-grid">
        <KpiCard
          icon={ShoppingCart}
          iconVariant="green"
          label="Órdenes Registradas"
          value={purchases.length}
          trend={{ text: "Total ERP", positive: true }}
          sublabel="Órdenes de compra"
        />

        <KpiCard
          icon={DollarSign}
          iconVariant="navy"
          label="Volumen Comprado"
          value={formatCurrency(totalSpentArs, "ARS")}
          trend={{ text: "ARS", positive: true }}
          sublabel="Mercadería total ordenada"
        />

        <KpiCard
          icon={Truck}
          iconVariant="steel"
          label="Deuda con Proveedores"
          value={formatCurrency(totalDebtArs, "ARS")}
          trend={{ text: "Cuentas por pagar", positive: false }}
          sublabel="Obligaciones por recepciones"
        />

        <KpiCard
          icon={Building}
          iconVariant="dark"
          label="Proveedores Habilitados"
          value={suppliers.length}
          trend={{ text: "Padrón", positive: true }}
          sublabel="Cuentas comerciales registradas"
        />
      </div>

      {!isSuppliersMode ? (
        <div className="flow-card">
          <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
            <div>
              <h2 className="flow-card__title">Órdenes de Compra & Recepción</h2>
              <p className="flow-card__subtitle">
                Emití y aprobá órdenes de compra. Registrá cada entrega cuando llegue.
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <button
                type="button"
                className="pag-btn"
                onClick={fetchPurchases}
                disabled={loading}
                title="Recargar órdenes"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              </button>

              <div className="flow-search-pill" style={{ width: "240px" }}>
                <Search size={15} />
                <input
                  type="text"
                  placeholder="Buscar orden de compra..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <button
                type="button"
                className="btn-primary"
                onClick={openPoModal}
              >
                <Plus size={16} /> Nueva orden de compra
              </button>
            </div>
          </div>

          <div style={{ padding: "12px 16px", background: "var(--bg-app)", borderBottom: "1px solid var(--border-line)", display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-muted)" }}>
            <AlertCircle size={15} style={{ color: "var(--brand-primary)", flexShrink: 0 }} />
            <span>Circuito de compras persistido en base de datos. Soporta recepción parcial por variantes de producto.</span>
          </div>

          <div className="flow-table-wrapper">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>Nro PO</th>
                  <th>Proveedor</th>
                  <th>Líneas / Variantes</th>
                  <th>Fecha</th>
                  <th className="num">Total Orden</th>
                  <th className="num">Recepción Física</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                      Cargando órdenes de compra…
                    </td>
                  </tr>
                ) : purchases.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                      No hay órdenes de compra registradas en el ERP.
                    </td>
                  </tr>
                ) : (
                  purchases
                    .filter((po) => {
                      const supName = po.suppliers?.display_name || "";
                      const q = search.toLowerCase();
                      return po.id.toLowerCase().includes(q) || supName.toLowerCase().includes(q) || po.reason.toLowerCase().includes(q);
                    })
                    .map((po) => {
                      const isApproved = (po.purchase_approval_events || []).some((e) => e.action === "approved");
                      const lines = po.purchase_order_lines || [];
                      const totalOrderArs = purchaseOrderTotal(po);

                      let totalOrdered = 0;
                      let totalReceived = 0;
                      lines.forEach((l) => {
                        totalOrdered += Number(l.ordered_quantity);
                        (po.purchase_receipts || []).forEach((rcpt) => {
                          (rcpt.purchase_receipt_lines || []).forEach((rl) => {
                            if (rl.purchase_order_line_id === l.id) {
                              totalReceived += Number(rl.quantity);
                            }
                          });
                        });
                      });

                      const isFullyReceived = totalOrdered > 0 && totalReceived >= totalOrdered;
                      const isPartiallyReceived = totalReceived > 0 && totalReceived < totalOrdered;

                      return (
                        <tr key={po.id}>
                          <td>
                            <span className="type-badge green" style={{ fontFamily: "monospace", fontSize: "11px" }}>
                              {po.id.slice(0, 8).toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <strong>{po.suppliers?.display_name || "Proveedor"}</strong>
                          </td>
                          <td>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              {lines.map((l) => (
                                <span key={l.id} style={{ fontSize: "12px", color: "var(--text-main)" }}>
                                  • {l.products?.internal_name || "Artículo"}
                                  {l.product_variants?.name ? ` (${l.product_variants.name})` : ""}
                                  {" — "}
                                  <strong className="nowrap">{l.ordered_quantity} u.</strong>
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="nowrap">
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                              {formatDate(po.ordered_at || todayIsoAR())}
                            </span>
                          </td>
                          <td className="num">
                            <span className="amount-val">{formatCurrency(totalOrderArs, "ARS")}</span>
                          </td>
                          <td className="num">
                            <span
                              style={{
                                fontSize: "12px",
                                fontWeight: 650,
                                color: isFullyReceived
                                  ? "var(--emerald-success)"
                                  : isPartiallyReceived
                                    ? "var(--amber-accent)"
                                    : "var(--text-muted)",
                              }}
                            >
                              {totalReceived} / {totalOrdered} u.
                            </span>
                          </td>
                          <td>
                            {!isApproved ? (
                              <span className="flow-status-pill pending">Pendiente de Aprobación</span>
                            ) : isFullyReceived ? (
                              <span className="flow-status-pill completed">Recibido Completo</span>
                            ) : isPartiallyReceived ? (
                              <span className="flow-status-pill processing">Recepción Parcial</span>
                            ) : (
                              <span className="flow-status-pill confirmed">Aprobada (Esperando arribo)</span>
                            )}
                          </td>
                          <td className="text-right">
                            <div style={{ display: "inline-flex", gap: "6px" }}>
                              {!isApproved ? (
                                <button
                                  type="button"
                                  className="pag-btn"
                                  style={{ color: "var(--brand-primary)", borderColor: "var(--brand-border)" }}
                                  onClick={() => {
                                    setModalError("approval", null);
                                    setApprovalTarget(po);
                                  }}
                                >
                                  <CheckCircle2 size={13} /> Aprobar
                                </button>
                              ) : !isFullyReceived ? (
                                <button
                                  type="button"
                                  className="pag-btn"
                                  onClick={() => openReceiptModal(po)}
                                >
                                  <PackageCheck size={13} /> Recepcionar
                                </button>
                              ) : (
                                <span className="flow-status-pill completed">Concluido</span>
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
      ) : (
        /* Suppliers Tab */
        <div className="flow-card">
          <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
            <div>
              <h2 className="flow-card__title">Directorio de Proveedores Mayoristas</h2>
              <p className="flow-card__subtitle">
                Condiciones de pago, CUIT y saldo en cuenta corriente calculado desde hechos de compra
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <div className="flow-search-pill" style={{ width: "240px" }}>
                <Search size={15} />
                <input
                  type="text"
                  placeholder="Buscar proveedor..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setModalError("supplier", null);
                  supplierForm.clearErrors();
                  setIsSupModalOpen(true);
                }}
              >
                <Plus size={16} /> Nuevo proveedor
              </button>
            </div>
          </div>

          <div className="flow-table-wrapper">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>Razón Social / Proveedor</th>
                  <th>CUIT / ID Fiscal</th>
                  <th>Rubro Principal</th>
                  <th>Condición Comercial</th>
                  <th className="num">Saldo Adeudado (ARS)</th>
                  <th>Contacto</th>
                  <th className="text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                      Cargando proveedores desde la base de datos...
                    </td>
                  </tr>
                ) : suppliers.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                      No hay proveedores registrados en el padrón central.
                    </td>
                  </tr>
                ) : (
                  suppliers
                    .filter((s) => `${s.name} ${s.cuit} ${s.category}`.toLowerCase().includes(search.toLowerCase()))
                    .map((sup) => (
                      <tr key={sup.id}>
                        <td><strong>{sup.name}</strong></td>
                        <td><span style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--text-muted)" }}>{sup.cuit}</span></td>
                        <td><span className="module-state-badge">{sup.category}</span></td>
                        <td><span style={{ fontSize: "12px", fontWeight: 600 }}>{sup.terms}</span></td>
                        <td className="num">
                          {sup.balanceArs > 0
                            ? <span className="amount-val">{formatCurrency(sup.balanceArs, "ARS")}</span>
                            : <span className="flow-status-pill completed">Al día ({formatCurrency(0, "ARS")})</span>}
                        </td>
                        <td><span style={{ fontSize: "12px" }}>{sup.contact}</span></td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="pag-btn"
                            style={{ color: "var(--brand-primary)", borderColor: "var(--brand-border)", display: "inline-flex", alignItems: "center", gap: "4px" }}
                            onClick={() => void openSupplierDetails(sup)}
                          >
                            <Eye size={12} /> Ficha
                          </button>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        isOpen={isPoModalOpen}
        onClose={closePoModal}
        title="Nueva orden de compra"
        subtitle="Elegí el proveedor y cargá la cantidad y el costo de cada producto."
        icon={ShoppingCart}
        maxWidth="680px"
      >
        <form
          onSubmit={poForm.handleSubmit(handleCreatePo, () => setModalError("order", null))}
          noValidate
          style={{ display: "flex", flexDirection: "column", gap: "14px" }}
        >
          {renderModalError("order")}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: "12px" }}>
            <Field label="Sucursal" required error={poForm.formState.errors.branchId?.message}>
              {(a11y) => (
                <select {...a11y} className="erp-form-input" required {...poForm.register("branchId")}>
                  <option value="">Elegí una sucursal…</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Proveedor" required error={poForm.formState.errors.supplierId?.message}>
              {(a11y) => (
                <select {...a11y} className="erp-form-input" required {...poForm.register("supplierId")}>
                  <option value="">Elegí un proveedor…</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name} ({supplier.terms})</option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Field label="Motivo de la compra" required error={poForm.formState.errors.reason?.message}>
            {(a11y) => (
              <input {...a11y} className="erp-form-input" required {...poForm.register("reason")} />
            )}
          </Field>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
              <strong style={{ fontSize: "13px" }}>Productos</strong>
              <button type="button" className="pag-btn" onClick={() => appendPoLine(emptyPoLine())}>
                <Plus size={14} aria-hidden="true" /> Agregar línea
              </button>
            </div>

            {poLineFields.map((field, index) => {
              const line = poLines[index] ?? field;
              const product = productsCatalog.find((item) => item.id === line.productId);
              const hasVariants = Boolean(product?.variants.length);
              const errors = poForm.formState.errors.lines?.[index];
              const resetZeroCost = () => setPoValue(`lines.${index}.confirmZeroCost`, false);
              const gridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))", gap: "8px" };

              return (
                <fieldset key={field.id} style={{ minWidth: 0, display: "grid", gap: "8px", padding: "12px", borderRadius: "8px", border: "1px solid var(--border-line)" }}>
                  <legend style={{ paddingInline: "4px", fontSize: "13px" }}>Línea {index + 1}</legend>
                  <div style={gridStyle}>
                    <Field label="Producto" required error={errors?.productId?.message}>
                      {(a11y) => (
                        <select
                          {...a11y}
                          className="erp-form-input"
                          required
                          {...poForm.register(`lines.${index}.productId`, {
                            onChange: () => {
                              setPoValue(`lines.${index}.variantId`, "");
                              resetZeroCost();
                            },
                          })}
                        >
                          <option value="">Elegí un producto…</option>
                          {productsCatalog.map((item) => (
                            <option key={item.id} value={item.id}>{item.name} ({item.code})</option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <Field label="Variante" required={hasVariants} error={errors?.variantId?.message}>
                      {(a11y) => (
                        <select
                          {...a11y}
                          className="erp-form-input"
                          disabled={!hasVariants}
                          required={hasVariants}
                          {...poForm.register(`lines.${index}.variantId`, { onChange: resetZeroCost })}
                        >
                          <option value="">{product && !hasVariants ? "Sin variantes" : "Elegí una variante…"}</option>
                          {product?.variants.map((variant) => (
                            <option key={variant.id} value={variant.id}>{variant.name}</option>
                          ))}
                        </select>
                      )}
                    </Field>
                  </div>
                  <div style={gridStyle}>
                    <Field label="Cantidad" required error={errors?.quantity?.message}>
                      {(a11y) => (
                        <input
                          {...a11y}
                          className="erp-form-input"
                          type="number"
                          min="1"
                          step="1"
                          required
                          {...poForm.register(`lines.${index}.quantity`)}
                        />
                      )}
                    </Field>
                    <Field label="Costo unitario ($)" required error={errors?.unitPrice?.message}>
                      {(a11y) => (
                        <input
                          {...a11y}
                          className="erp-form-input"
                          type="number"
                          min="0"
                          step="any"
                          required
                          {...poForm.register(`lines.${index}.unitPrice`, { onChange: resetZeroCost })}
                        />
                      )}
                    </Field>
                  </div>
                  {isZeroCost(line.unitPrice) && (
                    <Field label="Confirmo el costo de $0 para esta línea" required error={errors?.confirmZeroCost?.message}>
                      {(a11y) => (
                        <input {...a11y} type="checkbox" required {...poForm.register(`lines.${index}.confirmZeroCost`)} />
                      )}
                    </Field>
                  )}
                  {poLineFields.length > 1 && (
                    <button
                      type="button"
                      className="pag-btn"
                      style={{ justifySelf: "start" }}
                      onClick={() => removePoLine(index)}
                    >
                      Quitar línea {index + 1}
                    </button>
                  )}
                </fieldset>
              );
            })}
          </div>

          <div className="erp-modal-footer">
            <button type="button" className="btn-secondary" onClick={closePoModal} disabled={submittingPo}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={submittingPo}>
              {submittingPo ? "Emitiendo…" : "Emitir orden de compra"}
            </button>
          </div>
        </form>
      </Modal>

      {approvalTarget && (modalErrors.approval ? (
        <Modal
          isOpen
          onClose={closeApproval}
          title="No se pudo aprobar la orden de compra"
          icon={AlertTriangle}
          maxWidth="440px"
        >
          {renderModalError("approval")}
          <div className="erp-modal-footer">
            <button type="button" className="btn-secondary" onClick={closeApproval}>Cerrar</button>
            <button type="button" className="btn-primary" onClick={() => setModalError("approval", null)}>Volver a intentar</button>
          </div>
        </Modal>
      ) : (
        <ConfirmDialog
          isOpen
          title="Aprobar orden de compra"
          message={`Aprobar la orden de compra por ${formatApprovalTotal(approvalTarget)} a ${approvalSupplierName}. Genera deuda con el proveedor.`}
          confirmLabel="Aprobar orden"
          variant="warning"
          isPending={approvingPo}
          onConfirm={() => void handleApprovePo()}
          onCancel={closeApproval}
        />
      ))}

      {/* Modal: Partial/Total Receipt Modal (Finding 4) */}
      {receiptTargetPo && (
        <Modal
          isOpen={isReceiptModalOpen}
          onClose={closeReceipt}
          title={`Recibir mercadería de la orden #${receiptTargetPo.id.slice(0, 8).toUpperCase()}`}
          subtitle="Cargá las cantidades que recibiste. Podés registrar entregas parciales."
          icon={PackageCheck}
          maxWidth="640px"
        >
          <form onSubmit={receiptForm.handleSubmit(handlePostReceipt)} noValidate style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {renderModalError("receipt")}
            <Field label="Ubicación de destino" required error={receiptForm.formState.errors.locationId?.message}>
              {(a11y) => (
                <select
                  {...a11y}
                  className="erp-form-input" aria-required="true"
                  {...receiptForm.register("locationId")}
                >
                  <option value="">Elegí una ubicación…</option>
                  {locations.filter((location) => location.branch_id === receiptTargetPo.branch_id && location.kind !== "quarantine").map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field label="Remito o factura del proveedor" error={receiptForm.formState.errors.invoiceNumber?.message}>
              {(a11y) => (
                <input
                  {...a11y}
                  type="text"
                  placeholder="Ej: REM-0001-00012345 o FC-A-0002-00004567"
                  className="erp-form-input"
                  {...receiptForm.register("invoiceNumber")}
                />
              )}
            </Field>

            <div style={{ background: "var(--bg-card-subtle)", padding: "12px", borderRadius: "8px", border: "1px solid var(--border-line)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.8fr 80px 80px 110px", gap: "8px", marginBottom: "8px", fontWeight: 650, fontSize: "12px" }}>
                <span>Artículo / Variante</span>
                <span style={{ textAlign: "center" }}>Pedido</span>
                <span style={{ textAlign: "center" }}>Pendiente</span>
                <span style={{ textAlign: "right" }}>Recibir Ahora</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {(receiptTargetPo.purchase_order_lines || []).map((line) => {
                  let alreadyRec = 0;
                  (receiptTargetPo.purchase_receipts || []).forEach((rcpt) => {
                    (rcpt.purchase_receipt_lines || []).forEach((rl) => {
                      if (rl.purchase_order_line_id === line.id) {
                        alreadyRec += Number(rl.quantity || 0);
                      }
                    });
                  });
                  const pending = Math.max(0, Number(line.ordered_quantity) - alreadyRec);

                  return (
                    <div key={line.id} style={{ display: "grid", gridTemplateColumns: "1.8fr 80px 80px 110px", gap: "8px", alignItems: "center" }}>
                      <div>
                        <strong style={{ fontSize: "12px", display: "block" }}>
                          {line.products?.internal_name || "Artículo"}
                        </strong>
                        {line.product_variants?.name && (
                          <span style={{ fontSize: "11px", color: "var(--steel-blue)" }}>
                            Variante: {line.product_variants.name}
                          </span>
                        )}
                      </div>

                      <span style={{ textAlign: "center", fontSize: "12px" }}>{line.ordered_quantity} u.</span>
                      <span style={{ textAlign: "center", fontSize: "12px", fontWeight: 700, color: pending > 0 ? "var(--amber-accent)" : "var(--emerald-success)" }}>
                        {pending} u.
                      </span>

                      <input
                        type="number"
                        min="0"
                        max={pending}
                        step="1"
                        value={receiptQuantities[line.id] ?? pending}
                        onChange={(e) =>
                          setReceiptQuantities((prev) => ({
                            ...prev,
                            [line.id]: Math.min(pending, Math.max(0, parseInt(e.target.value, 10) || 0)),
                          }))
                        }
                        className="erp-form-input"
                        style={{ fontSize: "12px", textAlign: "right" }}
                        disabled={pending === 0}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="erp-modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={closeReceipt}
                disabled={submittingReceipt}
              >
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={submittingReceipt}>
                {submittingReceipt ? "Registrando…" : "Confirmar recepción"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: New Supplier */}
      <Modal
        isOpen={isSupModalOpen}
        onClose={() => {
          if (!savingSupplier) setIsSupModalOpen(false);
        }}
        title="Registrar proveedor"
        subtitle="Cargá los datos comerciales y de contacto del proveedor."
        icon={Building}
        maxWidth="520px"
      >
        <form onSubmit={supplierForm.handleSubmit(handleCreateSupplier)} noValidate style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {renderModalError("supplier")}
          <Field label="Razón social o nombre" required error={supplierForm.formState.errors.name?.message}>
            {(a11y) => (
              <input
                {...a11y}
                type="text"
                placeholder="Ej: Distribuidora Mayorista SA"
                className="erp-form-input" aria-required="true"
                {...supplierForm.register("name")}
              />
            )}
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field label="CUIT o identificación fiscal" error={supplierForm.formState.errors.taxId?.message}>
              {(a11y) => (
                <input
                  {...a11y}
                  type="text"
                  placeholder="Ej: 30-71234567-8"
                  className="erp-form-input"
                  {...supplierForm.register("taxId")}
                />
              )}
            </Field>
            <Field label="Días de crédito" required error={supplierForm.formState.errors.termsDays?.message}>
              {(a11y) => (
                <input
                  {...a11y}
                  type="number"
                  min="0"
                  placeholder="30"
                  className="erp-form-input" aria-required="true"
                  {...supplierForm.register("termsDays", { valueAsNumber: true })}
                />
              )}
            </Field>
          </div>

          <Field label="Correo o teléfono" error={supplierForm.formState.errors.contact?.message}>
            {(a11y) => (
              <input
                {...a11y}
                type="text"
                placeholder="Ej: ventas@proveedortech.com"
                className="erp-form-input"
                {...supplierForm.register("contact")}
              />
            )}
          </Field>

          <Field label="Rubro" error={supplierForm.formState.errors.category?.message}>
            {(a11y) => (
              <input {...a11y} type="text" className="erp-form-input" {...supplierForm.register("category")} />
            )}
          </Field>

          <div className="erp-modal-footer">
            <button type="button" className="btn-secondary" onClick={() => setIsSupModalOpen(false)} disabled={savingSupplier}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={savingSupplier}>
              {savingSupplier ? "Guardando…" : "Guardar proveedor"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: View Supplier Details */}
      <Modal
        isOpen={!!selectedSupplierInfo}
        onClose={() => setSelectedSupplierInfo(null)}
        title={selectedSupplierInfo?.name || "Ficha de Proveedor"}
        subtitle="Detalles fiscales y comerciales registrados en el padrón"
        icon={Building}
        maxWidth="500px"
      >
        {selectedSupplierInfo && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {renderModalError("supplierDetails")}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <span className="stat-label">CUIT / Identificación Fiscal:</span>
                <strong style={{ fontSize: "14px", display: "block", fontFamily: "monospace" }}>
                  {selectedSupplierInfo.cuit || "—"}
                </strong>
              </div>
              <div>
                <span className="stat-label">Rubro / Categoría:</span>
                <strong style={{ fontSize: "14px", display: "block" }}>
                  {selectedSupplierInfo.category}
                </strong>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <span className="stat-label">Condición Comercial:</span>
                <span style={{ fontSize: "13px", display: "block", color: "var(--text-main)" }}>
                  {selectedSupplierInfo.terms}
                </span>
              </div>
              <div>
                <span className="stat-label">Contacto:</span>
                <span style={{ fontSize: "13px", display: "block", color: "var(--brand-primary)" }}>
                  {selectedSupplierInfo.contact}
                </span>
              </div>
            </div>

            <div style={{ padding: "12px", background: "var(--bg-card-subtle)", borderRadius: "8px", border: "1px solid var(--border-line)" }}>
              <span className="stat-label">Saldo Pendiente en Cuenta Corriente:</span>
              <strong style={{ fontSize: "16px", color: selectedSupplierInfo.balanceArs > 0 ? "var(--amber-accent)" : "var(--emerald-success)", display: "block" }}>
                {selectedSupplierInfo.balanceArs > 0 ? formatCurrency(selectedSupplierInfo.balanceArs, "ARS") : `Sin deuda pendiente (${formatCurrency(0, "ARS")})`}
              </strong>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="stat-label">Historial de pagos:</span>
              {loadingSupplierPaymentHistory ? (
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Cargando pagos…</span>
              ) : modalErrors.supplierDetails ? null : supplierPaymentHistory.length === 0 ? (
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Sin pagos registrados.</span>
              ) : supplierPaymentHistory.map((payment) => {
                const reversed = payment.supplier_payment_reversals.length > 0;
                return (
                  <div
                    key={payment.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "10px",
                      alignItems: "center",
                      padding: "10px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-line)",
                      background: "var(--bg-card-subtle)",
                    }}
                  >
                    <div>
                      <strong style={{ display: "block", fontSize: "13px" }}>
                        {formatCurrency(Number(payment.amount_currency), payment.currency_code)}
                      </strong>
                      <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>
                        {payment.payment_methods?.name || "Medio de pago"} · {formatDate(payment.occurred_at)}
                        {payment.reference ? ` · ${payment.reference}` : ""}
                      </span>
                      {reversed && <span className="flow-status-pill cancelled">Revertido</span>}
                    </div>
                    {!reversed
                      && hasPermission("purchases.manage")
                      && hasPermission("costs.manage") && (
                      <button
                        type="button"
                        className="pag-btn"
                        onClick={() => openSupplierPaymentReversal(payment)}
                      >
                        <RotateCcw size={12} /> Revertir
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="erp-modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setSelectedSupplierInfo(null)}>
                Cerrar
              </button>
              {selectedSupplierInfo.balanceArs > 0
                && hasPermission("purchases.manage")
                && hasPermission("costs.manage") && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void openSupplierPaymentModal(selectedSupplierInfo)}
                >
                  <DollarSign size={15} /> Registrar pago
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Supplier payment */}
      <Modal
        isOpen={!!supplierPaymentTarget}
        onClose={() => {
          if (submittingSupplierPayment) return;
          setSupplierPaymentTarget(null);
          supplierPaymentOperationRef.current = null;
          supplierPaymentForm.reset();
        }}
        title={supplierPaymentTarget ? `Registrar pago a ${supplierPaymentTarget.name}` : "Registrar pago a proveedor"}
        subtitle="Aplicación trazable a un comprobante pendiente, con impacto en tesorería y contabilidad"
        icon={DollarSign}
        maxWidth="620px"
      >
        {supplierPaymentTarget && (
          <form
            onSubmit={supplierPaymentForm.handleSubmit(handleSupplierPayment)}
            noValidate
            style={{ display: "flex", flexDirection: "column", gap: "14px" }}
          >
            {renderModalError("payment")}
            {loadingSupplierPayment ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)" }}>
                Cargando deudas y medios habilitados…
              </div>
            ) : supplierPayables.length > 0 && (
              <>
                <Field label="Comprobante pendiente" required error={supplierPaymentForm.formState.errors.payableId?.message}>
                  {(a11y) => (
                    <select
                      {...a11y}
                      className="erp-form-input" aria-required="true"
                      value={selectedSupplierPayableId}
                      onChange={(event) => void handleSupplierPayableChange(event.target.value)}
                    >
                      <option value="">Elegí un comprobante…</option>
                      {supplierPayables.map((payable) => (
                        <option key={payable.id} value={payable.id}>
                          {`#${payable.id.slice(0, 8).toUpperCase()} · vence ${formatDate(payable.due_at)} · ${formatCurrency(Number(payable.outstanding_currency), payable.currency_code)}`}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <Field label="Medio de pago" required error={supplierPaymentForm.formState.errors.paymentMethodId?.message}>
                    {(a11y) => (
                      <select
                        {...a11y}
                        className="erp-form-input" aria-required="true"
                        value={selectedSupplierPaymentMethodId}
                        onChange={(event) => handleSupplierPaymentMethodChange(event.target.value)}
                      >
                        <option value="">Elegí un medio de pago…</option>
                        {supplierPaymentMethods.map((method) => (
                          <option key={method.id} value={method.id}>{method.name}</option>
                        ))}
                      </select>
                    )}
                  </Field>

                  <Field label={`Monto (${selectedSupplierPayable?.currency_code || "ARS"})`} required error={supplierPaymentForm.formState.errors.amount?.message}>
                    {(a11y) => (
                      <input
                        {...a11y}
                        type="number"
                        min="0.01"
                        max={selectedSupplierPayable ? Number(selectedSupplierPayable.outstanding_currency) : undefined}
                        step="0.01"
                        className="erp-form-input" aria-required="true"
                        {...supplierPaymentForm.register("amount", { valueAsNumber: true })}
                      />
                    )}
                  </Field>
                </div>

                {selectedSupplierPaymentMethod?.requires_cash_session && (
                  <Field
                    label="Caja abierta" required error={supplierPaymentForm.formState.errors.cashSessionId?.message}
                    hint={compatibleSupplierCashSessions.length === 0 ? `No hay una caja abierta de la sucursal que opere en ${selectedSupplierPayable?.currency_code}.` : undefined}
                  >
                    {(a11y) => (
                      <select
                        {...a11y}
                        className="erp-form-input" aria-required="true"
                        {...supplierPaymentForm.register("cashSessionId")}
                      >
                        <option value="">Elegí una caja…</option>
                        {compatibleSupplierCashSessions.map((session) => (
                          <option key={session.id} value={session.id}>
                            {`${session.cash_register_name} (${session.cash_register_code}) · abierta ${formatDate(session.opened_at)}`}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                )}

                <Field label="Referencia del pago" error={supplierPaymentForm.formState.errors.reference?.message}>
                  {(a11y) => (
                    <input
                      {...a11y}
                      type="text"
                      className="erp-form-input"
                      placeholder="Ej: transferencia 45821"
                      {...supplierPaymentForm.register("reference")}
                    />
                  )}
                </Field>

                <Field label="Motivo" required error={supplierPaymentForm.formState.errors.reason?.message}>
                  {(a11y) => (
                    <input
                      {...a11y}
                      type="text"
                      className="erp-form-input" aria-required="true"
                      {...supplierPaymentForm.register("reason")}
                    />
                  )}
                </Field>

                <div style={{ padding: "12px", background: "var(--bg-card-subtle)", border: "1px solid var(--border-line)", borderRadius: "8px" }}>
                  <span className="stat-label">Saldo del comprobante:</span>
                  <strong style={{ display: "block", fontSize: "15px" }}>
                    {selectedSupplierPayable
                      ? formatCurrency(Number(selectedSupplierPayable.outstanding_currency), selectedSupplierPayable.currency_code)
                      : "—"}
                  </strong>
                </div>
              </>
            )}

            <div className="erp-modal-footer">
              <button
                type="button"
                className="btn-secondary"
                disabled={submittingSupplierPayment}
                onClick={() => {
                  setSupplierPaymentTarget(null);
                  supplierPaymentOperationRef.current = null;
                  supplierPaymentForm.reset();
                }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={loadingSupplierPayment || submittingSupplierPayment || !selectedSupplierPayable || !selectedSupplierPaymentMethod}
              >
                {submittingSupplierPayment ? "Registrando…" : "Confirmar pago"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        isOpen={!!supplierPaymentReversalTarget}
        onClose={() => {
          if (submittingSupplierPaymentReversal) return;
          setSupplierPaymentReversalTarget(null);
          supplierPaymentReversalOperationRef.current = null;
          supplierPaymentReversalForm.reset();
        }}
        title="Revertir pago a proveedor"
        subtitle="La reversa no borra el pago: registra un movimiento inverso en deuda, caja y contabilidad."
        icon={RotateCcw}
        maxWidth="520px"
      >
        {supplierPaymentReversalTarget && (
          <form
            onSubmit={supplierPaymentReversalForm.handleSubmit(handleSupplierPaymentReversal)}
            noValidate
            style={{ display: "flex", flexDirection: "column", gap: "14px" }}
          >
            {renderModalError("reversal")}
            <div style={{ padding: "12px", background: "var(--bg-card-subtle)", border: "1px solid var(--border-line)", borderRadius: "8px" }}>
              <span className="stat-label">Pago original:</span>
              <strong style={{ display: "block", fontSize: "16px" }}>
                {formatCurrency(Number(supplierPaymentReversalTarget.amount_currency), supplierPaymentReversalTarget.currency_code)}
              </strong>
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                {supplierPaymentReversalTarget.payment_methods?.name || "Medio de pago"} · {formatDate(supplierPaymentReversalTarget.occurred_at)}
              </span>
            </div>
            <Field label="Motivo de la reversa" required error={supplierPaymentReversalForm.formState.errors.reason?.message}>
              {(a11y) => (
                <textarea
                  {...a11y}
                  className="erp-form-input" aria-required="true"
                  rows={3}
                  placeholder="Explicá por qué se revierte este pago"
                  {...supplierPaymentReversalForm.register("reason")}
                />
              )}
            </Field>
            <div className="erp-modal-footer">
              <button
                type="button"
                className="btn-secondary"
                disabled={submittingSupplierPaymentReversal}
                onClick={() => setSupplierPaymentReversalTarget(null)}
              >
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={submittingSupplierPaymentReversal}>
                {submittingSupplierPaymentReversal ? "Revirtiendo…" : "Confirmar reversa"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
