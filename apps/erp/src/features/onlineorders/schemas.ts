import { z } from "zod";

export const onlineOrderReasonSchema = z.object({
  reason: z.string().trim().min(3, "Ingresá un motivo de al menos 3 caracteres.").max(500),
});

export const onlineOrderDispatchSchema = onlineOrderReasonSchema.extend({
  paymentReference: z.string().trim().min(1, "La referencia de pago es obligatoria.").max(200),
});

export const onlineOrderRefundSchema = onlineOrderReasonSchema.extend({
  physicalReturnConfirmed: z.boolean().refine((value) => value, {
    message: "Confirmá que la devolución física fue recibida.",
  }),
});

export type OnlineOrderReasonInput = z.infer<typeof onlineOrderReasonSchema>;
export type OnlineOrderDispatchInput = z.infer<typeof onlineOrderDispatchSchema>;
export type OnlineOrderRefundInput = z.infer<typeof onlineOrderRefundSchema>;
