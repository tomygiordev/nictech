import React, { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PosReceiptPanel } from "./PosReceiptPanel";
import {
  recoverConfirmedTicket,
  type ConfirmedTicketState,
  type PosReceiptRecoveryResult,
} from "./posReceiptFlow";
import * as posApi from "./api";
import { parseDocumentSaleReceipt } from "../documents/api";
import type { DocumentSaleReceipt } from "../../types/DocumentSaleReceipt";

describe("PosReceiptPanel UI component", () => {
  const dummyConfirmedInfo = {
    saleId: "sale-uuid-001",
    documentId: "doc-uuid-001",
    documentNumber: "F-0001-00000001",
    invoiceKind: "fiscal" as const,
  };

  const dummyPersistedReceipt: DocumentSaleReceipt = {
    sale_id: "sale-uuid-001",
    document_id: "doc-uuid-001",
    document_number: "F-0001-00000001",
    invoice_kind: "fiscal",
    branch_name: "Sucursal Central",
    customer_display_name: "Cliente Persistido Real",
    customer_legal_name: "Cliente Legal SA",
    currency_code: "ARS",
    exchange_rate: 1,
    subtotal_amount: 10000,
    discount_amount: 0,
    tax_amount: 2100,
    total_amount: 12100,
    total_ars: 12100,
    confirmed_at: "2026-10-21T01:00:00Z",
    document_status: "issued",
    sale_state: "confirmed",
    payment_state: "paid",
    lines: [
      {
        description: "Celular Samsung A54",
        quantity: 1,
        unit_price: 10000,
        discount_amount: 0,
        tax_rate_percent: 21,
        tax_amount: 2100,
        line_total: 12100,
      },
    ],
    payments: [
      {
        method_name: "Tarjeta de Crédito",
        amount: 12100,
        currency_code: "ARS",
        occurred_at: "2026-10-21T01:00:00Z",
        reversed: false,
      },
    ],
  };

  it("displays persisted facts from receipt (customer, payment method, currency and amount) without using request values", () => {
    const ticket: ConfirmedTicketState = {
      info: dummyConfirmedInfo,
      receipt: dummyPersistedReceipt,
    };

    render(
      <PosReceiptPanel
        ticket={ticket}
        onClose={vi.fn()}
        onRecover={vi.fn()}
      />,
    );

    expect(screen.getByTestId("receipt-customer")).toHaveTextContent("Cliente Persistido Real");
    expect(screen.getByTestId("receipt-payment")).toHaveTextContent("Tarjeta de Crédito");
    expect(screen.getByTestId("receipt-amount")).toHaveTextContent("ARS 12.100,00");
    expect(screen.getByTestId("confirmed-sale-id")).toHaveTextContent("ID Venta ERP: sale-uuid-001");
    expect(screen.getByTestId("confirmed-document-id")).toHaveTextContent("Comprobante fiscal: F-0001-00000001 • Documento ERP: doc-uuid-001");

    expect(screen.getByTestId("print-receipt-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("recover-receipt-btn")).toBeNull();
    expect(screen.queryByTestId("pending-receipt-message")).toBeNull();
  });

  it("displays only confirmed IDs and pending message when receipt is null without inventing customer or amount", () => {
    const ticket: ConfirmedTicketState = {
      info: dummyConfirmedInfo,
      receipt: null,
      recoveryError: "El comprobante aún no devolvió datos persistidos en el ERP.",
    };

    render(
      <PosReceiptPanel
        ticket={ticket}
        onClose={vi.fn()}
        onRecover={vi.fn()}
      />,
    );

    expect(screen.getByTestId("confirmed-sale-id")).toHaveTextContent("ID Venta ERP: sale-uuid-001");
    expect(screen.getByTestId("confirmed-document-id")).toHaveTextContent("Comprobante fiscal: F-0001-00000001 • Documento ERP: doc-uuid-001");
    expect(screen.getByTestId("pending-receipt-message")).toHaveTextContent(
      "El comprobante aún no devolvió datos persistidos en el ERP.",
    );

    expect(screen.queryByTestId("receipt-customer")).toBeNull();
    expect(screen.queryByTestId("receipt-payment")).toBeNull();
    expect(screen.queryByTestId("receipt-amount")).toBeNull();

    expect(screen.getByTestId("recover-receipt-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("print-receipt-btn")).toBeNull();
  });

  it("triggers recovery callback with documentId and indicates loading state", () => {
    const onRecoverMock = vi.fn();
    const ticket: ConfirmedTicketState = {
      info: dummyConfirmedInfo,
      receipt: null,
      recoveryLoading: false,
    };

    const { rerender } = render(
      <PosReceiptPanel
        ticket={ticket}
        onClose={vi.fn()}
        onRecover={onRecoverMock}
      />,
    );

    const recoverBtn = screen.getByTestId("recover-receipt-btn");
    fireEvent.click(recoverBtn);
    expect(onRecoverMock).toHaveBeenCalledWith("doc-uuid-001");

    rerender(
      <PosReceiptPanel
        ticket={{ ...ticket, recoveryLoading: true }}
        onClose={vi.fn()}
        onRecover={onRecoverMock}
      />,
    );

    const loadingBtn = screen.getByTestId("recover-receipt-btn");
    expect(loadingBtn).toBeDisabled();
    expect(loadingBtn).toHaveTextContent("Recuperando...");
  });

  const ticketA: ConfirmedTicketState = {
    info: {
      saleId: "sale-A",
      documentId: "doc-A",
      documentNumber: "F-0001-00000001",
      invoiceKind: "fiscal",
    },
    receipt: null,
  };

  const ticketB: ConfirmedTicketState = {
    info: {
      saleId: "sale-B",
      documentId: "doc-B",
      documentNumber: "F-0001-00000002",
      invoiceKind: "non_fiscal",
    },
    receipt: {
      ...dummyPersistedReceipt,
      sale_id: "sale-B",
      document_id: "doc-B",
      document_number: "F-0001-00000002",
      invoice_kind: "non_fiscal",
      customer_display_name: "Cliente Venta B",
      total_amount: 5000,
    },
  };

  const createSaleWithInvoiceSpy = vi.spyOn(posApi, "createSaleWithInvoice");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const TestHost: React.FC<{
    initialTicket?: ConfirmedTicketState | null;
    ticketB?: ConfirmedTicketState;
    recoverFn?: (documentId: string) => Promise<PosReceiptRecoveryResult>;
  }> = ({
    initialTicket = ticketA,
    ticketB: nextTicket = ticketB,
    recoverFn,
  }) => {
    const [ticket, setTicket] = useState<ConfirmedTicketState | null>(initialTicket);

    const handleRecover = async (documentId: string) => {
      await recoverConfirmedTicket(documentId, setTicket, recoverFn);
    };

    return (
      <div>
        <button
          type="button"
          data-testid="switch-to-b"
          onClick={() => setTicket(nextTicket)}
        >
          Switch to B
        </button>
        {ticket && (
          <PosReceiptPanel
            key={ticket.info.documentId}
            ticket={ticket}
            onClose={() => setTicket(null)}
            onRecover={handleRecover}
          />
        )}
      </div>
    );
  };

  it("prevents delayed recovery of sale A from overwriting sale B after switching tickets", async () => {
    let resolveRecoveryA: ((result: PosReceiptRecoveryResult) => void) | null = null;
    const recoveryPromiseA = new Promise<PosReceiptRecoveryResult>((resolve) => {
      resolveRecoveryA = resolve;
    });

    const recoverFnMock = vi.fn().mockImplementation((docId: string) => {
      if (docId === "doc-A") return recoveryPromiseA;
      return Promise.resolve({
        status: "pending_receipt" as const,
        error: "Not found",
      });
    });

    render(<TestHost recoverFn={recoverFnMock} />);

    expect(screen.getByTestId("confirmed-document-id")).toHaveTextContent("doc-A");

    fireEvent.click(screen.getByTestId("recover-receipt-btn"));
    expect(recoverFnMock).toHaveBeenCalledWith("doc-A");

    fireEvent.click(screen.getByTestId("switch-to-b"));

    expect(screen.getByTestId("confirmed-document-id")).toHaveTextContent("doc-B");
    expect(screen.getByTestId("receipt-customer")).toHaveTextContent("Cliente Venta B");

    await act(async () => {
      resolveRecoveryA!({
        status: "completed",
        receipt: {
          ...dummyPersistedReceipt,
          sale_id: "sale-A",
          document_id: "doc-A",
          document_number: "F-0001-00000001",
          customer_display_name: "Cliente Tardio A",
        },
      });
    });

    expect(screen.getByTestId("confirmed-document-id")).toHaveTextContent("doc-B");
    expect(screen.getByTestId("receipt-customer")).toHaveTextContent("Cliente Venta B");
    expect(createSaleWithInvoiceSpy).not.toHaveBeenCalled();
  });

  it("prevents delayed recovery of sale A from reopening panel after user closes it", async () => {
    let resolveRecoveryA: ((result: PosReceiptRecoveryResult) => void) | null = null;
    const recoveryPromiseA = new Promise<PosReceiptRecoveryResult>((resolve) => {
      resolveRecoveryA = resolve;
    });

    const recoverFnMock = vi.fn().mockImplementation((docId: string) => {
      if (docId === "doc-A") return recoveryPromiseA;
      return Promise.resolve({
        status: "pending_receipt" as const,
        error: "Not found",
      });
    });

    render(<TestHost recoverFn={recoverFnMock} />);

    expect(screen.getByTestId("pos-receipt-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("recover-receipt-btn"));
    expect(recoverFnMock).toHaveBeenCalledWith("doc-A");

    fireEvent.click(screen.getByTestId("close-receipt-panel-btn"));

    expect(screen.queryByTestId("pos-receipt-panel")).toBeNull();

    await act(async () => {
      resolveRecoveryA!({
        status: "completed",
        receipt: {
          ...dummyPersistedReceipt,
          sale_id: "sale-A",
          document_id: "doc-A",
          document_number: "F-0001-00000001",
          customer_display_name: "Cliente Tardio A",
        },
      });
    });

    expect(screen.queryByTestId("pos-receipt-panel")).toBeNull();
    expect(createSaleWithInvoiceSpy).not.toHaveBeenCalled();
  });

  it("successfully recovers receipt and updates panel with persisted facts", async () => {
    let resolveRecoveryA: ((result: PosReceiptRecoveryResult) => void) | null = null;
    const recoveryPromiseA = new Promise<PosReceiptRecoveryResult>((resolve) => {
      resolveRecoveryA = resolve;
    });

    const recoverFnMock = vi.fn().mockReturnValue(recoveryPromiseA);

    render(<TestHost initialTicket={ticketA} recoverFn={recoverFnMock} />);

    expect(screen.getByTestId("confirmed-document-id")).toHaveTextContent("doc-A");
    expect(screen.getByTestId("recover-receipt-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("print-receipt-btn")).toBeNull();

    fireEvent.click(screen.getByTestId("recover-receipt-btn"));
    expect(recoverFnMock).toHaveBeenCalledWith("doc-A");

    await act(async () => {
      resolveRecoveryA!({
        status: "completed",
        receipt: dummyPersistedReceipt,
      });
    });

    expect(screen.getByTestId("receipt-customer")).toHaveTextContent("Cliente Persistido Real");
    expect(screen.getByTestId("receipt-payment")).toHaveTextContent("Tarjeta de Crédito");
    expect(screen.getByTestId("receipt-amount")).toHaveTextContent("ARS 12.100,00");
    expect(screen.getByTestId("print-receipt-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("recover-receipt-btn")).toBeNull();
    expect(createSaleWithInvoiceSpy).not.toHaveBeenCalled();
  });

  it("handles failed and repeated failed recovery attempts allowing retry without creating sales", async () => {
    const recoverFnMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: "pending_receipt" as const,
        error: "El comprobante aún no devolvió datos persistidos.",
      })
      .mockResolvedValueOnce({
        status: "pending_receipt" as const,
        error: "Timeout al consultar el ERP.",
      });

    render(<TestHost initialTicket={ticketA} recoverFn={recoverFnMock} />);

    expect(screen.getByTestId("confirmed-document-id")).toHaveTextContent("doc-A");
    const recoverBtn = screen.getByTestId("recover-receipt-btn");

    await act(async () => {
      fireEvent.click(recoverBtn);
    });

    expect(recoverFnMock).toHaveBeenCalledTimes(1);
    expect(recoverFnMock).toHaveBeenLastCalledWith("doc-A");
    expect(screen.getByTestId("pending-receipt-message")).toHaveTextContent(
      "No se pudo recuperar el comprobante: El comprobante aún no devolvió datos persistidos.",
    );
    expect(screen.queryByTestId("print-receipt-btn")).toBeNull();

    const retryBtn = screen.getByTestId("recover-receipt-btn");
    expect(retryBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(retryBtn);
    });

    expect(recoverFnMock).toHaveBeenCalledTimes(2);
    expect(recoverFnMock).toHaveBeenLastCalledWith("doc-A");
    expect(screen.getByTestId("pending-receipt-message")).toHaveTextContent(
      "No se pudo recuperar el comprobante: Timeout al consultar el ERP.",
    );
    expect(screen.queryByTestId("print-receipt-btn")).toBeNull();
    expect(createSaleWithInvoiceSpy).not.toHaveBeenCalled();
  });

  it("formats v2 ticket amounts with up to 4 decimals in PosReceiptPanel header", () => {
    const v2Receipt: DocumentSaleReceipt = {
      ...dummyPersistedReceipt,
      pricing_version: "v2",
      total_amount: 300.015,
      total_ars: 300.015,
      lines: [
        {
          description: "Pieza v2",
          quantity: 3,
          unit_price: 82.6488,
          discount_amount: 0,
          tax_rate_percent: 21,
          tax_amount: 52.0687,
          line_total: 300.015,
          pricing_version: "v2",
          unit_gross_price: 100.005,
          net_subtotal_amount: 247.9463,
          gross_discount_amount: 0,
        },
      ],
    };

    const ticket: ConfirmedTicketState = {
      info: dummyConfirmedInfo,
      receipt: v2Receipt,
    };

    render(
      <PosReceiptPanel
        ticket={ticket}
        onClose={vi.fn()}
        onRecover={vi.fn()}
      />,
    );

    const amountEl = screen.getByTestId("receipt-amount");
    expect(amountEl.textContent?.replace(/\u00a0/g, " ")).toBe("ARS 300,015");
  });

  it("handles malformed v2 readback failing closed with real parseDocumentSaleReceipt: no receipt rendered, no print button", () => {
    // Malformed v2 row from DB missing required unit_gross_price
    const malformedV2Row = {
      sale_id: "sale-uuid-001",
      document_id: "doc-uuid-001",
      document_number: "F-0001-00000001",
      invoice_kind: "fiscal",
      pricing_version: "v2",
      branch_name: "Sucursal Central",
      customer_display_name: "Cliente Real",
      customer_legal_name: "Cliente Real",
      currency_code: "ARS",
      exchange_rate: 1,
      subtotal_amount: 100,
      discount_amount: 0,
      tax_amount: 21,
      total_amount: 121,
      total_ars: 121,
      confirmed_at: "2026-10-21T01:00:00Z",
      document_status: "issued",
      payments: [],
      lines: [
        {
          description: "Item malformed",
          quantity: 1,
          unit_price: 100,
          discount_amount: 0,
          tax_rate_percent: 21,
          tax_amount: 21,
          line_total: 121,
          pricing_version: "v2",
          // unit_gross_price is missing!
          net_subtotal_amount: 100,
          gross_discount_amount: 0,
        },
      ],
    };

    let parseErrMessage = "";
    try {
      // Use real parser from documents/api
      parseDocumentSaleReceipt(malformedV2Row);
    } catch (err: unknown) {
      parseErrMessage = err instanceof Error ? err.message : String(err);
    }

    expect(parseErrMessage).toContain("unit_gross_price es obligatorio");

    // In posReceiptFlow, this error causes ticket.receipt to remain null and recoveryError to be set
    const ticket: ConfirmedTicketState = {
      info: dummyConfirmedInfo,
      receipt: null,
      recoveryError: `Error al leer comprobante: ${parseErrMessage}`,
    };

    render(
      <PosReceiptPanel
        ticket={ticket}
        onClose={vi.fn()}
        onRecover={vi.fn()}
      />,
    );

    // Assert fail-closed: NO print button, NO fabricated customer/amount, message displayed
    expect(screen.queryByTestId("print-receipt-btn")).toBeNull();
    expect(screen.queryByTestId("receipt-amount")).toBeNull();
    expect(screen.queryByLabelText("Comprobante local de venta")).toBeNull();
    expect(screen.getByTestId("pending-receipt-message")).toHaveTextContent(
      "unit_gross_price es obligatorio en la línea 1 para liquidación v2",
    );
  });
});
