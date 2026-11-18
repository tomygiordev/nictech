export const AR_TIME_ZONE = "America/Argentina/Buenos_Aires";

const arDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: AR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const arDateTimeInput = new Intl.DateTimeFormat("sv-SE", {
  timeZone: AR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function todayIsoAR(now: Date = new Date()): string {
  return toIsoDateAR(now);
}

export function toIsoDateAR(d: Date): string {
  return arDate.format(d);
}

export function addDaysIsoAR(iso: string, days: number): string {
  if (!ISO_DATE.test(iso) || !Number.isInteger(days)) {
    throw new RangeError("Ingresá una fecha ISO y una cantidad entera de días.");
  }

  // UTC is only an anchor for calendar arithmetic, not the date's time zone.
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new RangeError("La fecha no es válida.");
  }

  date.setUTCDate(date.getUTCDate() + days);
  const [result] = date.toISOString().split("T");
  if (!ISO_DATE.test(result)) throw new RangeError("La fecha queda fuera del rango ISO de cuatro dígitos.");
  return result;
}

export function addMonthsIsoAR(iso: string, months: number): string {
  if (!ISO_DATE.test(iso) || !Number.isInteger(months)) {
    throw new RangeError("Ingresá una fecha ISO y una cantidad entera de meses.");
  }

  const anchor = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(anchor.getTime()) || anchor.toISOString().slice(0, 10) !== iso) {
    throw new RangeError("La fecha no es válida.");
  }

  const totalMonths = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  if (targetYear < 0 || targetYear > 9999) {
    throw new RangeError("La fecha queda fuera del rango ISO de cuatro dígitos.");
  }

  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(anchor.getUTCDate(), lastDay);

  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export function toDateTimeInputAR(d: Date = new Date()): string {
  if (!Number.isFinite(d.getTime())) {
    throw new RangeError("La fecha no es válida.");
  }
  const parts = arDateTimeInput.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
