import { supabase } from "../../lib/supabase";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

const newOpKey = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export type PcBuildState = "draft" | "reserved" | "tested" | "completed" | "cancelled" | null;
export type PcCompatibilityOutcome = "pass" | "warning" | "fail" | null;

export interface PcBuildProjectOverview {
  id: string;
  organization_id: string;
  branch_id: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  customer_phone: string | null;
  title: string;
  notes: string | null;
  created_at: string;
  current_state: PcBuildState;
  state_changed_at: string | null;
  latest_revision_id: string | null;
  latest_revision_version: number | null;
  spec_version_id: string | null;
  rule_set_version_id: string | null;
  configuration: Record<string, unknown> | null;
  components_count: number;
  total_components_cost: number;
  latest_compatibility_outcome: PcCompatibilityOutcome;
  compatibility_checked_at: string | null;
  reservation_batch_id: string | null;
  reservation_status: string | null;
  reservation_expires_at: string | null;
  latest_test_run_id: string | null;
  test_completed_at: string | null;
  completion_id: string | null;
  equipment_id: string | null;
  fulfillment_stock_document_id: string | null;
  built_serial_number: string | null;
  completed_at: string | null;
}

export interface PcBuildComponentInput {
  slot_code: string;
  product_id: string;
  variant_id?: string | null;
  inventory_unit_id?: string | null;
  quantity: string;
  specifications?: Record<string, unknown>;
  warranty?: Record<string, unknown>;
}

export interface CreatePcBuildInput {
  branchId: string;
  customerId: string;
  title: string;
  notes?: string | null;
  components: PcBuildComponentInput[];
  reason?: string;
}

export interface CreatePcBuildAtomicResult {
  project_id: string;
  revision_id: string;
  compatibility_run_id: string;
  compatibility_outcome: PcCompatibilityOutcome;
}

export interface CreatePcBuildRevisionInput {
  projectId: string;
  specVersionId?: string | null;
  ruleSetVersionId?: string | null;
  configuration?: Record<string, unknown>;
  components: PcBuildComponentInput[];
  reason?: string;
}

export interface ReservePcBuildInput {
  projectId: string;
  revisionId: string;
  expiresAt: string;
  lines: Array<{
    product_id: string;
    variant_id: string | null;
    inventory_unit_id: string | null;
    quantity: number;
  }>;
  reason?: string;
}

export interface RecordPcTestRunInput {
  revisionId: string;
  templateVersionId: string;
  results: Array<{ item_key: string; result: "pass" | "fail" | "not_applicable"; notes?: string }>;
  notes?: string | null;
}

export interface CompletePcBuildInput {
  projectId: string;
  revisionId: string;
  reservationBatchId: string;
  serial: string;
  warranty?: Record<string, unknown>;
  reason?: string;
}

export interface PcBuildCostLine {
  component_id: string;
  quantity: number;
  unit_cost_snapshot: number;
}

export const listPcBuildProjects = async (): Promise<PcBuildProjectOverview[]> => {
  const { data, error } = await client()
    .from("pc_build_projects_overview")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || []).map((row: Record<string, unknown>) => ({
    id: String(row.id ?? ""),
    organization_id: String(row.organization_id ?? ""),
    branch_id: String(row.branch_id ?? ""),
    customer_id: String(row.customer_id ?? ""),
    customer_name: String(row.customer_name ?? "Cliente"),
    customer_code: String(row.customer_code ?? ""),
    customer_phone: (row.customer_phone as string | null) ?? null,
    title: String(row.title ?? ""),
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
    current_state: (row.current_state as PcBuildState) ?? null,
    state_changed_at: (row.state_changed_at as string | null) ?? null,
    latest_revision_id: (row.latest_revision_id as string | null) ?? null,
    latest_revision_version:
      row.latest_revision_version === null || row.latest_revision_version === undefined
        ? null
        : Number(row.latest_revision_version),
    spec_version_id: (row.spec_version_id as string | null) ?? null,
    rule_set_version_id: (row.rule_set_version_id as string | null) ?? null,
    configuration: (row.configuration as Record<string, unknown> | null) ?? null,
    components_count: Number(row.components_count ?? 0),
    total_components_cost: Number(row.total_components_cost ?? 0),
    latest_compatibility_outcome: (row.latest_compatibility_outcome as PcCompatibilityOutcome) ?? null,
    compatibility_checked_at: (row.compatibility_checked_at as string | null) ?? null,
    reservation_batch_id: (row.reservation_batch_id as string | null) ?? null,
    reservation_status: (row.reservation_status as string | null) ?? null,
    reservation_expires_at: (row.reservation_expires_at as string | null) ?? null,
    latest_test_run_id: (row.latest_test_run_id as string | null) ?? null,
    test_completed_at: (row.test_completed_at as string | null) ?? null,
    completion_id: (row.completion_id as string | null) ?? null,
    equipment_id: (row.equipment_id as string | null) ?? null,
    fulfillment_stock_document_id: (row.fulfillment_stock_document_id as string | null) ?? null,
    built_serial_number: (row.built_serial_number as string | null) ?? null,
    completed_at: (row.completed_at as string | null) ?? null,
  }));
};

export const createPcBuildAtomic = async (
  input: CreatePcBuildInput
): Promise<CreatePcBuildAtomicResult> => {
  const componentsList = input.components.map((c) => ({
    slot_code: c.slot_code.trim(),
    product_id: c.product_id.trim(),
    variant_id: c.variant_id?.trim() ? c.variant_id.trim() : null,
    inventory_unit_id: c.inventory_unit_id?.trim() ? c.inventory_unit_id.trim() : null,
    quantity: c.quantity.trim(),
    specifications: c.specifications ?? {},
    warranty: c.warranty ?? {},
  }));

  const { data, error } = await client().rpc("create_pc_build_atomic", {
    target_branch_id: input.branchId,
    target_customer_id: input.customerId,
    build_title: input.title.trim(),
    build_notes: input.notes?.trim() ? input.notes.trim() : null,
    components_list: componentsList,
    operation_reason: input.reason?.trim() ? input.reason.trim() : "Creación de proyecto de PC armada",
  });

  if (error) throw error;
  const result = data as {
    project_id: string;
    revision_id: string;
    compatibility_run_id: string;
    compatibility_outcome: PcCompatibilityOutcome;
  };
  return result;
};

export const createPcBuildRevision = async (input: CreatePcBuildRevisionInput): Promise<string> => {
  const components = input.components.map((c) => ({
    slot_code: c.slot_code.trim(),
    product_id: c.product_id.trim(),
    variant_id: c.variant_id?.trim() ? c.variant_id.trim() : null,
    inventory_unit_id: c.inventory_unit_id?.trim() ? c.inventory_unit_id.trim() : null,
    quantity: c.quantity.trim(),
    specifications: c.specifications ?? {},
    warranty: c.warranty ?? {},
  }));

  const { data, error } = await client().rpc("create_pc_build_revision", {
    target_project_id: input.projectId,
    target_spec_version_id: input.specVersionId ?? null,
    target_rule_set_version_id: input.ruleSetVersionId ?? null,
    configuration: input.configuration ?? {},
    components,
    operation_key: newOpKey("pc-rev"),
    operation_reason: input.reason?.trim() ? input.reason.trim() : "Nueva revisión de configuración",
  });

  if (error) throw error;
  return data as string;
};

export const recordPcCompatibilityRun = async (
  revisionId: string,
  reason?: string
): Promise<string> => {
  const { data, error } = await client().rpc("record_pc_compatibility_run", {
    target_revision_id: revisionId,
    operation_key: newOpKey("pc-chk"),
    operation_reason: reason?.trim() ? reason.trim() : "Chequeo de compatibilidad",
  });

  if (error) throw error;
  return data as string;
};

export const reservePcBuildComponents = async (input: ReservePcBuildInput): Promise<string> => {
  const { data, error } = await client().rpc("reserve_pc_build_components", {
    target_project_id: input.projectId,
    target_revision_id: input.revisionId,
    expires_at: input.expiresAt,
    lines: input.lines,
    operation_key: newOpKey("pc-res"),
    operation_reason: input.reason?.trim() ? input.reason.trim() : "Reserva de componentes para armado",
  });

  if (error) throw error;
  return data as string;
};

export const recordPcTestRun = async (input: RecordPcTestRunInput): Promise<string> => {
  const { data, error } = await client().rpc("record_pc_test_run", {
    target_revision_id: input.revisionId,
    target_template_version_id: input.templateVersionId,
    results: input.results,
    run_notes: input.notes?.trim() ? input.notes.trim() : null,
    operation_key: newOpKey("pc-test"),
  });

  if (error) throw error;
  return data as string;
};

export const completePcBuild = async (input: CompletePcBuildInput): Promise<string> => {
  const { data, error } = await client().rpc("complete_pc_build", {
    target_project_id: input.projectId,
    target_revision_id: input.revisionId,
    target_reservation_batch_id: input.reservationBatchId,
    build_serial: input.serial.trim(),
    warranty_snapshot: input.warranty ?? {},
    operation_key: newOpKey("pc-done"),
    operation_reason: input.reason?.trim() ? input.reason.trim() : "Finalización de armado de PC",
  });

  if (error) throw error;
  return data as string;
};

export const getPcBuildCosts = async (completionId: string): Promise<PcBuildCostLine[]> => {
  const { data, error } = await client().rpc("get_pc_build_costs", {
    target_completion_id: completionId,
  });

  if (error) throw error;

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  return rows.map((row) => ({
    component_id: String(row.component_id ?? ""),
    quantity: Number(row.quantity ?? 0),
    unit_cost_snapshot: Number(row.unit_cost_snapshot ?? 0),
  }));
};
