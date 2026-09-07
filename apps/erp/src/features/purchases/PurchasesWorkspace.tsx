import { useState, useEffect, useCallback } from "react";
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

export const PurchasesWorkspace: React.FC<PurchasesWorkspaceProps> = ({
  activeModuleId = "purchases",
  onSelectModule,
}) => {
  const [search, setSearch] = useState("");
  const [purchases, setPurchases] = useState<DbPurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([]);
  const [productsCatalog, setProductsCatalog] = useState<ProductOption[]>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Modal states
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
  const [isSupModalOpen, setIsSupModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [receiptTargetPo, setReceiptTargetPo] = useState<DbPurchaseOrder | null>(null);
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, number>>({});
  const [receiptLocationId, setReceiptLocationId] = useState<string>("");
  const [receiptInvoiceNumber, setReceiptInvoiceNumber] = useState<string>("");
  const [selectedSupplierInfo, setSelectedSupplierInfo] = useState<SupplierItem | null>(null);

  // Form state for PO
  const [poSupplierId, setPoSupplierId] = useState("");
  const [poReason, setPoReason] = useState("Compra de mercadería");
  const [poLines, setPoLines] = useState<NewOrderLine[]>([
    { productId: "", variantId: "", quantity: 10, unitPrice: 2500 },
  ]);
  const [submittingPo, setSubmittingPo] = useState(false);
  const [submittingReceipt, setSubmittingReceipt] = useState(false);

  // Form state for Supplier
  const [supName, setSupName] = useState("");
  const [supCuit, setSupCuit] = useState("");
  const [supCategory, setSupCategory] = useState("Accesorios & Fundas");
  const [supTerms, setSupTerms] = useState("30");
  const [supContact, setSupContact] = useState("");
  const [savingSupplier, setSavingSupplier] = useState(false);

  const fetchSuppliers = useCallback(async () => {
    try {
      const { data, error: dbErr } = await supabase
        .from("suppliers")
        .select("id, code, display_name, legal_name, tax_id, email, phone, notes, payment_terms_days, is_active, created_at")
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (dbErr) throw dbErr;

      // Fetch payables to calculate real supplier debt (Finding 3)
      const { data: payablesData } = await supabase
        .from("supplier_payables")
        .select("supplier_id, pending_amount_base");

      const debtMap: Record<string, number> = {};
      (payablesData || []).forEach((p) => {
        debtMap[p.supplier_id] = (debtMap[p.supplier_id] || 0) + Number(p.pending_amount_base || 0);
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
        setPoSupplierId(mapped[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar proveedores");
    }
  }, [poSupplierId]);

  const fetchPurchases = useCallback(async () => {
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
        .order("ordered_at", { ascending: false });

      if (dbErr) throw dbErr;
      setPurchases((data as unknown as DbPurchaseOrder[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar órdenes de compra");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCatalogAndLocations = useCallback(async () => {
    try {
      const { data: prodData } = await supabase
        .from("products")
        .select(`
          id, internal_name, internal_code, base_sale_price,
          product_variants(id, name, code)
        `)
        .eq("is_active", true)
        .order("internal_name");

      if (prodData) {
        const mapped: ProductOption[] = prodData.map((p) => ({
          id: p.id,
          name: p.internal_name,
          code: p.internal_code,
          price: Number(p.base_sale_price || 0),
          variants: (p.product_variants as Array<{ id: string; name: string; code: string }>) || [],
        }));
        setProductsCatalog(mapped);
        if (mapped.length > 0 && !poLines[0].productId) {
          const first = mapped[0];
          setPoLines([
            {
              productId: first.id,
              variantId: first.variants.length > 0 ? first.variants[0].id : "",
              quantity: 10,
              unitPrice: 2500,
            },
          ]);
        }
      }

      const { data: locData } = await supabase
        .from("locations")
        .select("id, name")
        .eq("is_active", true)
        .order("name");

      if (locData) {
        setLocations(locData);
        if (locData.length > 0 && !receiptLocationId) {
          setReceiptLocationId(locData[0].id);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, [poLines, receiptLocationId]);

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

  const updatePoLine = (index: number, field: keyof NewOrderLine, value: any) => {
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
  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poSupplierId || poLines.length === 0) return;

    try {
      setSubmittingPo(true);
      setError(null);

      // 1. Obtain or create active exchange snapshot
      const { data: snapId, error: snapErr } = await supabase.rpc("get_or_create_exchange_snapshot", {
        target_quote_currency: "ARS",
      });
      if (snapErr) throw snapErr;

      const opKey = `po-client-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const branchId = "20000000-0000-0000-0000-000000000001";

      const linesPayload = poLines.map((l) => ({
        product_id: l.productId,
        variant_id: l.variantId || null,
        quantity: Math.round(Number(l.quantity)), // Enforces integer quantities (Finding 9)
        unit_price: Number(l.unitPrice),
      }));

      const { data: orderId, error: poErr } = await supabase.rpc("create_purchase_order", {
        target_branch_id: branchId,
        target_supplier_id: poSupplierId,
        order_currency: "ARS",
        target_exchange_snapshot_id: snapId,
        operation_key: opKey,
        operation_reason: poReason.trim() || "Compra de mercadería y accesorios",
        lines: linesPayload,
      });

      if (poErr) throw poErr;

      setFeedback({
        type: "success",
        message: `¡Orden de compra emitida correctamente en el ERP! (ID: ${String(orderId).slice(0, 8).toUpperCase()})`,
      });
      setIsPoModalOpen(false);
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
    setReceiptInvoiceNumber("");
    setIsReceiptModalOpen(true);
  };

  // Submit Partial Receipt calling post_purchase_receipt (Finding 4, 15)
  const handlePostReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiptTargetPo || !receiptLocationId) return;

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
            to_location_id: receiptLocationId,
            quantity: qtyToReceive,
          });
        }
      }

      if (receiptLinesPayload.length === 0) {
        throw new Error("Debe ingresar al menos una unidad a recepcionar.");
      }

      const opKey = `rcpt-client-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const docRef = receiptInvoiceNumber.trim() ? ` [Doc: ${receiptInvoiceNumber.trim()}]` : "";

      const { data: receiptId, error: rcptErr } = await supabase.rpc("post_purchase_receipt", {
        target_purchase_order_id: receiptTargetPo.id,
        operation_key: opKey,
        operation_reason: `Recepción física de mercadería en depósito${docRef}`,
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

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supName.trim()) return;

    try {
      setSavingSupplier(true);
      setError(null);

      const code = `SUP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const termsDays = parseInt(supTerms, 10) || 0;

      const { error: insertErr } = await supabase.from("suppliers").insert({
        code,
        display_name: supName.trim(),
        tax_id: supCuit.trim() || null,
        notes: supCategory.trim() || null,
        payment_terms_days: termsDays,
        email: supContact.includes("@") ? supContact.trim() : null,
        phone: !supContact.includes("@") && supContact.trim() ? supContact.trim() : null,
        is_active: true,
      });

      if (insertErr) throw insertErr;

      setFeedback({
        type: "success",
        message: `¡Proveedor "${supName.trim()}" registrado en el padrón oficial ERP!`,
      });
      setIsSupModalOpen(false);
      setSupName("");
      setSupCuit("");
      setSupContact("");
      await fetchSuppliers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar el proveedor");
    } finally {
      setSavingSupplier(false);
    }
  };

  const isSuppliersMode = activeModuleId === "suppliers";

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
                            onClick={() => setSelectedSupplierInfo(sup)}
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
        <form onSubmit={handleCreatePo} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Proveedor *</label>
              <select
                required
                value={poSupplierId}
                onChange={(e) => setPoSupplierId(e.target.value)}
                className="erp-form-input"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.terms})
                  </option>
                ))}
              </select>
            </div>

            <div className="erp-form-group">
              <label className="erp-form-label">Motivo / Descripción de Compra</label>
              <input
                type="text"
                value={poReason}
                onChange={(e) => setPoReason(e.target.value)}
                placeholder="Ej: Stock de fundas para reposición"
                className="erp-form-input"
              />
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
          <form onSubmit={handlePostReceipt} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Ubicación / Depósito de Destino *</label>
              <select
                required
                value={receiptLocationId}
                onChange={(e) => setReceiptLocationId(e.target.value)}
                className="erp-form-input"
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="erp-form-group">
              <label className="erp-form-label">Nº de Remito o Factura del Proveedor (Opcional)</label>
              <input
                type="text"
                placeholder="Ej: REM-0001-00012345 o FC-A-0002-00004567"
                value={receiptInvoiceNumber}
                onChange={(e) => setReceiptInvoiceNumber(e.target.value)}
                className="erp-form-input"
              />
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
        <form onSubmit={handleCreateSupplier} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="erp-form-group">
            <label className="erp-form-label">Razón Social / Nombre *</label>
            <input
              type="text"
              required
              placeholder="Ej: Distribuidora Mayorista SA"
              value={supName}
              onChange={(e) => setSupName(e.target.value)}
              className="erp-form-input"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">CUIT / Identificación Fiscal</label>
              <input
                type="text"
                placeholder="Ej: 30-71234567-8"
                value={supCuit}
                onChange={(e) => setSupCuit(e.target.value)}
                className="erp-form-input"
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Condición Comercial (Días de crédito)</label>
              <input
                type="number"
                min="0"
                placeholder="30"
                value={supTerms}
                onChange={(e) => setSupTerms(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Email / Teléfono de Contacto</label>
            <input
              type="text"
              placeholder="Ej: ventas@proveedortech.com"
              value={supContact}
              onChange={(e) => setSupContact(e.target.value)}
              className="erp-form-input"
            />
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

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
              <button type="button" className="pag-btn" onClick={() => setSelectedSupplierInfo(null)}>
                Cerrar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
