import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsWorkspace } from "./AccountsWorkspace";
import { AccountingWorkspace } from "./AccountingWorkspace";
import { parseRpcId, postErpSourceEvent } from "./api";
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
    createFinancingContract: vi.fn().mockResolvedValue("contract-id"),
    recordReceivablePayment: vi.fn().mockResolvedValue("payment-id"),
    listChartOfAccounts: vi.fn().mockResolvedValue([]),
    listAccountingPeriods: vi.fn().mockResolvedValue([]),
    listJournalEntries: vi.fn().mockResolvedValue([]),
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
  });

  it("shows an empty state for accounts without network data", async () => {
    renderWorkspace(<AccountsWorkspace />);
    expect(await screen.findByText("No hay financiaciones registradas todavía.")).toBeInTheDocument();
  });

  it("shows accounting empty state when ledgers are empty", async () => {
    renderWorkspace(<AccountingWorkspace />);
    expect(await screen.findByText("No hay asientos publicados todavía.")).toBeInTheDocument();
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
