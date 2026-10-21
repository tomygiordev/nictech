import React, { useState, useRef } from "react";
import { Plus, Layers, AlertCircle, Loader2 } from "lucide-react";
import { Modal } from "../../components/erp/WorkspaceUi";
import { supabase } from "../../lib/supabase";
import {
  type MasterCategory,
  type MasterBrand,
  type MasterModel,
  type MasterLocation,
  type VariantRowInput,
  productCreateSchema,
  buildCreateCatalogPayload,
  calculateFiscalBreakdown,
  getErrorMessage,
} from "./schemas";

export interface CreateProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: MasterCategory[];
  brands: MasterBrand[];
  models: MasterModel[];
  locations?: MasterLocation[];
  onSuccess: (message: string, createdProductId?: string) => void;
}

export const CreateProductModal: React.FC<CreateProductModalProps> = ({
  isOpen,
  onClose,
  categories,
  brands,
  models,
  onSuccess,
}) => {
  // Main form fields
  const [internalCode, setInternalCode] = useState("");
  const [internalName, setInternalName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [brandId, setBrandId] = useState<string>("");
  const [modelId, setModelId] = useState<string>("");
  const [baseSalePrice, setBaseSalePrice] = useState("");
  const [baseCost, setBaseCost] = useState("");

  // Variants management
  const [hasVariants, setHasVariants] = useState(false);
  const [variantsList, setVariantsList] = useState<VariantRowInput[]>([
    { name: "Negro", code: "NEG", barcode: "", sku: "", price_mode: "inherit", final_price_ars: null },
    { name: "Rosa", code: "ROS", barcode: "", sku: "", price_mode: "inherit", final_price_ars: null },
  ]);

  // Submission states & double submit guard
  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Filter models by selected brand
  const filteredModels = brandId
    ? models.filter((m) => m.brand_id === brandId)
    : [];

  // Fiscal breakdown live calculation
  const numericPrice = parseFloat(baseSalePrice) || 0;
  const fiscal = calculateFiscalBreakdown(numericPrice, 21);

  const resetForm = () => {
    setInternalCode("");
    setInternalName("");
    setCategoryId("");
    setBrandId("");
    setModelId("");
    setBaseSalePrice("");
    setBaseCost("");
    setHasVariants(false);
    setVariantsList([
      { name: "Negro", code: "NEG", barcode: "", sku: "", price_mode: "inherit", final_price_ars: null },
      { name: "Rosa", code: "ROS", barcode: "", sku: "", price_mode: "inherit", final_price_ars: null },
    ]);
    setError(null);
  };

  const handleClose = () => {
    if (submitting || isSubmittingRef.current) return;
    resetForm();
    onClose();
  };

  const addVariantRow = () => {
    setVariantsList((prev) => [
      ...prev,
      { name: "", code: "", barcode: "", sku: "", price_mode: "inherit", final_price_ars: null },
    ]);
  };

  const removeVariantRow = (index: number) => {
    setVariantsList((prev) => prev.filter((_, i) => i !== index));
  };

  const updateVariantRow = (index: number, field: keyof VariantRowInput, value: unknown) => {
    setVariantsList((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || submitting) return;

    setError(null);

    // Validate using Zod schema
    const validationResult = productCreateSchema.safeParse({
      internal_code: internalCode,
      internal_name: internalName,
      category_id: categoryId || null,
      brand_id: brandId || null,
      model_id: modelId || null,
      base_sale_price: baseSalePrice,
      base_cost: baseCost,
      has_variants: hasVariants,
      variants: hasVariants ? variantsList : [],
    });

    if (!validationResult.success) {
      setError(validationResult.error.issues[0]?.message ?? "Revisá los datos ingresados.");
      return;
    }

    try {
      isSubmittingRef.current = true;
      setSubmitting(true);
      const rpcPayload = buildCreateCatalogPayload(validationResult.data);

      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        "create_catalog_product_with_variants",
        rpcPayload,
      );

      if (rpcErr) throw rpcErr;

      const res = rpcData as {
        product_id: string;
        internal_code: string;
        internal_name: string;
        variants: Array<{ id: string; code: string; name: string }>;
      };

      const createdName = res?.internal_name || validationResult.data.internal_name;
      const createdId = res?.product_id;

      resetForm();
      onSuccess(`¡Artículo "${createdName}" registrado exitosamente en el catálogo ERP!`, createdId);
      onClose();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, "Error al registrar el producto en el catálogo");
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
      title="Nuevo Producto o Funda con Variantes"
      subtitle="Alta oficial en catálogo maestro ERP y vinculación de variantes"
      icon={Plus}
      maxWidth="680px"
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

        {/* Code & Name Row */}
        <div className="erp-form-row">
          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="prod-create-code">
              Código Interno *
            </label>
            <input
              id="prod-create-code"
              type="text"
              required
              disabled={submitting}
              placeholder="FUNDA-IP13"
              value={internalCode}
              onChange={(e) => setInternalCode(e.target.value)}
              className="erp-form-input"
              style={{ fontFamily: "monospace", textTransform: "uppercase" }}
            />
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="prod-create-name">
              Nombre del Artículo *
            </label>
            <input
              id="prod-create-name"
              type="text"
              required
              disabled={submitting}
              placeholder="Ej: Funda Silicona iPhone 13 Pro Max"
              value={internalName}
              onChange={(e) => setInternalName(e.target.value)}
              className="erp-form-input"
            />
          </div>
        </div>

        {/* Master References: Category, Brand, Model */}
        <div className="erp-form-row">
          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="prod-create-cat">
              Categoría
            </label>
            <select
              id="prod-create-cat"
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
            <label className="erp-form-label" htmlFor="prod-create-brand">
              Marca
            </label>
            <select
              id="prod-create-brand"
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
            <label className="erp-form-label" htmlFor="prod-create-model">
              Modelo Principal
            </label>
            <select
              id="prod-create-model"
              className="erp-form-select"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              disabled={submitting || (!brandId && filteredModels.length > 50)}
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

        {/* Pricing & Fiscal Details */}
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
          <div className="erp-form-row">
            <div className="erp-form-group" style={{ margin: 0 }}>
              <label className="erp-form-label" htmlFor="prod-create-price">
                Precio Final de Venta ($ ARS) *
              </label>
              <input
                id="prod-create-price"
                type="number"
                min="0"
                step="0.01"
                required
                disabled={submitting}
                placeholder="Ej: 12100"
                value={baseSalePrice}
                onChange={(e) => setBaseSalePrice(e.target.value)}
                className="erp-form-input"
              />
              <span style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                Precio final con IVA incluido a cobrar al cliente
              </span>
            </div>

            <div className="erp-form-group" style={{ margin: 0 }}>
              <label className="erp-form-label" htmlFor="prod-create-cost">
                Costo Base de Compra ($ ARS)
              </label>
              <input
                id="prod-create-cost"
                type="number"
                min="0"
                step="0.01"
                disabled={submitting}
                placeholder="Ej: 4000"
                value={baseCost}
                onChange={(e) => setBaseCost(e.target.value)}
                className="erp-form-input"
              />
              <span style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                Costo de referencia para cálculo de margen
              </span>
            </div>
          </div>

          {numericPrice > 0 && (
            <div
              style={{
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
                Desglose fiscal automático:
              </span>
              <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                Neto: ${fiscal.net.toLocaleString("es-AR", { minimumFractionDigits: 2 })} + IVA 21%: ${fiscal.tax.toLocaleString("es-AR", { minimumFractionDigits: 2 })} = <strong>${fiscal.total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</strong>
              </span>
            </div>
          )}
        </div>

        {/* Toggle Variants */}
        <div
          style={{
            padding: "12px",
            background: "var(--surface-subtle)",
            borderRadius: "8px",
            border: "1px solid var(--border-line)",
          }}
        >
          <label
            htmlFor="prod-create-has-variants"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontWeight: 650,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            <input
              id="prod-create-has-variants"
              type="checkbox"
              disabled={submitting}
              checked={hasVariants}
              onChange={(e) => setHasVariants(e.target.checked)}
            />
            <Layers size={16} /> Este artículo tiene variantes (ej: Colores de fundas)
          </label>

          {hasVariants && (
            <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                Cada variante puede heredar el precio del artículo o fijar un precio final propio IVA incluido, con código y código de barras propios:
              </span>

              {variantsList.map((row, idx) => (
                <div
                  key={idx}
                  className="erp-form-row"
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <input
                    type="text"
                    aria-label={`Color o nombre de variante ${idx + 1}`}
                    placeholder="Color / Nombre *"
                    value={row.name}
                    disabled={submitting}
                    onChange={(e) => updateVariantRow(idx, "name", e.target.value)}
                    className="erp-form-input"
                    style={{ fontSize: "12px", flex: "1 1 120px", minWidth: "110px" }}
                    required={hasVariants}
                  />
                  <input
                    type="text"
                    aria-label={`Código de variante ${idx + 1}`}
                    placeholder="Código *"
                    value={row.code}
                    disabled={submitting}
                    onChange={(e) => updateVariantRow(idx, "code", e.target.value)}
                    className="erp-form-input"
                    style={{ fontSize: "12px", fontFamily: "monospace", textTransform: "uppercase", width: "75px" }}
                    required={hasVariants}
                  />
                  <input
                    type="text"
                    aria-label={`Código de barras de variante ${idx + 1}`}
                    placeholder="Código de barras"
                    value={row.barcode || ""}
                    disabled={submitting}
                    onChange={(e) => updateVariantRow(idx, "barcode", e.target.value)}
                    className="erp-form-input"
                    style={{ fontSize: "12px", fontFamily: "monospace", width: "105px" }}
                  />
                  <input
                    type="text"
                    aria-label={`SKU de variante ${idx + 1}`}
                    placeholder="SKU"
                    value={row.sku || ""}
                    disabled={submitting}
                    onChange={(e) => updateVariantRow(idx, "sku", e.target.value)}
                    className="erp-form-input"
                    style={{ fontSize: "12px", fontFamily: "monospace", width: "95px" }}
                  />
                  <select
                    aria-label={`Modo de precio para variante ${idx + 1}`}
                    value={row.price_mode}
                    disabled={submitting}
                    onChange={(e) => {
                      const mode = e.target.value as "inherit" | "own";
                      updateVariantRow(idx, "price_mode", mode);
                      if (mode === "inherit") {
                        updateVariantRow(idx, "final_price_ars", null);
                      }
                    }}
                    className="erp-form-select"
                    style={{ fontSize: "12px", width: "90px", padding: "4px 6px" }}
                  >
                    <option value="inherit">Heredar</option>
                    <option value="own">Propio</option>
                  </select>
                  {row.price_mode === "own" && (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      aria-label={`Precio final ARS propio de variante ${idx + 1}`}
                      placeholder="$ Propio"
                      value={row.final_price_ars ?? ""}
                      disabled={submitting}
                      onChange={(e) => updateVariantRow(idx, "final_price_ars", e.target.value)}
                      className="erp-form-input"
                      style={{ fontSize: "12px", width: "95px" }}
                      required={row.price_mode === "own"}
                    />
                  )}
                  <button
                    type="button"
                    className="pag-btn"
                    onClick={() => removeVariantRow(idx)}
                    disabled={submitting || variantsList.length <= 1}
                    style={{ padding: "6px" }}
                    title="Eliminar variante"
                    aria-label={`Eliminar variante ${idx + 1}`}
                  >
                    ✕
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="pag-btn"
                onClick={addVariantRow}
                disabled={submitting}
                style={{ alignSelf: "flex-start", marginTop: "4px", fontSize: "12px" }}
              >
                <Plus size={12} /> Agregar Variante
              </button>
            </div>
          )}
        </div>

        {/* Action buttons */}
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
              "Crear Artículo"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
