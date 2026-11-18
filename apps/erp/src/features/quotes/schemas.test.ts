import { describe, expect, it } from "vitest";
import {
  createQuoteSchema,
  emptyCreateQuote,
  emptyQuoteDecision,
  emptyQuoteLine,
  isZeroPrice,
  quoteDecisionSchema,
  quoteLineSchema,
} from "./schemas";

const VALID_ORDER_ID = "550e8400-e29b-41d4-a716-446655440001";
const VALID_PRODUCT_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("isZeroPrice", () => {
  it("distingue cero explícito de vacío o espacios", () => {
    expect(isZeroPrice("")).toBe(false);
    expect(isZeroPrice("   ")).toBe(false);
    expect(isZeroPrice("0")).toBe(true);
    expect(isZeroPrice(" 0.00 ")).toBe(true);
    expect(isZeroPrice("1500")).toBe(false);
  });
});

describe("quoteLineSchema", () => {
  it("rechaza una línea vacía sin defaults inventados", () => {
    const result = quoteLineSchema.safeParse(emptyQuoteLine());
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0])).toEqual([
      "quantity",
      "unitPrice",
      "description",
    ]);
  });

  it("exige confirmación explícita cuando el precio es cero", () => {
    const zeroUnconfirmed = {
      ...emptyQuoteLine(),
      description: "Revisión en garantía",
      quantity: "1",
      unitPrice: "0",
      confirmZeroPrice: false,
    };
    const resUnconfirmed = quoteLineSchema.safeParse(zeroUnconfirmed);
    expect(resUnconfirmed.success).toBe(false);
    expect(resUnconfirmed.error?.issues[0]).toMatchObject({
      path: ["confirmZeroPrice"],
      message: "Confirmá el precio de $0.",
    });

    const resConfirmed = quoteLineSchema.safeParse({
      ...zeroUnconfirmed,
      confirmZeroPrice: true,
    });
    expect(resConfirmed.success).toBe(true);
  });

  it("exige servicio o repuesto catalogado según el tipo de línea", () => {
    const serviceResult = quoteLineSchema.safeParse({
      ...emptyQuoteLine(),
      kind: "service",
      quantity: "1",
      unitPrice: "5000",
    });
    expect(serviceResult.success).toBe(false);
    expect(serviceResult.error?.issues[0]).toMatchObject({
      path: ["productId"],
      message: "Elegí un servicio catalogado.",
    });

    const productResult = quoteLineSchema.safeParse({
      ...emptyQuoteLine(),
      kind: "product",
      productId: VALID_PRODUCT_ID,
      quantity: "2",
      unitPrice: "12000",
    });
    expect(productResult.success).toBe(true);
  });
});

describe("createQuoteSchema", () => {
  it("inicia vacío y exige orden, motivo de al menos 5 caracteres y al menos una línea válida", () => {
    const empty = emptyCreateQuote();
    expect(empty.repairOrderId).toBe("");
    expect(empty.reason).toBe("");
    expect(empty.lines).toHaveLength(1);

    const res = createQuoteSchema.safeParse(empty);
    expect(res.success).toBe(false);
    const paths = res.error?.issues.map((i) => i.path.join(".")) ?? [];
    expect(paths).toContain("repairOrderId");
    expect(paths).toContain("reason");
    expect(paths).toContain("lines.0.quantity");
    expect(paths).toContain("lines.0.unitPrice");
    expect(paths).toContain("lines.0.description");
  });

  it("acepta un presupuesto válido y recorta motivo y descripción", () => {
    const parsed = createQuoteSchema.parse({
      repairOrderId: VALID_ORDER_ID,
      currencyCode: "USD",
      reason: "  Cambio de módulo de pantalla  ",
      lines: [
        {
          kind: "free_concept",
          productId: "",
          description: "  Mano de obra especializada  ",
          quantity: "1",
          unitPrice: "80",
          unitCost: "20",
          confirmZeroPrice: false,
        },
      ],
    });

    expect(parsed.reason).toBe("Cambio de módulo de pantalla");
    expect(parsed.lines[0].description).toBe("Mano de obra especializada");
  });
});

describe("quoteDecisionSchema", () => {
  it("exige elegir aprobación o rechazo y permite notas opcionales", () => {
    const empty = quoteDecisionSchema.safeParse(emptyQuoteDecision());
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]).toMatchObject({
      path: ["decision"],
      message: "Elegí si el cliente aprobó o rechazó el presupuesto.",
    });

    const valid = quoteDecisionSchema.parse({
      decision: "approved",
      notes: "  Confirmado por WhatsApp  ",
    });
    expect(valid).toEqual({
      decision: "approved",
      notes: "Confirmado por WhatsApp",
    });
  });
});
