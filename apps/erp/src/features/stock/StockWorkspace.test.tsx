import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StockWorkspace, type DbStockRow, type StockWorkspaceProps } from "./StockWorkspace";
import { ErpAuthContext } from "../../auth/ErpAuthContext";

const mock = vi.hoisted(() => ({
  queries: [] as Array<{ table: string; filters: string[] }>,
  stockBalances: [] as DbStockRow[],
  locations: [] as Array<{
    id: string;
    branch_id: string;
    code: string;
    name: string;
    allows_sale: boolean;
    is_active: boolean;
  }>,
  stockDocuments: [] as Array<{
    id: string;
    kind: string;
    reason: string;
    created_at: string;
    stock_document_lines?: Array<{
      id: string;
      quantity: number;
      from_location_id: string | null;
      to_location_id: string | null;
      products?: { internal_name: string } | null;
      product_variants?: { name: string } | null;
    }>;
  }>,
  rpcResult: { data: "doc-new", error: null as { code?: string; message: string } | null },
  rpcCalls: [] as Array<{ fn: string; params: unknown }>,
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const query = { table, filters: [] as string[] };
      const chain = {
        select: () => { mock.queries.push(query); return chain; },
        eq: (key: string, value: unknown) => { query.filters.push(`${key}=${String(value)}`); return chain; },
        order: () => chain,
        limit: () => chain,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          const data = table === "stock_documents"
            ? mock.stockDocuments
            : table === "stock_balances"
              ? mock.stockBalances
              : table === "locations"
                ? mock.locations
                : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
    rpc: (fn: string, params: unknown) => {
      mock.rpcCalls.push({ fn, params });
      return Promise.resolve(mock.rpcResult);
    },
  },
}));

const renderStock = (permissions: string[] = ["stock.view", "stock.adjust", "stock.move"], props: StockWorkspaceProps = {}) =>
  render(
    <ErpAuthContext.Provider
      value={{
        session: null,
        organizationId: "org",
        branchIds: ["11111111-1111-4111-8111-111111111111"],
        permissions,
        loading: false,
        error: null,
        hasPermission: (perm) => permissions.includes(perm),
      }}
    >
      <StockWorkspace {...props} />
    </ErpAuthContext.Provider>,
  );

beforeEach(() => {
  mock.queries = [];
  mock.stockBalances = [];
  mock.locations = [];
  mock.stockDocuments = [];
  mock.rpcResult = { data: "doc-new", error: null };
  mock.rpcCalls = [];
});
afterEach(cleanup);
describe("existencias", () => {
  it("incluye inactivos solo al activar el filtro", async () => {
    renderStock();
    await waitFor(() => expect(mock.queries.some((q) => q.table === "stock_balances" && q.filters.includes("products.is_active=true"))).toBe(true));
    const previous = mock.queries.filter((q) => q.table === "stock_balances").length;
    fireEvent.click(screen.getByLabelText("Ver inactivos"));
    await waitFor(() => expect(mock.queries.filter((q) => q.table === "stock_balances").length).toBeGreaterThan(previous));
    const balances = mock.queries.filter((q) => q.table === "stock_balances");
    expect(balances[balances.length - 1].filters).not.toContain("products.is_active=true");
  });

  it("no muestra pestaña ni panel de conteo físico y redirige stock-counts a existencias", async () => {
    renderStock(["stock.view", "labels.print"], { activeModuleId: "stock-counts", onSelectModule: vi.fn() });

    await waitFor(() => expect(mock.queries.some((q) => q.table === "stock_balances")).toBe(true));
    expect(screen.getByRole("heading", { name: "Gestión de Existencias & Variantes" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Existencias" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Códigos y etiquetas" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Conteo físico/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Backend necesario/i)).not.toBeInTheDocument();
  });

  it("muestra tipos de movimiento traducidos en el historial y textos de negocio en el modal de ajuste", async () => {
    mock.stockDocuments = [
      {
        id: "doc-1",
        kind: "sale",
        reason: "Venta en mostrador",
        created_at: "2026-11-18T10:00:00Z",
        stock_document_lines: [],
      },
      {
        id: "doc-2",
        kind: "adjustment",
        reason: "Conteo mensual",
        created_at: "2026-11-18T09:00:00Z",
        stock_document_lines: [],
      },
      {
        id: "doc-3",
        kind: "reservation_fulfillment",
        reason: "Entrega de pedido web",
        created_at: "2026-11-18T08:00:00Z",
        stock_document_lines: [],
      },
    ];

    renderStock();
    await waitFor(() => expect(mock.queries.some((q) => q.table === "stock_documents")).toBe(true));

    fireEvent.click(screen.getByRole("tab", { name: /Historial de movimientos/i }));

    expect(await screen.findByText("Venta")).toBeInTheDocument();
    expect(screen.getByText("Ajuste")).toBeInTheDocument();
    expect(screen.getByText("Entrega de reserva")).toBeInTheDocument();
    expect(screen.queryByText("SALE")).not.toBeInTheDocument();
    expect(screen.queryByText("ADJUSTMENT")).not.toBeInTheDocument();
    expect(screen.queryByText("RESERVATION_FULFILLMENT")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Existencias por Variante/i }));
    fireEvent.click(screen.getByRole("button", { name: /Ajustar Stock/i }));

    const modal = await screen.findByRole("dialog");
    expect(modal).toHaveTextContent("Registrar movimiento de stock");
    expect(modal).toHaveTextContent("El stock se actualiza al confirmar.");
    expect(within(modal).getByLabelText("Variante / ubicación a ajustar (obligatorio)")).toBeInTheDocument();
    expect(within(modal).getByLabelText("Cantidad (unidades) (obligatorio)")).toBeInTheDocument();
    expect(modal).not.toHaveTextContent(/ledger|stock_balances/i);
  });

  it("deshabilita botones primarios y oculta acciones de fila sin permisos", async () => {
    mock.stockBalances = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        product_id: "33333333-3333-4333-8333-333333333333",
        variant_id: null,
        location_id: "44444444-4444-4444-8444-444444444444",
        quantity_on_hand: 5,
        quantity_reserved: 0,
        updated_at: "2026-11-18T10:00:00Z",
        products: { internal_code: "FND-01", internal_name: "Funda Silicone", item_kind: "accessory" },
        product_variants: { name: "Negro", code: "NEG" },
        locations: { name: "Depósito", code: "DEP", branch_id: "11111111-1111-4111-8111-111111111111" },
      },
    ];

    renderStock(["stock.view"]);

    expect(await screen.findByText("Funda Silicone")).toBeInTheDocument();
    const adjustBtn = screen.getByRole("button", { name: /Ajustar Stock/i });
    const transferBtn = screen.getByRole("button", { name: /Transferir stock/i });
    expect(adjustBtn).toBeDisabled();
    expect(adjustBtn).toHaveAttribute("title", "Requiere permiso: ajustar y mover stock");
    expect(transferBtn).toBeDisabled();
    expect(transferBtn).toHaveAttribute("title", "Requiere permiso: mover stock");
    expect(screen.queryByRole("button", { name: /^Ajustar$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Transferir$/i })).not.toBeInTheDocument();
  });

  it("permite transferir solo con stock.move pero mantiene deshabilitado ajustar sin stock.adjust", async () => {
    mock.stockBalances = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        product_id: "33333333-3333-4333-8333-333333333333",
        variant_id: null,
        location_id: "44444444-4444-4444-8444-444444444444",
        quantity_on_hand: 5,
        quantity_reserved: 0,
        updated_at: "2026-11-18T10:00:00Z",
        products: { internal_code: "FND-01", internal_name: "Funda Silicone", item_kind: "accessory" },
        product_variants: { name: "Negro", code: "NEG" },
        locations: { name: "Depósito", code: "DEP", branch_id: "11111111-1111-4111-8111-111111111111" },
      },
    ];

    renderStock(["stock.view", "stock.move"]);

    expect(await screen.findByText("Funda Silicone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ajustar Stock/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Transferir stock/i })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^Ajustar$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Transferir$/i })).toBeEnabled();
  });

  it("muestra el error del RPC dentro de los modales de ajuste y transferencia", async () => {
    const branchId = "11111111-1111-4111-8111-111111111111";
    const sourceLocId = "44444444-4444-4444-8444-444444444444";
    const destLocId = "55555555-5555-4555-8555-555555555555";
    mock.stockBalances = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        product_id: "33333333-3333-4333-8333-333333333333",
        variant_id: null,
        location_id: sourceLocId,
        quantity_on_hand: 5,
        quantity_reserved: 0,
        updated_at: "2026-11-18T10:00:00Z",
        products: { internal_code: "FND-01", internal_name: "Funda Silicone", item_kind: "accessory" },
        product_variants: { name: "Negro", code: "NEG" },
        locations: { name: "Depósito", code: "DEP", branch_id: branchId },
      },
    ];
    mock.locations = [
      { id: sourceLocId, branch_id: branchId, code: "DEP", name: "Depósito", allows_sale: false, is_active: true },
      { id: destLocId, branch_id: branchId, code: "MOS", name: "Mostrador", allows_sale: true, is_active: true },
    ];
    mock.rpcResult = {
      data: null as unknown as string,
      error: { code: "42501", message: "stock.adjust permission is required" },
    };

    renderStock(["stock.view", "stock.adjust", "stock.move"]);

    expect(await screen.findByText("Funda Silicone")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Ajustar Stock/i }));
    const adjDialog = await screen.findByRole("dialog");
    fireEvent.change(within(adjDialog).getByLabelText(/Costo unitario de ingreso/i), { target: { value: "1000" } });
    fireEvent.change(within(adjDialog).getByLabelText(/Motivo de auditoría/i), { target: { value: "Conteo mensual" } });
    fireEvent.click(within(adjDialog).getByRole("button", { name: /Confirmar movimiento/i }));

    expect(await within(adjDialog).findByRole("alert")).toHaveTextContent("No tenés permiso para realizar esta acción.");

    fireEvent.click(within(adjDialog).getByRole("button", { name: /Cancelar/i }));

    mock.rpcResult = {
      data: null as unknown as string,
      error: { message: "insufficient available stock on line 1" },
    };
    fireEvent.click(screen.getByRole("button", { name: /Transferir stock/i }));
    const transferDialog = await screen.findByRole("dialog");
    fireEvent.change(within(transferDialog).getByLabelText(/Motivo de auditoría/i), { target: { value: "Reposición mostrador" } });
    fireEvent.click(within(transferDialog).getByRole("button", { name: /Confirmar transferencia/i }));

    expect(await within(transferDialog).findByRole("alert")).toHaveTextContent("No hay stock suficiente. Revisá las cantidades y reintentá.");
  });
});
