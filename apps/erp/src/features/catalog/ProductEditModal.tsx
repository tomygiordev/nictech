import React, { useState, useEffect, useRef } from "react";
import { Edit2, AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { Modal } from "../../components/erp/WorkspaceUi";
import { supabase } from "../../lib/supabase";
import {
  type DbCatalogProduct,
  type MasterCategory,
  type MasterBrand,
  type MasterModel,
  productUpdateSchema,
  calculateStockSummary,
  calculateFiscalBreakdown,
  getErrorMessage,
} from "./schemas";
import { formatCurrency } from "../../lib/formatters";

export interface ProductEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: DbCatalogProduct | null;
  categories: MasterCategory[];
  brands: MasterBrand[];
  models: MasterModel[];
  onSuccess: (message: string) => void;
}

export const ProductEditModal: React.FC<ProductEditModalProps> = ({
  isOpen,
  onClose,
  product,
  categories,
  brands,
  models,
  onSuccess,
}) => {
  const [internalName, setInternalName] = useState("");
  const [publicName, setPublicName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [brandId, setBrandId] = useState<string>("");
  const [modelId, setModelId] = useState<string>("");
  const [baseSalePrice, setBaseSalePrice] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (product && isOpen) {
      setInternalName(product.internal_name || "");
      setPublicName(product.public_name || "");
      setCategoryId(product.category_id || "");
      setBrandId(product.brand_id || "");
      setModelId(product.model_id || "");
      setBaseSalePrice(product.base_sale_price ? product.base_sale_price.toString() : "0");
      setIsActive(product.is_active ?? true);
      setError(null);
    }
  }, [product, isOpen]);

  if (!product) return null;

  const variants = product.product_variants || [];
  const hasVariants = variants.length > 0;
  const filteredModels = brandId
    ? models.filter((m) => m.brand_id === brandId)
    : [];

  const numericPrice = parseFloat(baseSalePrice) || 0;
  const effectiveTaxRate = typeof product.tax_rate_percent === "number" ? product.tax_rate_percent : 21;
  const fiscal = calculateFiscalBreakdown(numericPrice, effectiveTaxRate);

  const handleClose = () => {
    if (submitting || isSubmittingRef.current) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || submitting) return;

    setError(null);

    const validation = productUpdateSchema.safeParse({
      id: product.id,
      internal_name: internalName,
      public_name: publicName.trim() ? publicName.trim() : null,
      category_id: categoryId || null,
      brand_id: brandId || null,
      model_id: modelId || null,
      base_sale_price: baseSalePrice,
      is_active: isActive,
    });

    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? "Revisá los datos ingresados.");
      return;
    }

    try {
      isSubmittingRef.current = true;
      setSubmitting(true);

      // Safe update: updates master catalog fields ONLY.
      // Explicitly preserves or updates public_name without forcing internal_name into it.
      // Appends .select('id').single() to catch 0 rows affected by RLS.
      const { error: dbErr } = await supabase
        .from("products")
        .update({
          internal_name: validation.data.internal_name,
          public_name: validation.data.public_name !== undefined ? validation.data.public_name : (product.public_name ?? null),
          category_id: validation.data.category_id,
          brand_id: validation.data.brand_id,
          model_id: validation.data.model_id,
          base_sale_price: validation.data.base_sale_price,
          is_active: validation.data.is_active,
        })
        .eq("id", product.id)
        .select("id")
        .single();

      if (dbErr) throw dbErr;

      onSuccess(`¡Artículo "${validation.data.internal_name}" actualizado sin alterar variantes ni saldos!`);
      onClose();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, "Error al actualizar el producto");
      setError(msg);
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Editar: ${product.internal_name}`}
      subtitle="Actualización de datos y precio maestro con preservación estricta de inventario"
      icon={Edit2}
      maxWidth="640px"
    >
      <form noValidate onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {error && (
          <div
            className="state-panel"
            role="alert"
            style={{
              borderColor: "var(--rose-accent)",
              background: "var(--rose-soft)",
              padding: "10px 14px",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <AlertCircle size={18} style={{ color: "var(--rose-accent)", flexShrink: 0 }} />
            <span style={{ fontSize: "13px", color: "var(--rose-accent)", fontWeight: 550 }}>
              {error}
            </span>
          </div>
        )}

        {/* Code & Names */}
        <div className="erp-form-row">
          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="edit-prod-code">
              Código Interno
            </label>
            <input
              id="edit-prod-code"
              type="text"
              readOnly
              disabled
              value={product.internal_code}
              className="erp-form-input"
              style={{ fontFamily: "monospace", opacity: 0.7, background: "var(--surface-subtle)" }}
            />
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="edit-prod-name">
              Nombre Interno del Artículo *
            </label>
            <input
              id="edit-prod-name"
              type="text"
              required
              disabled={submitting}
              value={internalName}
              onChange={(e) => setInternalName(e.target.value)}
              className="erp-form-input"
            />
          </div>
        </div>

        <div className="erp-form-group">
          <label className="erp-form-label" htmlFor="edit-prod-public-name">
            Nombre Público (Tienda Web / Presupuestos)
          </label>
          <input
            id="edit-prod-public-name"
            type="text"
            disabled={submitting}
            placeholder={internalName}
            value={publicName}
            onChange={(e) => setPublicName(e.target.value)}
            className="erp-form-input"
          />
          <span style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
            Nombre visible para clientes. Si se omite, se utiliza el nombre interno.
          </span>
        </div>

        {/* Master References: Category, Brand, Model */}
        <div className="erp-form-row">
          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="edit-prod-cat">
              Categoría
            </label>
            <select
              id="edit-prod-cat"
              className="erp-form-select"
              disabled={submitting}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">(Sin Categoría)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="edit-prod-brand">
              Marca
            </label>
            <select
              id="edit-prod-brand"
              className="erp-form-select"
              disabled={submitting}
              value={brandId}
              onChange={(e) => {
                setBrandId(e.target.value);
                setModelId("");
              }}
            >
              <option value="">(Sin Marca)</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="edit-prod-model">
              Modelo Principal
            </label>
            <select
              id="edit-prod-model"
              className="erp-form-select"
              disabled={submitting}
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            >
              <option value="">(Sin Modelo)</option>
              {filteredModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Price & Fiscal Detail */}
        <div
          style={{
            padding: "12px",
            background: "var(--surface-subtle)",
            borderRadius: "8px",
            border: "1px solid var(--border-line)",
          }}
        >
          <div className="erp-form-group" style={{ margin: 0 }}>
            <label className="erp-form-label" htmlFor="edit-prod-price">
              Precio Final de Venta ($ ARS con IVA incluido) *
            </label>
            <input
              id="edit-prod-price"
              type="number"
              min="0"
              step="0.01"
              required
              disabled={submitting}
              value={baseSalePrice}
              onChange={(e) => setBaseSalePrice(e.target.value)}
              className="erp-form-input"
            />
          </div>

          {numericPrice > 0 && (
            <div
              style={{
                marginTop: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: "12px",
                padding: "6px 10px",
                background: "#ffffff",
                borderRadius: "6px",
                border: "1px dashed var(--border-line)",
              }}
            >
              <span style={{ color: "var(--text-muted)" }}>
                Desglose fiscal (IVA {effectiveTaxRate}%):
              </span>
              <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                Neto: ${fiscal.net.toLocaleString("es-AR", { minimumFractionDigits: 2 })} + IVA: ${fiscal.tax.toLocaleString("es-AR", { minimumFractionDigits: 2 })} = <strong>${fiscal.total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</strong>
              </span>
            </div>
          )}
        </div>

        <div className="erp-form-group">
          <label htmlFor="edit-prod-active" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 650, cursor: "pointer" }}>
            <input
              id="edit-prod-active"
              type="checkbox"
              disabled={submitting}
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Artículo Activo y Habilitado para Comercialización
          </label>
        </div>

        {/* Existing Variants & Stock Integrity Confirmation */}
        {hasVariants && (
          <div
            style={{
              padding: "12px",
              background: "var(--surface-subtle)",
              borderRadius: "8px",
              border: "1px solid var(--border-line)",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: 650, color: "var(--text-main)" }}>
              Variantes Registradas ({variants.length})
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {variants.map((v) => {
                const summary = calculateStockSummary(product.stock_balances, v.id);
                const barcode = v.product_identifiers?.find((pi) => pi.kind === "barcode")?.value;
                const hasLegacyDelta = typeof v.price_delta === "number" && v.price_delta !== 0;
                const effectiveVariantPrice = (product.base_sale_price || 0) + (v.price_delta || 0);

                return (
                  <span
                    key={v.id}
                    className="module-state-badge"
                    style={{
                      fontSize: "12px",
                      padding: "4px 8px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                    title={barcode ? `Código de barras: ${barcode}` : undefined}
                  >
                    <strong>{v.name}</strong>
                    <span style={{ fontFamily: "monospace", opacity: 0.8 }}>({v.code})</span>
                    {hasLegacyDelta ? (
                      <span style={{ color: "var(--amber-accent)", fontWeight: 600 }}>
                        • {formatCurrency(effectiveVariantPrice, "ARS")} (delta legacy: {v.price_delta > 0 ? `+${v.price_delta}` : v.price_delta})
                      </span>
                    ) : null}
                    <span style={{ color: "var(--brand-primary)", fontWeight: 600 }}>
                      • {summary.available} u.
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Preservation Guarantee Note */}
        <div
          style={{
            fontSize: "12px",
            color: "var(--text-muted)",
            background: "var(--surface-subtle)",
            padding: "8px 12px",
            borderRadius: "6px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <ShieldCheck size={16} style={{ color: "var(--emerald-success)", flexShrink: 0 }} />
          <span>
            Las variantes, códigos de barra y movimientos de stock históricos se preservan intactos sin riesgo de sobreescritura.
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            marginTop: "8px",
            paddingTop: "12px",
            borderTop: "1px solid var(--border-line)",
          }}
        >
          <button type="button" className="pag-btn" onClick={handleClose} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Guardando…
              </>
            ) : (
              "Guardar Cambios"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
