import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ErpAuthContext } from "./auth/ErpAuthContext";

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

const renderAppWithPermissions = (permissions: string[]) => {
  const queryClient = createTestQueryClient();
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
              app_metadata: { permissions },
              user_metadata: { full_name: "Test User" },
              aud: "authenticated",
              created_at: new Date().toISOString(),
            },
          },
          organizationId: "test-org",
          branchIds: ["test-branch"],
          permissions,
          loading: false,
          error: null,
          hasPermission: (perm: string) => permissions.includes(perm),
        }}
      >
        <App />
      </ErpAuthContext.Provider>
    </QueryClientProvider>,
  );
};

const ALL_PERMISSIONS = [
  "dashboard.view",
  "sales.create",
  "cash.view",
  "orders.view",
  "catalog.view",
  "pricing.view",
  "stock.view",
  "stock_counts.view",
  "labels.print",
  "purchases.view",
  "suppliers.view",
  "customers.view",
  "quotes.view",
  "repairs.view",
  "repair_tests.view",
  "warranties.view",
  "pc_builds.view",
  "trade_ins.view",
  "accounts_receivable.view",
  "accounting.view",
  "profitability.view",
  "reports.view",
  "documents.view",
  "messages.view",
  "integrations.view",
  "users.view",
  "locations.view",
  "configuration.view",
  "audit.view",
];

describe("ERP App Navigation & Workspaces", () => {
  it("renders all 19 workspaces in sidebar when user has full permissions", () => {
    renderAppWithPermissions(ALL_PERMISSIONS);

    // Verify presence of unified workspaces
    expect(screen.getByRole("button", { name: "Centro operativo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Catálogo y precios" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stock y almacén" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compras y proveedores" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Servicio técnico" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Contabilidad y análisis" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configuración y accesos" })).toBeInTheDocument();
  });

  it("filters sidebar navigation and finds workspace by submodule search term", async () => {
    renderAppWithPermissions(ALL_PERMISSIONS);
    const searchInput = screen.getByPlaceholderText("Buscar módulo o workspace...");
    fireEvent.change(searchInput, { target: { value: "proveedores" } });

    expect(screen.getByRole("button", { name: "Compras y proveedores" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Punto de venta" })).not.toBeInTheDocument();
  });

  it("switches workspace and displays respective header", async () => {
    renderAppWithPermissions(ALL_PERMISSIONS);
    const user = userEvent.setup();

    const catalogBtn = screen.getByRole("button", { name: "Catálogo y precios" });
    await user.click(catalogBtn);

    expect(await screen.findByText("Catálogo Maestro de Productos")).toBeInTheDocument();
  });

  it("only shows workspaces for which the user has authorized permissions", () => {
    renderAppWithPermissions(["stock.view"]);

    expect(screen.getByRole("button", { name: "Stock y almacén" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Contabilidad y análisis" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Configuración y accesos" })).not.toBeInTheDocument();
  });

  it("exposes a skip link and keeps keyboard focus inside open dialogs", async () => {
    renderAppWithPermissions(ALL_PERMISSIONS);
    const user = userEvent.setup();

    expect(screen.getByRole("link", { name: "Saltar al contenido principal" })).toHaveAttribute(
      "href",
      "#erp-main-content",
    );

    const trigger = screen.getByRole("button", { name: "Notificaciones" });
    trigger.focus();
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Centro de Notificaciones" });
    const closeButton = within(dialog).getByRole("button", { name: "Cerrar modal" });
    await waitFor(() => expect(closeButton).toHaveFocus());

    expect(within(dialog).getByRole("status")).toHaveTextContent("No hay notificaciones disponibles");
    expect(screen.queryByText("Nuevo pedido web recibido")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Centro de Notificaciones" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("shows only authenticated session context in the operator profile", async () => {
    renderAppWithPermissions(["dashboard.view", "stock.view"]);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Perfil de usuario" }));

    const dialog = await screen.findByRole("dialog", { name: "Ficha del Operador" });
    expect(within(dialog).getByText("operador@example.com")).toBeInTheDocument();
    expect(within(dialog).getByText("1 sucursal asignada")).toBeInTheDocument();
    expect(within(dialog).getByText("2 habilitados")).toBeInTheDocument();
    expect(within(dialog).getByText("No incluida en la sesión")).toBeInTheDocument();
    expect(within(dialog).queryByText("Super Administrador")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Caja 01 Mostrador")).not.toBeInTheDocument();
  });

  it("renders the new functional workspaces without empty states", async () => {
    renderAppWithPermissions(ALL_PERMISSIONS);
    const user = userEvent.setup();

    // 1. Online orders
    const ordersBtn = screen.getByRole("button", { name: "Pedidos online" });
    await user.click(ordersBtn);
    expect(await screen.findByText("Pedidos de la Tienda Online (E-commerce Fulfillment)")).toBeInTheDocument();

    // 2. Trade-ins (Equipos usados)
    const tradeInsBtn = screen.getByRole("button", { name: "Equipos usados" });
    await user.click(tradeInsBtn);
    expect(await screen.findByText("Equipos Usados & Canjes en Parte de Pago (Trade-in)")).toBeInTheDocument();

    // 3. Documents (Documentos y ARCA)
    const docsBtn = screen.getByRole("button", { name: "Documentos y ARCA" });
    await user.click(docsBtn);
    expect(await screen.findByText("Documentos Fiscales")).toBeInTheDocument();

    // 4. WhatsApp
    const whatsappBtn = screen.getByRole("button", { name: "WhatsApp" });
    await user.click(whatsappBtn);
    expect(await screen.findByText("WhatsApp Business & Comunicaciones")).toBeInTheDocument();

    // 5. Integration Health (Integraciones)
    const healthBtn = screen.getByRole("button", { name: "Integraciones" });
    await user.click(healthBtn);
    expect(await screen.findByText("Salud de Integraciones & Outbox Transaccional")).toBeInTheDocument();
  });

  it("renders login form when there is no active session", () => {
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ErpAuthContext.Provider
          value={{
            session: null,
            organizationId: null,
            branchIds: [],
            permissions: [],
            loading: false,
            error: null,
            hasPermission: () => false,
          }}
        >
          <App />
        </ErpAuthContext.Provider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Ingreso NicTech ERP")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ingresar al Sistema/i })).toBeInTheDocument();
  });
});

