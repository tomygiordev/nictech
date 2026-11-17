import { z } from "zod";

const money = (label: string, positive = false) => z.string().trim().refine((value) => {
  if (!value) return false;
  const n = Number(value);
  return Number.isFinite(n) && (positive ? n > 0 : n >= 0) && /^\d+(?:\.\d{1,2})?$/.test(value);
}, `${label} debe ser ${positive ? "mayor a cero" : "cero o mayor"} y tener hasta dos decimales.`);

export const catalogSheetSchema = z.object({
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
  initialStock: z.array(z.object({ quantity: z.string().optional(), locationId: z.string().optional(), unitCost: z.string().optional() })).optional(),
  publicName: z.string(),
  tags: z.string(),
  capacity: z.string(),
  condition: z.enum(["", "nuevo", "usado", "reacondicionado"]),
}).superRefine((value, ctx) => {
  value.initialStock?.forEach((line, index) => {
    if (!line.quantity?.trim()) return;
    if (!/^[1-9]\d*$/.test(line.quantity)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["initialStock", index, "quantity"], message: "Ingresá una cantidad entera mayor a cero." });
    if (!z.string().uuid().safeParse(line.locationId).success) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["initialStock", index, "locationId"], message: "Elegí una ubicación." });
    if (!money("El costo").safeParse(line.unitCost || "0").success) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["initialStock", index, "unitCost"], message: "Ingresá un costo válido." });
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
export type CatalogSheetValues = z.infer<typeof catalogSheetSchema>;
export const suggestCatalogName = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" ").trim().replace(/\s+/g, " ");

export const checklistLabels: Record<string, string> = {
  missing_primary_image: "Falta la foto principal.", invalid_base_price: "El precio debe ser mayor a cero.",
  base_price_precision: "El precio debe tener hasta dos decimales.", missing_category: "Falta la categoría.",
  missing_name: "Falta el nombre.", missing_brand: "Falta la marca.", inactive_product: "El producto está inactivo.",
  no_active_variant: "Necesitás al menos una variante activa.", invalid_variant_price: "El precio de una variante debe ser mayor a cero.",
  variant_price_precision: "El precio de una variante debe tener hasta dos decimales.",
};
