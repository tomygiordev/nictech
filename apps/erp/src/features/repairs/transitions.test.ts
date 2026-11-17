import { describe, expect, it } from "vitest";
import { isManualRepairTransition } from "./transitions";

describe("transiciones manuales de reparaciones", () => {
  it("excluye Entregado: lo registra la entrega formal", () => {
    expect(isManualRepairTransition("delivered")).toBe(false);
  });

  it("permite los demás estados, incluso la espera de repuestos", () => {
    for (const code of ["received", "diagnosis", "waiting_parts", "repair", "ready"]) {
      expect(isManualRepairTransition(code)).toBe(true);
    }
  });
});
