import { supabase } from "../../lib/supabase";
import type { CashSession, OpenCashInput } from "./types";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

export interface CloseCashInput {
  cashSessionId: string;
  operationKey: string;
  reason: string;
  countedAmounts: Array<{ currency_code: string; amount: number }>;
}

export const listOpenCashSessions = async (): Promise<CashSession[]> => {
  try {
    // Exclude sessions that have an entry in cash_closures (Finding 23)
    const { data: closures, error: closeErr } = await client()
      .from("cash_closures")
      .select("cash_session_id");

    if (closeErr) {
      console.warn("Aviso al consultar cash_closures:", closeErr.message);
    }

    const closedIds = new Set((closures || []).map((c) => c.cash_session_id));

    const { data, error } = await client()
      .from("cash_sessions")
      .select("id,branch_id,cash_register_id,opened_at,reason")
      .order("opened_at", { ascending: false });

    if (error) {
      console.warn("Aviso al consultar cash_sessions:", error.message);
      return [];
    }

    const openSessions = (data ?? []).filter((s) => !closedIds.has(s.id));
    return openSessions as CashSession[];
  } catch (err) {
    console.warn("Error en listOpenCashSessions:", err);
    return [];
  }
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

export const closeCashSession = async (input: CloseCashInput): Promise<string> => {
  const { data, error } = await client().rpc("close_cash_session", {
    target_cash_session_id: input.cashSessionId,
    operation_key: input.operationKey,
    operation_reason: input.reason,
    counted_amounts: input.countedAmounts,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Respuesta inválida al cerrar la sesión de caja.");
  return data;
};
