import { describe, expect, it } from "vitest";
import {
  cashCloseReasonSchema,
  cashCountSchema,
  manualCashMovementSchema,
  openCashSchema,
  reverseManualCashMovementSchema,
} from "./schemas";

describe("cash count and opening schemas", () => {
  const opening = {
    cashRegisterId: "550e8400-e29b-41d4-a716-446655440000",
    operationKey: "open-cash-test",
    reason: "Apertura de turno",
    currency: "ARS",
  };

  it("requires the opening fund and accepts an explicit zero", () => {
    expect(() => openCashSchema.parse(opening)).toThrow("Ingresá el fondo inicial.");
    expect(() => openCashSchema.parse({ ...opening, amount: "" })).toThrow("Ingresá el fondo inicial.");
    expect(openCashSchema.parse({ ...opening, amount: "0" }).amount).toBe(0);
  });

  it.each(["", "  "])("rejects a blank cash count (%j) without substituting zero", (amount) => {
    expect(() => cashCountSchema.parse({ amount })).toThrow("Ingresá el efectivo contado.");
  });

  it.each([-1, Infinity, "Infinity", "50 pesos"])("rejects invalid cash counts (%j)", (amount) => {
    expect(cashCountSchema.safeParse({ amount }).success).toBe(false);
  });

  it("accepts explicit zero and fractional counts", () => {
    expect(cashCountSchema.parse({ amount: "0" }).amount).toBe(0);
    expect(cashCountSchema.parse({ amount: " 150.25 " }).amount).toBe(150.25);
  });

  it.each([-10, 10])("requires at least 5 characters after trimming for a difference of %s", (difference) => {
    const schema = cashCloseReasonSchema(difference);
    expect(schema.safeParse({ reason: "    " }).success).toBe(false);
    expect(schema.safeParse({ reason: " falt " }).success).toBe(false);
    expect(schema.parse({ reason: " error " }).reason).toBe("error");
  });

  it("allows a blank observation when the count matches", () => {
    expect(cashCloseReasonSchema(0).parse({ reason: "  " }).reason).toBe("");
  });
});

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
