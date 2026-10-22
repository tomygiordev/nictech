import { describe, expect, it } from "vitest";
import { formatCurrency, formatPosCurrency } from "./formatters";

describe("Currency Formatters", () => {
  describe("formatCurrency (Legacy v1, 2 fixed decimals)", () => {
    it("formats amounts with exactly 2 decimal places", () => {
      // Normalizes non-breaking space for robust test assertion
      const normalize = (s: string) => s.replace(/\u00a0/g, " ");

      expect(normalize(formatCurrency(100))).toBe("ARS 100,00");
      expect(normalize(formatCurrency(100.5))).toBe("ARS 100,50");
      expect(normalize(formatCurrency(100.25))).toBe("ARS 100,25");
      // Legacy rounds to 2 decimals
      expect(normalize(formatCurrency(100.005))).toBe("ARS 100,01");
      expect(normalize(formatCurrency(300.015))).toBe("ARS 300,02");
    });

    it("handles null, undefined and invalid numbers safely", () => {
      expect(formatCurrency(null)).toBe("—");
      expect(formatCurrency(undefined)).toBe("—");
      expect(formatCurrency(NaN)).toBe("—");
    });
  });

  describe("formatPosCurrency (POS v2, min 2, max 4 decimals)", () => {
    const normalize = (s: string) => s.replace(/\u00a0/g, " ");

    it("preserves exact fractional cents without hiding real money", () => {
      expect(normalize(formatPosCurrency(100.005))).toBe("ARS 100,005");
      expect(normalize(formatPosCurrency(300.015))).toBe("ARS 300,015");
      expect(normalize(formatPosCurrency(0.0001))).toBe("ARS 0,0001");
      expect(normalize(formatPosCurrency("100.005"))).toBe("ARS 100,005");
    });

    it("shows minimum 2 decimals for whole or 1-decimal numbers", () => {
      expect(normalize(formatPosCurrency(100))).toBe("ARS 100,00");
      expect(normalize(formatPosCurrency(100.5))).toBe("ARS 100,50");
      expect(normalize(formatPosCurrency(100.25))).toBe("ARS 100,25");
      expect(normalize(formatPosCurrency(0))).toBe("ARS 0,00");
    });

    it("handles null, undefined and invalid numbers safely", () => {
      expect(formatPosCurrency(null)).toBe("—");
      expect(formatPosCurrency(undefined)).toBe("—");
      expect(formatPosCurrency(NaN)).toBe("—");
      expect(formatPosCurrency("invalid")).toBe("—");
    });
  });
});
