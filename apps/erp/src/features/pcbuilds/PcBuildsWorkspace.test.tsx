import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PcBuildsWorkspace } from "./PcBuildsWorkspace";
import { ErpAuthContext } from "../../auth/ErpAuthContext";
import type { PcBuildFormOptions, PcBuildProjectOverview } from "./api";

const BRANCH_1 = "11111111-1111-4111-8111-111111111111";
const BRANCH_2 = "11111111-1111-4111-8111-111111111112";
const CUSTOMER_1 = "22222222-2222-4222-8222-222222222222";
const PRODUCT_1 = "33333333-3333-4333-8333-333333333333";
const TEMPLATE_VERSION_1 = "86600000-0000-0000-0000-000000000001";
const PROJECT_1 = "44444444-4444-4444-8444-444444444444";
const REVISION_1 = "55555555-5555-4555-8555-555555555555";
const BATCH_1 = "66666666-6666-4666-8666-666666666666";
const COMPLETION_1 = "77777777-7777-4777-8777-777777777777";

const mock = vi.hoisted(() => ({
  projects: [] as PcBuildProjectOverview[],
  formOptions: {
    branches: [],
    customers: [],
    products: [],
  } as PcBuildFormOptions,
  templateRows: [] as Array<{
    id: string;
    template_id: string;
    version: number;
    definition: unknown;
    pc_test_templates: { id: string; code: string; name: string; is_active: boolean } | null;
  }>,
  configuredTemplateId: null as string | null,
  listPcBuildProjects: vi.fn(),
  listPcBuildFormOptions: vi.fn(),
  listLatestPcBuildCompatibilityResults: vi.fn(),
  createPcBuildAtomic: vi.fn(),
  createPcBuildRevision: vi.fn(),
  recordPcCompatibilityRun: vi.fn(),
  reservePcBuildComponents: vi.fn(),
  recordPcTestRun: vi.fn(),
  completePcBuild: vi.fn(),
  getPcBuildCosts: vi.fn(),
}));

vi.mock("./api", () => ({
  listPcBuildProjects: () => mock.listPcBuildProjects(),
  listPcBuildFormOptions: () => mock.listPcBuildFormOptions(),
  listLatestPcBuildCompatibilityResults: (projectId: string, revisionId: string) =>
    mock.listLatestPcBuildCompatibilityResults(projectId, revisionId),
  createPcBuildAtomic: (input: unknown) => mock.createPcBuildAtomic(input),
  createPcBuildRevision: (input: unknown) => mock.createPcBuildRevision(input),
  recordPcCompatibilityRun: (revisionId: string, reason?: string) =>
    mock.recordPcCompatibilityRun(revisionId, reason),
  reservePcBuildComponents: (input: unknown) => mock.reservePcBuildComponents(input),
  recordPcTestRun: (input: unknown) => mock.recordPcTestRun(input),
  completePcBuild: (input: unknown) => mock.completePcBuild(input),
  getPcBuildCosts: (completionId: string) => mock.getPcBuildCosts(completionId),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "configuration_values" && mock.configuredTemplateId
              ? { value: mock.configuredTemplateId }
              : null,
            error: null,
          }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          const data = table === "pc_test_template_versions" ? mock.templateRows : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  },
}));

const makeProject = (overrides: Partial<PcBuildProjectOverview> = {}): PcBuildProjectOverview => ({
  id: PROJECT_1,
  organization_id: "org-1",
  branch_id: BRANCH_1,
  customer_id: CUSTOMER_1,
  customer_name: "Ana Pérez",
  customer_code: "CLI-001",
  customer_phone: "1155554444",
  title: "PC Oficina Pro",
  notes: "Armado estándar",
  created_at: "2026-11-18T10:00:00Z",
  current_state: "draft",
  state_changed_at: "2026-11-18T10:00:00Z",
  latest_revision_id: REVISION_1,
  latest_revision_version: 1,
  spec_version_id: null,
  rule_set_version_id: null,
  configuration: {},
  components_count: 1,
  total_components_cost: 150000,
  latest_compatibility_outcome: "pass",
  compatibility_checked_at: "2026-11-18T10:01:00Z",
  reservation_batch_id: null,
  reservation_status: null,
  reservation_expires_at: null,
  latest_test_run_id: null,
  test_completed_at: null,
  completion_id: null,
  equipment_id: null,
  fulfillment_stock_document_id: null,
  built_serial_number: null,
  completed_at: null,
  ...overrides,
});

const renderWorkspace = (permissions: string[] = ["pc_builds.view", "pc_builds.manage", "costs.view"]) =>
  render(
    <ErpAuthContext.Provider
      value={{
        session: null,
        organizationId: "org-1",
        branchIds: [BRANCH_1],
        permissions,
        loading: false,
        error: null,
        hasPermission: (perm) => permissions.includes(perm),
      }}
    >
      <PcBuildsWorkspace />
    </ErpAuthContext.Provider>,
  );

beforeEach(() => {
  mock.projects = [makeProject()];
  mock.formOptions = {
    branches: [{ id: BRANCH_1, code: "SUC1", name: "Casa Central" }],
    customers: [{ id: CUSTOMER_1, code: "CLI-001", display_name: "Ana Pérez" }],
    products: [{ id: PRODUCT_1, internal_code: "CPU-01", internal_name: "Ryzen 5 5600" }],
  };
  mock.templateRows = [
    {
      id: TEMPLATE_VERSION_1,
      template_id: "86200000-0000-0000-0000-000000000001",
      version: 1,
      definition: [
        { key: "post", label: "POST completo", required: true },
        { key: "memory", label: "Prueba de memoria", required: true },
        { key: "storage", label: "Prueba de almacenamiento", required: true },
        { key: "thermal", label: "Prueba termica", required: true },
      ],
      pc_test_templates: {
        id: "86200000-0000-0000-0000-000000000001",
        code: "standard_pc_final",
        name: "Prueba final de PC",
        is_active: true,
      },
    },
  ];
  mock.configuredTemplateId = TEMPLATE_VERSION_1;

  mock.listPcBuildProjects.mockImplementation(async () => mock.projects);
  mock.listPcBuildFormOptions.mockImplementation(async () => mock.formOptions);
  mock.listLatestPcBuildCompatibilityResults.mockResolvedValue([]);
  mock.createPcBuildAtomic.mockResolvedValue({
    project_id: PROJECT_1,
    revision_id: REVISION_1,
    compatibility_run_id: "run-1",
    compatibility_outcome: "pass",
  });
  mock.createPcBuildRevision.mockResolvedValue(REVISION_1);
  mock.recordPcCompatibilityRun.mockResolvedValue("compat-1");
  mock.reservePcBuildComponents.mockResolvedValue(BATCH_1);
  mock.recordPcTestRun.mockResolvedValue("test-run-1");
  mock.completePcBuild.mockResolvedValue("equip-1");
  mock.getPcBuildCosts.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PcBuildsWorkspace", () => {
  it("muestra el título en español 'Armados de PC' sin texto en inglés", async () => {
    renderWorkspace();
    await waitFor(() => expect(screen.getByText("PC Oficina Pro")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Armados de PC" })).toBeInTheDocument();
    expect(screen.queryByText(/PC Builds/i)).not.toBeInTheDocument();
  });

  it("nuevo armado vacío no llama a la API, asocia labels y muestra errores dentro del diálogo", async () => {
    mock.formOptions.branches = [
      { id: BRANCH_1, code: "SUC1", name: "Casa Central" },
      { id: BRANCH_2, code: "SUC2", name: "Sucursal Norte" },
    ];
    renderWorkspace();
    await waitFor(() => expect(screen.getByText("PC Oficina Pro")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Nuevo armado/i }));

    const dialog = screen.getByRole("dialog");
    const branchSelect = within(dialog).getByLabelText(/Sucursal/i) as HTMLSelectElement;
    const customerSelect = within(dialog).getByLabelText(/Cliente/i) as HTMLSelectElement;
    const titleInput = within(dialog).getByLabelText(/Título del armado/i) as HTMLInputElement;
    const slotSelect = within(dialog).getByLabelText(/Slot/i) as HTMLSelectElement;
    const productSelect = within(dialog).getByLabelText(/Producto/i) as HTMLSelectElement;
    const qtyInput = within(dialog).getByLabelText(/Cant\./i) as HTMLInputElement;
    const notesTextarea = within(dialog).getByLabelText(/^Notas$/i) as HTMLTextAreaElement;
    const reasonInput = within(dialog).getByLabelText(/Motivo de operación/i) as HTMLInputElement;

    expect(branchSelect.value).toBe("");
    expect(customerSelect.value).toBe("");
    expect(titleInput.value).toBe("");
    expect(slotSelect.value).toBe("cpu");
    expect(productSelect.value).toBe("");
    expect(qtyInput.value).toBe("1");
    expect(notesTextarea).toBeInTheDocument();
    expect(reasonInput).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /Crear armado/i }));

    await waitFor(() => {
      expect(within(dialog).getByText("Elegí una sucursal.")).toBeInTheDocument();
    });
    expect(within(dialog).getByText("Elegí un cliente.")).toBeInTheDocument();
    expect(within(dialog).getByText("Ingresá el título del armado.")).toBeInTheDocument();
    expect(within(dialog).getByText("Elegí un producto.")).toBeInTheDocument();
    expect(mock.createPcBuildAtomic).not.toHaveBeenCalled();

    // Completar y enviar válido
    fireEvent.change(branchSelect, { target: { value: BRANCH_1 } });
    fireEvent.change(customerSelect, { target: { value: CUSTOMER_1 } });
    fireEvent.change(titleInput, { target: { value: "PC Gamer 4K" } });
    fireEvent.change(productSelect, { target: { value: PRODUCT_1 } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Crear armado/i }));

    await waitFor(() => {
      expect(mock.createPcBuildAtomic).toHaveBeenCalledWith({
        branchId: BRANCH_1,
        customerId: CUSTOMER_1,
        title: "PC Gamer 4K",
        notes: null,
        components: [
          {
            slot_code: "cpu",
            product_id: PRODUCT_1,
            variant_id: null,
            inventory_unit_id: null,
            quantity: "1",
            specifications: {},
            warranty: {},
          },
        ],
        reason: undefined,
      });
    });
  });

  it("la prueba no tiene resultados precargados, exige elegir resultado en cada ítem y envía el payload esperado", async () => {
    mock.projects = [makeProject({ current_state: "reserved", reservation_batch_id: BATCH_1 })];
    renderWorkspace();
    await waitFor(() => expect(screen.getByText("PC Oficina Pro")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Detalle/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/Plantilla de testeo/i)).toHaveValue(TEMPLATE_VERSION_1);
    expect(within(dialog).getByText(/Controles completados:/i)).toHaveTextContent("0/4");

    // Ningún ítem viene aprobado o fallado por defecto
    for (const btn of within(dialog).getAllByRole("button", { name: "Aprobado" })) {
      expect(btn).toHaveAttribute("aria-pressed", "false");
    }
    for (const btn of within(dialog).getAllByRole("button", { name: "Falla" })) {
      expect(btn).toHaveAttribute("aria-pressed", "false");
    }

    // Intentar registrar sin resultados
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar testeo" }));
    await waitFor(() => {
      expect(
        within(dialog).getByText(
          "Registrá un resultado para cada control obligatorio antes de confirmar el testeo.",
        ),
      ).toBeInTheDocument();
    });
    expect(mock.recordPcTestRun).not.toHaveBeenCalled();

    // Seleccionar solo 2 de 4 ítems tampoco alcanza
    fireEvent.click(
      within(within(dialog).getByRole("group", { name: "Resultado de POST completo" })).getByRole("button", {
        name: "Aprobado",
      }),
    );
    fireEvent.click(
      within(within(dialog).getByRole("group", { name: "Resultado de Prueba de memoria" })).getByRole("button", {
        name: "Falla",
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar testeo" }));
    await waitFor(() => {
      expect(
        within(dialog).getByText(
          "Registrá un resultado para cada control obligatorio antes de confirmar el testeo.",
        ),
      ).toBeInTheDocument();
    });
    expect(mock.recordPcTestRun).not.toHaveBeenCalled();

    // Completar los 2 restantes
    fireEvent.click(
      within(within(dialog).getByRole("group", { name: "Resultado de Prueba de almacenamiento" })).getByRole("button", {
        name: "Aprobado",
      }),
    );
    fireEvent.click(
      within(within(dialog).getByRole("group", { name: "Resultado de Prueba termica" })).getByRole("button", {
        name: "Aprobado",
      }),
    );
    fireEvent.change(within(dialog).getByLabelText(/Notas del testeo/i), {
      target: { value: "Memoria con error en slot B2" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar testeo" }));

    await waitFor(() => {
      expect(mock.recordPcTestRun).toHaveBeenCalledWith({
        revisionId: REVISION_1,
        templateVersionId: TEMPLATE_VERSION_1,
        results: [
          { item_key: "post", result: "pass" },
          { item_key: "memory", result: "fail" },
          { item_key: "storage", result: "pass" },
          { item_key: "thermal", result: "pass" },
        ],
        notes: "Memoria con error en slot B2",
      });
    });
  });

  it("completar armado exige días de garantía y serializa la garantía a objeto JSON", async () => {
    mock.projects = [makeProject({ current_state: "tested", reservation_batch_id: BATCH_1 })];
    renderWorkspace();
    await waitFor(() => expect(screen.getByText("PC Oficina Pro")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Detalle/i }));
    const dialog = screen.getByRole("dialog");

    const serialInput = within(dialog).getByLabelText(/Número de serie/i);
    const daysInput = within(dialog).getByLabelText(/Días de garantía/i);
    const conditionsInput = within(dialog).getByLabelText(/Condiciones/i);

    fireEvent.change(serialInput, { target: { value: "NT-PC-0042" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Completar armado" }));

    await waitFor(() => {
      expect(within(dialog).getByText("Ingresá los días de garantía.")).toBeInTheDocument();
    });
    expect(mock.completePcBuild).not.toHaveBeenCalled();

    fireEvent.change(daysInput, { target: { value: "180" } });
    fireEvent.change(conditionsInput, { target: { value: "Cobertura oficial de hardware" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Completar armado" }));

    await waitFor(() => {
      expect(mock.completePcBuild).toHaveBeenCalledWith({
        projectId: PROJECT_1,
        revisionId: REVISION_1,
        reservationBatchId: BATCH_1,
        serial: "NT-PC-0042",
        warranty: {
          warranty_days: 180,
          conditions: "Cobertura oficial de hardware",
        },
        reason: undefined,
      });
    });
  });

  it("sin permiso pc_builds.manage ni costs.view las acciones quedan deshabilitadas con title en español", async () => {
    mock.projects = [
      makeProject({ id: PROJECT_1, title: "Armado en borrador", current_state: "draft" }),
      makeProject({
        id: "44444444-4444-4444-8444-444444444445",
        title: "Armado finalizado",
        current_state: "completed",
        completion_id: COMPLETION_1,
        reservation_batch_id: BATCH_1,
      }),
    ];
    renderWorkspace(["pc_builds.view"]);
    await waitFor(() => expect(screen.getByText("Armado en borrador")).toBeInTheDocument());

    const createBtn = screen.getByRole("button", { name: /Nuevo armado/i });
    expect(createBtn).toBeDisabled();
    expect(createBtn).toHaveAttribute("title", "No tenés permiso para gestionar armados de PC.");

    // Revisar etapas 1..5 en detalle del borrador
    const detailButtons = screen.getAllByRole("button", { name: /Detalle/i });
    fireEvent.click(detailButtons[0]);

    const dialog = screen.getByRole("dialog");
    const revBtn = within(dialog).getByRole("button", { name: "Crear revisión" });
    expect(revBtn).toBeDisabled();
    expect(revBtn).toHaveAttribute("title", "No tenés permiso para gestionar armados de PC.");

    fireEvent.click(within(dialog).getByRole("tab", { name: /2\. Compatibilidad/i }));
    const compatBtn = within(dialog).getByRole("button", { name: "Registrar compatibilidad" });
    expect(compatBtn).toBeDisabled();
    expect(compatBtn).toHaveAttribute("title", "No tenés permiso para gestionar armados de PC.");

    fireEvent.click(within(dialog).getByRole("tab", { name: /3\. Reserva/i }));
    const reserveBtn = within(dialog).getByRole("button", { name: "Reservar componentes" });
    expect(reserveBtn).toBeDisabled();
    expect(reserveBtn).toHaveAttribute("title", "No tenés permiso para gestionar armados de PC.");

    fireEvent.click(within(dialog).getByRole("tab", { name: /4\. Testeo final/i }));
    const testBtn = within(dialog).getByRole("button", { name: "Registrar testeo" });
    expect(testBtn).toBeDisabled();
    expect(testBtn).toHaveAttribute("title", "No tenés permiso para gestionar armados de PC.");

    fireEvent.click(within(dialog).getByRole("tab", { name: /5\. Completar/i }));
    const completeBtn = within(dialog).getByRole("button", { name: "Completar armado" });
    expect(completeBtn).toBeDisabled();
    expect(completeBtn).toHaveAttribute("title", "No tenés permiso para gestionar armados de PC.");

    // Cerrar y abrir el completado para verificar "Ver costos" sin costs.view
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar modal" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Detalle/i })[1]);

    const completedDialog = screen.getByRole("dialog");
    const costsBtn = within(completedDialog).getByRole("button", { name: "Ver costos" });
    expect(costsBtn).toBeDisabled();
    expect(costsBtn).toHaveAttribute("title", "No tenés permiso para ver costos de armados.");
  });
});
