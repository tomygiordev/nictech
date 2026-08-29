import { supabase } from "../../lib/supabase";
import type { CashSession, OpenCashInput } from "./types";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

export const listOpenCashSessions = async (): Promise<CashSession[]> => {
  const { data, error } = await client().from("cash_sessions").select("id,branch_id,cash_register_id,opened_at,reason").order("opened_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CashSession[];
};

export const openCashSession = async (input: OpenCashInput): Promise<string> => {
  const { data, error } = await client().rpc("open_cash_session", {
    target_cash_register_id: input.cashRegisterId,
    operation_key: input.operationKey,
    operation_reason: input.reason,
    opening_counts: input.openingCounts,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Respuesta inválida al abrir la caja.");
  return data;
};
