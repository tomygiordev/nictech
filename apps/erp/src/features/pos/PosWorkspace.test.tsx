import React from "react";
import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PosWorkspace } from "./PosWorkspace";
import { PosCoordinator } from "./posCoordinator";

const mocks = vi.hoisted(() => ({
  organizationId: "org-a",
  rpc: vi.fn(),
  receipt: vi.fn(),
  productLoad: vi.fn(),
}));
const ids = {
  branch: "11111111-1111-4111-8111-111111111111",
  location: "22222222-2222-4222-8222-222222222222",
  product: "33333333-3333-4333-8333-333333333333",
  payment: "44444444-4444-4444-8444-444444444444",
  snapshot: "55555555-5555-4555-8555-555555555555",
  customer: "66666666-6666-4666-8666-666666666666",
  sale: "77777777-7777-4777-8777-777777777777",
  document: "88888888-8888-4888-8888-888888888888",
};
vi.mock("../../auth/ErpAuthContext", () => ({ useErpAuth: () => ({ organizationId: mocks.organizationId }) }));
vi.mock("../documents/api", () => ({ getDocumentSaleReceipt: (id: string) => mocks.receipt(id) }));
vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    from: (table: string) => {
      const result = () => {
        let data: unknown = [];
        if (table === "exchange_rate_snapshots") data = { rate_to_base: 1000 };
        if (table === "branches") data = [{ id: ids.branch, name: "Central" }];
        if (table === "locations") data = [{ id: ids.location, branch_id: ids.branch, name: "Depósito" }];
        if (table === "payment_methods") data = [{ id: ids.payment, code: "BANK", name: "Transferencia",
          settlement_kind: "bank", requires_cash_session: false }];
        if (table === "products") return mocks.productLoad();
        return Promise.resolve({ data, error: null });
      };
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder, limit: () => builder,
        maybeSingle: result,
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => result().then(resolve, reject),
      };
      return builder;
    },
  },
}));

const saleResponse = { sale_id: ids.sale, document_id: ids.document, document_number: "F-0001", invoice_kind: "fiscal" };
const productResponse = () => ({ data: [{ id: ids.product, internal_code: "ITEM", internal_name: "Producto prueba",
  base_sale_price: 100.005, tax_rate_percent: 21, inventory_tracking: "quantity",
  product_categories: null, product_variants: [],
  stock_balances: [{ location_id: ids.location, quantity_on_hand: 10, quantity_reserved: 0, variant_id: null }],
}], error: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
const saleCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === "create_sale_with_invoice");
async function ready() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Agregar Producto prueba al carrito" })).toBeEnabled());
}
async function charge() {
  fireEvent.click(screen.getByRole("button", { name: "Agregar Producto prueba al carrito" }));
  fireEvent.click(screen.getByRole("button", { name: "Cobrar y Emitir Comprobante" }));
  await waitFor(() => expect(saleCalls()).toHaveLength(1));
}
describe("POS Workspace financial flow", () => {
  beforeEach(() => {
    mocks.organizationId = "org-a";
    mocks.rpc.mockReset(); mocks.receipt.mockReset(); mocks.productLoad.mockReset();
    mocks.productLoad.mockImplementation(async () => productResponse());
    mocks.receipt.mockResolvedValue(null);
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_or_create_exchange_snapshot") return { data: ids.snapshot, error: null };
      if (name === "get_or_create_pos_customer") return { data: ids.customer, error: null };
      if (name === "create_sale_with_invoice") return { data: saleResponse, error: null };
      return { data: [], error: null };
    });
  });
  afterEach(cleanup);

  it("mounts, adopts defaults, charges through the real API, and completes the queued catalog refresh", async () => {
    const coordinator = new PosCoordinator();
    mocks.receipt.mockImplementation(async () => {
      expect(coordinator.getFinancialAttempt()?.status).toBe("confirmed");
      throw new Error("Receipt read failed");
    });
    render(<PosWorkspace coordinator={coordinator} />);
    await ready();
    expect(coordinator.isContextLoaded()).toBe(true);
    await charge();
    await screen.findByText("El carrito está vacío");
    await waitFor(() => expect(coordinator.isIdle()).toBe(true));
    expect(mocks.productLoad).toHaveBeenCalledTimes(2);
    expect(coordinator.getFinancialAttempt()?.status).toBe("confirmed");
    fireEvent.click(screen.getByRole("button", { name: "Agregar Producto prueba al carrito" }));
    expect(screen.getByRole("button", { name: "Cobrar y Emitir Comprobante" })).toBeEnabled();
  });

  it("retries the frozen original payload with an empty invalid draft after A→B→A; no repeated preflight", async () => {
    const coordinator = new PosCoordinator();
    const baseRpc = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === "create_sale_with_invoice" && saleCalls().length === 1) throw new Error("Network timeout");
      return baseRpc(...args);
    });
    const view = render(<PosWorkspace coordinator={coordinator} />);
    await ready(); await charge();
    await screen.findByRole("button", { name: "Reintentar cobro pendiente" });
    const originalArgs = saleCalls()[0][1];
    fireEvent.click(screen.getByRole("button", { name: "Vaciar" }));
    mocks.organizationId = "org-b"; view.rerender(<PosWorkspace coordinator={coordinator} />);
    await screen.findByText("Vuelva a la organización de origen para reintentar el mismo cobro.");
    expect(screen.queryByRole("button", { name: "Reintentar cobro pendiente" })).toBeNull();
    mocks.organizationId = "org-a"; view.rerender(<PosWorkspace coordinator={coordinator} />);
    await ready();
    fireEvent.change(screen.getByLabelText("Nombre del cliente"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar cobro pendiente" }));
    await waitFor(() => expect(coordinator.getFinancialAttempt()?.status).toBe("confirmed"));
    expect(saleCalls()).toHaveLength(2);
    expect(saleCalls()[1][1]).toBe(originalArgs);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "get_or_create_exchange_snapshot")).toHaveLength(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "get_or_create_pos_customer")).toHaveLength(1);
    expect(screen.getByText("El carrito está vacío")).toBeInTheDocument();
  });

  it("clears only the unchanged charged draft when retry confirms", async () => {
    const coordinator = new PosCoordinator();
    const baseRpc = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === "create_sale_with_invoice" && saleCalls().length === 1) throw new Error("Network timeout");
      return baseRpc(...args);
    });
    render(<PosWorkspace coordinator={coordinator} />);
    await ready(); await charge();
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar cobro pendiente" }));
    await screen.findByText("El carrito está vacío");
    await waitFor(() => expect(coordinator.isIdle()).toBe(true));
    expect(saleCalls()).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Cobrar y Emitir Comprobante" })).toBeDisabled();
  });

  it("discards a failed preflight after org changes without dispatch or stale feedback", async () => {
    const snapshot = deferred<{ data: null; error: { message: string } }>();
    const coordinator = new PosCoordinator();
    const baseRpc = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation((...args: unknown[]) => args[0] === "get_or_create_exchange_snapshot" ? snapshot.promise : baseRpc(...args));
    const view = render(<PosWorkspace coordinator={coordinator} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Agregar Producto prueba al carrito" }));
    fireEvent.click(screen.getByRole("button", { name: "Cobrar y Emitir Comprobante" }));
    await waitFor(() => expect(coordinator.isCheckoutActive()).toBe(true));
    mocks.organizationId = "org-b"; view.rerender(<PosWorkspace coordinator={coordinator} />);
    await act(async () => snapshot.resolve({ data: null, error: { message: "old-org-error" } }));
    await ready();
    expect(saleCalls()).toHaveLength(0);
    expect(screen.queryByText(/old-org-error/)).toBeNull();
    expect(coordinator.isIdle()).toBe(true);
  });

  it("finalizes an invalidated real UI requote and permits another requote", async () => {
    const coordinator = new PosCoordinator();
    const baseRpc = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (...args: unknown[]) => args[0] === "create_sale_with_invoice"
      ? { data: null, error: { code: "23514", message: "stale quote: catalog price or tax rate has changed, requote required" } }
      : baseRpc(...args));
    render(<PosWorkspace coordinator={coordinator} />);
    await ready(); await charge();
    const quote = await screen.findByRole("button", { name: "Actualizar precios del carrito" });
    const pending = deferred<ReturnType<typeof productResponse>>();
    mocks.productLoad.mockImplementationOnce(() => pending.promise);
    fireEvent.click(quote);
    expect(coordinator.isRequoteActive()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Sumar 1" }));
    await act(async () => pending.resolve(productResponse()));
    await waitFor(() => expect(coordinator.isIdle()).toBe(true));
    expect(quote).toBeEnabled();
    fireEvent.click(quote);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Actualizar precios del carrito" })).toBeNull());
    expect(coordinator.isIdle()).toBe(true);
  });

  it("drains the latest queued real UI fetch after an obsolete org response without applying old catalog", async () => {
    const pending = deferred<ReturnType<typeof productResponse>>();
    const coordinator = new PosCoordinator();
    mocks.productLoad.mockImplementationOnce(() => pending.promise);
    const view = render(<PosWorkspace coordinator={coordinator} />);
    await waitFor(() => expect(mocks.productLoad).toHaveBeenCalledTimes(1));
    mocks.organizationId = "org-b"; view.rerender(<PosWorkspace coordinator={coordinator} />);
    const old = productResponse(); old.data[0].internal_name = "Old org product";
    await act(async () => pending.resolve(old));
    await ready();
    expect(mocks.productLoad).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Old org product")).toBeNull();
    expect(coordinator.getCurrentContext().organizationId).toBe("org-b");
    expect(coordinator.isContextLoaded()).toBe(true);
    expect(coordinator.isIdle()).toBe(true);
  });

  it.each(["malformed", "gateway"])("retains the dispatched attempt after %s RPC output and blocks a new charge", async (kind) => {
    const coordinator = new PosCoordinator();
    const baseRpc = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (...args: unknown[]) => args[0] === "create_sale_with_invoice"
      ? kind === "malformed"
        ? { data: { sale_id: "", document_id: "not-a-uuid", document_number: " ", invoice_kind: "fiscal" }, error: null }
        : { data: null, error: { code: "500", message: "Internal Server Error" } }
      : baseRpc(...args));
    render(<PosWorkspace coordinator={coordinator} />);
    await ready(); await charge();
    await screen.findByRole("button", { name: "Reintentar cobro pendiente" });
    expect(coordinator.getFinancialAttempt()?.status).toBe("uncertain");
    expect(coordinator.getFinancialAttempt()?.uncertaintyHistory).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Cobrar y Emitir Comprobante" })).toBeDisabled();
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
});
