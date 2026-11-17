import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StockWorkspace } from "./StockWorkspace";

const mock = vi.hoisted(() => ({ queries: [] as Array<{ table: string; filters: string[] }> }));
vi.mock("../../lib/supabase", () => ({ supabase: {
  from: (table: string) => {
    const query = { table, filters: [] as string[] };
    const chain = {
      select: () => { mock.queries.push(query); return chain; },
      eq: (key: string, value: unknown) => { query.filters.push(`${key}=${String(value)}`); return chain; },
      order: () => chain,
      limit: () => chain,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
    };
    return chain;
  },
} }));
beforeEach(() => { mock.queries = []; });
afterEach(cleanup);
describe("existencias", () => {
  it("incluye inactivos solo al activar el filtro", async () => {
    render(<StockWorkspace />);
    await waitFor(() => expect(mock.queries.some((q) => q.table === "stock_balances" && q.filters.includes("products.is_active=true"))).toBe(true));
    const previous = mock.queries.filter((q) => q.table === "stock_balances").length;
    fireEvent.click(screen.getByLabelText("Ver inactivos"));
    await waitFor(() => expect(mock.queries.filter((q) => q.table === "stock_balances").length).toBeGreaterThan(previous));
    const balances = mock.queries.filter((q) => q.table === "stock_balances");
    expect(balances[balances.length - 1].filters).not.toContain("products.is_active=true");
  });
});
