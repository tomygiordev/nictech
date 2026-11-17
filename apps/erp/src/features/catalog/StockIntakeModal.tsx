import React, { useState, useEffect, useRef } from "react";
import { ArrowDownRight, Package, AlertCircle, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { Modal } from "../../components/erp/WorkspaceUi";
import { supabase } from "../../lib/supabase";
import {
  type DbCatalogProduct,
  type MasterLocation,
  stockIntakeSchema,
  buildStockIntakePayload,
  createStockOperationKey,
  calculateStockSummary,
  getErrorMessage,
} from "./schemas";

export interface StockIntakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: DbCatalogProduct | null;
  initialVariantId?: string | null;
  locations: MasterLocation[];
  onSuccess: (message: string) => void;
}

interface PendingStockAttempt {
  payload: ReturnType<typeof buildStockIntakePayload>;
  error: string;
}

export const StockIntakeModal: React.FC<StockIntakeModalProps> = ({
  isOpen,
  onClose,
  product,
  initialVariantId = null,
  locations,
  onSuccess,
}) => {
  const [selectedVariantId, setSelectedVariantId] = useState<string>("");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("1");
  const [unitCost, setUnitCost] = useState<string>("0");
  const [reason, setReason] = useState<string>("Ingreso formal de stock en catálogo");
  const [operationKey, setOperationKey] = useState<string>(() => createStockOperationKey("intake"));

  const [submitting, setSubmitting] = useState<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Ambiguous attempt retention for safe idempotent retry
  const [pendingAttempt, setPendingAttempt] = useState<PendingStockAttempt | null>(null);
  const [showConfirmDiscard, setShowConfirmDiscard] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedVariantId(initialVariantId || (product?.product_variants?.[0]?.id ?? ""));
      setSelectedLocationId(locations[0]?.id ?? "");
      setQuantity("1");
      setUnitCost(product?.base_cost ? product.base_cost.toString() : "0");
      setReason("Ingreso formal de stock en catálogo");
      setOperationKey(createStockOperationKey("intake"));
      setError(null);
      setPendingAttempt(null);
      setShowConfirmDiscard(false);
    }
  }, [isOpen, product, initialVariantId, locations]);

  if (!product) return null;

  const variants = product.product_variants || [];
  const hasVariants = variants.length > 0;
  const currentSummary = calculateStockSummary(
    product.stock_balances,
    hasVariants && selectedVariantId ? selectedVariantId : null,
  );

  const handleClose = () => {
    if (submitting || isSubmittingRef.current) return;
    if (pendingAttempt) {
      setShowConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const handleConfirmDiscard = () => {
    setPendingAttempt(null);
    setShowConfirmDiscard(false);
    onClose();
  };

  const executeIntake = async (payload: ReturnType<typeof buildStockIntakePayload>) => {
    if (isSubmittingRef.current || submitting) return;

    try {
      isSubmittingRef.current = true;
      setSubmitting(true);
      setError(null);

      const { error: rpcErr } = await supabase.rpc("post_stock_document", payload);
      if (rpcErr) throw rpcErr;

      setPendingAttempt(null);
      const line = payload.lines[0];
      const targetLoc = locations.find((l) => l.id === line?.to_location_id);
      const locName = targetLoc?.name ?? "depósito";
      const variantName = hasVariants && line?.variant_id
        ? variants.find((v) => v.id === line.variant_id)?.name ?? "Variante"
        : null;

      const successMsg = variantName
        ? `¡Ingreso asentado! Se agregaron ${line?.quantity} u. a "${product.internal_name} (${variantName})" en ${locName}.`
        : `¡Ingreso asentado! Se agregaron ${line?.quantity} u. a "${product.internal_name}" en ${locName}.`;

      onSuccess(successMsg);
      onClose();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, "Error al registrar movimiento en el ledger de stock");
      setError(msg);
      // Freeze payload and operation_key for safe retry without generating a new key
      setPendingAttempt({ payload, error: msg });
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || submitting) return;

    // If there is already a pending ambiguous attempt, retry sending the exact same payload!
    if (pendingAttempt) {
      await executeIntake(pendingAttempt.payload);
      return;
    }

    setError(null);

    const targetLocation = locations.find((l) => l.id === selectedLocationId);
    if (!targetLocation) {
      setError("Seleccioná una ubicación de depósito válida.");
      return;
    }

    const parseResult = stockIntakeSchema.safeParse({
      productId: product.id,
      variantId: hasVariants ? (selectedVariantId || null) : null,
      branchId: targetLocation.branch_id,
      locationId: targetLocation.id,
      quantity,
      unitCost: unitCost || 0,
      reason,
      operationKey,
    });

    if (!parseResult.success) {
      setError(parseResult.error.issues[0]?.message ?? "Revisá los datos del ingreso de stock.");
      return;
    }

    const payload = buildStockIntakePayload(parseResult.data);
    await executeIntake(payload);
  };

  const isFrozen = submitting || Boolean(pendingAttempt);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Carga Formal de Stock"
      subtitle={`Asentar movimiento de ingreso para ${product.internal_name}`}
      icon={ArrowDownRight}
      maxWidth="560px"
    >
      {showConfirmDiscard ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "4px" }}>
          <div
            className="state-panel"
            role="alert"
            style={{
              borderColor: "var(--amber-accent)",
              background: "var(--amber-soft)",
              padding: "12px 14px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
            }}
          >
            <AlertTriangle size={20} style={{ color: "var(--amber-accent)", flexShrink: 0, marginTop: "2px" }} />
            <div>
              <strong style={{ fontSize: "14px", color: "var(--text-main)" }}>
                ¿Descartar intento con resultado pendiente?
              </strong>
              <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
                Hubo un fallo de red o comunicación previa (clave de operación:{" "}
                <code style={{ fontFamily: "monospace" }}>{pendingAttempt?.payload.operation_key}</code>).
                Si cerrás y abrís una nueva operación con otra clave, el servidor podría asentar ambas si la anterior llegó a registrarse.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "4px" }}>
            <button
              type="button"
              className="pag-btn"
              onClick={() => setShowConfirmDiscard(false)}
            >
              Volver y Reintentar
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ background: "var(--rose-accent)" }}
              onClick={handleConfirmDiscard}
            >
              Descartar de Todas Formas
            </button>
          </div>
        </div>
      ) : (
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
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <AlertCircle size={18} style={{ color: "var(--rose-accent)", flexShrink: 0 }} />
                <span style={{ fontSize: "13px", color: "var(--rose-accent)", fontWeight: 600 }}>
                  {error}
                </span>
              </div>
              {pendingAttempt && (
                <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "26px" }}>
                  La operación quedó congelada para reintento seguro con la misma clave de idempotencia (
                  <code style={{ fontFamily: "monospace" }}>{pendingAttempt.payload.operation_key}</code>
                  ). No se generará una clave nueva.
                </span>
              )}
            </div>
          )}

          {/* Product / Balance Summary Card */}
          <div
            style={{
              padding: "12px",
              background: "var(--surface-subtle)",
              borderRadius: "8px",
              border: "1px solid var(--border-line)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>
                Código: <strong style={{ fontFamily: "monospace" }}>{product.internal_code}</strong>
              </span>
              <strong style={{ fontSize: "14px", color: "var(--text-main)" }}>
                {product.internal_name}
              </strong>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>
                Disponible actual
              </span>
              <strong style={{ fontSize: "15px", color: "var(--brand-primary)" }}>
                {currentSummary.available} u.
              </strong>
              {currentSummary.reserved > 0 && (
                <span style={{ fontSize: "10px", color: "var(--amber-accent)", display: "block" }}>
                  ({currentSummary.reserved} res.)
                </span>
              )}
            </div>
          </div>

          {/* Variant Selection if available */}
          {hasVariants && (
            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="stock-variant-select">
                Variante de Color / Combinación *
              </label>
              <select
                id="stock-variant-select"
                className="erp-form-select"
                disabled={isFrozen}
                value={selectedVariantId}
                onChange={(e) => setSelectedVariantId(e.target.value)}
                required
              >
                {variants.map((v) => {
                  const vSummary = calculateStockSummary(product.stock_balances, v.id);
                  return (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.code}) — {vSummary.available} u. disponibles
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Location Selector */}
          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="stock-location-select">
              Ubicación / Depósito de Ingreso *
            </label>
            <select
              id="stock-location-select"
              className="erp-form-select"
              disabled={isFrozen}
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              required
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name} ({loc.code}) {loc.allows_sale ? "• Habilitada p/ Venta" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="erp-form-row">
            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="stock-quantity-input">
                Cantidad a Ingresar *
              </label>
              <input
                id="stock-quantity-input"
                type="number"
                min="1"
                step="1"
                required
                disabled={isFrozen}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="erp-form-input"
              />
            </div>

            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="stock-unit-cost-input">
                Costo Unitario de Adquisición ($ ARS)
              </label>
              <input
                id="stock-unit-cost-input"
                type="number"
                min="0"
                step="0.01"
                disabled={isFrozen}
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="stock-reason-input">
              Motivo de Auditoría *
            </label>
            <input
              id="stock-reason-input"
              type="text"
              required
              minLength={3}
              maxLength={240}
              disabled={isFrozen}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="erp-form-input"
            />
          </div>

          {/* Audit safety note */}
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
            <Package size={14} />
            <span>
              El stock se asienta formalmente en el ledger de movimientos del ERP con control de concurrencia e idempotencia.
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
              {pendingAttempt ? "Cancelar / Descartar" : "Cancelar"}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> {pendingAttempt ? "Reintentando…" : "Registrando…"}
                </>
              ) : pendingAttempt ? (
                <>
                  <RefreshCw size={14} /> Reintentar Operación
                </>
              ) : (
                "Confirmar Ingreso"
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};
