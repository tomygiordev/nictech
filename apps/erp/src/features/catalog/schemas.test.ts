import { describe, expect, it } from "vitest";
import {
  productCreateSchema,
  productUpdateSchema,
  stockIntakeSchema,
  variantRowSchema,
  manageVariantItemSchema,
  manageProductVariantsSchema,
  setProductCompatibleModelsSchema,
  buildCreateCatalogPayload,
  buildStockIntakePayload,
  buildManageVariantsPayload,
  buildSetProductCompatibleModelsPayload,
  calculateStockSummary,
  calculateFiscalBreakdown,
  getActiveBarcode,
  getActiveSku,
  getErrorMessage,
  getVariantEffectivePrice,
  type DbStockBalance,
} from "./schemas";

describe("Catalog Zod Schemas & Payloads", () => {
  describe("productCreateSchema", () => {
    it("validates a standard product without variants", () => {
      const input = {
        internal_code: "carg-20w",
        internal_name: "Cargador Rápido 20W",
        base_sale_price: 15000,
        base_cost: 6500,
        has_variants: false,
        variants: [],
      };

      const parsed = productCreateSchema.parse(input);
      expect(parsed.internal_code).toBe("CARG-20W");
      expect(parsed.internal_name).toBe("Cargador Rápido 20W");
      expect(parsed.base_sale_price).toBe(15000);
      expect(parsed.base_cost).toBe(6500);
    });

    it("validates a product (funda) with multiple color variants and barcodes", () => {
      const input = {
        internal_code: "funda-ip14",
        internal_name: "Funda Silicona iPhone 14",
        base_sale_price: 12100,
        base_cost: 4000,
        category_id: "00000000-0000-0000-0000-000000000001",
        brand_id: "00000000-0000-0000-0000-000000000002",
        model_id: "00000000-0000-0000-0000-000000000003",
        has_variants: true,
        variants: [
          { name: "Negro", code: "neg", barcode: "779001", sku: "SKU-IP14-NEG" },
          { name: "Rosa", code: "ros", barcode: "779002", sku: "SKU-IP14-ROS" },
        ],
      };

      const parsed = productCreateSchema.parse(input);
      expect(parsed.internal_code).toBe("FUNDA-IP14");
      expect(parsed.variants).toHaveLength(2);
      expect(parsed.variants[0].code).toBe("NEG");
      expect(parsed.variants[1].code).toBe("ROS");
    });

    it("rejects when required code or name are missing or empty", () => {
      const res1 = productCreateSchema.safeParse({
        internal_code: "   ",
        internal_name: "Producto",
        base_sale_price: 1000,
      });
      expect(res1.success).toBe(false);

      const res2 = productCreateSchema.safeParse({
        internal_code: "PROD-1",
        internal_name: "   ",
        base_sale_price: 1000,
      });
      expect(res2.success).toBe(false);
    });

    it("rejects empty string and blank price without silently converting to 0", () => {
      const emptyStrRes = productCreateSchema.safeParse({
        internal_code: "PROD-EMPTY",
        internal_name: "Producto Sin Precio",
        base_sale_price: "",
      });
      expect(emptyStrRes.success).toBe(false);

      const whitespaceRes = productCreateSchema.safeParse({
        internal_code: "PROD-WHITE",
        internal_name: "Producto Espacio",
        base_sale_price: "   ",
      });
      expect(whitespaceRes.success).toBe(false);
    });

    it("rejects non-finite values (Infinity, -Infinity, NaN) for price and cost", () => {
      const infPrice = productCreateSchema.safeParse({
        internal_code: "PROD-INF",
        internal_name: "Infinito",
        base_sale_price: Infinity,
      });
      expect(infPrice.success).toBe(false);

      const nanPrice = productCreateSchema.safeParse({
        internal_code: "PROD-NAN",
        internal_name: "NaN Precio",
        base_sale_price: NaN,
      });
      expect(nanPrice.success).toBe(false);

      const infCost = productCreateSchema.safeParse({
        internal_code: "PROD-COST-INF",
        internal_name: "Costo Infinito",
        base_sale_price: 1000,
        base_cost: Infinity,
      });
      expect(infCost.success).toBe(false);

      const nanCost = productCreateSchema.safeParse({
        internal_code: "PROD-COST-NAN",
        internal_name: "Costo NaN",
        base_sale_price: 1000,
        base_cost: "no-numero",
      });
      expect(nanCost.success).toBe(false);
    });

    it("accepts empty string for base_cost defaulting safely to 0", () => {
      const parsed = productCreateSchema.parse({
        internal_code: "PROD-DEFAULT-COST",
        internal_name: "Costo Vacio",
        base_sale_price: 5000,
        base_cost: "",
      });
      expect(parsed.base_cost).toBe(0);
    });

    it("never silently drops incomplete variants and reports error", () => {
      const input = {
        internal_code: "FUNDA-SAM",
        internal_name: "Funda Samsung S23",
        base_sale_price: 8000,
        has_variants: true,
        variants: [
          { name: "Negro", code: "NEG" },
          { name: "", code: "AZU" }, // Empty name
        ],
      };

      const res = productCreateSchema.safeParse(input);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0].message).toContain("El color / nombre de la variante es obligatorio");
      }
    });

    it("rejects duplicate variant codes within the same product", () => {
      const input = {
        internal_code: "FUNDA-TEST",
        internal_name: "Funda Test",
        base_sale_price: 5000,
        has_variants: true,
        variants: [
          { name: "Negro Mate", code: "NEG" },
          { name: "Negro Brillante", code: "neg" }, // Case-insensitive duplicate
        ],
      };

      const res = productCreateSchema.safeParse(input);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0].message).toContain("Código de variante duplicado: 'NEG'");
      }
    });

    it("rejects duplicate barcodes within the same product variants", () => {
      const input = {
        internal_code: "FUNDA-BARCODE",
        internal_name: "Funda Test Barcode",
        base_sale_price: 5000,
        has_variants: true,
        variants: [
          { name: "Rojo", code: "ROJ", barcode: "779123456" },
          { name: "Azul", code: "AZU", barcode: "779123456" }, // Duplicate barcode
        ],
      };

      const res = productCreateSchema.safeParse(input);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0].message).toContain("Código de barras duplicado: '779123456'");
      }
    });
  });

  describe("buildCreateCatalogPayload", () => {
    it("enforces inherited price invariant (price_delta = 0) and matches RPC signature", () => {
      const input = productCreateSchema.parse({
        internal_code: "funda-ip13",
        internal_name: "Funda Silicona iPhone 13",
        base_sale_price: 9500,
        base_cost: 3200,
        category_id: "11111111-1111-1111-1111-111111111111",
        has_variants: true,
        variants: [
          { name: "Azul Sierra", code: "AZS", barcode: "779999", sku: "SKU-AZS" },
        ],
      });

      const payload = buildCreateCatalogPayload(input);
      expect(payload.p_internal_code).toBe("FUNDA-IP13");
      expect(payload.p_internal_name).toBe("Funda Silicona iPhone 13");
      expect(payload.p_base_sale_price).toBe(9500);
      expect(payload.p_base_cost).toBe(3200);
      expect(payload.p_tax_rate_percent).toBe(21);
      expect(payload.p_category_id).toBe("11111111-1111-1111-1111-111111111111");
      expect(payload.p_brand_id).toBeUndefined();
      expect(payload.p_model_id).toBeUndefined();

      expect(payload.p_variants).toHaveLength(1);
      expect(payload.p_variants[0]).toEqual({
        name: "Azul Sierra",
        code: "AZS",
        attributes: { color: "Azul Sierra" },
        price_delta: 0, // Strict invariant: variant price is inherited from parent!
        final_price_mode: "inherit",
        final_price_ars: null,
        barcode: "779999",
        sku: "SKU-AZS",
      });
    });

    it("supports variants with own final ARS price in create catalog payload", () => {
      const input = productCreateSchema.parse({
        internal_code: "FUNDA-IP13",
        internal_name: "Funda Silicona iPhone 13",
        base_sale_price: 9500,
        has_variants: true,
        variants: [
          { name: "Negro", code: "NEG", price_mode: "inherit" },
          { name: "Dorado Edición Especial", code: "DOR", price_mode: "own", final_price_ars: 14500.5 },
        ],
      });

      const payload = buildCreateCatalogPayload(input);
      expect(payload.p_variants).toHaveLength(2);
      expect(payload.p_variants[0].final_price_mode).toBe("inherit");
      expect(payload.p_variants[0].final_price_ars).toBeNull();
      expect(payload.p_variants[1].final_price_mode).toBe("own");
      expect(payload.p_variants[1].final_price_ars).toBe(14500.5);
    });

    it("rejects empty or negative own prices in variantRowSchema", () => {
      const resNeg = variantRowSchema.safeParse({
        name: "Negro",
        code: "NEG",
        price_mode: "own",
        final_price_ars: -100,
      });
      expect(resNeg.success).toBe(false);

      const resEmpty = variantRowSchema.safeParse({
        name: "Negro",
        code: "NEG",
        price_mode: "own",
        final_price_ars: "",
      });
      expect(resEmpty.success).toBe(false);

      const resNaN = variantRowSchema.safeParse({
        name: "Negro",
        code: "NEG",
        price_mode: "own",
        final_price_ars: "abc",
      });
      expect(resNaN.success).toBe(false);

      const resZero = variantRowSchema.safeParse({
        name: "Negro",
        code: "NEG",
        price_mode: "own",
        final_price_ars: 0,
      });
      expect(resZero.success).toBe(true);
    });
  });

  describe("productUpdateSchema", () => {
    it("validates safe updating of product attributes without touching variants or stock balances", () => {
      const input = {
        id: "22222222-2222-2222-2222-222222222222",
        internal_name: "Funda Silicona iPhone 13 Pro (Actualizado)",
        public_name: "Funda iPhone 13 Pro Web",
        base_sale_price: 11000,
        is_active: false,
      };

      const parsed = productUpdateSchema.parse(input);
      expect(parsed.id).toBe("22222222-2222-2222-2222-222222222222");
      expect(parsed.internal_name).toBe("Funda Silicona iPhone 13 Pro (Actualizado)");
      expect(parsed.public_name).toBe("Funda iPhone 13 Pro Web");
      expect(parsed.base_sale_price).toBe(11000);
      expect(parsed.is_active).toBe(false);
    });

    it("rejects blank or invalid sale prices in update", () => {
      const res = productUpdateSchema.safeParse({
        id: "22222222-2222-2222-2222-222222222222",
        internal_name: "Valido",
        base_sale_price: "",
      });
      expect(res.success).toBe(false);
    });
  });

  describe("stockIntakeSchema & buildStockIntakePayload", () => {
    it("validates positive quantity and audit reason", () => {
      const valid = stockIntakeSchema.parse({
        productId: "33333333-3333-3333-3333-333333333333",
        variantId: "44444444-4444-4444-4444-444444444444",
        branchId: "55555555-5555-5555-5555-555555555555",
        locationId: "66666666-6666-6666-6666-666666666666",
        quantity: 10,
        unitCost: 3500,
        reason: "Carga inicial de inventario",
        operationKey: "op-key-123",
      });

      expect(valid.quantity).toBe(10);
      expect(valid.unitCost).toBe(3500);

      const payload = buildStockIntakePayload(valid);
      expect(payload.document_kind).toBe("adjustment");
      expect(payload.target_branch_id).toBe("55555555-5555-5555-5555-555555555555");
      expect(payload.operation_key).toBe("op-key-123");
      expect(payload.operation_reason).toBe("Carga inicial de inventario");
      expect(payload.lines).toEqual([
        {
          product_id: "33333333-3333-3333-3333-333333333333",
          variant_id: "44444444-4444-4444-4444-444444444444",
          quantity: 10,
          unit_cost: 3500,
          from_location_id: null,
          to_location_id: "66666666-6666-6666-6666-666666666666",
        },
      ]);
    });

    it("strictly rejects fractional stock quantities (e.g. 1.5, 0.5)", () => {
      const fracNum = stockIntakeSchema.safeParse({
        productId: "33333333-3333-3333-3333-333333333333",
        branchId: "55555555-5555-5555-5555-555555555555",
        locationId: "66666666-6666-6666-6666-666666666666",
        quantity: 1.5,
        reason: "Ingreso fraccionario",
        operationKey: "key-frac",
      });
      expect(fracNum.success).toBe(false);
      if (!fracNum.success) {
        expect(fracNum.error.issues[0].message).toContain("número entero");
      }

      const fracStr = stockIntakeSchema.safeParse({
        productId: "33333333-3333-3333-3333-333333333333",
        branchId: "55555555-5555-5555-5555-555555555555",
        locationId: "66666666-6666-6666-6666-666666666666",
        quantity: "2.3",
        reason: "Ingreso fraccionario string",
        operationKey: "key-frac-str",
      });
      expect(fracStr.success).toBe(false);
    });

    it("rejects non-positive quantity and blank reasons", () => {
      const res = stockIntakeSchema.safeParse({
        productId: "33333333-3333-3333-3333-333333333333",
        branchId: "55555555-5555-5555-5555-555555555555",
        locationId: "66666666-6666-6666-6666-666666666666",
        quantity: 0,
        reason: "  ",
        operationKey: "key-1",
      });
      expect(res.success).toBe(false);
    });

    it("rejects blank operation key and non-finite quantities", () => {
      const blankKey = stockIntakeSchema.safeParse({
        productId: "33333333-3333-3333-3333-333333333333",
        branchId: "55555555-5555-5555-5555-555555555555",
        locationId: "66666666-6666-6666-6666-666666666666",
        quantity: 5,
        reason: "Motivo correcto",
        operationKey: "",
      });
      expect(blankKey.success).toBe(false);

      const infQty = stockIntakeSchema.safeParse({
        productId: "33333333-3333-3333-3333-333333333333",
        branchId: "55555555-5555-5555-5555-555555555555",
        locationId: "66666666-6666-6666-6666-666666666666",
        quantity: Infinity,
        reason: "Motivo correcto",
        operationKey: "key-inf",
      });
      expect(infQty.success).toBe(false);
    });
  });

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
  });

  describe("calculateFiscalBreakdown", () => {
    it("matches acceptance cases from baseline contract with default 21%", () => {
      // Case 1: Round number $12.100 -> Net $10.000, Tax $2.100
      const c1 = calculateFiscalBreakdown(12100);
      expect(c1.net).toBe(10000);
      expect(c1.tax).toBe(2100);
      expect(c1.net + c1.tax).toBe(12100);

      // Case 2: Fractional $1.000 -> Net $826.45, Tax $173.55
      const c2 = calculateFiscalBreakdown(1000);
      expect(c2.net).toBe(826.45);
      expect(c2.tax).toBe(173.55);
      expect(c2.net + c2.tax).toBe(1000);

      // Case 3: $3.499,99 -> Net $2.892,55, Tax $607,44
      const c3 = calculateFiscalBreakdown(3499.99);
      expect(c3.net).toBe(2892.55);
      expect(c3.tax).toBe(607.44);
      expect(Math.round((c3.net + c3.tax) * 100) / 100).toBe(3499.99);
    });

    it("correctly computes breakdown with custom tax rates (e.g. 10.5% or 0%)", () => {
      // 10.5% IVA
      const res10 = calculateFiscalBreakdown(11050, 10.5);
      expect(res10.net).toBe(10000);
      expect(res10.tax).toBe(1050);
      expect(res10.total).toBe(11050);

      // 0% IVA (exento)
      const res0 = calculateFiscalBreakdown(5000, 0);
      expect(res0.net).toBe(5000);
      expect(res0.tax).toBe(0);
      expect(res0.total).toBe(5000);
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

  describe("manageProductVariantsSchema & Payloads", () => {
    it("validates editing existing and adding new variants with normalized codes", () => {
      const input = {
        productId: "90000000-0000-0000-0000-000000000009",
        expectedUpdatedAt: "2026-10-20T20:00:00Z",
        variants: [
          {
            id: "80000000-0000-0000-0000-000000000008",
            name: "Negro Mate",
            code: "neg",
            barcode: "77912345",
            is_active: true,
          },
          {
            id: null,
            name: "Azul Medianoche",
            code: "azu",
            barcode: "77912346",
            is_active: true,
          },
        ],
      };

      const parsed = manageProductVariantsSchema.parse(input);
      expect(parsed.variants).toHaveLength(2);
      expect(parsed.variants[0].code).toBe("NEG");
      expect(parsed.variants[1].code).toBe("AZU");
      expect(parsed.variants[0].is_active).toBe(true);

      const payload = buildManageVariantsPayload(parsed);
      expect(payload.p_product_id).toBe("90000000-0000-0000-0000-000000000009");
      expect(payload.p_expected_updated_at).toBe("2026-10-20T20:00:00Z");
      expect(payload.p_variants[0].id).toBe("80000000-0000-0000-0000-000000000008");
      expect(payload.p_variants[1].id).toBeNull();
    });

    it("rejects duplicate variant codes within payload", () => {
      const input = {
        productId: "90000000-0000-0000-0000-000000000009",
        variants: [
          { name: "Negro", code: "NEG", is_active: true },
          { name: "Negro Brillante", code: "neg", is_active: true },
        ],
      };

      const res = manageProductVariantsSchema.safeParse(input);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain("Código de variante duplicado");
      }
    });

    it("rejects duplicate non-empty barcodes within payload", () => {
      const input = {
        productId: "90000000-0000-0000-0000-000000000009",
        variants: [
          { name: "Negro", code: "NEG", barcode: "779001", is_active: true },
          { name: "Rojo", code: "ROJ", barcode: " 779001 ", is_active: true },
        ],
      };

      const res = manageProductVariantsSchema.safeParse(input);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain("Código de barras duplicado");
      }
    });

    it("supports pausing existing variants (is_active = false) without hard delete", () => {
      const input = {
        productId: "90000000-0000-0000-0000-000000000009",
        variants: [
          {
            id: "80000000-0000-0000-0000-000000000008",
            name: "Negro",
            code: "NEG",
            is_active: false,
          },
        ],
      };

      const parsed = manageProductVariantsSchema.parse(input);
      expect(parsed.variants[0].is_active).toBe(false);
    });
  });

  describe("setProductCompatibleModelsSchema & Payloads", () => {
    it("validates product ID and deduplicates model IDs, passing expectedUpdatedAt", () => {
      const input = {
        productId: "90000000-0000-0000-0000-000000000009",
        expectedUpdatedAt: "2026-10-20T12:00:00Z",
        modelIds: [
          "30000000-0000-0000-0000-000000000001",
          "30000000-0000-0000-0000-000000000002",
          "30000000-0000-0000-0000-000000000001", // duplicate
        ],
      };

      const parsed = setProductCompatibleModelsSchema.parse(input);
      expect(parsed.modelIds).toHaveLength(3);
      expect(parsed.expectedUpdatedAt).toBe("2026-10-20T12:00:00Z");

      const payload = buildSetProductCompatibleModelsPayload(parsed);
      expect(payload.p_product_id).toBe("90000000-0000-0000-0000-000000000009");
      expect(payload.p_expected_updated_at).toBe("2026-10-20T12:00:00Z");
      expect(payload.p_model_ids).toHaveLength(2);
      expect(payload.p_model_ids).toEqual([
        "30000000-0000-0000-0000-000000000001",
        "30000000-0000-0000-0000-000000000002",
      ]);
    });

    it("rejects invalid UUIDs for product or models", () => {
      const invalidProduct = setProductCompatibleModelsSchema.safeParse({
        productId: "not-a-uuid",
        modelIds: ["30000000-0000-0000-0000-000000000001"],
      });
      expect(invalidProduct.success).toBe(false);

      const invalidModel = setProductCompatibleModelsSchema.safeParse({
        productId: "90000000-0000-0000-0000-000000000009",
        modelIds: ["not-a-uuid"],
      });
      expect(invalidModel.success).toBe(false);
    });
  });

  describe("getActiveBarcode & getActiveSku identifier helpers", () => {
    it("returns empty string when identifiers are missing or empty", () => {
      expect(getActiveBarcode(undefined)).toBe("");
      expect(getActiveBarcode([])).toBe("");
      expect(getActiveSku(undefined)).toBe("");
      expect(getActiveSku([])).toBe("");
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
      expect(getActiveSku(identifiers)).toBe("SKU-TEST-01");
    });

    it("falls back to active barcode when is_primary is not set", () => {
      const identifiers = [
        { kind: "barcode", value: "7790000099", is_active: true },
      ];
      expect(getActiveBarcode(identifiers)).toBe("7790000099");
    });
  });

  describe("manageVariantItemSchema & own final price", () => {
    it("validates own final price and inherit modes in manageVariantItemSchema", () => {
      const ownItem = manageVariantItemSchema.parse({
        name: "Negro Mate",
        code: "NEG",
        price_mode: "own",
        final_price_ars: 18500,
        is_active: true,
      });
      expect(ownItem.price_mode).toBe("own");
      expect(ownItem.final_price_ars).toBe(18500);

      const inheritItem = manageVariantItemSchema.parse({
        name: "Negro Mate",
        code: "NEG",
        price_mode: "inherit",
        final_price_ars: null,
        is_active: true,
      });
      expect(inheritItem.price_mode).toBe("inherit");
      expect(inheritItem.final_price_ars).toBeNull();
    });

    it("allows omission of price fields to support legacy clients and preserve override without emitting keys", () => {
      const legacyItem = manageVariantItemSchema.parse({
        id: "80000000-0000-0000-0000-000000000008",
        name: "Negro Mate",
        code: "NEG",
        is_active: true,
      });
      expect(legacyItem.price_mode).toBeUndefined();
      expect(legacyItem.final_price_ars).toBeUndefined();

      const payload = buildManageVariantsPayload({
        productId: "90000000-0000-0000-0000-000000000009",
        variants: [legacyItem],
      });
      expect(payload.p_variants[0]).not.toHaveProperty("final_price_mode");
      expect(payload.p_variants[0]).not.toHaveProperty("final_price_ars");

      // Verify JSON serialization omits BOTH keys completely
      const serialized = JSON.parse(JSON.stringify(payload.p_variants[0]));
      expect(serialized).not.toHaveProperty("final_price_mode");
      expect(serialized).not.toHaveProperty("final_price_ars");
    });

    it("explicit null final_price_ars preserves inherit semantics and includes key in payload", () => {
      const explicitNullItem = manageVariantItemSchema.parse({
        id: "80000000-0000-0000-0000-000000000008",
        name: "Negro Mate",
        code: "NEG",
        is_active: true,
        final_price_ars: null,
      });
      expect(explicitNullItem.price_mode).toBeUndefined();
      expect(explicitNullItem.final_price_ars).toBeNull();

      const payload = buildManageVariantsPayload({
        productId: "90000000-0000-0000-0000-000000000009",
        variants: [explicitNullItem],
      });
      expect(payload.p_variants[0]).not.toHaveProperty("final_price_mode");
      expect(payload.p_variants[0]).toHaveProperty("final_price_ars", null);

      const serialized = JSON.parse(JSON.stringify(payload.p_variants[0]));
      expect(serialized).not.toHaveProperty("final_price_mode");
      expect(serialized).toHaveProperty("final_price_ars", null);
    });

    it("allows 0 as a valid own price (e.g. sample or free variant promo)", () => {
      const zeroItem = manageVariantItemSchema.parse({
        name: "Muestra",
        code: "MUE",
        price_mode: "own",
        final_price_ars: 0,
        is_active: true,
      });
      expect(zeroItem.price_mode).toBe("own");
      expect(zeroItem.final_price_ars).toBe(0);

      const payload = buildManageVariantsPayload({
        productId: "90000000-0000-0000-0000-000000000009",
        variants: [zeroItem],
      });
      expect(payload.p_variants[0]).toHaveProperty("final_price_mode", "own");
      expect(payload.p_variants[0]).toHaveProperty("final_price_ars", 0);
    });

    it("rejects invalid, negative or NaN own prices", () => {
      const resNeg = manageVariantItemSchema.safeParse({
        name: "Negro",
        code: "NEG",
        price_mode: "own",
        final_price_ars: -50,
      });
      expect(resNeg.success).toBe(false);

      const resNaN = manageVariantItemSchema.safeParse({
        name: "Negro",
        code: "NEG",
        price_mode: "own",
        final_price_ars: "not-a-number",
      });
      expect(resNaN.success).toBe(false);

      const resEmpty = manageVariantItemSchema.safeParse({
        name: "Negro",
        code: "NEG",
        price_mode: "own",
        final_price_ars: null,
      });
      expect(resEmpty.success).toBe(false);
    });
  });

  describe("getVariantEffectivePrice helper", () => {
    it("returns own final price override when final_price_ars is set", () => {
      const res = getVariantEffectivePrice(10000, {
        final_price_ars: 15500,
        price_delta: 0,
      });
      expect(res.price).toBe(15500);
      expect(res.isOverride).toBe(true);
      expect(res.hasLegacyDelta).toBe(false);
    });

    it("override wins over legacy price_delta without subtracting from parent", () => {
      const res = getVariantEffectivePrice(10000, {
        final_price_ars: 17000,
        price_delta: 2500, // Legacy delta ignored because override is explicit!
      });
      expect(res.price).toBe(17000);
      expect(res.isOverride).toBe(true);
      expect(res.hasLegacyDelta).toBe(false);
    });

    it("inherits parent price when final_price_ars is null and no delta", () => {
      const res = getVariantEffectivePrice(10000, {
        final_price_ars: null,
        price_delta: 0,
      });
      expect(res.price).toBe(10000);
      expect(res.isOverride).toBe(false);
      expect(res.hasLegacyDelta).toBe(false);
    });

    it("preserves legacy delta when final_price_ars is null and price_delta is non-zero", () => {
      const res = getVariantEffectivePrice(10000, {
        final_price_ars: null,
        price_delta: 3000,
      });
      expect(res.price).toBe(13000);
      expect(res.isOverride).toBe(false);
      expect(res.hasLegacyDelta).toBe(true);
    });

    it("handles null or undefined variant gracefully", () => {
      const resNull = getVariantEffectivePrice(10000, null);
      expect(resNull.price).toBe(10000);
      expect(resNull.isOverride).toBe(false);

      const resUndef = getVariantEffectivePrice(10000, undefined);
      expect(resUndef.price).toBe(10000);
      expect(resUndef.isOverride).toBe(false);
    });
  });
});
