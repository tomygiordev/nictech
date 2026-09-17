import { describe, expect, it } from "vitest";
import { canSubmitWithExchangeRate, requiresExternalExchangeRate } from "./schemas";

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
});
