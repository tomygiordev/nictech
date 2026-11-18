import { useState, useEffect, useCallback, useMemo } from "react";
import { z } from "zod";
import {
  Building2,
  ArrowRightLeft,
  Barcode,
  Printer,
  History,
  Plus,
  Loader2,
  RefreshCw,
  Search,
  Package,
} from "lucide-react";
import {
  WorkspaceHeader,
  WorkspaceModuleTabs,
  StatePanel,
  Modal,
  FeedbackAlert,
} from "../../components/erp/WorkspaceUi";
import { FormError } from "../../components/erp/FormFeedback";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { type ErpModuleId } from "@nictech/domain";
import { toUserMessage } from "../../lib/errors";
import { STOCK_DOCUMENT_KIND_LABELS, labelOf } from "../../lib/labels";
import { formatDateTime } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";

export interface DbStockRow {
  id: string;
  product_id: string;
  variant_id: string | null;
  location_id: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  updated_at: string;
  products?: { internal_code: string; internal_name: string; item_kind: string } | null;
  product_variants?: { name: string; code: string } | null;
  locations?: { name: string; code: string; branch_id: string } | null;
  product_identifiers?: Array<{ kind: string; value: string }>;
}

export interface DbStockDoc {
  id: string;
  kind: string;
  reason: string;
  created_at: string;
  stock_document_lines?: Array<{
    id: string;
    quantity: number;
    from_location_id: string | null;
    to_location_id: string | null;
    products?: { internal_name: string } | null;
    product_variants?: { name: string } | null;
  }>;
}

interface DbLocation {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  allows_sale: boolean;
  is_active: boolean;
}

export interface StockWorkspaceProps {
  activeModuleId?: "stock" | "stock-counts" | "labels";
  onSelectModule?: (id: ErpModuleId) => void;
}

// Generate realistic SVG barcode bars for any barcode text
const BarcodeSvg: React.FC<{ value: string; width?: number; height?: number }> = ({
  value,
  width = 240,
  height = 60,
}) => {
  // Simple deterministic pattern based on characters
  const bars = useMemo(() => {
    const chars = value.split("");
    const result: boolean[] = [true, false, true, false]; // start guard
    chars.forEach((c) => {
      const code = c.charCodeAt(0);
      for (let i = 0; i < 7; i++) {
        result.push(((code >> i) & 1) === 1);
      }
      result.push(false);
    });
    result.push(true, false, true); // stop guard
    return result;
  }, [value]);

  const barWidth = width / bars.length;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", margin: "0 auto" }}>
      {bars.map((isDark, i) =>
        isDark ? (
          <rect
            key={i}
            x={i * barWidth}
            y={0}
            width={barWidth}
            height={height - 14}
            fill="#111827"
          />
        ) : null,
      )}
      <text
        x={width / 2}
        y={height - 2}
        textAnchor="middle"
        fontSize="11"
        fontFamily="monospace"
        fontWeight="650"
        fill="#111827"
      >
        {value}
      </text>
    </svg>
  );
};

const adjustmentSchema = z
  .object({
    stockBalanceId: z.string().uuid("Seleccioná una existencia válida."),
    direction: z.enum(["in", "out"]),
    quantity: z.coerce.number().int().positive("La cantidad debe ser un entero positivo."),
    unitCost: z.coerce.number().min(0, "El costo no puede ser negativo."),
    reason: z.string().trim().min(5, "Indicá un motivo de al menos 5 caracteres.").max(240),
  })
  .superRefine((value, context) => {
    if (value.direction === "in" && value.unitCost <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unitCost"],
        message: "Los ingresos deben registrar un costo unitario mayor a cero.",
      });
    }
  });

const transferSchema = z.object({
  stockBalanceId: z.string().uuid("Seleccioná una existencia válida."),
  destinationLocationId: z.string().uuid("Seleccioná una ubicación de destino válida."),
  quantity: z.coerce.number().int().positive("La cantidad debe ser un entero positivo."),
  reason: z.string().trim().min(5, "Indicá un motivo de al menos 5 caracteres.").max(240),
});

const createOperationKey = (kind: "adjustment" | "transfer"): string =>
  `stock-${kind}-${crypto.randomUUID()}`;

export const StockWorkspace: React.FC<StockWorkspaceProps> = ({
  activeModuleId = "stock",
  onSelectModule,
}) => {
  const { hasPermission } = useErpAuth();
  const canAdjustStock = hasPermission("stock.adjust") && hasPermission("stock.move");
  const canTransferStock = hasPermission("stock.move");
  const hasRowActions = canAdjustStock || canTransferStock;

  const [stockSubTab, setStockSubTab] = useState<"locations" | "movements">("locations");
  const [stockBalances, setStockBalances] = useState<DbStockRow[]>([]);
  const [locations, setLocations] = useState<DbLocation[]>([]);
  const [recentDocs, setRecentDocs] = useState<DbStockDoc[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Form states for adjustment
  const [isAdjModalOpen, setIsAdjModalOpen] = useState<boolean>(false);
  const [adjError, setAdjError] = useState<string | null>(null);
  const [adjRowId, setAdjRowId] = useState<string>("");
  const [adjType, setAdjType] = useState<"in" | "out">("in");
  const [adjQty, setAdjQty] = useState<string>("1");
  const [adjUnitCost, setAdjUnitCost] = useState<string>("");
  const [adjReason, setAdjReason] = useState<string>("");
  const [adjOperationKey, setAdjOperationKey] = useState<string>(() => createOperationKey("adjustment"));
  const [isTransferModalOpen, setIsTransferModalOpen] = useState<boolean>(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSourceRowId, setTransferSourceRowId] = useState<string>("");
  const [transferDestinationLocationId, setTransferDestinationLocationId] = useState<string>("");
  const [transferQty, setTransferQty] = useState<string>("1");
  const [transferReason, setTransferReason] = useState<string>("");
  const [transferOperationKey, setTransferOperationKey] = useState<string>(() => createOperationKey("transfer"));
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Label printer state (Finding 7)
  const [labelTargetId, setLabelTargetId] = useState<string>("");
  const [labelQty, setLabelQty] = useState<number>(0);
  const [labelQtyManuallySet, setLabelQtyManuallySet] = useState<boolean>(false);
  const [labelFormat, setLabelFormat] = useState<string>("50x30");

  const fetchStockData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Fetch real stock balances broken down by variant & location
      let balanceQuery = supabase
        .from("stock_balances")
        .select(`
          id, product_id, variant_id, location_id, quantity_on_hand, quantity_reserved, updated_at,
          products!inner(internal_code, internal_name, item_kind),
          product_variants(name, code),
          locations(name, code, branch_id)
        `);
      if (!showInactive) balanceQuery = balanceQuery.eq("products.is_active", true);
      const { data: balData, error: balErr } = await balanceQuery.order("updated_at", { ascending: false });

      if (balErr) throw balErr;

      const { data: locationsData, error: locationsError } = await supabase
        .from("locations")
        .select("id, branch_id, code, name, allows_sale, is_active")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (locationsError) throw locationsError;

      // 2. Fetch barcodes for all variants in balances
      const { data: piData } = await supabase
        .from("product_identifiers")
        .select("product_id, variant_id, kind, value")
        .eq("kind", "barcode");

      const rows: DbStockRow[] = (balData || []).map((b) => {
        const identifiers = (piData || []).filter(
          (pi: { product_id: string; variant_id: string | null }) => pi.product_id === b.product_id && pi.variant_id === b.variant_id,
        );
        return {
          ...b,
          product_identifiers: identifiers,
        };
      });

      setStockBalances(rows);
      setLocations(locationsData || []);
      if (rows.length > 0 && !labelTargetId) {
        setLabelTargetId(rows[0].id);
        setAdjRowId(rows[0].id);
      }

      // 3. Fetch recent stock documents
      const { data: docData, error: docError } = await supabase
        .from("stock_documents")
        .select(`
          id, kind, reason, created_at,
          stock_document_lines(
            id, quantity, from_location_id, to_location_id,
            products(internal_name),
            product_variants(name)
          )
        `)
        .order("created_at", { ascending: false })
        .limit(20);

      if (docError) throw docError;
      setRecentDocs(docData || []);
    } catch (e: unknown) {
      setError(toUserMessage(e, "No se pudieron cargar los datos de inventario."));
    } finally {
      setLoading(false);
    }
  }, [labelTargetId, showInactive]);

  useEffect(() => {
    fetchStockData();
  }, [activeModuleId, fetchStockData]);

  useEffect(() => {
    setIsAdjModalOpen(false);
    setAdjError(null);
    setIsTransferModalOpen(false);
    setTransferError(null);
  }, [activeModuleId]);

  const openAdjustmentModal = (rowId?: string) => {
    if (!canAdjustStock) return;
    if (rowId) {
      setAdjRowId(rowId);
    } else if (stockBalances.length > 0 && !adjRowId) {
      setAdjRowId(stockBalances[0].id);
    }
    setAdjError(null);
    setAdjOperationKey(createOperationKey("adjustment"));
    setIsAdjModalOpen(true);
  };

  // Handle transactional stock adjustment via post_stock_document
  const handleCreateAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdjustStock) return;
    const targetRow = stockBalances.find((r) => r.id === adjRowId);
    if (!targetRow) {
      setAdjError("Seleccioná una existencia para ajustar.");
      return;
    }

    try {
      setSubmitting(true);
      setAdjError(null);
      const parsed = adjustmentSchema.safeParse({
        stockBalanceId: adjRowId,
        direction: adjType,
        quantity: adjQty,
        unitCost: adjType === "in" ? adjUnitCost : 0,
        reason: adjReason,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Revisá los datos del ajuste.");
      }
      const branchId = targetRow.locations?.branch_id;
      if (!branchId) throw new Error("La ubicación seleccionada no tiene una sucursal asociada.");

      const linePayload = {
        product_id: targetRow.product_id,
        variant_id: targetRow.variant_id || null,
        quantity: parsed.data.quantity,
        unit_cost: parsed.data.direction === "in" ? parsed.data.unitCost : 0,
        from_location_id: adjType === "out" ? targetRow.location_id : null,
        to_location_id: adjType === "in" ? targetRow.location_id : null,
      };

      const { error: postErr } = await supabase.rpc("post_stock_document", {
        document_kind: "adjustment",
        target_branch_id: branchId,
        operation_key: adjOperationKey,
        operation_reason: parsed.data.reason,
        lines: [linePayload],
      });

      if (postErr) throw postErr;

      setFeedback({
        type: "success",
        message: "Movimiento de stock registrado.",
      });
      setIsAdjModalOpen(false);
      setAdjError(null);
      setAdjQty("1");
      setAdjUnitCost("");
      setAdjReason("");
      setAdjOperationKey(createOperationKey("adjustment"));
      await fetchStockData();
    } catch (err: unknown) {
      setAdjError(toUserMessage(err, "No se pudo registrar el movimiento de stock."));
    } finally {
      setSubmitting(false);
    }
  };

  const openTransferModal = (sourceRowId: string) => {
    if (!canTransferStock) return;
    const source = stockBalances.find((row) => row.id === sourceRowId);
    const destination = locations.find(
      (location) => location.branch_id === source?.locations?.branch_id && location.id !== source?.location_id,
    );

    setTransferSourceRowId(sourceRowId);
    setTransferDestinationLocationId(destination?.id || "");
    setTransferQty("1");
    setTransferReason("");
    setTransferError(null);
    setTransferOperationKey(createOperationKey("transfer"));
    setIsTransferModalOpen(true);
  };

  const handleCreateTransfer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canTransferStock) return;
    const sourceRow = stockBalances.find((row) => row.id === transferSourceRowId);
    if (!sourceRow) {
      setTransferError("Seleccioná una existencia de origen para transferir.");
      return;
    }

    try {
      setSubmitting(true);
      setTransferError(null);
      const parsed = transferSchema.safeParse({
        stockBalanceId: transferSourceRowId,
        destinationLocationId: transferDestinationLocationId,
        quantity: transferQty,
        reason: transferReason,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Revisá los datos de la transferencia.");
      }

      const sourceBranchId = sourceRow.locations?.branch_id;
      const destination = locations.find((location) => location.id === parsed.data.destinationLocationId);
      if (!sourceBranchId || !destination) {
        throw new Error("No se pudo validar la ubicación de transferencia.");
      }
      if (destination.id === sourceRow.location_id) {
        throw new Error("La ubicación de destino debe ser distinta de la ubicación de origen.");
      }
      if (destination.branch_id !== sourceBranchId) {
        throw new Error("La transferencia debe realizarse entre ubicaciones de la misma sucursal.");
      }

      const available = Number(sourceRow.quantity_on_hand) - Number(sourceRow.quantity_reserved);
      if (parsed.data.quantity > available) {
        throw new Error(`No hay stock disponible suficiente. Disponible: ${available} u.`);
      }

      const { error: postError } = await supabase.rpc("post_stock_document", {
        document_kind: "transfer",
        target_branch_id: sourceBranchId,
        operation_key: transferOperationKey,
        operation_reason: parsed.data.reason,
        lines: [{
          product_id: sourceRow.product_id,
          variant_id: sourceRow.variant_id || null,
          quantity: parsed.data.quantity,
          from_location_id: sourceRow.location_id,
          to_location_id: destination.id,
        }],
      });

      if (postError) throw postError;

      setFeedback({
        type: "success",
        message: `Transferencia registrada: ${parsed.data.quantity} u. movidas a ${destination.name}.`,
      });
      setIsTransferModalOpen(false);
      setTransferError(null);
      await fetchStockData();
    } catch (err: unknown) {
      setTransferError(toUserMessage(err, "No se pudo transferir el stock."));
    } finally {
      setSubmitting(false);
    }
  };

  const selectedLabelItem = useMemo(() => {
    return stockBalances.find((b) => b.id === labelTargetId);
  }, [stockBalances, labelTargetId]);

  const availableLabelQuantity = selectedLabelItem
    ? Math.max(0, Number(selectedLabelItem.quantity_on_hand) - Number(selectedLabelItem.quantity_reserved))
    : 0;
  const suggestedLabelQuantity = Math.min(500, availableLabelQuantity);

  useEffect(() => {
    if (!labelQtyManuallySet) setLabelQty(suggestedLabelQuantity);
  }, [labelQtyManuallySet, suggestedLabelQuantity, selectedLabelItem]);

  const labelBarcodeValue = useMemo(() => {
    if (!selectedLabelItem) return "779000000001";
    const found = selectedLabelItem.product_identifiers?.find((pi) => pi.kind === "barcode")?.value;
    if (found) return found;
    // Fallback: unique formatted barcode
    const code = selectedLabelItem.products?.internal_code || "PROD";
    const vCode = selectedLabelItem.product_variants?.code || "U";
    return `${code}-${vCode}`.toUpperCase();
  }, [selectedLabelItem]);

  const filteredBalances = useMemo(() => {
    if (!search.trim()) return stockBalances;
    const q = search.toLowerCase();
    return stockBalances.filter((b) => {
      const pName = b.products?.internal_name || "";
      const pCode = b.products?.internal_code || "";
      const vName = b.product_variants?.name || "";
      const loc = b.locations?.name || "";
      const barcode = b.product_identifiers?.find((pi) => pi.kind === "barcode")?.value || "";
      return (
        pName.toLowerCase().includes(q) ||
        pCode.toLowerCase().includes(q) ||
        vName.toLowerCase().includes(q) ||
        loc.toLowerCase().includes(q) ||
        barcode.toLowerCase().includes(q)
      );
    });
  }, [stockBalances, search]);

  const transferDestinations = useMemo(() => {
    const source = stockBalances.find((row) => row.id === transferSourceRowId);
    if (!source?.locations?.branch_id) return [];
    return locations.filter(
      (location) => location.branch_id === source.locations?.branch_id && location.id !== source.location_id,
    );
  }, [locations, stockBalances, transferSourceRowId]);

  const isLabelsMode = activeModuleId === "labels";

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title={
          isLabelsMode
            ? "Generación & Impresión de Código de Barras"
            : "Gestión de Existencias & Variantes"
        }
        description={
          isLabelsMode
            ? "Rotulado físico para fundas y accesorios con códigos de barras individuales por variante."
            : "Control centralizado de inventario por variante de color, ubicación y trazabilidad de movimientos."
        }
        badge={`${stockBalances.length} Variantes en Existencia`}
      />

      {onSelectModule && (
        <WorkspaceModuleTabs
          moduleIds={["stock", "labels"]}
          activeModuleId={isLabelsMode ? "labels" : "stock"}
          onSelectModule={onSelectModule}
        />
      )}

      <label><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Ver inactivos</label>

      {error && (
        <FeedbackAlert
          type="error"
          message={error}
          onClose={() => setError(null)}
          action={
            <button type="button" className="pag-btn" onClick={() => void fetchStockData()}>
              Reintentar
            </button>
          }
        />
      )}

      {feedback && (
        <FeedbackAlert
          type={feedback.type}
          message={feedback.message}
          onClose={() => setFeedback(null)}
        />
      )}

      {!isLabelsMode ? (
        <>
          {/* Sub Navigation */}
          <div className="flow-tabs-nav flow-tabs-nav--switcher" style={{ marginBottom: "16px" }} role="tablist" aria-label="Vista de inventario">
            <button
              type="button"
              role="tab"
              aria-selected={stockSubTab === "locations"}
              className={`flow-tab-btn ${stockSubTab === "locations" ? "active" : ""}`}
              onClick={() => setStockSubTab("locations")}
            >
              <Building2 size={15} /> Existencias por Variante & Ubicación
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={stockSubTab === "movements"}
              className={`flow-tab-btn ${stockSubTab === "movements" ? "active" : ""}`}
              onClick={() => setStockSubTab("movements")}
            >
              <History size={15} /> Historial de movimientos
            </button>
          </div>

          {stockSubTab === "locations" ? (
            <div className="flow-card">
              <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <h2 className="flow-card__title">Existencias por Variante</h2>
                  <p className="flow-card__subtitle">
                    Saldos reales de stock por producto, color/variante y depósito
                  </p>
                </div>

                <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="pag-btn"
                    onClick={fetchStockData}
                    disabled={loading}
                    title="Recargar inventario"
                  >
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                  </button>

                  <div className="flow-search-pill" style={{ width: "240px" }}>
                    <Search size={15} />
                    <input
                      type="text"
                      placeholder="Buscar por código, variante o barras..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>

                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!canAdjustStock}
                    title={!canAdjustStock ? "Requiere permiso: ajustar y mover stock" : undefined}
                    onClick={() => openAdjustmentModal()}
                  >
                    <Plus size={16} /> Ajustar Stock
                  </button>
                  <button
                    type="button"
                    className="pag-btn"
                    disabled={!canTransferStock || stockBalances.length === 0}
                    title={!canTransferStock ? "Requiere permiso: mover stock" : undefined}
                    onClick={() => openTransferModal(adjRowId || stockBalances[0]?.id || "")}
                  >
                    <ArrowRightLeft size={16} /> Transferir stock
                  </button>
                </div>
              </div>

              <div className="flow-table-wrapper">
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>Ubicación</th>
                      <th>Código</th>
                      <th>Artículo / Modelo</th>
                      <th>Variante / Color</th>
                      <th>Código de Barras</th>
                      <th>En Mano</th>
                      <th>Reservado</th>
                      <th>Disponible</th>
                      {hasRowActions && <th className="text-right">Acción</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={hasRowActions ? 9 : 8} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                          <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} />
                          Cargando existencias…
                        </td>
                      </tr>
                    ) : filteredBalances.length === 0 ? (
                      <tr>
                        <td colSpan={hasRowActions ? 9 : 8} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                          No se encontraron existencias registradas.
                        </td>
                      </tr>
                    ) : (
                      filteredBalances.map((row) => {
                        const barcode = row.product_identifiers?.find((pi) => pi.kind === "barcode")?.value;
                        const available = Number(row.quantity_on_hand) - Number(row.quantity_reserved);

                        return (
                          <tr key={row.id}>
                            <td>
                              <span className="module-state-badge nowrap" style={{ fontSize: "11px" }}>
                                {row.locations?.name || "Depósito"}
                              </span>
                            </td>
                            <td>
                              <span className="type-badge blue" style={{ fontFamily: "monospace", fontSize: "11px" }}>
                                {row.products?.internal_code || "—"}
                              </span>
                            </td>
                            <td>
                              <strong style={{ fontSize: "13px", color: "var(--text-main)" }}>
                                {row.products?.internal_name || "Producto"}
                              </strong>
                            </td>
                            <td>
                              {row.product_variants?.name ? (
                                <span className="type-badge green" style={{ fontWeight: 700 }}>
                                  {row.product_variants.name}
                                </span>
                              ) : (
                                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Única</span>
                              )}
                            </td>
                            <td>
                              {barcode ? (
                                <span style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--text-main)" }}>
                                  {barcode}
                                </span>
                              ) : (
                                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>—</span>
                              )}
                            </td>
                            <td>
                              <strong style={{ fontSize: "13px", color: Number(row.quantity_on_hand) > 0 ? "var(--text-main)" : "var(--rose-accent)" }}>
                                {row.quantity_on_hand} u.
                              </strong>
                            </td>
                            <td>
                              <span style={{ fontSize: "12px", color: Number(row.quantity_reserved) > 0 ? "var(--amber-accent)" : "var(--text-muted)" }}>
                                {row.quantity_reserved} u.
                              </span>
                            </td>
                            <td>
                              <strong
                                style={{
                                  fontSize: "13px",
                                  color:
                                    available > 3
                                      ? "var(--emerald-success)"
                                      : available > 0
                                        ? "var(--amber-accent)"
                                        : "var(--rose-accent)",
                                }}
                              >
                                {available} u.
                              </strong>
                            </td>
                            {hasRowActions && (
                              <td className="text-right">
                                {canAdjustStock && (
                                  <button
                                    type="button"
                                    className="pag-btn"
                                    style={{ fontSize: "11px", padding: "4px 8px" }}
                                    onClick={() => openAdjustmentModal(row.id)}
                                  >
                                    <Plus size={11} /> Ajustar
                                  </button>
                                )}
                                {canTransferStock && (
                                  <button
                                    type="button"
                                    className="pag-btn"
                                    style={{ fontSize: "11px", padding: "4px 8px", marginLeft: canAdjustStock ? "6px" : 0 }}
                                    disabled={available <= 0}
                                    onClick={() => openTransferModal(row.id)}
                                  >
                                    <ArrowRightLeft size={11} /> Transferir
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* Kárdex of Movements */
            <div className="flow-card">
              <div className="flow-card__header">
                <div>
                  <h2 className="flow-card__title">Movimientos de stock</h2>
                  <p className="flow-card__subtitle">Registros de ingresos, egresos, ajustes y transferencias con trazabilidad</p>
                </div>
              </div>

              <div className="flow-table-wrapper">
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>Fecha / Hora</th>
                      <th>Tipo</th>
                      <th>Motivo</th>
                      <th>Líneas de Movimiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDocs.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                          No hay movimientos de stock registrados recientemente.
                        </td>
                      </tr>
                    ) : (
                      recentDocs.map((doc) => (
                        <tr key={doc.id}>
                          <td>
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                              {formatDateTime(doc.created_at)}
                            </span>
                          </td>
                          <td>
                            <span className="type-badge blue">
                              {labelOf(STOCK_DOCUMENT_KIND_LABELS, doc.kind, "Movimiento")}
                            </span>
                          </td>
                          <td>
                            <strong style={{ fontSize: "13px" }}>{doc.reason}</strong>
                          </td>
                          <td>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              {(doc.stock_document_lines || []).map((line) => (
                                <span key={line.id} style={{ fontSize: "12px", color: "var(--text-main)" }}>
                                  • {line.products?.internal_name || "Artículo"}
                                  {line.product_variants?.name ? ` (${line.product_variants.name})` : ""}:{" "}
                                  <strong>{line.quantity} u.</strong>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Barcode Labels Tab (Finding 7) */
        <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: "20px", alignItems: "flex-start" }}>
          {/* Controls Card */}
          <div className="flow-card">
            <div className="flow-card__header">
              <div>
                <h2 className="flow-card__title">Configurar Etiquetas</h2>
                <p className="flow-card__subtitle">Selección de variante y cantidad para impresión térmica</p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "12px" }}>
              <div className="erp-form-group">
                <label className="erp-form-label" htmlFor="stock-label-item">Variante / Artículo a Rotular *</label>
                <select
                  id="stock-label-item"
                  value={labelTargetId}
                  onChange={(e) => {
                    setLabelTargetId(e.target.value);
                    setLabelQtyManuallySet(false);
                  }}
                  className="erp-form-input"
                >
                  {stockBalances.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.products?.internal_name} - {b.product_variants?.name || "Única"} ({Math.max(0, Number(b.quantity_on_hand) - Number(b.quantity_reserved))} u. disponibles en {b.locations?.name})
                    </option>
                  ))}
                </select>
              </div>

              <div className="erp-form-group">
                <label className="erp-form-label" htmlFor="stock-label-format">Formato de Etiqueta</label>
                <select
                  id="stock-label-format"
                  value={labelFormat}
                  onChange={(e) => setLabelFormat(e.target.value)}
                  className="erp-form-input"
                >
                  <option value="50x30">Térmica 50x30 mm (Zebra / Xprinter / Fundas)</option>
                  <option value="70x35">Térmica 70x35 mm (Cajas y Despacho)</option>
                  <option value="a4">Hoja Adhesiva A4 (30 por hoja)</option>
                </select>
              </div>

              <div className="erp-form-group">
                <label className="erp-form-label" htmlFor="stock-label-quantity">Copias a imprimir *</label>
                <input
                  id="stock-label-quantity"
                  type="number"
                  min="1"
                  max="500"
                  value={labelQty}
                  onChange={(e) => {
                    setLabelQtyManuallySet(true);
                    setLabelQty(Math.min(500, Math.max(1, parseInt(e.target.value, 10) || 1)));
                  }}
                  className="erp-form-input"
                />
                <small className="erp-form-hint">
                  Disponible en {selectedLabelItem?.locations?.name || "la ubicación elegida"}: {availableLabelQuantity} u.
                  {availableLabelQuantity > 500 ? " La impresión está limitada a 500 etiquetas por lote." : ""}
                </small>
              </div>

              <button
                type="button"
                className="pag-btn"
                disabled={!selectedLabelItem || suggestedLabelQuantity === 0}
                onClick={() => {
                  setLabelQtyManuallySet(false);
                  setLabelQty(suggestedLabelQuantity);
                }}
              >
                Usar sugerencia: {suggestedLabelQuantity} copias
              </button>

              <button
                type="button"
                className="btn-primary"
                onClick={() => window.print()}
                disabled={!selectedLabelItem || labelQty < 1}
                style={{ marginTop: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
              >
                <Printer size={16} /> Imprimir {labelQty} Rótulos
              </button>
            </div>
          </div>

          {/* Preview & Print Grid */}
          <div className="flow-card">
            <div className="flow-card__header">
              <div>
                <h2 className="flow-card__title">Vista Previa del Rótulo Físico</h2>
                <p className="flow-card__subtitle">
                  Código de barras 100% escaneable por lectores láser / 2D
                </p>
              </div>
              <span className="type-badge green">Código registrado</span>
            </div>

            {selectedLabelItem ? (
              <div>
                {/* Single Card Big Preview */}
                <div
                  style={{
                    background: "#ffffff",
                    color: "#111827",
                    border: "2px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "16px",
                    maxWidth: "320px",
                    margin: "0 auto 24px auto",
                    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.05em", color: "#6b7280", textTransform: "uppercase" }}>
                    NicTech • Accesorios
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 700, margin: "4px 0", color: "#111827" }}>
                    {selectedLabelItem.products?.internal_name}
                  </div>
                  {selectedLabelItem.product_variants?.name && (
                    <div style={{ fontSize: "12px", fontWeight: 650, color: "#2563eb", marginBottom: "8px" }}>
                      Color: {selectedLabelItem.product_variants.name}
                    </div>
                  )}

                  <BarcodeSvg value={labelBarcodeValue} width={260} height={68} />
                </div>

                {/* Print Sheet Container (Repeats labelQty times for printing) */}
                <div style={{ borderTop: "1px solid var(--border-line)", paddingTop: "16px" }}>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "block", marginBottom: "12px" }}>
                    Hoja de impresión generada ({labelQty} etiquetas listas para imprimir):
                  </span>

                  <div
                    id="printable-labels-area"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                      gap: "10px",
                      maxHeight: "360px",
                      overflowY: "auto",
                      padding: "10px",
                      background: "var(--bg-app)",
                      borderRadius: "8px",
                    }}
                  >
                    {Array.from({ length: labelQty }).map((_, idx) => (
                      <div
                        key={idx}
                        className="printable-stock-label"
                        style={{
                          background: "#ffffff",
                          border: "1px solid #d1d5db",
                          borderRadius: "4px",
                          padding: "8px",
                          textAlign: "center",
                          color: "#111827",
                        }}
                      >
                        <span style={{ fontSize: "10px", fontWeight: 700, display: "block", color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {selectedLabelItem.products?.internal_name}
                        </span>
                        {selectedLabelItem.product_variants?.name && (
                          <span style={{ fontSize: "9px", fontWeight: 650, color: "#2563eb", display: "block" }}>
                            {selectedLabelItem.product_variants.name}
                          </span>
                        )}
                        <BarcodeSvg value={labelBarcodeValue} width={150} height={45} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <StatePanel type="empty" title="Sin artículo seleccionado" message="Seleccioná una variante para ver la vista previa." />
            )}
          </div>
        </div>
      )}

      {/* Modal: New Stock Adjustment */}
      <Modal
        isOpen={isAdjModalOpen}
        onClose={() => { setAdjError(null); setIsAdjModalOpen(false); }}
        title="Registrar movimiento de stock"
        subtitle="El stock se actualiza al confirmar."
        icon={ArrowRightLeft}
        maxWidth="500px"
      >
        <form noValidate onSubmit={handleCreateAdjustment} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <FormError message={adjError} onDismiss={() => setAdjError(null)} />
          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="stock-adjustment-balance">Variante / Ubicación a Ajustar *</label>
            <select
              id="stock-adjustment-balance"
              value={adjRowId}
              onChange={(e) => setAdjRowId(e.target.value)}
              className="erp-form-input"
              required
            >
              {stockBalances.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.products?.internal_name} - {b.product_variants?.name || "Única"} ({b.locations?.name}, Stock: {b.quantity_on_hand} u.)
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="stock-adjustment-direction">Sentido del Movimiento *</label>
              <select
                id="stock-adjustment-direction"
                value={adjType}
                onChange={(e) => setAdjType(e.target.value as "in" | "out")}
                className="erp-form-input"
              >
                <option value="in">Ingreso (+) Reposición</option>
                <option value="out">Egreso (-) Merma / Daño</option>
              </select>
            </div>

            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="stock-adjustment-quantity">Cantidad (Unidades) *</label>
              <input
                id="stock-adjustment-quantity"
                type="number"
                required
                min="1"
                step="1"
                value={adjQty}
                onChange={(e) => setAdjQty(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          {adjType === "in" && (
            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="stock-adjustment-unit-cost">Costo unitario de ingreso *</label>
              <input
                id="stock-adjustment-unit-cost"
                type="number"
                required
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={adjUnitCost}
                onChange={(e) => setAdjUnitCost(e.target.value)}
                className="erp-form-input"
                aria-describedby="stock-adjustment-unit-cost-hint"
              />
              <small id="stock-adjustment-unit-cost-hint" className="erp-form-hint">
                Se usa para el costo promedio y la rentabilidad. No puede quedar en cero.
              </small>
            </div>
          )}

          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="stock-adjustment-reason">Motivo de Auditoría *</label>
            <input
              id="stock-adjustment-reason"
              type="text"
              required
              minLength={5}
              maxLength={240}
              placeholder="Ej: Conteo físico o rotura en depósito"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              className="erp-form-input"
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsAdjModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? "Registrando…" : "Confirmar Movimiento"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isTransferModalOpen}
        onClose={() => { setTransferError(null); setIsTransferModalOpen(false); }}
        title="Transferir stock entre ubicaciones"
        subtitle="El movimiento conserva el costo y queda registrado en el historial de stock."
        icon={ArrowRightLeft}
        maxWidth="500px"
      >
        <form noValidate onSubmit={handleCreateTransfer} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <FormError message={transferError} onDismiss={() => setTransferError(null)} />
          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="stock-transfer-source">Origen *</label>
            <select
              id="stock-transfer-source"
              value={transferSourceRowId}
              onChange={(event) => openTransferModal(event.target.value)}
              className="erp-form-input"
              required
            >
              {stockBalances.map((balance) => (
                <option key={balance.id} value={balance.id}>
                  {balance.products?.internal_name || "Artículo"} · {balance.locations?.name || "Ubicación"} ({Number(balance.quantity_on_hand) - Number(balance.quantity_reserved)} u. disponibles)
                </option>
              ))}
            </select>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="stock-transfer-destination">Destino *</label>
            <select
              id="stock-transfer-destination"
              value={transferDestinationLocationId}
              onChange={(event) => setTransferDestinationLocationId(event.target.value)}
              className="erp-form-input"
              required
            >
              <option value="">Seleccioná una ubicación</option>
              {transferDestinations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}{location.allows_sale ? " · Punto de venta" : ""}
                </option>
              ))}
            </select>
            {transferDestinations.length === 0 && (
              <small className="erp-form-hint">No hay otra ubicación activa disponible en esta sucursal.</small>
            )}
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="stock-transfer-quantity">Cantidad (unidades) *</label>
            <input
              id="stock-transfer-quantity"
              type="number"
              min="1"
              step="1"
              required
              value={transferQty}
              onChange={(event) => setTransferQty(event.target.value)}
              className="erp-form-input"
            />
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="stock-transfer-reason">Motivo de auditoría *</label>
            <input
              id="stock-transfer-reason"
              type="text"
              required
              minLength={5}
              maxLength={240}
              placeholder="Ej: Reposición de mostrador para ventas"
              value={transferReason}
              onChange={(event) => setTransferReason(event.target.value)}
              className="erp-form-input"
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsTransferModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={submitting || transferDestinations.length === 0}>
              {submitting ? "Transfiriendo…" : "Confirmar transferencia"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
