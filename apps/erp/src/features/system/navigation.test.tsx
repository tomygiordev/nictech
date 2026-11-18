import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErpAuthContext, type ErpAuthContextValue } from "../../auth/ErpAuthContext";
import { App } from "../../App";
import { NavigationSettings } from "./NavigationSettings";
import { NavigationVisibilityContext } from "./navigation";
import { WorkspaceModuleTabs } from "../../components/erp/WorkspaceModuleTabs";
import { listSystemSettings, guardarAjuste } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    listSystemSettings: vi.fn(),
    guardarAjuste: vi.fn(),
    listBranches: vi.fn().mockResolvedValue([]),
    listSystemUsers: vi.fn().mockResolvedValue([]),
    listRolesAndAssignments: vi.fn().mockResolvedValue({ roles: [], assignments: [] }),
    listRoleAssignmentAccess: vi.fn().mockResolvedValue({ canManage: false, allowedRoleIds: [] }),
  };
});
const auth: ErpAuthContextValue = {
  session: null, organizationId: "org", branchIds: [], permissions: [], loading: false, error: null, hasPermission: () => true,
};
const wrap = (component: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ErpAuthContext.Provider value={auth}>{component}</ErpAuthContext.Provider>
  </QueryClientProvider>,
);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(listSystemSettings).mockResolvedValue([]); vi.mocked(guardarAjuste).mockResolvedValue(); });

describe("visibilidad de módulos", () => {
  it("aplica salida en el menú y filtra resultados ocultos", async () => {
    wrap(<App />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Compras y proveedores" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Punto de venta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configuración y accesos" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Buscar en ERP..."), { target: { value: "precios" } });
    expect(screen.queryByRole("button", { name: "Productos y servicios" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compras y proveedores" })).not.toBeInTheDocument();
  });
  it("ante error muestra todo y avisa sin bloquear", async () => {
    vi.mocked(listSystemSettings).mockRejectedValue(new Error("sin conexión"));
    wrap(<App />);
    expect(await screen.findByText(/No se pudo leer el perfil de módulos/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compras y proveedores" })).toBeInTheDocument();
  });
  it("filtra subpestañas agrupadas", () => {
    wrap(<NavigationVisibilityContext.Provider value={["stock", "labels"]}><WorkspaceModuleTabs moduleIds={["stock", "stock-counts", "labels"]} activeModuleId="stock" onSelectModule={vi.fn()} /></NavigationVisibilityContext.Provider>);
    expect(screen.getByRole("tab", { name: "Existencias" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Conteo físico/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Códigos y etiquetas" })).toBeInTheDocument();
  });
  it("guarda perfil personalizado de alcance global", async () => {
    wrap(<NavigationSettings />);
    expect(screen.queryByRole("checkbox", { name: /Conteo físico/i })).not.toBeInTheDocument();
    const checkbox = await screen.findByRole("checkbox", { name: "Compras" });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Guardar módulos" }));
    await waitFor(() => expect(guardarAjuste).toHaveBeenCalledTimes(1));
    const [key, value, branch] = vi.mocked(guardarAjuste).mock.calls[0];
    expect(key).toBe("navigation.module_profile");
    expect(branch).toBeUndefined();
    expect(value).toEqual(expect.objectContaining({ profile: "salida", visible: expect.arrayContaining(["settings", "users", "purchases"]) }));
    expect(await screen.findByText("Visibilidad de módulos guardada.")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: /Personalizar módulos/ })).getByRole("checkbox", { name: "Configuración" })).toBeDisabled();
  });
});
