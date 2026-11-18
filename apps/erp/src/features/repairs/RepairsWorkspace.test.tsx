import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErpAuthContext } from "../../auth/ErpAuthContext";
import { RepairsWorkspace } from "./RepairsWorkspace";
import * as api from "./api";

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        then: (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return chain;
    },
  },
}));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    listRepairOrders: vi.fn(),
    listRepairStateEvents: vi.fn(),
    listRepairNotes: vi.fn(),
    listAvailableTransitions: vi.fn(),
    listRepairParts: vi.fn(),
    listRepairLabor: vi.fn(),
    listRepairPayments: vi.fn(),
    transitionRepairOrder: vi.fn(),
    getActiveTestTemplate: vi.fn(),
    recordRepairTestRun: vi.fn(),
  };
});

const baseOrder: api.RepairOrderOverview = {
  id: "11111111-1111-4111-8111-111111111111",
  organization_id: "org-1",
  branch_id: "branch-1",
  order_number: 1,
  order_code: "REP-0001",
  public_tracking_code: "ABCD-1234",
  status_public_stage: "Diagnostico",
  opened_at: "2026-10-01T12:00:00Z",
  customer_id: "cust-1",
  customer_code: "CLI-001",
  customer_name: "Ana Pérez",
  customer_phone: "1155551111",
  customer_email: null,
  equipment_id: "eq-1",
  equipment_type: "Smartphone",
  brand_snapshot: "Samsung",
  model_snapshot: "Galaxy S23",
  reported_fault: "No enciende",
  intake_condition: "Normal",
  intake_damage: null,
  intake_notes: null,
  intake_accessories: [],
  status_id: "st-diag",
  status_code: "diagnosis",
  status_name: "Diagnostico",
  status_is_initial: false,
  status_is_terminal: false,
  status_requires_final_tests: false,
  status_updated_at: "2026-10-01T12:00:00Z",
  status_public_message: "En diagnóstico",
  delivery_id: null,
  recipient_name: null,
  recipient_document_suffix: null,
  delivered_at: null,
  warranty_id: null,
  warranty_ends_at: null,
  latest_quote: null,
  active_parts_count: 0,
  qc_passed: false,
};

const repairOrder: api.RepairOrderOverview = {
  ...baseOrder,
  id: "22222222-2222-4222-8222-222222222222",
  order_number: 2,
  order_code: "REP-0002",
  public_tracking_code: "EFGH-5678",
  customer_name: "Luis Gómez",
  status_id: "st-rep",
  status_code: "repair",
  status_name: "Reparacion",
  status_public_stage: "Reparacion",
};

const deliveredWithWarranty: api.RepairOrderOverview = {
  ...baseOrder,
  id: "33333333-3333-4333-8333-333333333333",
  order_number: 3,
  order_code: "REP-0003",
  public_tracking_code: "IJKL-9012",
  status_code: "ready",
  status_name: "Listo para entregar",
  delivery_id: "deliv-1",
  recipient_name: "Carla Ruiz",
  delivered_at: "2026-10-02T12:00:00Z",
  warranty_id: "war-1",
  warranty_ends_at: "2027-01-01T12:00:00Z",
};

const deliveredWithoutWarranty: api.RepairOrderOverview = {
  ...deliveredWithWarranty,
  id: "44444444-4444-4444-8444-444444444444",
  order_number: 4,
  order_code: "REP-0004",
  public_tracking_code: "MNOP-3456",
  delivery_id: "deliv-2",
  warranty_id: null,
  warranty_ends_at: null,
};

function renderWorkspace() {
  return render(
    <ErpAuthContext.Provider
      value={{
        session: null,
        organizationId: "org-1",
        branchIds: ["branch-1"],
        permissions: ["repairs.view", "repairs.manage", "costs.view"],
        loading: false,
        error: null,
        hasPermission: (perm) => ["repairs.view", "repairs.manage", "costs.view"].includes(perm),
      }}
    >
      <RepairsWorkspace />
    </ErpAuthContext.Provider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listRepairOrders).mockResolvedValue([
    baseOrder,
    repairOrder,
    deliveredWithWarranty,
    deliveredWithoutWarranty,
  ]);
  vi.mocked(api.listRepairStateEvents).mockResolvedValue([
    {
      id: "ev-1",
      repair_order_id: baseOrder.id,
      status_id: "st-diag",
      status_name: "Diagnostico",
      status_code: "diagnosis",
      public_message: "Ingreso a diagnóstico",
      internal_reason: "Inicio",
      occurred_at: "2026-10-01T12:00:00Z",
      actor_id: null,
    },
  ]);
  vi.mocked(api.listRepairNotes).mockResolvedValue([]);
  vi.mocked(api.listAvailableTransitions).mockResolvedValue([
    {
      id: "tr-1",
      to_status_id: "st-rep",
      to_status_name: "Reparacion",
      to_status_code: "repair",
      requires_final_tests: false,
      is_terminal: false,
    },
  ]);
  vi.mocked(api.listRepairParts).mockResolvedValue([]);
  vi.mocked(api.listRepairLabor).mockResolvedValue([]);
  vi.mocked(api.listRepairPayments).mockResolvedValue([]);
  vi.mocked(api.transitionRepairOrder).mockResolvedValue("ev-2");
  vi.mocked(api.getActiveTestTemplate).mockResolvedValue({
    id: "tpl-1",
    template_id: "tpl-root",
    template_name: "Control Final",
    template_code: "FINAL",
    kind: "final",
    version: 1,
    definition: [{ key: "power", label: "Encendido", required: true }],
  });
  vi.mocked(api.recordRepairTestRun).mockResolvedValue("run-1");
});

describe("RepairsWorkspace", () => {
  it("normaliza los estados con tildes en lista, filtros, ficha e historial y cuenta solo entregas con garantía", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const row1 = await screen.findByRole("button", { name: /REP-0001/ });
    const row2 = screen.getByRole("button", { name: /REP-0002/ });
    expect(within(row1).getByText("Diagnóstico")).toBeInTheDocument();
    expect(within(row2).getByText("En reparación")).toBeInTheDocument();

    const filterBar = screen.getByRole("group", { name: "Filtrar reparaciones por estado" });
    expect(within(filterBar).getByRole("button", { name: "Diagnóstico" })).toBeInTheDocument();
    expect(within(filterBar).getByRole("button", { name: "En reparación" })).toBeInTheDocument();
    expect(within(filterBar).getByRole("button", { name: "Listo para entregar" })).toBeInTheDocument();

    const warrantyKpiCard = screen.getByText("Entregados con Garantía").closest(".flow-kpi-card");
    expect(warrantyKpiCard).not.toBeNull();
    expect(within(warrantyKpiCard as HTMLElement).getByText("1")).toBeInTheDocument();

    await user.click(row1);
    const detailDialog = await screen.findByRole("dialog", { name: "Ficha de Reparación: REP-0001" });
    expect(within(detailDialog).getByRole("button", { name: "Avanzar a En reparación" })).toBeInTheDocument();

    await user.click(within(detailDialog).getByRole("tab", { name: /Historial de Trazabilidad/ }));
    expect(within(detailDialog).getByText("Diagnóstico", { selector: "strong" })).toBeInTheDocument();
  });

  it("pide confirmación al avanzar estado, envía nota opcional y muestra error dentro del diálogo si falla", async () => {
    const user = userEvent.setup();
    vi.mocked(api.transitionRepairOrder).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: /REP-0001/ }));
    const detailDialog = await screen.findByRole("dialog", { name: "Ficha de Reparación: REP-0001" });

    await user.click(within(detailDialog).getByRole("button", { name: "Avanzar a En reparación" }));
    expect(api.transitionRepairOrder).not.toHaveBeenCalled();

    const confirmDialog = within(screen.getByRole("dialog", { name: "Pasar a En reparación" }));
    await user.type(confirmDialog.getByLabelText("Nota (opcional)"), "  Se inicia cambio de módulo  ");
    await user.click(confirmDialog.getByRole("button", { name: "Confirmar" }));

    expect(confirmDialog.getByRole("alert")).toHaveTextContent("Sin conexión con el servidor.");
    expect(screen.getByRole("dialog", { name: "Pasar a En reparación" })).toBeInTheDocument();

    await user.click(confirmDialog.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pasar a En reparación" })).not.toBeInTheDocument());
    expect(api.transitionRepairOrder).toHaveBeenLastCalledWith(
      baseOrder.id,
      "st-rep",
      "Se inicia cambio de módulo",
      "Se inicia cambio de módulo",
    );
  });

  it("muestra errores del control de calidad dentro de su diálogo sin cerrarlo", async () => {
    const user = userEvent.setup();
    vi.mocked(api.recordRepairTestRun).mockRejectedValueOnce({ code: "42501" });
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: /REP-0001/ }));
    const detailDialog = await screen.findByRole("dialog", { name: "Ficha de Reparación: REP-0001" });
    await user.click(within(detailDialog).getByRole("button", { name: "Iniciar control final" }));

    const qcDialog = within(await screen.findByRole("dialog", { name: "Control de calidad: REP-0001" }));
    await user.click(qcDialog.getByRole("button", { name: "Aprobado" }));
    await user.click(qcDialog.getByRole("button", { name: "Guardar control de calidad" }));

    expect(qcDialog.getByRole("alert")).toHaveTextContent("No tenés permiso para realizar esta acción.");
    expect(screen.getByRole("dialog", { name: "Control de calidad: REP-0001" })).toBeInTheDocument();
  });
});
