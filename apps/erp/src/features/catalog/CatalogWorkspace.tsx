import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Boxes,
  Search,
  Plus,
  Tag,
  AlertTriangle,
  DollarSign,
  Loader2,
  RefreshCw,
  Edit2,
  ChevronLeft,
  ChevronRight,
  Layers,
  Barcode,
} from "lucide-react";
import {
  WorkspaceHeader,
  WorkspaceModuleTabs,
  StatePanel,
  Modal,
  FeedbackAlert,
  KpiCard,
} from "../../components/erp/WorkspaceUi";
import { type ErpModuleId } from "@nictech/domain";
import { formatCurrency, formatCurrencyCompact } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";

export interface DbVariantIdentifier {
  kind: string;
  value: string;
}

export interface DbProductVariant {
  id: string;
  code: string;
  name: string;
  attributes?: Record<string, unknown>;
  price_delta: number;
  is_active: boolean;
  product_identifiers?: DbVariantIdentifier[];
}

export interface DbStockBalance {
  quantity_on_hand: number;
  quantity_reserved: number;
  variant_id: string | null;
}

export interface DbCatalogProduct {
  id: string;
  internal_code: string;
  internal_name: string;
  public_name: string | null;
  base_sale_price: number;
  tax_rate_percent: number;
  is_active: boolean;
  item_kind: string;
  inventory_tracking: string;
  created_at: string;
  product_categories?: { name: string } | null;
  brands?: { name: string } | null;
  product_models?: { name: string } | null;
  product_variants?: DbProductVariant[];
  stock_balances?: DbStockBalance[];
}

export interface CatalogWorkspaceProps {
  activeModuleId?: "catalog" | "pricing";
  onSelectModule?: (id: ErpModuleId) => void;
}

interface NewVariantRow {
  name: string;
  code: string;
  barcode: string;
  price_delta: string;
}

const PAGE_SIZE = 25;

export const CatalogWorkspace: React.FC<CatalogWorkspaceProps> = ({
  activeModuleId = "catalog",
  onSelectModule,
}) => {
  const [products, setProducts] = useState<DbCatalogProduct[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Modals & Feedback
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<DbCatalogProduct | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Form states for creating
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newPriceArs, setNewPriceArs] = useState("");
  const [hasVariants, setHasVariants] = useState(false);
  const [variantsList, setVariantsList] = useState<NewVariantRow[]>([
    { name: "Negro", code: "NEG", barcode: "", price_delta: "0" },
    { name: "Rosa", code: "ROS", barcode: "", price_delta: "0" },
  ]);

  // Form states for editing
  const [editName, setEditName] = useState("");
  const [editPriceArs, setEditPriceArs] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from("products")
        .select(
          `
          id, internal_code, internal_name, public_name, base_sale_price,
          tax_rate_percent, is_active, item_kind, inventory_tracking, created_at,
          product_categories(name),
          brands(name),
          product_models(name),
          product_variants(id, code, name, price_delta, is_active, product_identifiers(kind, value)),
          stock_balances(quantity_on_hand, quantity_reserved, variant_id)
        `,
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (search.trim()) {
        const term = search.trim();
        query = query.or(`internal_name.ilike.%${term}%,internal_code.ilike.%${term}%`);
      }

      const { data, error: dbErr, count } = await query;

      if (dbErr) throw dbErr;
      setProducts((data as unknown as DbCatalogProduct[]) || []);
      setTotalCount(count ?? 0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al cargar catálogo ERP";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.product_categories?.name) set.add(p.product_categories.name);
    });
    return ["all", ...Array.from(set)];
  }, [products]);

  const filteredItems = useMemo(() => {
    if (selectedCategory === "all") return products;
    return products.filter((item) => {
      const catName = item.product_categories?.name || "Sin Categoría";
      return catName === selectedCategory;
    });
  }, [products, selectedCategory]);

  const totalValueArs = useMemo(() => {
    return products.reduce((acc, p) => {
      const totalStock = (p.stock_balances || []).reduce((s, b) => s + (b.quantity_on_hand || 0), 0);
      return acc + (p.base_sale_price || 0) * totalStock;
    }, 0);
  }, [products]);

  const lowStockCount = useMemo(() => {
    return products.filter((p) => {
      const totalStock = (p.stock_balances || []).reduce((s, b) => s + (b.quantity_on_hand || 0), 0);
      return totalStock > 0 && totalStock <= 3;
    }).length;
  }, [products]);

  const outOfStockCount = useMemo(() => {
    return products.filter((p) => {
      const totalStock = (p.stock_balances || []).reduce((s, b) => s + (b.quantity_on_hand || 0), 0);
      return totalStock === 0;
    }).length;
  }, [products]);

  const addVariantRow = () => {
    setVariantsList((prev) => [...prev, { name: "", code: "", barcode: "", price_delta: "0" }]);
  };

  const removeVariantRow = (index: number) => {
    setVariantsList((prev) => prev.filter((_, i) => i !== index));
  };

  const updateVariantRow = (index: number, field: keyof NewVariantRow, value: string) => {
    setVariantsList((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newCode.trim()) return;
    try {
      setSubmitting(true);
      const price = newPriceArs ? parseFloat(newPriceArs) : 0;

      const variantsPayload = hasVariants
        ? variantsList
            .filter((v) => v.name.trim() && v.code.trim())
            .map((v) => ({
              name: v.name.trim(),
              code: v.code.trim().toUpperCase(),
              attributes: { color: v.name.trim() },
              price_delta: parseFloat(v.price_delta || "0"),
              barcode: v.barcode.trim() || null,
            }))
        : [];

      const { data, error: rpcErr } = await supabase.rpc(
        "create_catalog_product_with_variants",
        {
          p_internal_code: newCode.trim().toUpperCase(),
          p_internal_name: newName.trim(),
          p_item_kind: "product",
          p_inventory_tracking: "quantity",
          p_category_id: null,
          p_brand_id: null,
          p_model_id: null,
          p_unit_id: null,
          p_base_cost: 0,
          p_base_sale_price: price,
          p_tax_rate_percent: 21,
          p_variants: variantsPayload,
        },
      );

      if (rpcErr) throw rpcErr;

      setFeedback({
        type: "success",
        message: `¡Artículo "${newName.trim()}" creado exitosamente en el catálogo ERP!`,
      });
      setIsCreateOpen(false);
      setNewCode("");
      setNewName("");
      setNewPriceArs("");
      setHasVariants(false);
      fetchProducts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al crear producto";
      setFeedback({ type: "error", message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (p: DbCatalogProduct) => {
    setEditingProduct(p);
    setEditName(p.internal_name);
    setEditPriceArs(p.base_sale_price ? p.base_sale_price.toString() : "");
    setEditIsActive(p.is_active ?? true);
  };

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    try {
      setSubmitting(true);
      // Finding 2: Editing price updates base_sale_price without destroying variants or stock!
      const { error: updErr } = await supabase
        .from("products")
        .update({
          internal_name: editName.trim(),
          base_sale_price: editPriceArs ? parseFloat(editPriceArs) : 0,
          is_active: editIsActive,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingProduct.id);

      if (updErr) throw updErr;

      setFeedback({
        type: "success",
        message: `¡Precio y datos de "${editName.trim()}" actualizados sin alterar variantes ni stock!`,
      });
      setEditingProduct(null);
      fetchProducts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al actualizar producto";
      setFeedback({ type: "error", message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const isPricingMode = activeModuleId === "pricing";
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title={isPricingMode ? "Listas de Precios, Monedas & Cotizaciones" : "Catálogo Maestro de Productos"}
        description={
          isPricingMode
            ? "Configuración de precios de venta en ARS/USD, márgenes de comercialización y actualización de cotizaciones."
            : "Gestión oficial de productos, fundas con variantes de color, códigos de barras y existencias por combinación."
        }
        badge={`${totalCount} Artículos en ERP`}
      />

      {onSelectModule && (
        <WorkspaceModuleTabs
          moduleIds={["catalog", "pricing"]}
          activeModuleId={activeModuleId}
          onSelectModule={onSelectModule}
        />
      )}

      {feedback && (
        <FeedbackAlert
          type={feedback.type}
          message={feedback.message}
          onClose={() => setFeedback(null)}
        />
      )}

      {/* KPI Cards */}
      <div className="kpi-grid">
        <KpiCard
          icon={Boxes}
          iconVariant="green"
          label="Total Artículos"
          value={totalCount}
          trend={{ text: "Catálogo ERP", positive: true }}
          sublabel="Productos y accesorios"
        />

        <KpiCard
          icon={DollarSign}
          iconVariant="navy"
          label="Valorización de Stock"
          value={formatCurrencyCompact(totalValueArs, "ARS")}
          trend={{ text: "ARS", positive: true }}
          sublabel="Existencias valorizadas"
        />

        <KpiCard
          icon={AlertTriangle}
          iconVariant="steel"
          label="Stock Bajo"
          value={lowStockCount}
          trend={{ text: "Atención", positive: false }}
          sublabel="1 a 3 unidades restantes"
        />

        <KpiCard
          icon={Tag}
          iconVariant="dark"
          label="Sin Stock"
          value={outOfStockCount}
          trend={{ text: "Agotados", positive: false }}
          sublabel="0 unidades disponibles"
        />
      </div>

      {/* Main Table */}
      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Catálogo Oficial ERP</h2>
            <p className="flow-card__subtitle">
              Soporte nativo para fundas con variantes, códigos de barra y stock por combinación
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              className="pag-btn"
              onClick={fetchProducts}
              disabled={loading}
              title="Recargar catálogo"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>

            <div className="flow-search-pill" style={{ width: "260px" }}>
              <Search size={15} />
              <input
                type="text"
                placeholder="Buscar por código o nombre..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus size={16} />
              Nuevo Producto
            </button>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="horizontal-scroll-pills" style={{ marginBottom: "16px" }}>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`flow-select-pill ${selectedCategory === cat ? "active" : ""}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat === "all" ? "Todas las Categorías" : cat}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)" }}>
            <Loader2 size={32} className="animate-spin" style={{ margin: "0 auto 12px", color: "var(--brand-primary)" }} />
            <p style={{ margin: 0, fontWeight: 600 }}>Cargando catálogo ERP…</p>
          </div>
        ) : error ? (
          <StatePanel type="error" title="Error al cargar productos" message={error} />
        ) : filteredItems.length === 0 ? (
          <StatePanel
            type="empty"
            title="No se encontraron productos"
            message={search ? "Probá con otro término de búsqueda." : "Hacé click en 'Nuevo Producto' para registrar un artículo con variantes."}
          />
        ) : (
          <div className="flow-table-wrapper">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Artículo / Modelo</th>
                  <th>Variantes & Stock</th>
                  <th>Categoría</th>
                  <th>Precio Venta</th>
                  <th>Stock Total</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const variants = item.product_variants || [];
                  const balances = item.stock_balances || [];
                  const totalStock = balances.reduce((acc, b) => acc + (b.quantity_on_hand || 0), 0);

                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="type-badge blue" style={{ fontFamily: "monospace", fontSize: "11px" }}>
                          {item.internal_code}
                        </span>
                      </td>
                      <td>
                        <div>
                          <strong style={{ fontSize: "13px", color: "var(--text-main)", display: "block" }}>
                            {item.internal_name}
                          </strong>
                          {item.brands?.name && (
                            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                              {item.brands.name} {item.product_models?.name ? `• ${item.product_models.name}` : ""}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        {variants.length > 0 ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                            {variants.map((v) => {
                              const varBal = balances.find((b) => b.variant_id === v.id);
                              const vStock = varBal ? varBal.quantity_on_hand : 0;
                              const barcode = v.product_identifiers?.find((pi) => pi.kind === "barcode")?.value;

                              return (
                                <span
                                  key={v.id}
                                  className="module-state-badge"
                                  style={{
                                    fontSize: "11px",
                                    padding: "2px 6px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                  }}
                                  title={barcode ? `Código de barras: ${barcode}` : undefined}
                                >
                                  <strong>{v.name}</strong>
                                  <span style={{ opacity: 0.75 }}>({vStock} u.)</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Estándar (sin variantes)</span>
                        )}
                      </td>
                      <td>
                        <span className="module-state-badge nowrap" style={{ padding: "2px 8px", whiteSpace: "nowrap" }}>
                          {item.product_categories?.name || "General"}
                        </span>
                      </td>
                      <td>
                        <strong style={{ color: "var(--brand-primary)", fontSize: "13px" }}>
                          {formatCurrency(item.base_sale_price, "ARS")}
                        </strong>
                      </td>
                      <td>
                        <strong
                          style={{
                            fontSize: "13px",
                            color:
                              totalStock > 3
                                ? "var(--emerald-success)"
                                : totalStock > 0
                                  ? "var(--amber-accent)"
                                  : "var(--rose-accent)",
                          }}
                        >
                          {totalStock} u.
                        </strong>
                      </td>
                      <td>
                        {item.is_active === false ? (
                          <span
                            className="flow-status-pill pending"
                            style={{
                              background: "var(--rose-soft)",
                              color: "var(--rose-accent)",
                              borderColor: "var(--rose-border)",
                            }}
                          >
                            Pausado
                          </span>
                        ) : totalStock > 0 ? (
                          <span className="flow-status-pill completed">Disponible</span>
                        ) : (
                          <span className="flow-status-pill pending">Agotado</span>
                        )}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="pag-btn"
                          style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                          onClick={() => openEditModal(item)}
                        >
                          <Edit2 size={12} /> Editar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Server-Side Pagination (Finding 8) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "16px",
            paddingTop: "12px",
            borderTop: "1px solid var(--border-line)",
          }}
        >
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Mostrando {filteredItems.length} de {totalCount} productos (Página {page + 1} de {totalPages})
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="pag-btn"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <button
              type="button"
              className="pag-btn"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Create Product with Variants */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Nuevo Producto o Funda con Variantes"
        subtitle="Registra el artículo en el catálogo maestro ERP con sus variantes y códigos"
        icon={Plus}
        maxWidth="620px"
      >
        <form onSubmit={handleCreateProduct} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Código Interno *</label>
              <input
                type="text"
                required
                placeholder="FUNDA-IP13"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                className="erp-form-input"
                style={{ fontFamily: "monospace" }}
              />
            </div>

            <div className="erp-form-group">
              <label className="erp-form-label">Nombre del Artículo *</label>
              <input
                type="text"
                required
                placeholder="Ej: Funda Silicona iPhone 13 Pro"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Precio Base de Venta ($ ARS)</label>
            <input
              type="number"
              min="0"
              placeholder="Ej: 7500"
              value={newPriceArs}
              onChange={(e) => setNewPriceArs(e.target.value)}
              className="erp-form-input"
            />
          </div>

          {/* Toggle Variants */}
          <div
            style={{
              padding: "12px",
              background: "var(--bg-card-subtle)",
              borderRadius: "8px",
              border: "1px solid var(--border-line)",
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 650, fontSize: "13px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hasVariants}
                onChange={(e) => setHasVariants(e.target.checked)}
              />
              <Layers size={16} /> Este artículo tiene variantes (ej: Colores de fundas)
            </label>

            {hasVariants && (
              <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Define cada variante con su color, código corto y código de barras único para escaneo:
                </span>

                {variantsList.map((row, idx) => (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 90px 140px 32px", gap: "8px", alignItems: "center" }}>
                    <input
                      type="text"
                      placeholder="Color / Nombre (ej: Negro)"
                      value={row.name}
                      onChange={(e) => updateVariantRow(idx, "name", e.target.value)}
                      className="erp-form-input"
                      style={{ fontSize: "12px" }}
                      required={hasVariants}
                    />
                    <input
                      type="text"
                      placeholder="Código (NEG)"
                      value={row.code}
                      onChange={(e) => updateVariantRow(idx, "code", e.target.value)}
                      className="erp-form-input"
                      style={{ fontSize: "12px", fontFamily: "monospace" }}
                      required={hasVariants}
                    />
                    <input
                      type="text"
                      placeholder="Código de barras"
                      value={row.barcode}
                      onChange={(e) => updateVariantRow(idx, "barcode", e.target.value)}
                      className="erp-form-input"
                      style={{ fontSize: "12px", fontFamily: "monospace" }}
                    />
                    <button
                      type="button"
                      className="pag-btn"
                      onClick={() => removeVariantRow(idx)}
                      disabled={variantsList.length <= 1}
                      style={{ padding: "6px" }}
                      title="Eliminar variante"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  className="pag-btn"
                  onClick={addVariantRow}
                  style={{ alignSelf: "flex-start", marginTop: "4px", fontSize: "12px" }}
                >
                  <Plus size={12} /> Agregar Variante
                </button>
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsCreateOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? "Guardando…" : "Crear Artículo"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Edit Product (Finding 2 - Updates price without touching stock or variants) */}
      {editingProduct && (
        <Modal
          isOpen={Boolean(editingProduct)}
          onClose={() => setEditingProduct(null)}
          title={`Editar: ${editingProduct.internal_name}`}
          subtitle="Modifica el precio y la disponibilidad sin alterar las variantes ni el stock"
          icon={Edit2}
          maxWidth="500px"
        >
          <form onSubmit={handleUpdateProduct} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Nombre del Artículo *</label>
              <input
                type="text"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="erp-form-input"
              />
            </div>

            <div className="erp-form-group">
              <label className="erp-form-label">Precio Base de Venta ($ ARS)</label>
              <input
                type="number"
                min="0"
                value={editPriceArs}
                onChange={(e) => setEditPriceArs(e.target.value)}
                className="erp-form-input"
              />
            </div>

            <div className="erp-form-group">
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 650, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                />
                Artículo Activo y Disponible para la Venta
              </label>
            </div>

            {/* Notification of Stock Safety */}
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-muted)",
                background: "var(--bg-card-subtle)",
                padding: "8px 12px",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Barcode size={14} />
              <span>Las existencias y códigos de variantes se conservan intactos en el ledger de stock.</span>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
              <button type="button" className="pag-btn" onClick={() => setEditingProduct(null)}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? "Actualizando…" : "Guardar Cambios"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
