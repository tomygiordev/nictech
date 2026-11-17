import { describe, expect, it } from "vitest";
import { hasValidDiscount } from "@/lib/pricing";
import {
  indexPromotionPrices,
  resolveDisplayPrice,
  type StorefrontPromotionPrice,
} from "@/lib/promo-pricing";

const futureDate = "2099-12-31T23:59:59.000Z";
const pastDate = "2020-01-01T00:00:00.000Z";

describe("indexPromotionPrices", () => {
  it("indexa filas por product_id:variant_id y usa base cuando variant_id es null", () => {
    const rows: StorefrontPromotionPrice[] = [
      {
        product_id: "prod-1",
        variant_id: null,
        list_price: 100000,
        effective_price: 85000,
        promotion_id: "promo-1",
        promotion_ends_at: futureDate,
      },
      {
        product_id: "prod-1",
        variant_id: "var-1",
        list_price: 120000,
        effective_price: 96000,
        promotion_id: "promo-2",
        promotion_ends_at: null,
      },
    ];

    const index = indexPromotionPrices(rows);

    expect(index.size).toBe(2);
    expect(index.get("prod-1:base")?.effective_price).toBe(85000);
    expect(index.get("prod-1:var-1")?.effective_price).toBe(96000);
  });
});

describe("resolveDisplayPrice", () => {
  it("devuelve legacy sin cambios cuando index es null", () => {
    const resolved = resolveDisplayPrice(
      {
        productId: "prod-1",
        legacyPrice: 90000,
        legacyOriginalPrice: 110000,
        legacySaleExpiresAt: futureDate,
      },
      null,
    );

    expect(resolved).toEqual({
      price: 90000,
      originalPrice: 110000,
      saleExpiresAt: futureDate,
      source: "legacy",
    });
  });

  it("usa la fila ERP cuando tiene promotion_id no null y list_price > effective_price", () => {
    const index = indexPromotionPrices([
      {
        product_id: "prod-1",
        variant_id: null,
        list_price: 150000,
        effective_price: 120000,
        promotion_id: "promo-1",
        promotion_ends_at: futureDate,
      },
    ]);

    const resolved = resolveDisplayPrice(
      {
        productId: "prod-1",
        legacyPrice: 150000,
        legacyOriginalPrice: null,
        legacySaleExpiresAt: null,
      },
      index,
    );

    expect(resolved).toEqual({
      price: 120000,
      originalPrice: 150000,
      saleExpiresAt: futureDate,
      source: "erp",
    });
    expect(hasValidDiscount(resolved)).toBe(true);
  });

  it("deja originalPrice en null si list_price <= effective_price aunque exista promotion_id", () => {
    const index = indexPromotionPrices([
      {
        product_id: "prod-1",
        variant_id: null,
        list_price: 100000,
        effective_price: 100000,
        promotion_id: "promo-edge",
        promotion_ends_at: futureDate,
      },
    ]);

    const resolved = resolveDisplayPrice(
      {
        productId: "prod-1",
        legacyPrice: 100000,
      },
      index,
    );

    expect(resolved).toEqual({
      price: 100000,
      originalPrice: null,
      saleExpiresAt: futureDate,
      source: "erp",
    });
    expect(hasValidDiscount(resolved)).toBe(false);
  });

  it("devuelve legacy intacto cuando la fila ERP tiene promotion_id null (preserva tachado legacy)", () => {
    const index = indexPromotionPrices([
      {
        product_id: "prod-1",
        variant_id: null,
        list_price: 95000,
        effective_price: 95000,
        promotion_id: null,
        promotion_ends_at: null,
      },
    ]);

    const resolved = resolveDisplayPrice(
      {
        productId: "prod-1",
        legacyPrice: 95000,
        legacyOriginalPrice: 120000,
        legacySaleExpiresAt: futureDate,
      },
      index,
    );

    expect(resolved).toEqual({
      price: 95000,
      originalPrice: 120000,
      saleExpiresAt: futureDate,
      source: "legacy",
    });
    expect(hasValidDiscount(resolved)).toBe(true);
  });

  it("prioriza la fila propia de la variante cuando tiene promotion_id", () => {
    const index = indexPromotionPrices([
      {
        product_id: "prod-1",
        variant_id: null,
        list_price: 100000,
        effective_price: 90000,
        promotion_id: "promo-base",
        promotion_ends_at: futureDate,
      },
      {
        product_id: "prod-1",
        variant_id: "var-1",
        list_price: 130000,
        effective_price: 99000,
        promotion_id: "promo-var",
        promotion_ends_at: null,
      },
    ]);

    const resolved = resolveDisplayPrice(
      {
        productId: "prod-1",
        variantId: "var-1",
        legacyPrice: 130000,
      },
      index,
    );

    expect(resolved).toEqual({
      price: 99000,
      originalPrice: 130000,
      saleExpiresAt: null,
      source: "erp",
    });
    expect(hasValidDiscount(resolved)).toBe(true);
  });

  it("respeta fila propia de la variante sin promo (promotion_id null) y devuelve legacy", () => {
    const index = indexPromotionPrices([
      {
        product_id: "prod-1",
        variant_id: null,
        list_price: 100000,
        effective_price: 80000,
        promotion_id: "promo-base",
        promotion_ends_at: futureDate,
      },
      {
        product_id: "prod-1",
        variant_id: "var-1",
        list_price: 70000,
        effective_price: 70000,
        promotion_id: null,
        promotion_ends_at: null,
      },
    ]);

    const resolved = resolveDisplayPrice(
      {
        productId: "prod-1",
        variantId: "var-1",
        legacyPrice: 70000,
      },
      index,
    );

    expect(resolved).toEqual({
      price: 70000,
      originalPrice: null,
      saleExpiresAt: null,
      source: "legacy",
    });
    expect(hasValidDiscount(resolved)).toBe(false);
  });

  it("usa la fila del producto base cuando la variante no tiene fila propia en el índice", () => {
    const index = indexPromotionPrices([
      {
        product_id: "prod-1",
        variant_id: null,
        list_price: 100000,
        effective_price: 80000,
        promotion_id: "promo-base",
        promotion_ends_at: futureDate,
      },
    ]);

    const resolved = resolveDisplayPrice(
      {
        productId: "prod-1",
        variantId: "var-missing",
        legacyPrice: 100000,
      },
      index,
    );

    expect(resolved).toEqual({
      price: 80000,
      originalPrice: 100000,
      saleExpiresAt: futureDate,
      source: "erp",
    });
    expect(hasValidDiscount(resolved)).toBe(true);
  });

  it("es coherente con hasValidDiscount según vigencia y fechas", () => {
    const index = indexPromotionPrices([
      {
        product_id: "prod-active",
        variant_id: null,
        list_price: 50000,
        effective_price: 40000,
        promotion_id: "promo-a",
        promotion_ends_at: null,
      },
      {
        product_id: "prod-expired",
        variant_id: null,
        list_price: 50000,
        effective_price: 40000,
        promotion_id: "promo-b",
        promotion_ends_at: pastDate,
      },
      {
        product_id: "prod-none",
        variant_id: null,
        list_price: 50000,
        effective_price: 50000,
        promotion_id: null,
        promotion_ends_at: null,
      },
    ]);

    const active = resolveDisplayPrice({ productId: "prod-active", legacyPrice: 50000 }, index);
    const expired = resolveDisplayPrice({ productId: "prod-expired", legacyPrice: 50000 }, index);
    const none = resolveDisplayPrice({ productId: "prod-none", legacyPrice: 50000 }, index);

    expect(hasValidDiscount(active)).toBe(true);
    expect(hasValidDiscount(expired)).toBe(false);
    expect(hasValidDiscount(none)).toBe(false);
  });
});
