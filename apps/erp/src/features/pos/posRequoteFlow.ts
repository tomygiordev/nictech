import { formatCurrency } from "../../lib/formatters";
import { ERP_BASE_CURRENCY } from "./schemas";
import {
  syncCartWithCatalog,
  CatalogProductForSync,
  CartItemToSync,
  PriceChangeReport,
  SyncCartResult,
} from "./pricing";

export interface PosRequoteSuccess<T extends CartItemToSync> {
  status: "success";
  updatedCart: T[];
  hasChanges: boolean;
  changes: PriceChangeReport[];
  newTotalArs: number;
  message: string;
  staleQuoteDetected: false;
}

export interface PosRequoteError<T extends CartItemToSync> {
  status: "error";
  error: string;
  reason: "fetch_failed" | "product_missing" | "variant_missing" | "price_out_of_range" | "validation_failed";
  cart: T[];
  staleQuoteDetected: true;
}

export type PosRequoteFlowResult<T extends CartItemToSync> =
  | PosRequoteSuccess<T>
  | PosRequoteError<T>;

export interface ExecutePosRequoteFlowParams<T extends CartItemToSync> {
  cart: T[];
  fetchCatalog:
    | (() => Promise<CatalogProductForSync[] | null>)
    | Promise<CatalogProductForSync[] | null>
    | CatalogProductForSync[];
}

/**
 * Shared asynchronous POS requote controller.
 *
 * Guarantees:
 * 1. Synchronizes strictly against the freshly fetched catalog array, bypassing any stale closures.
 * 2. On network failure, rejection, or null fetch result: preserves original cart, retains stale alert,
 *    and returns an explicit error without attempting sale creation or emitting false success.
 * 3. If any product or variant in the cart is missing from the fresh catalog or marked isPriceOutOfRange,
 *    blocks requote with a clear message and retains the stale alert.
 * 4. Refreshes availableStock even when prices and tax rates match.
 * 5. Does not convert invalid items to price 0 or fallback to parent product price when variant is missing.
 */
export async function executePosRequoteFlow<T extends CartItemToSync>(
  params: ExecutePosRequoteFlowParams<T>,
): Promise<PosRequoteFlowResult<T>> {
  const { cart, fetchCatalog } = params;

  let freshCatalog: CatalogProductForSync[] | null = null;
  try {
    const candidate = typeof fetchCatalog === "function" ? fetchCatalog() : fetchCatalog;
    freshCatalog = await candidate;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error de red al actualizar el catálogo vigente";
    return {
      status: "error",
      error: msg,
      reason: "fetch_failed",
      cart,
      staleQuoteDetected: true,
    };
  }

  if (!freshCatalog) {
    return {
      status: "error",
      error: "No se pudo actualizar el catálogo vigente desde el servidor. Se conserva el carrito actual.",
      reason: "fetch_failed",
      cart,
      staleQuoteDetected: true,
    };
  }

  const syncResult: SyncCartResult<T> = syncCartWithCatalog(cart, freshCatalog);

  if (!syncResult.isValid) {
    return {
      status: "error",
      error: syncResult.error || "No se pudo sincronizar el carrito con el catálogo vigente.",
      reason: syncResult.errorReason || "validation_failed",
      cart,
      staleQuoteDetected: true,
    };
  }

  let message = "";
  if (syncResult.hasChanges) {
    const changesDesc = syncResult.changes
      .map(
        (c) =>
          `${c.displayName}: $${c.oldPrice} -> $${c.newPrice}${
            c.taxChanged ? ` (IVA: ${c.oldTaxRate}% -> ${c.newTaxRate}%)` : ""
          }`,
      )
      .join(", ");
    message = `Precios sincronizados: ${changesDesc}. Total nuevo: ${formatCurrency(
      syncResult.newTotalArs,
      ERP_BASE_CURRENCY,
    )}. Revise el carrito y confirme la venta.`;
  } else {
    message = `Los precios del carrito ya coinciden con el catálogo vigente. Total: ${formatCurrency(
      syncResult.newTotalArs,
      ERP_BASE_CURRENCY,
    )}. Puede confirmar la venta.`;
  }

  return {
    status: "success",
    updatedCart: syncResult.updatedCart,
    hasChanges: syncResult.hasChanges,
    changes: syncResult.changes,
    newTotalArs: syncResult.newTotalArs,
    message,
    staleQuoteDetected: false,
  };
}
