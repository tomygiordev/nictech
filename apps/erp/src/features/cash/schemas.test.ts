import { describe, expect, it } from "vitest";
import { manualCashMovementSchema, reverseManualCashMovementSchema } from "./schemas";

describe("cash movement schemas", () => {
  it("accepts a positive manual contribution and normalizes its currency", () => {
    const parsed = manualCashMovementSchema.parse({
      cashSessionId: "550e8400-e29b-41d4-a716-446655440000",
      kind: "contribution",
      currencyCode: "ars",
      amount: "1250.50",
      operationKey: "cash-movement-test",
      reason: "Aporte extraordinario de caja",
    });

    expect(parsed.currencyCode).toBe("ARS");
    expect(parsed.amount).toBe(1250.5);
  });

  it("rejects zero or unsupported manual movements", () => {
    expect(manualCashMovementSchema.safeParse({
      cashSessionId: "550e8400-e29b-41d4-a716-446655440000",
      kind: "payment",
      currencyCode: "ARS",
      amount: 0,
      operationKey: "cash-movement-test",
      reason: "Movimiento inválido",
    }).success).toBe(false);
  });

  it("requires an auditable reason for a reversal", () => {
    expect(reverseManualCashMovementSchema.safeParse({
      cashMovementId: "550e8400-e29b-41d4-a716-446655440000",
      operationKey: "cash-reversal-test",
      reason: "",
    }).success).toBe(false);
  });
});
