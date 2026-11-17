import { supabase } from "../../lib/supabase";
import type { CashSession, OpenCashInput } from "./types";
import type { ManualCashMovementInput, ReverseManualCashMovementInput } from "./schemas";

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
  // Exclude sessions that have an entry in cash_closures (Finding 23).
  // A failed closure query must not make a closed cash drawer look open.
  const { data: closures, error: closeErr } = await client()
    .from("cash_closures")
    .select("cash_session_id");
  if (closeErr) throw closeErr;

  const closedIds = new Set((closures || []).map((c) => c.cash_session_id));
  const { data, error } = await client()
    .from("cash_sessions")
    .select("id,branch_id,cash_register_id,opened_at,reason")
    .order("opened_at", { ascending: false });
  if (error) throw error;

  const openSessions = (data ?? []).filter((s) => !closedIds.has(s.id));
  return openSessions as CashSession[];
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

export const postManualCashMovement = async (input: ManualCashMovementInput): Promise<string> => {
  const { data, error } = await client().rpc("post_cash_movement", {
    target_cash_session_id: input.cashSessionId,
    movement_kind: input.kind,
    movement_currency: input.currencyCode,
    movement_amount: input.amount,
    operation_key: input.operationKey,
    operation_reason: input.reason,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Respuesta inválida al registrar el movimiento de caja.");
  return data;
};

export const reverseManualCashMovement = async (
  input: ReverseManualCashMovementInput,
): Promise<string> => {
  const { data, error } = await client().rpc("reverse_manual_cash_movement", {
    target_cash_movement_id: input.cashMovementId,
    operation_key: input.operationKey,
    operation_reason: input.reason,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Respuesta inválida al revertir el movimiento de caja.");
  return data;
};
