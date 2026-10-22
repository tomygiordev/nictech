import { describe, it, expect } from "vitest";
import { executePosRequoteFlow } from "./posRequoteFlow";
import type { CatalogProductForSync } from "./pricing";

describe("executePosRequoteFlow (POS Requote Async Controller)", () => {
  const baseCart = [
    {
      key: "item-1",
      productId: "prod-1",
      displayName: "iPhone 13 Case",
      priceArs: 1000,
      taxRatePercent: 21,
      quantity: 2,
      availableStock: 5,
    },
  ];

  it("ensures first attempt uses fresh price from newly resolved array, not stale closure", async () => {
    // Simulated stale closure price is 1000. Fresh catalog fetch returns price 1500.
    const freshCatalog: CatalogProductForSync[] = [
      {
        id: "prod-1",
        name: "iPhone 13 Case",
        priceArs: 1500,
        taxRatePercent: 21,
        stock: 12,
        hasVariants: false,
      },
    ];

    const fetchCatalogMock = async () => freshCatalog;

    const result = await executePosRequoteFlow({
      cart: baseCart,
      fetchCatalog: fetchCatalogMock,
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.hasChanges).toBe(true);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        key: "item-1",
        oldPrice: 1000,
        newPrice: 1500,
      });
      // Fresh price applied, availableStock updated
      expect(result.updatedCart[0].priceArs).toBe(1500);
      expect(result.updatedCart[0].availableStock).toBe(12);
      expect(result.newTotalArs).toBe(3000);
      expect(result.staleQuoteDetected).toBe(false);
      expect(result.message).toContain("Precios sincronizados");
    }
  });

  it("supports passing a pending Promise directly to fetchCatalog", async () => {
    const pendingPromise = Promise.resolve<CatalogProductForSync[]>([
      {
        id: "prod-1",
        name: "iPhone 13 Case",
        priceArs: 1250,
        taxRatePercent: 21,
        stock: 8,
        hasVariants: false,
      },
    ]);

    const result = await executePosRequoteFlow({
      cart: baseCart,
      fetchCatalog: pendingPromise,
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.updatedCart[0].priceArs).toBe(1250);
      expect(result.updatedCart[0].availableStock).toBe(8);
      expect(result.staleQuoteDetected).toBe(false);
    }
  });

  it("handles fetch rejection/network failure by preserving cart and stale alert without sale creation", async () => {
    const fetchCatalogMock = async () => {
      throw new Error("Conexión perdida con el backend ERP");
    };

    const result = await executePosRequoteFlow({
      cart: baseCart,
      fetchCatalog: fetchCatalogMock,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toBe("fetch_failed");
      expect(result.error).toContain("Conexión perdida con el backend ERP");
      // Retains original cart items
      expect(result.cart).toEqual(baseCart);
      // Stale alert is strictly preserved
      expect(result.staleQuoteDetected).toBe(true);
    }
  });

  it("handles null return from fetch by preserving cart and stale alert without false success", async () => {
    const fetchCatalogMock = async () => null;

    const result = await executePosRequoteFlow({
      cart: baseCart,
      fetchCatalog: fetchCatalogMock,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toBe("fetch_failed");
      expect(result.error).toContain("No se pudo actualizar el catálogo vigente");
      expect(result.cart).toEqual(baseCart);
      expect(result.staleQuoteDetected).toBe(true);
    }
  });

  it("blocks requote and preserves cart/stale alert if a product disappeared from catalog", async () => {
    // Catalog does not contain 'prod-1'
    const freshCatalog: CatalogProductForSync[] = [
      {
        id: "other-prod",
        name: "Otro Producto",
        priceArs: 500,
        taxRatePercent: 21,
        stock: 10,
        hasVariants: false,
      },
    ];

    const result = await executePosRequoteFlow({
      cart: baseCart,
      fetchCatalog: async () => freshCatalog,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toBe("product_missing");
      expect(result.error).toContain("iPhone 13 Case");
      expect(result.cart).toEqual(baseCart);
      expect(result.staleQuoteDetected).toBe(true);
    }
  });

  it("blocks requote and does NOT fallback to parent or price 0 when variant is missing", async () => {
    const variantCart = [
      {
        key: "item-var-1",
        productId: "prod-2",
        variantId: "var-deleted",
        displayName: "Funda Silicona - Azul",
        priceArs: 2000,
        taxRatePercent: 21,
        quantity: 1,
        availableStock: 3,
      },
    ];

    // Parent product exists, but 'var-deleted' was removed
    const freshCatalog: CatalogProductForSync[] = [
      {
        id: "prod-2",
        name: "Funda Silicona",
        priceArs: 1800,
        taxRatePercent: 21,
        stock: 5,
        hasVariants: true,
        variants: [
          {
            id: "var-other",
            effectiveGrossPrice: 2200,
            stock: 2,
          },
        ],
      },
    ];

    const result = await executePosRequoteFlow({
      cart: variantCart,
      fetchCatalog: async () => freshCatalog,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toBe("variant_missing");
      expect(result.error).toContain("variante");
      // Never fallback to parent (1800) nor price 0; cart unchanged
      expect(result.cart).toEqual(variantCart);
      expect(result.staleQuoteDetected).toBe(true);
    }
  });

  it("blocks requote if product is marked isPriceOutOfRange in fresh catalog", async () => {
    const freshCatalog: CatalogProductForSync[] = [
      {
        id: "prod-1",
        name: "iPhone 13 Case",
        priceArs: 1_500_000_000,
        taxRatePercent: 21,
        stock: 10,
        hasVariants: false,
        isPriceOutOfRange: true,
        priceRangeError: "Precio fuera de rango (> $1.000.000.000 ARS)",
      },
    ];

    const result = await executePosRequoteFlow({
      cart: baseCart,
      fetchCatalog: async () => freshCatalog,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toBe("price_out_of_range");
      expect(result.error).toContain("fuera de rango");
      expect(result.cart).toEqual(baseCart);
      expect(result.staleQuoteDetected).toBe(true);
    }
  });

  it("blocks requote if variant is marked isPriceOutOfRange in fresh catalog", async () => {
    const variantCart = [
      {
        key: "item-var-1",
        productId: "prod-2",
        variantId: "var-bad",
        displayName: "Funda Silicona - Verde",
        priceArs: 2000,
        taxRatePercent: 21,
        quantity: 1,
        availableStock: 3,
      },
    ];

    const freshCatalog: CatalogProductForSync[] = [
      {
        id: "prod-2",
        name: "Funda Silicona",
        priceArs: 2000,
        taxRatePercent: 21,
        stock: 5,
        hasVariants: true,
        variants: [
          {
            id: "var-bad",
            effectiveGrossPrice: -50,
            stock: 2,
            isPriceOutOfRange: true,
            priceRangeError: "Precio negativo inválido",
          },
        ],
      },
    ];

    const result = await executePosRequoteFlow({
      cart: variantCart,
      fetchCatalog: async () => freshCatalog,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toBe("price_out_of_range");
      expect(result.error).toContain("fuera de rango");
      expect(result.cart).toEqual(variantCart);
      expect(result.staleQuoteDetected).toBe(true);
    }
  });

  it("updates availableStock even when prices and tax rates match catalog", async () => {
    const freshCatalog: CatalogProductForSync[] = [
      {
        id: "prod-1",
        name: "iPhone 13 Case",
        priceArs: 1000, // Matches cart
        taxRatePercent: 21, // Matches cart
        stock: 99, // Stock changed from 5 to 99!
        hasVariants: false,
      },
    ];

    const result = await executePosRequoteFlow({
      cart: baseCart,
      fetchCatalog: async () => freshCatalog,
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.hasChanges).toBe(false);
      expect(result.changes).toHaveLength(0);
      expect(result.updatedCart[0].availableStock).toBe(99);
      expect(result.message).toContain("coinciden con el catálogo vigente");
      expect(result.staleQuoteDetected).toBe(false);
    }
  });
});
