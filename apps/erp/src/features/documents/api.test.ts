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

  it("parses valid v2 receipts with explicit gross, net subtotal, gross discount and matching v2 line version", () => {
    const receipt = parseDocumentSaleReceipt({
      sale_id: "10000000-0000-4000-8000-000000000001",
      document_id: "10000000-0000-4000-8000-000000000002",
      document_number: "F-0001-00000002",
      invoice_kind: "fiscal",
      pricing_version: "v2",
      branch_name: "Sucursal Centro",
      customer_display_name: "Cliente Final",
      customer_legal_name: "Cliente Final",
      currency_code: "ARS",
      exchange_rate: 1,
      subtotal_amount: 82.6488,
      discount_amount: 0,
      tax_amount: 17.3562,
      total_amount: 100.005,
      total_ars: 100.005,
      confirmed_at: "2026-10-21T01:00:00Z",
      document_status: "issued",
      sale_state: "confirmed",
      payment_state: "paid",
      payments: [
        {
          method_name: "Efectivo",
          amount: 100.005,
          currency_code: "ARS",
          occurred_at: "2026-10-21T01:00:00Z",
          reversed: false,
        },
      ],
      lines: [
        {
          description: "Artículo con 3 decimales",
          quantity: 1,
          unit_price: 82.6488,
          discount_amount: 0,
          tax_rate_percent: 21,
          tax_amount: 17.3562,
          line_total: 100.005,
          pricing_version: "v2",
          unit_gross_price: 100.005,
          net_subtotal_amount: 82.6488,
          gross_discount_amount: 0,
        },
      ],
    });

    expect(receipt.pricing_version).toBe("v2");
    expect(receipt.lines[0]?.pricing_version).toBe("v2");
    expect(receipt.lines[0]?.unit_gross_price).toBe(100.005);
    expect(receipt.lines[0]?.net_subtotal_amount).toBe(82.6488);
    expect(receipt.lines[0]?.gross_discount_amount).toBe(0);
    expect(receipt.total_amount).toBe(100.005);
  });

  it("fails closed on v2 receipt when required gross line fields are missing or invalid", () => {
    const baseV2 = {
      sale_id: "10000000-0000-4000-8000-000000000001",
      document_id: "10000000-0000-4000-8000-000000000002",
      document_number: "F-0001-00000002",
      invoice_kind: "fiscal",
      pricing_version: "v2",
      branch_name: "Sucursal Centro",
      customer_display_name: "Cliente Final",
      customer_legal_name: "Cliente Final",
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
    };

    // Missing unit_gross_price in v2
    expect(() =>
      parseDocumentSaleReceipt({
        ...baseV2,
        lines: [
          {
            description: "Item",
            quantity: 1,
            unit_price: 100,
            discount_amount: 0,
            tax_rate_percent: 21,
            tax_amount: 21,
            line_total: 121,
            pricing_version: "v2",
            net_subtotal_amount: 100,
            gross_discount_amount: 0,
          },
        ],
      }),
    ).toThrow(/unit_gross_price es obligatorio/);

    // Negative unit_gross_price in v2
    expect(() =>
      parseDocumentSaleReceipt({
        ...baseV2,
        lines: [
          {
            description: "Item",
            quantity: 1,
            unit_price: 100,
            discount_amount: 0,
            tax_rate_percent: 21,
            tax_amount: 21,
            line_total: 121,
            pricing_version: "v2",
            unit_gross_price: -10,
            net_subtotal_amount: 100,
            gross_discount_amount: 0,
          },
        ],
      }),
    ).toThrow(/unit_gross_price en la línea 1 debe ser un número finito no negativo/);

    // Discordant line pricing version (e.g. line without v2 or line claiming v1 in v2 receipt)
    expect(() =>
      parseDocumentSaleReceipt({
        ...baseV2,
        lines: [
          {
            description: "Item",
            quantity: 1,
            unit_price: 100,
            discount_amount: 0,
            tax_rate_percent: 21,
            tax_amount: 21,
            line_total: 121,
            unit_gross_price: 121,
            net_subtotal_amount: 100,
            gross_discount_amount: 0,
          },
        ],
      }),
    ).toThrow(/versión de liquidación discordante/);
  });

  it("fails closed on explicit unknown pricing versions without silent downgrade", () => {
    expect(() =>
      parseDocumentSaleReceipt({
        sale_id: "10000000-0000-4000-8000-000000000001",
        document_id: "10000000-0000-4000-8000-000000000002",
        document_number: "F-0001-00000002",
        invoice_kind: "fiscal",
        pricing_version: "v3",
        document_status: "issued",
        lines: [],
        payments: [],
      }),
    ).toThrow(/Versión de liquidación desconocida en el comprobante: v3/);
  });
});
