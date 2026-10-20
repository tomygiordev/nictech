import { z } from "zod";

export interface DbVariantIdentifier {
  kind: string;
  value: string;
}

export interface DbProductVariant {
  id: string;
  code: string;
  name: string;
  attributes?: Record<string, unknown>;
  price_delta: number;
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
  base_sale_price: number;
  base_cost?: number;
  tax_rate_percent: number;
  is_active: boolean;
  item_kind: string;
  inventory_tracking: string;
  created_at: string;
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
 * Mandatory finite number preprocessor:
 * - Rejects empty string / blanks / null / undefined with required message (does NOT coerce to 0).
 * - Rejects NaN, Infinity, -Infinity.
 * - Enforces minimum value.
 */
export const numericRequiredFinite = (fieldName: string, min = 0) =>
  z.preprocess(
    (val) => {
      if (val === "" || val === null || val === undefined) return undefined;
      if (typeof val === "string") {
        const trimmed = val.trim();
        if (trimmed === "") return undefined;
        const n = Number(trimmed);
        return isNaN(n) ? val : n;
      }
      return val;
    },
    z
      .number({
        invalid_type_error: `El ${fieldName} debe ser un valor numérico`,
        required_error: `El ${fieldName} es obligatorio`,
      })
      .finite(`El ${fieldName} debe ser un número finito`)
      .min(min, `El ${fieldName} no puede ser menor a ${min}`),
  );

/**
 * Optional finite number preprocessor:
 * - Empty string / blanks / null / undefined default to defaultValue (0).
 * - Rejects NaN, Infinity, -Infinity.
 * - Enforces minimum value.
 */
export const numericOptionalFinite = (fieldName: string, defaultValue = 0, min = 0) =>
  z.preprocess(
    (val) => {
      if (val === "" || val === null || val === undefined) return defaultValue;
      if (typeof val === "string") {
        const trimmed = val.trim();
        if (trimmed === "") return defaultValue;
        const n = Number(trimmed);
        return isNaN(n) ? val : n;
      }
      return val;
    },
    z
      .number({
        invalid_type_error: `El ${fieldName} debe ser un valor numérico`,
      })
      .finite(`El ${fieldName} debe ser un número finito`)
      .min(min, `El ${fieldName} no puede ser menor a ${min}`)
      .default(defaultValue),
  );

/**
 * Integer positive stock quantity preprocessor:
 * - Rejects blanks / null / undefined.
 * - Rejects fractional numbers (e.g. 1.5, 0.2).
 * - Rejects <= 0, NaN, Infinity.
 */
export const numericIntegerStockQuantity = z.preprocess(
  (val) => {
    if (val === "" || val === null || val === undefined) return undefined;
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed === "") return undefined;
      const n = Number(trimmed);
      return isNaN(n) ? val : n;
    }
    return val;
  },
  z
    .number({
      invalid_type_error: "La cantidad debe ser numérica",
      required_error: "La cantidad a ingresar es obligatoria",
    })
    .finite("La cantidad debe ser un número finito")
    .int("La cantidad debe ser un número entero (no se permite stock fraccionario)")
    .positive("La cantidad a ingresar debe ser mayor a 0"),
);

/**
 * Schema for a single variant row in creation/editing forms.
 * Do NOT drop partially-filled variants silently; validate fields strictly.
 */
export const variantRowSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "El color / nombre de la variante es obligatorio"),
  code: z
    .string()
    .trim()
    .min(1, "El código de la variante es obligatorio")
    .max(30, "El código no debe superar 30 caracteres")
    .transform((val) => val.toUpperCase()),
  barcode: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : undefined)),
  sku: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : undefined)),
});

export type VariantRowInput = z.infer<typeof variantRowSchema>;

/**
 * Product creation validation schema.
 * Supports products/fundas with colors/variants, prices (final ARS VAT-inclusive),
 * categories, brands, and models.
 */
export const productCreateSchema = z
  .object({
    internal_code: z
      .string()
      .trim()
      .min(1, "El código interno del artículo es obligatorio")
      .max(60, "El código no debe superar 60 caracteres")
      .transform((val) => val.toUpperCase()),
    internal_name: z
      .string()
      .trim()
      .min(1, "El nombre del artículo es obligatorio")
      .max(250, "El nombre no debe superar 250 caracteres"),
    base_sale_price: numericRequiredFinite("precio final en ARS"),
    base_cost: numericOptionalFinite("costo base", 0),
    category_id: z.string().uuid("Categoría inválida").nullable().optional(),
    brand_id: z.string().uuid("Marca inválida").nullable().optional(),
    model_id: z.string().uuid("Modelo inválido").nullable().optional(),
    has_variants: z.boolean().default(false),
    variants: z.array(variantRowSchema).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.has_variants) {
      if (!data.variants || data.variants.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variants"],
          message: "Debe definir al menos una variante si el artículo tiene variantes activas.",
        });
        return;
      }

      // Check unique variant codes
      const seenCodes = new Set<string>();
      data.variants.forEach((v, idx) => {
        const upperCode = v.code.toUpperCase();
        if (seenCodes.has(upperCode)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["variants", idx, "code"],
            message: `Código de variante duplicado: '${upperCode}'.`,
          });
        }
        seenCodes.add(upperCode);
      });

      // Check unique barcodes if present
      const seenBarcodes = new Set<string>();
      data.variants.forEach((v, idx) => {
        if (v.barcode) {
          if (seenBarcodes.has(v.barcode)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["variants", idx, "barcode"],
              message: `Código de barras duplicado: '${v.barcode}'.`,
            });
          }
          seenBarcodes.add(v.barcode);
        }
      });
    }
  });

export type ProductCreateInput = z.infer<typeof productCreateSchema>;

/**
 * Product update schema.
 * Updates names, price and status safely without touching variants or stock ledger.
 */
export const productUpdateSchema = z.object({
  id: z.string().uuid("ID de producto inválido"),
  internal_name: z
    .string()
    .trim()
    .min(1, "El nombre del artículo es obligatorio")
    .max(250, "El nombre no debe superar 250 caracteres"),
  public_name: z
    .string()
    .trim()
    .max(250, "El nombre público no debe superar 250 caracteres")
    .nullable()
    .optional(),
  base_sale_price: numericRequiredFinite("precio final en ARS"),
  category_id: z.string().uuid("Categoría inválida").nullable().optional(),
  brand_id: z.string().uuid("Marca inválida").nullable().optional(),
  model_id: z.string().uuid("Modelo inválido").nullable().optional(),
  is_active: z.boolean().default(true),
});

export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

/**
 * Stock intake validation schema for formal ERP movements.
 */
export const stockIntakeSchema = z.object({
  productId: z.string().uuid("ID de producto inválido"),
  variantId: z.string().uuid("ID de variante inválido").nullable().optional(),
  branchId: z.string().uuid("ID de sucursal inválido"),
  locationId: z.string().uuid("Debe seleccionar una ubicación de destino válida"),
  quantity: numericIntegerStockQuantity,
  unitCost: numericOptionalFinite("costo unitario", 0),
  reason: z
    .string()
    .trim()
    .min(3, "El motivo de auditoría debe contener al menos 3 caracteres")
    .max(240, "El motivo no debe superar 240 caracteres"),
  operationKey: z.string().min(1, "Clave de idempotencia requerida"),
});

export type StockIntakeInput = z.infer<typeof stockIntakeSchema>;

/**
 * Creates an idempotency key for stock movements.
 */
export function createStockOperationKey(kind: "intake" | "adjustment" = "intake"): string {
  return `cat-stock-${kind}-${crypto.randomUUID()}`;
}

/**
 * Transform validated ProductCreateInput into exact RPC argument payload for
 * erp.create_catalog_product_with_variants(
 *   p_internal_code, p_internal_name, p_item_kind, p_inventory_tracking,
 *   p_category_id, p_brand_id, p_model_id, p_unit_id,
 *   p_base_cost, p_base_sale_price, p_tax_rate_percent, p_variants
 * )
 *
 * Invariant: Variants ALWAYS inherit parent price; price_delta is strictly 0.
 */
export function buildCreateCatalogPayload(data: ProductCreateInput) {
  const variantsPayload = data.has_variants
    ? data.variants.map((v) => ({
        name: v.name.trim(),
        code: v.code.trim().toUpperCase(),
        attributes: { color: v.name.trim() },
        price_delta: 0, // Invariant: inherits parent price
        barcode: v.barcode ? v.barcode.trim() : null,
        sku: v.sku ? v.sku.trim() : null,
      }))
    : [];

  return {
    p_internal_code: data.internal_code.trim().toUpperCase(),
    p_internal_name: data.internal_name.trim(),
    p_item_kind: "product" as const,
    p_inventory_tracking: "quantity" as const,
    p_category_id: data.category_id || undefined,
    p_brand_id: data.brand_id || undefined,
    p_model_id: data.model_id || undefined,
    p_unit_id: undefined,
    p_base_cost: data.base_cost ?? 0,
    p_base_sale_price: data.base_sale_price ?? 0,
    p_tax_rate_percent: 21,
    p_variants: variantsPayload,
  };
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
  const available = Math.max(0, onHand - reserved);

  return { onHand, reserved, available };
}

/**
 * Fiscal breakdown: operator price in ARS is final and includes 21% IVA.
 * Net = round(price / 1.21, 2)
 * IVA = round(price - Net, 2)
 */
export function calculateFiscalBreakdown(finalPriceArs: number, taxRatePercent = 21) {
  if (finalPriceArs <= 0) {
    return { net: 0, tax: 0, total: 0 };
  }
  if (taxRatePercent <= 0) {
    return { net: finalPriceArs, tax: 0, total: finalPriceArs };
  }
  const factor = 1 + taxRatePercent / 100;
  const net = Math.round((finalPriceArs / factor) * 100) / 100;
  const tax = Math.round((finalPriceArs - net) * 100) / 100;
  return { net, tax, total: finalPriceArs };
}
