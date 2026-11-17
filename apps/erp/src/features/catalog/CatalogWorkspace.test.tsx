import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CatalogWorkspace } from "./CatalogWorkspace";

const mock = vi.hoisted(() => ({ filters: [] as Array<[string, string, unknown]>, legacy: false, productQueries: 0 }));
vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      let selection = "";
      const chain = {
        select: (value: string) => { selection = value; if (table === "products") mock.productQueries++; return chain; },
        eq: (column: string, value: unknown) => { mock.filters.push([table, column, value]); return chain; },
        order: () => chain,
        range: () => chain,
        or: (value: string) => { mock.filters.push([table, "or", value]); return chain; },
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
          const error = table === "products" && mock.legacy && selection.includes("sheet_template")
            ? { code: "42703", message: "missing" } : null;
          return Promise.resolve({ data: [], error, count: 0 }).then(resolve, reject);
        },
      };
      return chain;
    },
  },
}));

beforeEach(() => { mock.filters = []; mock.legacy = false; mock.productQueries = 0; });
afterEach(cleanup);
describe("listado de catálogo", () => {
  it("oculta inactivos por defecto y permite incluirlos", async () => {
    render(<CatalogWorkspace />);
    await waitFor(() => expect(mock.filters).toContainEqual(["products", "is_active", true]));
    mock.filters = [];
    const previousQueries = mock.productQueries;
    fireEvent.click(screen.getByLabelText("Ver inactivos"));
    await waitFor(() => expect(mock.productQueries).toBeGreaterThan(previousQueries));
    await screen.findByText("Catálogo Oficial ERP");
    expect(mock.filters).not.toContainEqual(["products", "is_active", true]);
  });
  it("quita caracteres que rompen el filtro de búsqueda", async () => {
    render(<CatalogWorkspace />);
    fireEvent.change(screen.getByPlaceholderText("Buscar por código o nombre..."), {
      target: { value: "funda,(azul)" },
    });
    await waitFor(() => expect(mock.filters).toContainEqual([
      "products",
      "or",
      "internal_name.ilike.%fundaazul%,internal_code.ilike.%fundaazul%",
    ]));
  });
  it("conserva el listado cuando faltan columnas de la ficha", async () => {
    mock.legacy = true;
    render(<CatalogWorkspace />);
    expect(await screen.findByText(/La ficha nueva requiere actualizar la base/)).toBeInTheDocument();
    expect(await screen.findByText("Catálogo Oficial ERP")).toBeInTheDocument();
  });
});
