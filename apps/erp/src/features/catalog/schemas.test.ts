import { describe, expect, it } from "vitest";
import {
  calculateStockSummary,
  getActiveBarcode,
  getErrorMessage,
  type DbStockBalance,
} from "./schemas";

describe("Utilidades del catálogo", () => {
  describe("calculateStockSummary", () => {
    it("computes on-hand, reserved, and available stock across multiple locations", () => {
      const balances: DbStockBalance[] = [
        { variant_id: "var-1", quantity_on_hand: 10, quantity_reserved: 2, location_id: "loc-1" },
        { variant_id: "var-1", quantity_on_hand: 5, quantity_reserved: 1, location_id: "loc-2" },
        { variant_id: "var-2", quantity_on_hand: 4, quantity_reserved: 0, location_id: "loc-1" },
      ];

      // Variant 1: onHand 15, reserved 3 -> available 12
      const var1 = calculateStockSummary(balances, "var-1");
      expect(var1.onHand).toBe(15);
      expect(var1.reserved).toBe(3);
      expect(var1.available).toBe(12);

      // Total across all variants: onHand 19, reserved 3 -> available 16
      const total = calculateStockSummary(balances);
      expect(total.onHand).toBe(19);
      expect(total.reserved).toBe(3);
      expect(total.available).toBe(16);
    });

    it("clamps negative available stock to zero", () => {
      const balances: DbStockBalance[] = [
        { variant_id: null, quantity_on_hand: 2, quantity_reserved: 5, location_id: "loc-1" },
      ];

      const res = calculateStockSummary(balances);
      expect(res.onHand).toBe(2);
      expect(res.reserved).toBe(5);
      expect(res.available).toBe(0); // Never negative
    });

    it("clamps negative available stock per location before summing", () => {
      const balances: DbStockBalance[] = [
        { quantity_on_hand: -2, quantity_reserved: 0, variant_id: null, location_id: "loc-1" },
        { quantity_on_hand: 5, quantity_reserved: 0, variant_id: null, location_id: "loc-2" },
      ];

      const res = calculateStockSummary(balances);
      expect(res.onHand).toBe(3);
      expect(res.reserved).toBe(0);
      expect(res.available).toBe(5);
    });
  });

  describe("getErrorMessage", () => {
    it("extracts message from Supabase/PostgREST error object without fallback", () => {
      const supaErr = {
        message: "duplicate key value violates unique constraint 'products_internal_code_key'",
        code: "23505",
        details: "Key already exists",
      };
      expect(getErrorMessage(supaErr, "Fallback error")).toBe(
        "duplicate key value violates unique constraint 'products_internal_code_key'",
      );
    });

    it("extracts message from standard Error instance", () => {
      const stdErr = new Error("Network timeout");
      expect(getErrorMessage(stdErr, "Fallback error")).toBe("Network timeout");
    });

    it("uses fallback when error is empty or undefined", () => {
      expect(getErrorMessage(null, "Default fallback")).toBe("Default fallback");
      expect(getErrorMessage({}, "Default fallback")).toBe("Default fallback");
    });
  });

  describe("getActiveBarcode", () => {
    it("returns empty string when identifiers are missing or empty", () => {
      expect(getActiveBarcode(undefined)).toBe("");
      expect(getActiveBarcode([])).toBe("");
    });

    it("ignores deactivated barcodes and does not revive deleted barcodes", () => {
      const identifiers = [
        { kind: "barcode", value: "7790000001", is_active: false, is_primary: true },
        { kind: "barcode", value: "7790000002", is_active: false, is_primary: false },
      ];
      expect(getActiveBarcode(identifiers)).toBe("");
    });

    it("returns active primary barcode when available", () => {
      const identifiers = [
        { kind: "barcode", value: "7790000001", is_active: false, is_primary: false },
        { kind: "barcode", value: "7790000002", is_active: true, is_primary: true },
        { kind: "internal", value: "SKU-TEST-01", is_active: true, is_primary: true },
      ];
      expect(getActiveBarcode(identifiers)).toBe("7790000002");
    });

    it("falls back to active barcode when is_primary is not set", () => {
      const identifiers = [
        { kind: "barcode", value: "7790000099", is_active: true },
      ];
      expect(getActiveBarcode(identifiers)).toBe("7790000099");
    });
  });
});
