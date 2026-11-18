import type { StockIntakeInput } from "./sheetSchema";

export interface DbVariantIdentifier {
  id?: string;
  kind: string;
  value: string;
  is_primary?: boolean;
  is_active?: boolean;
}

/**
 * Returns the active primary barcode (or first active barcode) from variant identifiers.
 * If no active barcode exists, returns empty string.
 */
export function getActiveBarcode(identifiers?: DbVariantIdentifier[]): string {
  if (!identifiers || identifiers.length === 0) return "";
  const activeBarcodes = identifiers.filter(
    (pi) => pi.kind === "barcode" && pi.is_active !== false,
  );
  if (activeBarcodes.length === 0) return "";
  const primary = activeBarcodes.find((pi) => pi.is_primary);
  return (primary || activeBarcodes[0]).value;
}

export interface DbProductVariant {
  id: string;
  code: string;
  name: string;
  color_id?: string | null;
  attributes?: Record<string, unknown>;
  price_delta: number;
  final_price_ars?: number | null;
  is_active: boolean;
  product_identifiers?: DbVariantIdentifier[];
}

export interface DbStockBalance {
  quantity_on_hand: number;
  quantity_reserved: number;
  variant_id: string | null;
  location_id?: string;
  locations?: { name: string; branch_id: string } | null;
}

export interface DbCatalogProduct {
  id: string;
  internal_code: string;
  internal_name: string;
  public_name: string | null;
  public_description?: string | null;
  sheet_template?: "celular" | "accesorio" | "funda";
  web_status?: "draft" | "published" | "paused";
  tags?: string[];
  condition?: "nuevo" | "usado" | "reacondicionado" | null;
  capacity?: string | null;
  media_initialized?: boolean;
  sheet_fields_initialized?: boolean;
  base_sale_price: number;
  base_cost?: number;
  tax_rate_percent: number;
  is_active: boolean;
  item_kind: string;
  inventory_tracking: string;
  created_at: string;
  updated_at?: string;
  category_id?: string | null;
  brand_id?: string | null;
  model_id?: string | null;
  product_categories?: { name: string } | null;
  brands?: { name: string } | null;
  product_models?: { name: string } | null;
  product_variants?: DbProductVariant[];
  stock_balances?: DbStockBalance[];
}

export interface MasterCategory {
  id: string;
  code: string;
  name: string;
}

export interface MasterBrand {
  id: string;
  code: string;
  name: string;
}

export interface MasterModel {
  id: string;
  brand_id: string;
  code: string;
  name: string;
}

export interface MasterLocation {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  allows_sale: boolean;
  is_active: boolean;
}

/**
 * Safely extracts an error message from Supabase/PostgREST error objects,
 * standard Error instances, or plain strings without falling back to generic text.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === "string" && err.trim().length > 0) return err.trim();
  if (typeof err === "object") {
    const candidate = err as {
      message?: unknown;
      error_description?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    if (typeof candidate.message === "string" && candidate.message.trim().length > 0) {
      return candidate.message.trim();
    }
    if (typeof candidate.error_description === "string" && candidate.error_description.trim().length > 0) {
      return candidate.error_description.trim();
    }
    if (typeof candidate.details === "string" && candidate.details.trim().length > 0) {
      return candidate.details.trim();
    }
    if (typeof candidate.hint === "string" && candidate.hint.trim().length > 0) {
      return candidate.hint.trim();
    }
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message.trim();
  }
  return fallback;
}

/**
 * Creates an idempotency key for stock movements.
 */
export function createStockOperationKey(kind: "intake" | "adjustment" = "intake"): string {
  return `cat-stock-${kind}-${crypto.randomUUID()}`;
}

/**
 * Build payload for erp.post_stock_document RPC.
 * Document kind is "adjustment" for stock intake/correction.
 */
export function buildStockIntakePayload(input: StockIntakeInput) {
  return {
    document_kind: "adjustment" as const,
    target_branch_id: input.branchId,
    operation_key: input.operationKey,
    operation_reason: input.reason.trim(),
    lines: [
      {
        product_id: input.productId,
        variant_id: input.variantId || null,
        quantity: input.quantity,
        unit_cost: input.unitCost,
        from_location_id: null,
        to_location_id: input.locationId,
      },
    ],
  };
}

/**
 * Calculates stock balance summary (on-hand, reserved, available).
 * Invariant: Available stock = Math.max(0, onHand - reserved).
 * Aggregates across all locations and handles variant vs parent granularity.
 */
export function calculateStockSummary(
  balances: DbStockBalance[] | undefined,
  variantId?: string | null,
): { onHand: number; reserved: number; available: number } {
  if (!balances || balances.length === 0) {
    return { onHand: 0, reserved: 0, available: 0 };
  }

  const filtered =
    variantId !== undefined
      ? balances.filter((b) => (variantId === null ? b.variant_id === null : b.variant_id === variantId))
      : balances;

  const onHand = filtered.reduce((acc, b) => acc + (Number(b.quantity_on_hand) || 0), 0);
  const reserved = filtered.reduce((acc, b) => acc + (Number(b.quantity_reserved) || 0), 0);
  const available = filtered.reduce(
    (acc, b) => acc + Math.max(0, (Number(b.quantity_on_hand) || 0) - (Number(b.quantity_reserved) || 0)),
    0,
  );

  return { onHand, reserved, available };
}
