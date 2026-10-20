import { supabase } from "../../lib/supabase";
import type { Json } from "../../types/supabase";

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
  configuration: Json | null;
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

export interface PcBuildFormOptions {
  branches: Array<{ id: string; code: string; name: string }>;
  customers: Array<{ id: string; code: string; display_name: string }>;
  products: Array<{ id: string; internal_code: string; internal_name: string }>;
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

export interface PcBuildCompatibilityResult {
  result_code: string;
  outcome: Exclude<PcCompatibilityOutcome, null>;
  message: string;
  details: Json;
}

const toJson = (value: unknown): Json => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object") {
    const result: { [key: string]: Json | undefined } = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = nestedValue === undefined ? undefined : toJson(nestedValue);
    }
    return result;
  }
  throw new Error("El payload del armado contiene un valor no serializable.");
};

const parseCreatePcBuildAtomicResult = (value: Json): CreatePcBuildAtomicResult => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Respuesta inválida al crear el armado de PC.");
  }

  const { project_id, revision_id, compatibility_run_id, compatibility_outcome } = value;
  const validOutcome =
    compatibility_outcome === null ||
    compatibility_outcome === "pass" ||
    compatibility_outcome === "warning" ||
    compatibility_outcome === "fail";

  if (
    typeof project_id !== "string" ||
    typeof revision_id !== "string" ||
    typeof compatibility_run_id !== "string" ||
    !validOutcome
  ) {
    throw new Error("Respuesta incompleta al crear el armado de PC.");
  }

  return { project_id, revision_id, compatibility_run_id, compatibility_outcome };
};

export const listPcBuildProjects = async (): Promise<PcBuildProjectOverview[]> => {
  const { data, error } = await client()
    .from("pc_build_projects_overview")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id ?? "",
    organization_id: row.organization_id ?? "",
    branch_id: row.branch_id ?? "",
    customer_id: row.customer_id ?? "",
    customer_name: row.customer_name ?? "Cliente",
    customer_code: row.customer_code ?? "",
    customer_phone: row.customer_phone,
    title: row.title ?? "",
    notes: row.notes,
    created_at: row.created_at ?? "",
    current_state: row.current_state,
    state_changed_at: row.state_changed_at,
    latest_revision_id: row.latest_revision_id,
    latest_revision_version: row.latest_revision_version,
    spec_version_id: row.spec_version_id,
    rule_set_version_id: row.rule_set_version_id,
    configuration: row.configuration,
    components_count: row.components_count ?? 0,
    total_components_cost: row.total_components_cost ?? 0,
    latest_compatibility_outcome: row.latest_compatibility_outcome,
    compatibility_checked_at: row.compatibility_checked_at,
    reservation_batch_id: row.reservation_batch_id,
    reservation_status: row.reservation_status,
    reservation_expires_at: row.reservation_expires_at,
    latest_test_run_id: row.latest_test_run_id,
    test_completed_at: row.test_completed_at,
    completion_id: row.completion_id,
    equipment_id: row.equipment_id,
    fulfillment_stock_document_id: row.fulfillment_stock_document_id,
    built_serial_number: row.built_serial_number,
    completed_at: row.completed_at,
  })) satisfies Json;
};

export const listLatestPcBuildCompatibilityResults = async (
  projectId: string,
  revisionId: string
): Promise<PcBuildCompatibilityResult[]> => {
  const { data: runs, error: runsError } = await client()
    .from("pc_compatibility_runs")
    .select("id")
    .eq("project_id", projectId)
    .eq("revision_id", revisionId)
    .order("run_sequence", { ascending: false })
    .limit(1);

  if (runsError) throw runsError;
  const runId = runs?.[0]?.id;
  if (!runId) return [];

  const { data, error } = await client()
    .from("pc_compatibility_results")
    .select("result_code, outcome, message, details")
    .eq("run_id", runId)
    .in("outcome", ["warning", "fail"])
    .order("result_code", { ascending: true });

  if (error) throw error;
  return data ?? [];
};

export const listPcBuildFormOptions = async (): Promise<PcBuildFormOptions> => {
  const [branchesResult, customersResult, productsResult] = await Promise.all([
    client().from("branches").select("id,code,name").order("name"),
    client().from("customers").select("id,code,display_name").order("display_name"),
    client().from("products").select("id,internal_code,internal_name").eq("is_active", true).order("internal_name"),
  ]);

  const error = branchesResult.error ?? customersResult.error ?? productsResult.error;
  if (error) throw error;

  return {
    branches: branchesResult.data ?? [],
    customers: customersResult.data ?? [],
    products: productsResult.data ?? [],
  };
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
    specifications: toJson(c.specifications ?? {}),
    warranty: toJson(c.warranty ?? {}),
  }));

  const { data, error } = await client().rpc("create_pc_build_atomic", {
    target_branch_id: input.branchId,
    target_customer_id: input.customerId,
    build_title: input.title.trim(),
    build_notes: input.notes?.trim() ?? "",
    components_list: componentsList,
    operation_reason: input.reason?.trim() ? input.reason.trim() : "Creación de proyecto de PC armada",
  });

  if (error) throw error;
  return parseCreatePcBuildAtomicResult(data);
};

export const createPcBuildRevision = async (input: CreatePcBuildRevisionInput): Promise<string> => {
  if (!input.specVersionId || !input.ruleSetVersionId) {
    throw new Error("La revisión requiere versiones de especificación y reglas de compatibilidad.");
  }

  const components = input.components.map((c) => ({
    slot_code: c.slot_code.trim(),
    product_id: c.product_id.trim(),
    variant_id: c.variant_id?.trim() ? c.variant_id.trim() : null,
    inventory_unit_id: c.inventory_unit_id?.trim() ? c.inventory_unit_id.trim() : null,
    quantity: c.quantity.trim(),
    specifications: toJson(c.specifications ?? {}),
    warranty: toJson(c.warranty ?? {}),
  })) satisfies Json;

  const { data, error } = await client().rpc("create_pc_build_revision", {
    target_project_id: input.projectId,
    target_spec_version_id: input.specVersionId,
    target_rule_set_version_id: input.ruleSetVersionId,
    configuration: toJson(input.configuration ?? {}),
    components,
    operation_key: newOpKey("pc-rev"),
    operation_reason: input.reason?.trim() ? input.reason.trim() : "Nueva revisión de configuración",
  });

  if (error) throw error;
  if (typeof data !== "string") throw new Error("Respuesta inválida al crear la revisión de PC.");
  return data;
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
  if (typeof data !== "string") throw new Error("Respuesta inválida al registrar la compatibilidad.");
  return data;
};

export const reservePcBuildComponents = async (input: ReservePcBuildInput): Promise<string> => {
  const { data, error } = await client().rpc("reserve_pc_build_components", {
    target_project_id: input.projectId,
    target_revision_id: input.revisionId,
    expires_at: input.expiresAt,
    lines: input.lines satisfies Json,
    operation_key: newOpKey("pc-res"),
    operation_reason: input.reason?.trim() ? input.reason.trim() : "Reserva de componentes para armado",
  });

  if (error) throw error;
  if (typeof data !== "string") throw new Error("Respuesta inválida al reservar los componentes.");
  return data;
};

export const recordPcTestRun = async (input: RecordPcTestRunInput): Promise<string> => {
  const { data, error } = await client().rpc("record_pc_test_run", {
    target_revision_id: input.revisionId,
    target_template_version_id: input.templateVersionId,
    results: input.results satisfies Json,
    run_notes: input.notes?.trim() ?? "",
    operation_key: newOpKey("pc-test"),
  });

  if (error) throw error;
  if (typeof data !== "string") throw new Error("Respuesta inválida al registrar el testeo.");
  return data;
};

export const completePcBuild = async (input: CompletePcBuildInput): Promise<string> => {
  const { data, error } = await client().rpc("complete_pc_build", {
    target_project_id: input.projectId,
    target_revision_id: input.revisionId,
    target_reservation_batch_id: input.reservationBatchId,
    build_serial: input.serial.trim(),
    warranty_snapshot: toJson(input.warranty ?? {}),
    operation_key: newOpKey("pc-done"),
    operation_reason: input.reason?.trim() ? input.reason.trim() : "Finalización de armado de PC",
  });

  if (error) throw error;
  if (typeof data !== "string") throw new Error("Respuesta inválida al completar el armado.");
  return data;
};

export const getPcBuildCosts = async (completionId: string): Promise<PcBuildCostLine[]> => {
  const { data, error } = await client().rpc("get_pc_build_costs", {
    target_completion_id: completionId,
  });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    component_id: row.component_id,
    quantity: row.quantity,
    unit_cost_snapshot: row.unit_cost_snapshot,
  }));
};
