import { describe, expect, it } from "vitest";
import { buildCreateSaleRpcArgs, buildCreateSaleWithInvoiceRpcArgs } from "./api";
import { posPaymentLineSchema, posSaleLineSchema, saleSchema } from "./schemas";
import type { PosInvoiceSaleInput, PosSaleInput } from "./types";

describe("POS create_sale payload", () => {
  it("keeps the ARS snapshot UUID and maps every RPC argument", () => {
    // Arrange
    const input: PosSaleInput = {
      branchId: "10000000-0000-4000-8000-000000000001",
      customerId: "10000000-0000-4000-8000-000000000002",
      currency: "ars",
      exchangeSnapshotId: "10000000-0000-4000-8000-000000000003",
      operationKey: "pos-operation-1",
      reason: "Venta mostrador",
      lines: [
        {
          kind: "product",
          product_id: "10000000-0000-4000-8000-000000000004",
          variant_id: null,
          inventory_unit_id: null,
          from_location_id: "10000000-0000-4000-8000-000000000005",
          description: "Producto de prueba",
          quantity: 2,
          unit_price: 100,
          discount_amount: 0,
          tax_rate_percent: 21,
          tax_amount: 42,
        },
      ],
      paymentLines: [
        {
          payment_method_id: "10000000-0000-4000-8000-000000000006",
          cash_session_id: null,
          amount: 242,
          currency_code: "ars",
        },
      ],
    };

    // Act
    const payload = buildCreateSaleRpcArgs(input);

    // Assert
    expect(payload).toEqual({
      target_branch_id: input.branchId,
      target_customer_id: input.customerId,
      sale_currency: "ARS",
      target_exchange_snapshot_id: input.exchangeSnapshotId,
      operation_key: input.operationKey,
      operation_reason: input.reason,
      lines: input.lines,
      payment_lines: [
        {
          ...input.paymentLines[0],
          currency_code: "ARS",
        },
      ],
    });
  });

  it.each(["fiscal", "non_fiscal"] as const)("sends %s invoice kind to the internal issuance RPC", (invoiceKind) => {
    const input: PosInvoiceSaleInput = {
      branchId: "10000000-0000-4000-8000-000000000001",
      customerId: "10000000-0000-4000-8000-000000000002",
      currency: "ARS",
      exchangeSnapshotId: "10000000-0000-4000-8000-000000000003",
      operationKey: `pos-${invoiceKind}`,
      reason: "Venta mostrador",
      invoiceKind,
      lines: [
        {
          kind: "free_concept",
          product_id: null,
          description: "Concepto de prueba",
          quantity: 1,
          unit_price: 100,
          discount_amount: 0,
          tax_rate_percent: 0,
          tax_amount: 0,
        },
      ],
      paymentLines: [],
    };

    expect(buildCreateSaleWithInvoiceRpcArgs(input).target_invoice_kind).toBe(invoiceKind);
  });

  it("preserves authoritative v2 gross pricing fields in buildCreateSaleWithInvoiceRpcArgs", () => {
    const input: PosInvoiceSaleInput = {
      branchId: "10000000-0000-4000-8000-000000000001",
      customerId: "10000000-0000-4000-8000-000000000002",
      currency: "ARS",
      exchangeSnapshotId: "10000000-0000-4000-8000-000000000003",
      operationKey: "pos-v2-authoritative-quote",
      reason: "Venta con quote autoritativa",
      invoiceKind: "non_fiscal",
      lines: [
        {
          kind: "product",
          product_id: "10000000-0000-4000-8000-000000000004",
          variant_id: "10000000-0000-4000-8000-000000000007",
          from_location_id: "10000000-0000-4000-8000-000000000005",
          description: "Producto con precio final ARS 100.0050",
          quantity: 3,
          unit_price: 100.005,
          expected_unit_price: 100.005,
          unit_gross_price: 100.005,
          discount_amount: 0,
          gross_discount_amount: 0,
          tax_rate_percent: 21,
          tax_amount: 52.0687,
        },
      ],
      paymentLines: [
        {
          payment_method_id: "10000000-0000-4000-8000-000000000006",
          cash_session_id: null,
          amount: 300.015,
          currency_code: "ARS",
        },
      ],
    };

    const args = buildCreateSaleWithInvoiceRpcArgs(input);
    expect(args.lines).toEqual([
      {
        kind: "product",
        product_id: "10000000-0000-4000-8000-000000000004",
        variant_id: "10000000-0000-4000-8000-000000000007",
        from_location_id: "10000000-0000-4000-8000-000000000005",
        description: "Producto con precio final ARS 100.0050",
        quantity: 3,
        unit_price: 100.005,
        expected_unit_price: 100.005,
        unit_gross_price: 100.005,
        discount_amount: 0,
        gross_discount_amount: 0,
        tax_rate_percent: 21,
        tax_amount: 52.0687,
      },
    ]);
    expect(Object.isFrozen(args)).toBe(true);
    expect(Object.isFrozen(args.lines)).toBe(true);
    expect(Object.isFrozen(args.payment_lines)).toBe(true);
  });

  describe("Schema validations", () => {
    it("rejects negative unit price", () => {
      const invalidLine = {
        kind: "product" as const,
        product_id: "10000000-0000-4000-8000-000000000004",
        from_location_id: "10000000-0000-4000-8000-000000000005",
        description: "Precio negativo",
        quantity: 1,
        unit_price: -10,
        discount_amount: 0,
        tax_rate_percent: 21,
        tax_amount: 0,
      };

      const result = posSaleLineSchema.safeParse(invalidLine);
      expect(result.success).toBe(false);
    });

    it("rejects non-positive quantity", () => {
      const invalidLine = {
        kind: "product" as const,
        product_id: "10000000-0000-4000-8000-000000000004",
        from_location_id: "10000000-0000-4000-8000-000000000005",
        description: "Cantidad cero",
        quantity: 0,
        unit_price: 100,
        discount_amount: 0,
        tax_rate_percent: 21,
        tax_amount: 21,
      };

      const result = posSaleLineSchema.safeParse(invalidLine);
      expect(result.success).toBe(false);
    });

    it("rejects discount exceeding line subtotal", () => {
      const invalidLine = {
        kind: "product" as const,
        product_id: "10000000-0000-4000-8000-000000000004",
        from_location_id: "10000000-0000-4000-8000-000000000005",
        description: "Descuento excesivo",
        quantity: 1,
        unit_price: 100,
        discount_amount: 150,
        tax_rate_percent: 21,
        tax_amount: 0,
      };

      const result = posSaleLineSchema.safeParse(invalidLine);
      expect(result.success).toBe(false);
    });

    it("rejects line where quantity * unit_price exceeds 1e9 cap without throwing", () => {
      const line = {
        kind: "product" as const,
        product_id: "10000000-0000-4000-8000-000000000004",
        from_location_id: "10000000-0000-4000-8000-000000000005",
        description: "Línea sobrecap",
        quantity: 2,
        unit_price: 600_000_000,
        discount_amount: 0,
        tax_rate_percent: 21,
        tax_amount: 0,
      };

      const result = posSaleLineSchema.safeParse(line);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes("quantity"))).toBe(true);
      }
    });

    it("rejects sale where total lines exceed 1e9 cap without throwing", () => {
      const sale = {
        branchId: "10000000-0000-4000-8000-000000000001",
        customerId: "10000000-0000-4000-8000-000000000002",
        currency: "ARS",
        exchangeSnapshotId: "10000000-0000-4000-8000-000000000003",
        operationKey: "pos-overcap-sale",
        reason: "Venta sobrecap",
        lines: [
          {
            kind: "product" as const,
            product_id: "10000000-0000-4000-8000-000000000004",
            from_location_id: "10000000-0000-4000-8000-000000000005",
            description: "Línea 1 600m",
            quantity: 1,
            unit_price: 600_000_000,
            discount_amount: 0,
            tax_rate_percent: 21,
            tax_amount: 0,
          },
          {
            kind: "product" as const,
            product_id: "10000000-0000-4000-8000-000000000004",
            from_location_id: "10000000-0000-4000-8000-000000000005",
            description: "Línea 2 600m",
            quantity: 1,
            unit_price: 600_000_000,
            discount_amount: 0,
            tax_rate_percent: 21,
            tax_amount: 0,
          },
        ],
        paymentLines: [],
      };

      const result = saleSchema.safeParse(sale);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes("lines"))).toBe(true);
      }
    });

    it("accepts valid total 0 sale with empty paymentLines", () => {
      const sale = {
        branchId: "10000000-0000-4000-8000-000000000001",
        customerId: "10000000-0000-4000-8000-000000000002",
        currency: "ARS",
        exchangeSnapshotId: "10000000-0000-4000-8000-000000000003",
        operationKey: "pos-zero-sale",
        reason: "Venta total cero",
        lines: [
          {
            kind: "product" as const,
            product_id: "10000000-0000-4000-8000-000000000004",
            from_location_id: "10000000-0000-4000-8000-000000000005",
            description: "Producto promocional $0",
            quantity: 1,
            unit_price: 0,
            discount_amount: 0,
            tax_rate_percent: 21,
            tax_amount: 0,
          },
        ],
        paymentLines: [],
      };

      const result = saleSchema.safeParse(sale);
      expect(result.success).toBe(true);
    });

    it("rejects payment line with amount 0", () => {
      const paymentLine = {
        payment_method_id: "10000000-0000-4000-8000-000000000006",
        cash_session_id: null,
        amount: 0,
        currency_code: "ARS",
      };

      const result = posPaymentLineSchema.safeParse(paymentLine);
      expect(result.success).toBe(false);
    });
  });
});
