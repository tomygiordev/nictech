import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Boxes,
  Search,
  Plus,
  Tag,
  AlertTriangle,
  DollarSign,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ArrowDownRight,
  FileText,
} from "lucide-react";
import {
  WorkspaceHeader,
  WorkspaceModuleTabs,
  StatePanel,
  FeedbackAlert,
  KpiCard,
} from "../../components/erp/WorkspaceUi";
import { type ErpModuleId } from "@nictech/domain";
import { formatCurrency, formatCurrencyCompact } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";
import {
  type DbCatalogProduct,
  type MasterCategory,
  type MasterBrand,
  type MasterModel,
  type MasterLocation,
  calculateStockSummary,
  getActiveBarcode,
  getErrorMessage,
} from "./schemas";
import { CatalogSheetModal } from "./CatalogSheetModal";
import { StockIntakeModal } from "./StockIntakeModal";

export interface CatalogWorkspaceProps {
  activeModuleId?: "catalog" | "pricing";
  onSelectModule?: (id: ErpModuleId) => void;
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
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [legacyDatabase, setLegacyDatabase] = useState(false);

  // Master reference data
  const [categories, setCategories] = useState<MasterCategory[]>([]);
  const [brands, setBrands] = useState<MasterBrand[]>([]);
  const [models, setModels] = useState<MasterModel[]>([]);
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  const [masterError, setMasterError] = useState<string | null>(null);
  const [loadingMasters, setLoadingMasters] = useState<boolean>(false);

  // Modals & Feedback
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<DbCatalogProduct | null>(null);
  const [stockIntakeTarget, setStockIntakeTarget] = useState<{
    product: DbCatalogProduct;
    variantId?: string | null;
  } | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Fetch master tables with explicit error handling and retry support
  const fetchMasterData = useCallback(async () => {
    try {
      setLoadingMasters(true);
      setMasterError(null);
      const [catRes, brandRes, modRes, locRes] = await Promise.all([
        supabase.from("product_categories").select("id, code, name").eq("is_active", true).order("name"),
        supabase.from("brands").select("id, code, name").eq("is_active", true).order("name"),
        supabase.from("product_models").select("id, brand_id, code, name").eq("is_active", true).order("name"),
        supabase.from("locations").select("id, branch_id, code, name, allows_sale, is_active").eq("is_active", true).order("name"),
      ]);

      const anyError = catRes.error || brandRes.error || modRes.error || locRes.error;
      if (anyError) {
        setMasterError(getErrorMessage(anyError, "Error al cargar datos maestros del catálogo"));
        return;
      }

      if (catRes.data) setCategories(catRes.data);
      if (brandRes.data) setBrands(brandRes.data);
      if (modRes.data) setModels(modRes.data);
      if (locRes.data) setLocations(locRes.data);
    } catch (err: unknown) {
      setMasterError(getErrorMessage(err, "Error al cargar maestros del catálogo ERP"));
    } finally {
      setLoadingMasters(false);
    }
  }, []);

  useEffect(() => {
    fetchMasterData();
  }, [fetchMasterData]);

  // Fetch products query with server-side category filtering, search, and exact count
  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const loadProducts = async (legacy: boolean) => {
        const sheetFields = legacy ? "" : "sheet_template, web_status, tags, condition, capacity, media_initialized, sheet_fields_initialized,";
        const variantFields = legacy ? "" : "color_id, final_price_ars,";
        let query = supabase.from("products").select<string, DbCatalogProduct>(
          `id, internal_code, internal_name, public_name, public_description, internal_description, base_sale_price,
          ${sheetFields}
          tax_rate_percent, is_active, item_kind, inventory_tracking, created_at, updated_at,
          category_id, brand_id, model_id,
          product_categories:product_categories!products_category_id_fkey(name),
          brands:brands!products_brand_id_fkey(name),
          product_models:product_models!products_model_id_fkey(name),
          product_variants(id, code, name, ${variantFields} price_delta, is_active, product_identifiers(id, kind, value, is_primary, is_active)),
          stock_balances(quantity_on_hand, quantity_reserved, variant_id, location_id)`,
          { count: "exact" },
        );
        if (!showInactive) query = query.eq("is_active", true);
        if (selectedCategoryId !== "all") query = query.eq("category_id", selectedCategoryId);
        if (search.trim()) {
          const term = search.trim().replace(/[,()]/g, "");
          if (term) query = query.or(`internal_name.ilike.%${term}%,internal_code.ilike.%${term}%`);
        }
        return query.order("created_at", { ascending: false })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      };

      let result = await loadProducts(false);
      const code = result.error?.code ?? "";
      const missingSchema = /^(PGRST202|42703|42883)$/.test(code)
        || /schema cache|column .* does not exist/i.test(result.error?.message ?? "");
      setLegacyDatabase(missingSchema);
      if (missingSchema) result = await loadProducts(true);
      const { data, error: dbErr, count } = result;
      if (dbErr) throw dbErr;
      setProducts(data ?? []);
      setTotalCount(count ?? 0);
    } catch (err: unknown) {
      const msg = getErrorMessage(err, "Error al cargar catálogo ERP");
      setError(/schema cache|does not exist|column .* does not exist/i.test(msg) ? "La base no tiene las migraciones de la ficha de catálogo. Aplicalas primero en un entorno autorizado." : msg);
    } finally {
      setLoading(false);
    }
  }, [page, search, selectedCategoryId, showInactive]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Server-master based pills
  const categoryPills = useMemo(() => {
    return [
      { id: "all", name: "Todas las Categorías" },
      ...categories.map((c) => ({ id: c.id, name: c.name })),
    ];
  }, [categories]);

  // Accurate Inventory Metrics using (onHand - reserved)
  const totalValueArs = useMemo(() => {
    return products.reduce((acc, p) => {
      const summary = calculateStockSummary(p.stock_balances);
      return acc + (p.base_sale_price || 0) * summary.available;
    }, 0);
  }, [products]);

  const lowStockCount = useMemo(() => {
    return products.filter((p) => {
      const summary = calculateStockSummary(p.stock_balances);
      return summary.available > 0 && summary.available <= 3;
    }).length;
  }, [products]);

  const outOfStockCount = useMemo(() => {
    return products.filter((p) => {
      const summary = calculateStockSummary(p.stock_balances);
      return summary.available === 0;
    }).length;
  }, [products]);

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

      {legacyDatabase && <FeedbackAlert type="error" message="La ficha nueva requiere actualizar la base. El listado sigue disponible." onClose={() => setLegacyDatabase(false)} />}

      {masterError && (
        <FeedbackAlert
          type="error"
          message={masterError}
          action={
            <button
              type="button"
              className="pag-btn"
              onClick={fetchMasterData}
              disabled={loadingMasters}
              style={{ background: "#ffffff", padding: "4px 8px", fontSize: "12px" }}
            >
              <RefreshCw size={12} className={loadingMasters ? "animate-spin" : ""} /> Reintentar Maestros
            </button>
          }
          onClose={() => setMasterError(null)}
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
          sublabel="Productos y fundas"
        />

        <KpiCard
          icon={DollarSign}
          iconVariant="navy"
          label="Valorización de Stock"
          value={formatCurrencyCompact(totalValueArs, "ARS")}
          trend={{ text: "ARS Final", positive: true }}
          sublabel="Existencias disponibles"
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
              Soporte nativo para fundas con variantes, códigos de barra y stock formal por combinación
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

        <label><input type="checkbox" checked={showInactive} onChange={(e) => { setShowInactive(e.target.checked); setPage(0); }} /> Ver inactivos</label>

        {/* Filter Pills */}
        <div className="horizontal-scroll-pills" style={{ marginBottom: "16px" }}>
          {categoryPills.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`flow-select-pill ${selectedCategoryId === cat.id ? "active" : ""}`}
              onClick={() => {
                setSelectedCategoryId(cat.id);
                setPage(0);
              }}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Table View */}
        {loading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)" }}>
            <Loader2 size={32} className="animate-spin" style={{ margin: "0 auto 12px", color: "var(--brand-primary)" }} />
            <p style={{ margin: 0, fontWeight: 600 }}>Cargando catálogo ERP…</p>
          </div>
        ) : error ? (
          <StatePanel type="error" title="Error al cargar productos" message={error} />
        ) : products.length === 0 ? (
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
                  <th>Variantes & Stock Disp.</th>
                  <th>Categoría</th>
                  <th>Precio Venta (Final)</th>
                  <th>Stock Disp. Total</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {products.map((item) => {
                  const variants = item.product_variants || [];
                  const totalSummary = calculateStockSummary(item.stock_balances);

                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="type-badge blue" style={{ fontFamily: "monospace", fontSize: "11px" }}>
                          {item.internal_code}
                        </span>
                      </td>
                      <td>
                        <div>
                          <button type="button"
                            style={{
                              fontSize: "13px",
                              color: "var(--text-main)",
                              display: "block",
                              cursor: "pointer",
                            }}
                            onClick={() => setEditingProduct(item)}
                            title="Abrir ficha"
                          >
                            {item.internal_name}
                          </button>
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
                              const vSummary = calculateStockSummary(item.stock_balances, v.id);
                              const barcode = getActiveBarcode(v.product_identifiers);

                              return (
                                <button type="button"
                                  key={v.id}
                                  className="module-state-badge"
                                  style={{
                                    fontSize: "11px",
                                    padding: "2px 6px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    cursor: "pointer",
                                  }}
                                  title={barcode ? `Código de barras: ${barcode}` : undefined}
                                  onClick={() => {
                                    setStockIntakeTarget({ product: item, variantId: v.id });
                                  }}
                                >
                                  <strong>{v.name}</strong>
                                  <span style={{ opacity: 0.75 }}>({vSummary.available} u.)</span>
                                  {vSummary.reserved > 0 && (
                                    <span style={{ color: "var(--amber-accent)", fontSize: "9px" }}>
                                      [{vSummary.reserved}r]
                                    </span>
                                  )}
                                </button>
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
                        <span style={{ fontSize: "10px", color: "var(--text-muted)", display: "block" }}>
                          IVA {typeof item.tax_rate_percent === "number" ? item.tax_rate_percent : 21}% inc.
                        </span>
                      </td>
                      <td>
                        <strong
                          style={{
                            fontSize: "13px",
                            color:
                              totalSummary.available > 3
                                ? "var(--emerald-success)"
                                : totalSummary.available > 0
                                  ? "var(--amber-accent)"
                                  : "var(--rose-accent)",
                          }}
                        >
                          {totalSummary.available} u.
                        </strong>
                        {totalSummary.reserved > 0 && (
                          <span style={{ fontSize: "10px", color: "var(--amber-accent)", display: "block" }}>
                            ({totalSummary.reserved} res.)
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="flow-status-pill pending">{item.web_status === "published" ? "Publicado" : item.web_status === "paused" ? "Pausado" : item.web_status === "draft" ? "Borrador" : "Estado web no disponible"}{!item.is_active ? " · Inactivo" : ""}</span>
                      </td>
                      <td className="text-right">
                        <div style={{ display: "inline-flex", gap: "6px" }}>
                          <button
                            type="button"
                            className="pag-btn"
                            style={{ padding: "4px 8px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                            onClick={() => setEditingProduct(item)}
                            title="Abrir ficha"
                          >
                            <FileText size={11} /> Ficha
                          </button>
                          <button
                            type="button"
                            className="pag-btn"
                            style={{ padding: "4px 8px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                            onClick={() => {
                              setStockIntakeTarget({ product: item });
                            }}
                            title="Cargar stock"
                          >
                            <ArrowDownRight size={11} /> Stock
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Server-Side Pagination */}
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
            Mostrando {products.length} de {totalCount} productos (Página {page + 1} de {totalPages})
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

      {(isCreateOpen || editingProduct) && (
        <CatalogSheetModal isOpen onClose={() => { setIsCreateOpen(false); setEditingProduct(null); }}
          product={editingProduct} categories={categories} brands={brands} models={models} locations={locations}
          onSuccess={(message) => { setFeedback({ type: "success", message }); void fetchProducts(); }} />
      )}

      {/* Modal: Dedicated Formal Stock Intake */}
      {stockIntakeTarget && (
        <StockIntakeModal
          isOpen={Boolean(stockIntakeTarget)}
          onClose={() => setStockIntakeTarget(null)}
          product={stockIntakeTarget.product}
          initialVariantId={stockIntakeTarget.variantId}
          locations={locations}
          onSuccess={(msg) => {
            setFeedback({ type: "success", message: msg });
            fetchProducts();
          }}
        />
      )}
    </div>
  );
};
