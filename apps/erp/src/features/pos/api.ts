import { supabase } from "../../lib/supabase";
import type { Database, Json } from "../../types/supabase";
import { saleSchema } from "./schemas";
import type { PosRegister, PosSaleInput } from "./types";

export type CreateSaleRpcArgs = Database["erp"]["Functions"]["create_sale"]["Args"];

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
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
  return {
    target_branch_id: parsedInput.branchId,
    target_customer_id: parsedInput.customerId,
    sale_currency: parsedInput.currency,
    target_exchange_snapshot_id: parsedInput.exchangeSnapshotId,
    operation_key: parsedInput.operationKey,
    operation_reason: parsedInput.reason,
    lines: toJson(parsedInput.lines),
    payment_lines: toJson(parsedInput.paymentLines),
  };
};

export const createSale = async (input: PosSaleInput): Promise<string> => {
  const { data, error } = await client().rpc("create_sale", buildCreateSaleRpcArgs(input));
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Respuesta inválida al crear la venta.");
  return data;
};

export interface CreateSaleWithFiscalDocumentResult {
  saleId: string;
  documentId: string;
  fiscalRequestId: string;
  fiscalStatus: "queued";
}

const parseSaleWithFiscalDocumentResult = (value: Json): CreateSaleWithFiscalDocumentResult => {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Respuesta inválida al emitir el comprobante de la venta.");
  }
  const result = value as {
    sale_id?: unknown;
    document_id?: unknown;
    fiscal_request_id?: unknown;
    fiscal_status?: unknown;
  };
  if (
    typeof result.sale_id !== "string" ||
    typeof result.document_id !== "string" ||
    typeof result.fiscal_request_id !== "string" ||
    result.fiscal_status !== "queued"
  ) {
    throw new Error("Respuesta incompleta al emitir el comprobante de la venta.");
  }
  return {
    saleId: result.sale_id,
    documentId: result.document_id,
    fiscalRequestId: result.fiscal_request_id,
    fiscalStatus: "queued",
  };
};

export const createSaleWithFiscalDocument = async (
  input: PosSaleInput,
): Promise<CreateSaleWithFiscalDocumentResult> => {
  const { data, error } = await client().rpc(
    "create_sale_with_fiscal_document",
    buildCreateSaleRpcArgs(input),
  );
  if (error) throw error;
  return parseSaleWithFiscalDocumentResult(data);
};
