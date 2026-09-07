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

export type BranchOption = {
  id: string;
  code: string;
  name: string;
};

export type CustomerOption = {
  id: string;
  code: string;
  display_name: string;
};

export const listBranches = async (): Promise<BranchOption[]> => {
  try {
    const { data, error } = await getSupabase()
      .from("branches")
      .select("id,code,name")
      .order("name");
    if (error) {
      console.warn("Aviso al consultar branches:", error.message);
      return [];
    }
    return asRows<BranchOption>(data);
  } catch (err) {
    console.warn("Error en listBranches:", err);
    return [];
  }
};

export const listCustomers = async (): Promise<CustomerOption[]> => {
  try {
    const { data, error } = await getSupabase()
      .from("customers")
      .select("id,code,display_name")
      .order("display_name");
    if (error) {
      console.warn("Aviso al consultar customers:", error.message);
      return [];
    }
    return asRows<CustomerOption>(data);
  } catch (err) {
    console.warn("Error en listCustomers:", err);
    return [];
  }
};

export const bootstrapChartOfAccounts = async (): Promise<void> => {
  const { error } = await getSupabase().rpc("bootstrap_chart_of_accounts");
  if (error) throw error;
};

export const calculateFinancingStatus = async (contractId: string): Promise<string> => {
  const { data, error } = await getSupabase().rpc("calculate_financing_status", {
    target_contract_id: contractId,
  });
  if (error) throw error;
  if (typeof data !== "string" || data.length === 0) throw new Error("Respuesta inválida para financing status");
  return data;
};

export const listFinancingContracts = async (): Promise<FinancingContract[]> => {
  try {
    const { data, error } = await getSupabase()
      .from("financing_contracts")
      .select("*, financing_installments(*)")
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("Aviso al consultar financing_contracts:", error.message);
      return [];
    }
    return asRows<FinancingContract>(data);
  } catch (err) {
    console.warn("Error en listFinancingContracts:", err);
    return [];
  }
};

export const listChartOfAccounts = async (): Promise<ChartAccount[]> => {
  try {
    const { data, error } = await getSupabase().from("chart_of_accounts").select("*").order("code");
    if (error) {
      console.warn("Aviso al consultar chart_of_accounts:", error.message);
      return [];
    }
    return asRows<ChartAccount>(data);
  } catch (err) {
    console.warn("Error en listChartOfAccounts:", err);
    return [];
  }
};

export const listAccountingPeriods = async (): Promise<AccountingPeriod[]> => {
  try {
    const { data, error } = await getSupabase()
      .from("accounting_periods")
      .select("*")
      .order("period_start", { ascending: false });
    if (error) {
      console.warn("Aviso al consultar accounting_periods:", error.message);
      return [];
    }
    return asRows<AccountingPeriod>(data);
  } catch (err) {
    console.warn("Error en listAccountingPeriods:", err);
    return [];
  }
};

export const listJournalEntries = async (): Promise<JournalEntry[]> => {
  try {
    const { data, error } = await getSupabase()
      .from("journal_entries")
      .select("*")
      .order("entry_date", { ascending: false });
    if (error) {
      console.warn("Aviso al consultar journal_entries:", error.message);
      return [];
    }
    return asRows<JournalEntry>(data);
  } catch (err) {
    console.warn("Error en listJournalEntries:", err);
    return [];
  }
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
