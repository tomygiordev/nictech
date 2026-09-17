export interface CheckoutCartItem {
  id: string;
  variant_id?: string | null;
  quantity: number;
  image_url?: string;
}

export interface AggregatedCartItem {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  image_url?: string;
}

export interface ProductRecord {
  id: string;
  name: string;
  price: number;
  stock: number;
  image_url: string | null;
}

export interface VariantRecord {
  id: string;
  product_id: string | null;
  color: string;
  stock: number;
  image_url: string | null;
}

export interface ValidatedCheckoutItem {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price: number;
  title: string;
  image_url: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${fieldName} inválido`);
  }
}

export function aggregateCartItems(items: unknown): AggregatedCartItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("No se recibieron productos");
  }

  if (items.length > 50) {
    throw new Error("El carrito supera el máximo de productos");
  }

  const aggregated = new Map<string, AggregatedCartItem>();

  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== "object") {
      throw new Error("Producto inválido");
    }

    const item = rawItem as Record<string, unknown>;
    assertUuid(item.id, "Producto");

    const variantId = item.variant_id ?? null;
    if (variantId !== null) {
      assertUuid(variantId, "Variante");
    }

    if (
      typeof item.quantity !== "number" ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 999
    ) {
      throw new Error("Cantidad inválida");
    }

    const key = `${item.id}:${variantId ?? "base"}`;
    const previous = aggregated.get(key);
    const quantity = (previous?.quantity ?? 0) + item.quantity;
    if (quantity > 999) {
      throw new Error("Cantidad acumulada inválida");
    }

    aggregated.set(key, {
      product_id: item.id,
      variant_id: variantId,
      quantity,
      image_url: typeof item.image_url === "string" ? item.image_url : previous?.image_url,
    });
  }

  return [...aggregated.values()];
}

export function validateCatalogItems(
  requestedItems: AggregatedCartItem[],
  products: ProductRecord[],
  variants: VariantRecord[],
): ValidatedCheckoutItem[] {
  const productById = new Map(products.map((product) => [product.id, product]));
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));

  return requestedItems.map((item) => {
    const product = productById.get(item.product_id);
    if (!product) {
      throw new Error("Uno de los productos ya no está disponible");
    }

    const variant = item.variant_id ? variantById.get(item.variant_id) : null;
    if (item.variant_id && (!variant || variant.product_id !== product.id)) {
      throw new Error(`La variante seleccionada de ${product.name} ya no está disponible`);
    }

    const availableStock = variant?.stock ?? product.stock;
    if (item.quantity > availableStock) {
      const label = variant ? `${product.name} (${variant.color})` : product.name;
      throw new Error(`Stock insuficiente para ${label}. Quedan ${availableStock}`);
    }

    return {
      product_id: product.id,
      variant_id: variant?.id ?? null,
      quantity: item.quantity,
      unit_price: product.price,
      title: variant ? `${product.name} - ${variant.color}` : product.name,
      image_url: variant?.image_url ?? product.image_url ?? item.image_url ?? null,
    };
  });
}

export function encodeMercadoPagoItemId(productId: string, variantId: string | null): string {
  return variantId ? `${productId}.${variantId}` : productId;
}
