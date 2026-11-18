import { z } from "zod";
import { supabase } from "../../lib/supabase";
import type { Database } from "../../types/supabase";

const amount = z.number().finite();
const count = z.number().finite().int().nonnegative();
const dailyMetrics = z.object({
  day: z.string().date(),
  pos_ars: amount,
  web_ars: amount,
  repairs_ars: amount,
  repairs_opened: count,
});

const dashboardMetrics = z.object({
  can_view_sales: z.boolean(),
  sales: z.object({
    pos_ars: amount,
    web_ars: amount,
    repairs_ars: amount,
    total_ars: amount,
    pos_count: count,
    web_count: count,
    repairs_count: count,
  }),
  series: z.array(dailyMetrics),
  products_active_count: count,
  inventory: z.object({
    sellable_units: amount,
    value_at_sale_price_ars: amount,
  }),
  low_stock: z.array(z.object({
    product_id: z.string().uuid(),
    name: z.string(),
    available: amount,
  })),
  active_repairs_count: count,
});

export type DashboardMetrics = z.infer<typeof dashboardMetrics>;
type RpcArgs = Database["erp"]["Functions"]["get_dashboard_metrics"]["Args"];
export type DashboardRange = Omit<RpcArgs, "target_branch_id">;

export async function fetchDashboardMetrics(range: DashboardRange, branchId?: string): Promise<DashboardMetrics> {
  const { data, error } = await supabase.rpc(
    "get_dashboard_metrics",
    branchId ? { ...range, target_branch_id: branchId } : range,
  );
  if (error) throw error;
  return dashboardMetrics.parse(data);
}
