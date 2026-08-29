export type FinancingStatus =
  | "current"
  | "due"
  | "partially_paid"
  | "refinanced"
  | "cancelled"
  | "uncollectible"
  | "paid";

export type InstallmentStatus = "upcoming" | "due" | "partially_paid" | "paid" | "cancelled";
export type JournalStatus = "draft" | "posted" | "reversed";
export type PeriodStatus = "open" | "closed";

export type FinancingInstallment = {
  id: string;
  installment_number: number;
  due_date: string;
  principal_due: string;
  interest_due: string;
  late_fee_due: string;
  paid_principal: string;
  paid_interest: string;
  paid_late_fee: string;
  status: InstallmentStatus;
};

export type FinancingContract = {
  id: string;
  branch_id: string;
  customer_id: string;
  currency_code: string;
  principal_amount: string;
  down_payment_amount: string;
  financed_amount: string;
  monthly_interest_rate: string;
  installment_count: number;
  first_due_date: string;
  status: FinancingStatus;
  contract_reference: string | null;
  financing_installments?: FinancingInstallment[];
};

export type AccountingPeriod = {
  id: string;
  period_start: string;
  period_end: string;
  status: PeriodStatus;
  closed_at: string | null;
};

export type ChartAccount = {
  id: string;
  code: string;
  name: string;
  account_type: "asset" | "liability" | "equity" | "income" | "expense";
  normal_balance: "debit" | "credit";
  is_control: boolean;
  is_active: boolean;
};

export type JournalEntry = {
  id: string;
  entry_date: string;
  description: string;
  status: JournalStatus;
  total_debit: string;
  total_credit: string;
  source_type: string | null;
  source_id: string | null;
};

export type JournalLineInput = {
  account_id: string;
  description: string;
  debit: string;
  credit: string;
  currency_code: string;
  exchange_rate: string;
};
