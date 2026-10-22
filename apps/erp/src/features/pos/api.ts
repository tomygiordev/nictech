import { supabase } from "../../lib/supabase";
import type { Database, Json } from "../../types/supabase";
import { invoiceSaleSchema, saleSchema } from "./schemas";
import type { InvoiceKind, PosInvoiceSaleInput, PosRegister, PosSaleInput } from "./types";
import { z } from "zod";

export type CreateSaleRpcArgs = Database["erp"]["Functions"]["create_sale"]["Args"];
export type CreateSaleWithInvoiceRpcArgs = Database["erp"]["Functions"]["create_sale_with_invoice"]["Args"];

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

const deepCloneAndFreeze = <T>(val: T): T => {
  if (val === null || typeof val !== "object") return val;
  if (Array.isArray(val)) {
    const arr = val.map(deepCloneAndFreeze);
    return Object.freeze(arr) as unknown as T;
  }
  const cloned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val)) {
    cloned[k] = deepCloneAndFreeze(v);
  }
  return Object.freeze(cloned) as unknown as T;
};

const toJson = (value: unknown): Json => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object") {
    const result: { [key: string]: Json | undefined } = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = nestedValue === undefined ? undefined : toJson(nestedValue);
    }
    return result;
  }
  throw new Error("El payload de la venta contiene un valor no serializable.");
};

export const listRegisters = async (): Promise<PosRegister[]> => {
  const { data, error } = await client()
    .from("cash_registers")
    .select("id,branch_id,code,name,is_active")
    .eq("is_active", true)
    .order("code");
  if (error) throw error;
  return data ?? [];
};

export const buildCreateSaleRpcArgs = (input: PosSaleInput): CreateSaleRpcArgs => {
  const parsedInput = saleSchema.parse(input);
  return deepCloneAndFreeze({
    target_branch_id: parsedInput.branchId,
    target_customer_id: parsedInput.customerId,
    sale_currency: parsedInput.currency,
    target_exchange_snapshot_id: parsedInput.exchangeSnapshotId,
    operation_key: parsedInput.operationKey,
    operation_reason: parsedInput.reason,
    lines: toJson(parsedInput.lines),
    payment_lines: toJson(parsedInput.paymentLines),
  });
};

export const createSale = async (input: PosSaleInput): Promise<string> => {
  const { data, error } = await client().rpc("create_sale", buildCreateSaleRpcArgs(input));
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Respuesta inválida al crear la venta.");
  return data;
};

export interface CreateSaleWithInvoiceResult {
  saleId: string;
  documentId: string;
  documentNumber: string;
  invoiceKind: InvoiceKind;
}

export const buildCreateSaleWithInvoiceRpcArgs = (input: PosInvoiceSaleInput): CreateSaleWithInvoiceRpcArgs => {
  const parsedInput = invoiceSaleSchema.parse(input);
  const base = buildCreateSaleRpcArgs(parsedInput);
  return deepCloneAndFreeze({
    ...base,
    target_invoice_kind: parsedInput.invoiceKind,
  });
};

const saleResultSchema = z.object({
  sale_id: z.string().uuid(),
  document_id: z.string().uuid(),
  document_number: z.string().trim().min(1),
  invoice_kind: z.enum(["fiscal", "non_fiscal"]),
});

const parseSaleWithInvoiceResult = (value: Json): CreateSaleWithInvoiceResult => {
  const parsed = saleResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Respuesta incompleta al emitir la factura de la venta.");
  }
  const result = parsed.data;
  return {
    saleId: result.sale_id,
    documentId: result.document_id,
    documentNumber: result.document_number,
    invoiceKind: result.invoice_kind,
  };
};

export const submitPreparedSale = async (
  args: CreateSaleWithInvoiceRpcArgs,
): Promise<CreateSaleWithInvoiceResult> => {
  const { data, error } = await client().rpc("create_sale_with_invoice", args);
  if (error) throw error;
  return parseSaleWithInvoiceResult(data);
};

export const createSaleWithInvoice = async (input: PosInvoiceSaleInput): Promise<CreateSaleWithInvoiceResult> => {
  const args = buildCreateSaleWithInvoiceRpcArgs(input);
  return submitPreparedSale(args);
};
