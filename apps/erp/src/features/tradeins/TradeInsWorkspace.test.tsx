import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TradeInsWorkspace } from "./TradeInsWorkspace";
import { ErpAuthContext } from "../../auth/ErpAuthContext";
import type { TradeInCosts, TradeInOverview } from "./api";

const BRANCH_1 = "11111111-1111-4111-8111-111111111111";
const BRANCH_2 = "11111111-1111-4111-8111-111111111112";
const CUSTOMER_1 = "22222222-2222-4222-8222-222222222222";
const PRODUCT_IMEI = "33333333-3333-4333-8333-333333333333";
const TRADE_IN_1 = "44444444-4444-4444-8444-444444444444";
const EVALUATION_1 = "55555555-5555-4555-8555-555555555555";

const mock = vi.hoisted(() => ({
  tradeIns: [] as TradeInOverview[],
  branches: [] as Array<{ id: string; code: string; name: string }>,
  customers: [] as Array<{ id: string; code: string; display_name: string }>,
  products: [] as Array<{
    id: string;
    internal_code: string;
    internal_name: string;
    inventory_tracking: "serial" | "imei";
  }>,
  listTradeIns: vi.fn(),
  intakeTradeInDirect: vi.fn(),
  reviewTradeInProvenance: vi.fn(),
  requestTradeInImeiCheck: vi.fn(),
  recordTradeInImeiManualFallback: vi.fn(),
  createTradeInEvaluation: vi.fn(),
  reviewTradeInEvaluation: vi.fn(),
  recordTradeInRefurbishment: vi.fn(),
  releaseTradeInToStock: vi.fn(),
  applyTradeInSalePayment: vi.fn(),
  reverseTradeInSalePayment: vi.fn(),
  getTradeInCosts: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    listTradeIns: () => mock.listTradeIns(),
    intakeTradeInDirect: (input: unknown) => mock.intakeTradeInDirect(input),
    reviewTradeInProvenance: (tradeInId: string, decision: "approved" | "rejected", reason?: string) =>
      mock.reviewTradeInProvenance(tradeInId, decision, reason),
    requestTradeInImeiCheck: (tradeInId: string, providerName: string, reason?: string) =>
      mock.requestTradeInImeiCheck(tradeInId, providerName, reason),
    recordTradeInImeiManualFallback: (
      tradeInId: string,
      status: string,
      documentation: unknown,
      reason?: string,
    ) => mock.recordTradeInImeiManualFallback(tradeInId, status, documentation, reason),
    createTradeInEvaluation: (
      tradeInId: string,
      snapshot: unknown,
      appraised: number,
      refurb: number,
      reason?: string,
    ) => mock.createTradeInEvaluation(tradeInId, snapshot, appraised, refurb, reason),
    reviewTradeInEvaluation: (evaluationId: string, decision: "approved" | "rejected", reason?: string) =>
      mock.reviewTradeInEvaluation(evaluationId, decision, reason),
    recordTradeInRefurbishment: (
      tradeInId: string,
      description: string,
      cost: number,
      repairOrderId?: string | null,
      completed?: boolean,
      reason?: string,
    ) => mock.recordTradeInRefurbishment(tradeInId, description, cost, repairOrderId, completed, reason),
    releaseTradeInToStock: (tradeInId: string, locationId: string, reason?: string) =>
      mock.releaseTradeInToStock(tradeInId, locationId, reason),
    applyTradeInSalePayment: (tradeInId: string, saleId: string, amount: number, reason?: string) =>
      mock.applyTradeInSalePayment(tradeInId, saleId, amount, reason),
    reverseTradeInSalePayment: (paymentId: string, reason?: string) =>
      mock.reverseTradeInSalePayment(paymentId, reason),
    getTradeInCosts: (tradeInId: string) => mock.getTradeInCosts(tradeInId),
  };
});

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          const data =
            table === "products"
              ? mock.products
              : table === "branches"
                ? mock.branches
                : table === "customers"
                  ? mock.customers
                  : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  },
}));

const makeTradeIn = (overrides: Partial<TradeInOverview> = {}): TradeInOverview => ({
  id: TRADE_IN_1,
  organization_id: "org-1",
  branch_id: BRANCH_1,
  customer_id: CUSTOMER_1,
  customer_name: "Ana Pérez",
  customer_code: "CLI-001",
  customer_phone: "1155554444",
  product_id: PRODUCT_IMEI,
  product_name: "iPhone 13 128GB",
  product_code: "IPH13-128",
  variant_id: null,
  variant_code: null,
  variant_name: null,
  inventory_unit_id: "unit-1",
  serial_number: null,
  imei: "356938035643809",
  unit_status: "quarantine",
  declared_value_base: 450000,
  received_at: "2026-11-18T12:00:00Z",
  provenance_decision: "approved",
  provenance_reviewed_at: "2026-11-18T12:10:00Z",
  imei_request_version: 1,
  imei_status: "clear",
  imei_source: "provider",
  imei_checked_at: "2026-11-18T12:15:00Z",
  evaluation_id: EVALUATION_1,
  evaluation_version: 1,
  appraised_value_base: 420000,
  estimated_refurbishment_cost_base: 25000,
  evaluation_decision: "approved",
  actual_refurbishment_cost: 0,
  release_id: null,
  release_total_cost: null,
  release_location_id: null,
  released_at: null,
  payment_id: null,
  sale_id: null,
  payment_amount: null,
  payment_applied_at: null,
  stage: "evaluating",
  ...overrides,
});

const ALL_TRADE_IN_PERMISSIONS = [
  "trade_ins.view",
  "trade_ins.manage",
  "trade_ins.approve",
  "costs.view",
  "costs.manage",
  "stock.move",
  "purchases.manage",
  "sales.create",
  "sales.cancel",
];

const renderWorkspace = (permissions: string[] = ALL_TRADE_IN_PERMISSIONS) =>
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
      <TradeInsWorkspace />
    </ErpAuthContext.Provider>,
  );

beforeEach(() => {
  mock.tradeIns = [makeTradeIn()];
  mock.branches = [
    { id: BRANCH_1, code: "SUC1", name: "Casa Central" },
    { id: BRANCH_2, code: "SUC2", name: "Sucursal Norte" },
  ];
  mock.customers = [{ id: CUSTOMER_1, code: "CLI-001", display_name: "Ana Pérez" }];
  mock.products = [
    {
      id: PRODUCT_IMEI,
      internal_code: "IPH13-128",
      internal_name: "iPhone 13 128GB",
      inventory_tracking: "imei",
    },
  ];
  mock.listTradeIns.mockImplementation(async () => mock.tradeIns);
  mock.intakeTradeInDirect.mockResolvedValue(TRADE_IN_1);
  mock.reviewTradeInProvenance.mockResolvedValue("prov-1");
  mock.requestTradeInImeiCheck.mockResolvedValue("imei-req-1");
  mock.recordTradeInImeiManualFallback.mockResolvedValue("imei-fb-1");
  mock.createTradeInEvaluation.mockResolvedValue(EVALUATION_1);
  mock.reviewTradeInEvaluation.mockResolvedValue("eval-rev-1");
  mock.recordTradeInRefurbishment.mockResolvedValue("refurb-1");
  mock.releaseTradeInToStock.mockResolvedValue("doc-1");
  mock.applyTradeInSalePayment.mockResolvedValue("pay-1");
  mock.reverseTradeInSalePayment.mockResolvedValue(undefined);
  mock.getTradeInCosts.mockResolvedValue([
    {
      intake_declared_value_base: 450000,
      accepted_value_base: 420000,
      refurbishment_cost_base: 0,
      total_cost_base: 420000,
    },
  ] satisfies TradeInCosts);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TradeInsWorkspace", () => {
  it("usa el término 'Equipos usados', traduce la decisión 'approved' y no muestra 'Trade-in' ni 'backend'", async () => {
    renderWorkspace();
    await waitFor(() => expect(screen.getByText("iPhone 13 128GB")).toBeInTheDocument());

    expect(screen.getByRole("heading", { name: "Equipos usados", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Estado de verificación del IMEI")).toBeInTheDocument();
    expect(screen.queryByText(/trade-in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/backend/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Detalle/i }));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getAllByText(/Aprobado/i).length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).queryByText(/\bapproved\b/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/trade-in/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/backend/i)).not.toBeInTheDocument();
  });

  it("ingreso vacío asocia labels, muestra errores dentro del diálogo, exige confirmar $0 y no llama a la API si es inválido", async () => {
    renderWorkspace();
    await waitFor(() => expect(screen.getByText("iPhone 13 128GB")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Recibir equipo en parte de pago/i }));
    const dialog = screen.getByRole("dialog");

    await waitFor(() => {
      expect(within(dialog).getByRole("option", { name: /IPH13-128/i })).toBeInTheDocument();
    });

    const branchSelect = within(dialog).getByLabelText(/Sucursal/i) as HTMLSelectElement;
    const customerSelect = within(dialog).getByLabelText(/Cliente/i) as HTMLSelectElement;
    const productSelect = within(dialog).getByLabelText(/Producto compatible/i) as HTMLSelectElement;
    const variantInput = within(dialog).getByLabelText(/Variante/i) as HTMLInputElement;
    const serialInput = within(dialog).getByLabelText(/Serie del equipo/i) as HTMLInputElement;
    const imeiInput = within(dialog).getByLabelText(/IMEI \(14-16 dígitos\)/i) as HTMLInputElement;
    const ownerInput = within(dialog).getByLabelText(/Titular del equipo/i) as HTMLInputElement;
    const declarationInput = within(dialog).getByLabelText(/Declaración de procedencia/i) as HTMLTextAreaElement;
    const valueInput = within(dialog).getByLabelText(/Valor declarado \(base\)/i) as HTMLInputElement;
    const evidenceInput = within(dialog).getByLabelText(/Documento de evidencia/i) as HTMLInputElement;
    const reasonInput = within(dialog).getByLabelText(/Motivo operativo/i) as HTMLInputElement;

    expect(branchSelect.value).toBe("");
    expect(customerSelect.value).toBe("");
    expect(productSelect.value).toBe("");
    expect(valueInput.value).toBe("");
    expect(variantInput).toBeInTheDocument();
    expect(serialInput).toBeInTheDocument();
    expect(evidenceInput).toBeInTheDocument();
    expect(reasonInput).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /Registrar recepción/i }));

    await waitFor(() => {
      expect(within(dialog).getByText("Elegí una sucursal.")).toBeInTheDocument();
    });
    expect(within(dialog).getByText("Elegí un cliente.")).toBeInTheDocument();
    expect(within(dialog).getByText("Elegí un producto compatible.")).toBeInTheDocument();
    expect(within(dialog).getByText("Ingresá el nombre del titular del equipo.")).toBeInTheDocument();
    expect(within(dialog).getByText("Ingresá la declaración de procedencia.")).toBeInTheDocument();
    expect(within(dialog).getByText("Ingresá el valor declarado.")).toBeInTheDocument();
    expect(mock.intakeTradeInDirect).not.toHaveBeenCalled();

    // Valor 0 requiere confirmación explícita
    fireEvent.change(branchSelect, { target: { value: BRANCH_1 } });
    fireEvent.change(customerSelect, { target: { value: CUSTOMER_1 } });
    fireEvent.change(productSelect, { target: { value: PRODUCT_IMEI } });
    fireEvent.change(imeiInput, { target: { value: "356938035643809" } });
    fireEvent.change(ownerInput, { target: { value: "Ana Pérez" } });
    fireEvent.change(declarationInput, { target: { value: "Titular único con factura" } });
    fireEvent.change(valueInput, { target: { value: "0" } });

    const confirmZero = within(dialog).getByLabelText(/Confirmo el valor declarado de \$0/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /Registrar recepción/i }));

    await waitFor(() => {
      expect(within(dialog).getByText("Confirmá el valor declarado de $0.")).toBeInTheDocument();
    });
    expect(mock.intakeTradeInDirect).not.toHaveBeenCalled();

    fireEvent.click(confirmZero);
    fireEvent.click(within(dialog).getByRole("button", { name: /Registrar recepción/i }));

    await waitFor(() => {
      expect(mock.intakeTradeInDirect).toHaveBeenCalledWith({
        branchId: BRANCH_1,
        customerId: CUSTOMER_1,
        productId: PRODUCT_IMEI,
        variantId: null,
        deviceSerial: null,
        deviceImei: "356938035643809",
        ownerName: "Ana Pérez",
        declarationText: "Titular único con factura",
        declaredValue: 0,
        evidenceDoc: null,
        operationReason: undefined,
      });
    });
  });

  it("muestra errores de API dentro del modal de ingreso y del modal de detalle", async () => {
    mock.intakeTradeInDirect.mockRejectedValueOnce(new Error("El IMEI ya está asociado a otro equipo."));
    renderWorkspace();
    await waitFor(() => expect(screen.getByText("iPhone 13 128GB")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Recibir equipo en parte de pago/i }));
    const intakeDialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(within(intakeDialog).getByRole("option", { name: /IPH13-128/i })).toBeInTheDocument();
    });

    fireEvent.change(within(intakeDialog).getByLabelText(/Sucursal/i), { target: { value: BRANCH_1 } });
    fireEvent.change(within(intakeDialog).getByLabelText(/Cliente/i), { target: { value: CUSTOMER_1 } });
    fireEvent.change(within(intakeDialog).getByLabelText(/Producto compatible/i), { target: { value: PRODUCT_IMEI } });
    fireEvent.change(within(intakeDialog).getByLabelText(/IMEI \(14-16 dígitos\)/i), {
      target: { value: "356938035643809" },
    });
    fireEvent.change(within(intakeDialog).getByLabelText(/Titular del equipo/i), {
      target: { value: "Ana Pérez" },
    });
    fireEvent.change(within(intakeDialog).getByLabelText(/Declaración de procedencia/i), {
      target: { value: "Equipo propio" },
    });
    fireEvent.change(within(intakeDialog).getByLabelText(/Valor declarado \(base\)/i), {
      target: { value: "300000" },
    });

    fireEvent.click(within(intakeDialog).getByRole("button", { name: /Registrar recepción/i }));

    await waitFor(() => {
      const alert = within(intakeDialog).getByRole("alert");
      expect(alert).toHaveTextContent("El IMEI ya está asociado a otro equipo.");
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Cerrar ingreso y probar error de API dentro del modal de detalle
    fireEvent.click(within(intakeDialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    mock.createTradeInEvaluation.mockRejectedValueOnce(new Error("La tasación excede el máximo permitido."));
    fireEvent.click(screen.getByRole("button", { name: /Detalle/i }));
    const detailDialog = screen.getByRole("dialog");

    fireEvent.change(within(detailDialog).getByLabelText(/Valor tasado \(base\)/i), {
      target: { value: "410000" },
    });
    fireEvent.change(within(detailDialog).getByLabelText(/Costo reacond\. estimado/i), {
      target: { value: "15000" },
    });
    fireEvent.change(within(detailDialog).getByLabelText(/Estado \/ condición/i), {
      target: { value: "Muy bueno" },
    });

    fireEvent.click(within(detailDialog).getByRole("button", { name: "Crear tasación" }));

    await waitFor(() => {
      const alert = within(detailDialog).getByRole("alert");
      expect(alert).toHaveTextContent("La tasación excede el máximo permitido.");
    });
  });

  it("sin permiso las acciones de escritura quedan deshabilitadas y respeta permisos específicos por RPC", async () => {
    renderWorkspace(["trade_ins.view"]);
    await waitFor(() => expect(screen.getByText("iPhone 13 128GB")).toBeInTheDocument());

    const intakeBtn = screen.getByRole("button", { name: /Recibir equipo en parte de pago/i });
    expect(intakeBtn).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Detalle/i }));
    const dialog = screen.getByRole("dialog");

    const actionNames = [
      "Aprobar procedencia",
      "Rechazar procedencia",
      "Solicitar verificación",
      "Registrar respaldo manual",
      "Crear tasación",
      "Aprobar tasación",
      "Rechazar tasación",
      "Registrar reacondicionamiento",
      "Liberar a stock",
      "Aplicar pago",
      "Revertir pago",
      "Ver costos",
    ];
    for (const name of actionNames) {
      expect(within(dialog).getByRole("button", { name })).toBeDisabled();
    }

    cleanup();

    // Con trade_ins.manage solamente: habilita solicitud IMEI y tasación, pero no approve / costs / sales
    renderWorkspace(["trade_ins.view", "trade_ins.manage"]);
    await waitFor(() => expect(screen.getByText("iPhone 13 128GB")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Recibir equipo en parte de pago/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /Detalle/i }));
    const manageDialog = screen.getByRole("dialog");
    expect(within(manageDialog).getByRole("button", { name: "Solicitar verificación" })).toBeEnabled();
    expect(within(manageDialog).getByRole("button", { name: "Crear tasación" })).toBeEnabled();

    expect(within(manageDialog).getByRole("button", { name: "Registrar respaldo manual" })).toBeDisabled();
    expect(within(manageDialog).getByRole("button", { name: "Aprobar procedencia" })).toBeDisabled();
    expect(within(manageDialog).getByRole("button", { name: "Aprobar tasación" })).toBeDisabled();
    expect(within(manageDialog).getByRole("button", { name: "Registrar reacondicionamiento" })).toBeDisabled();
    expect(within(manageDialog).getByRole("button", { name: "Liberar a stock" })).toBeDisabled();
    expect(within(manageDialog).getByRole("button", { name: "Aplicar pago" })).toBeDisabled();
    expect(within(manageDialog).getByRole("button", { name: "Revertir pago" })).toBeDisabled();
  });
});
