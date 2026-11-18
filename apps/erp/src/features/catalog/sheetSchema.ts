import { z } from "zod";
import type { MasterLocation } from "./schemas";

const moneyPattern = /^\d+(?:\.\d{1,2})?$/;
const money = (label: string, positive = false) => z.string().trim().refine((value) => {
  if (!value) return false;
  const n = Number(value);
  return Number.isFinite(n) && (positive ? n > 0 : n >= 0) && moneyPattern.test(value);
}, `${label} debe ser ${positive ? "mayor a cero" : "cero o mayor"} y tener hasta dos decimales.`);

const stockFields = z.object({
  quantity: z.string().trim().min(1, "Ingresá la cantidad.").refine(
    (value) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 1,
    "Ingresá una cantidad entera mayor a cero.",
  ),
  locationId: z.string().uuid("Elegí una ubicación."),
  unitCost: z.string().trim().min(1, "Ingresá el costo unitario.").pipe(money("El costo unitario")),
  confirmZeroCost: z.boolean().optional(),
});

export const isZeroStockCost = (value = "") => moneyPattern.test(value.trim()) && Number(value) === 0;
export const getSellableLocations = (locations: MasterLocation[]) =>
  locations.filter((location) => location.is_active && location.allows_sale);

function requireZeroCostConfirmation(
  value: Pick<z.infer<typeof stockFields>, "unitCost" | "confirmZeroCost">,
  ctx: z.RefinementCtx,
) {
  if (isZeroStockCost(value.unitCost) && !value.confirmZeroCost) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmZeroCost"],
      message: "Confirmá que el costo es cero.",
    });
  }
}

const stockEntrySchema = stockFields.superRefine(requireZeroCostConfirmation);
const initialStockDraft = z.object({
  quantity: z.string().optional(),
  locationId: z.string().optional(),
  unitCost: z.string().optional(),
  confirmZeroCost: z.boolean().optional(),
});

export const stockIntakeSchema = stockFields.extend({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid(),
  reason: z.string().trim()
    .min(3, "Ingresá un motivo de al menos 3 caracteres.")
    .max(240, "El motivo no puede superar los 240 caracteres."),
  operationKey: z.string().min(1),
}).superRefine(requireZeroCostConfirmation).transform((value) => ({
  ...value,
  quantity: Number(value.quantity),
  unitCost: Number(value.unitCost),
}));

export type StockIntakeInput = z.infer<typeof stockIntakeSchema>;
export const hasInitialStockEntry = (line?: z.infer<typeof initialStockDraft>) =>
  Boolean(line?.quantity?.trim() || line?.locationId || line?.unitCost?.trim());

export const createCatalogSheetSchema = (sellableLocationIds: string[] = []) => z.object({
  isNew: z.boolean(),
  template: z.enum(["celular", "accesorio", "funda"]),
  name: z.string().trim().min(1, "Ingresá el nombre.").transform((value) => value.replace(/\s+/g, " ")),
  category: z.union([z.literal(""), z.string().uuid("Elegí una categoría.")]),
  brand: z.union([z.literal(""), z.string().uuid("Elegí una marca, o Genérico.")]),
  model: z.string(),
  cost: z.string(),
  price: money("El precio"),
  description: z.string(),
  internalDescription: z.string().optional(),
  initialStock: z.array(initialStockDraft.optional()).optional(),
  publicName: z.string(),
  tags: z.string(),
  capacity: z.string(),
  condition: z.enum(["", "nuevo", "usado", "reacondicionado"]),
}).superRefine((value, ctx) => {
  value.initialStock?.forEach((line, index) => {
    if (!line || !hasInitialStockEntry(line)) return;
    const result = stockEntrySchema.safeParse({
      quantity: line.quantity ?? "",
      locationId: line.locationId || (sellableLocationIds.length === 1 ? sellableLocationIds[0] : ""),
      unitCost: line.unitCost ?? "",
      confirmZeroCost: line.confirmZeroCost,
    });
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ ...issue, path: ["initialStock", index, ...issue.path] });
      }
    } else if (!sellableLocationIds.includes(result.data.locationId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["initialStock", index, "locationId"],
        message: "Elegí una ubicación habilitada para venta.",
      });
    }
  });
  if ((value.isNew || value.cost.trim()) && !money("El costo", true).safeParse(value.cost).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cost"], message: "Ingresá un costo mayor a cero con hasta dos decimales." });
  }
  if (value.isNew && !value.brand) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["brand"], message: "Elegí una marca, o Genérico." });
  if (value.isNew && !value.category) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["category"], message: "Elegí una categoría." });
  if (value.isNew && value.template === "celular" && !z.string().uuid().safeParse(value.model).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "Elegí el modelo de la marca." });
  }
});
export type CatalogSheetValues = z.infer<ReturnType<typeof createCatalogSheetSchema>>;
export const suggestCatalogName = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" ").trim().replace(/\s+/g, " ");

export const checklistLabels: Record<string, string> = {
  missing_primary_image: "Falta la foto principal.", invalid_base_price: "El precio debe ser mayor a cero.",
  base_price_precision: "El precio debe tener hasta dos decimales.", missing_category: "Falta la categoría.",
  missing_name: "Falta el nombre.", missing_brand: "Falta la marca.", inactive_product: "El producto está inactivo.",
  no_active_variant: "Necesitás al menos una variante activa.", invalid_variant_price: "El precio de una variante debe ser mayor a cero.",
  variant_price_precision: "El precio de una variante debe tener hasta dos decimales.",
};
