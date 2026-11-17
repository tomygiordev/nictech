import { z } from "zod";
import { ERP_MODULES } from "@nictech/domain";
const moduleIds: readonly string[] = ERP_MODULES.map((module) => module.id);
export const navigationSchema = z.object({
  profile: z.enum(["salida", "completo"]),
  visible: z.array(z.string().refine((id) => moduleIds.includes(id))).optional(),
});
export type NavigationForm = z.infer<typeof navigationSchema>;
