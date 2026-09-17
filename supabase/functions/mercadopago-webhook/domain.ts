export interface WebhookOrderItem {
  product_id: string;
  variant_id: string | null;
  inventory_unit_id: string | null;
  quantity: number;
  unit_price: number;
  title: string;
  tax_rate_percent?: number;
  tax_amount?: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function normalizeOrderItems(value: unknown): WebhookOrderItem[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new Error("La orden no contiene ítems válidos");
  }

  const seen = new Set<string>();
  return value.map((rawItem) => {
    if (!rawItem || typeof rawItem !== "object") {
      throw new Error("Ítem de orden inválido");
    }
    const item = rawItem as Record<string, unknown>;
    if (!isUuid(item.product_id)) throw new Error("Producto de orden inválido");
    if (item.variant_id !== null && item.variant_id !== undefined && !isUuid(item.variant_id)) {
      throw new Error("Variante de orden inválida");
    }
    if (item.inventory_unit_id !== null && item.inventory_unit_id !== undefined && !isUuid(item.inventory_unit_id)) {
      throw new Error("Unidad de inventario inválida");
    }
    if (
      typeof item.quantity !== "number" || !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 || item.quantity > 999
    ) {
      throw new Error("Cantidad de orden inválida");
    }
    if (typeof item.unit_price !== "number" || !Number.isFinite(item.unit_price) || item.unit_price < 0) {
      throw new Error("Precio de orden inválido");
    }
    if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 300) {
      throw new Error("Descripción de orden inválida");
    }

    const variantId = isUuid(item.variant_id) ? item.variant_id : null;
    const key = `${item.product_id}:${variantId ?? "base"}`;
    if (seen.has(key)) throw new Error("La orden contiene líneas duplicadas");
    seen.add(key);

    const normalized: WebhookOrderItem = {
      product_id: item.product_id,
      variant_id: variantId,
      inventory_unit_id: isUuid(item.inventory_unit_id) ? item.inventory_unit_id : null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      title: item.title.trim(),
    };
    if (typeof item.tax_rate_percent === "number") normalized.tax_rate_percent = item.tax_rate_percent;
    if (typeof item.tax_amount === "number") normalized.tax_amount = item.tax_amount;
    return normalized;
  });
}

export function mapPaymentStatus(value: unknown): "approved" | "pending" | "rejected" | "cancelled" | "refunded" {
  if (value === "approved") return "approved";
  if (value === "rejected") return "rejected";
  if (value === "cancelled") return "cancelled";
  if (value === "refunded" || value === "charged_back") return "refunded";
  return "pending";
}
