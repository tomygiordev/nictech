import { describe, expect, it } from "vitest";
import { buildCsv, escapeCsvCell, neutralizeCsvFormula } from "./csv";

describe("CSV export security", () => {
  it.each([
    "=HYPERLINK(\"https://attacker.invalid\")",
    "+SUM(1,1)",
    "-2+3",
    "@SUM(1,1)",
    "   =cmd|' /C calc'!A0",
    "\t+SUM(1,1)",
  ])("neutralizes formula-like text: %s", (value) => {
    expect(neutralizeCsvFormula(value)).toBe(`'${value}`);
  });

  it("does not change ordinary text or genuine numeric values", () => {
    expect(neutralizeCsvFormula("Cliente normal")).toBe("Cliente normal");
    expect(neutralizeCsvFormula(-1250)).toBe("-1250");
  });

  it("neutralizes formulas before applying RFC-style CSV quoting", () => {
    expect(escapeCsvCell(' =SUM(1,2)')).toBe('"\' =SUM(1,2)"');
    expect(buildCsv(["Detalle"], [['@IMPORTXML("https://attacker.invalid")']])).toBe(
      'Detalle\n"\'@IMPORTXML(""https://attacker.invalid"")"',
    );
  });
});
