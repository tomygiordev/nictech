import { supabase } from "../../lib/supabase";
import { z } from "zod";
import type {
  AccountingPeriod,
  ChartAccount,
  FinancingContract,
  JournalEntry,
} from "./types";
import type {
  ClosePeriodInput,
  FinancingInput,
  JournalEntryInput,
  ReceivablePaymentInput,
  ReconciliationInput,
  ReversalInput,
  SourceEventInput,
} from "./schemas";

const asRows = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const rpcIdSchema = z.string().uuid();
const getSupabase = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

export const parseRpcId = (value: unknown, label: string): string => {
  const result = rpcIdSchema.safeParse(value);
  if (!result.success) throw new Error(`Respuesta inválida para ${label}`);
  return result.data;
};

export const listFinancingContracts = async (): Promise<FinancingContract[]> => {
  const { data, error } = await getSupabase()
    .from("financing_contracts")
    .select("*, financing_installments(*)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return asRows<FinancingContract>(data);
};

export const listChartOfAccounts = async (): Promise<ChartAccount[]> => {
  const { data, error } = await getSupabase().from("chart_of_accounts").select("*").order("code");
  if (error) throw error;
  return asRows<ChartAccount>(data);
};

export const listAccountingPeriods = async (): Promise<AccountingPeriod[]> => {
  const { data, error } = await getSupabase()
    .from("accounting_periods")
    .select("*")
    .order("period_start", { ascending: false });
  if (error) throw error;
  return asRows<AccountingPeriod>(data);
};

export const listJournalEntries = async (): Promise<JournalEntry[]> => {
  const { data, error } = await getSupabase()
    .from("journal_entries")
    .select("*")
    .order("entry_date", { ascending: false });
  if (error) throw error;
  return asRows<JournalEntry>(data);
};

export const createFinancingContract = async (input: FinancingInput): Promise<string> => {
  const { data, error } = await getSupabase().rpc("create_financing_contract", {
    target_branch_id: input.branchId,
    target_customer_id: input.customerId,
    currency: input.currency,
    principal: input.principal,
    down_payment: input.downPayment,
    interest_rate: input.interestRate,
    installments_count: input.installmentsCount,
    first_due: input.firstDue,
    operation_key: input.operationKey,
    operation_reason: input.reason,
  });
  if (error) throw error;
  return parseRpcId(data, "financing contract");
};

export const recordReceivablePayment = async (input: ReceivablePaymentInput): Promise<string> => {
  const { data, error } = await getSupabase().rpc("record_receivable_payment", {
    target_branch_id: input.branchId,
    target_contract_id: input.contractId,
    payment_amount: input.amount,
    operation_key: input.operationKey,
    operation_reason: input.reason,
  });
  if (error) throw error;
  return parseRpcId(data, "receivable payment");
};

export const postJournalEntry = async (input: JournalEntryInput): Promise<string> => {
  const { data, error } = await getSupabase().rpc("post_journal_entry", {
    target_branch_id: input.branchId,
    target_entry_date: input.entryDate,
    target_source_type: input.sourceType ?? null,
    target_source_id: input.sourceId ?? null,
    operation_key: input.operationKey,
    operation_reason: input.reason,
    lines: input.lines,
  });
  if (error) throw error;
  return parseRpcId(data, "journal entry");
};

export const postErpSourceEvent = async (input: SourceEventInput): Promise<string> => {
  const { data, error } = await getSupabase().rpc("post_erp_source_event", {
    target_branch_id: input.branchId,
    target_entry_date: input.entryDate,
    target_source_type: input.sourceType,
    target_source_id: input.sourceId,
    operation_key: input.operationKey,
    operation_reason: input.reason,
    lines: input.lines,
  });
  if (error) throw error;
  return parseRpcId(data, "source event journal");
};

export const reverseJournalEntry = async (input: ReversalInput): Promise<string> => {
  const { data, error } = await getSupabase().rpc("reverse_journal_entry", {
    target_entry_id: input.entryId,
    target_reversal_date: input.reversalDate,
    operation_key: input.operationKey,
    operation_reason: input.reason,
  });
  if (error) throw error;
  return parseRpcId(data, "reversal");
};

export const closeAccountingPeriod = async (input: ClosePeriodInput): Promise<void> => {
  const { error } = await getSupabase().rpc("close_accounting_period", {
    target_period_id: input.periodId,
    operation_reason: input.reason,
  });
  if (error) throw error;
};

export const reconcileAccountBalance = async (input: ReconciliationInput): Promise<string> => {
  const { data, error } = await getSupabase().rpc("reconcile_account_balance", {
    target_branch_id: input.branchId,
    target_account_id: input.accountId,
    target_as_of_date: input.asOfDate,
    target_subledger_balance: input.subledgerBalance,
    target_general_ledger_balance: input.generalLedgerBalance,
    operation_reason: input.reason,
  });
  if (error) throw error;
  return parseRpcId(data, "reconciliation");
};
