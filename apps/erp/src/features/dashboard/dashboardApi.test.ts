import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { fetchDashboardMetrics, type DashboardMetrics } from "./dashboardApi";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: { rpc: rpcMock } }));

const range = { date_from: "2026-11-01", date_to: "2026-11-18" };
const emptyMetrics: DashboardMetrics = {
  can_view_sales: true,
  sales: { total_ars: 0, pos_ars: 0, web_ars: 0, repairs_ars: 0, pos_count: 0, web_count: 0, repairs_count: 0 },
  series: [],
  products_active_count: 0,
  inventory: { sellable_units: 0, value_at_sale_price_ars: 0 },
  low_stock: [],
  active_repairs_count: 0,
};

describe("fetchDashboardMetrics", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("envía el rango sin target_branch_id cuando no se indica sucursal", async () => {
    rpcMock.mockResolvedValue({ data: emptyMetrics, error: null });
    await expect(fetchDashboardMetrics(range)).resolves.toEqual(emptyMetrics);
    expect(rpcMock).toHaveBeenCalledExactlyOnceWith("get_dashboard_metrics", range);
  });

  it("envía target_branch_id cuando se indica una sucursal", async () => {
    rpcMock.mockResolvedValue({ data: emptyMetrics, error: null });
    await expect(fetchDashboardMetrics(range, "branch-1")).resolves.toEqual(emptyMetrics);
    expect(rpcMock).toHaveBeenCalledExactlyOnceWith("get_dashboard_metrics", { ...range, target_branch_id: "branch-1" });
  });

  it.each([
    { ...emptyMetrics, can_view_sales: "yes" },
    { ...emptyMetrics, sales: { ...emptyMetrics.sales, total_ars: Infinity } },
    { ...emptyMetrics, inventory: { ...emptyMetrics.inventory, sellable_units: "5" } },
    { ...emptyMetrics, series: {} },
    { ...emptyMetrics, series: [{ day: "2026-02-30", pos_ars: 0, web_ars: 0, repairs_ars: 0, repairs_opened: 0 }] },
    { ...emptyMetrics, low_stock: null },
  ])("rechaza respuestas con campos inválidos (%#)", async (data) => {
    rpcMock.mockResolvedValue({ data, error: null });
    await expect(fetchDashboardMetrics(range)).rejects.toBeInstanceOf(ZodError);
  });

  it("conserva el error de Supabase para traducirlo en la pantalla", async () => {
    const error = { code: "PGRST301", message: "JWT expired" };
    rpcMock.mockResolvedValue({ data: null, error });
    await expect(fetchDashboardMetrics(range)).rejects.toBe(error);
  });
});
