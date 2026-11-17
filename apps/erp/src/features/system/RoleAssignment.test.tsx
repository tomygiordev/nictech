import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ErpAuthContext, type ErpAuthContextValue } from "../../auth/ErpAuthContext";
import { RoleAssignment } from "./RoleAssignment";
import { assignProfileRole, listRolesAndAssignments } from "./api";

vi.mock("./api", () => ({
  assignProfileRole: vi.fn(),
  listRolesAndAssignments: vi.fn(),
}));

const owner = "10000000-0000-0000-0000-000000000001";
const target = "10000000-0000-0000-0000-000000000002";
const assignedUser = "10000000-0000-0000-0000-000000000003";
const inactiveUser = "10000000-0000-0000-0000-000000000004";
const ownerRole = "20000000-0000-0000-0000-000000000001";
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

const context: ErpAuthContextValue = {
  session,
  organizationId: "org",
  branchIds: [],
  permissions: [],
  loading: false,
  error: null,
  hasPermission: () => true,
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
    { id: ownerRole, code: "owner", name: "Responsable" },
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
  vi.mocked(assignProfileRole).mockResolvedValue();
});

describe("asignación de roles", () => {
  it("permite enviar asignación para usuario sin rol", async () => {
    render(
      <ErpAuthContext.Provider value={context}>
        <RoleAssignment users={users} />
      </ErpAuthContext.Provider>,
    );

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
    expect(screen.getByRole("option", { name: "Ventas (sales)" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Responsable (owner)" }),
    ).toBeInTheDocument();

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

  it("no ofrece asignación a otro rol", async () => {
    vi.mocked(listRolesAndAssignments).mockResolvedValue({
      ...data,
      assignments: [],
    });

    render(
      <ErpAuthContext.Provider value={context}>
        <RoleAssignment users={users} />
      </ErpAuthContext.Provider>,
    );

    const item = await screen.findByRole("listitem");
    expect(item).toHaveTextContent(
      "Operador: Sin rol — pendiente de asignación",
    );
    expect(
      screen.getByText("Sin rol — pendiente de asignación"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Asignar rol" }),
    ).not.toBeInTheDocument();
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

    render(
      <ErpAuthContext.Provider value={context}>
        <RoleAssignment users={mixedUsers} />
      </ErpAuthContext.Provider>,
    );

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

    render(
      <ErpAuthContext.Provider value={context}>
        <RoleAssignment users={users} />
      </ErpAuthContext.Provider>,
    );

    const item = await screen.findByRole("listitem");
    expect(item).toHaveTextContent(
      "Operador: Sin rol — pendiente de asignación",
    );
    expect(
      screen.getByText("Sin rol — pendiente de asignación"),
    ).toBeInTheDocument();

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
