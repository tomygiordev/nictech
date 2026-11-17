import { describe, expect, it } from "vitest";
import {
  buildUpsertPromotionPayload,
  localDateTimeToIso,
  promotionSchema,
  toLocalDateTimeInput,
} from "./promotionsSchema";

const PRODUCT_ID = "10000000-0000-4000-8000-000000000001";
const VARIANT_ID = "20000000-0000-4000-8000-000000000002";

const validInput = {
  name: "Hot Sale Fundas",
  kind: "porcentaje" as const,
  value: 15.5,
  startsAt: "2026-11-16T10:00",
  endsAt: "2026-11-20T23:59",
  isActive: true,
  channels: ["web" as const, "pos" as const],
  targets: [{ product_id: PRODUCT_ID, variant_id: VARIANT_ID }],
};

describe("promotionsSchema", () => {
  it("acepta una promoción porcentual válida y arma el payload ISO", () => {
    const parsed = promotionSchema.parse(validInput);
    const payload = buildUpsertPromotionPayload(parsed, null);

    expect(payload).toEqual({
      p_id: null,
      p_name: "Hot Sale Fundas",
      p_kind: "porcentaje",
      p_value: 15.5,
      p_starts_at: localDateTimeToIso("2026-11-16T10:00"),
      p_ends_at: localDateTimeToIso("2026-11-20T23:59"),
      p_is_active: true,
      p_channels: ["web", "pos"],
      p_targets: [{ product_id: PRODUCT_ID, variant_id: VARIANT_ID }],
    });
  });

  it("acepta precio fijo sin fecha de fin y deduplica destinos", () => {
    const parsed = promotionSchema.parse({
      ...validInput,
      kind: "precio_fijo",
      value: 19999.99,
      endsAt: "",
      channels: ["web"],
      targets: [
        { product_id: PRODUCT_ID, variant_id: null },
        { product_id: PRODUCT_ID, variant_id: null },
      ],
    });
    const payload = buildUpsertPromotionPayload(parsed, "30000000-0000-4000-8000-000000000003");

    expect(payload.p_id).toBe("30000000-0000-4000-8000-000000000003");
    expect(payload.p_ends_at).toBeNull();
    expect(payload.p_targets).toEqual([{ product_id: PRODUCT_ID, variant_id: null }]);
  });

  it("rechaza porcentaje igual o mayor a 100", () => {
    const res100 = promotionSchema.safeParse({ ...validInput, kind: "porcentaje", value: 100 });
    expect(res100.success).toBe(false);
    if (!res100.success) {
      expect(res100.error.issues[0]?.message).toBe("El porcentaje debe ser menor a 100.");
    }
  });

  it("rechaza valores no positivos o con más de 2 decimales", () => {
    const resZero = promotionSchema.safeParse({ ...validInput, value: 0 });
    expect(resZero.success).toBe(false);

    const resThreeDecimals = promotionSchema.safeParse({ ...validInput, value: 10.123 });
    expect(resThreeDecimals.success).toBe(false);
    if (!resThreeDecimals.success) {
      expect(resThreeDecimals.error.issues[0]?.message).toBe("El valor admite como máximo 2 decimales.");
    }
  });

  it("rechaza fecha de fin anterior o igual al inicio", () => {
    const res = promotionSchema.safeParse({
      ...validInput,
      startsAt: "2026-11-20T10:00",
      endsAt: "2026-11-19T10:00",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toBe("La fecha de fin debe ser posterior al inicio.");
    }
  });

  it("rechaza promociones sin destinos o sin canales", () => {
    const noTargets = promotionSchema.safeParse({ ...validInput, targets: [] });
    expect(noTargets.success).toBe(false);
    if (!noTargets.success) {
      expect(noTargets.error.issues[0]?.message).toBe("Agregá al menos un producto o variante.");
    }

    const noChannels = promotionSchema.safeParse({ ...validInput, channels: [] });
    expect(noChannels.success).toBe(false);
    if (!noChannels.success) {
      expect(noChannels.error.issues[0]?.message).toBe("Seleccioná al menos un canal (Web o POS).");
    }
  });

  it("convierte fechas ISO a formato datetime-local y viceversa", () => {
    const iso = "2026-11-16T15:30:00.000Z";
    const localValue = toLocalDateTimeInput(iso);
    expect(localValue).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(localDateTimeToIso(localValue)).toBe(new Date(localValue).toISOString());
    expect(toLocalDateTimeInput(null)).toBe("");
  });
});
