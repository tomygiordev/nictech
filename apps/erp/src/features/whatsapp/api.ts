import { supabase } from "../../lib/supabase";
import { generateIdempotencyKey } from "../../lib/formatters";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

export const newOpKey = (prefix: string): string => generateIdempotencyKey(prefix);

const parseRpcId = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Respuesta inválida para ${label}.`);
  }
  return value;
};

export type CommunicationChannel = "whatsapp" | "email";
export type CommunicationDirection = "inbound" | "outbound";
export type CommunicationStatus = "queued" | "sent" | "delivered" | "read" | "failed";

export interface Conversation {
  id: string;
  branch_id: string;
  customer_id: string | null;
  channel: CommunicationChannel;
  opened_at: string;
  closed_at: string | null;
}

export interface ConversationCustomer {
  id: string;
  display_name: string;
  code: string;
  phone: string | null;
}

export interface MessageTemplate {
  id: string;
  code: string;
  channel: CommunicationChannel;
  name: string;
  is_active: boolean;
}

export interface MessageTemplateVersion {
  id: string;
  template_id: string;
  version: number;
  provider_template_name: string | null;
  language_code: string;
  body: string;
  variable_keys: string[];
}

export interface ConversationMessage {
  id: string;
  branch_id: string;
  conversation_id: string;
  customer_id: string | null;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  template_version_id: string | null;
  body_snapshot: string;
  variables_snapshot: Record<string, string>;
  created_at: string;
}

export interface MessageEvent {
  id: string;
  event_sequence: number;
  message_id: string;
  status: CommunicationStatus;
  provider: string | null;
  occurred_at: string;
}

export interface ConsentRecord {
  id: string;
  customer_id: string;
  channel: CommunicationChannel;
  granted: boolean;
  source: string;
  reason: string;
  recorded_at: string;
}

export interface AssignmentRecord {
  id: string;
  conversation_id: string;
  assigned_user_id: string | null;
  reason: string;
  assigned_at: string;
}

export interface RecordConsentInput {
  branchId: string;
  customerId: string;
  granted: boolean;
  source: string;
  reason: string;
}

export interface QueueMessageInput {
  branchId: string;
  customerId: string;
  conversationId: string | null;
  templateVersionId: string;
  recipientAddress: string;
  variables: Record<string, string>;
  reason: string;
}

export interface AssignConversationInput {
  conversationId: string;
  userId: string | null;
  reason: string;
}

export const listConversations = async (): Promise<Conversation[]> => {
  const { data, error } = await client()
    .from("conversations")
    .select("id,branch_id,customer_id,channel,opened_at,closed_at")
    .eq("channel", "whatsapp")
    .order("opened_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Conversation[];
};

export const listConversationCustomers = async (customerIds: string[]): Promise<ConversationCustomer[]> => {
  if (customerIds.length === 0) return [];
  const uniqueIds = Array.from(new Set(customerIds));
  const { data, error } = await client()
    .from("customers")
    .select("id,display_name,code,phone")
    .in("id", uniqueIds);
  if (error) throw error;
  return (data ?? []) as ConversationCustomer[];
};

export const listMessageTemplates = async (): Promise<MessageTemplate[]> => {
  const { data, error } = await client()
    .from("message_templates")
    .select("*")
    .eq("channel", "whatsapp")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MessageTemplate[];
};

export const listMessageTemplateVersions = async (templateId: string): Promise<MessageTemplateVersion[]> => {
  const { data, error } = await client()
    .from("message_template_versions")
    .select("*")
    .eq("template_id", templateId)
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MessageTemplateVersion[];
};

export const listConversationMessages = async (conversationId: string): Promise<ConversationMessage[]> => {
  const { data, error } = await client()
    .from("communication_messages")
    .select(
      "id,branch_id,conversation_id,customer_id,channel,direction,template_version_id,body_snapshot,variables_snapshot,created_at"
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ConversationMessage[];
};

export const listMessageEvents = async (messageIds: string[]): Promise<MessageEvent[]> => {
  if (messageIds.length === 0) return [];
  const { data, error } = await client()
    .from("communication_message_events")
    .select("id,event_sequence,message_id,status,provider,occurred_at")
    .in("message_id", messageIds)
    .order("event_sequence", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MessageEvent[];
};

export const listCustomerConsents = async (
  customerId: string,
  channel: CommunicationChannel = "whatsapp"
): Promise<ConsentRecord[]> => {
  const { data, error } = await client()
    .from("communication_consents")
    .select("*")
    .eq("customer_id", customerId)
    .eq("channel", channel)
    .order("event_sequence", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ConsentRecord[];
};

export const listConversationAssignments = async (conversationId: string): Promise<AssignmentRecord[]> => {
  const { data, error } = await client()
    .from("conversation_assignments")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("event_sequence", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AssignmentRecord[];
};

export const recordConsent = async (input: RecordConsentInput): Promise<string> => {
  if (input.source.trim() === "") throw new Error("El origen del consentimiento es obligatorio.");
  if (input.reason.trim() === "") throw new Error("El motivo del consentimiento es obligatorio.");
  const { data, error } = await client().rpc("record_communication_consent", {
    target_branch_id: input.branchId,
    target_customer_id: input.customerId,
    target_channel: "whatsapp",
    granted: input.granted,
    source: input.source.trim(),
    operation_key: newOpKey("consent"),
    operation_reason: input.reason.trim(),
  });
  if (error) throw error;
  return parseRpcId(data, "consentimiento");
};

export const queueMessage = async (input: QueueMessageInput): Promise<string> => {
  if (input.recipientAddress.trim() === "") throw new Error("La dirección del destinatario es obligatoria.");
  if (input.reason.trim() === "") throw new Error("El motivo del mensaje es obligatorio.");
  const { data, error } = await client().rpc("queue_customer_message", {
    target_branch_id: input.branchId,
    target_customer_id: input.customerId,
    target_conversation_id: input.conversationId,
    target_template_version_id: input.templateVersionId,
    recipient_address: input.recipientAddress.trim(),
    variables: input.variables,
    operation_key: newOpKey("wamsg"),
    operation_reason: input.reason.trim(),
  });
  if (error) throw error;
  return parseRpcId(data, "mensaje encolado");
};

export const assignConversation = async (input: AssignConversationInput): Promise<string> => {
  if (input.reason.trim() === "") throw new Error("El motivo de la asignación es obligatorio.");
  const { data, error } = await client().rpc("assign_conversation", {
    target_conversation_id: input.conversationId,
    target_user_id: input.userId,
    operation_key: newOpKey("waassign"),
    operation_reason: input.reason.trim(),
  });
  if (error) throw error;
  return parseRpcId(data, "asignación");
};
