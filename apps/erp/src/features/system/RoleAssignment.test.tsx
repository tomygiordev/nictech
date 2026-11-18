import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErpAuthContext, type ErpAuthContextValue } from "../../auth/ErpAuthContext";
import { RoleAssignment } from "./RoleAssignment";
import {
  assignProfileRole,
  listRoleAssignmentAccess,
  listRolesAndAssignments,
} from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    assignProfileRole: vi.fn(),
    listRolesAndAssignments: vi.fn(),
    listRoleAssignmentAccess: vi.fn(),
  };
});

const owner = "10000000-0000-0000-0000-000000000001";
const target = "10000000-0000-0000-0000-000000000002";
const assignedUser = "10000000-0000-0000-0000-000000000003";
const inactiveUser = "10000000-0000-0000-0000-000000000004";
const ownerRole = "20000000-0000-0000-0000-000000000001";
const adminRole = "20000000-0000-0000-0000-000000000003";
const salesRole = "20000000-0000-0000-0000-000000000002";

const session = {
  access_token: "test",
  refresh_token: "test",
  token_type: "bearer" as const,
  expires_in: 3600,
  user: {
    id: owner,
    aud: "authenticated",
    created_at: "",
    app_metadata: {},
    user_metadata: {},
  },
};

const baseContext: ErpAuthContextValue = {
  session,
  organizationId: "org",
  branchIds: [],
  permissions: ["users.manage", "users.view"],
  loading: false,
  error: null,
  hasPermission: () => true,
};

const renderRoleAssignment = (
  propsUsers = users,
  authOverrides: Partial<ErpAuthContextValue> = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ErpAuthContext.Provider value={{ ...baseContext, ...authOverrides }}>
        <RoleAssignment users={propsUsers} />
      </ErpAuthContext.Provider>
    </QueryClientProvider>,
  );
};

const users = [
  {
    id: target,
    display_name: "Operador",
    employee_code: null,
    phone: null,
    is_active: true,
    branch_name: null,
  },
];

const data = {
  roles: [
    { id: ownerRole, code: "owner", name: "Responsable del sistema (owner)" },
    { id: salesRole, code: "sales", name: "Ventas" },
  ],
  assignments: [
    {
      profile_id: owner,
      role_id: ownerRole,
      branch_id: null,
      valid_from: "2020-01-01T00:00:00Z",
      valid_until: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listRolesAndAssignments).mockResolvedValue(data);
  vi.mocked(listRoleAssignmentAccess).mockResolvedValue({
    canManage: true,
    allowedRoleIds: [ownerRole, salesRole],
  });
  vi.mocked(assignProfileRole).mockResolvedValue();
});

describe("asignación de roles", () => {
  it("permite enviar asignación para usuario sin rol", async () => {
    renderRoleAssignment();

    const item = await screen.findByRole("listitem");
    expect(item).toHaveTextContent(
      "Operador: Sin rol — pendiente de asignación",
    );
    expect(
      screen.getByText("Sin rol — pendiente de asignación"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Los usuarios nuevos no tienen acceso hasta que les asignes un rol",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ventas" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Responsable del sistema" }),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Asignar rol" })).toBeEnabled(),
    );

    fireEvent.change(screen.getByLabelText("Operador"), {
      target: { value: target },
    });
    fireEvent.change(screen.getByLabelText("Rol"), {
      target: { value: salesRole },
    });
    fireEvent.click(screen.getByRole("button", { name: "Asignar rol" }));

    await waitFor(() =>
      expect(assignProfileRole).toHaveBeenCalledWith(target, salesRole),
    );
    expect(await screen.findByText(/Rol actualizado/)).toBeInTheDocument();
  });

  it("deshabilita controles con título cuando el usuario no tiene rol global de responsable o administrador", async () => {
    vi.mocked(listRolesAndAssignments).mockResolvedValue({
      ...data,
      assignments: [],
    });

    renderRoleAssignment();

    const item = await screen.findByRole("listitem");
    expect(item).toHaveTextContent(
      "Operador: Sin rol — pendiente de asignación",
    );

    const expectedTitle = "Para asignar roles necesitás un rol global de responsable o administrador.";
    expect(screen.getByLabelText("Operador")).toBeDisabled();
    expect(screen.getByLabelText("Operador")).toHaveAttribute("title", expectedTitle);
    expect(screen.getByLabelText("Rol")).toBeDisabled();
    expect(screen.getByLabelText("Rol")).toHaveAttribute("title", expectedTitle);
    expect(screen.getByRole("button", { name: "Asignar rol" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Asignar rol" })).toHaveAttribute("title", expectedTitle);
  });

  it("deshabilita controles con título cuando falta el permiso users.manage", async () => {
    renderRoleAssignment(users, {
      permissions: ["users.view"],
      hasPermission: (perm) => perm !== "users.manage",
    });

    await screen.findByRole("listitem");

    const expectedTitle = "No tenés permiso para administrar usuarios.";
    expect(screen.getByLabelText("Operador")).toBeDisabled();
    expect(screen.getByLabelText("Operador")).toHaveAttribute("title", expectedTitle);
    expect(screen.getByLabelText("Rol")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Asignar rol" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Asignar rol" })).toHaveAttribute("title", expectedTitle);
  });

  it("restringe roles sensibles o de administración para administradores sin alcance completo", async () => {
    vi.mocked(listRolesAndAssignments).mockResolvedValue({
      roles: [
        { id: ownerRole, code: "owner", name: "Responsable del sistema (owner)" },
        { id: adminRole, code: "admin", name: "Administrador" },
        { id: salesRole, code: "sales", name: "Ventas" },
      ],
      assignments: [
        {
          profile_id: owner,
          role_id: adminRole,
          branch_id: null,
          valid_from: "2020-01-01T00:00:00Z",
          valid_until: null,
        },
      ],
    });
    vi.mocked(listRoleAssignmentAccess).mockResolvedValue({
      canManage: true,
      allowedRoleIds: [salesRole],
    });

    renderRoleAssignment();

    await screen.findByRole("listitem");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Ventas" })).not.toBeDisabled(),
    );

    const ownerOption = screen.getByRole("option", { name: "Responsable del sistema" });
    expect(ownerOption).toBeDisabled();
    expect(ownerOption).toHaveAttribute("title", "No tenés permiso para asignar este rol.");
  });

  it("ordena primero a los usuarios activos sin rol", async () => {
    const mixedUsers = [
      {
        id: assignedUser,
        display_name: "Ana Con Rol",
        employee_code: null,
        phone: null,
        is_active: true,
        branch_name: null,
      },
      {
        id: inactiveUser,
        display_name: "Bruno Inactivo",
        employee_code: null,
        phone: null,
        is_active: false,
        branch_name: null,
      },
      {
        id: target,
        display_name: "Carlos Nuevo",
        employee_code: null,
        phone: null,
        is_active: true,
        branch_name: null,
      },
    ];

    vi.mocked(listRolesAndAssignments).mockResolvedValue({
      ...data,
      assignments: [
        ...data.assignments,
        {
          profile_id: assignedUser,
          role_id: salesRole,
          branch_id: null,
          valid_from: "2020-01-01T00:00:00Z",
          valid_until: null,
        },
      ],
    });

    renderRoleAssignment(mixedUsers);

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(
      "Carlos Nuevo: Sin rol — pendiente de asignación",
    );
    expect(items[1]).toHaveTextContent("Ana Con Rol: Ventas");
    expect(items[2]).toHaveTextContent("Bruno Inactivo: Sin rol");
  });

  it("refresca la lista tras una asignación exitosa", async () => {
    vi.mocked(listRolesAndAssignments)
      .mockResolvedValueOnce(data)
      .mockResolvedValueOnce({
        ...data,
        assignments: [
          ...data.assignments,
          {
            profile_id: target,
            role_id: salesRole,
            branch_id: null,
            valid_from: "2020-01-01T00:00:00Z",
            valid_until: null,
          },
        ],
      });

    renderRoleAssignment();

    const item = await screen.findByRole("listitem");
    expect(item).toHaveTextContent(
      "Operador: Sin rol — pendiente de asignación",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Asignar rol" })).toBeEnabled(),
    );

    fireEvent.change(screen.getByLabelText("Operador"), {
      target: { value: target },
    });
    fireEvent.change(screen.getByLabelText("Rol"), {
      target: { value: salesRole },
    });
    fireEvent.click(screen.getByRole("button", { name: "Asignar rol" }));

    await waitFor(() =>
      expect(listRolesAndAssignments).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(screen.getByRole("listitem")).toHaveTextContent("Operador: Ventas"),
    );
    expect(
      screen.queryByText("Sin rol — pendiente de asignación"),
    ).not.toBeInTheDocument();
  });
});
