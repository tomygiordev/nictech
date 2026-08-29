import { z } from "zod";

const erpContextSchema = z.object({
  organization_id: z.string().uuid(),
  user_id: z.string().uuid(),
});

export const parseErpContext = (value: unknown) => {
  const result = erpContextSchema.safeParse(value);
  if (!result.success) throw new Error("Contexto ERP inválido");
  return result.data;
};
