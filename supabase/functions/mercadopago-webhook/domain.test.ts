import { describe, expect, it } from "vitest";
import { mapPaymentStatus, normalizeOrderItems } from "./domain";

describe("Mercado Pago webhook domain", () => {
  it("preserva producto y variante de la orden persistida", () => {
    expect(normalizeOrderItems([{
      product_id: "11111111-1111-4111-8111-111111111111",
      variant_id: "22222222-2222-4222-8222-222222222222",
      inventory_unit_id: null,
      quantity: 2,
      unit_price: 100,
      title: "Teléfono - Azul",
    }])).toEqual([{
      product_id: "11111111-1111-4111-8111-111111111111",
      variant_id: "22222222-2222-4222-8222-222222222222",
      inventory_unit_id: null,
      quantity: 2,
      unit_price: 100,
      title: "Teléfono - Azul",
    }]);
  });

  it("rechaza líneas duplicadas y normaliza estados del proveedor", () => {
    const item = {
      product_id: "11111111-1111-4111-8111-111111111111",
      variant_id: null,
      inventory_unit_id: null,
      quantity: 1,
      unit_price: 100,
      title: "Teléfono",
    };
    expect(() => normalizeOrderItems([item, item])).toThrow("duplicadas");
    expect(mapPaymentStatus("charged_back")).toBe("refunded");
    expect(mapPaymentStatus("in_process")).toBe("pending");
  });
});
