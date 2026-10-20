import { describe, expect, it } from "vitest";
import { parseDocumentSaleReceipt } from "./api";

describe("document sale receipt response", () => {
  it("parses the persisted sale lines, totals and independent lifecycle states", () => {
    const receipt = parseDocumentSaleReceipt({
      sale_id: "10000000-0000-4000-8000-000000000001",
      document_id: "10000000-0000-4000-8000-000000000002",
      document_number: "F-00000001",
      invoice_kind: "fiscal",
      branch_name: "Sucursal centro",
      customer_display_name: "Sofía Gómez",
      customer_legal_name: "Sofía Gómez",
      currency_code: "ARS",
      exchange_rate: "1",
      subtotal_amount: "100",
      discount_amount: "0",
      tax_amount: "21",
      total_amount: "121",
      total_ars: "121",
      confirmed_at: "2026-09-22T12:00:00Z",
      document_status: "voided",
      sale_state: "cancelled",
      payment_state: "refunded",
      payments: [{
        method_name: "Efectivo",
        amount: "121",
        currency_code: "ARS",
        occurred_at: "2026-09-22T12:00:00Z",
        reversed: true,
      }],
      lines: [{
        description: "Producto de prueba",
        quantity: "1",
        unit_price: "100",
        discount_amount: "0",
        tax_rate_percent: "21",
        tax_amount: "21",
        line_total: "121",
      }],
    });

    expect(receipt.lines[0]?.description).toBe("Producto de prueba");
    expect(receipt.total_amount).toBe(121);
    expect(receipt.document_status).toBe("voided");
    expect(receipt.sale_state).toBe("cancelled");
    expect(receipt.payment_state).toBe("refunded");
    expect(receipt.branch_name).toBe("Sucursal centro");
    expect(receipt.payments[0]?.reversed).toBe(true);
  });

  it("rejects receipts that claim provider-authorized invoice kinds", () => {
    expect(() => parseDocumentSaleReceipt({
      invoice_kind: "authorized",
      lines: [],
    })).toThrow("clasificación local");
  });
});
