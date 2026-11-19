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
const PRODUCT_SERIAL = "33333333-3333-4333-8333-333333333334";
const VARIANT_ACTIVE = "55555555-5555-4555-8555-555555555551";
const VARIANT_INACTIVE = "55555555-5555-4555-8555-555555555552";
const TRADE_IN_1 = "44444444-4444-4444-8444-444444444444";
const EVALUATION_1 = "55555555-5555-4555-8555-555555555555";
const LOCATION_1 = "66666666-6666-4666-8666-666666666661";
const LOCATION_2 = "66666666-6666-4666-8666-666666666662";
const SALE_1 = "77777777-7777-4777-8777-777777777771";
const DOC_1 = "88888888-8888-4888-8888-888888888881";
const REPAIR_1 = "99999999-9999-4999-8999-999999999991";

const mock = vi.hoisted(() => ({
  tradeIns: [] as TradeInOverview[],
  branches: [] as Array<{ id: string; code: string; name: string }>,
  customers: [] as Array<{ id: string; code: string; display_name: string }>,
  products: [] as Array<{
    id: string;
    internal_code: string;
    internal_name: string;
    inventory_tracking: "serial" | "imei";
    product_variants?: Array<{ id: string; code: string; name: string; is_active: boolean }>;
  }>,
  locations: [] as Array<{
    id: string;
    branch_id: string;
    name: string;
    is_active?: boolean;
    allows_sale?: boolean;
  }>,
  sales: [] as Array<{
    id: string;
    branch_id: string;
    customer_id: string | null;
    confirmed_at: string;
    total_amount: number;
    exchange_rate: number;
    currency_code: string;
    customers: { display_name: string | null } | null;
  }>,
  saleStateEvents: [] as Array<{ sale_id: string; sale_state: string | null }>,
  documents: [] as Array<{
    id: string;
    branch_id: string;
    owner_type?: string;
    owner_id: string;
    document_number: string;
    customer_snapshot: Record<string, unknown>;
    status: string;
    issued_at: string;
  }>,
  documentEvents: [] as Array<{ document_id: string; status: string; event_sequence: number }>,
  documentAmounts: [] as Array<{ document_id: string; amount_ars: number }>,
  repairOrders: [] as Array<{
    id: string;
    branch_id: string;
    customer_id: string | null;
    order_code: string;
    opened_at: string;
    customer_name: string;
    brand_snapshot: string;
    model_snapshot: string;
    status_name: string;
    delivery_id: string | null;
  }>,
  supabaseCalls: [] as Array<{
    table: string;
    eqs: Array<[string, unknown]>;
    nots: Array<[string, string, unknown]>;
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
      const filters: Record<string, unknown> = {};
      const inFilters: Record<string, unknown[]> = {};
      const notFilters: Array<[string, string, unknown]> = [];
      const callRecord = {
        table,
        eqs: [] as Array<[string, unknown]>,
        nots: [] as Array<[string, string, unknown]>,
      };
      mock.supabaseCalls.push(callRecord);

      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          callRecord.eqs.push([column, value]);
          return chain;
        },
        in: (column: string, values: unknown[]) => {
          inFilters[column] = values;
          return chain;
        },
        not: (column: string, operator: string, value: unknown) => {
          notFilters.push([column, operator, value]);
          callRecord.nots.push([column, operator, value]);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          const matchesRow = (row: Record<string, unknown>) => {
            for (const [col, val] of Object.entries(filters)) {
              if (row[col] !== val) return false;
            }
            for (const [col, vals] of Object.entries(inFilters)) {
              if (!vals.includes(row[col])) return false;
            }
            for (const [col, op, val] of notFilters) {
              if (op === "is" && val === null) {
                if (row[col] === null || row[col] === undefined) return false;
              } else if (row[col] === val) {
                return false;
              }
            }
            return true;
          };

          let data: unknown[] = [];
          if (table === "products") data = mock.products;
          else if (table === "branches") data = mock.branches;
          else if (table === "customers") data = mock.customers;
          else if (table === "locations") data = mock.locations.filter((l) => matchesRow(l));
          else if (table === "sales") data = mock.sales.filter((s) => matchesRow(s));
          else if (table === "sale_state_events") data = mock.saleStateEvents.filter((e) => matchesRow(e));
          else if (table === "documents") data = mock.documents.filter((d) => matchesRow(d));
          else if (table === "document_events") data = mock.documentEvents;
          else if (table === "repair_orders_overview") data = mock.repairOrders.filter((r) => matchesRow(r));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
    rpc: (fn: string) => {
      if (fn === "list_document_sale_amounts") {
        return Promise.resolve({ data: mock.documentAmounts, error: null });
      }
      return Promise.resolve({ data: null, error: null });
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
      product_variants: [
        { id: VARIANT_ACTIVE, code: "NEG", name: "Negro", is_active: true },
        { id: VARIANT_INACTIVE, code: "OLD", name: "Inactiva", is_active: false },
      ],
    },
    {
      id: PRODUCT_SERIAL,
      internal_code: "MBP-M2",
      internal_name: "MacBook Pro M2",
      inventory_tracking: "serial",
      product_variants: [],
    },
  ];
  mock.supabaseCalls = [];
  mock.locations = [
    { id: LOCATION_1, branch_id: BRANCH_1, name: "Depósito Central", is_active: true, allows_sale: true },
    { id: LOCATION_2, branch_id: BRANCH_2, name: "Depósito Norte", is_active: true, allows_sale: true },
  ];
  mock.sales = [
    {
      id: SALE_1,
      branch_id: BRANCH_1,
      customer_id: CUSTOMER_1,
      confirmed_at: "2026-11-18T14:00:00Z",
      total_amount: 850000,
      exchange_rate: 1,
      currency_code: "ARS",
      customers: { display_name: "Ana Pérez" },
    },
  ];
  mock.saleStateEvents = [];
  mock.documents = [
    {
      id: DOC_1,
      branch_id: BRANCH_1,
      owner_type: "sale",
      owner_id: SALE_1,
      document_number: "NF-00000042",
      customer_snapshot: { display_name: "Ana Pérez" },
      status: "issued",
      issued_at: "2026-11-18T14:00:00Z",
    },
  ];
  mock.documentEvents = [{ document_id: DOC_1, status: "issued", event_sequence: 1 }];
  mock.documentAmounts = [{ document_id: DOC_1, amount_ars: 850000 }];
  mock.repairOrders = [
    {
      id: REPAIR_1,
      branch_id: BRANCH_1,
      customer_id: CUSTOMER_1,
      order_code: "REP-0015",
      opened_at: "2026-11-17T10:00:00Z",
      customer_name: "Ana Pérez",
      brand_snapshot: "Apple",
      model_snapshot: "iPhone 13",
      status_name: "Entregado",
      delivery_id: "del-1",
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
    const variantSelect = within(dialog).getByLabelText(/Variante/i) as HTMLSelectElement;
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
    expect(variantSelect.value).toBe("");
    expect(within(variantSelect).getByRole("option", { name: "Sin variante" })).toBeInTheDocument();
    expect(valueInput.value).toBe("");
    expect(variantSelect).toBeInTheDocument();
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

  it("permite elegir variante activa del producto (con default 'Sin variante') y resetea al cambiar producto", async () => {
    renderWorkspace();
    await waitFor(() => expect(screen.getByText("iPhone 13 128GB")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Recibir equipo en parte de pago/i }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(within(dialog).getByRole("option", { name: /IPH13-128/i })).toBeInTheDocument();
    });

    const productSelect = within(dialog).getByLabelText(/Producto compatible/i) as HTMLSelectElement;
    const variantSelect = within(dialog).getByLabelText(/Variante/i) as HTMLSelectElement;

    fireEvent.change(productSelect, { target: { value: PRODUCT_IMEI } });
    expect(within(variantSelect).getByRole("option", { name: "Sin variante" })).toBeInTheDocument();
    expect(within(variantSelect).getByRole("option", { name: "NEG · Negro" })).toBeInTheDocument();
    expect(within(variantSelect).queryByRole("option", { name: /Inactiva/i })).not.toBeInTheDocument();

    fireEvent.change(variantSelect, { target: { value: VARIANT_ACTIVE } });
    expect(variantSelect.value).toBe(VARIANT_ACTIVE);

    fireEvent.change(productSelect, { target: { value: PRODUCT_SERIAL } });
    expect(variantSelect.value).toBe("");

    fireEvent.change(productSelect, { target: { value: PRODUCT_IMEI } });
    fireEvent.change(variantSelect, { target: { value: VARIANT_ACTIVE } });
    fireEvent.change(within(dialog).getByLabelText(/Sucursal/i), { target: { value: BRANCH_1 } });
    fireEvent.change(within(dialog).getByLabelText(/Cliente/i), { target: { value: CUSTOMER_1 } });
    fireEvent.change(within(dialog).getByLabelText(/IMEI \(14-16 dígitos\)/i), {
      target: { value: "356938035643809" },
    });
    fireEvent.change(within(dialog).getByLabelText(/Titular del equipo/i), {
      target: { value: "Ana Pérez" },
    });
    fireEvent.change(within(dialog).getByLabelText(/Declaración de procedencia/i), {
      target: { value: "Equipo propio" },
    });
    fireEvent.change(within(dialog).getByLabelText(/Valor declarado \(base\)/i), {
      target: { value: "300000" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: /Registrar recepción/i }));

    await waitFor(() => {
      expect(mock.intakeTradeInDirect).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: PRODUCT_IMEI,
          variantId: VARIANT_ACTIVE,
        }),
      );
    });
  });

  it("usa selects de depósito, venta, orden y checklist de documentación sin pedir UUIDs ni JSON, y limpia el aviso de éxito anterior", async () => {
    mock.tradeIns = [
      makeTradeIn({
        release_id: "rel-1",
        released_at: "2026-11-18T13:00:00Z",
        stage: "ready_for_stock",
      }),
    ];

    renderWorkspace();
    await waitFor(() => expect(screen.getByText("iPhone 13 128GB")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Detalle/i }));
    const dialog = screen.getByRole("dialog");

    // No deben existir inputs de texto pidiendo UUIDs o JSON
    expect(within(dialog).queryByPlaceholderText(/UUID/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByPlaceholderText(/\{.*\}/i)).not.toBeInTheDocument();

    // Esperar a que carguen las opciones de depósito, venta y orden de la sucursal
    const locationSelect = within(dialog).getByLabelText(/Depósito destino/i) as HTMLSelectElement;
    const saleSelect = within(dialog).getByLabelText(/Venta destino/i) as HTMLSelectElement;
    const repairOrderSelect = within(dialog).getByLabelText(/Orden de reparación/i) as HTMLSelectElement;

    await waitFor(() => {
      expect(within(locationSelect).getByRole("option", { name: "Depósito Central" })).toBeInTheDocument();
      expect(within(saleSelect).getByRole("option", { name: /NF-00000042.*Ana Pérez/i })).toBeInTheDocument();
      expect(within(repairOrderSelect).getByRole("option", { name: /REP-0015.*Ana Pérez/i })).toBeInTheDocument();
    });

    // Solo ubicaciones de la sucursal del canje (BRANCH_1)
    expect(within(locationSelect).queryByRole("option", { name: "Depósito Norte" })).not.toBeInTheDocument();
    expect(within(repairOrderSelect).getByRole("option", { name: "Sin orden de reparación" })).toBeInTheDocument();

    // Checklist de documentación exige al menos una casilla o una observación
    fireEvent.change(within(dialog).getByLabelText(/Respaldo manual/i), { target: { value: "clear" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar respaldo manual" }));

    await waitFor(() => {
      expect(
        within(dialog).getByText("Marcá al menos una casilla de documentación o ingresá observaciones."),
      ).toBeInTheDocument();
    });
    expect(mock.recordTradeInImeiManualFallback).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByLabelText("DNI del vendedor verificado"));
    fireEvent.change(within(dialog).getByLabelText("Observaciones"), {
      target: { value: "Verificado en mostrador" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar respaldo manual" }));

    await waitFor(() => {
      expect(mock.recordTradeInImeiManualFallback).toHaveBeenCalledWith(
        TRADE_IN_1,
        "clear",
        { dni_vendedor_verificado: true, observaciones: "Verificado en mostrador" },
        undefined,
      );
    });
    await waitFor(() => {
      expect(within(dialog).getByText("Respaldo manual de IMEI registrado.")).toBeInTheDocument();
    });

    // Enviar otro formulario con error de validación limpia el aviso de éxito anterior
    fireEvent.click(within(dialog).getByRole("button", { name: "Aplicar pago" }));
    await waitFor(() => {
      expect(within(dialog).getByText("Elegí una venta destino.")).toBeInTheDocument();
    });
    expect(within(dialog).queryByText("Respaldo manual de IMEI registrado.")).not.toBeInTheDocument();

    // Seleccionar depósito, orden y venta existentes
    fireEvent.change(locationSelect, { target: { value: LOCATION_1 } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Liberar a stock" }));
    await waitFor(() => {
      expect(mock.releaseTradeInToStock).toHaveBeenCalledWith(TRADE_IN_1, LOCATION_1, undefined);
    });
    await waitFor(() => {
      expect(within(dialog).getByText("Equipo liberado a stock.")).toBeInTheDocument();
    });

    // Si falla la API en otro formulario, detailSuccess no se muestra junto al error
    mock.applyTradeInSalePayment.mockRejectedValueOnce(
      new Error("El monto supera el saldo pendiente de la venta."),
    );
    fireEvent.change(saleSelect, { target: { value: SALE_1 } });
    fireEvent.change(within(dialog).getByLabelText(/Monto/i), { target: { value: "420000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Aplicar pago" }));

    await waitFor(() => {
      expect(within(dialog).getByText("El monto supera el saldo pendiente de la venta.")).toBeInTheDocument();
    });
    expect(within(dialog).queryByText("Equipo liberado a stock.")).not.toBeInTheDocument();

    // Orden de reparación seleccionada en reacondicionamiento
    fireEvent.change(within(dialog).getByLabelText(/Descripción/i), { target: { value: "Limpieza" } });
    fireEvent.change(within(dialog).getByLabelText(/Costo real/i), { target: { value: "10000" } });
    fireEvent.change(repairOrderSelect, { target: { value: REPAIR_1 } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar reacondicionamiento" }));

    await waitFor(() => {
      expect(mock.recordTradeInRefurbishment).toHaveBeenCalledWith(
        TRADE_IN_1,
        "Limpieza",
        10000,
        REPAIR_1,
        true,
        undefined,
      );
    });
  });

  it("filtra depósitos con allows_sale=true, ventas activas del mismo cliente y órdenes entregadas del cliente", async () => {
    const OTHER_CUSTOMER = "22222222-2222-4222-8222-222222222299";
    const SALE_CANCELLED = "77777777-7777-4777-8777-777777777798";
    const SALE_OTHER = "77777777-7777-4777-8777-777777777799";

    mock.locations = [
      { id: "loc-quarantine", branch_id: BRANCH_1, name: "Cuarentena de canjes", is_active: true, allows_sale: false },
      { id: LOCATION_1, branch_id: BRANCH_1, name: "Depósito Central", is_active: true, allows_sale: true },
    ];
    mock.sales = [
      {
        id: SALE_1,
        branch_id: BRANCH_1,
        customer_id: CUSTOMER_1,
        confirmed_at: "2026-11-18T14:00:00Z",
        total_amount: 850000,
        exchange_rate: 1,
        currency_code: "ARS",
        customers: { display_name: "Ana Pérez" },
      },
      {
        id: SALE_CANCELLED,
        branch_id: BRANCH_1,
        customer_id: CUSTOMER_1,
        confirmed_at: "2026-11-18T13:00:00Z",
        total_amount: 500000,
        exchange_rate: 1,
        currency_code: "ARS",
        customers: { display_name: "Ana Pérez" },
      },
      {
        id: SALE_OTHER,
        branch_id: BRANCH_1,
        customer_id: OTHER_CUSTOMER,
        confirmed_at: "2026-11-18T15:00:00Z",
        total_amount: 900000,
        exchange_rate: 1,
        currency_code: "ARS",
        customers: { display_name: "Otro Cliente" },
      },
    ];
    mock.saleStateEvents = [{ sale_id: SALE_CANCELLED, sale_state: "cancelled" }];
    mock.documents = [
      {
        id: DOC_1,
        branch_id: BRANCH_1,
        owner_type: "sale",
        owner_id: SALE_1,
        document_number: "NF-00000042",
        customer_snapshot: { display_name: "Ana Pérez" },
        status: "issued",
        issued_at: "2026-11-18T14:00:00Z",
      },
      {
        id: "doc-cancelled",
        branch_id: BRANCH_1,
        owner_type: "sale",
        owner_id: SALE_CANCELLED,
        document_number: "NF-00000041",
        customer_snapshot: { display_name: "Ana Pérez" },
        status: "issued",
        issued_at: "2026-11-18T13:00:00Z",
      },
      {
        id: "doc-other",
        branch_id: BRANCH_1,
        owner_type: "sale",
        owner_id: SALE_OTHER,
        document_number: "NF-00000043",
        customer_snapshot: { display_name: "Otro Cliente" },
        status: "issued",
        issued_at: "2026-11-18T15:00:00Z",
      },
    ];
    mock.repairOrders = [
      {
        id: REPAIR_1,
        branch_id: BRANCH_1,
        customer_id: CUSTOMER_1,
        order_code: "REP-0015",
        opened_at: "2026-11-17T10:00:00Z",
        customer_name: "Ana Pérez",
        brand_snapshot: "Apple",
        model_snapshot: "iPhone 13",
        status_name: "Entregado",
        delivery_id: "del-1",
      },
      {
        id: "rep-open",
        branch_id: BRANCH_1,
        customer_id: CUSTOMER_1,
        order_code: "REP-0016",
        opened_at: "2026-11-18T10:00:00Z",
        customer_name: "Ana Pérez",
        brand_snapshot: "Samsung",
        model_snapshot: "S23",
        status_name: "En taller",
        delivery_id: null,
      },
      {
        id: "rep-other",
        branch_id: BRANCH_1,
        customer_id: OTHER_CUSTOMER,
        order_code: "REP-0017",
        opened_at: "2026-11-18T11:00:00Z",
        customer_name: "Otro Cliente",
        brand_snapshot: "Motorola",
        model_snapshot: "Edge",
        status_name: "Entregado",
        delivery_id: "del-2",
      },
    ];

    renderWorkspace();
    await waitFor(() => expect(screen.getByText("iPhone 13 128GB")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Detalle/i }));
    const dialog = screen.getByRole("dialog");

    const locationSelect = within(dialog).getByLabelText(/Depósito destino/i) as HTMLSelectElement;
    const saleSelect = within(dialog).getByLabelText(/Venta destino/i) as HTMLSelectElement;
    const repairOrderSelect = within(dialog).getByLabelText(/Orden de reparación/i) as HTMLSelectElement;

    await waitFor(() => {
      expect(within(locationSelect).getByRole("option", { name: "Depósito Central" })).toBeInTheDocument();
      expect(within(saleSelect).getByRole("option", { name: /NF-00000042/i })).toBeInTheDocument();
      expect(within(repairOrderSelect).getByRole("option", { name: /REP-0015/i })).toBeInTheDocument();
    });

    expect(within(locationSelect).queryByRole("option", { name: /Cuarentena de canjes/i })).not.toBeInTheDocument();
    expect(within(saleSelect).queryByRole("option", { name: /NF-00000041/i })).not.toBeInTheDocument();
    expect(within(saleSelect).queryByRole("option", { name: /NF-00000043/i })).not.toBeInTheDocument();
    expect(within(repairOrderSelect).queryByRole("option", { name: /REP-0016/i })).not.toBeInTheDocument();
    expect(within(repairOrderSelect).queryByRole("option", { name: /REP-0017/i })).not.toBeInTheDocument();

    const locCall = mock.supabaseCalls.find((c) => c.table === "locations");
    expect(locCall?.eqs).toContainEqual(["allows_sale", true]);

    const salesCall = mock.supabaseCalls.find((c) => c.table === "sales");
    expect(salesCall?.eqs).toContainEqual(["customer_id", CUSTOMER_1]);

    const repairCall = mock.supabaseCalls.find((c) => c.table === "repair_orders_overview");
    expect(repairCall?.eqs).toContainEqual(["customer_id", CUSTOMER_1]);
    expect(repairCall?.nots).toContainEqual(["delivery_id", "is", null]);
  });

  it("muestra una única opción deshabilitada cuando no hay depósitos habilitados ni ventas del cliente", async () => {
    mock.locations = [
      { id: "loc-quarantine", branch_id: BRANCH_1, name: "Cuarentena de canjes", is_active: true, allows_sale: false },
    ];
    mock.sales = [];
    mock.documents = [];

    renderWorkspace();
    await waitFor(() => expect(screen.getByText("iPhone 13 128GB")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Detalle/i }));
    const dialog = screen.getByRole("dialog");

    const locationSelect = within(dialog).getByLabelText(/Depósito destino/i) as HTMLSelectElement;
    const saleSelect = within(dialog).getByLabelText(/Venta destino/i) as HTMLSelectElement;

    await waitFor(() => {
      const locationOptions = within(locationSelect).getAllByRole("option");
      expect(locationOptions).toHaveLength(1);
      expect(locationOptions[0]).toHaveTextContent("No hay depósitos habilitados para venta");
      expect(locationOptions[0]).toBeDisabled();

      const saleOptions = within(saleSelect).getAllByRole("option");
      expect(saleOptions).toHaveLength(1);
      expect(saleOptions[0]).toHaveTextContent("No hay ventas de este cliente en la sucursal");
      expect(saleOptions[0]).toBeDisabled();
    });
  });
});
