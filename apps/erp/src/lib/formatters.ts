/**
 * NicTech ERP - Common Data Formatters & Utilities
 */

export function formatCurrency(amount: number | null | undefined, currency: "ARS" | "USD" = "ARS"): string {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return "—";
  }

  if (currency === "USD") {
    return `USD ${Math.round(amount).toLocaleString("es-AR")}`;
  }

  return `$${Math.round(amount).toLocaleString("es-AR")}`;
}

export function formatCurrencyCompact(amount: number | null | undefined, currency: "ARS" | "USD" = "ARS"): string {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return "—";
  }

  if (amount >= 1_000_000) {
    const millions = (amount / 1_000_000).toFixed(2);
    return currency === "USD" ? `USD ${millions}M` : `$${millions}M`;
  }

  if (amount >= 1_000) {
    const thousands = (amount / 1_000).toFixed(0);
    return currency === "USD" ? `USD ${thousands}k` : `$${thousands}k`;
  }

  return formatCurrency(amount, currency);
}

export function formatDate(dateInput: string | number | Date | null | undefined): string {
  if (!dateInput) return "—";
  try {
    if (typeof dateInput === "string") {
      const match = dateInput.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match && !dateInput.includes("T") && !dateInput.includes(" ")) {
        const [, y, m, d] = match;
        return `${d}/${m}/${y}`;
      }
    }
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    return d.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return String(dateInput);
  }
}

export function formatDateTime(dateInput: string | number | Date | null | undefined): string {
  if (!dateInput) return "—";
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    return d.toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(dateInput);
  }
}

export function generateIdempotencyKey(prefix = "op"): string {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${randomStr}`;
}

export function generateTrackingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let part1 = "";
  let part2 = "";
  for (let i = 0; i < 4; i++) {
    part1 += chars.charAt(Math.floor(Math.random() * chars.length));
    part2 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${part1}-${part2}`;
}

export function getInitials(name: string | null | undefined, fallback = "OP"): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
