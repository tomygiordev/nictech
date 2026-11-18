import { z } from "zod";

export function isZeroPrice(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== "" && Number(trimmed) === 0;
}

export const quoteLineSchema = z.object({
  kind: z.enum(["product", "service", "free_concept"]),
  productId: z.string(),
  description: z.string().trim(),
  quantity: z.string().trim()
    .min(1, "Ingresá la cantidad.")
    .refine((value) => {
      if (value === "") return true;
      const qty = Number(value);
      return Number.isFinite(qty) && qty > 0;
    }, "Ingresá una cantidad mayor a cero."),
  unitPrice: z.string().trim()
    .min(1, "Ingresá el precio unitario.")
    .refine((value) => {
      if (value === "") return true;
      const price = Number(value);
      return Number.isFinite(price) && price >= 0;
    }, "Ingresá un precio igual o mayor a cero."),
  unitCost: z.string().trim()
    .refine((value) => {
      if (value === "") return true;
      const cost = Number(value);
      return Number.isFinite(cost) && cost >= 0;
    }, "Ingresá un costo igual o mayor a cero."),
  confirmZeroPrice: z.boolean(),
}).superRefine((line, context) => {
  if (line.kind === "product" || line.kind === "service") {
    if (!z.string().uuid().safeParse(line.productId).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productId"],
        message: line.kind === "service" ? "Elegí un servicio catalogado." : "Elegí un repuesto catalogado.",
      });
    }
  } else if (!line.description) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["description"],
      message: "Ingresá la descripción del concepto.",
    });
  }

  if (isZeroPrice(line.unitPrice) && !line.confirmZeroPrice) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmZeroPrice"],
      message: "Confirmá el precio de $0.",
    });
  }
});

export const createQuoteSchema = z.object({
  repairOrderId: z.string().uuid("Elegí una orden de reparación."),
  currencyCode: z.enum(["ARS", "USD"], { message: "Elegí la moneda del presupuesto." }),
  reason: z.string().trim()
    .min(5, "Indicá un motivo de al menos 5 caracteres.")
    .max(240, "El motivo no puede superar los 240 caracteres."),
  lines: z.array(quoteLineSchema).min(1, "Agregá al menos una línea al presupuesto."),
});

export const quoteDecisionSchema = z.object({
  decision: z.string().pipe(
    z.enum(["approved", "rejected"], {
      message: "Elegí si el cliente aprobó o rechazó el presupuesto.",
    }),
  ),
  notes: z.string().trim().max(1000, "Las notas no pueden superar los 1000 caracteres."),
});

export type QuoteLineFormValues = z.infer<typeof quoteLineSchema>;
export type CreateQuoteFormValues = z.infer<typeof createQuoteSchema>;
export type QuoteDecisionFormInput = z.input<typeof quoteDecisionSchema>;
export type QuoteDecisionFormValues = z.output<typeof quoteDecisionSchema>;

export const emptyQuoteLine = (): QuoteLineFormValues => ({
  kind: "free_concept",
  productId: "",
  description: "",
  quantity: "",
  unitPrice: "",
  unitCost: "",
  confirmZeroPrice: false,
});

export const emptyCreateQuote = (): CreateQuoteFormValues => ({
  repairOrderId: "",
  currencyCode: "ARS",
  reason: "",
  lines: [emptyQuoteLine()],
});

export const emptyQuoteDecision = (): QuoteDecisionFormInput => ({
  decision: "",
  notes: "",
});
