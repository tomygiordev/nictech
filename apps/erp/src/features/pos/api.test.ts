import { describe, expect, it } from "vitest";
import { buildCreateSaleRpcArgs } from "./api";
import type { PosSaleInput } from "./types";

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
});
