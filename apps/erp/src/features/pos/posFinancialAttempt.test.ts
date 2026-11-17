import { describe, expect, it, vi } from "vitest";
import { PosCoordinator, classifyRpcError, SERVER_STALE_QUOTE_MARKER, type CoordinateCheckoutParams } from "./posCoordinator";
import type { CreateSaleWithInvoiceResult } from "./api";

const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const origin = { organizationId: "org-a", branchId: id("1"), locationId: id("2") };
const result: CreateSaleWithInvoiceResult = { saleId: id("7"), documentId: id("8"), documentNumber: "F-1", invoiceKind: "fiscal" };
const cart = [{ key: "k", productId: id("3"), displayName: "Producto", priceArs: 100.005,
  quantity: 3, availableStock: 10, taxRatePercent: 21, locationId: origin.locationId }];
const prepare = (extra: CoordinateCheckoutParams = {}): CoordinateCheckoutParams => ({
  values: { branchId: origin.branchId, locationId: origin.locationId, paymentMethodId: id("4"), customerName: "Cliente", invoiceKind: "fiscal" },
  cart, subtotalArs: 300.015, selectedPaymentMethod: { id: id("4"), requires_cash_session: false },
  getExchangeSnapshotFn: vi.fn(async () => id("5")), getPosCustomerFn: vi.fn(async () => id("6")),
  submitPreparedSaleFn: vi.fn(async () => result), getDocumentSaleReceiptFn: vi.fn(async () => null), ...extra,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { resolve, promise };
}

describe("financial attempt production pipeline", () => {
  it.each(["first", "retry"])("never degrades confirmation when %s-path UI callbacks fail", async (path) => {
    const coordinator = new PosCoordinator(origin);
    const clear = vi.fn();
    const receipt = vi.fn(async () => {
      expect(coordinator.getFinancialAttempt()?.status).toBe("confirmed");
      return null;
    });
    const onConfirmed = vi.fn(() => { throw new Error("confirmation UI failed"); });
    const onSuccess = vi.fn(() => { throw new Error("ticket UI failed"); });
    let completed;
    if (path === "first") {
      completed = await coordinator.coordinateCheckout(prepare({ onConfirmed, onSuccess,
        onClearCart: clear, getDocumentSaleReceiptFn: receipt }));
    } else {
      await coordinator.coordinateCheckout(prepare({ submitPreparedSaleFn: async () => { throw new Error("Network timeout"); } }));
      completed = await coordinator.retryUncertainSale({ submitPreparedSaleFn: async () => result,
        getDocumentSaleReceiptFn: receipt, onConfirmed, onSuccess, onClearCart: clear });
    }
    expect(completed.status).toBe("completed");
    expect(coordinator.getFinancialAttempt()?.status).toBe("confirmed");
    expect(receipt).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(coordinator.isIdle()).toBe(true);
  });

  it("requote advances the draft revision while keeping exact retry args frozen and the recotized draft intact", async () => {
    const coordinator = new PosCoordinator(origin);
    const params = prepare({ submitPreparedSaleFn: async () => { throw new Error("Network timeout"); } });
    await coordinator.coordinateCheckout(params);
    const attempt = coordinator.getFinancialAttempt()!;
    const revision = coordinator.getCartRevision();
    const apply = vi.fn();
    await coordinator.coordinateRequote({ cart,
      fetchCatalog: async () => [{ id: id("3"), name: "Producto", priceArs: 200, taxRatePercent: 21, stock: 8, hasVariants: false }],
      onApplyCart: apply, onApplyFeedback: vi.fn(), onSetStaleQuoteDetected: vi.fn() });
    expect(apply.mock.calls[0][0][0].priceArs).toBe(200);
    expect(coordinator.getCartRevision()).toBe(revision + 1);
    const clear = vi.fn();
    await coordinator.retryUncertainSale({ submitPreparedSaleFn: async (args) => {
      expect(args).toBe(attempt.args);
      expect(Object.isFrozen(args)).toBe(true);
      expect(Object.isFrozen(args.lines)).toBe(true);
      expect(args.sale_currency).toBe("ARS");
      expect(args.target_exchange_snapshot_id).toBe(id("5"));
      expect(args.operation_reason).toBe("Venta Mostrador POS - Cliente");
      return result;
    }, getDocumentSaleReceiptFn: async () => null, onClearCart: clear });
    expect(clear).not.toHaveBeenCalled();
    expect(params.getExchangeSnapshotFn).toHaveBeenCalledOnce();
    expect(params.getPosCustomerFn).toHaveBeenCalledOnce();
    expect(coordinator.getFinancialAttempt()?.uncertaintyHistory).toHaveLength(1);
  });

  it("retains uncertainty/history even when retry returns the definitive stale marker", async () => {
    const coordinator = new PosCoordinator(origin);
    await coordinator.coordinateCheckout(prepare({ submitPreparedSaleFn: async () => { throw new Error("Network timeout"); } }));
    await coordinator.retryUncertainSale({ submitPreparedSaleFn: async () => {
      throw { code: "23514", message: "stale quote: catalog price or tax rate has changed, requote required" };
    } });
    expect(coordinator.getFinancialAttempt()?.status).toBe("uncertain");
    expect(coordinator.getFinancialAttempt()?.uncertaintyHistory).toHaveLength(2);
    expect(coordinator.beginCheckout().reason).toBe("financial_attempt_pending");
  });

  it("a valid late confirmation cannot be degraded by a later rejection of the outstanding dispatch", async () => {
    const coordinator = new PosCoordinator(origin);
    let reject!: (error: unknown) => void;
    const response = new Promise<CreateSaleWithInvoiceResult>((_resolve, fail) => { reject = fail; });
    const submit = vi.fn(() => response);
    const confirmed = vi.fn();
    const running = coordinator.coordinateCheckout(prepare({ submitPreparedSaleFn: submit, onConfirmed: confirmed }));
    while (!submit.mock.calls.length) await Promise.resolve();
    coordinator.recordLateConfirmation(result);
    reject(new Error("Network timeout"));
    expect((await running).status).toBe("completed");
    expect(confirmed).toHaveBeenCalledWith(result);
    expect(coordinator.getFinancialAttempt()?.status).toBe("confirmed");
  });

  it.each(["snapshot", "customer", "cash"])("fences A→B→A during %s preparation before dispatch", async (stage) => {
    const coordinator = new PosCoordinator(origin);
    const pending = deferred<string>();
    const submit = vi.fn(async () => result);
    const params = prepare({ selectedPaymentMethod: { id: id("4"), requires_cash_session: true },
      getCashSessionFn: vi.fn(async () => id("9")), submitPreparedSaleFn: submit });
    const getter = stage === "snapshot" ? "getExchangeSnapshotFn" : stage === "customer" ? "getPosCustomerFn" : "getCashSessionFn";
    const entered = vi.fn(() => pending.promise);
    params[getter] = entered;
    const running = coordinator.coordinateCheckout(params);
    while (!entered.mock.calls.length) await Promise.resolve();
    coordinator.notifyContextChanged({ ...origin, organizationId: "org-b" });
    coordinator.notifyContextChanged(origin);
    pending.resolve(id("9"));
    expect((await running).status).toBe("aborted");
    expect(submit).not.toHaveBeenCalled();
    expect(coordinator.isIdle()).toBe(true);
  });

  it("retains origin confirmation after post-dispatch org change without reading another tenant or erasing its draft", async () => {
    const coordinator = new PosCoordinator(origin);
    const pending = deferred<CreateSaleWithInvoiceResult>();
    const submit = vi.fn(() => pending.promise), clear = vi.fn(), receipt = vi.fn(async () => null);
    const running = coordinator.coordinateCheckout(prepare({ submitPreparedSaleFn: submit,
      getDocumentSaleReceiptFn: receipt, onClearCart: clear }));
    while (!submit.mock.calls.length) await Promise.resolve();
    coordinator.notifyContextChanged({ ...origin, organizationId: "org-b" });
    coordinator.notifyCartModified();
    pending.resolve(result); await running;
    expect(coordinator.getFinancialAttempt()?.status).toBe("confirmed");
    expect(coordinator.getFinancialAttempt()?.origin.organizationId).toBe("org-a");
    expect(clear).not.toHaveBeenCalled(); expect(receipt).not.toHaveBeenCalled();
  });

  it.each(["500", "502", "503", "504", "408", "08007", "40003", "ECONNREFUSED"])("keeps ambiguous %s errors uncertain", (code) => {
    expect(classifyRpcError({ code, message: "Request failed" }).phase).toBe("rpc_uncertain");
  });
  it("does not infer stale quote from arbitrary 23514 errors or an unstructured stale message", () => {
    expect(classifyRpcError({ code: "23514", message: "discount out of bounds" }).rejectionReason).toBe("other");
    expect(classifyRpcError({ message: "stale quote: catalog price or tax rate has changed, requote required" }).phase).toBe("rpc_uncertain");
  });
  it.each([
    { message: `Previous error: ${SERVER_STALE_QUOTE_MARKER}` },
    { message: `${SERVER_STALE_QUOTE_MARKER}; previous request` },
    { message: SERVER_STALE_QUOTE_MARKER.toUpperCase() },
    { message: "discount out of bounds", details: SERVER_STALE_QUOTE_MARKER },
  ])("requires the exact server message for stale quote: %j", (error) => {
    expect(classifyRpcError({ code: "23514", ...error }).rejectionReason).toBe("other");
  });
});
