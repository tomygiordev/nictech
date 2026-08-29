import { supabase } from "../../lib/supabase";
import type { PosRegister, PosSaleInput } from "./types";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

export const listRegisters = async (): Promise<PosRegister[]> => {
  try {
    const { data, error } = await client()
      .from("cash_registers")
      .select("id,branch_id,code,name,is_active")
      .eq("is_active", true)
      .order("code");
    if (error) {
      console.warn("Aviso al consultar cash_registers:", error.message);
      return [];
    }
    return (data ?? []) as PosRegister[];
  } catch (err) {
    console.warn("Error en listRegisters:", err);
    return [];
  }
};

export const createSale = async (input: PosSaleInput): Promise<string> => {
  const { data, error } = await client().rpc("create_sale", {
    target_branch_id: input.branchId,
    target_customer_id: input.customerId,
    sale_currency: input.currency,
    target_exchange_snapshot_id: input.exchangeSnapshotId,
    operation_key: input.operationKey,
    operation_reason: input.reason,
    lines: input.lines,
    payment_lines: input.paymentLines,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Respuesta inválida al crear la venta.");
  return data;
};
