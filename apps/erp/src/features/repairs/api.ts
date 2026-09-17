import { supabase } from "../../lib/supabase";
import type { Database, Json } from "../../types/supabase";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

export interface RepairOrderOverview {
  id: string;
  organization_id: string;
  branch_id: string;
  order_number: number;
  order_code: string;
  opened_at: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  equipment_id: string;
  equipment_type: string;
  brand_snapshot: string;
  model_snapshot: string;
  reported_fault: string;
  intake_condition: string;
  intake_damage: string | null;
  intake_notes: string | null;
  intake_accessories: string[];
  status_id: string;
  status_code: string;
  status_name: string;
  status_is_initial: boolean;
  status_is_terminal: boolean;
  status_requires_final_tests: boolean;
  status_updated_at: string;
  status_public_message: string;
  delivery_id: string | null;
  recipient_name: string | null;
  recipient_document_suffix: string | null;
  delivered_at: string | null;
  warranty_id: string | null;
  warranty_ends_at: string | null;
  latest_quote: {
    id: string;
    version: number;
    total_amount: number;
    currency_code: string;
    issued_at: string | null;
    expires_at: string | null;
    decision: "approved" | "rejected" | null;
  } | null;
  active_parts_count: number;
  qc_passed: boolean;
}

export interface RepairStateEvent {
  id: string;
  repair_order_id: string;
  status_id: string;
  status_name: string;
  status_code: string;
  public_message: string;
  internal_reason: string;
  occurred_at: string;
  actor_id: string | null;
}

export interface RepairTransitionOption {
  id: string;
  to_status_id: string;
  to_status_name: string;
  to_status_code: string;
  requires_final_tests: boolean;
  is_terminal: boolean;
}

export interface IntakeRepairInput {
  branchId: string;
  customerId: string;
  equipmentType: string;
  brandName: string;
  modelName: string;
  serialNumber?: string;
  imei?: string;
  accessories?: string[];
  intakeCondition?: string;
  intakeDamage?: string;
  intakeNotes?: string;
  reportedFault: string;
  operationReason?: string;
}

export interface TestTemplateVersion {
  id: string;
  template_id: string;
  template_name: string;
  template_code: string;
  kind: "intake" | "final";
  version: number;
  definition: Array<{ key: string; label: string; required?: boolean }>;
}

const parseTestTemplateDefinition = (value: Json): TestTemplateVersion["definition"] => {
  if (!Array.isArray(value)) {
    throw new Error("La definición de la plantilla de control debe ser una lista.");
  }

  return value.map((item, index) => {
    if (!isJsonObject(item)) {
      throw new Error(`El ítem ${index + 1} de la plantilla de control no es un objeto válido.`);
    }

    const { key, label, required } = item;
    if (typeof key !== "string" || key.trim() === "" || typeof label !== "string" || label.trim() === "") {
      throw new Error(`El ítem ${index + 1} de la plantilla de control no tiene key y label válidos.`);
    }
    if (required !== undefined && typeof required !== "boolean") {
      throw new Error(`El campo required del ítem ${index + 1} debe ser booleano.`);
    }

    return required === undefined
      ? { key: key.trim(), label: label.trim() }
      : { key: key.trim(), label: label.trim(), required };
  });
};

const parseIntakeRepairResult = (value: Json): {
  repair_order_id: string;
  order_code: string;
  tracking_token: string;
  equipment_id: string;
} => {
  if (!isJsonObject(value)) {
    throw new Error("La recepción de la reparación devolvió una respuesta inválida.");
  }

  const { repair_order_id: repairOrderId, order_code: orderCode, tracking_token: trackingToken, equipment_id: equipmentId } = value;
  if (
    typeof repairOrderId !== "string" ||
    typeof orderCode !== "string" ||
    typeof trackingToken !== "string" ||
    typeof equipmentId !== "string"
  ) {
    throw new Error("La recepción de la reparación devolvió identificadores incompletos.");
  }

  return {
    repair_order_id: repairOrderId,
    order_code: orderCode,
    tracking_token: trackingToken,
    equipment_id: equipmentId,
  };
};

export interface TestRunRecord {
  id: string;
  repair_order_id: string;
  order_code?: string;
  template_version_id: string;
  kind: "intake" | "final";
  run_sequence: number;
  run_notes: string | null;
  completed_at: string;
  results: Array<{
    item_key: string;
    result: Database["erp"]["Enums"]["repair_test_result"];
    notes: string | null;
  }>;
}

export interface WarrantyRecord {
  id: string;
  repair_order_id: string;
  delivery_id: string;
  order_code: string;
  customer_name: string;
  customer_phone: string | null;
  equipment_model: string;
  starts_at: string;
  ends_at: string;
  terms_snapshot: string;
  is_active: boolean;
}

export interface WarrantyClaimRecord {
  id: string;
  warranty_id: string;
  claim_code: string;
  reported_issue: string;
  opened_at: string;
  order_code?: string;
  customer_name?: string;
}

export interface ConsumedPartRecord {
  id: string;
  repair_order_id: string;
  action: string;
  reservation_batch_id: string | null;
  stock_document_id: string | null;
  occurred_at: string;
}

type RepairOrderOverviewRow = Database["erp"]["Views"]["repair_orders_overview"]["Row"];

type JsonObject = { [key: string]: Json | undefined };

const isJsonObject = (value: Json): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireViewValue = <T>(value: T | null, field: string): T => {
  if (value === null) {
    throw new Error(`La vista de reparaciones devolvió ${field} nulo.`);
  }
  return value;
};

const parseStringArray = (value: Json | null, field: string): string[] => {
  if (value === null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`La vista de reparaciones devolvió ${field} con un formato inválido.`);
  }
  return value;
};

const parseLatestQuote = (value: Json | null): RepairOrderOverview["latest_quote"] => {
  if (value === null) return null;
  if (!isJsonObject(value)) {
    throw new Error("La vista de reparaciones devolvió latest_quote con un formato inválido.");
  }

  const { id, version, total_amount: totalAmount, currency_code: currencyCode, issued_at: issuedAt, expires_at: expiresAt, decision } = value;
  const nullableDateIsValid = (date: Json | undefined): date is string | null => date === null || typeof date === "string";
  const decisionIsValid = decision === null || decision === "approved" || decision === "rejected";

  if (
    typeof id !== "string" ||
    typeof version !== "number" ||
    typeof totalAmount !== "number" ||
    typeof currencyCode !== "string" ||
    !nullableDateIsValid(issuedAt) ||
    !nullableDateIsValid(expiresAt) ||
    !decisionIsValid
  ) {
    throw new Error("La vista de reparaciones devolvió latest_quote incompleto o inválido.");
  }

  return {
    id,
    version,
    total_amount: totalAmount,
    currency_code: currencyCode,
    issued_at: issuedAt,
    expires_at: expiresAt,
    decision,
  };
};

const mapRepairOrderOverview = (row: RepairOrderOverviewRow): RepairOrderOverview => ({
  id: requireViewValue(row.id, "id"),
  organization_id: requireViewValue(row.organization_id, "organization_id"),
  branch_id: requireViewValue(row.branch_id, "branch_id"),
  order_number: requireViewValue(row.order_number, "order_number"),
  order_code: requireViewValue(row.order_code, "order_code"),
  opened_at: requireViewValue(row.opened_at, "opened_at"),
  customer_id: requireViewValue(row.customer_id, "customer_id"),
  customer_code: requireViewValue(row.customer_code, "customer_code"),
  customer_name: requireViewValue(row.customer_name, "customer_name"),
  customer_phone: row.customer_phone,
  customer_email: row.customer_email,
  equipment_id: requireViewValue(row.equipment_id, "equipment_id"),
  equipment_type: requireViewValue(row.equipment_type, "equipment_type"),
  brand_snapshot: requireViewValue(row.brand_snapshot, "brand_snapshot"),
  model_snapshot: requireViewValue(row.model_snapshot, "model_snapshot"),
  reported_fault: requireViewValue(row.reported_fault, "reported_fault"),
  intake_condition: requireViewValue(row.intake_condition, "intake_condition"),
  intake_damage: row.intake_damage,
  intake_notes: row.intake_notes,
  intake_accessories: parseStringArray(row.intake_accessories, "intake_accessories"),
  status_id: requireViewValue(row.status_id, "status_id"),
  status_code: requireViewValue(row.status_code, "status_code"),
  status_name: requireViewValue(row.status_name, "status_name"),
  status_is_initial: requireViewValue(row.status_is_initial, "status_is_initial"),
  status_is_terminal: requireViewValue(row.status_is_terminal, "status_is_terminal"),
  status_requires_final_tests: requireViewValue(row.status_requires_final_tests, "status_requires_final_tests"),
  status_updated_at: requireViewValue(row.status_updated_at, "status_updated_at"),
  status_public_message: requireViewValue(row.status_public_message, "status_public_message"),
  delivery_id: row.delivery_id,
  recipient_name: row.recipient_name,
  recipient_document_suffix: row.recipient_document_suffix,
  delivered_at: row.delivered_at,
  warranty_id: row.warranty_id,
  warranty_ends_at: row.warranty_ends_at,
  latest_quote: parseLatestQuote(row.latest_quote),
  active_parts_count: row.active_parts_count ?? 0,
  qc_passed: row.qc_passed ?? false,
});

export interface RepairLaborRecord {
  id: string;
  repair_order_id: string;
  description: string;
  quantity_hours: number;
  unit_cost_base: number;
  total_cost_base: number | null;
  performed_at: string;
}

export interface RepairPaymentRecord {
  id: string;
  repair_order_id: string;
  payment_method_id: string;
  cash_session_id: string | null;
  currency_code: string;
  amount: number;
  amount_base: number;
  reversal_of_payment_id: string | null;
  reason: string;
  occurred_at: string;
}

export interface RepairPaymentMethod {
  id: string;
  code: string;
  name: string;
  requires_cash_session: boolean;
}

export interface RepairExchangeSnapshot {
  id: string;
  quote_currency: string;
  rate_to_base: number;
  source: string;
  quoted_at: string;
}

// 1. Overview and orders listing
export const listRepairOrders = async (): Promise<RepairOrderOverview[]> => {
  const { data, error } = await client()
    .from("repair_orders_overview")
    .select("*")
    .order("opened_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapRepairOrderOverview);
};

// 2. State events for a ticket
export const listRepairStateEvents = async (repairOrderId: string): Promise<RepairStateEvent[]> => {
  const { data, error } = await client()
    .from("repair_state_events")
    .select(`
      id,
      repair_order_id,
      status_id,
      public_message,
      internal_reason,
      occurred_at,
      actor_id,
      repair_statuses (
        id,
        name,
        code
      )
    `)
    .eq("repair_order_id", repairOrderId)
    .order("event_sequence", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    repair_order_id: row.repair_order_id,
    status_id: row.status_id,
    status_name: row.repair_statuses?.name ?? "Actualización",
    status_code: row.repair_statuses?.code ?? "unknown",
    public_message: row.public_message,
    internal_reason: row.internal_reason,
    occurred_at: row.occurred_at,
    actor_id: row.actor_id,
  }));
};

// 3. Available transitions from current status
export const listAvailableTransitions = async (fromStatusId: string): Promise<RepairTransitionOption[]> => {
  const { data: transitions, error: transitionsError } = await client()
    .from("repair_status_transitions")
    .select("id,to_status_id")
    .eq("from_status_id", fromStatusId)
    .eq("is_active", true);

  if (transitionsError) throw transitionsError;
  if (!transitions || transitions.length === 0) return [];

  const { data: statuses, error: statusesError } = await client()
    .from("repair_statuses")
    .select("id,name,code,requires_final_tests,is_terminal")
    .in("id", transitions.map((transition) => transition.to_status_id));

  if (statusesError) throw statusesError;
  const statusesById = new Map((statuses ?? []).map((status) => [status.id, status]));

  return transitions.map((transition) => {
    const status = statusesById.get(transition.to_status_id);
    if (!status) throw new Error(`La transición ${transition.id} referencia un estado inexistente.`);
    return {
      id: transition.id,
      to_status_id: transition.to_status_id,
      to_status_name: status.name,
      to_status_code: status.code,
      requires_final_tests: status.requires_final_tests,
      is_terminal: status.is_terminal,
    };
  });
};

// 4. Atomic repair intake
export const intakeRepairOrder = async (input: IntakeRepairInput): Promise<{
  repair_order_id: string;
  order_code: string;
  tracking_token: string;
  equipment_id: string;
}> => {
  const { data, error } = await client().rpc("intake_repair_order", {
    target_branch_id: input.branchId,
    target_customer_id: input.customerId,
    equipment_type: input.equipmentType,
    brand_name: input.brandName,
    model_name: input.modelName,
    serial_number: input.serialNumber || undefined,
    imei: input.imei || undefined,
    accessories: input.accessories || [],
    intake_condition: input.intakeCondition || "Recibido en taller",
    intake_damage: input.intakeDamage || undefined,
    intake_notes: input.intakeNotes || undefined,
    reported_fault: input.reportedFault,
    operation_reason: input.operationReason || "Ingreso técnico taller",
  });

  if (error) throw error;
  return parseIntakeRepairResult(data);
};

// 5. Controlled transition
export const transitionRepairOrder = async (
  repairOrderId: string,
  targetStatusId: string,
  publicMessage?: string,
  internalReason?: string
): Promise<string> => {
  const opKey = `trans-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await client().rpc("transition_repair_order", {
    target_repair_order_id: repairOrderId,
    target_status_id: targetStatusId,
    public_message: publicMessage || "",
    operation_key: opKey,
    operation_reason: internalReason || "Avance de ciclo de taller",
  });

  if (error) throw error;
  return data;
};

// 6. Test Templates and QC Test Runs
export const getActiveTestTemplate = async (kind: "intake" | "final" = "final"): Promise<TestTemplateVersion | null> => {
  const { data, error } = await client()
    .from("repair_test_template_versions")
    .select(`
      id,
      template_id,
      version,
      definition,
      repair_test_templates (
        id,
        code,
        name,
        kind
      )
    `)
    .order("version", { ascending: false });

  if (error) throw error;

  const match = (data ?? []).find((version) => version.repair_test_templates?.kind === kind);
  if (!match) return null;

  const tpl = match.repair_test_templates;

  return {
    id: match.id,
    template_id: match.template_id,
    template_name: tpl?.name ?? "Protocolo de Control de Calidad",
    template_code: tpl?.code ?? "QC",
    kind,
    version: match.version,
    definition: parseTestTemplateDefinition(match.definition),
  };
};

export const recordRepairTestRun = async (
  repairOrderId: string,
  templateVersionId: string,
  results: Array<{ item_key: string; result: "pass" | "fail"; notes?: string }>,
  notes?: string
): Promise<string> => {
  const opKey = `qc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await client().rpc("record_repair_test_run", {
    target_repair_order_id: repairOrderId,
    target_template_version_id: templateVersionId,
    results,
    run_notes: notes || "",
    operation_key: opKey,
  });

  if (error) throw error;
  return data;
};

export const listRepairTestRuns = async (repairOrderId?: string): Promise<TestRunRecord[]> => {
  let query = client()
    .from("repair_test_runs")
    .select(`
      id,
      repair_order_id,
      template_version_id,
      kind,
      run_sequence,
      notes,
      completed_at,
      repair_orders ( order_code ),
      repair_test_results ( item_key, result, notes )
    `)
    .order("completed_at", { ascending: false });

  if (repairOrderId) {
    query = query.eq("repair_order_id", repairOrderId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: r.id,
    repair_order_id: r.repair_order_id,
    order_code: r.repair_orders?.order_code ?? undefined,
    template_version_id: r.template_version_id,
    kind: r.kind,
    run_sequence: r.run_sequence,
    run_notes: r.notes,
    completed_at: r.completed_at,
    results: r.repair_test_results || [],
  }));
};

// 7. Parts Consumption and Traceability (Finding H07)
export const consumeRepairPart = async (
  repairOrderId: string,
  locationId: string,
  productId: string,
  variantId?: string,
  quantity = 1,
  reason = "Instalación de repuesto"
): Promise<string> => {
  const { data, error } = await client().rpc("consume_repair_part_direct", {
    target_repair_order_id: repairOrderId,
    target_location_id: locationId,
    target_product_id: productId,
    target_variant_id: variantId || undefined,
    target_quantity: quantity,
    operation_reason: reason,
  });

  if (error) throw error;
  return data;
};

export const reverseRepairPart = async (
  repairOrderId: string,
  stockDocumentId: string,
  reason = "Reversión de repuesto"
): Promise<string> => {
  const opKey = `rev-part-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await client().rpc("reverse_repair_part_consumption", {
    target_repair_order_id: repairOrderId,
    target_stock_document_id: stockDocumentId,
    operation_key: opKey,
    operation_reason: reason,
  });

  if (error) throw error;
  return data;
};

export const listRepairParts = async (repairOrderId: string): Promise<ConsumedPartRecord[]> => {
  const { data, error } = await client()
    .from("repair_part_events")
    .select("id, repair_order_id, action, reservation_batch_id, stock_document_id, occurred_at")
    .eq("repair_order_id", repairOrderId)
    .order("occurred_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    repair_order_id: row.repair_order_id,
    action: row.action,
    reservation_batch_id: row.reservation_batch_id,
    stock_document_id: row.stock_document_id,
    occurred_at: row.occurred_at,
  }));
};

export const listRepairLabor = async (repairOrderId: string): Promise<RepairLaborRecord[]> => {
  const { data, error } = await client()
    .from("repair_labor_facts")
    .select("id,repair_order_id,description,quantity_hours,unit_cost_base,total_cost_base,performed_at")
    .eq("repair_order_id", repairOrderId)
    .order("performed_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    repair_order_id: row.repair_order_id,
    description: row.description,
    quantity_hours: row.quantity_hours,
    unit_cost_base: row.unit_cost_base,
    total_cost_base: row.total_cost_base,
    performed_at: row.performed_at,
  }));
};

export const recordRepairLabor = async (
  repairOrderId: string,
  description: string,
  quantityHours: number,
  unitCostBase: number,
  operationKey: string,
): Promise<string> => {
  const { data, error } = await client().rpc("record_repair_labor", {
    target_repair_order_id: repairOrderId,
    description: description.trim(),
    quantity_hours: quantityHours,
    unit_cost_base: unitCostBase,
    operation_key: operationKey,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Respuesta inválida al registrar mano de obra.");
  return data;
};

export const listRepairPayments = async (repairOrderId: string): Promise<RepairPaymentRecord[]> => {
  const { data, error } = await client()
    .from("payments")
    .select("id,repair_order_id,payment_method_id,cash_session_id,currency_code,amount,amount_base,reversal_of_payment_id,reason,occurred_at")
    .eq("repair_order_id", repairOrderId)
    .order("occurred_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    repair_order_id: requireViewValue(row.repair_order_id, "payments.repair_order_id"),
    payment_method_id: row.payment_method_id,
    cash_session_id: row.cash_session_id,
    currency_code: row.currency_code,
    amount: row.amount,
    amount_base: row.amount_base,
    reversal_of_payment_id: row.reversal_of_payment_id,
    reason: row.reason,
    occurred_at: row.occurred_at,
  }));
};

export const listRepairPaymentMethods = async (): Promise<RepairPaymentMethod[]> => {
  const { data, error } = await client()
    .from("payment_methods")
    .select("id,code,name,requires_cash_session")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    requires_cash_session: row.requires_cash_session,
  }));
};

export const listRepairExchangeSnapshots = async (): Promise<RepairExchangeSnapshot[]> => {
  const { data, error } = await client()
    .from("exchange_rate_snapshots")
    .select("id,quote_currency,rate_to_base,source,quoted_at")
    .order("quoted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    quote_currency: row.quote_currency,
    rate_to_base: row.rate_to_base,
    source: row.source,
    quoted_at: row.quoted_at,
  }));
};

export const recordRepairPayment = async (input: {
  repairOrderId: string;
  paymentMethodId: string;
  cashSessionId: string | null;
  amount: number;
  currency: string;
  exchangeSnapshotId: string;
  operationKey: string;
  reason: string;
  providerReference?: string;
}): Promise<string> => {
  const { data, error } = await client().rpc("record_repair_payment", {
    target_repair_order_id: input.repairOrderId,
    target_payment_method_id: input.paymentMethodId,
    target_cash_session_id: input.cashSessionId,
    payment_amount: input.amount,
    payment_currency: input.currency,
    target_exchange_snapshot_id: input.exchangeSnapshotId,
    operation_key: input.operationKey,
    operation_reason: input.reason.trim(),
    provider_reference: input.providerReference?.trim() || undefined,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Respuesta inválida al registrar el cobro.");
  return data;
};

export const reverseRepairPayment = async (input: {
  paymentId: string;
  refundCashSessionId: string | null;
  operationKey: string;
  reason: string;
}): Promise<string> => {
  const { data, error } = await client().rpc("reverse_repair_payment", {
    target_payment_id: input.paymentId,
    target_refund_cash_session_id: input.refundCashSessionId || undefined,
    operation_key: input.operationKey,
    operation_reason: input.reason.trim(),
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Respuesta inválida al revertir el cobro.");
  return data;
};

// 8. Delivery & Warranties (Finding H05, H08)
export const deliverRepairOrder = async (
  repairOrderId: string,
  recipientName: string,
  recipientDocumentSuffix: string,
  warrantyDays = 90,
  warrantyTerms = "Garantía de 90 días sobre mano de obra y repuestos instalados."
): Promise<string> => {
  const opKey = `deliv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await client().rpc("deliver_repair_order", {
    target_repair_order_id: repairOrderId,
    recipient_name: recipientName,
    recipient_document_suffix: recipientDocumentSuffix,
    signature_method: "typed_name",
    signature_reference: recipientName,
    warranty_days: warrantyDays,
    warranty_terms: warrantyTerms,
    operation_key: opKey,
    operation_reason: "Entrega física de equipo reparado",
  });

  if (error) throw error;
  return data;
};

export const listWarranties = async (): Promise<WarrantyRecord[]> => {
  const { data, error } = await client()
    .from("repair_warranties")
    .select(`
      id,
      repair_order_id,
      delivery_id,
      starts_at,
      ends_at,
      terms_snapshot,
      repair_orders (
        order_code,
        customers ( display_name, phone ),
        customer_equipment ( model_snapshot, brand_snapshot )
      )
    `)
    .order("starts_at", { ascending: false });

  if (error) throw error;

  const now = new Date().toISOString();
  return (data ?? []).map((w) => ({
    id: w.id,
    repair_order_id: w.repair_order_id,
    delivery_id: w.delivery_id,
    order_code: w.repair_orders?.order_code ?? "—",
    customer_name: w.repair_orders?.customers?.display_name ?? "Cliente Taller",
    customer_phone: w.repair_orders?.customers?.phone ?? null,
    equipment_model: `${w.repair_orders?.customer_equipment?.brand_snapshot ?? ""} ${w.repair_orders?.customer_equipment?.model_snapshot ?? ""}`.trim() || "Dispositivo",
    starts_at: w.starts_at,
    ends_at: w.ends_at,
    terms_snapshot: w.terms_snapshot,
    is_active: w.starts_at <= now && now <= w.ends_at,
  }));
};

export const listWarrantyClaims = async (): Promise<WarrantyClaimRecord[]> => {
  const { data, error } = await client()
    .from("repair_warranty_claims")
    .select(`
      id,
      warranty_id,
      claim_code,
      reported_issue,
      opened_at,
      repair_warranties (
        repair_orders (
          order_code,
          customers ( display_name )
        )
      )
    `)
    .order("opened_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((c) => ({
    id: c.id,
    warranty_id: c.warranty_id,
    claim_code: c.claim_code,
    reported_issue: c.reported_issue,
    opened_at: c.opened_at,
    order_code: c.repair_warranties?.repair_orders?.order_code ?? undefined,
    customer_name: c.repair_warranties?.repair_orders?.customers?.display_name ?? undefined,
  }));
};

export const openWarrantyClaim = async (
  warrantyId: string,
  reportedIssue: string
): Promise<string> => {
  const opKey = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await client().rpc("open_repair_warranty_claim", {
    target_warranty_id: warrantyId,
    reported_issue: reportedIssue,
    operation_key: opKey,
    operation_reason: "Reclamo de garantía formal",
  });

  if (error) throw error;
  return data;
};
