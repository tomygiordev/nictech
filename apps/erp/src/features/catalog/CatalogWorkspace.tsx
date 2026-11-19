import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Boxes,
  Search,
  Plus,
  Tag,
  AlertTriangle,
  DollarSign,
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
  StatusPill,
  FeedbackAlert,
  KpiCard,
} from "../../components/erp/WorkspaceUi";
import { type ErpModuleId } from "@nictech/domain";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { toUserMessage } from "../../lib/errors";
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
} from "./schemas";
import { getCatalogKpis, type CatalogFilters, type CatalogKpis } from "./catalogKpisApi";
import { CatalogSheetModal } from "./CatalogSheetModal";
import { StockIntakeModal } from "./StockIntakeModal";

export interface CatalogWorkspaceProps {
  activeModuleId?: "catalog" | "pricing";
  onSelectModule?: (id: ErpModuleId) => void;
}

const PAGE_SIZE = 25;
const SCHEMA_UNAVAILABLE = "No se pudo cargar el catálogo. Avisá al administrador del sistema.";
const CATALOG_LOAD_ERROR = "No se pudo cargar el catálogo. Reintentá.";
const MASTER_LOAD_ERROR = "No se pudieron cargar las categorías, marcas, modelos o ubicaciones.";
const WEB_STATUS = {
  published: { label: "Publicado", className: "completed" },
  paused: { label: "Pausado", className: "processing" },
  draft: { label: "Borrador", className: "neutral" },
} as const;

function isCatalogSchemaMissing(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return /^(PGRST202|PGRST204|42703|42883)$/.test(code)
    || /schema cache|column .* does not exist/i.test(message);
}

export const CatalogWorkspace: React.FC<CatalogWorkspaceProps> = ({
  activeModuleId = "catalog",
  onSelectModule,
}) => {
  const { hasPermission } = useErpAuth();
  const canManage = hasPermission("catalog.manage");
  const canLoadStock = hasPermission("stock.move") && hasPermission("stock.adjust");
  const hasActions = canManage || canLoadStock;
  const [products, setProducts] = useState<DbCatalogProduct[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [legacyDatabase, setLegacyDatabase] = useState(false);
  const [kpis, setKpis] = useState<CatalogKpis | null>(null);
  const [kpisError, setKpisError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const searchText = debouncedSearch.trim().replace(/[,()]/g, "").trim() || undefined;
  const filters = useMemo<CatalogFilters>(() => ({
    search_text: searchText,
    target_category_id: selectedCategoryId === "all" ? undefined : selectedCategoryId,
    include_inactive: showInactive,
  }), [searchText, selectedCategoryId, showInactive]);
  const hasFilters = Boolean(search || filters.target_category_id || filters.include_inactive);

  const refreshCatalog = () => setRefreshVersion((version) => version + 1);
  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setSelectedCategoryId("all");
    setShowInactive(false);
    setPage(0);
  };

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
        setMasterError(toUserMessage(anyError, MASTER_LOAD_ERROR));
        return;
      }

      if (catRes.data) setCategories(catRes.data);
      if (brandRes.data) setBrands(brandRes.data);
      if (modRes.data) setModels(modRes.data);
      if (locRes.data) setLocations(locRes.data);
    } catch (err: unknown) {
      setMasterError(toUserMessage(err, MASTER_LOAD_ERROR));
    } finally {
      setLoadingMasters(false);
    }
  }, []);

  useEffect(() => {
    fetchMasterData();
  }, [fetchMasterData]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setLegacyDatabase(false);

    const fetchProducts = async () => {
      const loadProducts = (legacy: boolean) => {
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
        if (!filters.include_inactive) query = query.eq("is_active", true);
        if (filters.target_category_id) query = query.eq("category_id", filters.target_category_id);
        if (filters.search_text) {
          const term = filters.search_text;
          query = query.or(`internal_name.ilike.%${term}%,internal_code.ilike.%${term}%`);
        }
        return query.order("created_at", { ascending: false })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      };

      try {
        let result = await loadProducts(false);
        if (!active) return;
        const missingSheet = isCatalogSchemaMissing(result.error);
        if (missingSheet) result = await loadProducts(true);
        if (!active) return;
        if (result.error) throw result.error;
        setLegacyDatabase(missingSheet);
        setProducts(result.data ?? []);
        setTotalCount(result.count ?? 0);
      } catch (err: unknown) {
        if (!active) return;
        setProducts([]);
        setTotalCount(0);
        setError(isCatalogSchemaMissing(err) ? SCHEMA_UNAVAILABLE : toUserMessage(err, CATALOG_LOAD_ERROR));
      } finally {
        if (active) setLoading(false);
      }
    };

    void fetchProducts();
    return () => { active = false; };
  }, [filters, page, refreshVersion]);

  useEffect(() => {
    let active = true;
    setKpis(null);
    setKpisError(null);
    void getCatalogKpis(filters).then(
      (result) => { if (active) setKpis(result); },
      (err: unknown) => {
        if (!active) return;
        const fallback = isCatalogSchemaMissing(err) ? SCHEMA_UNAVAILABLE
          : "No se pudieron cargar los indicadores del catálogo. Reintentá.";
        setKpisError(toUserMessage(err, fallback));
      },
    );
    return () => { active = false; };
  }, [filters, refreshVersion]);

  // Server-master based pills
  const categoryPills = useMemo(() => {
    return [
      { id: "all", name: "Todas las Categorías" },
      ...categories.map((c) => ({ id: c.id, name: c.name })),
    ];
  }, [categories]);

  const sellableLocationIds = useMemo(
    () => new Set(locations.filter((l) => l.is_active && l.allows_sale).map((l) => l.id)),
    [locations],
  );

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
        badge={loading ? undefined : `${totalCount} artículos`}
        badgeTone="neutral"
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

      {legacyDatabase && (
        <FeedbackAlert type="error" message={SCHEMA_UNAVAILABLE} submessage="El listado básico sigue disponible." />
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
              <RefreshCw size={12} className={loadingMasters ? "animate-spin" : ""} /> Reintentar carga de filtros
            </button>
          }
          onClose={() => setMasterError(null)}
        />
      )}

      {kpisError && kpisError !== error && !(legacyDatabase && kpisError === SCHEMA_UNAVAILABLE) && (
        <FeedbackAlert type="error" message={kpisError} />
      )}
      <div className="kpi-grid">
        <KpiCard
          icon={Boxes}
          iconVariant="green"
          label="Total Artículos"
          value={kpis?.total_products ?? (loading || error ? "—" : totalCount)}
          trend={{ text: "Catálogo ERP", positive: true }}
          sublabel="Productos y fundas"
        />

        <KpiCard
          icon={DollarSign}
          iconVariant="navy"
          label="Stock vendible a precio de venta"
          value={kpis ? formatCurrencyCompact(kpis.stock_value_ars, "ARS") : "—"}
          sublabel="Ubicaciones habilitadas para venta"
        />

        <KpiCard
          icon={AlertTriangle}
          iconVariant="steel"
          label="Stock Bajo"
          value={kpis?.low_stock_count ?? "—"}
          trend={{ text: "Atención", positive: false }}
          sublabel="1 a 3 unidades restantes"
        />

        <KpiCard
          icon={Tag}
          iconVariant="dark"
          label="Sin Stock"
          value={kpis?.out_of_stock_count ?? "—"}
          trend={{ text: "Agotados", positive: false }}
          sublabel="0 unidades disponibles"
        />
      </div>

      {/* Main Table */}
      <div className="flow-card">
        <div className="flow-card__header">
          <div>
            <h2 className="flow-card__title">Catálogo Oficial ERP</h2>
            <p className="flow-card__subtitle">
              Soporte nativo para fundas con variantes, códigos de barra y stock formal por combinación
            </p>
          </div>

          <div className="flow-card__tools">
            <button
              type="button"
              className="pag-btn"
              onClick={refreshCatalog}
              disabled={loading}
              title="Recargar catálogo"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>

            <div className="flow-search-pill">
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

            {canManage && (
              <button type="button" className="btn-primary" onClick={() => setIsCreateOpen(true)}>
                <Plus size={16} /> Nuevo Producto
              </button>
            )}
          </div>
        </div>

        <label className="filter-check" style={{ marginBottom: "10px" }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => { setShowInactive(e.target.checked); setPage(0); }} />
          Ver inactivos
        </label>

        {/* Filter Pills */}
        <div className="horizontal-scroll-pills" style={{ marginBottom: "16px" }}>
          {categoryPills.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`flow-select-pill ${selectedCategoryId === cat.id ? "active" : ""}`}
              aria-pressed={selectedCategoryId === cat.id}
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
          <StatePanel type="loading" message="Cargando catálogo ERP…" />
        ) : error ? (
          <StatePanel type="error" title="Error al cargar productos" message={error} />
        ) : products.length === 0 ? (
          <StatePanel
            type="empty"
            title="No se encontraron productos"
            message={hasFilters
              ? "No hay productos en esta categoría o búsqueda."
              : canManage
                ? "Seleccioná Nuevo Producto para registrar el primer artículo."
                : "Todavía no hay productos en el catálogo."}
            action={hasFilters && <button type="button" className="pag-btn" onClick={clearFilters}>Limpiar filtros</button>}
          />
        ) : (
          <div className="flow-table-wrapper" role="region" aria-label="Listado de productos" tabIndex={0}>
            <table className={`flow-table flow-table--catalog${hasActions ? " flow-table--actions" : ""}`}>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Artículo / Modelo</th>
                  <th>Variantes y stock</th>
                  <th>Categoría</th>
                  <th className="num">Precio final</th>
                  <th className="num">Stock vendible</th>
                  <th>Estado</th>
                  {hasActions && <th className="catalog-actions">Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {products.map((item) => {
                  const variants = item.product_variants || [];
                  const sellableBalances = item.stock_balances?.filter(
                    (b) => (b.location_id ? sellableLocationIds.has(b.location_id) : false),
                  );
                  const totalSummary = calculateStockSummary(sellableBalances);
                  const webStatus = item.web_status && WEB_STATUS[item.web_status];

                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="type-badge blue catalog-code" style={{ fontFamily: "monospace", fontSize: "11px" }}>
                          {item.internal_code}
                        </span>
                      </td>
                      <td>
                        <div>
                          {canManage ? (
                            <button type="button" className="flow-link-btn" onClick={() => setEditingProduct(item)} title="Abrir ficha">
                              {item.internal_name}
                            </button>
                          ) : <strong>{item.internal_name}</strong>}
                          {item.brands?.name && (
                            <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>
                              {item.brands.name} {item.product_models?.name ? `• ${item.product_models.name}` : ""}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        {variants.length > 0 ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                            {variants.map((v) => {
                              const vSummary = calculateStockSummary(sellableBalances, v.id);
                              const barcode = getActiveBarcode(v.product_identifiers);
                              const VariantControl = canLoadStock ? "button" : "span";

                              return (
                                <VariantControl
                                  key={v.id}
                                  className="module-state-badge"
                                  style={{
                                    fontSize: "11px",
                                    padding: "2px 6px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    cursor: canLoadStock ? "pointer" : undefined,
                                  }}
                                  title={barcode ? `Código de barras: ${barcode}` : undefined}
                                  {...(canLoadStock ? {
                                    type: "button" as const,
                                    onClick: () => setStockIntakeTarget({ product: item, variantId: v.id }),
                                  } : {})}
                                >
                                  <strong>{v.name}</strong>
                                  <span style={{ opacity: 0.75 }}>({vSummary.available} u.)</span>
                                  {vSummary.reserved > 0 && (
                                    <span style={{ color: "var(--amber-accent)", fontSize: "9px" }}>
                                      [{vSummary.reserved}r]
                                    </span>
                                  )}
                                </VariantControl>
                              );
                            })}
                          </div>
                        ) : (
                          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Estándar (sin variantes)</span>
                        )}
                      </td>
                      <td>
                        <span className="module-state-badge catalog-category">
                          {item.product_categories?.name || "General"}
                        </span>
                      </td>
                      <td className="num">
                        <span className="amount-val">
                          {formatCurrency(item.base_sale_price, "ARS")}
                        </span>
                        <span style={{ fontSize: "10px", color: "var(--text-muted)", display: "block" }}>
                          IVA {typeof item.tax_rate_percent === "number" ? item.tax_rate_percent : 21}% inc.
                        </span>
                      </td>
                      <td className="num">
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
                        {!item.is_active ? <StatusPill variant="slate">Inactivo</StatusPill>
                          : webStatus ? <span className={`flow-status-pill ${webStatus.className}`}>{webStatus.label}</span>
                          : <StatusPill variant="slate">Sin estado web</StatusPill>}
                      </td>
                      {hasActions && (
                        <td className="catalog-actions">
                          <div className="catalog-row-actions">
                            {canManage && (
                              <button type="button" className="pag-btn" onClick={() => setEditingProduct(item)} title="Abrir ficha">
                                <FileText size={11} /> Ficha
                              </button>
                            )}
                            {canLoadStock && (
                              <button
                                type="button"
                                className="pag-btn"
                                onClick={() => setStockIntakeTarget({ product: item })}
                                title="Cargar stock"
                                aria-label="Cargar stock"
                              >
                                <ArrowDownRight size={11} /> Stock
                              </button>
                            )}
                          </div>
                        </td>
                      )}
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
            flexWrap: "wrap",
            gap: "8px",
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

      {canManage && (isCreateOpen || editingProduct) && (
        <CatalogSheetModal isOpen onClose={() => { setIsCreateOpen(false); setEditingProduct(null); }}
          product={editingProduct} categories={categories} brands={brands} models={models} locations={locations}
          onSuccess={(message) => { setFeedback({ type: "success", message }); refreshCatalog(); }} />
      )}

      {/* Modal: Dedicated Formal Stock Intake */}
      {canLoadStock && stockIntakeTarget && (
        <StockIntakeModal
          isOpen={Boolean(stockIntakeTarget)}
          onClose={() => setStockIntakeTarget(null)}
          product={stockIntakeTarget.product}
          initialVariantId={stockIntakeTarget.variantId}
          locations={locations}
          onSuccess={(msg) => {
            setFeedback({ type: "success", message: msg });
            refreshCatalog();
          }}
        />
      )}
    </div>
  );
};
