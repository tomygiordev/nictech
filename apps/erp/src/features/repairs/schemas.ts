import { z } from "zod";

export const repairNoteSchema = z.object({
  content: z.string().trim().min(1, "Escribí una nota.").max(4000, "La nota no puede superar 4000 caracteres."),
  isPublic: z.boolean(),
});
export type RepairNoteInput = z.infer<typeof repairNoteSchema>;
