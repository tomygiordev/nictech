import { z } from "zod";
import { toDateTimeInputAR } from "../../lib/dates";

export const PROMOTION_KINDS = ["porcentaje", "precio_fijo"] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

export const PROMOTION_CHANNELS = ["web", "pos"] as const;
export type PromotionChannel = (typeof PROMOTION_CHANNELS)[number];

export interface PromotionTargetInput {
  product_id: string;
  variant_id?: string | null;
}

export interface PromotionRow {
  id: string;
  name: string;
  kind: PromotionKind;
  value: number;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  channels: PromotionChannel[];
  created_at: string;
  updated_at: string;
}

export interface PromotionTargetRow {
  promotion_id: string;
  product_id: string;
  variant_id: string | null;
  is_active: boolean;
}

export interface PromotionWithTargets extends PromotionRow {
  targets: PromotionTargetRow[];
}

export interface CatalogVariantOption {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export interface CatalogProductOption {
  id: string;
  internal_code: string;
  internal_name: string;
  base_sale_price: number | null;
  is_active: boolean;
  product_variants: CatalogVariantOption[];
}

export interface UpsertPromotionParams {
  p_id: string | null;
  p_name: string;
  p_kind: PromotionKind;
  p_value: number;
  p_starts_at: string;
  p_ends_at: string | null;
  p_is_active: boolean;
  p_channels: PromotionChannel[];
  p_targets: PromotionTargetInput[];
}

export const promotionTargetSchema = z.object({
  product_id: z.string().uuid("El producto seleccionado no es válido."),
  variant_id: z.string().uuid("La variante seleccionada no es válida.").nullable().optional(),
});

export const promotionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Indicá el nombre de la promoción.")
    .max(120, "El nombre no puede superar los 120 caracteres."),
  kind: z.enum(PROMOTION_KINDS, {
    message: "Elegí un tipo de promoción válido.",
  }),
  value: z.coerce
    .number({ invalid_type_error: "Indicá un valor numérico válido." })
    .finite("Indicá un valor numérico válido.")
    .positive("El valor debe ser mayor a cero.")
    .refine(
      (val) => Math.abs(val * 100 - Math.round(val * 100)) < 1e-6,
      "El valor admite como máximo 2 decimales.",
    ),
  startsAt: z
    .string()
    .trim()
    .min(1, "Indicá la fecha y hora de inicio.")
    .refine(
      (val) => !Number.isNaN(new Date(val).getTime()),
      "La fecha de inicio no es válida.",
    ),
  endsAt: z
    .string()
    .trim()
    .optional()
    .default("")
    .refine(
      (val) => val === "" || !Number.isNaN(new Date(val).getTime()),
      "La fecha de fin no es válida.",
    ),
  isActive: z.boolean(),
  channels: z
    .array(z.enum(PROMOTION_CHANNELS))
    .min(1, "Seleccioná al menos un canal (Web o POS)."),
  targets: z
    .array(promotionTargetSchema)
    .min(1, "Agregá al menos un producto o variante."),
}).superRefine((values, context) => {
  if (values.kind === "porcentaje" && values.value >= 100) {
    context.addIssue({
      code: "custom",
      path: ["value"],
      message: "El porcentaje debe ser menor a 100.",
    });
  }
  if (values.endsAt) {
    const startMs = new Date(values.startsAt).getTime();
    const endMs = new Date(values.endsAt).getTime();
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs <= startMs) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "La fecha de fin debe ser posterior al inicio.",
      });
    }
  }
});

export type PromotionFormValues = z.input<typeof promotionSchema>;
export type PromotionParsedValues = z.output<typeof promotionSchema>;

export const toLocalDateTimeInput = (isoDate?: string | null): string => {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return toDateTimeInputAR(date);
};

export const currentLocalDateTimeInput = (): string => toDateTimeInputAR();

export const localDateTimeToIso = (localValue: string): string => {
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) {
    throw new Error("La fecha indicada no es válida.");
  }
  return date.toISOString();
};

export const buildTargetKey = (productId: string, variantId?: string | null): string =>
  `${productId}:${variantId ?? ""}`;

export const buildUpsertPromotionPayload = (
  values: PromotionParsedValues,
  id: string | null = null,
): UpsertPromotionParams => {
  const uniqueChannels = Array.from(new Set(values.channels));
  const seenTargets = new Set<string>();
  const uniqueTargets: PromotionTargetInput[] = [];

  for (const target of values.targets) {
    const key = buildTargetKey(target.product_id, target.variant_id);
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    uniqueTargets.push({
      product_id: target.product_id,
      variant_id: target.variant_id ?? null,
    });
  }

  return {
    p_id: id,
    p_name: values.name.trim(),
    p_kind: values.kind,
    p_value: Math.round(values.value * 100) / 100,
    p_starts_at: localDateTimeToIso(values.startsAt),
    p_ends_at: values.endsAt ? localDateTimeToIso(values.endsAt) : null,
    p_is_active: values.isActive,
    p_channels: uniqueChannels,
    p_targets: uniqueTargets,
  };
};
