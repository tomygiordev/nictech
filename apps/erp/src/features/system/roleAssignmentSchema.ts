import { z } from "zod";
export const roleAssignmentSchema = z.object({ profileId: z.string().uuid(), roleId: z.string().uuid() });
export type RoleAssignmentValues = z.infer<typeof roleAssignmentSchema>;
