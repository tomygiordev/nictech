import { describe, expect, it, vi } from "vitest";
import { addDaysIsoAR, addMonthsIsoAR, toDateTimeInputAR, todayIsoAR, toIsoDateAR } from "./dates";

describe("fechas de Argentina", () => {
  it("toma el día de Buenos Aires, no el día UTC", () => {
    expect(todayIsoAR(new Date("2026-11-19T01:30:00Z"))).toBe("2026-11-18");
    expect(toIsoDateAR(new Date("2026-11-19T03:00:00Z"))).toBe("2026-11-19");
  });

  it("usa el reloj actual si no se pasa una fecha", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-19T01:30:00Z"));
      expect(todayIsoAR()).toBe("2026-11-18");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["2026-11-18", 0, "2026-11-18"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2024-03-01", -1, "2024-02-29"],
    ["2008-10-18", 1, "2008-10-19"],
  ])("suma días civiles a %s (%i)", (iso, days, expected) => {
    expect(addDaysIsoAR(iso, days)).toBe(expected);
  });

  it("rechaza fechas inválidas, instantes y días fraccionarios", () => {
    expect(() => addDaysIsoAR("2026-02-29", 1)).toThrow(RangeError);
    expect(() => addDaysIsoAR("2026-11-19T01:30:00Z", 1)).toThrow(RangeError);
    expect(() => addDaysIsoAR("2026-11-19", 0.5)).toThrow(RangeError);
  });

  it.each([
    ["2026-10-01", -5, "2026-05-01"],
    ["2026-02-01", -5, "2025-09-01"],
    ["2026-01-31", 1, "2026-02-28"],
    ["2024-01-31", 1, "2024-02-29"],
  ])("suma meses civiles a %s (%i)", (iso, months, expected) => {
    expect(addMonthsIsoAR(iso, months)).toBe(expected);
  });

  it("rechaza meses inválidos o fechas fuera de formato", () => {
    expect(() => addMonthsIsoAR("2026-02-29", 1)).toThrow(RangeError);
    expect(() => addMonthsIsoAR("2026-10-01", 1.5)).toThrow(RangeError);
  });

  it("formatea fecha y hora para datetime-local en Buenos Aires", () => {
    expect(toDateTimeInputAR(new Date("2026-11-19T01:30:00Z"))).toBe("2026-11-18T22:30");
    expect(toDateTimeInputAR(new Date("2026-11-19T03:00:00Z"))).toBe("2026-11-19T00:00");
    expect(() => toDateTimeInputAR(new Date("invalid"))).toThrow(RangeError);
  });
});
