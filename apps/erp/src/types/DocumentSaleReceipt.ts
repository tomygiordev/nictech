export interface DocumentSaleReceiptLine {
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_rate_percent: number;
  tax_amount: number;
  line_total: number;
}

export interface DocumentSaleReceiptPayment {
  method_name: string;
  amount: number;
  currency_code: string;
  occurred_at: string;
  reversed: boolean;
}

export interface DocumentSaleReceipt {
  sale_id: string;
  document_id: string;
  document_number: string;
  branch_name: string;
  invoice_kind: "fiscal" | "non_fiscal";
  customer_display_name: string;
  customer_legal_name: string;
  currency_code: string;
  exchange_rate: number;
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  total_ars: number;
  confirmed_at: string;
  document_status: "issued" | "voided";
  sale_state: string | null;
  payment_state: string | null;
  lines: DocumentSaleReceiptLine[];
  payments: DocumentSaleReceiptPayment[];
}
