import { describe, expect, it, vi } from "vitest";
import {
  executePosSale,
  recoverPosSaleReceipt,
  recoverConfirmedTicket,
  type ConfirmedTicketState,
} from "./posReceiptFlow";
import type { PosInvoiceSaleInput } from "./types";
import type { CreateSaleWithInvoiceResult } from "./api";
import type { DocumentSaleReceipt } from "../../types/DocumentSaleReceipt";

describe("POS sale execution and receipt recovery flow", () => {
  const dummyInput: PosInvoiceSaleInput = {
    branchId: "10000000-0000-4000-8000-000000000001",
    customerId: "10000000-0000-4000-8000-000000000002",
    currency: "ARS",
    exchangeSnapshotId: "10000000-0000-4000-8000-000000000003",
    operationKey: "pos-op-123",
    reason: "Venta mostrador POS",
    invoiceKind: "fiscal",
    lines: [
      {
        kind: "product",
        product_id: "10000000-0000-4000-8000-000000000004",
        variant_id: null,
        inventory_unit_id: null,
        from_location_id: "10000000-0000-4000-8000-000000000005",
        description: "Celular Samsung A54",
        quantity: 1,
        unit_price: 10000,
        discount_amount: 0,
        tax_rate_percent: 21,
        tax_amount: 2100,
      },
    ],
    paymentLines: [
      {
        payment_method_id: "10000000-0000-4000-8000-000000000006",
        cash_session_id: null,
        amount: 12100,
        currency_code: "ARS",
      },
    ],
  };

  const dummySaleResult: CreateSaleWithInvoiceResult = {
    saleId: "sale-uuid-001",
    documentId: "doc-uuid-001",
    documentNumber: "F-0001-00000001",
    invoiceKind: "fiscal",
  };

  const dummyAuthoritativeReceipt: DocumentSaleReceipt = {
    sale_id: "sale-uuid-001",
    document_id: "doc-uuid-001",
    document_number: "F-0001-00000001",
    invoice_kind: "fiscal",
    branch_name: "Sucursal Central",
    customer_display_name: "Juan Perez",
    customer_legal_name: "Juan Perez",
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
        method_name: "Efectivo",
        amount: 12100,
        currency_code: "ARS",
        occurred_at: "2026-10-21T01:00:00Z",
        reversed: false,
      },
    ],
  };

  describe("executePosSale", () => {
    it("completes sale and returns authoritative receipt when both commit and readback succeed", async () => {
      const createSaleMock = vi.fn().mockResolvedValue(dummySaleResult);
      const getReceiptMock = vi.fn().mockResolvedValue(dummyAuthoritativeReceipt);

      const result = await executePosSale(dummyInput, {
        createSaleWithInvoiceFn: createSaleMock,
        getDocumentSaleReceiptFn: getReceiptMock,
      });

      expect(createSaleMock).toHaveBeenCalledTimes(1);
      expect(createSaleMock).toHaveBeenCalledWith(dummyInput);
      expect(getReceiptMock).toHaveBeenCalledWith(dummySaleResult.documentId);
      expect(result.status).toBe("completed");
      if (result.status === "completed") {
        expect(result.saleResult).toEqual(dummySaleResult);
        expect(result.receipt).toEqual(dummyAuthoritativeReceipt);
      }
    });

    it("marks sale confirmed as pending_receipt without fabricating a ticket if readback returns null", async () => {
      const createSaleMock = vi.fn().mockResolvedValue(dummySaleResult);
      const getReceiptMock = vi.fn().mockResolvedValue(null);

      const result = await executePosSale(dummyInput, {
        createSaleWithInvoiceFn: createSaleMock,
        getDocumentSaleReceiptFn: getReceiptMock,
      });

      expect(createSaleMock).toHaveBeenCalledTimes(1);
      expect(getReceiptMock).toHaveBeenCalledTimes(1);

      expect(result.status).toBe("pending_receipt");
      if (result.status === "pending_receipt") {
        expect(result.saleResult).toEqual(dummySaleResult);
        expect(result.receipt).toBeNull();
        expect(result.error).toContain("no devolvió datos persistidos");
      }
    });

    it("marks sale confirmed as pending_receipt without throwing if readback rejects after commit", async () => {
      const createSaleMock = vi.fn().mockResolvedValue(dummySaleResult);
      const getReceiptMock = vi.fn().mockRejectedValue(new Error("RPC timeout"));

      const result = await executePosSale(dummyInput, {
        createSaleWithInvoiceFn: createSaleMock,
        getDocumentSaleReceiptFn: getReceiptMock,
      });

      expect(createSaleMock).toHaveBeenCalledTimes(1);
      expect(getReceiptMock).toHaveBeenCalledTimes(1);

      expect(result.status).toBe("pending_receipt");
      if (result.status === "pending_receipt") {
        expect(result.saleResult).toEqual(dummySaleResult);
        expect(result.receipt).toBeNull();
        expect(result.error).toBe("RPC timeout");
      }
    });

    it("bubbles error if createSaleWithInvoice fails before commit, preventing false confirmation", async () => {
      const createSaleMock = vi.fn().mockRejectedValue(new Error("Database connection lost"));
      const getReceiptMock = vi.fn();

      await expect(
        executePosSale(dummyInput, {
          createSaleWithInvoiceFn: createSaleMock,
          getDocumentSaleReceiptFn: getReceiptMock,
        }),
      ).rejects.toThrow("Database connection lost");

      expect(getReceiptMock).not.toHaveBeenCalled();
    });
  });

  describe("recoverPosSaleReceipt", () => {
    it("fetches authoritative receipt without calling create_sale or generating new key", async () => {
      const getReceiptMock = vi.fn().mockResolvedValue(dummyAuthoritativeReceipt);

      const result = await recoverPosSaleReceipt("doc-uuid-001", getReceiptMock);

      expect(getReceiptMock).toHaveBeenCalledTimes(1);
      expect(getReceiptMock).toHaveBeenCalledWith("doc-uuid-001");
      expect(result.status).toBe("completed");
      if (result.status === "completed") {
        expect(result.receipt).toEqual(dummyAuthoritativeReceipt);
      }
    });

    it("preserves recoverable state if receipt readback returns null on retry", async () => {
      const getReceiptMock = vi.fn().mockResolvedValue(null);

      const result = await recoverPosSaleReceipt("doc-uuid-001", getReceiptMock);

      expect(getReceiptMock).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("pending_receipt");
      if (result.status === "pending_receipt") {
        expect(result.error).toContain("no devolvió datos persistidos");
      }
    });

    it("preserves recoverable state if receipt readback throws on retry", async () => {
      const getReceiptMock = vi.fn().mockRejectedValue(new Error("Network connection dropped"));

      const result = await recoverPosSaleReceipt("doc-uuid-001", getReceiptMock);

      expect(getReceiptMock).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("pending_receipt");
      if (result.status === "pending_receipt") {
        expect(result.error).toBe("Network connection dropped");
      }
    });
  });

  describe("recoverConfirmedTicket", () => {
    it("updates ticket with authoritative receipt when recovery succeeds for matching document", async () => {
      let state: ConfirmedTicketState | null = {
        info: {
          saleId: "sale-1",
          documentId: "doc-1",
          documentNumber: "F-0001-00000001",
          invoiceKind: "fiscal",
        },
        receipt: null,
      };
      const updateTicket = (updater: (prev: ConfirmedTicketState | null) => ConfirmedTicketState | null) => {
        state = updater(state);
      };
      const recoverFn = vi.fn().mockResolvedValue({
        status: "completed" as const,
        receipt: dummyAuthoritativeReceipt,
      });

      await recoverConfirmedTicket("doc-1", updateTicket, recoverFn);

      expect(recoverFn).toHaveBeenCalledWith("doc-1");
      expect(state?.receipt).toEqual(dummyAuthoritativeReceipt);
      expect(state?.recoveryLoading).toBe(false);
      expect(state?.recoveryError).toBeNull();
    });

    it("leaves state intact if documentId does not match or ticket was closed during recovery", async () => {
      const ticketB: ConfirmedTicketState = {
        info: {
          saleId: "sale-B",
          documentId: "doc-B",
          documentNumber: "F-0001-00000002",
          invoiceKind: "non_fiscal",
        },
        receipt: dummyAuthoritativeReceipt,
      };
      let state: ConfirmedTicketState | null = {
        info: {
          saleId: "sale-A",
          documentId: "doc-A",
          documentNumber: "F-0001-00000001",
          invoiceKind: "fiscal",
        },
        receipt: null,
      };
      const updateTicket = (updater: (prev: ConfirmedTicketState | null) => ConfirmedTicketState | null) => {
        state = updater(state);
      };
      const recoverFn = vi.fn().mockImplementation(async () => {
        // Ticket switched to B while recovery of A was running
        state = ticketB;
        return {
          status: "completed" as const,
          receipt: { ...dummyAuthoritativeReceipt, document_id: "doc-A" },
        };
      });

      await recoverConfirmedTicket("doc-A", updateTicket, recoverFn);

      expect(state).toEqual(ticketB);
    });

    it("handles pending_receipt recovery failure by setting error and clearing loading", async () => {
      let state: ConfirmedTicketState | null = {
        info: {
          saleId: "sale-1",
          documentId: "doc-1",
          documentNumber: "F-0001-00000001",
          invoiceKind: "fiscal",
        },
        receipt: null,
      };
      const updateTicket = (updater: (prev: ConfirmedTicketState | null) => ConfirmedTicketState | null) => {
        state = updater(state);
      };
      const recoverFn = vi.fn().mockResolvedValue({
        status: "pending_receipt" as const,
        error: "Sin datos persistidos",
      });

      await recoverConfirmedTicket("doc-1", updateTicket, recoverFn);

      expect(state?.receipt).toBeNull();
      expect(state?.recoveryLoading).toBe(false);
      expect(state?.recoveryError).toContain("Sin datos persistidos");
    });
  });
});
