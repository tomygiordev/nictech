import { describe, expect, it } from "vitest";
import {
  onlineOrderDispatchSchema,
  onlineOrderReasonSchema,
  onlineOrderRefundSchema,
} from "./schemas";

describe("online order lifecycle schemas", () => {
  it("requires an auditable reason for every lifecycle action", () => {
    expect(onlineOrderReasonSchema.safeParse({ reason: "  " }).success).toBe(false);
    expect(onlineOrderReasonSchema.parse({ reason: "  Preparar pedido  " }).reason).toBe("Preparar pedido");
  });

  it("requires the approved provider payment reference to dispatch", () => {
    expect(onlineOrderDispatchSchema.safeParse({ reason: "Despacho", paymentReference: "" }).success).toBe(false);
    expect(onlineOrderDispatchSchema.safeParse({ reason: "Despacho", paymentReference: "mp-123" }).success).toBe(true);
  });

  it("never accepts a refund without explicit physical return confirmation", () => {
    expect(onlineOrderRefundSchema.safeParse({ reason: "Devolución", physicalReturnConfirmed: false }).success).toBe(false);
    expect(onlineOrderRefundSchema.safeParse({ reason: "Devolución", physicalReturnConfirmed: true }).success).toBe(true);
  });
});
