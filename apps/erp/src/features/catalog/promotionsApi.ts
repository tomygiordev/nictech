import { supabase } from "../../lib/supabase";
import {
  type CatalogProductOption,
  type PromotionRow,
  type PromotionTargetRow,
  type PromotionWithTargets,
  type UpsertPromotionParams,
} from "./promotionsSchema";

interface QueryError {
  message: string;
  code?: string;
}

interface QueryResult<T> {
  data: T | null;
  error: QueryError | null;
}

interface PromotionsQueryChain<T> extends PromiseLike<QueryResult<T>> {
  select: (columns: string) => PromotionsQueryChain<T>;
  eq: (column: string, value: unknown) => PromotionsQueryChain<T>;
  in: (column: string, values: string[]) => PromotionsQueryChain<T>;
  or: (filters: string) => PromotionsQueryChain<T>;
  order: (column: string, options?: { ascending?: boolean }) => PromotionsQueryChain<T>;
  limit: (count: number) => PromotionsQueryChain<T>;
}

interface PromotionsDbClient {
  from: <T>(table: string) => PromotionsQueryChain<T>;
  rpc: <T>(name: string, args: object) => PromiseLike<QueryResult<T>>;
}

const getPromotionsClient = (): PromotionsDbClient => {
  if (!supabase) {
    throw new Error("El ERP no está configurado para conectarse a Supabase.");
  }
  return supabase as unknown as PromotionsDbClient;
};

const formatApiError = (action: string, detail?: string): string =>
  detail ? `${action}: ${detail}` : action;

export const listPromotions = async (): Promise<PromotionWithTargets[]> => {
  const db = getPromotionsClient();
  const [promosRes, targetsRes] = await Promise.all([
    db
      .from<PromotionRow[]>("promotions")
      .select("id, name, kind, value, starts_at, ends_at, is_active, channels, created_at, updated_at")
      .order("created_at", { ascending: false }),
    db
      .from<PromotionTargetRow[]>("promotion_targets")
      .select("promotion_id, product_id, variant_id, is_active"),
  ]);

  if (promosRes.error) {
    throw new Error(formatApiError("No se pudieron cargar las promociones", promosRes.error.message));
  }
  if (targetsRes.error) {
    throw new Error(
      formatApiError("No se pudieron cargar los productos de las promociones", targetsRes.error.message),
    );
  }

  const targetsByPromotion = new Map<string, PromotionTargetRow[]>();
  for (const target of targetsRes.data ?? []) {
    if (!target.is_active) continue;
    const current = targetsByPromotion.get(target.promotion_id) ?? [];
    current.push(target);
    targetsByPromotion.set(target.promotion_id, current);
  }

  return (promosRes.data ?? []).map((promo) => ({
    ...promo,
    targets: targetsByPromotion.get(promo.id) ?? [],
  }));
};

const PRODUCT_SELECT =
  "id, internal_code, internal_name, base_sale_price, is_active, product_variants(id, code, name, is_active)";

export const searchPromotionProducts = async (searchTerm: string): Promise<CatalogProductOption[]> => {
  const db = getPromotionsClient();
  let query = db
    .from<CatalogProductOption[]>("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true);

  const sanitized = searchTerm.trim().replace(/[,()]/g, "");
  if (sanitized) {
    query = query.or(`internal_name.ilike.%${sanitized}%,internal_code.ilike.%${sanitized}%`);
  }

  const { data, error } = await query.order("internal_name", { ascending: true }).limit(20);
  if (error) {
    throw new Error(formatApiError("No se pudieron buscar productos", error.message));
  }
  return data ?? [];
};

export const fetchPromotionProductsByIds = async (
  productIds: string[],
): Promise<CatalogProductOption[]> => {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const db = getPromotionsClient();
  const { data, error } = await db
    .from<CatalogProductOption[]>("products")
    .select(PRODUCT_SELECT)
    .in("id", uniqueIds);

  if (error) {
    throw new Error(formatApiError("No se pudieron cargar los productos seleccionados", error.message));
  }
  return data ?? [];
};

export const upsertPromotion = async (params: UpsertPromotionParams): Promise<string> => {
  const db = getPromotionsClient();
  const { data, error } = await db.rpc<string>("upsert_promotion", params);
  if (error) {
    throw new Error(formatApiError("No se pudo guardar la promoción", error.message));
  }
  if (!data) {
    throw new Error("El servidor no devolvió el identificador de la promoción.");
  }
  return data;
};

export const setPromotionActive = async (id: string, active: boolean): Promise<void> => {
  const db = getPromotionsClient();
  const { error } = await db.rpc<null>("set_promotion_active", {
    p_id: id,
    p_active: active,
  });
  if (error) {
    throw new Error(formatApiError("No se pudo actualizar el estado de la promoción", error.message));
  }
};
