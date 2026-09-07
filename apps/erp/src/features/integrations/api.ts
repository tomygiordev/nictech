import { supabase } from "../../lib/supabase";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IntegrationOutboxRow {
  id: string;
  branch_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  available_at: string;
  created_at: string;
}

export type IntegrationAttemptStatus = "succeeded" | "failed";

export interface IntegrationAttemptRow {
  id: string;
  outbox_id: string;
  attempt_number: number;
  status: IntegrationAttemptStatus;
  error_message: string | null;
  attempted_at: string;
  attempted_by: string | null;
}

export interface DeadLetterRow {
  id: string;
  branch_id: string;
  outbox_id: string;
  reason: string;
  moved_at: string;
  moved_by: string | null;
}

export interface DeadLettersResult {
  rows: DeadLetterRow[];
  /** false cuando authenticated no tiene GRANT sobre erp.integration_dead_letters. */
  available: boolean;
  errorMessage: string | null;
}

const asOutbox = (value: unknown): IntegrationOutboxRow[] =>
  Array.isArray(value) ? (value as IntegrationOutboxRow[]) : [];

const asAttempts = (value: unknown): IntegrationAttemptRow[] =>
  Array.isArray(value) ? (value as IntegrationAttemptRow[]) : [];

const asDeadLetters = (value: unknown): DeadLetterRow[] =>
  Array.isArray(value) ? (value as DeadLetterRow[]) : [];

/** Lee erp.integration_outbox (SELECT con permiso integrations.view por RLS). */
export const listIntegrationOutbox = async (limit = 100): Promise<IntegrationOutboxRow[]> => {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const { data, error } = await client()
    .from("integration_outbox")
    .select(
      "id,branch_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key,available_at,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return asOutbox(data);
};

/** Lee erp.integration_attempts para los outbox indicados. */
export const listIntegrationAttempts = async (outboxIds: string[]): Promise<IntegrationAttemptRow[]> => {
  const unique = Array.from(new Set(outboxIds)).filter((id) => UUID_RE.test(id));
  if (unique.length === 0) return [];
  const { data, error } = await client()
    .from("integration_attempts")
    .select("id,outbox_id,attempt_number,status,error_message,attempted_at,attempted_by")
    .in("outbox_id", unique)
    .order("attempted_at", { ascending: false });
  if (error) throw error;
  return asAttempts(data);
};

/**
 * Lee erp.integration_dead_letters. La migración 009 otorga SELECT solo a
 * service_role (authenticated no tiene grant aunque exista policy RLS), por lo
 * que un 42501/permiso denegado se informa como available=false sin lanzar.
 */
export const listDeadLetters = async (): Promise<DeadLettersResult> => {
  const { data, error } = await client()
    .from("integration_dead_letters")
    .select("id,branch_id,outbox_id,reason,moved_at,moved_by")
    .order("moved_at", { ascending: false })
    .limit(100);
  if (!error) return { rows: asDeadLetters(data), available: true, errorMessage: null };
  return { rows: [], available: false, errorMessage: error.message };
};

/**
 * Mueve un outbox con fallos a dead letters (requiere permiso
 * integrations.retry + al menos un intento failed + motivo).
 */
export const moveIntegrationToDeadLetter = async (outboxId: string, reason: string): Promise<string> => {
  if (!UUID_RE.test(outboxId)) throw new Error("El evento de outbox es obligatorio y debe ser un UUID válido.");
  if (reason.trim() === "") throw new Error("El motivo del pase a dead letter es obligatorio.");
  const { data, error } = await client().rpc("move_integration_to_dead_letter", {
    target_outbox_id: outboxId,
    operation_reason: reason.trim(),
  });
  if (error) throw error;
  if (typeof data !== "string" || !UUID_RE.test(data)) {
    throw new Error("Respuesta inválida al mover a dead letter.");
  }
  return data;
};
