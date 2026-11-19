import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ErpAuthContext, type ErpAuthContextValue } from "../../auth/ErpAuthContext";
import { PricingWorkspace } from "./PricingWorkspace";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  snapshots: [] as Array<{
    id: string;
    base_currency: string;
    quote_currency: string;
    rate_to_base: number;
    source: string;
    quoted_at: string;
    captured_at: string;
  }>,
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: mock.rpc,
    from: (table: string) => {
      const getRows = () => {
        if (table === "exchange_rate_snapshots") return mock.snapshots;
        return [];
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (
          resolve: (value: { data: unknown[]; error: null }) => unknown,
          reject: (error: unknown) => unknown,
        ) => Promise.resolve({ data: getRows(), error: null }).then(resolve, reject),
      };
      return chain;
    },
  },
}));

const renderWorkspace = (permissions: string[] = ["pricing.view", "pricing.manage"]) => {
  const authValue: ErpAuthContextValue = {
    session: null,
    organizationId: "org-1",
    branchIds: ["branch-1"],
    permissions,
    loading: false,
    error: null,
    hasPermission: (permission: string) => permissions.includes(permission),
  };
  return render(
    <ErpAuthContext.Provider value={authValue}>
      <PricingWorkspace />
    </ErpAuthContext.Provider>,
  );
};

beforeEach(() => {
  mock.rpc.mockReset();
  mock.snapshots = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      base_currency: "ARS",
      quote_currency: "USD",
      rate_to_base: 1000,
      source: "Manual",
      quoted_at: "2026-11-18T12:00:00.000Z",
      captured_at: "2026-11-18T12:01:00.000Z",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      base_currency: "ARS",
      quote_currency: "ARS",
      rate_to_base: 1,
      source: "Manual",
      quoted_at: "2026-11-18T11:00:00.000Z",
      captured_at: "2026-11-18T11:01:00.000Z",
    },
  ];
});

afterEach(cleanup);

describe("PricingWorkspace", () => {
  it("muestra título y subtítulo de negocio sin snapshots ni listas de precios", async () => {
    renderWorkspace();

    expect(await screen.findByText("Precios, monedas y tipo de cambio")).toBeInTheDocument();
    expect(
      screen.getByText("Historial de tipos de cambio usados en presupuestos y ventas."),
    ).toBeInTheDocument();

    expect(screen.queryByText(/snapshots/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Listas de Precios/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/listas de precios/i)).not.toBeInTheDocument();
  });

  it("formatea los tipos de cambio con separadores de Argentina y usa 'Tipo de cambio'", async () => {
    renderWorkspace();

    const formattedUsdValues = await screen.findAllByText(/ARS\s*1\.000,00/);
    expect(formattedUsdValues.length).toBeGreaterThanOrEqual(2);
    const formattedArsValues = screen.getAllByText(/ARS\s*1,00/);
    expect(formattedArsValues.length).toBeGreaterThanOrEqual(2);

    expect(screen.queryByText(/^1000$/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Registrar tipo de cambio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar tipo de cambio" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Historial de tipos de cambio" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Tipo de cambio" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tipo de cambio a moneda base (obligatorio)")).toBeInTheDocument();
  });
});
