/**
 * NicTech ERP - POS Sale Execution and Receipt Recovery Flow
 *
 * Implements POS sale commit and receipt retrieval.
 * Eliminates fabricated receipts. Only persisted facts from getDocumentSaleReceipt
 * are presented or printed.
 */

import { createSaleWithInvoice, type CreateSaleWithInvoiceResult } from "./api";
import { getDocumentSaleReceipt } from "../documents/api";
import type { PosInvoiceSaleInput } from "./types";
import type { DocumentSaleReceipt } from "../../types/DocumentSaleReceipt";

export interface ConfirmedSaleInfo {
  saleId: string;
  documentId: string;
  documentNumber: string;
  invoiceKind: "fiscal" | "non_fiscal";
}

export interface ConfirmedTicketState {
  info: ConfirmedSaleInfo;
  receipt: DocumentSaleReceipt | null;
  recoveryLoading?: boolean;
  recoveryError?: string | null;
}

export type PosSaleExecutionResult =
  | {
      status: "completed";
      saleResult: CreateSaleWithInvoiceResult;
      receipt: DocumentSaleReceipt;
    }
  | {
      status: "pending_receipt";
      saleResult: CreateSaleWithInvoiceResult;
      receipt: null;
      error?: string;
    };

export interface ExecutePosSaleDependencies {
  createSaleWithInvoiceFn?: (input: PosInvoiceSaleInput) => Promise<CreateSaleWithInvoiceResult>;
  getDocumentSaleReceiptFn?: (documentId: string) => Promise<DocumentSaleReceipt | null>;
}

/**
 * Executes a POS sale with atomic invoice creation.
 * If createSaleWithInvoice succeeds, the sale is committed in the ERP database.
 * It then attempts to read the persisted receipt via getDocumentSaleReceipt.
 * If read-back returns null or fails, the sale remains confirmed (never rolled back or re-created)
 * and no fabricated receipt is created.
 */
export const executePosSale = async (
  input: PosInvoiceSaleInput,
  deps: ExecutePosSaleDependencies = {},
): Promise<PosSaleExecutionResult> => {
  const createSaleFn = deps.createSaleWithInvoiceFn ?? createSaleWithInvoice;
  const getReceiptFn = deps.getDocumentSaleReceiptFn ?? getDocumentSaleReceipt;

  // 1. Commit sale and invoice in ERP database.
  // If this throws, it bubbles up to the caller so the cart and idempotency key
  // are retained for safe retry.
  const saleResult = await createSaleFn(input);

  // 2. Read-back of persisted facts.
  try {
    const receipt = await getReceiptFn(saleResult.documentId);
    if (receipt) {
      return {
        status: "completed",
        saleResult,
        receipt,
      };
    }
    return {
      status: "pending_receipt",
      saleResult,
      receipt: null,
      error: "El comprobante no devolvió datos persistidos en el ERP.",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error al recuperar el comprobante persistido.";
    return {
      status: "pending_receipt",
      saleResult,
      receipt: null,
      error: msg,
    };
  }
};

export type PosReceiptRecoveryResult =
  | {
      status: "completed";
      receipt: DocumentSaleReceipt;
    }
  | {
      status: "pending_receipt";
      error: string;
    };

/**
 * Recovers a sale receipt for an already confirmed sale document.
 * ONLY reads getDocumentSaleReceipt.
 * Never calls create_sale or create_sale_with_invoice, and never generates an operation key.
 */
export const recoverPosSaleReceipt = async (
  documentId: string,
  getDocumentSaleReceiptFn: (documentId: string) => Promise<DocumentSaleReceipt | null> = getDocumentSaleReceipt,
): Promise<PosReceiptRecoveryResult> => {
  try {
    const receipt = await getDocumentSaleReceiptFn(documentId);
    if (!receipt) {
      return {
        status: "pending_receipt",
        error: "El comprobante aún no devolvió datos persistidos.",
      };
    }
    return {
      status: "completed",
      receipt,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error al recuperar el comprobante persistido.";
    return {
      status: "pending_receipt",
      error: msg,
    };
  }
};

export type ConfirmedTicketStateUpdater = (
  updater: (previous: ConfirmedTicketState | null) => ConfirmedTicketState | null,
) => void;

/**
 * Recovers a confirmed sale ticket receipt into ticket state.
 * Uses a functional state updater at both start and end, checking:
 * `previous?.info.documentId === documentId`
 * If previous is null or belongs to another ticket (e.g. ticket B or closed),
 * it returns previous intact, protecting against race conditions and reviving closed tickets.
 * Strictly read-only; never calls create_sale or create_sale_with_invoice.
 */
export const recoverConfirmedTicket = async (
  documentId: string,
  updateTicket: ConfirmedTicketStateUpdater,
  recoverFn: (documentId: string) => Promise<PosReceiptRecoveryResult> = recoverPosSaleReceipt,
): Promise<void> => {
  updateTicket((previous) => {
    if (!previous || previous.info.documentId !== documentId) {
      return previous;
    }
    return {
      ...previous,
      recoveryLoading: true,
      recoveryError: null,
    };
  });

  let result: PosReceiptRecoveryResult;
  try {
    result = await recoverFn(documentId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error al recuperar el comprobante persistido.";
    result = {
      status: "pending_receipt",
      error: msg,
    };
  }

  updateTicket((previous) => {
    if (!previous || previous.info.documentId !== documentId) {
      return previous;
    }
    if (result.status === "completed") {
      return {
        ...previous,
        receipt: result.receipt,
        recoveryLoading: false,
        recoveryError: null,
      };
    }
    return {
      ...previous,
      receipt: null,
      recoveryLoading: false,
      recoveryError: `No se pudo recuperar el comprobante: ${result.error}. Podés volver a intentar o consultarlo desde Documentos.`,
    };
  });
};
