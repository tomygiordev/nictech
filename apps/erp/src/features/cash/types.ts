export type CashSession = {
  id: string;
  branch_id: string;
  cash_register_id: string;
  opened_at: string;
  reason: string;
};

export type OpenCashInput = {
  cashRegisterId: string;
  operationKey: string;
  reason: string;
  openingCounts: Array<{ currency_code: string; amount: number }>;
};
