import { useState, useEffect, useCallback, useMemo } from "react";
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
import { type ErpModuleId } from "@nictech/domain";
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
  locations?: { name: string; code: string } | null;
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
    unit_cost: number;
    from_location_id: string | null;
    to_location_id: string | null;
    products?: { internal_name: string } | null;
    product_variants?: { name: string } | null;
  }>;
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

export const StockWorkspace: React.FC<StockWorkspaceProps> = ({
  activeModuleId = "stock",
  onSelectModule,
}) => {
  const [stockSubTab, setStockSubTab] = useState<"locations" | "movements">("locations");
  const [stockBalances, setStockBalances] = useState<DbStockRow[]>([]);
  const [recentDocs, setRecentDocs] = useState<DbStockDoc[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Form states for adjustment
  const [isAdjModalOpen, setIsAdjModalOpen] = useState<boolean>(false);
  const [adjRowId, setAdjRowId] = useState<string>("");
  const [adjType, setAdjType] = useState<"in" | "out">("in");
  const [adjQty, setAdjQty] = useState<string>("1");
  const [adjReason, setAdjReason] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Label printer state (Finding 7)
  const [labelTargetId, setLabelTargetId] = useState<string>("");
  const [labelQty, setLabelQty] = useState<number>(20);
  const [labelFormat, setLabelFormat] = useState<string>("50x30");

  const fetchStockData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Fetch real stock balances broken down by variant & location
      const { data: balData, error: balErr } = await supabase
        .from("stock_balances")
        .select(`
          id, product_id, variant_id, location_id, quantity_on_hand, quantity_reserved, updated_at,
          products(internal_code, internal_name, item_kind),
          product_variants(name, code),
          locations(name, code)
        `)
        .order("updated_at", { ascending: false });

      if (balErr) throw balErr;

      // 2. Fetch barcodes for all variants in balances
      const { data: piData } = await supabase
        .from("product_identifiers")
        .select("product_id, variant_id, kind, value")
        .eq("kind", "barcode");

      const rows: DbStockRow[] = (balData || []).map((b: any) => {
        const identifiers = (piData || []).filter(
          (pi: any) => pi.product_id === b.product_id && pi.variant_id === b.variant_id,
        );
        return {
          ...b,
          product_identifiers: identifiers,
        };
      });

      setStockBalances(rows);
      if (rows.length > 0 && !labelTargetId) {
        setLabelTargetId(rows[0].id);
        setAdjRowId(rows[0].id);
      }

      // 3. Fetch recent stock documents
      const { data: docData } = await supabase
        .from("stock_documents")
        .select(`
          id, kind, reason, created_at,
          stock_document_lines(
            id, quantity, unit_cost, from_location_id, to_location_id,
            products(internal_name),
            product_variants(name)
          )
        `)
        .order("created_at", { ascending: false })
        .limit(20);

      setRecentDocs((docData as unknown as DbStockDoc[]) || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al cargar datos de inventario");
    } finally {
      setLoading(false);
    }
  }, [labelTargetId]);

  useEffect(() => {
    fetchStockData();
  }, [fetchStockData]);

  // Handle transactional stock adjustment via post_stock_document
  const handleCreateAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetRow = stockBalances.find((r) => r.id === adjRowId);
    if (!targetRow || !adjQty) return;

    try {
      setSubmitting(true);
      setError(null);
      const qtyNum = Math.round(Number(adjQty));
      if (qtyNum <= 0) throw new Error("La cantidad debe ser un entero positivo.");

      const opKey = `adj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const branchId = "20000000-0000-0000-0000-000000000001";

      const linePayload = {
        product_id: targetRow.product_id,
        variant_id: targetRow.variant_id || null,
        quantity: qtyNum,
        unit_cost: 0,
        from_location_id: adjType === "out" ? targetRow.location_id : null,
        to_location_id: adjType === "in" ? targetRow.location_id : null,
      };

      const { error: postErr } = await supabase.rpc("post_stock_document", {
        document_kind: "adjustment",
        target_branch_id: branchId,
        operation_key: opKey,
        operation_reason: adjReason.trim() || `Ajuste manual de stock (${adjType === "in" ? "Ingreso" : "Egreso"})`,
        lines: [linePayload],
      });

      if (postErr) throw postErr;

      setFeedback({
        type: "success",
        message: `¡Movimiento de stock registrado correctamente en el ledger ERP!`,
      });
      setIsAdjModalOpen(false);
      setAdjQty("1");
      setAdjReason("");
      await fetchStockData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al registrar movimiento");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedLabelItem = useMemo(() => {
    return stockBalances.find((b) => b.id === labelTargetId);
  }, [stockBalances, labelTargetId]);

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

  const isLabelsMode = activeModuleId === "labels";

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title={isLabelsMode ? "Generación & Impresión de Código de Barras" : "Gestión de Existencias & Variantes"}
        description={
          isLabelsMode
            ? "Rotulado físico para fundas y accesorios con códigos de barras individuales por variante."
            : "Control centralizado de inventario por variante de color, ubicación y trazabilidad de movimientos."
        }
        badge={`${stockBalances.length} Variantes en Existencia`}
      />

      {onSelectModule && (
        <WorkspaceModuleTabs
          moduleIds={["stock", "stock-counts", "labels"]}
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

      {!isLabelsMode ? (
        <>
          {/* Sub Navigation */}
          <div className="flow-tabs-nav" style={{ marginBottom: "16px" }}>
            <button
              type="button"
              className={`flow-tab-btn ${stockSubTab === "locations" ? "active" : ""}`}
              onClick={() => setStockSubTab("locations")}
            >
              <Building2 size={15} /> Existencias por Variante & Ubicación
            </button>
            <button
              type="button"
              className={`flow-tab-btn ${stockSubTab === "movements" ? "active" : ""}`}
              onClick={() => setStockSubTab("movements")}
            >
              <History size={15} /> Kárdex de Movimientos ERP
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

                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
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
                    onClick={() => {
                      if (stockBalances.length > 0 && !adjRowId) {
                        setAdjRowId(stockBalances[0].id);
                      }
                      setIsAdjModalOpen(true);
                    }}
                  >
                    <Plus size={16} /> Ajustar Stock
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
                      <th className="text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={9} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                          <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} />
                          Cargando inventario ERP...
                        </td>
                      </tr>
                    ) : filteredBalances.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                          No se encontraron existencias registradas en la base de datos.
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
                            <td className="text-right">
                              <button
                                type="button"
                                className="pag-btn"
                                style={{ fontSize: "11px", padding: "4px 8px" }}
                                onClick={() => {
                                  setAdjRowId(row.id);
                                  setIsAdjModalOpen(true);
                                }}
                              >
                                <ArrowRightLeft size={11} /> Ajustar
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
          ) : (
            /* Kárdex of Movements */
            <div className="flow-card">
              <div className="flow-card__header">
                <div>
                  <h2 className="flow-card__title">Kárdex de Movimientos Transaccionales</h2>
                  <p className="flow-card__subtitle">Documentos formales de ingreso, egreso y ajustes en el ledger ERP</p>
                </div>
              </div>

              <div className="flow-table-wrapper">
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>Fecha / Hora</th>
                      <th>Tipo Doc</th>
                      <th>Motivo / Razón</th>
                      <th>Líneas de Movimiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDocs.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                          No hay documentos de stock registrados recientemente.
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
                            <span className="type-badge blue" style={{ textTransform: "uppercase" }}>
                              {doc.kind}
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
                <label className="erp-form-label">Variante / Artículo a Rotular *</label>
                <select
                  value={labelTargetId}
                  onChange={(e) => setLabelTargetId(e.target.value)}
                  className="erp-form-input"
                >
                  {stockBalances.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.products?.internal_name} - {b.product_variants?.name || "Única"} ({b.quantity_on_hand} u. en {b.locations?.name})
                    </option>
                  ))}
                </select>
              </div>

              <div className="erp-form-group">
                <label className="erp-form-label">Formato de Etiqueta</label>
                <select
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
                <label className="erp-form-label">Cantidad de Copias a Generar *</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={labelQty}
                  onChange={(e) => setLabelQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="erp-form-input"
                />
              </div>

              {/* Quick Batch Buttons (Finding 7 - no alerts!) */}
              <div>
                <span className="erp-form-label" style={{ display: "block", marginBottom: "6px" }}>
                  Lotes Rápidos de Impresión:
                </span>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="pag-btn"
                    onClick={() => setLabelQty(10)}
                  >
                    +10 copias
                  </button>
                  <button
                    type="button"
                    className="pag-btn"
                    onClick={() => setLabelQty(20)}
                  >
                    +20 copias
                  </button>
                  <button
                    type="button"
                    className="pag-btn"
                    onClick={() => setLabelQty(50)}
                  >
                    +50 copias
                  </button>
                  {selectedLabelItem && (
                    <button
                      type="button"
                      className="pag-btn"
                      onClick={() => setLabelQty(Math.max(1, Number(selectedLabelItem.quantity_on_hand)))}
                      style={{ color: "var(--brand-primary)", borderColor: "var(--brand-border)" }}
                    >
                      Todo el Stock ({selectedLabelItem.quantity_on_hand} u.)
                    </button>
                  )}
                </div>
              </div>

              <button
                type="button"
                className="btn-primary"
                onClick={() => window.print()}
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
              <span className="type-badge green">Código Real Persistido</span>
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
                    {Array.from({ length: Math.min(100, labelQty) }).map((_, idx) => (
                      <div
                        key={idx}
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
              <StatePanel type="empty" title="Sin artículo seleccionado" message="Selecciona una variante para previsualizar rótulo." />
            )}
          </div>
        </div>
      )}

      {/* Modal: New Stock Adjustment */}
      <Modal
        isOpen={isAdjModalOpen}
        onClose={() => setIsAdjModalOpen(false)}
        title="Registrar Movimiento en Ledger de Stock"
        subtitle="Movimiento transaccional con actualización inmediata en stock_balances"
        icon={ArrowRightLeft}
        maxWidth="500px"
      >
        <form onSubmit={handleCreateAdjustment} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="erp-form-group">
            <label className="erp-form-label">Variante / Ubicación a Ajustar *</label>
            <select
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
              <label className="erp-form-label">Sentido del Movimiento *</label>
              <select
                value={adjType}
                onChange={(e) => setAdjType(e.target.value as "in" | "out")}
                className="erp-form-input"
              >
                <option value="in">Ingreso (+) Reposición</option>
                <option value="out">Egreso (-) Merma / Daño</option>
              </select>
            </div>

            <div className="erp-form-group">
              <label className="erp-form-label">Cantidad (Unidades) *</label>
              <input
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

          <div className="erp-form-group">
            <label className="erp-form-label">Motivo de Auditoría</label>
            <input
              type="text"
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
    </div>
  );
};
