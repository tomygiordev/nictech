import React, { useState, useEffect } from "react";
import {
  Boxes,
  Edit2,
  ArrowDownRight,
  Barcode,
  Layers,
  Smartphone,
  Plus,
} from "lucide-react";
import { Modal } from "../../components/erp/WorkspaceUi";
import { formatCurrency } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";
import {
  type DbCatalogProduct,
  type DbProductCompatibleModel,
  calculateStockSummary,
  calculateFiscalBreakdown,
  getActiveBarcode,
  getActiveSku,
} from "./schemas";

export interface ProductDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: DbCatalogProduct | null;
  onOpenEdit: () => void;
  onOpenStockIntake: (variantId?: string | null) => void;
  onOpenCompatibility?: () => void;
  onOpenManageVariants?: () => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  isOpen,
  onClose,
  product,
  onOpenEdit,
  onOpenStockIntake,
  onOpenCompatibility,
  onOpenManageVariants,
}) => {
  const [compatibleModels, setCompatibleModels] = useState<DbProductCompatibleModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    if (product && isOpen) {
      if (product.product_compatible_models && product.product_compatible_models.length > 0) {
        setCompatibleModels(product.product_compatible_models);
      } else {
        let isMounted = true;
        setLoadingModels(true);
        (async () => {
          try {
            const { data, error } = await supabase.rpc("get_product_compatible_models", {
              p_product_id: product.id,
            });
            if (!isMounted) return;
            if (!error && data) {
              setCompatibleModels(
                data.map((item) => ({
                  id: item.id,
                  model_id: item.model_id,
                  product_models: {
                    id: item.model_id,
                    code: item.model_code,
                    name: item.model_name,
                    brand_id: item.brand_id || "",
                    brands: item.brand_name ? { id: item.brand_id || "", name: item.brand_name } : null,
                  },
                })),
              );
            }
          } catch {
            // Graceful non-blocking fallback
          } finally {
            if (isMounted) setLoadingModels(false);
          }
        })();

        return () => {
          isMounted = false;
        };
      }
    }
  }, [product, isOpen]);

  if (!product) return null;

  const variants = product.product_variants || [];
  const hasVariants = variants.length > 0;
  const totalSummary = calculateStockSummary(product.stock_balances);
  const effectiveTaxRate = typeof product.tax_rate_percent === "number" ? product.tax_rate_percent : 21;
  const fiscal = calculateFiscalBreakdown(product.base_sale_price || 0, effectiveTaxRate);
  const hasAnyLegacyDelta = variants.some((v) => typeof v.price_delta === "number" && v.price_delta !== 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={product.internal_name}
      subtitle={`Ficha oficial ERP • Código: ${product.internal_code}`}
      icon={Boxes}
      maxWidth="680px"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Header Details Card */}
        <div
          style={{
            padding: "16px",
            background: "var(--surface-subtle)",
            borderRadius: "8px",
            border: "1px solid var(--border-line)",
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: "16px",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span className="type-badge blue" style={{ fontFamily: "monospace", fontSize: "12px" }}>
                {product.internal_code}
              </span>
              {product.is_active !== false ? (
                <span className="flow-status-pill completed">Habilitado</span>
              ) : (
                <span className="flow-status-pill pending" style={{ background: "var(--rose-soft)", color: "var(--rose-accent)", borderColor: "var(--rose-border)" }}>
                  Pausado
                </span>
              )}
              {product.product_categories?.name && (
                <span className="module-state-badge" style={{ fontSize: "11px" }}>
                  {product.product_categories.name}
                </span>
              )}
            </div>

            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--text-main)" }}>
              {product.internal_name}
            </h3>

            {product.public_name && product.public_name !== product.internal_name && (
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
                Nombre público: <em>{product.public_name}</em>
              </p>
            )}

            {(product.brands?.name || product.product_models?.name) && (
              <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
                Modelo maestro: <strong>{product.brands?.name}</strong> {product.product_models?.name ? `• ${product.product_models.name}` : ""}
              </p>
            )}

            <div style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px" }}>
              <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-main)" }}>
                Compatibilidad N:M:
              </span>
              {loadingModels ? (
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>cargando...</span>
              ) : compatibleModels.length > 0 ? (
                <>
                  {compatibleModels.slice(0, 5).map((cm, idx) => {
                    const mName = cm.product_models?.name || "Modelo";
                    const bName = cm.product_models?.brands?.name || "";
                    return (
                      <span key={cm.id || idx} className="module-state-badge" style={{ fontSize: "10px", padding: "1px 6px" }}>
                        {bName ? `${bName} ${mName}` : mName}
                      </span>
                    );
                  })}
                  {compatibleModels.length > 5 && (
                    <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                      +{compatibleModels.length - 5} más
                    </span>
                  )}
                </>
              ) : (
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Solo modelo maestro (sin compatibilidades accesorias registradas)
                </span>
              )}
            </div>
          </div>

          {/* Price Box */}
          <div style={{ textAlign: "right", paddingLeft: "16px", borderLeft: "1px solid var(--border-line)" }}>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>
              Precio Final de Venta
            </span>
            <strong style={{ fontSize: "20px", color: "var(--brand-primary)", display: "block" }}>
              {formatCurrency(product.base_sale_price || 0, "ARS")}
            </strong>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginTop: "2px" }}>
              Neto: ${fiscal.net.toLocaleString("es-AR", { minimumFractionDigits: 2 })} + IVA {effectiveTaxRate}%: ${fiscal.tax.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Stock Metrics Row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
          <div
            style={{
              padding: "12px",
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid var(--border-line)",
              textAlign: "center",
            }}
          >
            <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>
              Físico en Depósitos
            </span>
            <strong style={{ fontSize: "18px", color: "var(--text-main)" }}>
              {totalSummary.onHand} u.
            </strong>
          </div>

          <div
            style={{
              padding: "12px",
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid var(--border-line)",
              textAlign: "center",
            }}
          >
            <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>
              Comprometido / Reservado
            </span>
            <strong
              style={{
                fontSize: "18px",
                color: totalSummary.reserved > 0 ? "var(--amber-accent)" : "var(--text-muted)",
              }}
            >
              {totalSummary.reserved} u.
            </strong>
          </div>

          <div
            style={{
              padding: "12px",
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid var(--border-line)",
              textAlign: "center",
            }}
          >
            <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>
              Disponible Real
            </span>
            <strong
              style={{
                fontSize: "18px",
                color: totalSummary.available > 0 ? "var(--emerald-success)" : "var(--rose-accent)",
              }}
            >
              {totalSummary.available} u.
            </strong>
          </div>
        </div>

        {/* Variants Section */}
        {hasVariants ? (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Layers size={16} style={{ color: "var(--brand-primary)" }} />
                <h4 style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "var(--text-main)" }}>
                  Variantes de Color & Existencias ({variants.length})
                </h4>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  className="pag-btn"
                  style={{ padding: "4px 8px", fontSize: "11px" }}
                  onClick={() => {
                    onClose();
                    onOpenManageVariants?.();
                  }}
                >
                  <Layers size={12} /> Gestionar Variantes
                </button>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  {hasAnyLegacyDelta
                    ? "Variantes con precios y deltas legacy registrados"
                    : `Heredan el precio padre (${formatCurrency(product.base_sale_price || 0, "ARS")})`}
                </span>
              </div>
            </div>

            <div className="flow-table-wrapper" style={{ maxHeight: "220px", overflowY: "auto" }}>
              <table className="flow-table">
                <thead>
                  <tr>
                    <th>Color / Variante</th>
                    <th>Código</th>
                    <th>Código de Barras / SKU</th>
                    <th>Precio Efectivo</th>
                    <th>Stock Disp.</th>
                    <th className="text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => {
                    const vSummary = calculateStockSummary(product.stock_balances, v.id);
                    const barcode = getActiveBarcode(v.product_identifiers);
                    const sku = getActiveSku(v.product_identifiers);
                    const hasLegacyDelta = typeof v.price_delta === "number" && v.price_delta !== 0;
                    const effectivePrice = (product.base_sale_price || 0) + (v.price_delta || 0);

                    return (
                      <tr key={v.id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <strong style={{ fontSize: "13px", color: "var(--text-main)" }}>
                              {v.name}
                            </strong>
                            {v.is_active === false && (
                              <span className="flow-status-pill pending" style={{ fontSize: "10px", padding: "1px 5px" }}>
                                Pausada
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontFamily: "monospace", fontSize: "12px", opacity: 0.85 }}>
                            {v.code}
                          </span>
                        </td>
                        <td>
                          {barcode ? (
                            <span style={{ fontFamily: "monospace", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                              <Barcode size={12} /> {barcode}
                            </span>
                          ) : sku ? (
                            <span style={{ fontFamily: "monospace", fontSize: "11px" }}>{sku}</span>
                          ) : (
                            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Sin código</span>
                          )}
                        </td>
                        <td>
                          <span style={{ fontSize: "12px", fontWeight: 600, color: hasLegacyDelta ? "var(--amber-accent)" : "var(--text-main)" }}>
                            {formatCurrency(effectivePrice, "ARS")}
                            {hasLegacyDelta && (
                              <small style={{ display: "block", fontSize: "10px", color: "var(--text-muted)" }}>
                                Delta legacy: {v.price_delta > 0 ? `+${v.price_delta}` : v.price_delta}
                              </small>
                            )}
                          </span>
                        </td>
                        <td>
                          <strong
                            style={{
                              fontSize: "12px",
                              color: vSummary.available > 0 ? "var(--emerald-success)" : "var(--rose-accent)",
                            }}
                          >
                            {vSummary.available} u.
                          </strong>
                          {vSummary.reserved > 0 && (
                            <span style={{ fontSize: "10px", color: "var(--amber-accent)", marginLeft: "4px" }}>
                              ({vSummary.reserved} res.)
                            </span>
                          )}
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="pag-btn"
                            style={{ padding: "4px 8px", fontSize: "11px" }}
                            onClick={() => {
                              onClose();
                              onOpenStockIntake(v.id);
                            }}
                          >
                            <ArrowDownRight size={11} /> Cargar Stock
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: "14px",
              background: "var(--surface-subtle)",
              borderRadius: "8px",
              border: "1px dashed var(--border-line)",
              textAlign: "center",
              fontSize: "13px",
              color: "var(--text-muted)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>Este artículo no posee variantes activas. Todo el stock se administra a nivel de producto estándar.</span>
            <button
              type="button"
              className="pag-btn"
              style={{ fontSize: "12px", padding: "4px 10px" }}
              onClick={() => {
                onClose();
                onOpenManageVariants?.();
              }}
            >
              <Plus size={12} /> Configurar Variantes de Color
            </button>
          </div>
        )}

        {/* Footer Actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: "14px",
            borderTop: "1px solid var(--border-line)",
          }}
        >
          <button type="button" className="pag-btn" onClick={onClose}>
            Cerrar Ficha
          </button>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="pag-btn"
              onClick={() => {
                onClose();
                onOpenCompatibility?.();
              }}
            >
              <Smartphone size={14} /> Modelos Compatibles
            </button>
            <button
              type="button"
              className="pag-btn"
              onClick={() => {
                onClose();
                onOpenStockIntake(null);
              }}
            >
              <ArrowDownRight size={14} /> Cargar Stock
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                onClose();
                onOpenEdit();
              }}
            >
              <Edit2 size={14} /> Editar Datos
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
