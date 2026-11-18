import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ErpAuthContext, type ErpAuthContextValue } from "../../auth/ErpAuthContext";
import { AuditWorkspace } from "./AuditWorkspace";
import type { AuditEventRow } from "./api";

const USER_ID_1 = "3b7a2273-0000-4000-8000-000000000001";
const USER_ID_2 = "9f1c4488-0000-4000-8000-000000000002";

const mock = vi.hoisted(() => ({
  rows: [] as AuditEventRow[],
  actorColumnAvailable: true,
  profiles: [] as Array<{ id: string; display_name: string }>,
  profileInCalls: [] as string[][],
}));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    listAuditEvents: vi.fn(async () => ({
      rows: mock.rows,
      actorColumnAvailable: mock.actorColumnAvailable,
    })),
    exportAuditEvents: vi.fn(async () => ({
      rows: mock.rows,
      truncated: false,
    })),
  };
});

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "profiles") {
        throw new Error(`Unexpected table query: ${table}`);
      }
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => {
            mock.profileInCalls.push(ids);
            return Promise.resolve({
              data: mock.profiles.filter((p) => ids.includes(p.id)),
              error: null,
            });
          },
        }),
      };
    },
  },
}));

const renderWorkspace = (permissions: string[] = ["audit.view"]) => {
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
      <AuditWorkspace />
    </ErpAuthContext.Provider>,
  );
};

beforeEach(() => {
  mock.rows = [];
  mock.actorColumnAvailable = true;
  mock.profiles = [];
  mock.profileInCalls = [];
});

afterEach(cleanup);

describe("AuditWorkspace", () => {
  it("muestra etiquetas de negocio, operador por nombre y sin audit.view", async () => {
    mock.rows = [
      {
        id: 1,
        occurred_at: "2026-11-18T12:00:00.000Z",
        actor_user_id: USER_ID_1,
        schema_name: "erp",
        table_name: "supplier_account_entries",
        record_id: "entry-1",
        action: "INSERT",
        reason: null,
        correlation_id: "corr-single-1",
        metadata: {},
      },
      {
        id: 2,
        occurred_at: "2026-11-18T11:55:00.000Z",
        actor_user_id: USER_ID_2,
        schema_name: "erp",
        table_name: "inventory_cost_balances",
        record_id: "bal-2",
        action: "update",
        reason: "Ajuste manual de costo",
        correlation_id: "",
        metadata: {},
      },
    ];
    mock.profiles = [{ id: USER_ID_1, display_name: "Lucía Gómez" }];

    renderWorkspace();

    expect(await screen.findByText("Lucía Gómez")).toBeInTheDocument();
    expect(screen.getByText("Usuario del sistema")).toBeInTheDocument();
    expect(screen.queryByText(/Usuario 3b7a2273/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Usuario 9f1c4488/)).not.toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(within(table).getByText("Alta")).toBeInTheDocument();
    expect(within(table).getByText("Modificación")).toBeInTheDocument();
    expect(within(table).getByText("Alta de Movimientos de cuenta corriente de proveedores")).toBeInTheDocument();
    expect(within(table).getByText("Ajuste manual de costo")).toBeInTheDocument();

    expect(screen.queryByText("supplier_account_entries")).not.toBeInTheDocument();
    expect(screen.queryByText("inventory_cost_balances")).not.toBeInTheDocument();
    expect(screen.queryByText("INSERT")).not.toBeInTheDocument();

    expect(screen.getByText("Solo visible para responsables")).toBeInTheDocument();
    expect(screen.queryByText(/audit\.view/)).not.toBeInTheDocument();

    expect(mock.profileInCalls).toHaveLength(1);
    expect(mock.profileInCalls[0]).toEqual([USER_ID_1, USER_ID_2]);
  });

  it("agrupa visualmente eventos con el mismo correlation_id y permite expandir sus cambios", async () => {
    mock.rows = [
      {
        id: 10,
        occurred_at: "2026-11-18T13:00:00.000Z",
        actor_user_id: USER_ID_1,
        schema_name: "erp",
        table_name: "purchase_orders",
        record_id: "po-10",
        action: "insert",
        reason: "Recepción de compra OC-001",
        correlation_id: "corr-compra-1",
        metadata: {},
      },
      {
        id: 11,
        occurred_at: "2026-11-18T13:00:00.000Z",
        actor_user_id: USER_ID_1,
        schema_name: "erp",
        table_name: "supplier_account_entries",
        record_id: "sae-11",
        action: "insert",
        reason: null,
        correlation_id: "corr-compra-1",
        metadata: {},
      },
      {
        id: 12,
        occurred_at: "2026-11-18T13:00:00.000Z",
        actor_user_id: USER_ID_1,
        schema_name: "erp",
        table_name: "inventory_cost_balances",
        record_id: "icb-12",
        action: "insert",
        reason: null,
        correlation_id: "corr-compra-1",
        metadata: {},
      },
    ];
    mock.profiles = [{ id: USER_ID_1, display_name: "Lucía Gómez" }];

    renderWorkspace();

    const expandBtn = await screen.findByRole("button", { name: /Ver 3 cambios/i });
    expect(expandBtn).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("3 cambios")).toBeInTheDocument();
    expect(screen.queryByText("Alta de Saldos de costo de inventario")).not.toBeInTheDocument();

    fireEvent.click(expandBtn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ocultar cambios/i })).toHaveAttribute("aria-expanded", "true");
    });
    expect(screen.getByText("Alta de Movimientos de cuenta corriente de proveedores")).toBeInTheDocument();
    expect(screen.getByText("Alta de Saldos de costo de inventario")).toBeInTheDocument();
  });

  it("no agrupa filas cuando correlation_id viene vacío", async () => {
    mock.rows = [
      {
        id: 20,
        occurred_at: "2026-11-18T14:00:00.000Z",
        actor_user_id: null,
        schema_name: "erp",
        table_name: "customers",
        record_id: "c-1",
        action: "insert",
        reason: null,
        correlation_id: "",
        metadata: {},
      },
      {
        id: 21,
        occurred_at: "2026-11-18T14:01:00.000Z",
        actor_user_id: null,
        schema_name: "erp",
        table_name: "customers",
        record_id: "c-2",
        action: "insert",
        reason: null,
        correlation_id: "",
        metadata: {},
      },
    ];

    renderWorkspace();

    expect(await screen.findByText("Clientes #c-1")).toBeInTheDocument();
    expect(screen.getByText("Clientes #c-2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ver \d+ cambios/i })).not.toBeInTheDocument();
  });
});
