import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CatalogWorkspace } from "./CatalogWorkspace";
import type { DbCatalogProduct } from "./schemas";

const mock = vi.hoisted(() => ({
  filters: [] as Array<[string, string, unknown]>,
  ranges: [] as Array<[number, number]>,
  schema: "current",
  permissions: new Set<string>(),
  rpc: vi.fn(),
  locations: [] as Array<{ id: string; branch_id: string; code: string; name: string; allows_sale: boolean; is_active: boolean }>,
  productsOverride: null as DbCatalogProduct[] | null,
}));

const category = { id: "c84b3d36-0e9e-44f1-86c8-509b01c27111", code: "CABLES", name: "Cables" };
const sellableLocation = {
  id: "loc-sellable", branch_id: "branch-1", code: "MOST", name: "Mostrador", allows_sale: true, is_active: true,
};
const quarantineLocation = {
  id: "loc-quarantine", branch_id: "branch-1", code: "CUAR", name: "Cuarentena", allows_sale: false, is_active: true,
};
const product: DbCatalogProduct = {
  id: "product-1",
  internal_code: "FUNDA-1",
  internal_name: "Funda reforzada",
  public_name: null,
  web_status: "published",
  base_sale_price: 500,
  tax_rate_percent: 21,
  is_active: true,
  item_kind: "product",
  inventory_tracking: "quantity",
  created_at: "2026-11-18T10:00:00Z",
  product_variants: [{ id: "blue", code: "AZ", name: "Azul", price_delta: 0, is_active: true }],
  stock_balances: [{ variant_id: "blue", location_id: sellableLocation.id, quantity_on_hand: 2, quantity_reserved: 0 }],
};
const totals = { total_products: 52, stock_value_ars: 2_350_000, low_stock_count: 8, out_of_stock_count: 13 };
const emptyTotals = { total_products: 0, stock_value_ars: 0, low_stock_count: 0, out_of_stock_count: 0 };

vi.mock("../../auth/ErpAuthContext", () => ({
  useErpAuth: () => ({ hasPermission: (permission: string) => mock.permissions.has(permission) }),
}));
vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: mock.rpc,
    from: (table: string) => {
      let selection = "";
      let offset = 0;
      let categoryFilter = false;
      const chain = {
        select: (value: string) => { selection = value; return chain; },
        eq: (column: string, value: unknown) => {
          mock.filters.push([table, column, value]);
          if (table === "products" && column === "category_id") categoryFilter = true;
          return chain;
        },
        order: () => chain,
        range: (from: number, to: number) => { offset = from; mock.ranges.push([from, to]); return chain; },
        or: (value: string) => { mock.filters.push([table, "or", value]); return chain; },
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
          const isProducts = table === "products";
          const isLegacySelection = !selection.includes("sheet_template");
          const error = isProducts && (
            mock.schema === "missing" || (mock.schema === "legacy" && !isLegacySelection)
          ) ? { code: "42703", message: "column sheet_template does not exist" } : null;
          const baseProducts = mock.productsOverride ?? [product];
          const data = isProducts && !categoryFilter
            ? baseProducts.map((item) => ({
                ...item,
                internal_name: offset ? "Producto de la segunda página" : item.internal_name,
                web_status: isLegacySelection ? undefined : item.web_status,
              }))
            : table === "product_categories"
              ? [category]
              : table === "locations"
                ? mock.locations
                : [];
          return Promise.resolve({
            data: error ? null : data,
            error,
            count: isProducts && !categoryFilter ? (mock.productsOverride ? mock.productsOverride.length : 53) : 0,
          })
            .then(resolve, reject);
        },
      };
      return chain;
    },
  },
}));

function kpiValue(label: string): Element | null | undefined {
  return screen.getByText(label).closest(".flow-kpi-card")?.querySelector(".flow-kpi-card__val");
}

beforeEach(() => {
  mock.filters = [];
  mock.ranges = [];
  mock.schema = "current";
  mock.permissions = new Set(["catalog.manage", "stock.move", "stock.adjust"]);
  mock.locations = [sellableLocation, quarantineLocation];
  mock.productsOverride = null;
  mock.rpc.mockReset();
  mock.rpc.mockImplementation((_name: string, filters: { target_category_id?: string }) =>
    Promise.resolve({ data: filters.target_category_id ? emptyTotals : totals, error: null }));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("listado de catálogo", () => {
  it("muestra los cuatro totales de la RPC, no los de la página visible", async () => {
    render(<CatalogWorkspace />);

    expect(await screen.findByText(product.internal_name)).toBeInTheDocument();
    await waitFor(() => expect(kpiValue("Total Artículos")).toHaveTextContent(/^52$/));
    expect(kpiValue("Stock vendible a precio de venta")).toHaveTextContent("$2.35M");
    expect(kpiValue("Stock Bajo")).toHaveTextContent(/^8$/);
    expect(kpiValue("Sin Stock")).toHaveTextContent(/^13$/);
  });

  it("filtra la lista y los indicadores por categoría y permite limpiar el filtro", async () => {
    render(<CatalogWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: category.name }));

    expect(await screen.findByText("No hay productos en esta categoría o búsqueda.")).toBeInTheDocument();
    expect(mock.filters).toContainEqual(["products", "category_id", category.id]);
    expect(mock.rpc).toHaveBeenLastCalledWith("get_catalog_kpis", {
      search_text: undefined, target_category_id: category.id, include_inactive: false,
    });
    await waitFor(() => expect(kpiValue("Total Artículos")).toHaveTextContent(/^0$/));

    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(await screen.findByText(product.internal_name)).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenLastCalledWith("get_catalog_kpis", {
      search_text: undefined, target_category_id: undefined, include_inactive: false,
    });
  });

  it("pagina la tabla sin volver a consultar los indicadores", async () => {
    render(<CatalogWorkspace />);
    await screen.findByText(product.internal_name);
    await waitFor(() => expect(kpiValue("Total Artículos")).toHaveTextContent(/^52$/));
    mock.rpc.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByText("Producto de la segunda página")).toBeInTheDocument();
    expect(mock.ranges).toEqual([[0, 24], [25, 49]]);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(kpiValue("Stock Bajo")).toHaveTextContent(/^8$/);
  });

  it("oculta inactivos por defecto y actualiza ambos pedidos al incluirlos", async () => {
    render(<CatalogWorkspace />);
    await screen.findByText(product.internal_name);
    expect(mock.filters).toContainEqual(["products", "is_active", true]);
    mock.filters = [];

    fireEvent.click(screen.getByRole("checkbox", { name: "Ver inactivos" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenLastCalledWith(
      "get_catalog_kpis", expect.objectContaining({ include_inactive: true }),
    ));
    await screen.findByText(product.internal_name);
    expect(mock.filters).not.toContainEqual(["products", "is_active", true]);
  });

  it("usa el mismo término limpio para la búsqueda y los indicadores", async () => {
    render(<CatalogWorkspace />);
    await screen.findByText(product.internal_name);
    fireEvent.change(screen.getByPlaceholderText("Buscar por código o nombre..."), {
      target: { value: "  funda,(azul)  " },
    });

    await waitFor(() => expect(mock.rpc).toHaveBeenLastCalledWith(
      "get_catalog_kpis", expect.objectContaining({ search_text: "fundaazul" }),
    ));
    expect(mock.filters).toContainEqual([
      "products", "or", "internal_name.ilike.%fundaazul%,internal_code.ilike.%fundaazul%",
    ]);
    await screen.findByText(product.internal_name);
  });

  it("sin catalog.manage oculta la creación y las entradas a la ficha", async () => {
    mock.permissions.delete("catalog.manage");
    render(<CatalogWorkspace />);

    expect(await screen.findByText(product.internal_name)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo Producto" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: product.internal_name })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ficha" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar stock" })).toBeInTheDocument();
  });

  it.each(["stock.adjust", "stock.move"])("sin %s oculta Cargar stock, también en variantes", async (permission) => {
    mock.permissions.delete(permission);
    render(<CatalogWorkspace />);

    expect(await screen.findByText("Azul")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cargar stock" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Azul/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: product.internal_name })).toHaveClass("flow-link-btn");
  });

  it("usa el estado visual completed para Publicado", async () => {
    render(<CatalogWorkspace />);

    expect(await screen.findByText("Publicado")).toHaveClass("flow-status-pill", "completed");
  });

  it("conserva el listado básico sin exponer detalles cuando faltan columnas de la ficha", async () => {
    mock.schema = "legacy";
    render(<CatalogWorkspace />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo cargar el catálogo. Avisá al administrador del sistema.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(/migraciones|sheet_template/i);
    expect(await screen.findByText(product.internal_name)).toBeInTheDocument();
  });

  it("muestra el mensaje de negocio si tampoco se puede cargar el listado básico", async () => {
    mock.schema = "missing";
    render(<CatalogWorkspace />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo cargar el catálogo. Avisá al administrador del sistema.",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("traduce el error de la RPC y no inventa indicadores en cero", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "catalog.view permission required" } });
    render(<CatalogWorkspace />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No tenés permiso para realizar esta acción.");
    expect(kpiValue("Sin Stock")).toHaveTextContent(/^—$/);
    expect(await screen.findByText(product.internal_name)).toBeInTheDocument();
  });

  it("suma solo ubicaciones vendibles en la columna Stock vendible y en variantes", async () => {
    mock.productsOverride = [
      {
        ...product,
        stock_balances: [
          { variant_id: "blue", location_id: sellableLocation.id, quantity_on_hand: 3, quantity_reserved: 0 },
          { variant_id: "blue", location_id: quarantineLocation.id, quantity_on_hand: 40, quantity_reserved: 0 },
        ],
      },
      {
        ...product,
        id: "product-quarantine-only",
        internal_code: "CUAR-1",
        internal_name: "Solo en cuarentena",
        product_variants: [],
        stock_balances: [
          { variant_id: null, location_id: quarantineLocation.id, quantity_on_hand: 40, quantity_reserved: 0 },
        ],
      },
    ];
    render(<CatalogWorkspace />);

    expect(await screen.findByRole("columnheader", { name: "Stock vendible" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Stock disponible" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("3 u.")).toBeInTheDocument());
    expect(screen.getByText("(3 u.)")).toBeInTheDocument();
    expect(screen.getByText("0 u.")).toBeInTheDocument();
    expect(screen.queryByText("40 u.")).not.toBeInTheDocument();
    expect(screen.queryByText("43 u.")).not.toBeInTheDocument();
  });

  it("aplica debounce de 300 ms al buscar antes de consultar lista e indicadores", async () => {
    vi.useFakeTimers();
    render(<CatalogWorkspace />);
    await vi.waitFor(() => expect(screen.getByText(product.internal_name)).toBeInTheDocument());
    mock.rpc.mockClear();

    const input = screen.getByPlaceholderText("Buscar por código o nombre...");
    fireEvent.change(input, { target: { value: "fun" } });
    fireEvent.change(input, { target: { value: "funda" } });

    await vi.advanceTimersByTimeAsync(299);
    expect(mock.rpc).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledExactlyOnceWith(
        "get_catalog_kpis",
        expect.objectContaining({ search_text: "funda" }),
      ),
    );
  });
});
