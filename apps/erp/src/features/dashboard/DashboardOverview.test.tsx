import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErpAuthContext } from "../../auth/ErpAuthContext";
import { DashboardOverview } from "./DashboardOverview";

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn((table: string) => ({
    select: vi.fn(() => {
      if (table === "products") {
        return Promise.resolve({ data: null, error: new Error("permiso denegado") });
      }
      return Promise.resolve({ data: [], error: null });
    }),
  })),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: { from: fromMock },
}));

const renderDashboard = () => {
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
          branchIds: ["branch-1", "branch-2"],
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

describe("DashboardOverview operational truth", () => {
  beforeEach(() => {
    fromMock.mockClear();
  });

  it("shows an explicit data error and session-derived operator context", async () => {
    renderDashboard();

    expect(await screen.findByText("No se pudo actualizar el resumen")).toBeInTheDocument();
    expect(screen.getAllByText("No disponible")).toHaveLength(4);
    expect(screen.getByText("3 permisos habilitados")).toBeInTheDocument();
    expect(screen.getByText("2 asignadas")).toBeInTheDocument();
    expect(screen.getByText("Ver módulo Caja")).toBeInTheDocument();
    expect(screen.getByText("No disponibles")).toBeInTheDocument();
    expect(screen.queryByText("Administración & Taller")).not.toBeInTheDocument();
    expect(screen.queryByText("01 Abierta")).not.toBeInTheDocument();
    expect(screen.queryByText("Central")).not.toBeInTheDocument();
  });
});
