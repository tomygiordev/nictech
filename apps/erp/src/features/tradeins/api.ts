import { supabase } from "../../lib/supabase";
import type { Database, Json } from "../../types/supabase";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

const newOpKey = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export type TradeInStage = "applied_to_sale" | "ready_for_stock" | "evaluating" | "quarantine";
export type ProvenanceDecision = Database["erp"]["Enums"]["trade_in_review_decision"] | null;
export type ImeiStatus = Database["erp"]["Enums"]["imei_check_status"] | null;
export type EvaluationDecision = Database["erp"]["Enums"]["trade_in_review_decision"] | null;

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
  unit_status: Database["erp"]["Enums"]["inventory_unit_status"] | null;
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

type TradeInOverviewRow = Database["erp"]["Views"]["trade_ins_overview"]["Row"];
type JsonObject = { [key: string]: Json | undefined };

const requireTradeInId = (value: string | null): string => {
  if (value === null) throw new Error("La vista de canjes devolvió un id nulo.");
  return value;
};

const parseTradeInStage = (value: string | null): TradeInStage => {
  if (value === "applied_to_sale" || value === "ready_for_stock" || value === "evaluating" || value === "quarantine") {
    return value;
  }
  throw new Error(`El canje devolvió una etapa inválida: ${value ?? "null"}.`);
};

const mapRow = (row: TradeInOverviewRow): TradeInOverview => ({
  id: requireTradeInId(row.id),
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
  declared_value_base: row.declared_value_base,
  received_at: row.received_at,
  provenance_decision: row.provenance_decision,
  provenance_reviewed_at: row.provenance_reviewed_at,
  imei_request_version: row.imei_request_version,
  imei_status: row.imei_status,
  imei_source: row.imei_source,
  imei_checked_at: row.imei_checked_at,
  evaluation_id: row.evaluation_id,
  evaluation_version: row.evaluation_version,
  appraised_value_base: row.appraised_value_base,
  estimated_refurbishment_cost_base: row.estimated_refurbishment_cost_base,
  evaluation_decision: row.evaluation_decision,
  actual_refurbishment_cost: row.actual_refurbishment_cost,
  release_id: row.release_id,
  release_total_cost: row.release_total_cost,
  release_location_id: row.release_location_id,
  released_at: row.released_at,
  payment_id: row.payment_id,
  sale_id: row.sale_id,
  payment_amount: row.payment_amount,
  payment_applied_at: row.payment_applied_at,
  stage: parseTradeInStage(row.stage),
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
  return (data ?? []).map(mapRow);
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
    device_serial: input.deviceSerial || "",
    device_imei: input.deviceImei || "",
    owner_name: input.ownerName,
    declaration_text: input.declarationText,
    declared_value: input.declaredValue,
    evidence_doc: input.evidenceDoc || undefined,
    operation_reason: input.operationReason || "Recepción de equipo en canje",
  });

  if (error) throw error;
  return data;
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
  return data;
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
  return data;
};

export type ImeiManualFallbackStatus = "clear" | "not_required";

export const recordTradeInImeiManualFallback = async (
  tradeInId: string,
  fallbackStatus: ImeiManualFallbackStatus,
  documentation: JsonObject,
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
  return data;
};

export const createTradeInEvaluation = async (
  tradeInId: string,
  conditionSnapshot: JsonObject,
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
  return data;
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
  return data;
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
  return data;
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
  return data;
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
  return data;
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

export type TradeInCosts = Database["erp"]["Functions"]["get_trade_in_costs"]["Returns"];

export const getTradeInCosts = async (tradeInId: string): Promise<TradeInCosts> => {
  const { data, error } = await client().rpc("get_trade_in_costs", {
    target_trade_in_id: tradeInId,
  });

  if (error) throw error;
  return data;
};

export interface TradeInLocationOption {
  id: string;
  branch_id: string;
  name: string;
}

export interface TradeInSaleOption {
  saleId: string;
  documentNumber: string;
  issuedAt: string;
  customerName: string;
  totalArs: number | null;
}

export interface TradeInRepairOrderOption {
  id: string;
  orderCode: string;
  openedAt: string | null;
  customerName: string;
  equipmentLabel: string;
  statusLabel: string;
}

const extractRelationDisplayName = (
  relation: { display_name?: string | null } | Array<{ display_name?: string | null }> | null | undefined,
): string => {
  if (!relation) return "";
  const row = Array.isArray(relation) ? relation[0] : relation;
  return typeof row?.display_name === "string" ? row.display_name.trim() : "";
};

export const listTradeInLocations = async (): Promise<TradeInLocationOption[]> => {
  const { data, error } = await client()
    .from("locations")
    .select("id, branch_id, name")
    .eq("is_active", true)
    .eq("allows_sale", true)
    .order("name", { ascending: true });

  if (error) throw error;
  return data ?? [];
};

export const listRecentBranchSales = async (
  branchId: string,
  customerId: string,
): Promise<TradeInSaleOption[]> => {
  const sb = client();
  const { data: saleRows, error: saleError } = await sb
    .from("sales")
    .select("id, confirmed_at, total_amount, exchange_rate, currency_code, customers(display_name)")
    .eq("branch_id", branchId)
    .eq("customer_id", customerId)
    .order("confirmed_at", { ascending: false })
    .limit(50);
  if (saleError) throw saleError;
  const sales = saleRows ?? [];
  if (sales.length === 0) return [];

  const { data: cancelledRows, error: cancelledError } = await sb
    .from("sale_state_events")
    .select("sale_id")
    .in("sale_id", sales.map((sale) => sale.id))
    .eq("sale_state", "cancelled");
  if (cancelledError) throw cancelledError;

  const cancelledSaleIds = new Set((cancelledRows ?? []).map((row) => row.sale_id));
  const activeSales = sales.filter((sale) => !cancelledSaleIds.has(sale.id));
  if (activeSales.length === 0) return [];

  const { data: docRows, error: docError } = await sb
    .from("documents")
    .select("owner_id, document_number, issued_at")
    .eq("owner_type", "sale")
    .in("owner_id", activeSales.map((sale) => sale.id))
    .order("issued_at", { ascending: true });
  if (docError) throw docError;

  const numberBySale = new Map<string, string>();
  for (const doc of docRows ?? []) {
    if (!numberBySale.has(doc.owner_id)) numberBySale.set(doc.owner_id, doc.document_number);
  }

  return activeSales.map((sale) => {
    const rawTotal = Number(sale.total_amount);
    const rate = Number(sale.exchange_rate);
    const totalArs = !Number.isFinite(rawTotal)
      ? null
      : sale.currency_code.toUpperCase() === "ARS"
        ? rawTotal
        : Number.isFinite(rate)
          ? rawTotal * rate
          : null;
    return {
      saleId: sale.id,
      documentNumber: numberBySale.get(sale.id) ?? `Venta ${sale.id.slice(0, 8).toUpperCase()}`,
      issuedAt: sale.confirmed_at,
      customerName: extractRelationDisplayName(sale.customers) || "Cliente",
      totalArs,
    };
  });
};

export const listRecentBranchRepairOrders = async (
  branchId: string,
  customerId: string,
): Promise<TradeInRepairOrderOption[]> => {
  const { data, error } = await client()
    .from("repair_orders_overview")
    .select("id, order_code, opened_at, customer_name, brand_snapshot, model_snapshot, status_name, delivery_id")
    .eq("branch_id", branchId)
    .eq("customer_id", customerId)
    .not("delivery_id", "is", null)
    .order("opened_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  return (data ?? [])
    .filter((row): row is typeof row & { id: string } => typeof row.id === "string" && row.id.length > 0)
    .map((row) => ({
      id: row.id,
      orderCode: row.order_code || row.id.slice(0, 8),
      openedAt: row.opened_at,
      customerName: row.customer_name || "Cliente",
      equipmentLabel: [row.brand_snapshot, row.model_snapshot].filter(Boolean).join(" "),
      statusLabel: row.delivery_id ? "Entregado" : row.status_name || "En taller",
    }));
};
