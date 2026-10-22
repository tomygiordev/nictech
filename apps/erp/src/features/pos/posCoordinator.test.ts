import { describe, expect, it, vi } from "vitest";
import { PosCoordinator, PosContextSnapshot, normalizePosError } from "./posCoordinator";
import type { CatalogProductForSync } from "./pricing";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("PosCoordinator (Authoritative POS Concurrency & Exclusion Controller)", () => {
  const initialContext: PosContextSnapshot = {
    organizationId: "org-1",
    branchId: "branch-1",
    locationId: "loc-1",
  };

  const baseCart = [
    {
      key: "item-1",
      productId: "prod-1",
      displayName: "iPhone 15 Case",
      priceArs: 1000,
      taxRatePercent: 21,
      quantity: 1,
      availableStock: 5,
    },
  ];

  it("normalizes unknown errors including Postgrest error object and identifies stale quote", () => {
    // 1. Authoritative server stale marker
    const postgrestErr = {
      code: "23514",
      message: "stale quote: catalog price or tax rate has changed, requote required",
      details: "Price ARS does not match catalog",
    };
    const norm1 = normalizePosError(postgrestErr);
    expect(norm1.code).toBe("23514");
    expect(norm1.message).toBe("stale quote: catalog price or tax rate has changed, requote required");
    expect(norm1.isStaleQuote).toBe(true);

    // 2. Generic 23514 check constraint without stale quote marker is NOT stale quote
    const checkErr = {
      code: "23514",
      message: "check constraint violation: discount cannot exceed total",
    };
    const norm2 = normalizePosError(checkErr);
    expect(norm2.isStaleQuote).toBe(false);

    // 3. Generic unknown error
    const norm3 = normalizePosError("Network timeout");
    expect(norm3.message).toBe("Network timeout");
    expect(norm3.isStaleQuote).toBe(false);
  });

  it("enforces mutual synchronous exclusion between checkout, requote, and fetch", async () => {
    const coordinator = new PosCoordinator(initialContext);
    const requoteDeferred = createDeferred<CatalogProductForSync[] | null>();

    const requotePromise = coordinator.coordinateRequote({
      cart: baseCart,
      fetchCatalog: () => requoteDeferred.promise,
      onApplyCart: vi.fn(),
      onApplyFeedback: vi.fn(),
      onSetStaleQuoteDetected: vi.fn(),
    });

    expect(coordinator.isRequoteActive()).toBe(true);

    // 1. Checkout is blocked while requote is active
    const checkoutBlocked = await coordinator.coordinateCheckout({
      executeSale: vi.fn(),
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onClearCart: vi.fn(),
      onClearOperationKey: vi.fn(),
      onSetStaleQuoteDetected: vi.fn(),
    });
    expect(checkoutBlocked.status).toBe("blocked");
    expect(checkoutBlocked.reason).toBe("requote_in_progress");

    // 2. Plain fetch is blocked while requote is active
    const fetchBlocked = coordinator.beginFetch();
    expect(fetchBlocked).toBeNull();

    // 3. Another requote is blocked while requote is active
    const secondRequote = coordinator.beginRequote();
    expect(secondRequote.ok).toBe(false);
    expect(secondRequote.reason).toBe("requote_in_progress");

    requoteDeferred.resolve([]);
    await requotePromise;
    expect(coordinator.isIdle()).toBe(true);

    // Now test while checkout is in progress
    const saleDeferred = createDeferred<{ saleId: string }>();
    const checkoutPromise = coordinator.coordinateCheckout({
      executeSale: () => saleDeferred.promise,
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onClearCart: vi.fn(),
      onClearOperationKey: vi.fn(),
      onSetStaleQuoteDetected: vi.fn(),
    });

    expect(coordinator.isCheckoutActive()).toBe(true);

    // 4. Requote is blocked while checkout is active
    const requoteBlocked = await coordinator.coordinateRequote({
      cart: baseCart,
      fetchCatalog: async () => [],
      onApplyCart: vi.fn(),
      onApplyFeedback: vi.fn(),
      onSetStaleQuoteDetected: vi.fn(),
    });
    expect(requoteBlocked.status).toBe("blocked");
    expect(requoteBlocked.reason).toBe("checkout_in_progress");

    // 5. Plain fetch is blocked while checkout is active
    const fetchBlockedByCheckout = coordinator.beginFetch();
    expect(fetchBlockedByCheckout).toBeNull();

    saleDeferred.resolve({ saleId: "s-1" });
    await checkoutPromise;
    expect(coordinator.isIdle()).toBe(true);
  });

  it("invalidates requote response deterministically on A -> B and A -> B -> A transitions without applying cart", async () => {
    // Case 1: A -> B
    const coordinator1 = new PosCoordinator(initialContext);
    const deferred1 = createDeferred<CatalogProductForSync[] | null>();
    const onApplyCart1 = vi.fn();

    const requotePromise1 = coordinator1.coordinateRequote({
      cart: baseCart,
      fetchCatalog: () => deferred1.promise,
      onApplyCart: onApplyCart1,
      onApplyFeedback: vi.fn(),
      onSetStaleQuoteDetected: vi.fn(),
    });

    // Context changes from A to B
    coordinator1.notifyContextChanged({
      organizationId: "org-1",
      branchId: "branch-2",
      locationId: "loc-1",
    });

    deferred1.resolve([
      {
        id: "prod-1",
        name: "iPhone 15 Case",
        priceArs: 1500,
        taxRatePercent: 21,
        stock: 8,
        hasVariants: false,
      },
    ]);

    const res1 = await requotePromise1;
    expect(res1.status).toBe("discarded");
    expect(res1.reason).toBe("context_or_cart_invalidated");
    expect(onApplyCart1).not.toHaveBeenCalled();

    // Case 2: A -> B -> A (Returning to initial context still invalidates because contextRevision incremented!)
    const coordinator2 = new PosCoordinator(initialContext);
    const deferred2 = createDeferred<CatalogProductForSync[] | null>();
    const onApplyCart2 = vi.fn();

    const requotePromise2 = coordinator2.coordinateRequote({
      cart: baseCart,
      fetchCatalog: () => deferred2.promise,
      onApplyCart: onApplyCart2,
      onApplyFeedback: vi.fn(),
      onSetStaleQuoteDetected: vi.fn(),
    });

    // Change A -> B
    coordinator2.notifyContextChanged({
      organizationId: "org-1",
      branchId: "branch-2",
      locationId: "loc-1",
    });

    // Change B -> A
    coordinator2.notifyContextChanged({
      organizationId: "org-1",
      branchId: "branch-1",
      locationId: "loc-1",
    });

    deferred2.resolve([
      {
        id: "prod-1",
        name: "iPhone 15 Case",
        priceArs: 1500,
        taxRatePercent: 21,
        stock: 8,
        hasVariants: false,
      },
    ]);

    const res2 = await requotePromise2;
    expect(res2.status).toBe("discarded");
    expect(res2.reason).toBe("context_or_cart_invalidated");
    expect(onApplyCart2).not.toHaveBeenCalled();
  });

  it("invalidates fetch tokens deterministically on A -> B and A -> B -> A context revisions", () => {
    const coordinator = new PosCoordinator(initialContext);

    // 1. Begin fetch at context A (contextRevision = 0)
    const tokenA = coordinator.beginFetch()!;
    expect(tokenA).toBeGreaterThan(0);
    expect(coordinator.isFetchValid(tokenA)).toBe(true);

    // 2. Change A -> B (contextRevision = 1)
    coordinator.notifyContextChanged({
      organizationId: "org-1",
      branchId: "branch-2",
      locationId: "loc-1",
    });
    expect(coordinator.isFetchValid(tokenA)).toBe(false);

    // 3. Change B -> A (contextRevision = 2)
    coordinator.notifyContextChanged({
      organizationId: "org-1",
      branchId: "branch-1",
      locationId: "loc-1",
    });
    // Even though properties match context A, monotonic revision is now 2, so tokenA (revision 0) is INVALID!
    expect(coordinator.isFetchValid(tokenA)).toBe(false);
  });

  it("discards stale requote response after confirmed sale and does NOT reinstall charged cart", async () => {
    const coordinator = new PosCoordinator(initialContext);
    const fetchDeferred = createDeferred<CatalogProductForSync[] | null>();

    const onApplyCart = vi.fn();
    const onApplyFeedback = vi.fn();

    // 1. Requote starts
    const requotePromise = coordinator.coordinateRequote({
      cart: baseCart,
      fetchCatalog: () => fetchDeferred.promise,
      onApplyCart,
      onApplyFeedback,
      onSetStaleQuoteDetected: vi.fn(),
    });

    // 2. Sale completes while requote was still pending
    coordinator.notifySaleCompleted();

    // 3. Requote resolves late
    fetchDeferred.resolve([
      {
        id: "prod-1",
        name: "iPhone 15 Case",
        priceArs: 1500,
        taxRatePercent: 21,
        stock: 8,
        hasVariants: false,
      },
    ]);

    const requoteResult = await requotePromise;
    expect(requoteResult.status).toBe("discarded");
    expect(requoteResult.reason).toBe("context_or_cart_invalidated");
    expect(onApplyCart).not.toHaveBeenCalled();
    expect(onApplyFeedback).not.toHaveBeenCalled();
  });

  it("discards requote response when cart is edited or cleared during fetch", async () => {
    // A: Edited cart
    const coordinatorA = new PosCoordinator(initialContext);
    const fetchDeferredA = createDeferred<CatalogProductForSync[] | null>();
    const onApplyCartA = vi.fn();

    const requotePromiseA = coordinatorA.coordinateRequote({
      cart: baseCart,
      fetchCatalog: () => fetchDeferredA.promise,
      onApplyCart: onApplyCartA,
      onApplyFeedback: vi.fn(),
      onSetStaleQuoteDetected: vi.fn(),
    });

    coordinatorA.notifyCartModified();

    fetchDeferredA.resolve([
      {
        id: "prod-1",
        name: "iPhone 15 Case",
        priceArs: 1500,
        taxRatePercent: 21,
        stock: 8,
        hasVariants: false,
      },
    ]);

    const resultA = await requotePromiseA;
    expect(resultA.status).toBe("discarded");
    expect(onApplyCartA).not.toHaveBeenCalled();

    // B: Cleared cart
    const coordinatorB = new PosCoordinator(initialContext);
    const fetchDeferredB = createDeferred<CatalogProductForSync[] | null>();
    const onApplyCartB = vi.fn();

    const requotePromiseB = coordinatorB.coordinateRequote({
      cart: baseCart,
      fetchCatalog: () => fetchDeferredB.promise,
      onApplyCart: onApplyCartB,
      onApplyFeedback: vi.fn(),
      onSetStaleQuoteDetected: vi.fn(),
    });

    coordinatorB.notifyCartCleared();

    fetchDeferredB.resolve([
      {
        id: "prod-1",
        name: "iPhone 15 Case",
        priceArs: 1500,
        taxRatePercent: 21,
        stock: 8,
        hasVariants: false,
      },
    ]);

    const resultB = await requotePromiseB;
    expect(resultB.status).toBe("discarded");
    expect(onApplyCartB).not.toHaveBeenCalled();
  });

  it("manages defaults loading idempotency: marks context loaded and only reloads upon real context revision", () => {
    const coordinator = new PosCoordinator(initialContext);
    expect(coordinator.isContextLoaded()).toBe(false);

    // Initial load adopts defaults and marks loaded
    coordinator.markContextLoaded();
    expect(coordinator.isContextLoaded()).toBe(true);

    // Repeated check does not trigger loading
    expect(coordinator.isContextLoaded()).toBe(true);

    // Real user interaction changes branch
    coordinator.notifyContextChanged({
      organizationId: "org-1",
      branchId: "branch-2",
      locationId: "loc-1",
    });
    // Context is now dirty / not loaded
    expect(coordinator.isContextLoaded()).toBe(false);

    // After loading new branch, mark loaded again
    coordinator.markContextLoaded();
    expect(coordinator.isContextLoaded()).toBe(true);
  });

  it("ensures old finalizer does not turn off loading or clear state when a newer fetch is active", () => {
    const coordinator = new PosCoordinator(initialContext);

    // 1. Fetch 1 starts with token 1
    const token1 = coordinator.beginFetch()!;
    expect(token1).toBeGreaterThan(0);
    expect(coordinator.getActiveOperation()).toEqual(
      expect.objectContaining({ kind: "fetch", token: token1 }),
    );

    // 2. beginFetch does NOT replace an active fetch (returns null)
    expect(coordinator.beginFetch()).toBeNull();

    // 3. Fetch 1 ends, and Fetch 2 starts with token 2
    coordinator.endFetch(token1);
    const token2 = coordinator.beginFetch()!;
    expect(token2).toBeGreaterThan(token1);
    expect(coordinator.getActiveOperation()).toEqual(
      expect.objectContaining({ kind: "fetch", token: token2 }),
    );

    // 4. Stale finalizer for token1 is invoked: MUST NOT clear token 2!
    coordinator.endFetch(token1);
    expect(coordinator.isIdle()).toBe(false);
    expect(coordinator.isFetchActive()).toBe(true);
    expect(coordinator.getActiveOperation()).toEqual(
      expect.objectContaining({ kind: "fetch", token: token2 }),
    );

    // Fetch 1 is invalid, while Fetch 2 is valid
    expect(coordinator.isFetchValid(token1)).toBe(false);
    expect(coordinator.isFetchValid(token2)).toBe(true);

    // 5. Fetch 2 finishes and calls endFetch(token2)
    coordinator.endFetch(token2);
    expect(coordinator.isIdle()).toBe(true);
  });

  it("preserves confirmed sale and pending recovery when organization changes during checkout, leaving new cart intact", async () => {
    const coordinator = new PosCoordinator(initialContext);
    const saleDeferred = createDeferred<{ saleId: string; documentId: string; documentNumber: string }>();

    const onClearCart = vi.fn();
    const onClearOperationKey = vi.fn();
    const onCheckoutSuccess = vi.fn();

    // 1. Start checkout for context A
    const checkoutPromise = coordinator.coordinateCheckout({
      executeSale: () => saleDeferred.promise,
      onSuccess: onCheckoutSuccess,
      onError: vi.fn(),
      onClearCart,
      onClearOperationKey,
      onSetStaleQuoteDetected: vi.fn(),
    });

    expect(coordinator.isCheckoutActive()).toBe(true);

    // 2. External organization switch happens while checkout RPC is in flight!
    coordinator.notifyContextChanged({
      organizationId: "org-2", // New org!
      branchId: "branch-99",
      locationId: "loc-99",
    });
    // New cart items are added in the new org
    coordinator.notifyCartModified();

    // 3. RPC finishes and confirms the sale in ERP
    saleDeferred.resolve({
      saleId: "sale-confirmed-1",
      documentId: "doc-1",
      documentNumber: "A-0001-00000001",
    });

    const result = await checkoutPromise;
    expect(result.status).toBe("completed");

    // Confirmed sale MUST be notified to save ticket/receipt!
    expect(onCheckoutSuccess).toHaveBeenCalledWith({
      saleId: "sale-confirmed-1",
      documentId: "doc-1",
      documentNumber: "A-0001-00000001",
    });

    // Screen cleanup (cart and key) MUST NOT run on the new cart!
    expect(onClearCart).not.toHaveBeenCalled();
    expect(onClearOperationKey).not.toHaveBeenCalled();
    expect(coordinator.isCheckoutActive()).toBe(false);
  });

  it("preserves cart and idempotency key on uncertain errors (timeout), allowing retry with same key/payload and immediate requote", async () => {
    const coordinator = new PosCoordinator(initialContext);

    const onClearCart = vi.fn();
    const onClearOperationKey = vi.fn();
    const onCheckoutError = vi.fn();
    const executeSale = vi.fn(async () => {
      throw new Error("Gateway timeout 504 - respuesta de red incierta");
    });

    const checkResult = await coordinator.coordinateCheckout({
      executeSale,
      onSuccess: vi.fn(),
      onError: onCheckoutError,
      onClearCart,
      onClearOperationKey,
      onSetStaleQuoteDetected: vi.fn(),
    });

    expect(checkResult.status).toBe("error");
    expect(checkResult.error).toContain("Gateway timeout 504");
    // Cart and operation key are PRESERVED!
    expect(onClearCart).not.toHaveBeenCalled();
    expect(onClearOperationKey).not.toHaveBeenCalled();
    expect(coordinator.isCheckoutActive()).toBe(false);

    // Requote is immediately permitted after checkout failure
    const requoteFetch = vi.fn(async () => [
      {
        id: "prod-1",
        name: "iPhone 15 Case",
        priceArs: 1000,
        taxRatePercent: 21,
        stock: 5,
        hasVariants: false,
      },
    ]);

    const reqResult = await coordinator.coordinateRequote({
      cart: baseCart,
      fetchCatalog: requoteFetch,
      onApplyCart: vi.fn(),
      onApplyFeedback: vi.fn(),
      onSetStaleQuoteDetected: vi.fn(),
    });

    expect(reqResult.status).toBe("success");
    // Requote never calls executeSale
    expect(executeSale).toHaveBeenCalledTimes(1);
  });

  it("detects Postgrest 23514 stale quote error during checkout, sets stale flag, preserves message, and allows requote", async () => {
    const coordinator = new PosCoordinator(initialContext);
    const onSetStaleQuoteDetected = vi.fn();
    const onCheckoutError = vi.fn();

    const postgrestErr = {
      code: "23514",
      message: "stale quote: catalog price or tax rate has changed, requote required",
      details: "Check constraint sale_gross_price_valid failed",
    };

    const failSale = vi.fn(async () => {
      throw postgrestErr;
    });

    const checkoutResult = await coordinator.coordinateCheckout({
      executeSale: failSale,
      onSuccess: vi.fn(),
      onError: onCheckoutError,
      onClearCart: vi.fn(),
      onClearOperationKey: vi.fn(),
      onSetStaleQuoteDetected,
    });

    expect(checkoutResult.status).toBe("error");
    expect(checkoutResult.error).toBe(postgrestErr.message);
    expect(onCheckoutError).toHaveBeenCalledWith(postgrestErr.message);
    expect(onSetStaleQuoteDetected).toHaveBeenCalledWith(true);
    expect(coordinator.isCheckoutActive()).toBe(false);

    // Requote is now immediately permitted
    const onApplyCart = vi.fn();
    const reqResult = await coordinator.coordinateRequote({
      cart: baseCart,
      fetchCatalog: async () => [
        {
          id: "prod-1",
          name: "iPhone 15 Case",
          priceArs: 1250,
          taxRatePercent: 21,
          stock: 5,
          hasVariants: false,
        },
      ],
      onApplyCart,
      onApplyFeedback: vi.fn(),
      onSetStaleQuoteDetected: vi.fn(),
    });

    expect(reqResult.status).toBe("success");
    expect(onApplyCart).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ priceArs: 1250 }),
      ]),
    );
  });

  it("prevents any obsolete UI setter from running when fetch resolves after context revision", async () => {
    const coordinator = new PosCoordinator(initialContext);
    const fetchDeferred = createDeferred<{ products: unknown[]; rate: number }>();

    // Mock UI setters
    const setBranches = vi.fn();
    const setLocations = vi.fn();
    const setPaymentMethods = vi.fn();
    const setDollarRate = vi.fn();
    const setProducts = vi.fn();
    const setFormValue = vi.fn();

    // Production-like fetch routine
    async function simulateFetchProductsAndSettings() {
      const fetchToken = coordinator.beginFetch();
      if (fetchToken === null) return null;

      try {
        const data = await fetchDeferred.promise;

        // CRITICAL CHECK BEFORE ANY SETTER:
        if (!coordinator.isFetchValid(fetchToken)) {
          return null;
        }

        // Adopt defaults in validated block
        setBranches(["branch-1"]);
        setLocations(["loc-1"]);
        setPaymentMethods(["cash"]);
        setDollarRate(data.rate);
        setProducts(data.products);
        setFormValue("branchId", "branch-1");
        return data.products;
      } finally {
        coordinator.endFetch(fetchToken);
      }
    }

    const fetchPromise = simulateFetchProductsAndSettings();

    // While fetch is in flight, context changes!
    coordinator.notifyContextChanged({
      organizationId: "org-1",
      branchId: "branch-changed",
      locationId: "loc-changed",
    });

    // Resolve in-flight fetch
    fetchDeferred.resolve({ products: [{ id: "p-stale" }], rate: 1200 });
    const result = await fetchPromise;

    expect(result).toBeNull();
    // Verify NOT A SINGLE obsolete setter was called!
    expect(setBranches).not.toHaveBeenCalled();
    expect(setLocations).not.toHaveBeenCalled();
    expect(setPaymentMethods).not.toHaveBeenCalled();
    expect(setDollarRate).not.toHaveBeenCalled();
    expect(setProducts).not.toHaveBeenCalled();
    expect(setFormValue).not.toHaveBeenCalled();
  });

  it("synchronously guards against mutable handlers while checkout is in flight", async () => {
    const coordinator = new PosCoordinator(initialContext);
    const saleDeferred = createDeferred<{ saleId: string }>();

    const checkoutPromise = coordinator.coordinateCheckout({
      executeSale: () => saleDeferred.promise,
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onClearCart: vi.fn(),
      onClearOperationKey: vi.fn(),
      onSetStaleQuoteDetected: vi.fn(),
    });

    expect(coordinator.isCheckoutActive()).toBe(true);

    // Simulated handler guards (matching PosWorkspace)
    const handleAddToCart = () => {
      if (coordinator.isCheckoutActive()) return false;
      return true;
    };
    const handleUpdateQuantity = () => {
      if (coordinator.isCheckoutActive()) return false;
      return true;
    };
    const handleRemoveFromCart = () => {
      if (coordinator.isCheckoutActive()) return false;
      return true;
    };
    const handleClearCart = () => {
      if (coordinator.isCheckoutActive()) return false;
      return true;
    };
    const handleBranchChange = () => {
      if (coordinator.isCheckoutActive()) return false;
      return true;
    };

    expect(handleAddToCart()).toBe(false);
    expect(handleUpdateQuantity()).toBe(false);
    expect(handleRemoveFromCart()).toBe(false);
    expect(handleClearCart()).toBe(false);
    expect(handleBranchChange()).toBe(false);

    // Resolve checkout
    saleDeferred.resolve({ saleId: "done" });
    await checkoutPromise;

    expect(coordinator.isCheckoutActive()).toBe(false);
    expect(handleAddToCart()).toBe(true);
    expect(handleClearCart()).toBe(true);
  });

  describe("Section H Authoritative Contract Suite", () => {
    const UUID_BRANCH_A = "10000000-0000-4000-8000-000000000001";
    const UUID_LOCATION_A = "10000000-0000-4000-8000-000000000002";
    const UUID_BRANCH_B = "10000000-0000-4000-8000-000000000003";
    const UUID_LOCATION_B = "10000000-0000-4000-8000-000000000004";
    const UUID_PAYMENT_METHOD = "10000000-0000-4000-8000-000000000005";
    const UUID_PRODUCT_1 = "10000000-0000-4000-8000-000000000006";
    const UUID_PRODUCT_2 = "10000000-0000-4000-8000-000000000007";
    const UUID_SNAPSHOT = "10000000-0000-4000-8000-000000000008";
    const UUID_CUSTOMER = "10000000-0000-4000-8000-000000000009";
    const UUID_CASH_SESSION = "10000000-0000-4000-8000-000000000010";

    it("H1: success -> autofetch submitting false ANTES fetch y luego POS usable", async () => {
      const coordinator = new PosCoordinator({ organizationId: "org-1", branchId: UUID_BRANCH_A, locationId: UUID_LOCATION_A });
      const sequence: string[] = [];

      const checkoutPromise = coordinator.coordinateCheckout({
        values: {
          branchId: UUID_BRANCH_A,
          locationId: UUID_LOCATION_A,
          paymentMethodId: UUID_PAYMENT_METHOD,
          invoiceKind: "fiscal",
          customerName: "Juan Perez",
        },
        cart: [
          {
            key: "k1",
            productId: UUID_PRODUCT_1,
            displayName: "Prod 1",
            priceArs: 100,
            quantity: 1,
            availableStock: 5,
            locationId: UUID_LOCATION_A,
            taxRatePercent: 21,
          },
        ],
        subtotalArs: 100,
        selectedPaymentMethod: { id: UUID_PAYMENT_METHOD, requires_cash_session: false },
        dollarRate: 1000,
        getExchangeSnapshotFn: async () => UUID_SNAPSHOT,
        getPosCustomerFn: async () => UUID_CUSTOMER,
        submitPreparedSaleFn: async () => ({
          saleId: "s-1",
          documentId: "d-1",
          documentNumber: "FC-001",
          invoiceKind: "fiscal",
        }),
        getDocumentSaleReceiptFn: async () => null,
        onSetSubmittingSale: (submitting) => {
          sequence.push(`submitting:${submitting}`);
        },
        onAfterSaleFetch: () => {
          coordinator.requestAutoFetch(async (fetchToken) => {
            sequence.push("autofetch:start");
            expect(coordinator.isFetchActive()).toBe(true);
            sequence.push("autofetch:end");
            coordinator.endFetch(fetchToken);
          });
        },
      });

      const res = await checkoutPromise;
      expect(res.status).toBe("completed");
      const subFalseIdx = sequence.indexOf("submitting:false");
      const autoFetchStartIdx = sequence.indexOf("autofetch:start");
      expect(subFalseIdx).toBeGreaterThan(-1);
      expect(autoFetchStartIdx).toBeGreaterThan(-1);
      expect(subFalseIdx).toBeLessThan(autoFetchStartIdx);
      expect(coordinator.isIdle()).toBe(true);
    });

    it("H2: timeout A -> B blocked retry(no RPC) -> A retry DEEP EQUAL TODOS args/key, preflights once", async () => {
      const coordinator = new PosCoordinator({ organizationId: "org-A", branchId: UUID_BRANCH_A, locationId: UUID_LOCATION_A });
      let snapshotCount = 0;
      let customerCount = 0;
      let submitCount = 0;
      const capturedSubmitArgs: any[] = [];

      const checkoutParams = {
        values: {
          branchId: UUID_BRANCH_A,
          locationId: UUID_LOCATION_A,
          paymentMethodId: UUID_PAYMENT_METHOD,
          invoiceKind: "fiscal" as const,
          customerName: "Cliente A",
        },
        cart: [
          {
            key: "k1",
            productId: UUID_PRODUCT_1,
            displayName: "Item 1",
            priceArs: 500,
            quantity: 2,
            availableStock: 10,
            locationId: UUID_LOCATION_A,
            taxRatePercent: 21,
          },
        ],
        subtotalArs: 1000,
        selectedPaymentMethod: { id: UUID_PAYMENT_METHOD, requires_cash_session: false },
        dollarRate: 1000,
        getExchangeSnapshotFn: async () => {
          snapshotCount++;
          return UUID_SNAPSHOT;
        },
        getPosCustomerFn: async () => {
          customerCount++;
          return UUID_CUSTOMER;
        },
        submitPreparedSaleFn: async (args: any) => {
          submitCount++;
          capturedSubmitArgs.push(args);
          if (submitCount === 1) {
            throw new Error("Gateway Timeout: connection timed out");
          }
          return {
            saleId: "sale-retry-1",
            documentId: "doc-retry-1",
            documentNumber: "FC-0002",
            invoiceKind: "fiscal" as const,
          };
        },
      };

      // 1. Initial attempt in org-A -> times out -> uncertain
      const res1 = await coordinator.coordinateCheckout(checkoutParams);
      expect(res1.status).toBe("error");
      expect(coordinator.getFinancialAttempt()?.status).toBe("uncertain");
      expect(snapshotCount).toBe(1);
      expect(customerCount).toBe(1);
      expect(submitCount).toBe(1);

      // 2. Switch to org-B
      coordinator.notifyContextChanged({ organizationId: "org-B", branchId: UUID_BRANCH_B, locationId: UUID_LOCATION_B });
      const retryInB = await coordinator.retryUncertainSale({
        submitPreparedSaleFn: checkoutParams.submitPreparedSaleFn,
      });
      expect(retryInB.status).toBe("blocked");
      expect(retryInB.reason).toBe("different_organization");
      expect(submitCount).toBe(1);

      // 3. Switch back to org-A
      coordinator.notifyContextChanged({ organizationId: "org-A", branchId: UUID_BRANCH_A, locationId: UUID_LOCATION_A });
      const retryInA = await coordinator.retryUncertainSale({
        submitPreparedSaleFn: checkoutParams.submitPreparedSaleFn,
      });
      expect(retryInA.status).toBe("completed");
      expect(coordinator.getFinancialAttempt()?.status).toBe("confirmed");
      expect(submitCount).toBe(2);
      expect(snapshotCount).toBe(1);
      expect(customerCount).toBe(1);
      expect(capturedSubmitArgs[0]).toEqual(capturedSubmitArgs[1]);
      expect(capturedSubmitArgs[0].operation_key).toBe(capturedSubmitArgs[1].operation_key);
    });

    it("H3: primer stale estructurado definitivo -> requote -> nuevo intento key nueva", async () => {
      const coordinator = new PosCoordinator({ organizationId: "org-1", branchId: UUID_BRANCH_A, locationId: UUID_LOCATION_A });
      let submitCount = 0;
      const submittedKeys: string[] = [];
      let staleDetected = false;

      const runCheckout = () =>
        coordinator.coordinateCheckout({
          values: {
            branchId: UUID_BRANCH_A,
            locationId: UUID_LOCATION_A,
            paymentMethodId: UUID_PAYMENT_METHOD,
            invoiceKind: "fiscal",
            customerName: "Cliente Test",
          },
          cart: [
            {
              key: "k1",
              productId: UUID_PRODUCT_1,
              displayName: "Item 1",
              priceArs: 200,
              quantity: 1,
              availableStock: 5,
              locationId: UUID_LOCATION_A,
              taxRatePercent: 21,
            },
          ],
          subtotalArs: 200,
          selectedPaymentMethod: { id: UUID_PAYMENT_METHOD, requires_cash_session: false },
          dollarRate: 1000,
          getExchangeSnapshotFn: async () => UUID_SNAPSHOT,
          getPosCustomerFn: async () => UUID_CUSTOMER,
          submitPreparedSaleFn: async (args) => {
            submitCount++;
            submittedKeys.push(args.operation_key);
            if (submitCount === 1) {
              const err = new Error("stale quote: catalog price or tax rate has changed, requote required");
              (err as any).code = "23514";
              throw err;
            }
            return {
              saleId: "s-2",
              documentId: "d-2",
              documentNumber: "FC-002",
              invoiceKind: "fiscal",
            };
          },
          onSetStaleQuoteDetected: (stale) => {
            staleDetected = stale;
          },
        });

      // 1. Initial attempt fails with definitive stale quote
      const res1 = await runCheckout();
      expect(res1.status).toBe("error");
      expect(staleDetected).toBe(true);
      const attempt1 = coordinator.getFinancialAttempt();
      expect(attempt1?.status).toBe("rejected");
      expect(attempt1?.rejectionReason).toBe("stale_quote");

      // 2. Requote clears stale detected flag
      const requoteRes = await coordinator.coordinateRequote({
        cart: [{ key: "k1", productId: UUID_PRODUCT_1, displayName: "Item 1", priceArs: 250, taxRatePercent: 21, quantity: 1, availableStock: 5 }],
        fetchCatalog: async () => [{ id: UUID_PRODUCT_1, name: "Item 1", priceArs: 250, taxRatePercent: 21, stock: 5, hasVariants: false }],
        onApplyCart: vi.fn(),
        onApplyFeedback: vi.fn(),
        onSetStaleQuoteDetected: (stale) => {
          staleDetected = stale;
        },
      });
      expect(requoteRes.status).toBe("success");
      expect(staleDetected).toBe(false);

      // 3. New checkout attempt starts clean with a NEW key
      const res2 = await runCheckout();
      expect(res2.status).toBe("completed");
      expect(submittedKeys.length).toBe(2);
      expect(submittedKeys[0]).not.toBe(submittedKeys[1]);
    });

    it("H4: uncertain -> edit/requote original intacto, nuevo charge bloqueado", async () => {
      const coordinator = new PosCoordinator({ organizationId: "org-1", branchId: UUID_BRANCH_A, locationId: UUID_LOCATION_A });

      await coordinator.coordinateCheckout({
        values: {
          branchId: UUID_BRANCH_A,
          locationId: UUID_LOCATION_A,
          paymentMethodId: UUID_PAYMENT_METHOD,
          invoiceKind: "fiscal",
          customerName: "Cliente 1",
        },
        cart: [
          {
            key: "k1",
            productId: UUID_PRODUCT_1,
            displayName: "Item 1",
            priceArs: 100,
            quantity: 1,
            availableStock: 5,
            locationId: UUID_LOCATION_A,
            taxRatePercent: 21,
          },
        ],
        subtotalArs: 100,
        selectedPaymentMethod: { id: UUID_PAYMENT_METHOD, requires_cash_session: false },
        dollarRate: 1000,
        getExchangeSnapshotFn: async () => UUID_SNAPSHOT,
        getPosCustomerFn: async () => UUID_CUSTOMER,
        submitPreparedSaleFn: async () => {
          throw new Error("ETIMEDOUT");
        },
      });

      const initialAttempt = coordinator.getFinancialAttempt();
      expect(initialAttempt?.status).toBe("uncertain");
      const originalKey = initialAttempt?.id;
      const originalArgs = initialAttempt?.args;

      // Operator edits cart / requotes
      coordinator.notifyCartModified();
      const requoteRes = await coordinator.coordinateRequote({
        cart: [{ key: "k1", productId: UUID_PRODUCT_1, displayName: "Item 1", priceArs: 100, taxRatePercent: 21, quantity: 1, availableStock: 5 }],
        fetchCatalog: async () => [{ id: UUID_PRODUCT_1, name: "Item 1", priceArs: 100, taxRatePercent: 21, stock: 5, hasVariants: false }],
        onApplyCart: vi.fn(),
        onApplyFeedback: vi.fn(),
        onSetStaleQuoteDetected: vi.fn(),
      });
      expect(requoteRes.status).toBe("success");

      // Original attempt remains completely intact!
      const attemptAfterEdit = coordinator.getFinancialAttempt();
      expect(attemptAfterEdit?.status).toBe("uncertain");
      expect(attemptAfterEdit?.id).toBe(originalKey);
      expect(attemptAfterEdit?.args).toEqual(originalArgs);

      // Starting a NEW charge is blocked while uncertain attempt is pending
      const newChargeBlocked = await coordinator.coordinateCheckout({
        values: {
          branchId: UUID_BRANCH_A,
          locationId: UUID_LOCATION_A,
          paymentMethodId: UUID_PAYMENT_METHOD,
          invoiceKind: "fiscal",
          customerName: "Cliente 2",
        },
        cart: [
          {
            key: "k2",
            productId: UUID_PRODUCT_2,
            displayName: "Item 2",
            priceArs: 50,
            quantity: 1,
            availableStock: 5,
            locationId: UUID_LOCATION_A,
            taxRatePercent: 21,
          },
        ],
        subtotalArs: 50,
        selectedPaymentMethod: { id: UUID_PAYMENT_METHOD, requires_cash_session: false },
        dollarRate: 1000,
        getExchangeSnapshotFn: async () => UUID_SNAPSHOT,
        getPosCustomerFn: async () => UUID_CUSTOMER,
      });
      expect(newChargeBlocked.status).toBe("blocked");
      expect(newChargeBlocked.reason).toBe("financial_attempt_pending");
    });

    it("H5: uncertain retry reject permiso SIGUE uncertain", async () => {
      const coordinator = new PosCoordinator({ organizationId: "org-1", branchId: UUID_BRANCH_A, locationId: UUID_LOCATION_A });

      await coordinator.coordinateCheckout({
        values: {
          branchId: UUID_BRANCH_A,
          locationId: UUID_LOCATION_A,
          paymentMethodId: UUID_PAYMENT_METHOD,
          invoiceKind: "fiscal",
          customerName: "Cliente 1",
        },
        cart: [
          {
            key: "k1",
            productId: UUID_PRODUCT_1,
            displayName: "Item 1",
            priceArs: 100,
            quantity: 1,
            availableStock: 5,
            locationId: UUID_LOCATION_A,
            taxRatePercent: 21,
          },
        ],
        subtotalArs: 100,
        selectedPaymentMethod: { id: UUID_PAYMENT_METHOD, requires_cash_session: false },
        dollarRate: 1000,
        getExchangeSnapshotFn: async () => UUID_SNAPSHOT,
        getPosCustomerFn: async () => UUID_CUSTOMER,
        submitPreparedSaleFn: async () => {
          throw new Error("Network timeout");
        },
      });

      expect(coordinator.getFinancialAttempt()?.status).toBe("uncertain");
      expect(coordinator.getFinancialAttempt()?.uncertaintyHistory.length).toBe(1);

      // Retry fails with permission rejection
      const permErr = new Error("sales.create permission is required");
      (permErr as any).code = "42501";

      const retryRes = await coordinator.retryUncertainSale({
        submitPreparedSaleFn: async () => {
          throw permErr;
        },
      });

      expect(retryRes.status).toBe("error");
      const attempt = coordinator.getFinancialAttempt();
      expect(attempt?.status).toBe("uncertain");
      expect(attempt?.uncertaintyHistory.length).toBe(2);
      expect(attempt?.uncertaintyHistory[1].code).toBe("42501");
    });

    it("H6: org switch durante CADA preflight cero RPC sale", async () => {
      const baseInput = {
        values: {
          branchId: UUID_BRANCH_A,
          locationId: UUID_LOCATION_A,
          paymentMethodId: UUID_PAYMENT_METHOD,
          invoiceKind: "fiscal" as const,
          customerName: "Cliente 1",
        },
        cart: [
          {
            key: "k1",
            productId: UUID_PRODUCT_1,
            displayName: "Item 1",
            priceArs: 100,
            quantity: 1,
            availableStock: 5,
            locationId: UUID_LOCATION_A,
            taxRatePercent: 21,
          },
        ],
        subtotalArs: 100,
        selectedPaymentMethod: { id: UUID_PAYMENT_METHOD, requires_cash_session: true },
        dollarRate: 1000,
      };

      // 6a: Switch during snapshot
      const coordinatorA = new PosCoordinator({ organizationId: "org-1", branchId: UUID_BRANCH_A, locationId: UUID_LOCATION_A });
      const submitFnA = vi.fn();
      const custFnA = vi.fn();
      const resA = await coordinatorA.coordinateCheckout({
        ...baseInput,
        getExchangeSnapshotFn: async () => {
          coordinatorA.notifyContextChanged({ organizationId: "org-2", branchId: UUID_BRANCH_B, locationId: UUID_LOCATION_B });
          return UUID_SNAPSHOT;
        },
        getPosCustomerFn: custFnA,
        getCashSessionFn: async () => UUID_CASH_SESSION,
        submitPreparedSaleFn: submitFnA,
      });
      expect(resA.status).toBe("aborted");
      expect(custFnA).not.toHaveBeenCalled();
      expect(submitFnA).not.toHaveBeenCalled();

      // 6b: Switch during customer
      const coordinatorB = new PosCoordinator({ organizationId: "org-1", branchId: UUID_BRANCH_A, locationId: UUID_LOCATION_A });
      const submitFnB = vi.fn();
      const cashFnB = vi.fn();
      const resB = await coordinatorB.coordinateCheckout({
        ...baseInput,
        getExchangeSnapshotFn: async () => UUID_SNAPSHOT,
        getPosCustomerFn: async () => {
          coordinatorB.notifyContextChanged({ organizationId: "org-2", branchId: UUID_BRANCH_B, locationId: UUID_LOCATION_B });
          return UUID_CUSTOMER;
        },
        getCashSessionFn: cashFnB,
        submitPreparedSaleFn: submitFnB,
      });
      expect(resB.status).toBe("aborted");
      expect(cashFnB).not.toHaveBeenCalled();
      expect(submitFnB).not.toHaveBeenCalled();

      // 6c: Switch during cash session
      const coordinatorC = new PosCoordinator({ organizationId: "org-1", branchId: UUID_BRANCH_A, locationId: UUID_LOCATION_A });
      const submitFnC = vi.fn();
      const resC = await coordinatorC.coordinateCheckout({
        ...baseInput,
        getExchangeSnapshotFn: async () => UUID_SNAPSHOT,
        getPosCustomerFn: async () => UUID_CUSTOMER,
        getCashSessionFn: async () => {
          coordinatorC.notifyContextChanged({ organizationId: "org-2", branchId: UUID_BRANCH_B, locationId: UUID_LOCATION_B });
          return UUID_CASH_SESSION;
        },
        submitPreparedSaleFn: submitFnC,
      });
      expect(resC.status).toBe("aborted");
      expect(submitFnC).not.toHaveBeenCalled();
    });

    it("H7: switch post dispatch success preserva ticket A / no borra cart B", async () => {
      const coordinator = new PosCoordinator({ organizationId: "org-A", branchId: UUID_BRANCH_A, locationId: UUID_LOCATION_A });
      const rpcDeferred = createDeferred<any>();
      const onClearCart = vi.fn();

      const checkoutPromise = coordinator.coordinateCheckout({
        values: {
          branchId: UUID_BRANCH_A,
          locationId: UUID_LOCATION_A,
          paymentMethodId: UUID_PAYMENT_METHOD,
          invoiceKind: "fiscal",
          customerName: "Cliente A",
        },
        cart: [
          {
            key: "item-A",
            productId: UUID_PRODUCT_1,
            displayName: "Item A",
            priceArs: 100,
            quantity: 1,
            availableStock: 5,
            locationId: UUID_LOCATION_A,
            taxRatePercent: 21,
          },
        ],
        subtotalArs: 100,
        selectedPaymentMethod: { id: UUID_PAYMENT_METHOD, requires_cash_session: false },
        dollarRate: 1000,
        getExchangeSnapshotFn: async () => UUID_SNAPSHOT,
        getPosCustomerFn: async () => UUID_CUSTOMER,
        submitPreparedSaleFn: () => {
          // POST-DISPATCH context switch:
          coordinator.notifyContextChanged({ organizationId: "org-B", branchId: UUID_BRANCH_B, locationId: UUID_LOCATION_B });
          coordinator.notifyCartModified();
          return rpcDeferred.promise;
        },
        onClearCart,
      });

      // RPC finishes successfully
      rpcDeferred.resolve({
        saleId: "sale-A",
        documentId: "doc-A",
        documentNumber: "FC-A-001",
        invoiceKind: "fiscal",
      });
      const res = await checkoutPromise;
      expect(res.status).toBe("completed");

      // Ticket A is confirmed and preserved in coordinator
      const attempt = coordinator.getFinancialAttempt();
      expect(attempt?.status).toBe("confirmed");
      expect(attempt?.origin.organizationId).toBe("org-A");
      expect(attempt?.saleResult?.documentNumber).toBe("FC-A-001");

      // Cart B was NOT cleared!
      expect(onClearCart).not.toHaveBeenCalled();
    });

    it("H8: RPC success + receipt/callback error SIGUE confirmed, no repeat", async () => {
      const coordinator = new PosCoordinator({ organizationId: "org-1", branchId: UUID_BRANCH_A, locationId: UUID_LOCATION_A });
      let rpcCallCount = 0;

      const res = await coordinator.coordinateCheckout({
        values: {
          branchId: UUID_BRANCH_A,
          locationId: UUID_LOCATION_A,
          paymentMethodId: UUID_PAYMENT_METHOD,
          invoiceKind: "fiscal",
          customerName: "Cliente 1",
        },
        cart: [
          {
            key: "k1",
            productId: UUID_PRODUCT_1,
            displayName: "Item 1",
            priceArs: 100,
            quantity: 1,
            availableStock: 5,
            locationId: UUID_LOCATION_A,
            taxRatePercent: 21,
          },
        ],
        subtotalArs: 100,
        selectedPaymentMethod: { id: UUID_PAYMENT_METHOD, requires_cash_session: false },
        dollarRate: 1000,
        getExchangeSnapshotFn: async () => UUID_SNAPSHOT,
        getPosCustomerFn: async () => UUID_CUSTOMER,
        submitPreparedSaleFn: async () => {
          rpcCallCount++;
          return {
            saleId: "s-1",
            documentId: "d-1",
            documentNumber: "FC-001",
            invoiceKind: "fiscal",
          };
        },
        getDocumentSaleReceiptFn: async () => {
          throw new Error("Receipt fetch network error");
        },
      });

      expect(res.status).toBe("completed");
      expect(rpcCallCount).toBe(1);
      const attempt = coordinator.getFinancialAttempt();
      expect(attempt?.status).toBe("confirmed");
      expect(attempt?.saleResult?.documentNumber).toBe("FC-001");
    });

    it("H9: fetch activo block checkout/requote, latest queued autofetch no perdida", async () => {
      const coordinator = new PosCoordinator({ organizationId: "org-1", branchId: UUID_BRANCH_A, locationId: UUID_LOCATION_A });
      const fetchToken = coordinator.beginFetch();
      expect(fetchToken).not.toBeNull();
      expect(coordinator.isFetchActive()).toBe(true);

      const checkoutBlocked = coordinator.beginCheckout();
      expect(checkoutBlocked.ok).toBe(false);
      expect(checkoutBlocked.reason).toBe("fetch_in_progress");

      const requoteBlocked = coordinator.beginRequote();
      expect(requoteBlocked.ok).toBe(false);
      expect(requoteBlocked.reason).toBe("fetch_in_progress");

      const runs: string[] = [];
      coordinator.requestAutoFetch(async () => {
        runs.push("autofetch-1");
      });
      coordinator.requestAutoFetch(async () => {
        runs.push("autofetch-2-latest");
      });

      coordinator.endFetch(fetchToken!);
      expect(runs).toContain("autofetch-2-latest");
    });

    it("H10: late valid confirmation despacho timed out gana; error tardíos no degradan", async () => {
      const coordinator = new PosCoordinator({ organizationId: "org-1", branchId: UUID_BRANCH_A, locationId: UUID_LOCATION_A });

      await coordinator.coordinateCheckout({
        values: {
          branchId: UUID_BRANCH_A,
          locationId: UUID_LOCATION_A,
          paymentMethodId: UUID_PAYMENT_METHOD,
          invoiceKind: "fiscal",
          customerName: "Cliente 1",
        },
        cart: [
          {
            key: "k1",
            productId: UUID_PRODUCT_1,
            displayName: "Item 1",
            priceArs: 100,
            quantity: 1,
            availableStock: 5,
            locationId: UUID_LOCATION_A,
            taxRatePercent: 21,
          },
        ],
        subtotalArs: 100,
        selectedPaymentMethod: { id: UUID_PAYMENT_METHOD, requires_cash_session: false },
        dollarRate: 1000,
        getExchangeSnapshotFn: async () => UUID_SNAPSHOT,
        getPosCustomerFn: async () => UUID_CUSTOMER,
        submitPreparedSaleFn: async () => {
          throw new Error("HTTP 504 Gateway Timeout");
        },
      });

      expect(coordinator.getFinancialAttempt()?.status).toBe("uncertain");

      // Late valid confirmation arrives!
      coordinator.recordLateConfirmation({
        saleId: "s-late",
        documentId: "d-late",
        documentNumber: "FC-LATE-01",
        invoiceKind: "fiscal",
      });
      expect(coordinator.getFinancialAttempt()?.status).toBe("confirmed");

      // Subsequent late network error arrives: MUST NOT degrade confirmed!
      coordinator.recordLateError(new Error("Late ECONNRESET"));
      expect(coordinator.getFinancialAttempt()?.status).toBe("confirmed");
    });
  });
});
