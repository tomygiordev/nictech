import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { storefrontSupabase } from "@/integrations/supabase/types.extensions";
import {
  indexPromotionPrices,
  type StorefrontPromotionPrice,
} from "@/lib/promo-pricing";

const PROMOTION_PRICES_STALE_TIME_MS = 60_000;
const PROMOTION_PRICE_SELECT_COLUMNS =
  "product_id, variant_id, list_price, effective_price, promotion_id, promotion_ends_at";

const finiteNumberSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
  z.number().finite(),
);

const storefrontPromotionPriceRowSchema = z.object({
  product_id: z.string(),
  variant_id: z.string().nullable(),
  list_price: finiteNumberSchema,
  effective_price: finiteNumberSchema,
  promotion_id: z.string().nullable(),
  promotion_ends_at: z.string().nullable(),
});

const storefrontPromotionPriceRowsSchema = z.array(storefrontPromotionPriceRowSchema);

let hasWarnedPromotionPricesError = false;

function warnOnce(message: string, detail: unknown): void {
  if (hasWarnedPromotionPricesError) {
    return;
  }
  hasWarnedPromotionPricesError = true;
  console.warn(message, detail);
}

async function fetchStorefrontPromotionPrices(
  sortedProductIds: readonly string[],
): Promise<Map<string, StorefrontPromotionPrice> | null> {
  try {
    const { data, error } = await storefrontSupabase
      .from("storefront_promotion_prices")
      .select(PROMOTION_PRICE_SELECT_COLUMNS)
      .in("product_id", [...sortedProductIds]);

    if (error) {
      warnOnce(
        "[storefront_promotion_prices] No se pudieron leer precios promocionales; se usan precios legacy.",
        error,
      );
      return null;
    }

    const parsed = storefrontPromotionPriceRowsSchema.safeParse(data ?? []);
    if (!parsed.success) {
      warnOnce(
        "[storefront_promotion_prices] Respuesta inválida; se usan precios legacy.",
        parsed.error.flatten(),
      );
      return null;
    }

    const rows: StorefrontPromotionPrice[] = parsed.data.map((row) => ({
      product_id: row.product_id,
      variant_id: row.variant_id ?? null,
      list_price: row.list_price,
      effective_price: row.effective_price,
      promotion_id: row.promotion_id ?? null,
      promotion_ends_at: row.promotion_ends_at ?? null,
    }));

    return indexPromotionPrices(rows);
  } catch (err) {
    warnOnce(
      "[storefront_promotion_prices] Error inesperado; se usan precios legacy.",
      err,
    );
    return null;
  }
}

export type UseStorefrontPromotionPricesResult = {
  index: Map<string, StorefrontPromotionPrice> | null;
  isLoading: boolean;
  isFetching: boolean;
};

export function useStorefrontPromotionPrices(
  productIds: readonly string[],
): UseStorefrontPromotionPricesResult {
  const uniqueSortedIdsKey = Array.from(
    new Set(productIds.filter((id): id is string => typeof id === "string" && id.length > 0)),
  )
    .sort()
    .join("\0");

  const sortedProductIds = useMemo(
    () => (uniqueSortedIdsKey ? uniqueSortedIdsKey.split("\0") : []),
    [uniqueSortedIdsKey],
  );

  const query = useQuery({
    queryKey: ["storefront-promotion-prices", sortedProductIds],
    queryFn: () => fetchStorefrontPromotionPrices(sortedProductIds),
    enabled: sortedProductIds.length > 0,
    staleTime: PROMOTION_PRICES_STALE_TIME_MS,
    retry: false,
  });

  return {
    index: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  };
}
