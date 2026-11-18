import { z } from "zod";
import { supabase } from "../../lib/supabase";

const catalogKpisSchema = z.object({
  total_products: z.number().int().nonnegative(),
  stock_value_ars: z.number().finite(),
  low_stock_count: z.number().int().nonnegative(),
  out_of_stock_count: z.number().int().nonnegative(),
});

export type CatalogKpis = z.infer<typeof catalogKpisSchema>;

export interface CatalogFilters {
  search_text?: string;
  target_category_id?: string;
  include_inactive: boolean;
}

export async function getCatalogKpis(filters: CatalogFilters): Promise<CatalogKpis> {
  const { data, error } = await supabase.rpc("get_catalog_kpis", filters);
  if (error) throw error;
  return catalogKpisSchema.parse(data);
}
