import React, { useState, useEffect, useRef } from "react";
import {
  Layers,
  Plus,
  AlertCircle,
  Barcode,
  Power,
  RefreshCw,
  Info,
} from "lucide-react";
import { Modal } from "../../components/erp/WorkspaceUi";
import { supabase } from "../../lib/supabase";
import { formatCurrency } from "../../lib/formatters";
import {
  type DbCatalogProduct,
  manageProductVariantsSchema,
  buildManageVariantsPayload,
  calculateStockSummary,
  getActiveBarcode,
  getErrorMessage,
} from "./schemas";

export interface ProductVariantsModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: DbCatalogProduct | null;
  onSuccess: (message: string) => void;
}

interface EditableVariantState {
  id?: string | null;
  name: string;
  code: string;
  barcode: string;
  is_active: boolean;
  price_delta?: number;
  availableStock: number;
  onHandStock: number;
}

export const ProductVariantsModal: React.FC<ProductVariantsModalProps> = ({
  isOpen,
  onClose,
  product,
  onSuccess,
}) => {
  const [variants, setVariants] = useState<EditableVariantState[]>([]);
  const [newColor, setNewColor] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newBarcode, setNewBarcode] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && product) {
      setError(null);
      setNewColor("");
      setNewCode("");
      setNewBarcode("");

      const initial: EditableVariantState[] = (product.product_variants || []).map((v) => {
        const barcodeVal = getActiveBarcode(v.product_identifiers);
        const summary = calculateStockSummary(product.stock_balances, v.id);

        return {
          id: v.id,
          name: v.name,
          code: v.code,
          barcode: barcodeVal,
          is_active: v.is_active !== false,
          price_delta: v.price_delta,
          availableStock: summary.available,
          onHandStock: summary.onHand,
        };
      });

      setVariants(initial);
    }
  }, [isOpen, product]);

  if (!product) return null;

  const handleClose = () => {
    if (submitting || isSubmittingRef.current) return;
    onClose();
  };

  const handleUpdateField = (index: number, field: keyof EditableVariantState, value: unknown) => {
    if (submitting) return;
    setVariants((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleToggleActive = (index: number) => {
    if (submitting) return;
    setVariants((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], is_active: !copy[index].is_active };
      return copy;
    });
  };

  const handleAddNewVariant = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const trimmedName = newColor.trim();
    const trimmedCode = newCode.trim().toUpperCase();
    const trimmedBarcode = newBarcode.trim();

    if (!trimmedName) {
      setError("El nombre o color de la nueva variante es obligatorio.");
      return;
    }

    if (!trimmedCode) {
      setError("El código de la nueva variante es obligatorio.");
      return;
    }

    // Check duplicate code
    if (variants.some((v) => v.code.toUpperCase() === trimmedCode)) {
      setError(`El código '${trimmedCode}' ya se encuentra asignado en la lista.`);
      return;
    }

    // Check duplicate barcode
    if (trimmedBarcode && variants.some((v) => v.barcode && v.barcode.replace(/\s+/g, "") === trimmedBarcode.replace(/\s+/g, ""))) {
      setError(`El código de barras '${trimmedBarcode}' ya está en uso en otra variante de la lista.`);
      return;
    }

    setError(null);
    setVariants((prev) => [
      ...prev,
      {
        id: null,
        name: trimmedName,
        code: trimmedCode,
        barcode: trimmedBarcode,
        is_active: true,
        price_delta: 0,
        availableStock: 0,
        onHandStock: 0,
      },
    ]);

    setNewColor("");
    setNewCode("");
    setNewBarcode("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || submitting) return;

    setError(null);

    const validation = manageProductVariantsSchema.safeParse({
      productId: product.id,
      expectedUpdatedAt: product.updated_at || null,
      variants: variants.map((v) => ({
        id: v.id || null,
        name: v.name,
        code: v.code,
        barcode: v.barcode ? v.barcode.trim() : null,
        is_active: v.is_active,
      })),
    });

    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? "Revisá los datos de las variantes.");
      return;
    }

    try {
      isSubmittingRef.current = true;
      setSubmitting(true);

      const payload = buildManageVariantsPayload(validation.data);
      const { error: rpcErr } = await supabase.rpc("manage_product_variants", payload);

      if (rpcErr) throw rpcErr;

      onSuccess(`Variantes de "${product.internal_name}" actualizadas correctamente.`);
      onClose();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, "Error al gestionar las variantes del catálogo");
      setError(msg);
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const totalSummary = calculateStockSummary(product.stock_balances);
  const parentPrice = product.base_sale_price || 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Gestión de Variantes de Color & Estados"
      subtitle={`Artículo: ${product.internal_name} (${product.internal_code})`}
      icon={Layers}
      maxWidth="840px"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Notice Card */}
        <div
          style={{
            padding: "12px 16px",
            background: "var(--surface-subtle)",
            borderRadius: "8px",
            border: "1px solid var(--border-line)",
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            fontSize: "12px",
            color: "var(--text-muted)",
          }}
        >
          <Info size={16} style={{ color: "var(--brand-primary)", flexShrink: 0, marginTop: "2px" }} />
          <div>
            <span style={{ fontWeight: 600, color: "var(--text-main)", display: "block" }}>
              Reglas de Inventario e Historial ERP
            </span>
            <span>
              Las nuevas variantes heredan el precio maestro ({formatCurrency(parentPrice, "ARS")}). Por integridad de saldos contables y trazabilidad de movimientos pasados, las variantes no se eliminan físicamente: utilizá el interruptor para <strong>pausar</strong> variantes sin uso.
            </span>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            className="state-panel"
            role="alert"
            style={{
              borderColor: "var(--rose-accent)",
              background: "var(--rose-soft)",
              color: "var(--rose-accent)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "12px",
            }}
          >
            <AlertCircle size={16} />
            <span style={{ fontSize: "13px" }}>{error}</span>
          </div>
        )}

        {/* Existing Variants Table */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-main)" }}>
              Variantes Registradas ({variants.length})
            </span>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              Stock total del producto: {totalSummary.onHand} físico / {totalSummary.available} disponible
            </span>
          </div>

          <div className="flow-table-wrapper" style={{ maxHeight: "260px", overflowY: "auto" }}>
            <table className="flow-table">
              <thead>
                <tr>
                  <th style={{ width: "90px" }}>Estado</th>
                  <th>Color / Nombre</th>
                  <th style={{ width: "120px" }}>Código</th>
                  <th style={{ width: "160px" }}>Código de Barras</th>
                  <th style={{ width: "110px" }}>Precio</th>
                  <th style={{ width: "90px" }}>Stock</th>
                  <th style={{ width: "90px" }} className="text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {variants.length > 0 ? (
                  variants.map((v, idx) => {
                    const hasLegacyDelta = typeof v.price_delta === "number" && v.price_delta !== 0;
                    const effectivePrice = parentPrice + (v.price_delta || 0);

                    return (
                      <tr key={v.id || `new-${idx}`} style={{ opacity: v.is_active ? 1 : 0.65 }}>
                        <td>
                          {v.is_active ? (
                            <span className="flow-status-pill completed" style={{ fontSize: "11px" }}>
                              Activa
                            </span>
                          ) : (
                            <span
                              className="flow-status-pill pending"
                              style={{
                                background: "var(--rose-soft)",
                                color: "var(--rose-accent)",
                                borderColor: "var(--rose-border)",
                                fontSize: "11px",
                              }}
                            >
                              Pausada
                            </span>
                          )}
                        </td>
                        <td>
                          <input
                            type="text"
                            value={v.name}
                            onChange={(e) => handleUpdateField(idx, "name", e.target.value)}
                            disabled={submitting}
                            placeholder="Color / Nombre"
                            className="filter-input"
                            style={{ width: "100%", padding: "4px 8px", fontSize: "12px" }}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={v.code}
                            onChange={(e) => handleUpdateField(idx, "code", e.target.value.toUpperCase())}
                            disabled={submitting}
                            placeholder="CÓDIGO"
                            className="filter-input"
                            style={{
                              width: "100%",
                              padding: "4px 8px",
                              fontSize: "12px",
                              fontFamily: "monospace",
                            }}
                          />
                        </td>
                        <td>
                          <div style={{ position: "relative" }}>
                            <input
                              type="text"
                              value={v.barcode}
                              onChange={(e) => handleUpdateField(idx, "barcode", e.target.value)}
                              disabled={submitting}
                              placeholder="Sin código"
                              className="filter-input"
                              style={{
                                width: "100%",
                                padding: "4px 8px 4px 24px",
                                fontSize: "11px",
                                fontFamily: "monospace",
                              }}
                            />
                            <Barcode
                              size={12}
                              style={{
                                position: "absolute",
                                left: "6px",
                                top: "50%",
                                transform: "translateY(-50%)",
                                color: "var(--text-muted)",
                              }}
                            />
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)" }}>
                            {formatCurrency(effectivePrice, "ARS")}
                          </span>
                          {hasLegacyDelta && (
                            <small style={{ display: "block", fontSize: "10px", color: "var(--amber-accent)" }}>
                              Delta legacy: {v.price_delta! > 0 ? `+${v.price_delta}` : v.price_delta}
                            </small>
                          )}
                        </td>
                        <td>
                          <strong
                            style={{
                              fontSize: "12px",
                              color: v.availableStock > 0 ? "var(--emerald-success)" : "var(--text-muted)",
                            }}
                          >
                            {v.availableStock} u.
                          </strong>
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="pag-btn"
                            onClick={() => handleToggleActive(idx)}
                            disabled={submitting}
                            style={{
                              padding: "4px 8px",
                              fontSize: "11px",
                              color: v.is_active ? "var(--rose-accent)" : "var(--emerald-success)",
                            }}
                            title={v.is_active ? "Pausar variante" : "Reactivar variante"}
                          >
                            <Power size={12} /> {v.is_active ? "Pausar" : "Reactivar"}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)", fontSize: "12px" }}>
                      No hay variantes configuradas para este producto. Agregá variantes debajo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Add New Variant Inline Form */}
        <div
          style={{
            padding: "12px",
            background: "var(--surface-subtle)",
            borderRadius: "8px",
            border: "1px dashed var(--border-line)",
          }}
        >
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-main)", display: "block", marginBottom: "8px" }}>
            Agregar Nueva Variante de Color
          </span>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1.2fr auto", gap: "8px", alignItems: "center" }}>
            <input
              type="text"
              placeholder="Color (ej: Negro Mate)"
              className="filter-input"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              disabled={submitting}
              style={{ fontSize: "12px", padding: "6px 8px" }}
            />
            <input
              type="text"
              placeholder="Código (ej: NEG)"
              className="filter-input"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toUpperCase())}
              disabled={submitting}
              style={{ fontSize: "12px", padding: "6px 8px", fontFamily: "monospace" }}
            />
            <input
              type="text"
              placeholder="Código de barras (opcional)"
              className="filter-input"
              value={newBarcode}
              onChange={(e) => setNewBarcode(e.target.value)}
              disabled={submitting}
              style={{ fontSize: "12px", padding: "6px 8px", fontFamily: "monospace" }}
            />
            <button
              type="button"
              className="pag-btn"
              onClick={handleAddNewVariant}
              disabled={submitting || !newColor.trim() || !newCode.trim()}
              style={{ padding: "6px 12px", fontSize: "12px" }}
            >
              <Plus size={14} /> Añadir
            </button>
          </div>
        </div>

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
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "Guardando Cambios..." : "Guardar Variantes y Estados"}
          </button>
        </div>
      </div>
    </Modal>
  );
};
