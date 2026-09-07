import { supabase } from "../../lib/supabase";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

export interface AuditEventRow {
  id: number;
  occurred_at: string;
  actor_user_id: string | null;
  schema_name: string;
  table_name: string;
  record_id: string | null;
  action: string;
  reason: string | null;
  correlation_id: string;
  metadata: Record<string, unknown>;
}

export interface AuditEventsResult {
  rows: AuditEventRow[];
  /** false cuando la columna actor_user_id no es visible (RLS/grant) y se usó fallback. */
  actorColumnAvailable: boolean;
}

const FULL_COLUMNS =
  "id,occurred_at,actor_user_id,schema_name,table_name,record_id,action,reason,correlation_id,metadata";
const FALLBACK_COLUMNS =
  "id,occurred_at,schema_name,table_name,record_id,action,reason,correlation_id,metadata";

const asRows = (value: unknown): AuditEventRow[] =>
  Array.isArray(value) ? (value as AuditEventRow[]) : [];

const isColumnOrPermissionError = (message: string): boolean =>
  /actor_user_id|column|permission|denied|42501|42703|not granted|RLS|row-level/i.test(message);

/**
 * Lee erp.audit_events (SELECT requiere permiso audit.view por RLS).
 * Intenta incluir actor_user_id; si RLS/grants lo bloquean, reintenta sin
 * esa columna y lo informa con actorColumnAvailable=false (sin migraciones).
 */
export const listAuditEvents = async (limit = 100): Promise<AuditEventsResult> => {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const { data, error } = await client()
    .from("audit_events")
    .select(FULL_COLUMNS)
    .order("occurred_at", { ascending: false })
    .limit(safeLimit);

  if (!error) return { rows: asRows(data), actorColumnAvailable: true };

  if (!isColumnOrPermissionError(error.message)) throw error;

  const retry = await client()
    .from("audit_events")
    .select(FALLBACK_COLUMNS)
    .order("occurred_at", { ascending: false })
    .limit(safeLimit);
  if (retry.error) throw retry.error;
  return {
    rows: asRows(retry.data).map((r) => ({ ...r, actor_user_id: null })),
    actorColumnAvailable: false,
  };
};

const metaString = (metadata: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
};

export const extractActorLabel = (row: AuditEventRow): string => {
  if (row.actor_user_id) return `Usuario ${row.actor_user_id.slice(0, 8)}`;
  const fromMeta = metaString(row.metadata, ["actor_name", "actor", "user_email", "created_by"]);
  return fromMeta ?? "Sistema";
};

export const extractActorDetail = (row: AuditEventRow): string =>
  metaString(row.metadata, ["role", "actor_role"]) ?? row.action;

export const extractIp = (row: AuditEventRow): string | null =>
  metaString(row.metadata, ["ip", "ip_address", "client_ip", "source_ip"]);
