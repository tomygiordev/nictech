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
  Edit2,
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
import { CreateProductModal } from "./CreateProductModal";
import { ProductEditModal } from "./ProductEditModal";
import { StockIntakeModal } from "./StockIntakeModal";
import { ProductDetailModal } from "./ProductDetailModal";
import { ProductCompatibilityModal } from "./ProductCompatibilityModal";
import { ProductVariantsModal } from "./ProductVariantsModal";

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

  // Master reference data
  const [categories, setCategories] = useState<MasterCategory[]>([]);
  const [brands, setBrands] = useState<MasterBrand[]>([]);
  const [models, setModels] = useState<MasterModel[]>([]);
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  const [masterError, setMasterError] = useState<string | null>(null);
  const [loadingMasters, setLoadingMasters] = useState<boolean>(false);

  // Modals & Feedback
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [detailProduct, setDetailProduct] = useState<DbCatalogProduct | null>(null);
  const [editingProduct, setEditingProduct] = useState<DbCatalogProduct | null>(null);
  const [compatibilityProduct, setCompatibilityProduct] = useState<DbCatalogProduct | null>(null);
  const [variantsProduct, setVariantsProduct] = useState<DbCatalogProduct | null>(null);
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

      let query = supabase
        .from("products")
        .select(
          `
          id, internal_code, internal_name, public_name, base_sale_price,
          tax_rate_percent, is_active, item_kind, inventory_tracking, created_at, updated_at,
          category_id, brand_id, model_id,
          product_categories:product_categories!products_category_id_fkey(name),
          brands:brands!products_brand_id_fkey(name),
          product_models:product_models!products_model_id_fkey(name),
          product_variants(id, code, name, price_delta, final_price_ars, is_active, product_identifiers(id, kind, value, is_primary, is_active)),
          stock_balances(quantity_on_hand, quantity_reserved, variant_id, location_id)
        `,
          { count: "exact" },
        );

      // Server-side category filter before count and range
      if (selectedCategoryId !== "all") {
        query = query.eq("category_id", selectedCategoryId);
      }

      if (search.trim()) {
        const term = search.trim();
        query = query.or(`internal_name.ilike.%${term}%,internal_code.ilike.%${term}%`);
      }

      query = query
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const { data, error: dbErr, count } = await query;

      if (dbErr) throw dbErr;
      setProducts((data as DbCatalogProduct[]) ?? []);
      setTotalCount(count ?? 0);
    } catch (err: unknown) {
      const msg = getErrorMessage(err, "Error al cargar catálogo ERP");
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [page, search, selectedCategoryId]);

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
                          <strong
                            style={{
                              fontSize: "13px",
                              color: "var(--text-main)",
                              display: "block",
                              cursor: "pointer",
                            }}
                            onClick={() => setDetailProduct(item)}
                            title="Ver ficha compacta"
                          >
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
                              const vSummary = calculateStockSummary(item.stock_balances, v.id);
                              const barcode = getActiveBarcode(v.product_identifiers);

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
                                    cursor: "pointer",
                                  }}
                                  title={barcode ? `Código de barras: ${barcode}` : undefined}
                                  onClick={() => {
                                    setDetailProduct(null);
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
                        ) : totalSummary.available > 0 ? (
                          <span className="flow-status-pill completed">Disponible</span>
                        ) : (
                          <span className="flow-status-pill pending">Agotado</span>
                        )}
                      </td>
                      <td className="text-right">
                        <div style={{ display: "inline-flex", gap: "6px" }}>
                          <button
                            type="button"
                            className="pag-btn"
                            style={{ padding: "4px 8px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                            onClick={() => setDetailProduct(item)}
                            title="Ver ficha compacta"
                          >
                            <FileText size={11} /> Ficha
                          </button>
                          <button
                            type="button"
                            className="pag-btn"
                            style={{ padding: "4px 8px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                            onClick={() => {
                              setDetailProduct(null);
                              setStockIntakeTarget({ product: item });
                            }}
                            title="Cargar stock"
                          >
                            <ArrowDownRight size={11} /> Stock
                          </button>
                          <button
                            type="button"
                            className="pag-btn"
                            style={{ padding: "4px 8px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                            onClick={() => {
                              setDetailProduct(null);
                              setEditingProduct(item);
                            }}
                            title="Editar datos"
                          >
                            <Edit2 size={11} /> Editar
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

      {/* Modal: Create Product with Variants */}
      <CreateProductModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        categories={categories}
        brands={brands}
        models={models}
        locations={locations}
        onSuccess={(msg) => {
          setFeedback({ type: "success", message: msg });
          fetchProducts();
        }}
      />

      {/* Modal: Compact Product Ficha */}
      {detailProduct && (
        <ProductDetailModal
          isOpen={Boolean(detailProduct)}
          onClose={() => setDetailProduct(null)}
          product={detailProduct}
          onOpenEdit={() => {
            const current = detailProduct;
            setDetailProduct(null);
            setEditingProduct(current);
          }}
          onOpenStockIntake={(variantId) => {
            const current = detailProduct;
            setDetailProduct(null);
            setStockIntakeTarget({ product: current, variantId });
          }}
          onOpenCompatibility={() => {
            const current = detailProduct;
            setDetailProduct(null);
            setCompatibilityProduct(current);
          }}
          onOpenManageVariants={() => {
            const current = detailProduct;
            setDetailProduct(null);
            setVariantsProduct(current);
          }}
        />
      )}

      {/* Modal: N:M Compatibility Management */}
      {compatibilityProduct && (
        <ProductCompatibilityModal
          isOpen={Boolean(compatibilityProduct)}
          onClose={() => setCompatibilityProduct(null)}
          product={compatibilityProduct}
          brands={brands}
          models={models}
          onSuccess={(msg) => {
            setFeedback({ type: "success", message: msg });
            fetchProducts();
          }}
        />
      )}

      {/* Modal: Product Variants & States Management */}
      {variantsProduct && (
        <ProductVariantsModal
          isOpen={Boolean(variantsProduct)}
          onClose={() => setVariantsProduct(null)}
          product={variantsProduct}
          onSuccess={(msg) => {
            setFeedback({ type: "success", message: msg });
            fetchProducts();
          }}
        />
      )}

      {/* Modal: Edit Product Master Data (Safely Preserves Variants and Stock) */}
      {editingProduct && (
        <ProductEditModal
          isOpen={Boolean(editingProduct)}
          onClose={() => setEditingProduct(null)}
          product={editingProduct}
          categories={categories}
          brands={brands}
          models={models}
          onSuccess={(msg) => {
            setDetailProduct(null);
            setFeedback({ type: "success", message: msg });
            fetchProducts();
          }}
        />
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
            setDetailProduct(null);
            setFeedback({ type: "success", message: msg });
            fetchProducts();
          }}
        />
      )}
    </div>
  );
};
