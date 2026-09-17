import { z } from "zod";

export const openCashSchema = z.object({
  cashRegisterId: z.string().uuid(),
  operationKey: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(500),
  currency: z.string().trim().length(3),
  amount: z.coerce.number().finite().nonnegative(),
});

export const manualCashMovementSchema = z.object({
  cashSessionId: z.string().uuid(),
  kind: z.enum(["contribution", "withdrawal", "expense"]),
  currencyCode: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  amount: z.coerce.number().finite().positive(),
  operationKey: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(3).max(500),
});

export const reverseManualCashMovementSchema = z.object({
  cashMovementId: z.string().uuid(),
  operationKey: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(3).max(500),
});

export type OpenCashFormInput = z.infer<typeof openCashSchema>;
export type ManualCashMovementInput = z.infer<typeof manualCashMovementSchema>;
export type ReverseManualCashMovementInput = z.infer<typeof reverseManualCashMovementSchema>;
