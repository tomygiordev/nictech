import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { getCatalogKpis } from "./catalogKpisApi";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ supabase: { rpc } }));

const filters = {
  search_text: "cable",
  target_category_id: "c84b3d36-0e9e-44f1-86c8-509b01c27111",
  include_inactive: true,
};
const totals = { total_products: 120, stock_value_ars: 1450025.75, low_stock_count: 0, out_of_stock_count: 11 };

beforeEach(() => rpc.mockReset());

describe("getCatalogKpis", () => {
  it("envía los tres filtros y valida los totales JSON de la RPC", async () => {
    rpc.mockResolvedValue({ data: totals, error: null });

    await expect(getCatalogKpis(filters)).resolves.toEqual(totals);
    expect(rpc).toHaveBeenCalledWith("get_catalog_kpis", filters);
  });

  it.each([null, {}, { ...totals, stock_value_ars: "1450025.75" }, { ...totals, low_stock_count: -1 }])(
    "rechaza una respuesta que no cumple el contrato: %j",
    async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      await expect(getCatalogKpis(filters)).rejects.toBeInstanceOf(ZodError);
    },
  );

  it("conserva el error original para que el consumidor lo traduzca", async () => {
    const error = { code: "42501", message: "catalog.view permission required" };
    rpc.mockResolvedValue({ data: null, error });

    await expect(getCatalogKpis(filters)).rejects.toBe(error);
  });
});
