import { z } from "zod";

const positiveDecimal = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Ingresá un importe válido");
const nonNegativeDecimal = z.string().trim().regex(/^\d+(\.\d{1,6})?$/, "Ingresá un valor válido");

export const financingSchema = z.object({
  branchId: z.string().uuid(),
  customerId: z.string().uuid(),
  currency: z.string().length(3).toUpperCase(),
  principal: positiveDecimal,
  downPayment: nonNegativeDecimal,
  interestRate: nonNegativeDecimal,
  installmentsCount: z.coerce.number().int().min(1).max(120),
  firstDue: z.string().date(),
  operationKey: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

export const receivablePaymentSchema = z.object({
  branchId: z.string().uuid(),
  contractId: z.string().uuid(),
  amount: positiveDecimal,
  operationKey: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

export const journalEntrySchema = z.object({
  branchId: z.string().uuid(),
  entryDate: z.string().date(),
  sourceType: z.string().trim().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  operationKey: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  lines: z.array(z.object({
    account_id: z.string().uuid(),
    description: z.string().trim().min(1),
    debit: nonNegativeDecimal,
    credit: nonNegativeDecimal,
    currency_code: z.string().length(3).toUpperCase(),
    exchange_rate: z.string().trim().regex(/^\d+(\.\d{1,6})?$/),
  })).min(2),
});

export const sourceEventSchema = z.object({
  branchId: z.string().uuid(),
  entryDate: z.string().date(),
  sourceType: z.string().trim().min(1),
  sourceId: z.string().uuid(),
  operationKey: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  lines: journalEntrySchema.shape.lines,
});

export const reversalSchema = z.object({
  entryId: z.string().uuid(),
  reversalDate: z.string().date(),
  operationKey: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

export const closePeriodSchema = z.object({
  periodId: z.string().uuid(),
  reason: z.string().trim().min(1),
});

export const reconciliationSchema = z.object({
  branchId: z.string().uuid(),
  accountId: z.string().uuid(),
  asOfDate: z.string().date(),
  subledgerBalance: z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/),
  generalLedgerBalance: z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/),
  reason: z.string().trim().min(1),
});

export type FinancingInput = z.infer<typeof financingSchema>;
export type ReceivablePaymentInput = z.infer<typeof receivablePaymentSchema>;
export type JournalEntryInput = z.infer<typeof journalEntrySchema>;
export type SourceEventInput = z.infer<typeof sourceEventSchema>;
export type ReversalInput = z.infer<typeof reversalSchema>;
export type ClosePeriodInput = z.infer<typeof closePeriodSchema>;
export type ReconciliationInput = z.infer<typeof reconciliationSchema>;
