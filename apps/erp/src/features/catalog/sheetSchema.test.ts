import { describe, expect, it } from "vitest";
import { buildStockIntakePayload } from "./schemas";
import { createCatalogSheetSchema, stockIntakeSchema, suggestCatalogName } from "./sheetSchema";

const locationId = "30000000-0000-4000-8000-000000000003";
const anotherLocationId = "30000000-0000-4000-8000-000000000004";
const catalogSheetSchema = createCatalogSheetSchema([locationId]);
const base = {
  isNew: true,
  template: "accesorio",
  name: "  Cable   USB ",
  category: "10000000-0000-4000-8000-000000000001",
  brand: "20000000-0000-4000-8000-000000000002",
  model: "",
  cost: "50",
  price: "0",
  description: "",
  publicName: "",
  tags: "",
  capacity: "",
  condition: "",
};

describe("esquema de ficha", () => {
  it.each(["accesorio", "funda"])("valida %s sin modelo único", (template) => {
    expect(catalogSheetSchema.safeParse({ ...base, template }).success).toBe(true);
  });
  it("requiere modelo de celular, marca, categoría y costo al crear", () => {
    expect(catalogSheetSchema.safeParse({ ...base, template: "celular" }).success).toBe(false);
    expect(catalogSheetSchema.safeParse({ ...base, brand: "", category: "", cost: "" }).success).toBe(false);
  });
  it("acepta edición legacy incompleta y precio con hasta dos decimales", () => {
    expect(catalogSheetSchema.safeParse({ ...base, isNew: false, brand: "", category: "", cost: "" }).success).toBe(true);
    expect(catalogSheetSchema.safeParse({ ...base, price: "1.001" }).success).toBe(false);
  });
  it("normaliza espacios del nombre sugerido", () => {
    expect(suggestCatalogName("Funda", "  Genérico  ", " iPhone 13 ")).toBe("Funda Genérico iPhone 13");
  });
  it("ignora filas intactas y permite variantes previas sin stock", () => {
    expect(catalogSheetSchema.safeParse({
      ...base,
      initialStock: [undefined, { quantity: "", locationId: "", unitCost: "" }, { quantity: "2", unitCost: "12" }],
    }).success).toBe(true);
  });

  it.each([
    [{ quantity: "", unitCost: "12" }, "quantity"],
    [{ quantity: "1.5", unitCost: "12" }, "quantity"],
    [{ quantity: "0", unitCost: "12" }, "quantity"],
    [{ quantity: "1", unitCost: "" }, "unitCost"],
    [{ quantity: "1", unitCost: "-1" }, "unitCost"],
    [{ quantity: "1", unitCost: "0" }, "confirmZeroCost"],
    [{ locationId }, "quantity"],
    [{ quantity: "1", unitCost: "12", locationId: anotherLocationId }, "locationId"],
  ])("indica el campo inválido en el stock inicial (%j)", (line, field) => {
    const result = catalogSheetSchema.safeParse({ ...base, initialStock: [line] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual(["initialStock", 0, field]);
    }
  });

  it("requiere elegir ubicación si hay varias vendibles", () => {
    const schema = createCatalogSheetSchema([locationId, anotherLocationId]);
    const line = { quantity: "1", unitCost: "0.00", confirmZeroCost: true };
    expect(schema.safeParse({ ...base, initialStock: [line] }).success).toBe(false);
    expect(schema.safeParse({ ...base, initialStock: [{ ...line, locationId }] }).success).toBe(true);
  });
});

describe("esquema de ingreso de stock", () => {
  const input = {
    productId: "90000000-0000-0000-0000-000000000009",
    branchId: "40000000-0000-0000-0000-000000000004",
    locationId,
    variantId: null,
    quantity: "2",
    unitCost: "15.25",
    reason: "  Recepción del proveedor  ",
    operationKey: "cat-stock-intake-test",
  };

  it("convierte los valores para el movimiento sin enviar la confirmación", () => {
    const data = stockIntakeSchema.parse({ ...input, unitCost: "0.00", confirmZeroCost: true });
    expect(buildStockIntakePayload(data)).toEqual({
      document_kind: "adjustment",
      target_branch_id: input.branchId,
      operation_key: input.operationKey,
      operation_reason: "Recepción del proveedor",
      lines: [{
        product_id: input.productId,
        variant_id: null,
        quantity: 2,
        unit_cost: 0,
        from_location_id: null,
        to_location_id: locationId,
      }],
    });
  });

  it.each([
    { quantity: "" }, { quantity: "1.5" }, { quantity: "0" }, { quantity: "Infinity" },
    { unitCost: "" }, { unitCost: "-1" }, { unitCost: "Infinity" }, { unitCost: "0", confirmZeroCost: false },
    { reason: "  " }, { operationKey: "" },
  ])("rechaza un ingreso inválido (%j)", (patch) => {
    expect(stockIntakeSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
});
