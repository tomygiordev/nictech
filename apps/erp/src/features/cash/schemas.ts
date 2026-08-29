import { z } from "zod";

export const openCashSchema = z.object({
  cashRegisterId: z.string().uuid(),
  operationKey: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(500),
  currency: z.string().trim().length(3),
  amount: z.coerce.number().finite().nonnegative(),
});

export type OpenCashFormInput = z.infer<typeof openCashSchema>;
