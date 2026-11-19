import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErpAuthContext } from "../../auth/ErpAuthContext";
import type { DashboardMetrics } from "./dashboardApi";
import { DashboardOverview } from "./DashboardOverview";

const { rpcMock, fromMock, orderMock, limitMock, chartDataMock, signals, withSignal } = vi.hoisted(() => {
  const signals: AbortSignal[] = [];
  const withSignal = (result: unknown) => ({
    abortSignal: (signal: AbortSignal) => {
      signals.push(signal);
      return result;
    },
  });
  const limitMock = vi.fn();
  const orderMock = vi.fn(() => ({ limit: (count: number) => withSignal(limitMock(count)) }));
  const fromMock = vi.fn(() => ({ select: () => ({ order: orderMock }) }));
  return { rpcMock: vi.fn(), fromMock, orderMock, limitMock, chartDataMock: vi.fn(), signals, withSignal };
});

vi.mock("../../lib/supabase", () => ({
  supabase: { from: fromMock, rpc: (method: string, args: unknown) => withSignal(rpcMock(method, args)) },
}));

vi.mock("recharts", async (importOriginal) => ({
  ...await importOriginal<typeof import("recharts")>(),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  ComposedChart: ({ data }: { data: unknown }) => {
    chartDataMock(data);
    return null;
  },
}));

const metrics: DashboardMetrics = {
  can_view_sales: true,
  sales: { total_ars: 28967, pos_ars: 17967, web_ars: 6000, repairs_ars: 5000, pos_count: 4, web_count: 3, repairs_count: 2 },
  series: [
    { day: "2026-10-25", pos_ars: 17967, web_ars: 0, repairs_ars: 0, repairs_opened: 1 },
    { day: "2026-10-26", pos_ars: 0, web_ars: 6000, repairs_ars: 5000, repairs_opened: 0 },
    { day: "2026-10-27", pos_ars: 0, web_ars: 0, repairs_ars: 0, repairs_opened: 2 },
  ],
  products_active_count: 22,
  inventory: { sellable_units: 38, value_at_sale_price_ars: 231000 },
  low_stock: [
    { product_id: "00000000-0000-4000-8000-000000000001", name: "Vidrio templado", available: 0 },
    { product_id: "00000000-0000-4000-8000-000000000002", name: "Adaptador USB", available: 1 },
    { product_id: "00000000-0000-4000-8000-000000000003", name: "Cable de carga", available: 2 },
    { product_id: "00000000-0000-4000-8000-000000000004", name: "Funda negra", available: 3 },
  ],
  active_repairs_count: 17,
};

const renderDashboard = (branchIds: string[] = ["branch-1", "branch-2"]) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <ErpAuthContext.Provider
        value={{
          session: {
            access_token: "test-token",
            token_type: "bearer",
            expires_in: 3600,
            refresh_token: "test-refresh",
            user: {
              id: "test-user-id",
              email: "operador@example.com",
              app_metadata: {},
              user_metadata: { full_name: "Operador Real" },
              aud: "authenticated",
              created_at: new Date().toISOString(),
            },
          },
          organizationId: "test-org",
          branchIds,
          permissions: ["dashboard.view", "stock.view", "cash.view"],
          loading: false,
          error: null,
          hasPermission: (permission: string) => ["dashboard.view", "stock.view", "cash.view"].includes(permission),
        }}
      >
        <DashboardOverview onSelectModule={vi.fn()} />
      </ErpAuthContext.Provider>
    </QueryClientProvider>,
  );
};

describe("DashboardOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signals.length = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T01:30:00Z"));
    rpcMock.mockReset().mockResolvedValue({ data: metrics, error: null });
    limitMock.mockReset().mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancela las dos consultas cuando se desmonta el Centro operativo", () => {
    const { unmount } = renderDashboard();
    expect(signals.map((signal) => signal.aborted)).toEqual([false, false]);
    unmount();
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
  });

  it("muestra el total de la RPC, el desglose de los tres canales y los demás KPI", async () => {
    renderDashboard();

    const kpis = within(screen.getByRole("region", { name: "Métricas principales" }));
    expect(await kpis.findByText(/^\$\s*28\.967$/)).toBeInTheDocument();
    expect(kpis.getByText(/^POS\s\$\s*17\.967 · Web\s\$\s*6\.000 · Reparaciones\s\$\s*5\.000$/)).toBeInTheDocument();
    expect(kpis.getByText("Ventas del período")).toBeInTheDocument();
    expect(kpis.getByText("Stock vendible a precio de venta")).toBeInTheDocument();
    expect(kpis.getByText(/^\$\s*231\.000$/)).toBeInTheDocument();
    expect(kpis.getByText("22")).toBeInTheDocument();
    expect(kpis.getByText("17")).toBeInTheDocument();
    expect(kpis.queryByText("ARS")).not.toBeInTheDocument();
    expect(fromMock.mock.calls).toEqual([["repair_orders_overview"]]);
  });

  it("muestra el stock bajo en el orden de la RPC, incluido el stock cero", async () => {
    renderDashboard();

    const stock = within(screen.getByRole("region", { name: "Stock bajo" }));
    await stock.findByRole("button", { name: "Abrir stock para revisar Vidrio templado" });
    const items = stock.getAllByRole("button", { name: /Abrir stock para revisar/ });
    expect(items.map((item) => item.getAttribute("aria-label"))).toEqual(
      metrics.low_stock.map(({ name }) => `Abrir stock para revisar ${name}`),
    );
    expect(within(items[0]).getByText("0")).toBeInTheDocument();
  });

  it("limita las reparaciones a cinco y traduce estados y presupuestos de la vista", async () => {
    limitMock.mockResolvedValue({
      data: [
        { id: "repair-1", order_code: "REP-1", status_code: "diagnosis", status_name: "Diagnostico", latest_quote: { total_amount: 1800, currency_code: "ARS" } },
        { id: "repair-2", order_code: "REP-2", status_code: "ready", delivery_id: "delivery-1", latest_quote: null },
      ],
      error: null,
    });
    renderDashboard();

    const recent = within(screen.getByRole("region", { name: "Reparaciones recientes" }));
    expect(await recent.findByText("Diagnóstico")).toBeInTheDocument();
    expect(recent.getByText("Entregado")).toBeInTheDocument();
    expect(recent.getByText(/^ARS\s*1\.800,00$/)).toBeInTheDocument();
    expect(recent.getByText("Sin presupuesto")).toBeInTheDocument();
    expect(orderMock).toHaveBeenCalledWith("opened_at", { ascending: false });
    expect(limitMock).toHaveBeenCalledWith(5);
  });

  it("muestra un error de RPC en español sin exponer detalles internos y permite reintentar", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "dashboard.view permission required" },
    });
    renderDashboard();

    expect(await screen.findByText("No se pudo actualizar el resumen")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No tenés permiso para realizar esta acción.");
    expect(screen.queryByText("dashboard.view permission required")).not.toBeInTheDocument();
    expect(screen.getAllByText("No disponible")).toHaveLength(4);
    expect(screen.getByText("No disponibles")).toBeInTheDocument();
    expect(await screen.findByText("No hay reparaciones recientes.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar consulta" }));
    expect(await screen.findByText(/^\$\s*28\.967$/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fromMock).toHaveBeenCalledTimes(1);

    expect(screen.getByText("3 permisos habilitados")).toBeInTheDocument();
    expect(screen.getByText("2 asignadas")).toBeInTheDocument();
    expect(screen.getByText("Ver módulo Caja")).toBeInTheDocument();
    expect(screen.queryByText("Administración & Taller")).not.toBeInTheDocument();
    expect(screen.queryByText("01 Abierta")).not.toBeInTheDocument();
    expect(screen.queryByText("Central")).not.toBeInTheDocument();
  });

  it("cambia la fecha inicial según el período usando el día civil de Buenos Aires", async () => {
    renderDashboard();

    const selector = screen.getByRole("combobox", { name: "Seleccionar período" });
    const expectRange = (start: string) => expect(rpcMock).toHaveBeenLastCalledWith("get_dashboard_metrics", {
      date_from: start,
      date_to: "2026-10-31",
    });

    expectRange("2026-01-01");
    for (const [period, start] of [["6m", "2026-05-01"], ["month", "2026-10-01"], ["30d", "2026-10-02"]]) {
      fireEvent.change(selector, { target: { value: period } });
      expectRange(start);
      await screen.findByText(/^\$\s*28\.967$/);
    }
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("descarta una respuesta anterior que llega después de cambiar el período", async () => {
    let resolvePrevious: (value: { data: DashboardMetrics; error: null }) => void = () => {};
    const previous = new Promise<{ data: DashboardMetrics; error: null }>((resolve) => { resolvePrevious = resolve; });
    rpcMock.mockReturnValueOnce(previous);
    renderDashboard();

    fireEvent.change(screen.getByRole("combobox", { name: "Seleccionar período" }), { target: { value: "month" } });
    expect(await screen.findByText(/^\$\s*28\.967$/)).toBeInTheDocument();

    await act(async () => {
      resolvePrevious({
        data: { ...metrics, sales: { ...metrics.sales, total_ars: 99, pos_ars: 99, web_ars: 0, repairs_ars: 0 } },
        error: null,
      });
      await previous;
    });
    expect(screen.getByText(/^\$\s*28\.967$/)).toBeInTheDocument();
    expect(screen.queryByText(/^\$\s*99$/)).not.toBeInTheDocument();
  });

  it("agrupa los tres canales y las aperturas por mes o semana, sin mezclar pesos y cantidades", async () => {
    renderDashboard();
    expect(await screen.findByText("Reparaciones abiertas")).toBeInTheDocument();
    expect(chartDataMock).toHaveBeenLastCalledWith([
      expect.objectContaining({ pos_ars: 17967, web_ars: 6000, repairs_ars: 5000, repairs_opened: 3 }),
    ]);

    fireEvent.change(screen.getByRole("combobox", { name: "Seleccionar período" }), { target: { value: "month" } });
    await waitFor(() => {
      expect(chartDataMock).toHaveBeenLastCalledWith([
        expect.objectContaining({ pos_ars: 17967, web_ars: 0, repairs_ars: 0, repairs_opened: 1 }),
        expect.objectContaining({ pos_ars: 0, web_ars: 6000, repairs_ars: 5000, repairs_opened: 2 }),
      ]);
    });
  });

  it("reintenta con target_branch_id ante 42501 cuando el usuario tiene una sola sucursal", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { code: "42501", message: "dashboard.view permission required" } })
      .mockResolvedValueOnce({ data: metrics, error: null });
    renderDashboard(["branch-solo"]);

    const kpis = within(screen.getByRole("region", { name: "Métricas principales" }));
    expect(await kpis.findByText(/^\$\s*28\.967$/)).toBeInTheDocument();
    expect(rpcMock).toHaveBeenNthCalledWith(1, "get_dashboard_metrics", {
      date_from: "2026-01-01",
      date_to: "2026-10-31",
    });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "get_dashboard_metrics", {
      date_from: "2026-01-01",
      date_to: "2026-10-31",
      target_branch_id: "branch-solo",
    });
  });

  it("oculta los montos de ventas y canales cuando can_view_sales es false", async () => {
    rpcMock.mockResolvedValue({
      data: {
        ...metrics,
        can_view_sales: false,
        sales: { total_ars: 0, pos_ars: 0, web_ars: 0, repairs_ars: 0, pos_count: 0, web_count: 0, repairs_count: 0 },
      },
      error: null,
    });
    renderDashboard();

    const kpis = within(screen.getByRole("region", { name: "Métricas principales" }));
    expect(await kpis.findByText("Sin permiso")).toBeInTheDocument();
    expect(kpis.getByText("Requiere permiso para ver ventas")).toBeInTheDocument();
    expect(kpis.queryByText(/^\$\s*0$/)).not.toBeInTheDocument();
    expect(kpis.queryByText(/POS \$/)).not.toBeInTheDocument();

    const chart = within(screen.getByRole("region", { name: "Ventas por canal" }));
    expect(chart.getByText("Reparaciones abiertas")).toBeInTheDocument();
    expect(chart.queryByText("POS")).not.toBeInTheDocument();
    expect(chart.queryByText("Web")).not.toBeInTheDocument();
    expect(chart.queryByText("Reparaciones")).not.toBeInTheDocument();
  });
});
