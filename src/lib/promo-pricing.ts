export type StorefrontPromotionPrice = {
  product_id: string;
  variant_id: string | null;
  list_price: number;
  effective_price: number;
  promotion_id: string | null;
  promotion_ends_at: string | null;
};

export type ResolveDisplayPriceInput = {
  productId: string;
  variantId?: string | null;
  legacyPrice: number;
  legacyOriginalPrice?: number | null;
  legacySaleExpiresAt?: string | null;
};

export type ResolvedDisplayPrice = {
  price: number;
  originalPrice: number | null;
  saleExpiresAt: string | null;
  source: "erp" | "legacy";
};

function buildPromotionPriceKey(productId: string, variantId?: string | null): string {
  return `${productId}:${variantId ?? "base"}`;
}

export function indexPromotionPrices(
  rows: readonly StorefrontPromotionPrice[],
): Map<string, StorefrontPromotionPrice> {
  const index = new Map<string, StorefrontPromotionPrice>();
  for (const row of rows) {
    index.set(buildPromotionPriceKey(row.product_id, row.variant_id), row);
  }
  return index;
}

export function resolveDisplayPrice(
  input: ResolveDisplayPriceInput,
  index: ReadonlyMap<string, StorefrontPromotionPrice> | null | undefined,
): ResolvedDisplayPrice {
  const legacyResult: ResolvedDisplayPrice = {
    price: input.legacyPrice,
    originalPrice: input.legacyOriginalPrice ?? null,
    saleExpiresAt: input.legacySaleExpiresAt ?? null,
    source: "legacy",
  };

  if (!index) {
    return legacyResult;
  }

  const variantRow = input.variantId
    ? index.get(buildPromotionPriceKey(input.productId, input.variantId))
    : undefined;
  const row = variantRow ?? index.get(buildPromotionPriceKey(input.productId, null));

  if (!row || row.promotion_id == null) {
    return legacyResult;
  }

  return {
    price: row.effective_price,
    originalPrice: row.list_price > row.effective_price ? row.list_price : null,
    saleExpiresAt: row.promotion_ends_at ?? null,
    source: "erp",
  };
}
