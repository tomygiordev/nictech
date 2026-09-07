import { supabase } from "../../lib/supabase";

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

export interface TestRunRecord {
  id: string;
  repair_order_id: string;
  order_code?: string;
  template_version_id: string;
  kind: "intake" | "final";
  run_sequence: number;
  run_notes: string | null;
  completed_at: string;
  results: Array<{ item_key: string; result: "pass" | "fail"; notes?: string }>;
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

// 1. Overview and orders listing
export const listRepairOrders = async (): Promise<RepairOrderOverview[]> => {
  const { data, error } = await client()
    .from("repair_orders_overview")
    .select("*")
    .order("opened_at", { ascending: false });

  if (error) throw error;
  return (data || []) as RepairOrderOverview[];
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

  return (data || []).map((row: any) => ({
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
  const { data, error } = await client()
    .from("repair_status_transitions")
    .select(`
      id,
      to_status_id,
      repair_statuses!repair_status_transitions_to_status_id_fkey (
        id,
        name,
        code,
        requires_final_tests,
        is_terminal
      )
    `)
    .eq("from_status_id", fromStatusId)
    .eq("is_active", true);

  if (error) {
    console.warn("Aviso al consultar transiciones:", error.message);
    return [];
  }

  return (data || []).map((t: any) => ({
    id: t.id,
    to_status_id: t.to_status_id,
    to_status_name: t.repair_statuses?.name ?? "Próximo estado",
    to_status_code: t.repair_statuses?.code ?? "unknown",
    requires_final_tests: Boolean(t.repair_statuses?.requires_final_tests),
    is_terminal: Boolean(t.repair_statuses?.is_terminal),
  }));
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
    serial_number: input.serialNumber || null,
    imei: input.imei || null,
    accessories: input.accessories || [],
    intake_condition: input.intakeCondition || "Recibido en taller",
    intake_damage: input.intakeDamage || null,
    intake_notes: input.intakeNotes || null,
    reported_fault: input.reportedFault,
    operation_reason: input.operationReason || "Ingreso técnico taller",
  });

  if (error) throw error;
  return data as {
    repair_order_id: string;
    order_code: string;
    tracking_token: string;
    equipment_id: string;
  };
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
    public_message: publicMessage || null,
    operation_key: opKey,
    operation_reason: internalReason || "Avance de ciclo de taller",
  });

  if (error) throw error;
  return data as string;
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

  const match = (data || []).find((v: any) => v.repair_test_templates?.kind === kind);
  if (!match) return null;

  const tpl = Array.isArray(match.repair_test_templates)
    ? match.repair_test_templates[0]
    : (match.repair_test_templates as any);

  return {
    id: match.id,
    template_id: match.template_id,
    template_name: tpl?.name ?? "Protocolo de Control de Calidad",
    template_code: tpl?.code ?? "QC",
    kind,
    version: match.version,
    definition: match.definition,
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
    run_notes: notes || null,
    operation_key: opKey,
  });

  if (error) throw error;
  return data as string;
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
      run_notes,
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

  return (data || []).map((r: any) => ({
    id: r.id,
    repair_order_id: r.repair_order_id,
    order_code: r.repair_orders?.order_code,
    template_version_id: r.template_version_id,
    kind: r.kind,
    run_sequence: r.run_sequence,
    run_notes: r.run_notes,
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
    target_variant_id: variantId || null,
    target_quantity: quantity,
    operation_reason: reason,
  });

  if (error) throw error;
  return data as string;
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
  return data as string;
};

export const listRepairParts = async (repairOrderId: string): Promise<ConsumedPartRecord[]> => {
  const { data, error } = await client()
    .from("repair_part_events")
    .select("id, repair_order_id, action, reservation_batch_id, stock_document_id, occurred_at")
    .eq("repair_order_id", repairOrderId)
    .order("occurred_at", { ascending: true });

  if (error) throw error;
  return (data || []) as ConsumedPartRecord[];
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
  return data as string;
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
  return (data || []).map((w: any) => ({
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

  return (data || []).map((c: any) => ({
    id: c.id,
    warranty_id: c.warranty_id,
    claim_code: c.claim_code,
    reported_issue: c.reported_issue,
    opened_at: c.opened_at,
    order_code: c.repair_warranties?.repair_orders?.order_code,
    customer_name: c.repair_warranties?.repair_orders?.customers?.display_name,
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
  return data as string;
};
