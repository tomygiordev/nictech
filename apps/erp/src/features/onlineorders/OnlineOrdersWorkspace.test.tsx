import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OnlineOrdersWorkspace } from "./OnlineOrdersWorkspace";
import { ErpAuthContext } from "../../auth/ErpAuthContext";
import type { DbOrder } from "./api";

const mocks = vi.hoisted(() => ({
  listOnlineOrders: vi.fn<() => Promise<DbOrder[]>>(),
  fulfillOnlineOrder: vi.fn(),
  transitionOnlineOrder: vi.fn(),
  refundOnlineOrder: vi.fn(),
}));

vi.mock("./api", () => ({
  listOnlineOrders: mocks.listOnlineOrders,
  fulfillOnlineOrder: mocks.fulfillOnlineOrder,
  transitionOnlineOrder: mocks.transitionOnlineOrder,
  refundOnlineOrder: mocks.refundOnlineOrder,
  newOpKey: (prefix: string) => `${prefix}test-key`,
}));

const authValue = {
  session: null,
  organizationId: "10000000-0000-0000-0000-000000000001",
  branchIds: ["20000000-0000-0000-0000-000000000001"],
  permissions: ["orders.manage", "sales.cancel", "stock.adjust"],
  loading: false,
  error: null,
  hasPermission: (permission: string) =>
    ["orders.manage", "sales.cancel", "stock.adjust"].includes(permission),
};

const renderWorkspace = () =>
  render(
    <ErpAuthContext.Provider value={authValue}>
      <OnlineOrdersWorkspace />
    </ErpAuthContext.Provider>,
  );

const makeOrder = (overrides: Partial<DbOrder> = {}): DbOrder => ({
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  branch_id: "20000000-0000-0000-0000-000000000001",
  customer_id: "cccccccc-0000-0000-0000-000000000001",
  currency_code: "ARS",
  total_amount: 45000,
  created_at: "2026-11-18T10:00:00Z",
  expires_at: "2026-11-18T10:30:00Z",
  reservation_batch_id: "bbbbbbbb-0000-0000-0000-000000000001",
  order_state: "fulfilled",
  payment_state: "paid",
  delivery_state: "dispatched",
  fulfilled: true,
  sale_id: "dddddddd-0000-0000-0000-000000000001",
  stock_document_id: "eeeeeeee-0000-0000-0000-000000000001",
  fulfilled_at: "2026-11-18T10:05:00Z",
  last_payment_status: "approved",
  last_payment_amount: 45000,
  refundable_payment_event_id: null,
  lines: [{ description: "Funda MagSafe iPhone 15", quantity: 1, unit_price: 45000 }],
  events: [
    {
      id: "ev-4",
      event_sequence: 4,
      order_state: "fulfilled",
      payment_state: null,
      delivery_state: null,
      reason: "Mercado Pago approved storefront fulfillment",
      occurred_at: "2026-11-18T10:05:00Z",
      actor_id: null,
      actor_name: null,
    },
    {
      id: "ev-3",
      event_sequence: 3,
      order_state: null,
      payment_state: "paid",
      delivery_state: null,
      reason: "Provider payment status approved",
      occurred_at: "2026-11-18T10:03:00Z",
      actor_id: null,
      actor_name: null,
    },
    {
      id: "ev-2",
      event_sequence: 2,
      order_state: null,
      payment_state: null,
      delivery_state: "pending",
      reason: "Awaiting payment",
      occurred_at: "2026-11-18T10:01:00Z",
      actor_id: null,
      actor_name: null,
    },
    {
      id: "ev-1",
      event_sequence: 1,
      order_state: "placed",
      payment_state: null,
      delivery_state: null,
      reason: "Web order placed",
      occurred_at: "2026-11-18T10:00:00Z",
      actor_id: null,
      actor_name: null,
    },
    {
      id: "ev-0",
      event_sequence: 0,
      order_state: null,
      payment_state: null,
      delivery_state: "preparing",
      reason: "Unknown gateway timeout error",
      occurred_at: "2026-11-18T09:59:00Z",
      actor_id: null,
      actor_name: null,
    },
    {
      id: "ev-es",
      event_sequence: 5,
      order_state: null,
      payment_state: null,
      delivery_state: "ready",
      reason: "Retira hoy por sucursal",
      occurred_at: "2026-11-18T10:04:00Z",
      actor_id: null,
      actor_name: "Operador",
    },
  ],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("OnlineOrdersWorkspace", () => {
  it("muestra el detalle del pedido en español sin términos técnicos ni estados crudos y traduce motivos de eventos", async () => {
    mocks.listOnlineOrders.mockResolvedValue([makeOrder()]);
    renderWorkspace();

    await screen.findByText("AAAAAAAA");
    fireEvent.click(screen.getByRole("button", { name: "Abrir pedido AAAAAAAA" }));

    const dialog = await screen.findByRole("dialog");
    const text = dialog.textContent ?? "";

    expect(text).not.toMatch(/order_state/i);
    expect(text).not.toMatch(/\bfulfilled\b/i);
    expect(text).not.toMatch(/\bpaid\b/i);
    expect(text).not.toMatch(/web_order_lines/i);
    expect(text).not.toMatch(/Cumplido|Cumplir/i);

    expect(within(dialog).getAllByText("Pedido: Despachado").length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getAllByText("Pago: Pagado").length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getByText("Entrega: Despachado")).toBeInTheDocument();
    expect(within(dialog).getByText("Pedido web recibido")).toBeInTheDocument();
    expect(within(dialog).getByText("Esperando el pago")).toBeInTheDocument();
    expect(within(dialog).getByText("Pago aprobado por Mercado Pago")).toBeInTheDocument();
    expect(within(dialog).getByText("Pago aprobado por el proveedor")).toBeInTheDocument();
    expect(within(dialog).getByText("Retira hoy por sucursal")).toBeInTheDocument();
    expect(within(dialog).queryByText("Unknown gateway timeout error")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Cliente")).toBeInTheDocument();
    expect(within(dialog).getByText("Cliente de la tienda")).toBeInTheDocument();
    expect(within(dialog).getByText("Ítems comprados")).toBeInTheDocument();
  });

  it("excluye pedidos cancelados y reembolsados de Pendientes y usa pill negativo para Reembolsado", async () => {
    mocks.listOnlineOrders.mockResolvedValue([
      makeOrder({
        id: "11111111-0000-0000-0000-000000000001",
        order_state: "placed",
        payment_state: "unpaid",
        delivery_state: "pending",
        fulfilled: false,
      }),
      makeOrder({
        id: "22222222-0000-0000-0000-000000000002",
        order_state: "cancelled",
        payment_state: "unpaid",
        delivery_state: "pending",
        fulfilled: false,
      }),
      makeOrder({
        id: "33333333-0000-0000-0000-000000000003",
        order_state: "refunded",
        payment_state: "refunded",
        delivery_state: "returned",
        fulfilled: false,
      }),
    ]);

    renderWorkspace();

    await screen.findByText("11111111");
    expect(screen.getByRole("button", { name: "Pendientes (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelados / Reembolsados (2)" })).toBeInTheDocument();

    const refundedPills = screen.getAllByText("Reembolsado");
    expect(refundedPills.some((el) => el.classList.contains("status-pill--rose"))).toBe(true);
    expect(refundedPills.some((el) => el.classList.contains("processing"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Pendientes (1)" }));
    expect(screen.getByText("11111111")).toBeInTheDocument();
    expect(screen.queryByText("22222222")).not.toBeInTheDocument();
    expect(screen.queryByText("33333333")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelados / Reembolsados (2)" }));
    expect(screen.getByText("22222222")).toBeInTheDocument();
    expect(screen.getByText("33333333")).toBeInTheDocument();
  });

  it("muestra errores de los modales de despacho y ciclo de vida dentro del modal con FormError", async () => {
    const readyOrder = makeOrder({
      id: "44444444-0000-0000-0000-000000000004",
      order_state: "confirmed",
      payment_state: "paid",
      delivery_state: "ready",
      fulfilled: false,
    });
    const pendingOrder = makeOrder({
      id: "55555555-0000-0000-0000-000000000005",
      order_state: "placed",
      payment_state: "unpaid",
      delivery_state: "pending",
      fulfilled: false,
    });
    mocks.listOnlineOrders.mockResolvedValue([readyOrder, pendingOrder]);
    mocks.fulfillOnlineOrder.mockRejectedValue(new Error("web order delivery state is not eligible for fulfillment"));
    mocks.transitionOnlineOrder.mockRejectedValue({
      code: "42501",
      message: "permission denied for function record_web_order_event",
    });

    renderWorkspace();

    await screen.findByText("44444444");
    fireEvent.click(screen.getByRole("button", { name: "Despachar" }));

    const fulfillDialog = await screen.findByRole("dialog");
    fireEvent.change(within(fulfillDialog).getByLabelText(/Referencia de pago/i), {
      target: { value: "MP-999" },
    });
    fireEvent.change(within(fulfillDialog).getByLabelText(/Motivo de la operación/i), {
      target: { value: "Despacho de prueba" },
    });
    fireEvent.click(within(fulfillDialog).getByRole("button", { name: "Confirmar despacho" }));

    await waitFor(() => {
      const alert = within(fulfillDialog).getByRole("alert");
      expect(alert).toHaveTextContent("Prepará el pedido y marcalo como listo antes de completar la entrega.");
    });

    fireEvent.click(within(fulfillDialog).getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir pedido 55555555" }));

    const detailDialog = await screen.findByRole("dialog");
    fireEvent.click(within(detailDialog).getByRole("button", { name: "Preparar pedido" }));

    const lifecycleDialog = await screen.findByRole("dialog");
    fireEvent.change(within(lifecycleDialog).getByLabelText(/Motivo de la operación/i), {
      target: { value: "Preparando en mostrador" },
    });
    fireEvent.click(within(lifecycleDialog).getByRole("button", { name: "Confirmar acción" }));

    await waitFor(() => {
      expect(within(lifecycleDialog).getByRole("alert")).toHaveTextContent(
        "No tenés permiso para realizar esta acción.",
      );
    });
  });
});
