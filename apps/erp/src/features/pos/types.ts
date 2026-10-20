export type PosRegister = {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type PosSaleLineInput = {
  kind: "product" | "service" | "free_concept";
  product_id?: string | null;
  variant_id?: string | null;
  inventory_unit_id?: string | null;
  from_location_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_rate_percent: number;
  tax_amount: number;
};

export type PosPaymentLineInput = {
  payment_method_id: string;
  cash_session_id: string | null;
  amount: number;
  currency_code?: string;
};

export type PosSaleInput = {
  branchId: string;
  customerId: string;
  currency: string;
  exchangeSnapshotId: string;
  operationKey: string;
  reason: string;
  lines: PosSaleLineInput[];
  paymentLines: PosPaymentLineInput[];
};

export type InvoiceKind = "fiscal" | "non_fiscal";

export type PosInvoiceSaleInput = PosSaleInput & {
  invoiceKind: InvoiceKind;
};
