import { describe, expect, it } from "vitest";
import {
  buildPcTestResultsPayload,
  completePcBuildSchema,
  createPcBuildSchema,
  createPcBuildTestSchema,
  pcBuildReserveSchema,
  pcBuildRevisionSchema,
  serializePcBuildWarranty,
} from "./schemas";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222222";
const VALID_UUID_3 = "33333333-3333-4333-8333-333333333333";

describe("createPcBuildSchema", () => {
  const validInput = {
    branchId: VALID_UUID,
    customerId: VALID_UUID_2,
    title: "  Rig Gamer 4K  ",
    notes: "  Gabinete ATX  ",
    reason: "  Pedido mostrador  ",
    components: [
      {
        slot_code: "cpu",
        product_id: VALID_UUID_3,
        variant_id: "",
        inventory_unit_id: "",
        quantity: "1",
      },
    ],
  };

  it("acepta un armado válido y recorta espacios", () => {
    const parsed = createPcBuildSchema.parse(validInput);
    expect(parsed).toMatchObject({
      branchId: VALID_UUID,
      customerId: VALID_UUID_2,
      title: "Rig Gamer 4K",
      notes: "Gabinete ATX",
      reason: "Pedido mostrador",
    });
  });

  it("rechaza formulario vacío sin sucursal, cliente, título ni producto", () => {
    const result = createPcBuildSchema.safeParse({
      branchId: "",
      customerId: "",
      title: "",
      notes: "",
      reason: "",
      components: [
        {
          slot_code: "cpu",
          product_id: "",
          variant_id: "",
          inventory_unit_id: "",
          quantity: "1",
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("branchId");
      expect(paths).toContain("customerId");
      expect(paths).toContain("title");
      expect(paths).toContain("components.0.product_id");
    }
  });

  it("rechaza cantidad inválida o menor o igual a cero", () => {
    for (const quantity of ["0", "-2", "abc", ""]) {
      const result = createPcBuildSchema.safeParse({
        ...validInput,
        components: [{ ...validInput.components[0], quantity }],
      });
      expect(result.success).toBe(false);
    }
  });

  it("rechaza lista de componentes vacía o slot desconocido", () => {
    expect(createPcBuildSchema.safeParse({ ...validInput, components: [] }).success).toBe(false);
    expect(
      createPcBuildSchema.safeParse({
        ...validInput,
        components: [{ ...validInput.components[0], slot_code: "invalid_slot" }],
      }).success,
    ).toBe(false);
  });
});

describe("pcBuildRevisionSchema y pcBuildReserveSchema", () => {
  it("acepta revisión con UUIDs opcionales vacíos o válidos", () => {
    expect(
      pcBuildRevisionSchema.safeParse({
        specVersionId: "",
        ruleSetVersionId: VALID_UUID,
        components: [
          {
            slot_code: "ram",
            product_id: VALID_UUID_2,
            variant_id: "",
            inventory_unit_id: "",
            quantity: "2",
          },
        ],
      }).success,
    ).toBe(true);

    expect(
      pcBuildRevisionSchema.safeParse({
        specVersionId: "no-uuid",
        ruleSetVersionId: "",
        components: [
          {
            slot_code: "ram",
            product_id: VALID_UUID_2,
            variant_id: "",
            inventory_unit_id: "",
            quantity: "2",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("valida fecha de vencimiento de reserva", () => {
    expect(pcBuildReserveSchema.safeParse({ expiresAt: "2026-12-01T10:00" }).success).toBe(true);
    expect(pcBuildReserveSchema.safeParse({ expiresAt: "" }).success).toBe(false);
    expect(pcBuildReserveSchema.safeParse({ expiresAt: "no-es-fecha" }).success).toBe(false);
  });
});

describe("createPcBuildTestSchema", () => {
  const requiredKeys = ["post", "memory", "storage", "thermal"] as const;
  const schema = createPcBuildTestSchema(requiredKeys);

  it("exige resultado en todos los ítems obligatorios", () => {
    const partial = schema.safeParse({
      templateVersionId: VALID_UUID,
      notes: "",
      checks: {
        post: "pass",
        memory: "pass",
      },
    });
    expect(partial.success).toBe(false);
    if (!partial.success) {
      expect(partial.error.issues[0]?.message).toContain("Registrá un resultado");
    }
  });

  it("arma el mismo payload esperado por record_pc_test_run cuando todos los ítems tienen resultado", () => {
    const checks = {
      post: "pass" as const,
      memory: "fail" as const,
      storage: "pass" as const,
      thermal: "pass" as const,
    };
    const valid = schema.safeParse({
      templateVersionId: VALID_UUID,
      notes: "  Observación  ",
      checks,
    });
    expect(valid.success).toBe(true);
    expect(buildPcTestResultsPayload(requiredKeys, checks)).toEqual([
      { item_key: "post", result: "pass" },
      { item_key: "memory", result: "fail" },
      { item_key: "storage", result: "pass" },
      { item_key: "thermal", result: "pass" },
    ]);
  });

  it("rechaza plantilla sin controles obligatorios", () => {
    const emptySchema = createPcBuildTestSchema([]);
    expect(
      emptySchema.safeParse({
        templateVersionId: VALID_UUID,
        notes: "",
        checks: {},
      }).success,
    ).toBe(false);
  });
});

describe("completePcBuildSchema", () => {
  it("exige número de serie y días de garantía", () => {
    const emptyResult = completePcBuildSchema.safeParse({
      serial: "",
      warrantyDays: "",
      warrantyConditions: "",
    });
    expect(emptyResult.success).toBe(false);
    if (!emptyResult.success) {
      const paths = emptyResult.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("serial");
      expect(paths).toContain("warrantyDays");
    }
  });

  it("rechaza días de garantía negativos, decimales o fuera de rango", () => {
    for (const warrantyDays of ["-1", "12.5", "3651", "abc", "Infinity"]) {
      const result = completePcBuildSchema.safeParse({
        serial: "NT-PC-0001",
        warrantyDays,
        warrantyConditions: "",
      });
      expect(result.success).toBe(false);
    }
  });

  it("serializa la garantía a un objeto JSON válido con warranty_days y conditions opcional", () => {
    const parsed = completePcBuildSchema.parse({
      serial: " NT-PC-0001 ",
      warrantyDays: "180",
      warrantyConditions: "  Cobertura oficial en taller  ",
    });
    expect(parsed).toEqual({
      serial: "NT-PC-0001",
      warrantyDays: 180,
      warrantyConditions: "Cobertura oficial en taller",
    });
    expect(serializePcBuildWarranty(parsed.warrantyDays, parsed.warrantyConditions)).toEqual({
      warranty_days: 180,
      conditions: "Cobertura oficial en taller",
    });
    expect(serializePcBuildWarranty(90, "")).toEqual({ warranty_days: 90 });
  });
});
