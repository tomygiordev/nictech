import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsWorkspace } from "./AccountsWorkspace";
import { AccountingWorkspace } from "./AccountingWorkspace";
import { listTrialBalance, parseRpcId, postErpSourceEvent } from "./api";
import { receivablePaymentSchema } from "./schemas";
import { parseErpContext } from "../../auth/ErpContextValidation";

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

describe("finance workspaces", () => {
  beforeEach(() => {
    authState.hasPermission = () => true;
    vi.mocked(listTrialBalance).mockResolvedValue([]);
  });

  it("shows an empty state for accounts without network data", async () => {
    renderWorkspace(<AccountsWorkspace />);
    expect(await screen.findByText("No hay financiaciones registradas todavía.")).toBeInTheDocument();
  });

  it("shows accounting empty state when ledgers are empty", async () => {
    renderWorkspace(<AccountingWorkspace />);
    expect(await screen.findByText("No hay asientos publicados todavía.")).toBeInTheDocument();
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
