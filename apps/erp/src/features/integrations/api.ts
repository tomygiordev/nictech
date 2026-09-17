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
  retry_request_id: string | null;
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
  /** false cuando la lectura falla; el esquema vigente sí concede SELECT con RLS. */
  available: boolean;
  errorMessage: string | null;
}

export type IntegrationRetryAction = "retry" | "recover";

export interface IntegrationRetryRequestRow {
  id: string;
  outbox_id: string;
  action: IntegrationRetryAction;
  request_origin: "operator" | "automatic";
  reason: string;
  attempt_count_snapshot: number;
  retry_sequence: number;
  available_at: string;
  requested_at: string;
  requested_by: string | null;
}

const asOutbox = (value: unknown): IntegrationOutboxRow[] =>
  Array.isArray(value) ? (value as IntegrationOutboxRow[]) : [];

const asAttempts = (value: unknown): IntegrationAttemptRow[] =>
  Array.isArray(value) ? (value as IntegrationAttemptRow[]) : [];

const asDeadLetters = (value: unknown): DeadLetterRow[] =>
  Array.isArray(value) ? (value as DeadLetterRow[]) : [];

const asRetryRequests = (value: unknown): IntegrationRetryRequestRow[] =>
  Array.isArray(value) ? (value as IntegrationRetryRequestRow[]) : [];

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
    .select("id,outbox_id,attempt_number,status,error_message,attempted_at,attempted_by,retry_request_id")
    .in("outbox_id", unique)
    .order("attempted_at", { ascending: false });
  if (error) throw error;
  return asAttempts(data);
};

/** Lee DLQ con RLS por organización, sucursal e integrations.view. */
export const listDeadLetters = async (): Promise<DeadLettersResult> => {
  const { data, error } = await client()
    .from("integration_dead_letters")
    .select("id,branch_id,outbox_id,reason,moved_at,moved_by")
    .order("moved_at", { ascending: false })
    .limit(100);
  if (!error) return { rows: asDeadLetters(data), available: true, errorMessage: null };
  return { rows: [], available: false, errorMessage: error.message };
};

/** Solicitudes de retry/recovery visibles para los mismos eventos del operador. */
export const listIntegrationRetryRequests = async (
  outboxIds: string[],
): Promise<IntegrationRetryRequestRow[]> => {
  const unique = Array.from(new Set(outboxIds)).filter((id) => UUID_RE.test(id));
  if (unique.length === 0) return [];
  const { data, error } = await client()
    .from("integration_retry_requests")
    .select(
      "id,outbox_id,action,request_origin,reason,attempt_count_snapshot,retry_sequence,available_at,requested_at,requested_by",
    )
    .in("outbox_id", unique)
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return asRetryRequests(data);
};

export const requestIntegrationRetry = async (
  outboxId: string,
  action: IntegrationRetryAction,
  reason: string,
  operationKey: string,
): Promise<string> => {
  if (!UUID_RE.test(outboxId)) throw new Error("El evento de outbox debe ser un UUID válido.");
  if (action !== "retry" && action !== "recover") throw new Error("La acción de recuperación no es válida.");
  if (reason.trim() === "") throw new Error("El motivo del reintento es obligatorio.");
  if (operationKey.trim() === "") throw new Error("La clave de operación es obligatoria.");
  const { data, error } = await client().rpc("request_integration_retry", {
    target_outbox_id: outboxId,
    requested_action: action,
    operation_key: operationKey.trim(),
    operation_reason: reason.trim(),
  });
  if (error) throw error;
  if (typeof data !== "string" || !UUID_RE.test(data)) {
    throw new Error("Respuesta inválida al programar la integración.");
  }
  return data;
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
