import { describe, expect, it } from "vitest";
import { canSubmitWithExchangeRate, posSaleLineSchema, requiresExternalExchangeRate } from "./schemas";
import { POS_MAX_AMOUNT_ARS } from "./pricing";

describe("POS exchange-rate requirements", () => {
  it("allows an ARS sale paid in ARS when no USD quote exists", () => {
    // Arrange
    const requirement = { saleCurrency: "ARS", paymentCurrencies: ["ARS"] };

    // Act
    const canSubmit = canSubmitWithExchangeRate(requirement, null);

    // Assert
    expect(requiresExternalExchangeRate(requirement)).toBe(false);
    expect(canSubmit).toBe(true);
  });

  it("blocks a non-base sale when no exchange quote exists", () => {
    // Arrange
    const requirement = { saleCurrency: "USD", paymentCurrencies: ["USD"] };

    // Act
    const canSubmit = canSubmitWithExchangeRate(requirement, null);

    // Assert
    expect(requiresExternalExchangeRate(requirement)).toBe(true);
    expect(canSubmit).toBe(false);
  });

  it("formats max amount validation messages in Spanish using es-AR locale", () => {
    const parsed = posSaleLineSchema.safeParse({
      kind: "product",
      product_id: "11111111-1111-4111-8111-111111111111",
      from_location_id: "22222222-2222-4222-8222-222222222222",
      description: "Producto de prueba",
      quantity: 2,
      unit_price: 600_000_000,
      discount_amount: 0,
      tax_rate_percent: 21,
      tax_amount: 0,
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain(POS_MAX_AMOUNT_ARS.toLocaleString("es-AR"));
      expect(parsed.error.issues[0]?.message).toContain("supera el límite permitido");
    }
  });
});
