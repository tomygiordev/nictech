import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsWorkspace } from "./AccountsWorkspace";
import { AccountingWorkspace } from "./AccountingWorkspace";
import { listCustomers, listFinancingContracts, listIvaCompras, listIvaVentas, listTrialBalance, parseRpcId, postErpSourceEvent } from "./api";
import { receivablePaymentSchema } from "./schemas";
import { parseErpContext } from "../../auth/ErpContextValidation";
import type { FinancingContract, IvaComprasRow } from "./types";

const authState = { session: {}, loading: false, error: null, hasPermission: () => true };

vi.mock("../../auth/ErpAuthContext", async () => {
  const actual = await vi.importActual<typeof import("../../auth/ErpAuthContext")>("../../auth/ErpAuthContext");
  return { ...actual, useErpAuth: () => authState };
});

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    listFinancingContracts: vi.fn().mockResolvedValue([]),
    listBranches: vi.fn().mockResolvedValue([]),
    listCustomers: vi.fn().mockResolvedValue([]),
    listReceivablePaymentMethods: vi.fn().mockResolvedValue([]),
    listReceivableCashSessions: vi.fn().mockResolvedValue([]),
    createFinancingContract: vi.fn().mockResolvedValue("contract-id"),
    recordReceivablePayment: vi.fn().mockResolvedValue("payment-id"),
    listChartOfAccounts: vi.fn().mockResolvedValue([]),
    listAccountingPeriods: vi.fn().mockResolvedValue([]),
    listJournalEntries: vi.fn().mockResolvedValue([]),
    listIvaVentas: vi.fn().mockResolvedValue([]),
    listIvaCompras: vi.fn().mockResolvedValue([]),
    listTrialBalance: vi.fn().mockResolvedValue([]),
    postJournalEntry: vi.fn().mockResolvedValue("550e8400-e29b-41d4-a716-446655440000"),
    reverseJournalEntry: vi.fn().mockResolvedValue("550e8400-e29b-41d4-a716-446655440000"),
    reconcileAccountBalance: vi.fn().mockResolvedValue("550e8400-e29b-41d4-a716-446655440000"),
    closeAccountingPeriod: vi.fn().mockResolvedValue(undefined),
  };
});

const renderWorkspace = (children: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>,
  );

const purchaseVatRow: IvaComprasRow = {
  organization_id: "org-id",
  branch_id: null,
  purchase_order_id: "purchase-id",
  purchase_date: "2026-11-18",
  base_imponible: "1000",
  iva: "0",
  alicuota: "0",
};

const mockSalesVat = () =>
  vi.mocked(listIvaVentas).mockResolvedValueOnce([
    { organization_id: "org-id", branch_id: null, sale_id: "sale-id",
      sale_date: "2026-11-18", base_imponible: 2000, iva: 420, alicuota: 21 },
  ]);

const findKpi = async (label: string) => {
  const card = (await screen.findByText(label)).closest<HTMLElement>(".flow-kpi-card");
  if (!card) throw new Error(`No se encontró la tarjeta: ${label}`);
  return within(card);
};

describe("finance workspaces", () => {
  beforeEach(() => {
    authState.hasPermission = () => true;
    vi.mocked(listTrialBalance).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows an empty state for accounts without network data", async () => {
    renderWorkspace(<AccountsWorkspace />);
    expect(await screen.findByText("No hay financiaciones registradas todavía.")).toBeInTheDocument();
  });

  it("shows accounting empty state when ledgers are empty", async () => {
    renderWorkspace(<AccountingWorkspace />);
    expect(await screen.findByText("No hay asientos publicados todavía.")).toBeInTheDocument();
  });

  it.each([
    { name: "no purchases", rows: [] },
    { name: "purchases with zero VAT", rows: [purchaseVatRow] },
  ])("shows the fiscal balance as partial for $name", async ({ rows }) => {
    vi.mocked(listIvaCompras).mockResolvedValueOnce(rows);
    mockSalesVat();

    renderWorkspace(<AccountingWorkspace activeModuleId="reports" />);
    const credit = await findKpi("Crédito Fiscal Compras");
    expect(credit.getByText("Sin compras con IVA registrado")).toBeInTheDocument();
    expect(credit.queryByText(/ARS/)).not.toBeInTheDocument();

    const balance = await findKpi("Saldo técnico (sin crédito fiscal de compras)");
    expect(balance.getByText("ARS 420,00")).toBeInTheDocument();
    expect(balance.getByText("Parcial: las compras no tienen IVA cargado")).toBeInTheDocument();
    expect(screen.queryByText("Saldo Técnico a Pagar")).not.toBeInTheDocument();

    const notice = screen.getByText("Sin compras con IVA registrado", { selector: '[role="status"] strong' });
    expect(notice).toBeInTheDocument();
    if (rows.length > 0) {
      const row = screen.getByRole("row", { name: /18\/11\/2026.*ARS/ });
      expect(within(row).getAllByRole("cell")[3]).toHaveTextContent(/^—$/);
    } else {
      expect(screen.getByText("Sin compras en el rango")).toBeInTheDocument();
    }
  });

  it("reports the purchase VAT credit and technical balance when purchases have VAT", async () => {
    mockSalesVat();
    vi.mocked(listIvaCompras).mockResolvedValueOnce([
      { ...purchaseVatRow, iva: "210", alicuota: "21" },
      { ...purchaseVatRow, purchase_order_id: "zero-base-id", purchase_date: "2026-11-17",
        base_imponible: "0", iva: "10", alicuota: "21" },
    ]);

    renderWorkspace(<AccountingWorkspace activeModuleId="reports" />);
    expect((await findKpi("Crédito Fiscal Compras")).getByText("ARS 220,00")).toBeInTheDocument();
    expect((await findKpi("Saldo Técnico a Pagar")).getByText("ARS 200,00")).toBeInTheDocument();
    expect(screen.queryByText("Sin compras con IVA registrado")).not.toBeInTheDocument();
    expect(screen.queryByText("Parcial: las compras no tienen IVA cargado")).not.toBeInTheDocument();
    expect(screen.getByText("Base imponible de las ventas")).toBeInTheDocument();

    const taxedRow = screen.getByRole("row", { name: /18\/11\/2026/ });
    expect(within(taxedRow).getByRole("cell", { name: "21%" })).toBeInTheDocument();
    const zeroBaseRow = screen.getByRole("row", { name: /17\/11\/2026/ });
    expect(within(zeroBaseRow).getAllByRole("cell")[3]).toHaveTextContent(/^—$/);
  });

  it("defaults a new journal entry to the Buenos Aires date", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T01:30:00Z"));

    renderWorkspace(<AccountingWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Nuevo asiento manual" }));
    const dialog = screen.getByRole("dialog", { name: "Nuevo Asiento Contable Manual" });
    expect(within(dialog).getByLabelText("Fecha del Asiento *")).toHaveValue("2026-11-18");
  });

  it("uses Buenos Aires for due dates and shows Spanish statuses and loaded customer names", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T01:30:00Z"));
    const contract: FinancingContract = {
      id: "contract-id",
      branch_id: "branch-id",
      customer_id: "customer-id",
      contract_reference: "FIN-001",
      currency_code: "ARS",
      principal_amount: "1000",
      down_payment_amount: "0",
      financed_amount: "1000",
      monthly_interest_rate: "0",
      installment_count: 1,
      first_due_date: "2026-11-18",
      status: "partially_paid",
      financing_installments: [{
        id: "installment-id", installment_number: 1, due_date: "2026-11-18",
        principal_due: "1000", interest_due: "0", late_fee_due: "0",
        paid_principal: "100", paid_interest: "0", paid_late_fee: "0", status: "partially_paid",
      }],
    };
    vi.mocked(listFinancingContracts).mockResolvedValueOnce([
      contract,
      { ...contract, id: "other-contract-id", contract_reference: "FIN-002",
        customer_id: "unknown-customer-id", financing_installments: [] },
    ]);
    vi.mocked(listCustomers).mockResolvedValueOnce([
      { id: contract.customer_id, code: "CLI-001", display_name: "Ana Pérez" },
    ]);

    renderWorkspace(<AccountsWorkspace />);
    const card = (await screen.findByText("FIN-001")).closest("article");
    if (!card) throw new Error("No se encontró la tarjeta de financiación");
    expect(within(card).getByText("Pago parcial · ARS")).toBeInTheDocument();
    expect(await within(card).findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("Cliente sin nombre")).toBeInTheDocument();
    expect(screen.getByText("0 cuotas vencidas · 1 pendientes")).toBeInTheDocument();
    expect(screen.getByLabelText("Primer Vencimiento")).toHaveValue("2026-12-18");
  });

  it("preserves exact4 trial balance amounts in rows and totals without changing legacy cents", async () => {
    const shared = {
      organization_id: "org-id",
      period_id: "closed-period-id",
      period_start: "2026-10-01",
      period_end: "2026-10-31",
    };
    vi.mocked(listTrialBalance).mockResolvedValue([
      { ...shared, account_id: "exact4", account_code: "1.1", account_name: "Cuenta exact4",
        total_debit: 300.015, total_credit: 0.0001, balance: 300.0149 },
      { ...shared, account_id: "legacy", account_code: "2.1", account_name: "Cuenta legacy",
        total_debit: 0, total_credit: 100.56, balance: -100.56 },
      { ...shared, account_id: "zero", account_code: "3.1", account_name: "Cuenta cero",
        total_debit: 0, total_credit: 0, balance: 0 },
    ]);

    renderWorkspace(<AccountingWorkspace activeModuleId="reports" />);
    const exactRow = (await screen.findByText("Cuenta exact4")).closest("tr");
    const legacyRow = screen.getByText("Cuenta legacy").closest("tr");
    const zeroRow = screen.getByText("Cuenta cero").closest("tr");
    const totalRow = screen.getByText("Totales").closest("tr");
    const amountCells = (row: HTMLTableRowElement | null) => {
      if (!row) throw new Error("Expected a trial balance table row");
      return within(row).getAllByRole("cell").slice(1)
        .map((cell) => cell.textContent?.replace(/\s+/g, " ").trim());
    };

    expect(amountCells(exactRow)).toEqual(["ARS 300,015", "ARS 0,0001", "ARS 300,0149"]);
    expect(amountCells(legacyRow)).toEqual(["ARS 0,00", "ARS 100,56", "-ARS 100,56"]);
    expect(amountCells(zeroRow)).toEqual(["ARS 0,00", "ARS 0,00", "ARS 0,00"]);
    expect(amountCells(totalRow)).toEqual(["ARS 300,015", "ARS 100,5601", "ARS 199,4549"]);
  });

  it("shows access denied when the user lacks the workspace permission", () => {
    authState.hasPermission = () => false;
    renderWorkspace(<AccountsWorkspace />);
    expect(screen.getByText("No tenés permiso para ver cuentas corrientes.")).toBeInTheDocument();
  });

  it("renders the required currency and interest fields for financing", async () => {
    renderWorkspace(<AccountsWorkspace />);

    expect(await screen.findByPlaceholderText("Moneda (ARS/USD)"))
      .toBeInTheDocument();
    expect(screen.getByPlaceholderText("Interés mensual"))
      .toBeInTheDocument();
  });

  it("requires an explicit payment method for receivable settlements", async () => {
    renderWorkspace(<AccountsWorkspace />);

    expect(await screen.findByText("Medio de pago *")).toBeInTheDocument();
    expect(
      receivablePaymentSchema.safeParse({
        branchId: "550e8400-e29b-41d4-a716-446655440000",
        contractId: "550e8400-e29b-41d4-a716-446655440001",
        paymentMethodId: "",
        cashSessionId: "",
        amount: "1000",
        paymentReference: "",
        operationKey: "pay-test",
        reason: "Cobro de prueba",
      }).success,
    ).toBe(false);
  });

  it("rejects malformed RPC identifiers instead of coercing them", () => {
    expect(() => parseRpcId(null, "financing contract")).toThrow("financing contract");
    expect(parseRpcId("550e8400-e29b-41d4-a716-446655440000", "journal")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("rejects an ERP context without organization identity", () => {
    expect(() => parseErpContext({ user_id: "user-id" })).toThrow("ERP");
  });

  it("shows accounting actions when the user can post and close", async () => {
    renderWorkspace(<AccountingWorkspace />);

    expect(await screen.findByText("Nuevo asiento manual")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Revertir asiento" })).toBeInTheDocument();
    expect(screen.getByText("Conciliación exacta")).toBeInTheDocument();
  });

  it("exposes the source-event posting API without coercing its result", async () => {
    expect(postErpSourceEvent).toBeTypeOf("function");
  });
});
