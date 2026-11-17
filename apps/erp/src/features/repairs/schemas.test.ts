import { describe, expect, it } from "vitest";
import { repairNoteSchema } from "./schemas";
describe("nota de reparación", () => {
  it("recorta y valida la visibilidad", () => {
    expect(repairNoteSchema.parse({ content: "  Listo  ", isPublic: true })).toEqual({ content: "Listo", isPublic: true });
  });
  it("rechaza notas vacías, extensas o sin visibilidad", () => {
    expect(repairNoteSchema.safeParse({ content: " ", isPublic: false }).success).toBe(false);
    expect(repairNoteSchema.safeParse({ content: "x".repeat(4001), isPublic: true }).success).toBe(false);
    expect(repairNoteSchema.safeParse({ content: "hola" }).success).toBe(false);
  });
});
