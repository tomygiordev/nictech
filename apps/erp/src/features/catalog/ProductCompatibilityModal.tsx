import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Check, Search, AlertCircle, RefreshCw, Smartphone, X, Layers } from "lucide-react";
import { Modal } from "../../components/erp/WorkspaceUi";
import { supabase } from "../../lib/supabase";
import {
  type DbCatalogProduct,
  type MasterBrand,
  type MasterModel,
  setProductCompatibleModelsSchema,
  buildSetProductCompatibleModelsPayload,
  getErrorMessage,
} from "./schemas";

export interface ProductCompatibilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: DbCatalogProduct | null;
  brands: MasterBrand[];
  models: MasterModel[];
  onSuccess: (message: string) => void;
}

export const ProductCompatibilityModal: React.FC<ProductCompatibilityModalProps> = ({
  isOpen,
  onClose,
  product,
  brands,
  models,
  onSuccess,
}) => {
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [initialError, setInitialError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");

  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Map of brand IDs to brand names for quick display
  const brandMap = useMemo(() => {
    const map = new Map<string, string>();
    brands.forEach((b) => map.set(b.id, b.name));
    return map;
  }, [brands]);

  // Map of model IDs to model info
  const modelMap = useMemo(() => {
    const map = new Map<string, MasterModel>();
    models.forEach((m) => map.set(m.id, m));
    return map;
  }, [models]);

  const loadCompatibleModels = useCallback(async (productId: string) => {
    try {
      setLoadingInitial(true);
      setInitialError(null);

      const { data, error } = await supabase.rpc("get_product_compatible_models", {
        p_product_id: productId,
      });

      if (error) throw error;

      const loadedIds = (data || []).map((item) => item.model_id);
      setSelectedModelIds(loadedIds);
    } catch (err: unknown) {
      const msg = getErrorMessage(err, "Error al cargar los modelos compatibles desde el servidor");
      setInitialError(msg);
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && product) {
      setSubmitError(null);
      setSearchQuery("");
      setBrandFilter("all");
      loadCompatibleModels(product.id);
    }
  }, [isOpen, product, loadCompatibleModels]);

  // Filter models for selection
  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return models.filter((m) => {
      if (brandFilter !== "all" && m.brand_id !== brandFilter) {
        return false;
      }
      if (!q) return true;
      const brandName = brandMap.get(m.brand_id)?.toLowerCase() || "";
      const modelName = m.name.toLowerCase();
      const modelCode = m.code.toLowerCase();
      return modelName.includes(q) || modelCode.includes(q) || brandName.includes(q);
    });
  }, [models, brandFilter, searchQuery, brandMap]);

  if (!product) return null;

  const handleClose = () => {
    if (submitting || isSubmittingRef.current) return;
    onClose();
  };

  const handleToggleModel = (modelId: string) => {
    if (submitting) return;
    setSelectedModelIds((prev) => {
      if (prev.includes(modelId)) {
        return prev.filter((id) => id !== modelId);
      }
      return [...prev, modelId];
    });
  };

  const handleRemoveModel = (modelId: string) => {
    if (submitting) return;
    setSelectedModelIds((prev) => prev.filter((id) => id !== modelId));
  };

  const handleClearAll = () => {
    if (submitting) return;
    setSelectedModelIds([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || submitting) return;

    setSubmitError(null);

    const validation = setProductCompatibleModelsSchema.safeParse({
      productId: product.id,
      expectedUpdatedAt: product.updated_at || null,
      modelIds: selectedModelIds,
    });

    if (!validation.success) {
      setSubmitError(validation.error.issues[0]?.message ?? "Revisá los modelos seleccionados.");
      return;
    }

    try {
      isSubmittingRef.current = true;
      setSubmitting(true);

      const payload = buildSetProductCompatibleModelsPayload(validation.data);
      const { error: rpcErr } = await supabase.rpc("set_product_compatible_models", payload);

      if (rpcErr) throw rpcErr;

      onSuccess(`Compatibilidad de "${product.internal_name}" guardada con ${validation.data.modelIds.length} modelo(s).`);
      onClose();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, "Error al guardar compatibilidad multi-modelo");
      setSubmitError(msg);
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Compatibilidad Multi-Modelo ERP"
      subtitle={`Asignación N:M para "${product.internal_name}" • Stock y SKU únicos`}
      icon={Smartphone}
      maxWidth="720px"
    >
      <form noValidate onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Master Brand & Model Info Card */}
        <div
          style={{
            padding: "12px 16px",
            background: "var(--surface-subtle)",
            borderRadius: "8px",
            border: "1px solid var(--border-line)",
            fontSize: "12px",
            color: "var(--text-muted)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <div>
              <span style={{ fontWeight: 600, color: "var(--text-main)", display: "block" }}>
                Modelo principal de fabricación:
              </span>
              <span>
                {product.brands?.name || "Sin marca maestra"} • {product.product_models?.name || "Sin modelo maestro"}
              </span>
            </div>
            <span
              className="type-badge blue"
              style={{ fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
            >
              <Layers size={12} /> Stock Físico Unificado
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "11px", opacity: 0.85 }}>
            Los modelos compatibles permiten que un único SKU físico (funda, vidrio templado, módulo, accesorio) sea buscado y localizado para múltiples equipos cruzando diferentes marcas si corresponde.
          </p>
        </div>

        {/* Server Load Error State with Retry */}
        {initialError && (
          <div
            className="state-panel"
            role="alert"
            style={{
              borderColor: "var(--rose-accent)",
              background: "var(--rose-soft)",
              color: "var(--rose-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <AlertCircle size={16} />
              <span style={{ fontSize: "13px" }}>{initialError}</span>
            </div>
            <button
              type="button"
              className="pag-btn"
              onClick={() => loadCompatibleModels(product.id)}
              disabled={loadingInitial}
              style={{ padding: "4px 8px", fontSize: "12px" }}
            >
              <RefreshCw size={12} /> Reintentar
            </button>
          </div>
        )}

        {/* Submission Error Banner */}
        {submitError && (
          <div
            className="state-panel"
            role="alert"
            style={{
              borderColor: "var(--rose-accent)",
              background: "var(--rose-soft)",
              color: "var(--rose-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              padding: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <AlertCircle size={16} />
              <span style={{ fontSize: "13px" }}>{submitError}</span>
            </div>
            {(submitError.toLowerCase().includes("concurren") ||
              submitError.toLowerCase().includes("concurrency") ||
              submitError.toLowerCase().includes("modificado")) && (
              <button
                type="button"
                className="pag-btn"
                onClick={() => {
                  loadCompatibleModels(product.id);
                  setSubmitError(null);
                }}
                disabled={loadingInitial}
                style={{ padding: "4px 8px", fontSize: "12px" }}
              >
                <RefreshCw size={12} /> Recargar del servidor
              </button>
            )}
          </div>
        )}

        {/* Initial Loading Indicator */}
        {loadingInitial ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
            <span style={{ fontSize: "13px" }}>Cargando compatibilidades registradas en el servidor...</span>
          </div>
        ) : (
          <>
            {/* Selected Chips Area */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-main)" }}>
                  Modelos Compatibles Seleccionados ({selectedModelIds.length})
                </span>
                {selectedModelIds.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    disabled={submitting}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--rose-accent)",
                      fontSize: "11px",
                      cursor: "pointer",
                      padding: "2px 6px",
                    }}
                  >
                    Deseleccionar todos
                  </button>
                )}
              </div>

              {selectedModelIds.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                    padding: "10px",
                    background: "var(--surface-subtle)",
                    borderRadius: "8px",
                    border: "1px solid var(--border-line)",
                    maxHeight: "120px",
                    overflowY: "auto",
                  }}
                >
                  {selectedModelIds.map((id) => {
                    const m = modelMap.get(id);
                    const brandName = m ? brandMap.get(m.brand_id) || "Marca" : "Marca";
                    const modelName = m?.name || id;

                    return (
                      <span
                        key={id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "4px 8px",
                          background: "#ffffff",
                          borderRadius: "4px",
                          border: "1px solid var(--brand-primary)",
                          fontSize: "12px",
                          color: "var(--text-main)",
                          fontWeight: 500,
                        }}
                      >
                        <span style={{ color: "var(--brand-primary)", fontWeight: 700, fontSize: "10px", textTransform: "uppercase" }}>
                          {brandName}
                        </span>
                        {modelName}
                        <button
                          type="button"
                          onClick={() => handleRemoveModel(id)}
                          disabled={submitting}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            display: "inline-flex",
                            alignItems: "center",
                            cursor: "pointer",
                            color: "var(--text-muted)",
                          }}
                          aria-label={`Quitar ${modelName}`}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div
                  style={{
                    padding: "12px",
                    background: "var(--surface-subtle)",
                    borderRadius: "8px",
                    border: "1px dashed var(--border-line)",
                    textAlign: "center",
                    fontSize: "12px",
                    color: "var(--text-muted)",
                  }}
                >
                  No hay modelos compatibles adicionales seleccionados.
                </div>
              )}
            </div>

            {/* Filter and Search Bar */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: "10px", marginTop: "4px" }}>
              <div style={{ position: "relative" }}>
                <Search
                  size={14}
                  style={{
                    position: "absolute",
                    left: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-muted)",
                  }}
                />
                <input
                  type="text"
                  placeholder="Filtrar por nombre o código de modelo..."
                  className="filter-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={submitting}
                  style={{ width: "100%", paddingLeft: "32px", fontSize: "12px" }}
                />
              </div>

              <div>
                <select
                  className="filter-select"
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                  disabled={submitting}
                  style={{ width: "100%", fontSize: "12px" }}
                >
                  <option value="all">Todas las marcas</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Available Models List */}
            <div
              style={{
                border: "1px solid var(--border-line)",
                borderRadius: "8px",
                maxHeight: "220px",
                overflowY: "auto",
                background: "#ffffff",
              }}
            >
              {filteredModels.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "var(--border-line)" }}>
                  {filteredModels.map((m) => {
                    const isSelected = selectedModelIds.includes(m.id);
                    const brandName = brandMap.get(m.brand_id) || "";

                    return (
                      <div
                        key={m.id}
                        onClick={() => handleToggleModel(m.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleToggleModel(m.id);
                          }
                        }}
                        style={{
                          padding: "10px 12px",
                          background: isSelected ? "var(--surface-subtle)" : "#ffffff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          cursor: submitting ? "not-allowed" : "pointer",
                          userSelect: "none",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)" }}>
                            {m.name}
                          </span>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            {brandName} • Código: {m.code}
                          </span>
                        </div>

                        <div
                          style={{
                            width: "20px",
                            height: "20px",
                            borderRadius: "4px",
                            border: `1px solid ${isSelected ? "var(--brand-primary)" : "var(--border-line)"}`,
                            background: isSelected ? "var(--brand-primary)" : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#ffffff",
                          }}
                        >
                          {isSelected && <Check size={14} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ padding: "24px", textAlign: "center", fontSize: "12px", color: "var(--text-muted)" }}>
                  No se encontraron modelos con los filtros seleccionados.
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer Actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
            paddingTop: "14px",
            borderTop: "1px solid var(--border-line)",
          }}
        >
          <button
            type="button"
            className="pag-btn"
            onClick={handleClose}
            disabled={submitting}
          >
            Cancelar
          </button>

          <button
            type="submit"
            className="btn-primary"
            disabled={submitting || loadingInitial || !!initialError}
          >
            {submitting ? "Guardando..." : "Guardar Compatibilidades"}
          </button>
        </div>
      </form>
    </Modal>
  );
};
