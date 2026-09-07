import { supabase } from "../../lib/supabase";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

const newOpKey = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export type TradeInStage = "applied_to_sale" | "ready_for_stock" | "evaluating" | "quarantine";
export type ProvenanceDecision = "approved" | "rejected" | null;
export type ImeiStatus = "clear" | "blocked" | "checking" | "unavailable" | "error" | "not_required" | null;
export type EvaluationDecision = "approved" | "rejected" | string | null;

export interface TradeInOverview {
  id: string;
  organization_id: string | null;
  branch_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  product_id: string | null;
  product_name: string | null;
  product_code: string | null;
  variant_id: string | null;
  variant_code: string | null;
  variant_name: string | null;
  inventory_unit_id: string | null;
  serial_number: string | null;
  imei: string | null;
  unit_status: string | null;
  declared_value_base: number | null;
  received_at: string | null;
  provenance_decision: ProvenanceDecision;
  provenance_reviewed_at: string | null;
  imei_request_version: number | null;
  imei_status: ImeiStatus;
  imei_source: string | null;
  imei_checked_at: string | null;
  evaluation_id: string | null;
  evaluation_version: number | null;
  appraised_value_base: number | null;
  estimated_refurbishment_cost_base: number | null;
  evaluation_decision: EvaluationDecision;
  actual_refurbishment_cost: number | null;
  release_id: string | null;
  release_total_cost: number | null;
  release_location_id: string | null;
  released_at: string | null;
  payment_id: string | null;
  sale_id: string | null;
  payment_amount: number | null;
  payment_applied_at: string | null;
  stage: TradeInStage;
}

interface TradeInOverviewRow {
  id: string;
  organization_id: string | null;
  branch_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  product_id: string | null;
  product_name: string | null;
  product_code: string | null;
  variant_id: string | null;
  variant_code: string | null;
  variant_name: string | null;
  inventory_unit_id: string | null;
  serial_number: string | null;
  imei: string | null;
  unit_status: string | null;
  declared_value_base: number | string | null;
  received_at: string | null;
  provenance_decision: ProvenanceDecision;
  provenance_reviewed_at: string | null;
  imei_request_version: number | string | null;
  imei_status: ImeiStatus;
  imei_source: string | null;
  imei_checked_at: string | null;
  evaluation_id: string | null;
  evaluation_version: number | string | null;
  appraised_value_base: number | string | null;
  estimated_refurbishment_cost_base: number | string | null;
  evaluation_decision: EvaluationDecision;
  actual_refurbishment_cost: number | string | null;
  release_id: string | null;
  release_total_cost: number | string | null;
  release_location_id: string | null;
  released_at: string | null;
  payment_id: string | null;
  sale_id: string | null;
  payment_amount: number | string | null;
  payment_applied_at: string | null;
  stage: TradeInStage;
}

const toNumberOrNull = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
};

const toIntOrNull = (value: number | string | null | undefined): number | null => {
  const n = toNumberOrNull(value);
  return n === null ? null : Math.trunc(n);
};

const mapRow = (row: TradeInOverviewRow): TradeInOverview => ({
  id: row.id,
  organization_id: row.organization_id,
  branch_id: row.branch_id,
  customer_id: row.customer_id,
  customer_name: row.customer_name,
  customer_code: row.customer_code,
  customer_phone: row.customer_phone,
  product_id: row.product_id,
  product_name: row.product_name,
  product_code: row.product_code,
  variant_id: row.variant_id,
  variant_code: row.variant_code,
  variant_name: row.variant_name,
  inventory_unit_id: row.inventory_unit_id,
  serial_number: row.serial_number,
  imei: row.imei,
  unit_status: row.unit_status,
  declared_value_base: toNumberOrNull(row.declared_value_base),
  received_at: row.received_at,
  provenance_decision: row.provenance_decision,
  provenance_reviewed_at: row.provenance_reviewed_at,
  imei_request_version: toIntOrNull(row.imei_request_version),
  imei_status: row.imei_status,
  imei_source: row.imei_source,
  imei_checked_at: row.imei_checked_at,
  evaluation_id: row.evaluation_id,
  evaluation_version: toIntOrNull(row.evaluation_version),
  appraised_value_base: toNumberOrNull(row.appraised_value_base),
  estimated_refurbishment_cost_base: toNumberOrNull(row.estimated_refurbishment_cost_base),
  evaluation_decision: row.evaluation_decision,
  actual_refurbishment_cost: toNumberOrNull(row.actual_refurbishment_cost),
  release_id: row.release_id,
  release_total_cost: toNumberOrNull(row.release_total_cost),
  release_location_id: row.release_location_id,
  released_at: row.released_at,
  payment_id: row.payment_id,
  sale_id: row.sale_id,
  payment_amount: toNumberOrNull(row.payment_amount),
  payment_applied_at: row.payment_applied_at,
  stage: row.stage,
});

export const isTradeInRejected = (t: TradeInOverview): boolean =>
  t.provenance_decision === "rejected" || t.evaluation_decision === "rejected";

export const isImeiVerified = (t: TradeInOverview): boolean =>
  t.imei_status === "clear" || t.imei_status === "not_required";

export const listTradeIns = async (): Promise<TradeInOverview[]> => {
  const { data, error } = await client()
    .from("trade_ins_overview")
    .select("*")
    .order("received_at", { ascending: false });

  if (error) throw error;
  return ((data || []) as TradeInOverviewRow[]).map(mapRow);
};

export interface IntakeTradeInDirectInput {
  branchId: string;
  customerId: string;
  productId: string;
  variantId?: string | null;
  deviceSerial?: string | null;
  deviceImei?: string | null;
  ownerName: string;
  declarationText: string;
  declaredValue: number;
  evidenceDoc?: string | null;
  operationReason?: string;
}

export const intakeTradeInDirect = async (input: IntakeTradeInDirectInput): Promise<string> => {
  const { data, error } = await client().rpc("intake_trade_in_direct", {
    target_branch_id: input.branchId,
    target_customer_id: input.customerId,
    target_product_id: input.productId,
    target_variant_id: input.variantId || null,
    device_serial: input.deviceSerial || null,
    device_imei: input.deviceImei || null,
    owner_name: input.ownerName,
    declaration_text: input.declarationText,
    declared_value: input.declaredValue,
    evidence_doc: input.evidenceDoc || null,
    operation_reason: input.operationReason || "Recepción de equipo en canje",
  });

  if (error) throw error;
  return data as string;
};

export const reviewTradeInProvenance = async (
  tradeInId: string,
  decision: "approved" | "rejected",
  operationReason?: string
): Promise<string> => {
  const { data, error } = await client().rpc("review_trade_in_provenance", {
    target_trade_in_id: tradeInId,
    decision,
    operation_reason: operationReason || "Revisión de procedencia del equipo",
  });

  if (error) throw error;
  return data as string;
};

export const requestTradeInImeiCheck = async (
  tradeInId: string,
  providerName: string,
  operationReason?: string
): Promise<string> => {
  const { data, error } = await client().rpc("request_trade_in_imei_check", {
    target_trade_in_id: tradeInId,
    provider_name: providerName,
    operation_key: newOpKey("imei"),
    operation_reason: operationReason || "Solicitud de verificación IMEI",
  });

  if (error) throw error;
  return data as string;
};

export type ImeiManualFallbackStatus = "clear" | "not_required";

export const recordTradeInImeiManualFallback = async (
  tradeInId: string,
  fallbackStatus: ImeiManualFallbackStatus,
  documentation: Record<string, string | number | boolean | null>,
  operationReason?: string
): Promise<string> => {
  const keys = Object.keys(documentation || {});
  if (keys.length === 0) throw new Error("La documentación del respaldo manual no puede estar vacía.");
  const payloadSize = new Blob([JSON.stringify(documentation)]).size;
  if (payloadSize > 256 * 1024) throw new Error("La documentación supera el máximo de 256KB.");

  const { data, error } = await client().rpc("record_trade_in_imei_manual_fallback", {
    target_trade_in_id: tradeInId,
    fallback_status: fallbackStatus,
    documentation,
    operation_key: newOpKey("imei-fb"),
    operation_reason: operationReason || "Respaldo manual de verificación IMEI",
  });

  if (error) throw error;
  return data as string;
};

export const createTradeInEvaluation = async (
  tradeInId: string,
  conditionSnapshot: Record<string, string | number | boolean | null>,
  appraisedValueBase: number,
  estimatedRefurbishmentCostBase: number,
  operationReason?: string
): Promise<string> => {
  const { data, error } = await client().rpc("create_trade_in_evaluation", {
    target_trade_in_id: tradeInId,
    condition_snapshot: conditionSnapshot,
    appraised_value_base: appraisedValueBase,
    estimated_refurbishment_cost_base: estimatedRefurbishmentCostBase,
    operation_key: newOpKey("eval"),
    operation_reason: operationReason || "Tasación técnica del equipo",
  });

  if (error) throw error;
  return data as string;
};

export const reviewTradeInEvaluation = async (
  evaluationId: string,
  decision: "approved" | "rejected",
  operationReason?: string
): Promise<string> => {
  const { data, error } = await client().rpc("review_trade_in_evaluation", {
    target_evaluation_id: evaluationId,
    decision,
    operation_reason: operationReason || "Revisión de tasación del equipo",
  });

  if (error) throw error;
  return data as string;
};

export const recordTradeInRefurbishment = async (
  tradeInId: string,
  description: string,
  actualCostBase: number,
  repairOrderId?: string | null,
  completed = true,
  operationReason?: string
): Promise<string> => {
  const { data, error } = await client().rpc("record_trade_in_refurbishment", {
    target_trade_in_id: tradeInId,
    target_repair_order_id: repairOrderId || null,
    description,
    actual_cost_base: actualCostBase,
    completed,
    operation_key: newOpKey("refurb"),
    operation_reason: operationReason || "Registro de reacondicionamiento",
  });

  if (error) throw error;
  return data as string;
};

export const releaseTradeInToStock = async (
  tradeInId: string,
  locationId: string,
  operationReason?: string
): Promise<string> => {
  const { data, error } = await client().rpc("release_trade_in_to_stock", {
    target_trade_in_id: tradeInId,
    target_location_id: locationId,
    operation_key: newOpKey("release"),
    operation_reason: operationReason || "Liberación del equipo a stock",
  });

  if (error) throw error;
  return data as string;
};

export const applyTradeInSalePayment = async (
  tradeInId: string,
  saleId: string,
  paymentAmount: number,
  operationReason?: string
): Promise<string> => {
  const { data, error } = await client().rpc("apply_trade_in_sale_payment", {
    target_trade_in_id: tradeInId,
    target_sale_id: saleId,
    payment_amount: paymentAmount,
    operation_key: newOpKey("pay"),
    operation_reason: operationReason || "Aplicación del canje como pago",
  });

  if (error) throw error;
  return data as string;
};

export const reverseTradeInSalePayment = async (
  paymentId: string,
  operationReason?: string
): Promise<void> => {
  const { error } = await client().rpc("reverse_trade_in_sale_payment", {
    target_payment_id: paymentId,
    operation_key: newOpKey("pay-rev"),
    operation_reason: operationReason || "Reversión del pago aplicado",
  });

  if (error) throw error;
};

export const getTradeInCosts = async (tradeInId: string): Promise<unknown> => {
  const { data, error } = await client().rpc("get_trade_in_costs", {
    target_trade_in_id: tradeInId,
  });

  if (error) throw error;
  return data as unknown;
};
