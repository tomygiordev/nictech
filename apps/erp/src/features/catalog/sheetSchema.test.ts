import { describe, expect, it } from "vitest";
import { catalogSheetSchema, suggestCatalogName } from "./sheetSchema";
const base = { isNew: true, template: "accesorio", name: "  Cable   USB ", category: "10000000-0000-4000-8000-000000000001", brand: "20000000-0000-4000-8000-000000000002", model: "", cost: "50", price: "0", description: "", publicName: "", tags: "", capacity: "", condition: "" };
describe("esquema de ficha", () => {
  it.each(["accesorio", "funda"])("valida %s sin modelo único", (template) => { expect(catalogSheetSchema.safeParse({ ...base, template }).success).toBe(true); });
  it("requiere modelo de celular, marca, categoría y costo al crear", () => { expect(catalogSheetSchema.safeParse({ ...base, template: "celular" }).success).toBe(false); expect(catalogSheetSchema.safeParse({ ...base, brand: "", cost: "" }).success).toBe(false); });
  it("acepta edición legacy incompleta y precio con hasta dos decimales", () => { expect(catalogSheetSchema.safeParse({ ...base, isNew: false, brand: "", category: "", cost: "" }).success).toBe(true); expect(catalogSheetSchema.safeParse({ ...base, price: "1.001" }).success).toBe(false); });
  it("normaliza espacios del nombre sugerido", () => { expect(suggestCatalogName("Funda", "  Genérico  ", " iPhone 13 ")).toBe("Funda Genérico iPhone 13"); });
});
