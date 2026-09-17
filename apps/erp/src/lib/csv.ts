export type CsvCell = string | number;

const CSV_FORMULA_PREFIXES = new Set(["=", "+", "-", "@"]);

const firstVisibleCharacter = (value: string): string => {
  let index = 0;
  while (index < value.length && value.charCodeAt(index) <= 32) index += 1;
  return value[index] || "";
};

/**
 * Forces spreadsheet applications to interpret attacker-controlled formulas as text.
 * Leading control characters and spaces are included because some spreadsheet
 * applications ignore them before evaluating the first formula character.
 */
export const neutralizeCsvFormula = (value: CsvCell): string => {
  const text = String(value);
  if (typeof value === "string" && CSV_FORMULA_PREFIXES.has(firstVisibleCharacter(text))) {
    return `'${text}`;
  }
  return text;
};

export const escapeCsvCell = (value: CsvCell): string => {
  const text = neutralizeCsvFormula(value);
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const buildCsv = (headers: string[], rows: CsvCell[][]): string =>
  [headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");

export const downloadCsvFile = (filename: string, headers: string[], rows: CsvCell[][]): void => {
  const blob = new Blob(["\uFEFF" + buildCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};
