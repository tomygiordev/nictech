import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErpAuthContext, type ErpAuthContextValue } from "../../auth/ErpAuthContext";
import { SystemWorkspace } from "./SystemWorkspace";
import {
  listBranches,
  listRoleAssignmentAccess,
  listRolesAndAssignments,
  listSystemSettings,
  listSystemUsers,
} from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    listBranches: vi.fn(),
    listSystemUsers: vi.fn(),
    listSystemSettings: vi.fn(),
    listRolesAndAssignments: vi.fn(),
    listRoleAssignmentAccess: vi.fn(),
    guardarAjuste: vi.fn(),
    assignProfileRole: vi.fn(),
  };
});

const userId = "10000000-0000-0000-0000-000000000010";
const otherUserId = "10000000-0000-0000-0000-000000000011";
const ownerRoleId = "20000000-0000-0000-0000-000000000010";
const salesRoleId = "20000000-0000-0000-0000-000000000011";

const authContext: ErpAuthContextValue = {
  session: {
    access_token: "test",
    refresh_token: "test",
    token_type: "bearer",
    expires_in: 3600,
    user: {
      id: userId,
      aud: "authenticated",
      created_at: "",
      app_metadata: {},
      user_metadata: {},
    },
  },
  organizationId: "org",
  branchIds: ["branch-1"],
  permissions: ["configuration.view", "system.manage", "users.view"],
  loading: false,
  error: null,
  hasPermission: () => true,
};

const renderWorkspace = (
  activeModuleId: "users" | "locations" | "settings" = "settings",
  authOverrides: Partial<ErpAuthContextValue> = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ErpAuthContext.Provider value={{ ...authContext, ...authOverrides }}>
        <SystemWorkspace activeModuleId={activeModuleId} />
      </ErpAuthContext.Provider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listBranches).mockResolvedValue([]);
  vi.mocked(listSystemUsers).mockResolvedValue([]);
  vi.mocked(listSystemSettings).mockResolvedValue([]);
  vi.mocked(listRoleAssignmentAccess).mockResolvedValue({
    canManage: true,
    allowedRoleIds: [ownerRoleId, salesRoleId],
  });
  vi.mocked(listRolesAndAssignments).mockResolvedValue({
    roles: [
      { id: ownerRoleId, code: "owner", name: "Responsable del sistema (owner)" },
      { id: salesRoleId, code: "sales", name: "Ventas" },
    ],
    assignments: [
      {
        profile_id: userId,
        role_id: ownerRoleId,
        branch_id: null,
        valid_from: "2020-01-01T00:00:00Z",
        valid_until: null,
      },
      {
        profile_id: userId,
        role_id: salesRoleId,
        branch_id: null,
        valid_from: "2020-01-01T00:00:00Z",
        valid_until: "2021-01-01T00:00:00Z",
      },
      {
        profile_id: otherUserId,
        role_id: salesRoleId,
        branch_id: null,
        valid_from: "2020-01-01T00:00:00Z",
        valid_until: null,
      },
    ],
  });
});

describe("SystemWorkspace", () => {
  it("oculta ajustes sin efecto en Configuración y muestra el rol real en el badge", async () => {
    renderWorkspace("settings");

    expect(await screen.findByText("Responsable del sistema")).toBeInTheDocument();
    expect(screen.queryByText("Super Admin")).not.toBeInTheDocument();
    expect(screen.queryByText(/Responsable del sistema \(owner\)/)).not.toBeInTheDocument();
    expect(screen.queryByText("Ventas")).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Configuración general" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Módulos visibles" })).toBeInTheDocument();

    expect(screen.queryByText(/Autenticación en Dos Pasos/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cierre Automático/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Envío Automático/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/erp\.system_settings/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Guardar Preferencias/i })).not.toBeInTheDocument();
  });

  it("muestra Sin rol asignado cuando el usuario no tiene asignaciones vigentes", async () => {
    vi.mocked(listRolesAndAssignments).mockResolvedValue({
      roles: [
        { id: ownerRoleId, code: "owner", name: "Responsable del sistema (owner)" },
      ],
      assignments: [],
    });

    renderWorkspace("users");

    await waitFor(() => {
      expect(screen.getByText("Sin rol asignado")).toBeInTheDocument();
    });
    expect(screen.queryByText("Super Admin")).not.toBeInTheDocument();
  });
});
