import { useState, useEffect, useCallback, useRef } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
  CheckCircle2,
  PackageCheck,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  WorkspaceHeader,
  WorkspaceModuleTabs,
  Modal,
  FeedbackAlert,
  KpiCard,
} from "../../components/erp/WorkspaceUi";
import { type ErpModuleId } from "@nictech/domain";
import { formatCurrency, formatDate } from "../../lib/formatters";
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
  price: number;
  variants: Array<{ id: string; name: string; code: string }>;
}

export interface PurchasesWorkspaceProps {
  activeModuleId?: "purchases" | "suppliers";
  onSelectModule?: (id: ErpModuleId) => void;
}

interface NewOrderLine {
  productId: string;
  variantId: string;
  quantity: number;
  unitPrice: number;
}

const poHeaderSchema = z.object({
  branchId: z.string().uuid("Seleccioná una sucursal válida."),
  supplierId: z.string().uuid("Seleccioná un proveedor válido."),
  reason: z.string().trim().min(3, "Indicá un motivo de al menos 3 caracteres.").max(240),
});

const poLinesSchema = z.array(z.object({
  productId: z.string().uuid(),
  variantId: z.union([z.string().uuid(), z.literal("")]),
  quantity: z.number().int().positive(),
  unitPrice: z.number().finite().nonnegative(),
})).min(1, "Agregá al menos una línea de compra.");

const receiptSchema = z.object({
  locationId: z.string().uuid("Seleccioná una ubicación válida."),
  invoiceNumber: z.string().trim().max(80, "La referencia no puede superar 80 caracteres."),
});

const supplierSchema = z.object({
  name: z.string().trim().min(2, "Ingresá al menos 2 caracteres.").max(160),
  taxId: z.string().trim().max(32),
  category: z.string().trim().max(120),
  termsDays: z.coerce.number().int().min(0).max(3650),
  contact: z.string().trim().max(160),
});

const supplierPaymentSchema = z.object({
  payableId: z.string().uuid("Seleccioná una deuda válida."),
  paymentMethodId: z.string().uuid("Seleccioná un medio de pago válido."),
  cashSessionId: z.union([z.string().uuid("Seleccioná una caja válida."), z.literal("")]),
  amount: z.coerce.number().finite().positive("El monto debe ser mayor que cero."),
  reference: z.string().trim().max(120, "La referencia no puede superar 120 caracteres."),
  reason: z.string().trim().min(3, "Indicá un motivo de al menos 3 caracteres.").max(240),
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
  reason: z.string().trim().min(5, "Indicá un motivo de al menos 5 caracteres.").max(240),
});

const nullableRpcString = (value: string | null): string => value as string;

type PoHeaderValues = z.infer<typeof poHeaderSchema>;
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

  // Modal states
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
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

  // Form state for PO
  const [poLines, setPoLines] = useState<NewOrderLine[]>([
    { productId: "", variantId: "", quantity: 10, unitPrice: 2500 },
  ]);
  const [submittingPo, setSubmittingPo] = useState(false);
  const [submittingReceipt, setSubmittingReceipt] = useState(false);

  const [savingSupplier, setSavingSupplier] = useState(false);
  const poOperationRef = useRef<{ signature: string; key: string } | null>(null);
  const supplierPaymentOperationRef = useRef<{ signature: string; key: string } | null>(null);
  const supplierPaymentReversalOperationRef = useRef<{ signature: string; key: string } | null>(null);
  const poForm = useForm<PoHeaderValues>({
    resolver: zodResolver(poHeaderSchema),
    defaultValues: { branchId: "", supplierId: "", reason: "Compra de mercadería" },
  });
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
  const poSupplierId = poForm.watch("supplierId");
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
      if (mapped.length > 0 && !poSupplierId) {
        poForm.setValue("supplierId", mapped[0].id, { shouldValidate: false });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar proveedores");
    }
  }, [organizationId, poForm, poSupplierId]);

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
            id, internal_name, internal_code, base_sale_price,
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
          price: Number(p.base_sale_price || 0),
          variants: (p.product_variants as Array<{ id: string; name: string; code: string }>) || [],
        }));
        setProductsCatalog(mapped);
        setPoLines((previous) => {
          if (previous[0]?.productId || mapped.length === 0) return previous;
          const first = mapped[0];
          return [{
            productId: first.id,
            variantId: first.variants.length > 0 ? first.variants[0].id : "",
            quantity: 10,
            unitPrice: 2500,
          }];
        });
      }

      const branchData = branchResult.data || [];
      const locationData = locationResult.data || [];
      setBranches(branchData);
      setLocations(locationData);
      if (branchData.length > 0 && !poForm.getValues("branchId")) {
        poForm.setValue("branchId", branchData[0].id, { shouldValidate: false });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar el contexto operativo de compras");
    }
  }, [organizationId, poForm]);

  useEffect(() => {
    void fetchSuppliers();
    void fetchPurchases();
    void fetchCatalogAndLocations();
  }, [fetchSuppliers, fetchPurchases, fetchCatalogAndLocations]);

  const addPoLine = () => {
    const first = productsCatalog[0];
    if (!first) return;
    setPoLines((prev) => [
      ...prev,
      {
        productId: first.id,
        variantId: first.variants.length > 0 ? first.variants[0].id : "",
        quantity: 10,
        unitPrice: 2500,
      },
    ]);
  };

  const removePoLine = (index: number) => {
    setPoLines((prev) => prev.filter((_, i) => i !== index));
  };

  const updatePoLine = (index: number, field: keyof NewOrderLine, value: NewOrderLine[keyof NewOrderLine]) => {
    setPoLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const updated = { ...line, [field]: value };
        if (field === "productId") {
          const prod = productsCatalog.find((p) => p.id === value);
          if (prod && prod.variants.length > 0) {
            updated.variantId = prod.variants[0].id;
          } else {
            updated.variantId = "";
          }
        }
        return updated;
      }),
    );
  };

  // Create real purchase order in ERP (Finding 3 & 4)
  const handleCreatePo = async (values: PoHeaderValues) => {
    const parsedLines = poLinesSchema.safeParse(poLines);
    if (!parsedLines.success) {
      setError(parsedLines.error.issues[0]?.message || "Revisá las líneas de compra.");
      return;
    }

    try {
      setSubmittingPo(true);
      setError(null);

      // 1. Obtain or create active exchange snapshot
      const { data: snapId, error: snapErr } = await supabase.rpc("get_or_create_exchange_snapshot", {
        target_quote_currency: "ARS",
      });
      if (snapErr) throw snapErr;

      const linesPayload = parsedLines.data.map((l) => ({
        product_id: l.productId,
        variant_id: l.variantId || null,
        quantity: l.quantity,
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
      setError(err instanceof Error ? err.message : "Error al emitir orden de compra");
    } finally {
      setSubmittingPo(false);
    }
  };

  // Approve purchase order in ERP
  const handleApprovePo = async (poId: string) => {
    try {
      setError(null);
      const opKey = `appr-client-${Date.now()}`;
      const { error: appErr } = await supabase.rpc("approve_purchase_order", {
        target_purchase_order_id: poId,
        operation_key: opKey,
        operation_reason: "Aprobada para recepción por el titular",
      });

      if (appErr) throw appErr;

      setFeedback({
        type: "success",
        message: "¡Orden de compra aprobada! Ya se encuentra lista para recepcionar mercadería.",
      });
      await fetchPurchases();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al aprobar la orden");
    }
  };

  // Open Partial/Total Receipt Modal (Finding 4)
  const openReceiptModal = (po: DbPurchaseOrder) => {
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
    if (!receiptTargetPo) return;

    try {
      setSubmittingReceipt(true);
      setError(null);

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
        throw new Error("Debe ingresar al menos una unidad a recepcionar.");
      }

      const opKey = `rcpt-client-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const docRef = values.invoiceNumber ? ` [Doc: ${values.invoiceNumber}]` : "";

      const { data: receiptId, error: rcptErr } = await supabase.rpc("post_purchase_receipt", {
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
        message: `¡Mercadería ingresada al inventario! Stock y deuda de proveedor actualizados transaccionalmente.`,
      });
      setIsReceiptModalOpen(false);
      setReceiptTargetPo(null);
      await fetchPurchases();
      await fetchSuppliers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al procesar la recepción");
    } finally {
      setSubmittingReceipt(false);
    }
  };

  const handleCreateSupplier = async (values: SupplierValues) => {
    if (!organizationId) {
      setError("No hay una organización ERP activa para registrar el proveedor.");
      return;
    }

    try {
      setSavingSupplier(true);
      setError(null);

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
        message: `¡Proveedor "${values.name}" registrado en el padrón oficial ERP!`,
      });
      setIsSupModalOpen(false);
      supplierForm.reset();
      await fetchSuppliers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar el proveedor");
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
      setError(null);
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
      setSupplierPaymentTarget(null);
      setError(err instanceof Error ? err.message : "No se pudo preparar el pago al proveedor.");
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
      setError(null);
      supplierPaymentOperationRef.current = null;
      supplierPaymentForm.setValue("amount", Number(payable.outstanding_currency), { shouldValidate: true });
      supplierPaymentForm.setValue("paymentMethodId", "");
      supplierPaymentForm.setValue("cashSessionId", "");
      supplierPaymentForm.setValue("requiresCashSession", false);
      await loadSupplierPaymentContext(payable);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los medios de pago.");
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
      setError(null);
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
      setError(err instanceof Error ? err.message : "No se pudo registrar el pago al proveedor.");
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
      setError(historyError instanceof Error ? historyError.message : "No se pudo cargar el historial de pagos.");
    } finally {
      setLoadingSupplierPaymentHistory(false);
    }
  };

  const openSupplierDetails = async (supplier: SupplierItem) => {
    setSelectedSupplierInfo(supplier);
    setSupplierPaymentHistory([]);
    await loadSupplierPaymentHistory(supplier.id);
  };

  const openSupplierPaymentReversal = (payment: SupplierPaymentHistoryItem) => {
    supplierPaymentReversalOperationRef.current = null;
    supplierPaymentReversalForm.reset({ reason: "" });
    setSupplierPaymentReversalTarget(payment);
  };

  const handleSupplierPaymentReversal = async (values: SupplierPaymentReversalValues) => {
    if (!supplierPaymentReversalTarget) return;
    try {
      setSubmittingSupplierPaymentReversal(true);
      setError(null);
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
      setError(reversalError instanceof Error ? reversalError.message : "No se pudo revertir el pago al proveedor.");
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

  const totalSpentArs = purchases.reduce((acc, po) => {
    const lines = po.purchase_order_lines || [];
    return acc + lines.reduce((lAcc, l) => lAcc + Number(l.ordered_quantity) * Number(l.unit_price), 0);
  }, 0);

  const totalDebtArs = suppliers.reduce((acc, s) => acc + s.balanceArs, 0);

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title={isSuppliersMode ? "Maestro de Proveedores & Cuentas por Pagar" : "Gestión de Compras & Recepciones"}
        description={
          isSuppliersMode
            ? "Padrón unificado de proveedores mayoristas, condiciones comerciales, CUIT y deuda corriente."
            : "Emisión y seguimiento de órdenes de compra (PO), recepción física por variantes y valorización."
        }
        badge={isSuppliersMode ? `${suppliers.length} Proveedores` : `${purchases.length} Órdenes ERP`}
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
          sublabel="Compras estructuradas"
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
                Flujo transaccional: Emisión → Aprobación → Recepción física (parcial o total)
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
                onClick={() => setIsPoModalOpen(true)}
              >
                <Plus size={16} /> Nueva Orden (PO)
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
                  <th>Total Orden</th>
                  <th>Recepción Física</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {purchases.length === 0 ? (
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
                      const totalOrderArs = lines.reduce(
                        (acc, l) => acc + Number(l.ordered_quantity) * Number(l.unit_price),
                        0,
                      );

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
                                  <strong>{l.ordered_quantity} u.</strong>
                                </span>
                              ))}
                            </div>
                          </td>
                          <td>
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                              {formatDate(po.ordered_at ? po.ordered_at.split("T")[0] : new Date().toISOString())}
                            </span>
                          </td>
                          <td>
                            <strong style={{ color: "var(--brand-primary)" }}>
                              {formatCurrency(totalOrderArs, "ARS")}
                            </strong>
                          </td>
                          <td>
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
                                  onClick={() => handleApprovePo(po.id)}
                                >
                                  <CheckCircle2 size={13} /> Aprobar
                                </button>
                              ) : !isFullyReceived ? (
                                <button
                                  type="button"
                                  className="btn-primary"
                                  style={{ fontSize: "12px", padding: "4px 10px" }}
                                  onClick={() => openReceiptModal(po)}
                                >
                                  <PackageCheck size={13} /> Recepcionar
                                </button>
                              ) : (
                                <span style={{ fontSize: "12px", color: "var(--emerald-success)", fontWeight: 600 }}>
                                  ✓ Concluido
                                </span>
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
                onClick={() => setIsSupModalOpen(true)}
              >
                <Plus size={16} /> Nuevo Proveedor
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
                  <th>Saldo Adeudado (ARS)</th>
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
                        <td>
                          <strong style={{ color: sup.balanceArs > 0 ? "var(--amber-accent)" : "var(--emerald-success)" }}>
                            {sup.balanceArs > 0 ? formatCurrency(sup.balanceArs, "ARS") : "Al día ($0)"}
                          </strong>
                        </td>
                        <td><span style={{ fontSize: "12px", color: "var(--brand-primary)" }}>{sup.contact}</span></td>
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

      {/* Modal: New Structured Purchase Order */}
      <Modal
        isOpen={isPoModalOpen}
        onClose={() => setIsPoModalOpen(false)}
        title="Emitir Orden de Compra Estructurada (PO)"
        subtitle="Selecciona el proveedor y los artículos con sus variantes para orden formal"
        icon={ShoppingCart}
        maxWidth="680px"
      >
        <form onSubmit={poForm.handleSubmit(handleCreatePo)} noValidate style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="po-branch">Sucursal *</label>
              <select id="po-branch" className="erp-form-input" {...poForm.register("branchId")}>
                <option value="">Seleccionar</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
              {poForm.formState.errors.branchId && <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>{poForm.formState.errors.branchId.message}</span>}
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="po-supplier">Proveedor *</label>
              <select
                id="po-supplier"
                className="erp-form-input"
                {...poForm.register("supplierId")}
              >
                <option value="">Seleccionar</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.terms})
                  </option>
                ))}
              </select>
              {poForm.formState.errors.supplierId && <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>{poForm.formState.errors.supplierId.message}</span>}
            </div>

            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="po-reason">Motivo / Descripción de Compra</label>
              <input
                id="po-reason"
                type="text"
                placeholder="Ej: Stock de fundas para reposición"
                className="erp-form-input"
                {...poForm.register("reason")}
              />
              {poForm.formState.errors.reason && <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>{poForm.formState.errors.reason.message}</span>}
            </div>
          </div>

          {/* PO Lines with Variants */}
          <div style={{ background: "var(--bg-card-subtle)", padding: "12px", borderRadius: "8px", border: "1px solid var(--border-line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <strong style={{ fontSize: "13px" }}>Líneas de Compra (Productos & Variantes):</strong>
              <button
                type="button"
                className="pag-btn"
                onClick={addPoLine}
                style={{ fontSize: "12px" }}
              >
                <Plus size={12} /> Agregar Línea
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {poLines.map((line, idx) => {
                const prod = productsCatalog.find((p) => p.id === line.productId);
                const hasVariants = (prod?.variants.length || 0) > 0;

                return (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 90px 100px 32px", gap: "8px", alignItems: "center" }}>
                    <select
                      value={line.productId}
                      onChange={(e) => updatePoLine(idx, "productId", e.target.value)}
                      className="erp-form-input"
                      style={{ fontSize: "12px" }}
                      required
                    >
                      {productsCatalog.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.code})
                        </option>
                      ))}
                    </select>

                    {hasVariants ? (
                      <select
                        value={line.variantId}
                        onChange={(e) => updatePoLine(idx, "variantId", e.target.value)}
                        className="erp-form-input"
                        style={{ fontSize: "12px" }}
                        required
                      >
                        {prod?.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            Variante: {v.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ fontSize: "11px", color: "var(--text-muted)", padding: "6px" }}>Sin variantes</span>
                    )}

                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Cant."
                      value={line.quantity}
                      onChange={(e) => updatePoLine(idx, "quantity", parseInt(e.target.value, 10) || 1)}
                      className="erp-form-input"
                      style={{ fontSize: "12px" }}
                      required
                    />

                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="Costo u."
                      value={line.unitPrice}
                      onChange={(e) => updatePoLine(idx, "unitPrice", parseFloat(e.target.value) || 0)}
                      className="erp-form-input"
                      style={{ fontSize: "12px" }}
                      required
                    />

                    <button
                      type="button"
                      className="pag-btn"
                      onClick={() => removePoLine(idx)}
                      disabled={poLines.length <= 1}
                      style={{ padding: "6px" }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsPoModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={submittingPo}>
              {submittingPo ? "Emitiendo…" : "Emitir Orden de Compra"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Partial/Total Receipt Modal (Finding 4) */}
      {receiptTargetPo && (
        <Modal
          isOpen={isReceiptModalOpen}
          onClose={() => {
            setIsReceiptModalOpen(false);
            setReceiptTargetPo(null);
          }}
          title={`Recepcionar Mercadería: Orden #${receiptTargetPo.id.slice(0, 8).toUpperCase()}`}
          subtitle="Ingresa cantidades físicas recibidas. Soporta entregas parciales y múltiples remitos."
          icon={PackageCheck}
          maxWidth="640px"
        >
          <form onSubmit={receiptForm.handleSubmit(handlePostReceipt)} noValidate style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="receipt-location">Ubicación / Depósito de Destino *</label>
              <select
                id="receipt-location"
                className="erp-form-input"
                {...receiptForm.register("locationId")}
              >
                <option value="">Seleccionar</option>
                {locations.filter((location) => location.branch_id === receiptTargetPo.branch_id && location.kind !== "quarantine").map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
              {receiptForm.formState.errors.locationId && <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>{receiptForm.formState.errors.locationId.message}</span>}
            </div>

            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="receipt-invoice">Nº de Remito o Factura del Proveedor (Opcional)</label>
              <input
                id="receipt-invoice"
                type="text"
                placeholder="Ej: REM-0001-00012345 o FC-A-0002-00004567"
                className="erp-form-input"
                {...receiptForm.register("invoiceNumber")}
              />
              {receiptForm.formState.errors.invoiceNumber && <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>{receiptForm.formState.errors.invoiceNumber.message}</span>}
            </div>

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

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
              <button
                type="button"
                className="pag-btn"
                onClick={() => {
                  setIsReceiptModalOpen(false);
                  setReceiptTargetPo(null);
                }}
              >
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={submittingReceipt}>
                {submittingReceipt ? "Recepcionando…" : "Confirmar Recepción"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: New Supplier */}
      <Modal
        isOpen={isSupModalOpen}
        onClose={() => setIsSupModalOpen(false)}
        title="Registrar Nuevo Proveedor"
        subtitle="Alta en padrón oficial de proveedores de la base de datos ERP"
        icon={Building}
        maxWidth="520px"
      >
        <form onSubmit={supplierForm.handleSubmit(handleCreateSupplier)} noValidate style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="supplier-name">Razón Social / Nombre *</label>
            <input
              id="supplier-name"
              type="text"
              placeholder="Ej: Distribuidora Mayorista SA"
              className="erp-form-input"
              {...supplierForm.register("name")}
            />
            {supplierForm.formState.errors.name && <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>{supplierForm.formState.errors.name.message}</span>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="supplier-tax-id">CUIT / Identificación Fiscal</label>
              <input
                id="supplier-tax-id"
                type="text"
                placeholder="Ej: 30-71234567-8"
                className="erp-form-input"
                {...supplierForm.register("taxId")}
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="supplier-terms">Condición Comercial (Días de crédito)</label>
              <input
                id="supplier-terms"
                type="number"
                min="0"
                placeholder="30"
                className="erp-form-input"
                {...supplierForm.register("termsDays", { valueAsNumber: true })}
              />
              {supplierForm.formState.errors.termsDays && <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>Ingresá una cantidad de días válida.</span>}
            </div>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="supplier-contact">Email / Teléfono de Contacto</label>
            <input
              id="supplier-contact"
              type="text"
              placeholder="Ej: ventas@proveedortech.com"
              className="erp-form-input"
              {...supplierForm.register("contact")}
            />
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="supplier-category">Rubro / Categoría</label>
            <input id="supplier-category" type="text" className="erp-form-input" {...supplierForm.register("category")} />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsSupModalOpen(false)} disabled={savingSupplier}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={savingSupplier}>
              {savingSupplier ? "Guardando..." : "Guardar Proveedor"}
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
                {selectedSupplierInfo.balanceArs > 0 ? formatCurrency(selectedSupplierInfo.balanceArs, "ARS") : "Sin deuda pendiente ($0 ARS)"}
              </strong>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="stat-label">Historial de pagos:</span>
              {loadingSupplierPaymentHistory ? (
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Cargando pagos…</span>
              ) : supplierPaymentHistory.length === 0 ? (
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
                      {reversed && <span className="flow-status-pill canceled">Revertido</span>}
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

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
              <button type="button" className="pag-btn" onClick={() => setSelectedSupplierInfo(null)}>
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
            {loadingSupplierPayment ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)" }}>
                Cargando deudas y medios habilitados…
              </div>
            ) : (
              <>
                <div className="erp-form-group">
                  <label className="erp-form-label" htmlFor="supplier-payment-payable">Comprobante pendiente *</label>
                  <select
                    id="supplier-payment-payable"
                    className="erp-form-input"
                    value={selectedSupplierPayableId}
                    onChange={(event) => void handleSupplierPayableChange(event.target.value)}
                  >
                    <option value="">Seleccionar</option>
                    {supplierPayables.map((payable) => (
                      <option key={payable.id} value={payable.id}>
                        {`#${payable.id.slice(0, 8).toUpperCase()} · vence ${formatDate(payable.due_at)} · ${formatCurrency(Number(payable.outstanding_currency), payable.currency_code)}`}
                      </option>
                    ))}
                  </select>
                  {supplierPaymentForm.formState.errors.payableId && (
                    <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                      {supplierPaymentForm.formState.errors.payableId.message}
                    </span>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div className="erp-form-group">
                    <label className="erp-form-label" htmlFor="supplier-payment-method">Medio de pago *</label>
                    <select
                      id="supplier-payment-method"
                      className="erp-form-input"
                      value={selectedSupplierPaymentMethodId}
                      onChange={(event) => handleSupplierPaymentMethodChange(event.target.value)}
                    >
                      <option value="">Seleccionar</option>
                      {supplierPaymentMethods.map((method) => (
                        <option key={method.id} value={method.id}>{method.name}</option>
                      ))}
                    </select>
                    {supplierPaymentForm.formState.errors.paymentMethodId && (
                      <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                        {supplierPaymentForm.formState.errors.paymentMethodId.message}
                      </span>
                    )}
                  </div>

                  <div className="erp-form-group">
                    <label className="erp-form-label" htmlFor="supplier-payment-amount">
                      Monto ({selectedSupplierPayable?.currency_code || "ARS"}) *
                    </label>
                    <input
                      id="supplier-payment-amount"
                      type="number"
                      min="0.01"
                      max={selectedSupplierPayable ? Number(selectedSupplierPayable.outstanding_currency) : undefined}
                      step="0.01"
                      className="erp-form-input"
                      {...supplierPaymentForm.register("amount", { valueAsNumber: true })}
                    />
                    {supplierPaymentForm.formState.errors.amount && (
                      <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                        {supplierPaymentForm.formState.errors.amount.message}
                      </span>
                    )}
                  </div>
                </div>

                {selectedSupplierPaymentMethod?.requires_cash_session && (
                  <div className="erp-form-group">
                    <label className="erp-form-label" htmlFor="supplier-payment-cash-session">Caja abierta *</label>
                    <select
                      id="supplier-payment-cash-session"
                      className="erp-form-input"
                      {...supplierPaymentForm.register("cashSessionId")}
                    >
                      <option value="">Seleccionar</option>
                      {compatibleSupplierCashSessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {`${session.cash_register_name} (${session.cash_register_code}) · abierta ${formatDate(session.opened_at)}`}
                        </option>
                      ))}
                    </select>
                    {compatibleSupplierCashSessions.length === 0 && (
                      <span style={{ color: "var(--amber-accent)", fontSize: "11px" }}>
                        No hay una caja abierta de la misma sucursal que opere en {selectedSupplierPayable?.currency_code}.
                      </span>
                    )}
                    {supplierPaymentForm.formState.errors.cashSessionId && (
                      <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                        {supplierPaymentForm.formState.errors.cashSessionId.message}
                      </span>
                    )}
                  </div>
                )}

                <div className="erp-form-group">
                  <label className="erp-form-label" htmlFor="supplier-payment-reference">Referencia bancaria / comprobante</label>
                  <input
                    id="supplier-payment-reference"
                    type="text"
                    className="erp-form-input"
                    placeholder="Ej: transferencia 45821"
                    {...supplierPaymentForm.register("reference")}
                  />
                  {supplierPaymentForm.formState.errors.reference && (
                    <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                      {supplierPaymentForm.formState.errors.reference.message}
                    </span>
                  )}
                </div>

                <div className="erp-form-group">
                  <label className="erp-form-label" htmlFor="supplier-payment-reason">Motivo *</label>
                  <input
                    id="supplier-payment-reason"
                    type="text"
                    className="erp-form-input"
                    {...supplierPaymentForm.register("reason")}
                  />
                  {supplierPaymentForm.formState.errors.reason && (
                    <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                      {supplierPaymentForm.formState.errors.reason.message}
                    </span>
                  )}
                </div>

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

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
              <button
                type="button"
                className="pag-btn"
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
                disabled={loadingSupplierPayment || submittingSupplierPayment || !selectedSupplierPayable}
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
        subtitle="La reversa es append-only y compensará deuda, tesorería y contabilidad"
        icon={RotateCcw}
        maxWidth="520px"
      >
        {supplierPaymentReversalTarget && (
          <form
            onSubmit={supplierPaymentReversalForm.handleSubmit(handleSupplierPaymentReversal)}
            noValidate
            style={{ display: "flex", flexDirection: "column", gap: "14px" }}
          >
            <div style={{ padding: "12px", background: "var(--bg-card-subtle)", border: "1px solid var(--border-line)", borderRadius: "8px" }}>
              <span className="stat-label">Pago original:</span>
              <strong style={{ display: "block", fontSize: "16px" }}>
                {formatCurrency(Number(supplierPaymentReversalTarget.amount_currency), supplierPaymentReversalTarget.currency_code)}
              </strong>
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                {supplierPaymentReversalTarget.payment_methods?.name || "Medio de pago"} · {formatDate(supplierPaymentReversalTarget.occurred_at)}
              </span>
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="supplier-payment-reversal-reason">Motivo de reversa *</label>
              <textarea
                id="supplier-payment-reversal-reason"
                className="erp-form-input"
                rows={3}
                placeholder="Explicá por qué se revierte este pago"
                {...supplierPaymentReversalForm.register("reason")}
              />
              {supplierPaymentReversalForm.formState.errors.reason && (
                <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                  {supplierPaymentReversalForm.formState.errors.reason.message}
                </span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
              <button
                type="button"
                className="pag-btn"
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
