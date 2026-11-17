import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontPromotionPrice } from "@/lib/promo-pricing";

type QueryResponse = {
  data: StorefrontPromotionPrice[] | null;
  error: { code?: string; message: string } | null;
};

const { mockIn, mockSelect, mockFrom } = vi.hoisted(() => {
  const inMock = vi.fn<(column: string, values: string[]) => Promise<QueryResponse>>();
  const selectMock = vi.fn(() => ({ in: inMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));
  return {
    mockIn: inMock,
    mockSelect: selectMock,
    mockFrom: fromMock,
  };
});

vi.mock("@/integrations/supabase/types.extensions", () => ({
  storefrontSupabase: {
    from: mockFrom,
  },
}));

import { useStorefrontPromotionPrices } from "@/hooks/use-storefront-promotion-prices";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useStorefrontPromotionPrices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("consulta la vista con ids ordenados y deduplicados y devuelve el índice", async () => {
    const rows: StorefrontPromotionPrice[] = [
      {
        product_id: "prod-a",
        variant_id: null,
        list_price: 100000,
        effective_price: 80000,
        promotion_id: "promo-1",
        promotion_ends_at: "2099-01-01T00:00:00.000Z",
      },
      {
        product_id: "prod-b",
        variant_id: "var-1",
        list_price: 50000,
        effective_price: 45000,
        promotion_id: "promo-2",
        promotion_ends_at: null,
      },
    ];
    mockIn.mockResolvedValueOnce({ data: rows, error: null });

    const { result } = renderHook(
      () => useStorefrontPromotionPrices(["prod-b", "prod-a", "prod-b"]),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.index).not.toBeNull();
    });

    expect(mockFrom).toHaveBeenCalledWith("storefront_promotion_prices");
    expect(mockSelect).toHaveBeenCalledWith(
      "product_id, variant_id, list_price, effective_price, promotion_id, promotion_ends_at",
    );
    expect(mockIn).toHaveBeenCalledWith("product_id", ["prod-a", "prod-b"]);
    expect(result.current.index?.get("prod-a:base")?.effective_price).toBe(80000);
    expect(result.current.index?.get("prod-b:var-1")?.effective_price).toBe(45000);
  });

  it("no ejecuta consulta cuando la lista de ids está vacía", () => {
    const { result } = renderHook(() => useStorefrontPromotionPrices([]), {
      wrapper: createWrapper(),
    });

    expect(mockFrom).not.toHaveBeenCalled();
    expect(result.current.index).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("falla abierto devolviendo null y loguea console.warn una sola vez cuando la vista no existe", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockIn.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST205",
        message: "Could not find the table 'public.storefront_promotion_prices' in the schema cache",
      },
    });

    const first = renderHook(() => useStorefrontPromotionPrices(["prod-1"]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(first.result.current.isLoading).toBe(false);
    });
    expect(first.result.current.index).toBeNull();

    const second = renderHook(() => useStorefrontPromotionPrices(["prod-2"]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(second.result.current.isLoading).toBe(false);
    });
    expect(second.result.current.index).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it("falla abierto devolviendo null ante un error genérico o excepción inesperada", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockIn.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useStorefrontPromotionPrices(["prod-3"]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.index).toBeNull();
    warnSpy.mockRestore();
  });
});
