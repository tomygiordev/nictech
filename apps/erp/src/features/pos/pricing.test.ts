import { describe, expect, it } from "vitest";
import {
  add4,
  buildPosPaymentLines,
  calculateGrossTaxBreakdown,
  calculatePosCartTotals,
  div4,
  mul4,
  round4,
  sub4,
  syncCartWithCatalog,
  toScaledBigInt,
  POS_MAX_AMOUNT_ARS,
  type CatalogProductForSync,
  resolveVariantPrice,
} from "./pricing";

describe("Authoritative POS 4-decimal arithmetic", () => {
  describe("Basic operations and string parsing", () => {
    it("preserves exact 4-decimal representation", () => {
      expect(round4(100.005)).toBe(100.005);
      expect(round4("100.0050")).toBe(100.005);
      expect(round4(0)).toBe(0);
      expect(round4(1)).toBe(1);
    });

    it("handles string rounding without double-rounding bugs (Sol+Argon Fix 2)", () => {
      expect(round4("1.2344499")).toBe(1.2344);
      expect(round4(".0000499")).toBe(0);
      expect(round4("1.23445")).toBe(1.2345);
      expect(round4("1.2344501")).toBe(1.2345);
      expect(round4("0.00005")).toBe(0.0001);
    });

    it("handles scientific notation strings safely", () => {
      expect(round4("1e-4")).toBe(0.0001);
      expect(round4("1.2345e2")).toBe(123.45);
      expect(round4("1e-5")).toBe(0); // 0.00001 -> 0
    });

    it("adds numbers with exact 4-decimal precision", () => {
      expect(add4(0.1, 0.2)).toBe(0.3);
      expect(add4(100.005, 200.005)).toBe(300.01);
      expect(add4(0.8264, 0.1736)).toBe(1);
    });

    it("subtracts numbers with exact 4-decimal precision", () => {
      expect(sub4(1, 0.8264)).toBe(0.1736);
      expect(sub4(300.015, 247.9463)).toBe(52.0687);
    });

    it("multiplies numbers matching Postgres numeric(18, 4)", () => {
      expect(mul4(100.005, 3)).toBe(300.015);
      expect(mul4(1, 1)).toBe(1);
      expect(mul4(0, 10)).toBe(0);
      expect(mul4(12.3456, 2)).toBe(24.6912);
    });

    it("divides numbers matching Postgres numeric(18, 4) half-away-from-zero rounding", () => {
      // 1 / 1.21 = 0.82644628... -> 0.8264
      expect(div4(1, 1.21)).toBe(0.8264);
      // 1000 / 1.21 = 826.4462809... -> 826.4463
      expect(div4(1000, 1.21)).toBe(826.4463);
      // 300.0150 / 1.21 = 247.9462809... -> 247.9463
      expect(div4(300.015, 1.21)).toBe(247.9463);
    });

    it("enforces conservative 1e9 ARS limit for POS operations", () => {
      expect(round4(POS_MAX_AMOUNT_ARS)).toBe(1_000_000_000);
      expect(() => toScaledBigInt(1_000_000_001)).toThrow("exceeds maximum allowed POS amount");
      expect(() => toScaledBigInt("1000000000.0001")).toThrow("exceeds maximum allowed POS amount");
    });

    it("throws on division by zero", () => {
      expect(() => div4(100, 0)).toThrow("Division by zero");
    });
  });

  describe("calculateGrossTaxBreakdown", () => {
    it("satisfies exact audit case: 0.33 ARS qty 1 tax 16.6667% -> net 0.2829", () => {
      const breakdown = calculateGrossTaxBreakdown(0.33, 1, 16.6667);
      expect(breakdown.grossSubtotal).toBe(0.33);
      expect(breakdown.lineTotal).toBe(0.33);
      expect(breakdown.netSubtotal).toBe(0.2829);
      expect(breakdown.taxAmount).toBe(0.0471);
      expect(add4(breakdown.netSubtotal, breakdown.taxAmount)).toBe(breakdown.lineTotal);
    });

    it("handles 1 ARS with 21% VAT, qty 1 without cent drift", () => {
      const breakdown = calculateGrossTaxBreakdown(1, 1, 21);
      expect(breakdown.grossSubtotal).toBe(1);
      expect(breakdown.lineTotal).toBe(1);
      expect(breakdown.netSubtotal).toBe(0.8264);
      expect(breakdown.taxAmount).toBe(0.1736);
      expect(add4(breakdown.netSubtotal, breakdown.taxAmount)).toBe(breakdown.lineTotal);
    });

    it("handles 1 ARS with 21% VAT, qty 2", () => {
      const breakdown = calculateGrossTaxBreakdown(1, 2, 21);
      expect(breakdown.grossSubtotal).toBe(2);
      expect(breakdown.lineTotal).toBe(2);
      // 2 / 1.21 = 1.65289... -> 1.6529 net, 0.3471 tax
      expect(breakdown.netSubtotal).toBe(1.6529);
      expect(breakdown.taxAmount).toBe(0.3471);
      expect(add4(breakdown.netSubtotal, breakdown.taxAmount)).toBe(breakdown.lineTotal);
    });

    it("handles 1000 ARS with 21% VAT, qty 1", () => {
      const breakdown = calculateGrossTaxBreakdown(1000, 1, 21);
      expect(breakdown.grossSubtotal).toBe(1000);
      expect(breakdown.lineTotal).toBe(1000);
      expect(breakdown.netSubtotal).toBe(826.4463);
      expect(breakdown.taxAmount).toBe(173.5537);
      expect(add4(breakdown.netSubtotal, breakdown.taxAmount)).toBe(breakdown.lineTotal);
    });

    it("handles 100.0050 ARS with 21% VAT, qty 3", () => {
      const breakdown = calculateGrossTaxBreakdown(100.005, 3, 21);
      expect(breakdown.grossSubtotal).toBe(300.015);
      expect(breakdown.lineTotal).toBe(300.015);
      expect(breakdown.netSubtotal).toBe(247.9463);
      expect(breakdown.taxAmount).toBe(52.0687);
      expect(add4(breakdown.netSubtotal, breakdown.taxAmount)).toBe(breakdown.lineTotal);
    });

    it("handles 0 ARS price", () => {
      const breakdown = calculateGrossTaxBreakdown(0, 1, 21);
      expect(breakdown.grossSubtotal).toBe(0);
      expect(breakdown.lineTotal).toBe(0);
      expect(breakdown.netSubtotal).toBe(0);
      expect(breakdown.taxAmount).toBe(0);
    });

    it("rejects negative unit price", () => {
      expect(() => calculateGrossTaxBreakdown(-50, 1, 21)).toThrow(
        "Unit gross price cannot be negative",
      );
    });

    it("rejects non-positive quantity", () => {
      expect(() => calculateGrossTaxBreakdown(100, 0, 21)).toThrow(
        "Quantity must be positive",
      );
      expect(() => calculateGrossTaxBreakdown(100, -1, 21)).toThrow(
        "Quantity must be positive",
      );
    });

    it("handles gross discounts and derives net discount", () => {
      // 1000 ARS gross - 100 ARS discount = 900 ARS total
      const breakdown = calculateGrossTaxBreakdown(1000, 1, 21, 100);
      expect(breakdown.grossSubtotal).toBe(1000);
      expect(breakdown.grossDiscount).toBe(100);
      expect(breakdown.lineTotal).toBe(900);
      expect(breakdown.netSubtotal).toBe(826.4463);
      expect(breakdown.netDiscount).toBe(82.6446);
      // Net after discount: 826.4463 - 82.6446 = 743.8017
      // Tax: 900 - 743.8017 = 156.1983
      expect(breakdown.taxAmount).toBe(156.1983);
      const netAfterDiscount = sub4(breakdown.netSubtotal, breakdown.netDiscount);
      expect(add4(netAfterDiscount, breakdown.taxAmount)).toBe(breakdown.lineTotal);
    });

    it("rejects discount exceeding line subtotal", () => {
      expect(() => calculateGrossTaxBreakdown(100, 1, 21, 150)).toThrow(
        "Gross discount cannot exceed gross subtotal",
      );
    });

    it("handles 0% VAT rate", () => {
      const breakdown = calculateGrossTaxBreakdown(500, 2, 0);
      expect(breakdown.grossSubtotal).toBe(1000);
      expect(breakdown.lineTotal).toBe(1000);
      expect(breakdown.netSubtotal).toBe(1000);
      expect(breakdown.taxAmount).toBe(0);
    });
  });

  describe("syncCartWithCatalog controller", () => {
    it("detects and applies price and tax changes, returning new total", () => {
      const cart = [
        {
          key: "item-1",
          productId: "prod-1",
          displayName: "Producto A",
          priceArs: 1000,
          taxRatePercent: 21,
          quantity: 2,
          availableStock: 10,
        },
        {
          key: "item-2",
          productId: "prod-2",
          variantId: "var-2",
          displayName: "Producto B (Rojo)",
          priceArs: 500,
          taxRatePercent: 21,
          quantity: 1,
          availableStock: 5,
        },
      ];

      const catalog = [
        {
          id: "prod-1",
          name: "Producto A",
          priceArs: 1200, // Price changed from 1000 to 1200
          taxRatePercent: 21,
          stock: 8,
          hasVariants: false,
        },
        {
          id: "prod-2",
          name: "Producto B",
          priceArs: 400,
          taxRatePercent: 10.5, // Tax rate changed
          stock: 5,
          hasVariants: true,
          variants: [
            {
              id: "var-2",
              effectiveGrossPrice: 550, // Variant price changed from 500 to 550
              stock: 4,
            },
          ],
        },
      ];

      const result = syncCartWithCatalog(cart, catalog);
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toHaveLength(2);

      // Item 1: 1000 -> 1200
      expect(result.changes[0]).toMatchObject({
        key: "item-1",
        oldPrice: 1000,
        newPrice: 1200,
        priceChanged: true,
        taxChanged: false,
      });

      // Item 2: 500 -> 550, tax 21 -> 10.5
      expect(result.changes[1]).toMatchObject({
        key: "item-2",
        oldPrice: 500,
        newPrice: 550,
        oldTaxRate: 21,
        newTaxRate: 10.5,
        priceChanged: true,
        taxChanged: true,
      });

      // New total: 2 * 1200 + 1 * 550 = 2400 + 550 = 2950
      expect(result.newTotalArs).toBe(2950);
      expect(result.updatedCart[0].priceArs).toBe(1200);
      expect(result.updatedCart[1].priceArs).toBe(550);
      expect(result.updatedCart[1].taxRatePercent).toBe(10.5);
    });

    it("returns unchanged cart and hasChanges false when catalog prices match", () => {
      const cart = [
        {
          key: "item-1",
          productId: "prod-1",
          displayName: "Producto A",
          priceArs: 1000,
          taxRatePercent: 21,
          quantity: 1,
          availableStock: 10,
        },
      ];
      const catalog = [
        {
          id: "prod-1",
          name: "Producto A",
          priceArs: 1000,
          taxRatePercent: 21,
          stock: 10,
          hasVariants: false,
        },
      ];

      const result = syncCartWithCatalog(cart, catalog);
      expect(result.isValid).toBe(true);
      expect(result.hasChanges).toBe(false);
      expect(result.changes).toHaveLength(0);
      expect(result.newTotalArs).toBe(1000);
    });

    it("returns isValid false and error when a product is missing from catalog", () => {
      const cart = [
        {
          key: "item-1",
          productId: "prod-missing",
          displayName: "Producto Eliminado",
          priceArs: 1000,
          taxRatePercent: 21,
          quantity: 1,
          availableStock: 5,
        },
      ];
      const catalog: CatalogProductForSync[] = [];

      const result = syncCartWithCatalog(cart, catalog);
      expect(result.isValid).toBe(false);
      expect(result.errorReason).toBe("product_missing");
      expect(result.error).toContain("Producto Eliminado");
      expect(result.hasChanges).toBe(false);
    });

    it("returns isValid false and error without falling back to parent when variant is missing", () => {
      const cart = [
        {
          key: "item-var",
          productId: "prod-1",
          variantId: "var-missing",
          displayName: "Producto con Variante",
          priceArs: 1500,
          taxRatePercent: 21,
          quantity: 1,
          availableStock: 2,
        },
      ];
      const catalog: CatalogProductForSync[] = [
        {
          id: "prod-1",
          name: "Producto Padre",
          priceArs: 1000,
          taxRatePercent: 21,
          stock: 10,
          hasVariants: true,
          variants: [],
        },
      ];

      const result = syncCartWithCatalog(cart, catalog);
      expect(result.isValid).toBe(false);
      expect(result.errorReason).toBe("variant_missing");
      expect(result.hasChanges).toBe(false);
    });

    it("returns isValid false when product or variant is marked isPriceOutOfRange", () => {
      const cart = [
        {
          key: "item-1",
          productId: "prod-bad",
          displayName: "Producto Caro",
          priceArs: 1000,
          taxRatePercent: 21,
          quantity: 1,
          availableStock: 5,
        },
      ];
      const catalog: CatalogProductForSync[] = [
        {
          id: "prod-bad",
          name: "Producto Caro",
          priceArs: 2_000_000_000,
          taxRatePercent: 21,
          stock: 5,
          hasVariants: false,
          isPriceOutOfRange: true,
          priceRangeError: "Excede límite",
        },
      ];

      const result = syncCartWithCatalog(cart, catalog);
      expect(result.isValid).toBe(false);
      expect(result.errorReason).toBe("price_out_of_range");
      expect(result.error).toContain("fuera de rango");
    });

    it("validates effective selected price: parent > cap with absolute override 1500 is valid, while parent > cap with inheritance is invalid", () => {
      const cartOverride = [
        {
          key: "item-override",
          productId: "prod-cap",
          variantId: "var-override",
          displayName: "Teléfono Pro - Negro (Override 1500)",
          priceArs: 1500,
          taxRatePercent: 21,
          quantity: 1,
          availableStock: 10,
        },
      ];

      const cartInherited = [
        {
          key: "item-inherited",
          productId: "prod-cap",
          variantId: "var-inherited",
          displayName: "Teléfono Pro - Blanco (Heredado)",
          priceArs: 1000,
          taxRatePercent: 21,
          quantity: 1,
          availableStock: 10,
        },
      ];

      const catalog: CatalogProductForSync[] = [
        {
          id: "prod-cap",
          name: "Teléfono Pro",
          priceArs: 1_000_000_001,
          taxRatePercent: 21,
          stock: 20,
          hasVariants: true,
          isPriceOutOfRange: true,
          priceRangeError: "Precio base excede el límite POS de 1.000.000.000 ARS",
          variants: [
            {
              id: "var-override",
              effectiveGrossPrice: 1500,
              stock: 10,
              hasOverride: true,
              isPriceOutOfRange: false,
            },
            {
              id: "var-inherited",
              effectiveGrossPrice: 1_000_000_001,
              stock: 10,
              hasOverride: false,
            },
          ],
        },
      ];

      // Parent > cap + absolute override 1500 => VALID
      const resultOverride = syncCartWithCatalog(cartOverride, catalog);
      expect(resultOverride.isValid).toBe(true);
      expect(resultOverride.updatedCart[0].priceArs).toBe(1500);

      // Parent > cap + inheritance => INVALID (invalid base invalidates inheritance)
      const resultInherited = syncCartWithCatalog(cartInherited, catalog);
      expect(resultInherited.isValid).toBe(false);
      expect(resultInherited.errorReason).toBe("price_out_of_range");
      expect(resultInherited.error).toContain("hereda un precio base fuera de rango");
    });
  });

  describe("resolveVariantPrice (Authoritative Variant Price Resolution)", () => {
    it("marks inherited variant invalid when delta is out of range, does NOT convert delta to 0 nor quote parent base price", () => {
      // Base gross is 1000, raw delta is 1_000_000_001 (exceeds cap)
      const resolved = resolveVariantPrice({
        baseGrossPrice: 1000,
        productPriceOutOfRange: false,
        hasOverride: false,
        priceDelta: 1_000_000_001,
      });

      expect(resolved.isPriceOutOfRange).toBe(true);
      expect(resolved.effectiveGrossPrice).toBe(-1);
      expect(resolved.delta).toBe(0);
      expect(resolved.priceRangeError).toBeTruthy();
      expect(resolved.effectiveGrossPrice).not.toBe(1000);
    });

    it("ensures absolute override takes precedence even when legacy delta is invalid/out of range", () => {
      // Variant has override 1500, but legacy price_delta is 999_999_999_999 (invalid)
      const resolved = resolveVariantPrice({
        baseGrossPrice: 1000,
        productPriceOutOfRange: false,
        hasOverride: true,
        finalPriceArs: 1500,
        priceDelta: 999_999_999_999,
      });

      expect(resolved.isPriceOutOfRange).toBe(false);
      expect(resolved.effectiveGrossPrice).toBe(1500);
      expect(resolved.finalPrice).toBe(1500);
      expect(resolved.priceRangeError).toBeNull();
    });
  });

  describe("calculatePosCartTotals (Production Totals Controller)", () => {
    it("handles two lines of 600m (total 1.2bn) without throwing and reports overcap error", () => {
      const items = [
        { priceArs: 600_000_000, quantity: 1, taxRatePercent: 21 },
        { priceArs: 600_000_000, quantity: 1, taxRatePercent: 21 },
      ];
      const result = calculatePosCartTotals(items, 1000);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("supera el límite");
      expect(result.totalGrossArs).toBe(1_200_000_000); // No clamp, no truncar, no venta gratis
      expect(result.totalNetArs).toBe(991_735_537.19);
      expect(result.totalTaxArs).toBe(208_264_462.81);
      expect(result.totalUsd).toBe(1_200_000);
      expect(result.lines).toHaveLength(2);
    });

    it("handles single line 600m with qty 2 without throwing and reports overcap error", () => {
      const items = [
        { priceArs: 600_000_000, quantity: 2, taxRatePercent: 21 },
      ];
      const result = calculatePosCartTotals(items);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("supera el límite");
      expect(result.totalGrossArs).toBe(1_200_000_000);
      expect(result.totalNetArs).toBe(991_735_537.1901);
      expect(result.totalTaxArs).toBe(208_264_462.8099);
      expect(add4(result.totalNetArs, result.totalTaxArs)).toBe(result.totalGrossArs);
      expect(result.lines).toHaveLength(1);
    });

    it("handles exactly 1e9 ARS (conservative limit) successfully", () => {
      const items = [
        { priceArs: 1_000_000_000, quantity: 1, taxRatePercent: 21 },
      ];
      const result = calculatePosCartTotals(items);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
      expect(result.totalGrossArs).toBe(1_000_000_000);
      expect(result.totalNetArs).toBe(826_446_280.9917);
      expect(result.totalTaxArs).toBe(173_553_719.0083);
      expect(add4(result.totalNetArs, result.totalTaxArs)).toBe(result.totalGrossArs);
    });

    it("handles 0.33 ARS qty 1 tax 16.6667% matching exact Postgres numeric(18, 4)", () => {
      const items = [
        { priceArs: 0.33, quantity: 1, taxRatePercent: 16.6667 },
      ];
      const result = calculatePosCartTotals(items);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
      expect(result.totalGrossArs).toBe(0.33);
      expect(result.totalNetArs).toBe(0.2829);
      expect(result.totalTaxArs).toBe(0.0471);
      expect(add4(result.totalNetArs, result.totalTaxArs)).toBe(result.totalGrossArs);
    });

    it("handles 100.0050 ARS with qty 3 and 21% VAT", () => {
      const items = [
        { priceArs: 100.005, quantity: 3, taxRatePercent: 21 },
      ];
      const result = calculatePosCartTotals(items);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
      expect(result.totalGrossArs).toBe(300.015);
      expect(result.totalNetArs).toBe(247.9463);
      expect(result.totalTaxArs).toBe(52.0687);
      expect(add4(result.totalNetArs, result.totalTaxArs)).toBe(result.totalGrossArs);
    });

    it("handles empty cart and 0 ARS price lines as valid total 0 without payments", () => {
      const emptyResult = calculatePosCartTotals([]);
      expect(emptyResult.isValid).toBe(true);
      expect(emptyResult.error).toBeNull();
      expect(emptyResult.totalGrossArs).toBe(0);
      expect(emptyResult.totalNetArs).toBe(0);
      expect(emptyResult.totalTaxArs).toBe(0);

      const zeroLineResult = calculatePosCartTotals([
        { priceArs: 0, quantity: 1, taxRatePercent: 21 },
      ]);
      expect(zeroLineResult.isValid).toBe(true);
      expect(zeroLineResult.error).toBeNull();
      expect(zeroLineResult.totalGrossArs).toBe(0);
      expect(zeroLineResult.totalNetArs).toBe(0);
      expect(zeroLineResult.totalTaxArs).toBe(0);

      // Verify payment lines generation for total 0
      const paymentLines = buildPosPaymentLines(
        zeroLineResult.totalGrossArs,
        "10000000-0000-4000-8000-000000000006",
        null,
      );
      expect(paymentLines).toEqual([]);
    });

    it("builds tender payment line when total > 0", () => {
      const paymentLines = buildPosPaymentLines(
        2500,
        "10000000-0000-4000-8000-000000000006",
        "cash-session-123",
      );
      expect(paymentLines).toEqual([
        {
          payment_method_id: "10000000-0000-4000-8000-000000000006",
          cash_session_id: "cash-session-123",
          amount: 2500,
          currency_code: "ARS",
        },
      ]);
    });
  });
});
