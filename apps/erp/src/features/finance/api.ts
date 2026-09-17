import { supabase } from "../../lib/supabase";
import { z } from "zod";
import type {
  AccountingPeriod,
  ChartAccount,
  FinancingContract,
  IvaComprasRow,
  IvaVentasRow,
  JournalEntry,
  ProfitabilityByLineRow,
  TrialBalanceRow,
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
import { requestReportExport } from "../../lib/reportExports";

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

const parseRpcNumber = (value: string, label: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Valor numérico inválido para ${label}`);
  return parsed;
};

const requireViewString = (value: string | null, label: string): string => {
  if (value === null || value.trim() === "") throw new Error(`Respuesta inválida para ${label}`);
  return value;
};

// PostgreSQL acepta NULL para el origen opcional del asiento, pero los tipos
// generados de funciones sólo describen el tipo base del parámetro.
const nullableRpcString = (value: string | null | undefined): string => value as string;

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

export type ReceivablePaymentMethodOption = {
  id: string;
  code: string;
  name: string;
  settlement_kind: string;
  requires_cash_session: boolean;
};

export type ReceivableCashSessionOption = {
  id: string;
  branch_id: string;
  cash_register_code: string;
  cash_register_name: string;
  opened_at: string;
  currencies: string[];
};

export const listBranches = async (): Promise<BranchOption[]> => {
  const { data, error } = await getSupabase()
    .from("branches")
    .select("id,code,name")
    .order("name");
  if (error) throw error;
  return data ?? [];
};

export const listCustomers = async (): Promise<CustomerOption[]> => {
  const { data, error } = await getSupabase()
    .from("customers")
    .select("id,code,display_name")
    .order("display_name");
  if (error) throw error;
  return data ?? [];
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
  const { data, error } = await getSupabase()
    .from("financing_contracts")
    .select("*, financing_installments(*)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    branch_id: row.branch_id,
    customer_id: row.customer_id,
    currency_code: row.currency_code,
    principal_amount: String(row.principal_amount),
    down_payment_amount: String(row.down_payment_amount),
    financed_amount: String(row.financed_amount),
    monthly_interest_rate: String(row.monthly_interest_rate),
    installment_count: row.installment_count,
    first_due_date: row.first_due_date,
    status: row.status,
    contract_reference: row.contract_reference,
    financing_installments: row.financing_installments.map((installment) => ({
      id: installment.id,
      installment_number: installment.installment_number,
      due_date: installment.due_date,
      principal_due: String(installment.principal_due),
      interest_due: String(installment.interest_due),
      late_fee_due: String(installment.late_fee_due),
      paid_principal: String(installment.paid_principal),
      paid_interest: String(installment.paid_interest),
      paid_late_fee: String(installment.paid_late_fee),
      status: installment.status,
    })),
  }));
};

export const listChartOfAccounts = async (): Promise<ChartAccount[]> => {
  const { data, error } = await getSupabase().from("chart_of_accounts").select("*").order("code");
  if (error) throw error;
  return data ?? [];
};

export const listReceivablePaymentMethods = async (
  branchId: string,
): Promise<ReceivablePaymentMethodOption[]> => {
  const { data, error } = await getSupabase().rpc("list_receivable_payment_methods", {
    target_branch_id: branchId,
  });
  if (error) throw error;
  return data ?? [];
};

export const listReceivableCashSessions = async (
  branchId: string,
): Promise<ReceivableCashSessionOption[]> => {
  const { data, error } = await getSupabase().rpc("list_receivable_cash_sessions", {
    target_branch_id: branchId,
  });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    currencies: row.currencies ?? [],
  }));
};

export const listAccountingPeriods = async (): Promise<AccountingPeriod[]> => {
  const { data, error } = await getSupabase()
    .from("accounting_periods")
    .select("*")
    .order("period_start", { ascending: false });
  if (error) throw error;
  return data ?? [];
};

export const listJournalEntries = async (): Promise<JournalEntry[]> => {
  const { data, error } = await getSupabase()
    .from("journal_entries")
    .select("*")
    .order("entry_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    entry_date: row.entry_date,
    description: row.description,
    status: row.status,
    total_debit: String(row.total_debit),
    total_credit: String(row.total_credit),
    source_type: row.source_type,
    source_id: row.source_id,
  }));
};

export const createFinancingContract = async (input: FinancingInput): Promise<string> => {
  const { data, error } = await getSupabase().rpc("create_financing_contract", {
    target_branch_id: input.branchId,
    target_customer_id: input.customerId,
    currency: input.currency,
    principal: parseRpcNumber(input.principal, "el capital"),
    down_payment: parseRpcNumber(input.downPayment, "el anticipo"),
    interest_rate: parseRpcNumber(input.interestRate, "la tasa de interés"),
    installments_count: input.installmentsCount,
    first_due: input.firstDue,
    operation_key: input.operationKey,
    operation_reason: input.reason,
  });
  if (error) throw error;
  return parseRpcId(data, "financing contract");
};

export const recordReceivablePayment = async (input: ReceivablePaymentInput): Promise<string> => {
  const { data, error } = await getSupabase().rpc("record_receivable_payment_settlement", {
    target_branch_id: input.branchId,
    target_contract_id: input.contractId,
    target_payment_method_id: input.paymentMethodId,
    target_cash_session_id: nullableRpcString(input.cashSessionId || null),
    payment_amount: parseRpcNumber(input.amount, "el cobro"),
    payment_reference: nullableRpcString(input.paymentReference || null),
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
    target_source_type: nullableRpcString(input.sourceType),
    target_source_id: nullableRpcString(input.sourceId),
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
    target_subledger_balance: parseRpcNumber(input.subledgerBalance, "el saldo del submayor"),
    target_general_ledger_balance: parseRpcNumber(input.generalLedgerBalance, "el saldo del mayor"),
    operation_reason: input.reason,
  });
  if (error) throw error;
  return parseRpcId(data, "reconciliation");
};

export type ReportDateRange = {
  from?: string;
  to?: string;
};

export type ExportedReportRows<T> = {
  rows: T[];
  truncated: boolean;
};

export type FinancialReportExportInput = {
  reason: string;
  range?: ReportDateRange;
  branchId?: string;
  rowLimit?: number;
};

const numericViewValueSchema = z.union([z.number(), z.string()]).nullable();

const ivaVentasExportRowSchema = z.object({
  organization_id: z.string().uuid(),
  branch_id: z.string().uuid().nullable(),
  sale_id: z.string().uuid(),
  sale_date: z.string().nullable(),
  alicuota: numericViewValueSchema,
  base_imponible: numericViewValueSchema,
  iva: numericViewValueSchema,
});

const ivaComprasExportRowSchema = z.object({
  organization_id: z.string().uuid(),
  branch_id: z.string().uuid().nullable(),
  purchase_order_id: z.string().uuid(),
  purchase_date: z.string().nullable(),
  alicuota: numericViewValueSchema,
  base_imponible: numericViewValueSchema,
  iva: numericViewValueSchema,
});

const trialBalanceExportRowSchema = z.object({
  organization_id: z.string().uuid(),
  period_id: z.string().uuid(),
  period_start: z.string(),
  period_end: z.string(),
  account_id: z.string().uuid(),
  account_code: z.string(),
  account_name: z.string(),
  total_debit: numericViewValueSchema,
  total_credit: numericViewValueSchema,
  balance: numericViewValueSchema,
});

const profitabilityExportRowSchema = z.object({
  organization_id: z.string().uuid(),
  product_id: z.string().uuid(),
  internal_code: z.string().nullable(),
  internal_name: z.string().nullable(),
  quantity_sold: numericViewValueSchema,
  gross_revenue: numericViewValueSchema,
  avg_unit_landed_cost: numericViewValueSchema,
  estimated_cost: numericViewValueSchema,
  margin: numericViewValueSchema,
});

const parseExportRows = <T>(
  rows: Array<Record<string, unknown>>,
  schema: z.ZodType<T>,
): T[] => z.array(schema).parse(rows);

export const exportIvaVentasReport = async (
  input: FinancialReportExportInput,
): Promise<ExportedReportRows<IvaVentasRow>> => {
  const response = await requestReportExport({
    reportCode: "iva_ventas",
    reason: input.reason,
    dateFrom: input.range?.from,
    dateTo: input.range?.to,
    branchId: input.branchId,
    rowLimit: input.rowLimit,
  });
  return { rows: parseExportRows(response.rows, ivaVentasExportRowSchema), truncated: response.truncated };
};

export const exportIvaComprasReport = async (
  input: FinancialReportExportInput,
): Promise<ExportedReportRows<IvaComprasRow>> => {
  const response = await requestReportExport({
    reportCode: "iva_compras",
    reason: input.reason,
    dateFrom: input.range?.from,
    dateTo: input.range?.to,
    branchId: input.branchId,
    rowLimit: input.rowLimit,
  });
  return { rows: parseExportRows(response.rows, ivaComprasExportRowSchema), truncated: response.truncated };
};

export const exportTrialBalanceReport = async (
  input: FinancialReportExportInput,
): Promise<ExportedReportRows<TrialBalanceRow>> => {
  const response = await requestReportExport({
    reportCode: "trial_balance",
    reason: input.reason,
    dateFrom: input.range?.from,
    dateTo: input.range?.to,
    branchId: input.branchId,
    rowLimit: input.rowLimit,
  });
  return { rows: parseExportRows(response.rows, trialBalanceExportRowSchema), truncated: response.truncated };
};

export const exportProfitabilityReport = async (
  input: Omit<FinancialReportExportInput, "range">,
): Promise<ExportedReportRows<ProfitabilityByLineRow>> => {
  const response = await requestReportExport({
    reportCode: "profitability",
    reason: input.reason,
    branchId: input.branchId,
    rowLimit: input.rowLimit,
  });
  return { rows: parseExportRows(response.rows, profitabilityExportRowSchema), truncated: response.truncated };
};

export const listIvaVentas = async (range?: ReportDateRange): Promise<IvaVentasRow[]> => {
  let query = getSupabase().from("v_iva_ventas").select("*").order("sale_date", { ascending: false });
  if (range?.from) query = query.gte("sale_date", range.from);
  if (range?.to) query = query.lte("sale_date", range.to);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    organization_id: requireViewString(row.organization_id, "la organización de IVA ventas"),
    branch_id: row.branch_id,
    sale_id: requireViewString(row.sale_id, "la venta de IVA ventas"),
    sale_date: row.sale_date,
    alicuota: row.alicuota,
    base_imponible: row.base_imponible,
    iva: row.iva,
  }));
};

export const listIvaCompras = async (range?: ReportDateRange): Promise<IvaComprasRow[]> => {
  let query = getSupabase().from("v_iva_compras").select("*").order("purchase_date", { ascending: false });
  if (range?.from) query = query.gte("purchase_date", range.from);
  if (range?.to) query = query.lte("purchase_date", range.to);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    organization_id: requireViewString(row.organization_id, "la organización de IVA compras"),
    branch_id: row.branch_id,
    purchase_order_id: requireViewString(row.purchase_order_id, "la orden de IVA compras"),
    purchase_date: row.purchase_date,
    alicuota: row.alicuota,
    base_imponible: row.base_imponible,
    iva: row.iva,
  }));
};

export const listTrialBalance = async (range?: ReportDateRange): Promise<TrialBalanceRow[]> => {
  let query = getSupabase().from("v_trial_balance").select("*").order("account_code", { ascending: true });
  if (range?.from) query = query.gte("period_start", range.from);
  if (range?.to) query = query.lte("period_end", range.to);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    organization_id: requireViewString(row.organization_id, "la organización del balance"),
    period_id: requireViewString(row.period_id, "el período del balance"),
    period_start: requireViewString(row.period_start, "el inicio del período"),
    period_end: requireViewString(row.period_end, "el fin del período"),
    account_id: requireViewString(row.account_id, "la cuenta del balance"),
    account_code: requireViewString(row.account_code, "el código de cuenta"),
    account_name: requireViewString(row.account_name, "el nombre de cuenta"),
    total_debit: row.total_debit,
    total_credit: row.total_credit,
    balance: row.balance,
  }));
};

export const listProfitabilityByLine = async (): Promise<ProfitabilityByLineRow[]> => {
  const { data, error } = await getSupabase()
    .from("v_profitability_by_line")
    .select("*")
    .order("gross_revenue", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    organization_id: requireViewString(row.organization_id, "la organización de rentabilidad"),
    product_id: requireViewString(row.product_id, "el producto de rentabilidad"),
    internal_code: row.internal_code,
    internal_name: row.internal_name,
    quantity_sold: row.quantity_sold,
    gross_revenue: row.gross_revenue,
    avg_unit_landed_cost: row.avg_unit_landed_cost,
    estimated_cost: row.estimated_cost,
    margin: row.margin,
  }));
};
