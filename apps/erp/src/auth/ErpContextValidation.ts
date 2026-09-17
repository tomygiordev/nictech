import { z } from "zod";

const erpContextSchema = z.object({
  organization_id: z.string().uuid(),
  user_id: z.string().uuid(),
  permissions: z.array(z.string().trim().min(1)),
  branch_ids: z.array(z.string().uuid()),
}).strict();

export const parseErpContext = (value: unknown) => {
  const result = erpContextSchema.safeParse(value);
  if (!result.success) throw new Error("Contexto ERP inválido");
  return result.data;
};
