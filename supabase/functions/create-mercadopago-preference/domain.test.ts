import { describe, expect, it } from "vitest";
import { aggregateCartItems, encodeMercadoPagoItemId, validateCatalogItems } from "./domain";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const VARIANT_ID = "33333333-3333-4333-8333-333333333333";

describe("Mercado Pago checkout domain", () => {
  it("agrega sólo las líneas del mismo producto y variante", () => {
    expect(aggregateCartItems([
      { id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 1 },
      { id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 2 },
      { id: PRODUCT_ID, variant_id: null, quantity: 1 },
    ])).toEqual([
      { product_id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 3 },
      { product_id: PRODUCT_ID, variant_id: null, quantity: 1 },
    ]);
  });

  it("valida el stock acumulado y que la variante pertenezca al producto", () => {
    const requested = aggregateCartItems([
      { id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 2 },
      { id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 2 },
    ]);

    expect(() => validateCatalogItems(
      requested,
      [{ id: PRODUCT_ID, name: "Teléfono", price: 100, stock: 20, image_url: null }],
      [{ id: VARIANT_ID, product_id: PRODUCT_ID, color: "Azul", stock: 3, image_url: null }],
    )).toThrow("Stock insuficiente");

    expect(() => validateCatalogItems(
      [{ product_id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 1 }],
      [{ id: PRODUCT_ID, name: "Teléfono", price: 100, stock: 20, image_url: null }],
      [{ id: VARIANT_ID, product_id: OTHER_PRODUCT_ID, color: "Azul", stock: 3, image_url: null }],
    )).toThrow("variante seleccionada");
  });

  it("genera un identificador que preserva producto y variante", () => {
    expect(encodeMercadoPagoItemId(PRODUCT_ID, VARIANT_ID)).toBe(`${PRODUCT_ID}.${VARIANT_ID}`);
    expect(encodeMercadoPagoItemId(PRODUCT_ID, null)).toBe(PRODUCT_ID);
  });
});
