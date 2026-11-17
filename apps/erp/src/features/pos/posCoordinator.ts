import type { CartItemToSync, CatalogProductForSync } from "./pricing";
import { executePosRequoteFlow, type PosRequoteFlowResult } from "./posRequoteFlow";
import {
  buildCreateSaleWithInvoiceRpcArgs,
  submitPreparedSale,
  type CreateSaleWithInvoiceResult,
  type CreateSaleWithInvoiceRpcArgs,
} from "./api";
import { getDocumentSaleReceipt } from "../documents/api";
import { buildPosPaymentLines, calculateGrossTaxBreakdown } from "./pricing";
import type { InvoiceKind, PosInvoiceSaleInput } from "./types";
import type { DocumentSaleReceipt } from "../../types/DocumentSaleReceipt";

export const SERVER_STALE_QUOTE_MARKER = "stale quote: catalog price or tax rate has changed, requote required";

export interface PosContextSnapshot {
  organizationId: string | null;
  branchId: string;
  locationId: string;
}

export type PosOperationKind = "idle" | "fetch" | "requote" | "checkout";

export type PosOperationState =
  | { kind: "idle" }
  | {
      kind: "fetch" | "requote" | "checkout";
      token: number;
      contextRevision: number;
      cartRevision: number;
    };

export type FinancialAttemptStatus =
  | "none"
  | "preparing"
  | "dispatched"
  | "uncertain"
  | "rejected"
  | "confirmed";

export interface FinancialAttemptOrigin {
  organizationId: string | null;
  branchId: string;
  locationId: string;
  contextRevision: number;
  cartRevision: number;
}

export interface FinancialUncertaintyEntry {
  timestamp: number;
  message: string;
  code?: string;
  details?: string;
}

export interface FinancialAttempt {
  id: string;
  status: FinancialAttemptStatus;
  origin: FinancialAttemptOrigin;
  args: CreateSaleWithInvoiceRpcArgs;
  input: PosInvoiceSaleInput;
  uncertaintyHistory: FinancialUncertaintyEntry[];
  rejectionReason?: "stale_quote" | "other";
  rejectionError?: string;
  saleResult?: CreateSaleWithInvoiceResult;
  ticketReceipt?: DocumentSaleReceipt | null;
  recoveryLoading?: boolean;
  recoveryError?: string | null;
}

export type PosErrorPhase =
  | "preflight_failure"
  | "rpc_definitive_rejection"
  | "rpc_uncertain"
  | "confirmed_receipt_pending";

export interface NormalizedPosError {
  message: string;
  code?: string;
  details?: string;
  isStaleQuote: boolean;
}

export interface PosPhaseError extends NormalizedPosError {
  phase: PosErrorPhase;
  rejectionReason?: "stale_quote" | "other";
}

function presentationEffect(run: () => void): void {
  try { run(); } catch { return; }
}

export function isServerStaleQuoteMessage(msg?: string): boolean {
  return msg === SERVER_STALE_QUOTE_MARKER;
}

export function normalizePosError(err: unknown): NormalizedPosError {
  let message = "Error inesperado";
  let code: string | undefined;
  let details: string | undefined;

  if (err instanceof Error) {
    message = err.message;
    if ("code" in err && (typeof err.code === "string" || typeof err.code === "number")) {
      code = String(err.code);
    }
    if ("details" in err && typeof err.details === "string") {
      details = err.details;
    }
  } else if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === "string") {
      message = rec.message;
    }
    if (typeof rec.code === "string" || typeof rec.code === "number") {
      code = String(rec.code);
    }
    if (typeof rec.details === "string") {
      details = rec.details;
    }
  } else if (typeof err === "string") {
    message = err;
  }

  const isStaleQuote = isServerStaleQuoteMessage(message);
  return { message, code, details, isStaleQuote };
}

export function classifyRpcError(err: unknown): {
  phase: "rpc_definitive_rejection" | "rpc_uncertain";
  rejectionReason?: "stale_quote" | "other";
  normalized: NormalizedPosError;
} {
  const normalized = normalizePosError(err);
  const msgLower = (normalized.message || "").toLowerCase();

  const isNetworkOrTimeout =
    msgLower.includes("timeout") ||
    msgLower.includes("aborted") ||
    msgLower.includes("failed to fetch") ||
    msgLower.includes("network") ||
    msgLower.includes("econnreset") ||
    msgLower.includes("etimedout") ||
    msgLower.includes("gateway") ||
    normalized.code === "504" ||
    normalized.code === "502" ||
    normalized.code === "503";

  if (isNetworkOrTimeout) {
    return { phase: "rpc_uncertain", normalized };
  }

  if (normalized.code === "23514" && normalized.isStaleQuote) {
    return { phase: "rpc_definitive_rejection", rejectionReason: "stale_quote", normalized };
  }

  const isPostgresCode = Boolean(normalized.code) &&
    /^(?:0[0-9A-Z]|[12][0-9A-Z]|[345][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(normalized.code!) &&
    !normalized.code!.startsWith("08") && normalized.code !== "40003";

  if (isPostgresCode) {
    return { phase: "rpc_definitive_rejection", rejectionReason: "other", normalized };
  }

  return { phase: "rpc_uncertain", normalized };
}

export interface BeginOperationResult {
  ok: boolean;
  token?: number;
  reason?: "checkout_in_progress" | "requote_in_progress" | "fetch_in_progress" | "financial_attempt_pending";
  error?: string;
}

export interface CoordinateRequoteParams<T extends CartItemToSync> {
  context?: PosContextSnapshot;
  cart: T[];
  fetchCatalog: (requoteToken?: number) => Promise<CatalogProductForSync[] | null>;
  onApplyCart: (cart: T[]) => void;
  onApplyFeedback: (feedback: { type: "success" | "error"; message: string }) => void;
  onSetStaleQuoteDetected: (stale: boolean) => void;
  onSetLoading?: (loading: boolean) => void;
}

export interface CoordinateRequoteResult<T extends CartItemToSync> {
  status: "success" | "error" | "blocked" | "discarded";
  reason?: string;
  updatedCart?: T[];
  error?: string;
}

export interface PosSaleCartItem {
  key: string;
  productId: string;
  variantId?: string | null;
  displayName: string;
  priceArs: number;
  quantity: number;
  availableStock: number;
  locationId: string;
  inventoryUnitId?: string | null;
  taxRatePercent: number;
}

export interface CoordinateCheckoutParams<TResult = unknown> {
  // Authoritative Astra fields:
  values?: {
    branchId: string;
    locationId: string;
    paymentMethodId: string;
    invoiceKind: InvoiceKind;
    customerName: string;
  };
  cart?: PosSaleCartItem[];
  subtotalArs?: number;
  selectedPaymentMethod?: {
    id: string;
    requires_cash_session: boolean;
  };
  dollarRate?: number | null;

  // Injectable API functions:
  getExchangeSnapshotFn?: (quoteCurrency: string) => Promise<string>;
  getPosCustomerFn?: (displayName: string) => Promise<string>;
  getCashSessionFn?: (branchId: string) => Promise<string>;
  submitPreparedSaleFn?: (args: CreateSaleWithInvoiceRpcArgs) => Promise<CreateSaleWithInvoiceResult>;
  getDocumentSaleReceiptFn?: (documentId: string) => Promise<DocumentSaleReceipt | null>;

  // Legacy executeSale wrapper fallback (for compatibility with simple unit tests):
  executeSale?: () => Promise<TResult>;

  // Callbacks:
  onSuccess?: (saleResult: TResult | CreateSaleWithInvoiceResult, receipt?: DocumentSaleReceipt | null) => void;
  onConfirmed?: (saleResult: CreateSaleWithInvoiceResult) => void;
  onError?: (error: string | PosPhaseError) => void;
  onClearCart?: () => void;
  onClearOperationKey?: () => void;
  onSetStaleQuoteDetected?: (stale: boolean) => void;
  onSetSubmittingSale?: (submitting: boolean) => void;
  onAfterSaleFetch?: () => void;
}

export interface CoordinateCheckoutResult<TResult = unknown> {
  status: "completed" | "error" | "blocked" | "aborted";
  reason?: string;
  saleResult?: TResult | CreateSaleWithInvoiceResult;
  receipt?: DocumentSaleReceipt | null;
  error?: string;
}

export interface RetryUncertainSaleParams {
  submitPreparedSaleFn?: (args: CreateSaleWithInvoiceRpcArgs) => Promise<CreateSaleWithInvoiceResult>;
  getDocumentSaleReceiptFn?: (documentId: string) => Promise<DocumentSaleReceipt | null>;
  onSuccess?: (saleResult: CreateSaleWithInvoiceResult, receipt: DocumentSaleReceipt | null) => void;
  onConfirmed?: (saleResult: CreateSaleWithInvoiceResult) => void;
  onError?: (error: PosPhaseError) => void;
  onSetSubmittingSale?: (submitting: boolean) => void;
  onClearCart?: () => void;
  onAfterSaleFetch?: () => void;
}

/**
 * Authoritative POS Synchronous Flow Coordinator.
 *
 * Implements Astra Executable Contract:
 * - Clear separation between UI operation (idle | fetch | requote | checkout) and Financial Attempt (none | preparing | dispatched | uncertain | rejected | confirmed).
 * - Full immutable payload with deep clone and freeze.
 * - Preparation fence validating owner + current context + monotonic revisions before every preflight and dispatch.
 * - Single finalizer resetting submittingSale BEFORE freeing token or draining autofetch.
 * - Retry uses exact same args and key; zero preflight / recalculation.
 * - Queued auto-fetch (length 1) with context validation.
 */
export class PosCoordinator {
  private activeOperation: PosOperationState = { kind: "idle" };
  private operationTokenCounter = 0;
  private cartRevision = 0;
  private contextRevision = 0;
  private loadedContextRevision: number | null = null;
  private pendingAutoFetch: {
    runner: (token: number) => Promise<void>;
    contextRevision: number;
    organizationId: string | null;
  } | null = null;
  private currentContext: PosContextSnapshot = {
    organizationId: null,
    branchId: "",
    locationId: "",
  };
  private currentFinancialAttempt: FinancialAttempt | null = null;

  constructor(initialContext?: PosContextSnapshot) {
    if (initialContext) {
      this.currentContext = { ...initialContext };
    }
  }

  public getCurrentContext(): PosContextSnapshot {
    return { ...this.currentContext };
  }

  public getContextRevision(): number {
    return this.contextRevision;
  }

  public getCartVersion(): number {
    return this.cartRevision;
  }

  public getCartRevision(): number {
    return this.cartRevision;
  }

  public isIdle(): boolean {
    return this.activeOperation.kind === "idle";
  }

  public isCheckoutActive(): boolean {
    return this.activeOperation.kind === "checkout";
  }

  public isRequoteActive(): boolean {
    return this.activeOperation.kind === "requote";
  }

  public isFetchActive(): boolean {
    return this.activeOperation.kind === "fetch";
  }

  public getActiveRequoteToken(): number | null {
    return this.activeOperation.kind === "requote" ? this.activeOperation.token : null;
  }

  public getActiveOperation(): PosOperationState {
    return { ...this.activeOperation };
  }

  public isContextLoaded(): boolean {
    return this.loadedContextRevision !== null && this.loadedContextRevision === this.contextRevision;
  }

  public markContextLoaded(): void {
    this.loadedContextRevision = this.contextRevision;
  }

  public notifyCartModified(): void {
    this.cartRevision++;
  }

  public notifyCartCleared(): void {
    this.cartRevision++;
  }

  public notifyContextChanged(newContext: PosContextSnapshot): void {
    if (
      this.currentContext.organizationId !== newContext.organizationId ||
      this.currentContext.branchId !== newContext.branchId ||
      this.currentContext.locationId !== newContext.locationId
    ) {
      this.currentContext = { ...newContext };
      this.contextRevision++;
      // Critical: changing org/context does NOT eliminate an unresolved financial attempt!
    }
  }

  public notifySaleCompleted(): void {
    this.cartRevision++;
    this.operationTokenCounter++;
    this.activeOperation = { kind: "idle" };
    this.drainPendingAutoFetch();
  }

  public getFinancialAttempt(): FinancialAttempt | null {
    return this.currentFinancialAttempt ? { ...this.currentFinancialAttempt } : null;
  }

  public clearFinancialAttempt(): void {
    if (this.currentFinancialAttempt && ["dispatched", "uncertain", "preparing"].includes(this.currentFinancialAttempt.status)) return;
    this.currentFinancialAttempt = null;
  }

  public recordLateConfirmation(saleResult: CreateSaleWithInvoiceResult): void {
    if (this.currentFinancialAttempt) {
      this.currentFinancialAttempt.status = "confirmed";
      this.currentFinancialAttempt.saleResult = saleResult;
    }
  }

  public recordLateError(_err: unknown): void {
    // If already confirmed, late errors NEVER degrade confirmation!
    if (this.currentFinancialAttempt && this.currentFinancialAttempt.status === "confirmed") {
      return;
    }
  }

  public requestAutoFetch(runner: (token: number) => Promise<void>): void {
    if (this.isIdle()) {
      const token = this.beginFetch();
      if (token !== null) {
        void runner(token);
      }
    } else {
      this.pendingAutoFetch = {
        runner,
        contextRevision: this.contextRevision,
        organizationId: this.currentContext.organizationId,
      };
    }
  }

  private drainPendingAutoFetch(): void {
    if (this.isIdle() && this.pendingAutoFetch) {
      const pending = this.pendingAutoFetch;
      this.pendingAutoFetch = null;
      if (
        this.contextRevision === pending.contextRevision &&
        this.currentContext.organizationId === pending.organizationId
      ) {
        const token = this.beginFetch();
        if (token !== null) {
          void pending.runner(token);
        }
      }
    }
  }

  public beginFetch(_context?: PosContextSnapshot, requoteToken?: number): number | null {
    if (requoteToken !== undefined) {
      if (this.activeOperation.kind === "requote" && this.activeOperation.token === requoteToken) {
        return requoteToken;
      }
      return null;
    }

    // Explicit contract: beginFetch does NOT replace an active fetch, checkout, or requote
    if (this.isCheckoutActive() || this.isRequoteActive() || this.isFetchActive()) {
      return null;
    }

    const token = ++this.operationTokenCounter;
    this.activeOperation = {
      kind: "fetch",
      token,
      contextRevision: this.contextRevision,
      cartRevision: this.cartRevision,
    };
    return token;
  }

  public isFetchValid(
    fetchToken: number,
    _unusedContext?: PosContextSnapshot,
    requoteToken?: number,
  ): boolean {
    if (requoteToken !== undefined) {
      return this.isRequoteValid(requoteToken);
    }
    if (this.activeOperation.kind !== "fetch" || this.activeOperation.token !== fetchToken) {
      return false;
    }
    if (this.activeOperation.contextRevision !== this.contextRevision) {
      return false;
    }
    return true;
  }

  public endFetch(fetchToken: number): void {
    if (this.activeOperation.kind === "fetch" && this.activeOperation.token === fetchToken) {
      this.activeOperation = { kind: "idle" };
      this.drainPendingAutoFetch();
    }
  }

  public beginRequote<T>(_context?: PosContextSnapshot, _cart?: T[]): BeginOperationResult {
    if (this.isCheckoutActive()) {
      return {
        ok: false,
        reason: "checkout_in_progress",
        error: "No se puede sincronizar precios mientras se procesa un cobro.",
      };
    }
    if (this.isRequoteActive()) {
      return {
        ok: false,
        reason: "requote_in_progress",
        error: "Ya hay una sincronización de precios en curso.",
      };
    }
    if (this.isFetchActive()) {
      return {
        ok: false,
        reason: "fetch_in_progress",
        error: "Hay una carga de catálogo en curso.",
      };
    }

    const token = ++this.operationTokenCounter;
    this.activeOperation = {
      kind: "requote",
      token,
      contextRevision: this.contextRevision,
      cartRevision: this.cartRevision,
    };
    return { ok: true, token };
  }

  public isRequoteValid(token: number, _unusedContext?: PosContextSnapshot): boolean {
    if (this.activeOperation.kind !== "requote" || this.activeOperation.token !== token) {
      return false;
    }
    if (this.activeOperation.contextRevision !== this.contextRevision) {
      return false;
    }
    if (this.activeOperation.cartRevision !== this.cartRevision) {
      return false;
    }
    return true;
  }

  public ownsRequote(token: number): boolean {
    return this.activeOperation.kind === "requote" && this.activeOperation.token === token;
  }

  public endRequote(token: number): void {
    if (this.activeOperation.kind === "requote" && this.activeOperation.token === token) {
      this.activeOperation = { kind: "idle" };
      this.drainPendingAutoFetch();
    }
  }

  public beginCheckout(): BeginOperationResult {
    if (this.isFetchActive()) {
      return {
        ok: false,
        reason: "fetch_in_progress",
        error: "Hay una carga de catálogo en curso. Espere a que finalice.",
      };
    }
    if (this.isRequoteActive()) {
      return {
        ok: false,
        reason: "requote_in_progress",
        error: "Hay una sincronización de precios en curso. Espere a que finalice.",
      };
    }
    if (this.isCheckoutActive()) {
      return {
        ok: false,
        reason: "checkout_in_progress",
        error: "Ya se está procesando un cobro.",
      };
    }

    // Check if there is an unresolved financial attempt in progress or uncertain
    if (
      this.currentFinancialAttempt &&
      (this.currentFinancialAttempt.status === "dispatched" || this.currentFinancialAttempt.status === "uncertain")
    ) {
      return {
        ok: false,
        reason: "financial_attempt_pending",
        error: "Hay una operación de cobro pendiente o incierta. Debe resolverla o reintentarla antes de iniciar una nueva venta.",
      };
    }

    const token = ++this.operationTokenCounter;
    this.activeOperation = {
      kind: "checkout",
      token,
      contextRevision: this.contextRevision,
      cartRevision: this.cartRevision,
    };
    return { ok: true, token };
  }

  public isCheckoutValid(token: number): boolean {
    return this.activeOperation.kind === "checkout" && this.activeOperation.token === token;
  }

  public endCheckout(token: number): void {
    if (this.activeOperation.kind === "checkout" && this.activeOperation.token === token) {
      this.activeOperation = { kind: "idle" };
      this.drainPendingAutoFetch();
    }
  }

  /**
   * Coordinated Requote Flow (Shared between production UI and tests)
   */
  public async coordinateRequote<T extends CartItemToSync>(
    params: CoordinateRequoteParams<T>,
  ): Promise<CoordinateRequoteResult<T>> {
    const {
      cart,
      fetchCatalog,
      onApplyCart,
      onApplyFeedback,
      onSetStaleQuoteDetected,
      onSetLoading,
    } = params;

    const beginRes = this.beginRequote(undefined, cart);
    if (!beginRes.ok) {
      onApplyFeedback({
        type: "error",
        message: beginRes.error || "Sincronización bloqueada",
      });
      return { status: "blocked", reason: beginRes.reason, error: beginRes.error };
    }

    const token = beginRes.token!;
    presentationEffect(() => onSetLoading?.(true));

    try {
      const result: PosRequoteFlowResult<T> = await executePosRequoteFlow({
        cart,
        fetchCatalog: () => fetchCatalog(token),
      });

      if (!this.isRequoteValid(token)) {
        return { status: "discarded", reason: "context_or_cart_invalidated" };
      }

      if (result.status === "success") {
        this.notifyCartModified();
        onApplyCart(result.updatedCart);
        onApplyFeedback({ type: "success", message: result.message });
        onSetStaleQuoteDetected(false);
        return { status: "success", updatedCart: result.updatedCart };
      } else {
        onApplyFeedback({ type: "error", message: result.error });
        return { status: "error", reason: result.reason, error: result.error };
      }
    } catch (err: unknown) {
      if (!this.isRequoteValid(token)) {
        return { status: "discarded", reason: "context_or_cart_invalidated" };
      }
      const normalized = normalizePosError(err);
      if (normalized.isStaleQuote) {
        onSetStaleQuoteDetected(true);
      }
      onApplyFeedback({ type: "error", message: normalized.message });
      return { status: "error", error: normalized.message };
    } finally {
      if (this.ownsRequote(token)) {
        presentationEffect(() => onSetLoading?.(false));
        this.endRequote(token);
      }
    }
  }

  /**
   * Coordinated Checkout Flow (Astra Contract)
   */
  public async coordinateCheckout<TResult = unknown>(
    params: CoordinateCheckoutParams<TResult>,
  ): Promise<CoordinateCheckoutResult<TResult>> {
    const {
      values,
      cart,
      subtotalArs = 0,
      selectedPaymentMethod,
      getExchangeSnapshotFn,
      getPosCustomerFn,
      getCashSessionFn,
      submitPreparedSaleFn = submitPreparedSale,
      getDocumentSaleReceiptFn = getDocumentSaleReceipt,
      executeSale,
      onSuccess,
      onConfirmed,
      onError,
      onClearCart,
      onClearOperationKey,
      onSetStaleQuoteDetected,
      onSetSubmittingSale,
      onAfterSaleFetch,
    } = params;

    // 1. Claim checkout token synchronously BEFORE ANY await
    const beginRes = this.beginCheckout();
    if (!beginRes.ok) {
      const msg = beginRes.error || "Cobro bloqueado";
      if (onError) {
        if (typeof onError === "function") {
          try {
            (onError as (err: PosPhaseError) => void)({
              phase: "preflight_failure",
              message: msg,
              isStaleQuote: false,
            });
          } catch {
            (onError as (err: string) => void)(msg);
          }
        }
      }
      return { status: "blocked", reason: beginRes.reason, error: beginRes.error };
    }

    const token = beginRes.token!;
    presentationEffect(() => onSetSubmittingSale?.(true));

    // If legacy executeSale is passed (for simple mock tests)
    if (executeSale && (!values || !cart || !selectedPaymentMethod)) {
      const capturedContextRevision =
        this.activeOperation.kind === "checkout"
          ? this.activeOperation.contextRevision
          : this.contextRevision;
      const capturedCartRevision =
        this.activeOperation.kind === "checkout"
          ? this.activeOperation.cartRevision
          : this.cartRevision;

      try {
        const saleResult = await executeSale();
        onSuccess?.(saleResult);
        onSetStaleQuoteDetected?.(false);

        const isOriginalAttempt =
          this.contextRevision === capturedContextRevision &&
          this.cartRevision === capturedCartRevision;

        if (isOriginalAttempt) {
          this.notifyCartCleared();
          onClearCart?.();
          onClearOperationKey?.();
          onAfterSaleFetch?.();
        }

        return { status: "completed", saleResult };
      } catch (err: unknown) {
        const classification = classifyRpcError(err);
        if (classification.normalized.isStaleQuote) {
          onSetStaleQuoteDetected?.(true);
        }
        if (onError) {
          (onError as (err: string) => void)(classification.normalized.message);
        }
        return { status: "error", error: classification.normalized.message };
      } finally {
        if (this.isCheckoutValid(token)) {
          presentationEffect(() => onSetSubmittingSale?.(false));
          this.endCheckout(token);
        }
      }
    }

    // Authoritative pipeline with preparation fences and deep frozen payload
    const origin: FinancialAttemptOrigin = {
      organizationId: this.currentContext.organizationId,
      branchId: values!.branchId,
      locationId: values!.locationId,
      contextRevision: this.contextRevision,
      cartRevision: this.cartRevision,
    };

    const isFenceValid = (): boolean => {
      return (
        this.activeOperation.kind === "checkout" &&
        this.activeOperation.token === token &&
        this.currentContext.organizationId === origin.organizationId &&
        this.currentContext.branchId === origin.branchId &&
        this.currentContext.locationId === origin.locationId &&
        this.contextRevision === origin.contextRevision &&
        this.cartRevision === origin.cartRevision
      );
    };

    if (!isFenceValid()) {
      if (this.isCheckoutValid(token)) {
        presentationEffect(() => onSetSubmittingSale?.(false));
        this.endCheckout(token);
      }
      return { status: "aborted", reason: "context_or_cart_invalidated" };
    }

    try {
      // Preflight 1: Snapshot
      if (!getExchangeSnapshotFn) {
        throw new Error("getExchangeSnapshotFn is required for checkout preparation.");
      }
      let snapshotId: string;
      try {
        snapshotId = await getExchangeSnapshotFn("ARS");
      } catch (e: unknown) {
        if (!isFenceValid()) return { status: "aborted", reason: "context_or_cart_invalidated" };
        const norm = normalizePosError(e);
        const errObj: PosPhaseError = { ...norm, phase: "preflight_failure" };
        presentationEffect(() => onError?.(errObj));
        return { status: "error", error: norm.message };
      }
      if (!isFenceValid()) {
        return { status: "aborted", reason: "context_or_cart_invalidated" };
      }

      // Preflight 2: Customer
      if (!getPosCustomerFn) {
        throw new Error("getPosCustomerFn is required for checkout preparation.");
      }
      let customerId: string;
      try {
        customerId = await getPosCustomerFn(values!.customerName);
      } catch (e: unknown) {
        if (!isFenceValid()) return { status: "aborted", reason: "context_or_cart_invalidated" };
        const norm = normalizePosError(e);
        const errObj: PosPhaseError = { ...norm, phase: "preflight_failure" };
        presentationEffect(() => onError?.(errObj));
        return { status: "error", error: norm.message };
      }
      if (!isFenceValid()) {
        return { status: "aborted", reason: "context_or_cart_invalidated" };
      }

      // Preflight 3: Cash Session (if needed)
      let cashSessionId: string | null = null;
      if (subtotalArs > 0 && selectedPaymentMethod!.requires_cash_session) {
        if (!getCashSessionFn) {
          throw new Error("getCashSessionFn is required for cash payments.");
        }
        try {
          cashSessionId = await getCashSessionFn(values!.branchId);
        } catch (e: unknown) {
          if (!isFenceValid()) return { status: "aborted", reason: "context_or_cart_invalidated" };
          const norm = normalizePosError(e);
          const errObj: PosPhaseError = { ...norm, phase: "preflight_failure" };
          presentationEffect(() => onError?.(errObj));
          return { status: "error", error: norm.message };
        }
        if (!isFenceValid()) {
          return { status: "aborted", reason: "context_or_cart_invalidated" };
        }
      }

      // Build and validate full arguments
      const lines = cart!.map((item) => {
        const breakdown = calculateGrossTaxBreakdown(item.priceArs, item.quantity, item.taxRatePercent);
        return {
          kind: "product" as const,
          product_id: item.productId,
          variant_id: item.variantId || null,
          inventory_unit_id: item.inventoryUnitId || null,
          from_location_id: item.locationId,
          description: item.displayName,
          quantity: item.quantity,
          unit_price: item.priceArs,
          expected_unit_price: item.priceArs,
          expected_tax_rate: item.taxRatePercent,
          unit_gross_price: item.priceArs,
          discount_amount: 0,
          gross_discount_amount: 0,
          tax_rate_percent: item.taxRatePercent,
          tax_amount: breakdown.taxAmount,
        };
      });

      const paymentLines = buildPosPaymentLines(
        subtotalArs,
        selectedPaymentMethod!.id,
        cashSessionId,
        "ARS",
      );

      const opKey = `pos-${crypto.randomUUID()}`;
      const saleInput: PosInvoiceSaleInput = {
        branchId: values!.branchId,
        customerId,
        currency: "ARS",
        exchangeSnapshotId: snapshotId,
        operationKey: opKey,
        reason: `Venta Mostrador POS - ${values!.customerName}`,
        invoiceKind: values!.invoiceKind,
        lines,
        paymentLines,
      };

      const rpcArgs = buildCreateSaleWithInvoiceRpcArgs(saleInput);

      if (!isFenceValid()) {
        return { status: "aborted", reason: "context_or_cart_invalidated" };
      }

      // Persist attempt & mark dispatched immediately before invoking RPC
      const attempt: FinancialAttempt = {
        id: opKey,
        status: "dispatched",
        origin,
        args: rpcArgs,
        input: saleInput,
        uncertaintyHistory: [],
      };
      this.currentFinancialAttempt = attempt;

      // Invoke RPC directly without intermediate await
      let saleResult: CreateSaleWithInvoiceResult;
      try {
        saleResult = await submitPreparedSaleFn(attempt.args);
      } catch (rpcErr: unknown) {
        if (this.getFinancialAttempt()?.status === "confirmed" && attempt.saleResult) {
          return await this.confirmAttempt(attempt, attempt.saleResult, {
            getReceipt: getDocumentSaleReceiptFn, onConfirmed, onSuccess, onClearCart,
            onClearOperationKey, onSetStaleQuoteDetected, onAfterSaleFetch,
          });
        }
        const classification = classifyRpcError(rpcErr);
        if (classification.phase === "rpc_definitive_rejection") {
          attempt.status = "rejected";
          attempt.rejectionReason = classification.rejectionReason;
          attempt.rejectionError = classification.normalized.message;
          if (classification.rejectionReason === "stale_quote") {
            presentationEffect(() => onSetStaleQuoteDetected?.(true));
          }
        } else {
          attempt.status = "uncertain";
          attempt.uncertaintyHistory.push({
            timestamp: Date.now(),
            message: classification.normalized.message,
            code: classification.normalized.code,
            details: classification.normalized.details,
          });
        }
        const phaseErr: PosPhaseError = {
          ...classification.normalized,
          phase: classification.phase,
          rejectionReason: classification.rejectionReason,
        };
        presentationEffect(() => onError?.(phaseErr));
        return { status: "error", error: phaseErr.message };
      }

      return await this.confirmAttempt(attempt, saleResult, {
        getReceipt: getDocumentSaleReceiptFn,
        onConfirmed,
        onSuccess,
        onClearCart,
        onClearOperationKey,
        onSetStaleQuoteDetected,
        onAfterSaleFetch,
      });
    } catch (error: unknown) {
      if (!isFenceValid()) return { status: "aborted", reason: "context_or_cart_invalidated" };
      const normalized = normalizePosError(error);
      presentationEffect(() => onError?.({ ...normalized, phase: "preflight_failure" }));
      return { status: "error", error: normalized.message };
    } finally {
      // Single finalizer: reset submitting DE MI CHECKOUT BEFORE ending checkout or draining autofetch!
      if (this.isCheckoutValid(token)) {
        presentationEffect(() => onSetSubmittingSale?.(false));
        this.endCheckout(token);
      }
    }
  }

  private async confirmAttempt(
    attempt: FinancialAttempt,
    saleResult: CreateSaleWithInvoiceResult,
    effects: {
      getReceipt: (documentId: string) => Promise<DocumentSaleReceipt | null>;
      onConfirmed?: (result: CreateSaleWithInvoiceResult) => void;
      onSuccess?: (result: CreateSaleWithInvoiceResult, receipt: DocumentSaleReceipt | null) => void;
      onClearCart?: () => void;
      onClearOperationKey?: () => void;
      onSetStaleQuoteDetected?: (stale: boolean) => void;
      onAfterSaleFetch?: () => void;
    },
  ): Promise<CoordinateCheckoutResult<never>> {
    attempt.status = "confirmed";
    attempt.saleResult = saleResult;
    attempt.ticketReceipt = null;
    const effect = (run: () => void) => {
      try { run(); } catch (error: unknown) {
        attempt.recoveryError = normalizePosError(error).message;
      }
    };
    effect(() => effects.onConfirmed?.(saleResult));
    effect(() => effects.onSetStaleQuoteDetected?.(false));
    const originalDraft = this.contextRevision === attempt.origin.contextRevision &&
      this.cartRevision === attempt.origin.cartRevision &&
      this.currentContext.organizationId === attempt.origin.organizationId;
    if (originalDraft) {
      this.notifyCartCleared();
      effect(() => effects.onClearCart?.());
      effect(() => effects.onClearOperationKey?.());
    }
    let receipt: DocumentSaleReceipt | null = null;
    if (this.currentContext.organizationId === attempt.origin.organizationId) {
      try {
        receipt = await effects.getReceipt(saleResult.documentId);
        attempt.ticketReceipt = receipt;
        if (!receipt) attempt.recoveryError = "El comprobante no devolvió datos persistidos.";
      } catch (error: unknown) {
        attempt.recoveryError = normalizePosError(error).message;
      }
    } else {
      attempt.recoveryError = "Venta confirmada en otra organización. Vuelva al origen para recuperar el comprobante.";
    }
    effect(() => effects.onSuccess?.(saleResult, receipt));
    if (originalDraft && this.contextRevision === attempt.origin.contextRevision &&
        this.cartRevision === attempt.origin.cartRevision + 1) {
      effect(() => effects.onAfterSaleFetch?.());
    }
    return { status: "completed", saleResult, receipt };
  }

  /**
   * Retries an uncertain financial attempt.
   * Uses the EXACT SAME args and operation key without recalculating customer, snapshot, cash session, rate, or reason.
   */
  public async retryUncertainSale(
    params: RetryUncertainSaleParams = {},
  ): Promise<CoordinateCheckoutResult> {
    const attempt = this.currentFinancialAttempt;
    if (!attempt || attempt.status !== "uncertain") {
      return {
        status: "blocked",
        reason: "no_uncertain_attempt",
        error: "No hay un intento incierto para reintentar.",
      };
    }

    // FENCE: organization check!
    if (this.currentContext.organizationId !== attempt.origin.organizationId) {
      return {
        status: "blocked",
        reason: "different_organization",
        error:
          "Hay una operación pendiente en otra organización. Debe volver a la organización original para reintentar.",
      };
    }

    if (this.isFetchActive() || this.isRequoteActive() || this.isCheckoutActive()) {
      return {
        status: "blocked",
        reason: "checkout_in_progress",
        error: "Hay una operación en curso.",
      };
    }

    const token = ++this.operationTokenCounter;
    this.activeOperation = {
      kind: "checkout",
      token,
      contextRevision: this.contextRevision,
      cartRevision: this.cartRevision,
    };
    presentationEffect(() => params.onSetSubmittingSale?.(true));

    attempt.status = "dispatched";

    const submitFn = params.submitPreparedSaleFn ?? submitPreparedSale;
    const getReceiptFn = params.getDocumentSaleReceiptFn ?? getDocumentSaleReceipt;

    try {
      let saleResult: CreateSaleWithInvoiceResult;
      try {
        saleResult = await submitFn(attempt.args);
      } catch (error: unknown) {
        if (this.getFinancialAttempt()?.status === "confirmed" && attempt.saleResult) {
          return { status: "completed", saleResult: attempt.saleResult, receipt: attempt.ticketReceipt ?? null };
        }
        const normalized = normalizePosError(error);
        attempt.status = "uncertain";
        attempt.uncertaintyHistory.push({ timestamp: Date.now(), message: normalized.message,
          code: normalized.code, details: normalized.details });
        presentationEffect(() => params.onError?.({ ...normalized, phase: "rpc_uncertain" }));
        return { status: "error", error: normalized.message };
      }
      return await this.confirmAttempt(attempt, saleResult, {
        getReceipt: getReceiptFn,
        onConfirmed: params.onConfirmed,
        onSuccess: params.onSuccess,
        onClearCart: params.onClearCart,
        onAfterSaleFetch: params.onAfterSaleFetch,
      });
    } finally {
      if (this.isCheckoutValid(token)) {
        presentationEffect(() => params.onSetSubmittingSale?.(false));
        this.endCheckout(token);
      }
    }
  }
}
