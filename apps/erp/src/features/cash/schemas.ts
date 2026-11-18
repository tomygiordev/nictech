import { z } from "zod";

const requiredCashAmount = (requiredMessage: string) => z.preprocess(
  (value) => typeof value === "string" ? (value.trim() ? Number(value) : undefined) : value,
  z.number({
    required_error: requiredMessage,
    invalid_type_error: "Ingresá un importe válido.",
  }).finite("Ingresá un importe válido.").nonnegative("Ingresá un importe igual o mayor que cero."),
);

export const openCashSchema = z.object({
  cashRegisterId: z.string().uuid("Elegí una caja registradora."),
  operationKey: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(500, "Las observaciones pueden tener hasta 500 caracteres."),
  currency: z.string().trim().length(3),
  amount: requiredCashAmount("Ingresá el fondo inicial."),
});

export const cashCountSchema = z.object({
  amount: requiredCashAmount("Ingresá el efectivo contado."),
});

export const cashCloseReasonSchema = (difference: number) => z.object({
  reason: z.string().trim().min(
    difference === 0 ? 0 : 5,
    "Ingresá un motivo de al menos 5 caracteres para explicar la diferencia.",
  ),
});

export const manualCashMovementSchema = z.object({
  cashSessionId: z.string().uuid(),
  kind: z.enum(["contribution", "withdrawal", "expense"]),
  currencyCode: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  amount: z.coerce.number().finite()
    .min(0.01, "Ingresá un importe de al menos 0,01.")
    .refine((amount) => amount === Number(amount.toFixed(2)), "Ingresá un importe con hasta dos decimales."),
  operationKey: z.string().trim().min(1).max(120),
  reason: z.string().trim()
    .min(3, "Ingresá un motivo de al menos 3 caracteres.")
    .max(500, "El motivo puede tener hasta 500 caracteres."),
});

export const reverseManualCashMovementSchema = z.object({
  cashMovementId: z.string().uuid(),
  operationKey: z.string().trim().min(1).max(120),
  reason: z.string().trim()
    .min(3, "Ingresá un motivo de al menos 3 caracteres para la reversa.")
    .max(500, "El motivo puede tener hasta 500 caracteres."),
});

export type OpenCashFormInput = z.infer<typeof openCashSchema>;
export type ManualCashMovementInput = z.infer<typeof manualCashMovementSchema>;
export type ReverseManualCashMovementInput = z.infer<typeof reverseManualCashMovementSchema>;
