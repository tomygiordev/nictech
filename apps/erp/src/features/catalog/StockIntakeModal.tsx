import React, { useState, useEffect, useRef } from "react";
import { ArrowDownRight, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import type { z } from "zod";
import { Field, FormError } from "../../components/erp/FormFeedback";
import { Modal } from "../../components/erp/WorkspaceUi";
import { toUserMessage } from "../../lib/errors";
import { supabase } from "../../lib/supabase";
import {
  type DbCatalogProduct,
  type MasterLocation,
  buildStockIntakePayload,
  createStockOperationKey,
  calculateStockSummary,
} from "./schemas";
import { getSellableLocations, isZeroStockCost, stockIntakeSchema } from "./sheetSchema";

export interface StockIntakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: DbCatalogProduct | null;
  initialVariantId?: string | null;
  locations: MasterLocation[];
  onSuccess: (message: string) => void;
}

type StockPayload = ReturnType<typeof buildStockIntakePayload>;
type StockFieldErrors = z.inferFlattenedErrors<typeof stockIntakeSchema>["fieldErrors"];

export const StockIntakeModal: React.FC<StockIntakeModalProps> = ({
  isOpen,
  onClose,
  product,
  initialVariantId = null,
  locations,
  onSuccess,
}) => {
  const [selectedVariantId, setSelectedVariantId] = useState<string>("");
  const [chosenLocationId, setChosenLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [confirmZeroCost, setConfirmZeroCost] = useState(false);
  const [reason, setReason] = useState("Ingreso de stock de catálogo");
  const [operationKey, setOperationKey] = useState<string>(() => createStockOperationKey("intake"));

  const [submitting, setSubmitting] = useState<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<StockFieldErrors>({});

  // Ambiguous attempt retention for safe idempotent retry
  const [pendingAttempt, setPendingAttempt] = useState<StockPayload | null>(null);
  const [showConfirmDiscard, setShowConfirmDiscard] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedVariantId(initialVariantId || (product?.product_variants?.length === 1 ? product.product_variants[0].id : ""));
      setChosenLocationId("");
      setQuantity("");
      setUnitCost("");
      setConfirmZeroCost(false);
      setReason("Ingreso de stock de catálogo");
      setOperationKey(createStockOperationKey("intake"));
      setError(null);
      setFieldErrors({});
      setPendingAttempt(null);
      setShowConfirmDiscard(false);
    }
  }, [isOpen, product, initialVariantId]);

  if (!product) return null;

  const variants = product.product_variants || [];
  const sellableLocations = getSellableLocations(locations);
  const targetLocation = sellableLocations.find((location) => location.id === chosenLocationId)
    ?? (sellableLocations.length === 1 ? sellableLocations[0] : undefined);
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

  const executeIntake = async (payload: StockPayload) => {
    if (isSubmittingRef.current || submitting) return;

    try {
      isSubmittingRef.current = true;
      setSubmitting(true);
      setError(null);

      const { error: rpcErr } = await supabase.rpc("post_stock_document", payload);
      if (rpcErr) throw rpcErr;

      setPendingAttempt(null);
      const [line] = payload.lines;
      const targetLoc = locations.find((l) => l.id === line.to_location_id);
      const locName = targetLoc?.name ?? "depósito";
      const variantName = hasVariants && line.variant_id
        ? variants.find((v) => v.id === line.variant_id)?.name ?? "Variante"
        : null;

      const successMsg = variantName
        ? `Ingreso registrado. Se agregaron ${line.quantity} u. a "${product.internal_name} (${variantName})" en ${locName}.`
        : `Ingreso registrado. Se agregaron ${line.quantity} u. a "${product.internal_name}" en ${locName}.`;

      onSuccess(successMsg);
      onClose();
    } catch (err: unknown) {
      const msg = toUserMessage(err, "No se pudo registrar el ingreso. Reintentá.");
      setError(msg);
      // Freeze payload and operation_key for safe retry without generating a new key
      setPendingAttempt(payload);
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
      await executeIntake(pendingAttempt);
      return;
    }

    setError(null);

    const parseResult = stockIntakeSchema.safeParse({
      productId: product.id,
      variantId: hasVariants ? (selectedVariantId || null) : null,
      branchId: targetLocation?.branch_id ?? "",
      locationId: targetLocation?.id ?? "",
      quantity,
      unitCost,
      confirmZeroCost,
      reason,
      operationKey,
    });

    if (!parseResult.success) {
      const { fieldErrors } = parseResult.error.flatten();
      if (hasVariants && !selectedVariantId) {
        fieldErrors.variantId = ["Elegí una variante."];
      }
      setFieldErrors(fieldErrors);
      if (!fieldErrors.locationId && (fieldErrors.branchId || fieldErrors.productId || fieldErrors.operationKey)) {
        setError("No se pudo preparar el ingreso. Cerrá la ventana y volvé a abrirla.");
      }
      return;
    }

    if (hasVariants && !selectedVariantId) {
      setFieldErrors({ variantId: ["Elegí una variante."] });
      return;
    }

    setFieldErrors({});
    const payload = buildStockIntakePayload(parseResult.data);
    await executeIntake(payload);
  };

  const isFrozen = submitting || Boolean(pendingAttempt);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Cargar stock"
      subtitle={`Registrá un ingreso para ${product.internal_name}`}
      icon={ArrowDownRight}
      maxWidth="560px"
      scrollBody
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
                No pudimos verificar si se registró el ingreso. Reintentá desde esta ventana para evitar cargar el mismo stock dos veces.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "4px" }}>
            <button
              type="button"
              className="pag-btn"
              onClick={() => setShowConfirmDiscard(false)}
            >
              Volver y reintentar
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ background: "var(--rose-accent)" }}
              onClick={handleConfirmDiscard}
            >
              Descartar de todas formas
            </button>
          </div>
        </div>
      ) : (
        <form noValidate onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
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

          {hasVariants && (
            <Field label="Variante" required error={fieldErrors.variantId?.[0]}>
              {(a11y) => (
                <select
                  {...a11y}
                  className="erp-form-select"
                  disabled={isFrozen}
                  value={selectedVariantId}
                  onChange={(e) => {
                    setSelectedVariantId(e.target.value);
                    setFieldErrors((errors) => ({ ...errors, variantId: undefined }));
                  }}
                  required
                >
                  <option value="">Elegí una variante…</option>
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.code}) · {calculateStockSummary(product.stock_balances, v.id).available} u. disponibles
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          <Field
            label="Ubicación de ingreso"
            required
            error={fieldErrors.locationId?.[0]}
            hint={!sellableLocations.length ? "No hay ubicaciones activas habilitadas para venta." : null}
          >
            {(a11y) => (
              <select
                {...a11y}
                className="erp-form-select"
                disabled={isFrozen}
                value={targetLocation?.id ?? ""}
                onChange={(e) => setChosenLocationId(e.target.value)}
                required
              >
                <option value="" disabled>Elegí una ubicación…</option>
                {sellableLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name} ({loc.code})</option>
                ))}
              </select>
            )}
          </Field>

          <div className="erp-form-row">
            <Field label="Cantidad a ingresar" required error={fieldErrors.quantity?.[0]}>
              {(a11y) => (
                <input
                  {...a11y}
                  type="number"
                  min="1"
                  step="1"
                  required
                  disabled={isFrozen}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="erp-form-input"
                />
              )}
            </Field>
            <Field label="Costo unitario (ARS)" required error={fieldErrors.unitCost?.[0]}>
              {(a11y) => (
                <input
                  {...a11y}
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  disabled={isFrozen}
                  value={unitCost}
                  onChange={(e) => {
                    setUnitCost(e.target.value);
                    setConfirmZeroCost(false);
                    setFieldErrors((errors) => ({ ...errors, confirmZeroCost: undefined }));
                  }}
                  className="erp-form-input"
                />
              )}
            </Field>
          </div>

          {isZeroStockCost(unitCost) && (
            <Field label="Confirmo que el costo es cero" error={fieldErrors.confirmZeroCost?.[0]}>
              {(a11y) => (
                <input
                  {...a11y}
                  type="checkbox"
                  required
                  disabled={isFrozen}
                  checked={confirmZeroCost}
                  onChange={(e) => {
                    setConfirmZeroCost(e.target.checked);
                    setFieldErrors((errors) => ({ ...errors, confirmZeroCost: undefined }));
                  }}
                  style={{ alignSelf: "flex-start" }}
                />
              )}
            </Field>
          )}

          <Field label="Motivo del ingreso" required error={fieldErrors.reason?.[0]}>
            {(a11y) => (
              <input
                {...a11y}
                type="text"
                required
                minLength={3}
                maxLength={240}
                disabled={isFrozen}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="erp-form-input"
              />
            )}
          </Field>

          <FormError message={error} />

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
                  <RefreshCw size={14} /> Reintentar ingreso
                </>
              ) : (
                "Confirmar ingreso"
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};
