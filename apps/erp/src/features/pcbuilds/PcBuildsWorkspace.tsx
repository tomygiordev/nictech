import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useFieldArray,
  useForm,
  type FieldErrors,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Search, Eye, Plus, Cpu, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import {
  WorkspaceHeader,
  Modal,
  FeedbackAlert,
  StatePanel,
} from "../../components/erp/WorkspaceUi";
import { Field, FieldError, FormError } from "../../components/erp/FormFeedback";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { toDateTimeInputAR } from "../../lib/dates";
import { toUserMessage } from "../../lib/errors";
import { formatCurrency, formatDateTime } from "../../lib/formatters";
import { RESERVATION_STATUS_LABELS, labelOf } from "../../lib/labels";
import { supabase } from "../../lib/supabase";
import type { Json } from "../../types/supabase";
import {
  listPcBuildProjects,
  listLatestPcBuildCompatibilityResults,
  createPcBuildAtomic,
  createPcBuildRevision,
  recordPcCompatibilityRun,
  reservePcBuildComponents,
  recordPcTestRun,
  completePcBuild,
  getPcBuildCosts,
  listPcBuildFormOptions,
  listPcBuildRevisionComponents,
  type PcBuildProjectOverview,
  type PcBuildCompatibilityResult,
  type PcBuildFormOptions,
  type PcBuildComponentInput,
  type PcBuildCostLine,
} from "./api";
import {
  PC_BUILD_SLOT_OPTIONS,
  buildPcTestResultsPayload,
  completePcBuildSchema,
  createPcBuildSchema,
  createPcBuildTestSchema,
  pcBuildReserveSchema,
  pcBuildRevisionSchema,
  serializePcBuildWarranty,
  type CompletePcBuildFormInput,
  type CompletePcBuildFormValues,
  type CreatePcBuildFormInput,
  type PcBuildComponentFormInput,
  type PcBuildReserveFormInput,
  type PcBuildRevisionFormInput,
  type PcTestCheckResult,
} from "./schemas";

const BUILD_STEPS = ["Nueva revisión", "Compatibilidad", "Reserva", "Testeo final", "Completar"] as const;

const NO_MANAGE_PERMISSION = "No tenés permiso para gestionar armados de PC.";
const NO_COSTS_PERMISSION = "No tenés permiso para ver costos de armados.";

interface PcTestTemplateItem {
  key: string;
  label: string;
  required: boolean;
}

interface PcTestTemplateVersionOption {
  id: string;
  templateId: string;
  templateCode: string;
  templateName: string;
  version: number;
  definition: PcTestTemplateItem[];
}

const emptyDraft = (): PcBuildComponentFormInput => ({
  slot_code: "cpu",
  product_id: "",
  variant_id: "",
  inventory_unit_id: "",
  quantity: "1",
});

const emptyFormOptions = (): PcBuildFormOptions => ({ branches: [], customers: [], products: [], locations: [] });

const defaultReserveExpires = (): string =>
  toDateTimeInputAR(new Date(Date.now() + 48 * 60 * 60 * 1000));

const toComponentInputs = (drafts: PcBuildComponentFormInput[]): PcBuildComponentInput[] => {
  return drafts
    .filter((d) => d.product_id.trim() !== "" && d.slot_code.trim() !== "")
    .map((d) => ({
      slot_code: d.slot_code.trim(),
      product_id: d.product_id.trim(),
      variant_id: d.variant_id.trim() ? d.variant_id.trim() : null,
      inventory_unit_id: d.inventory_unit_id.trim() ? d.inventory_unit_id.trim() : null,
      quantity: d.quantity.trim() ? d.quantity.trim() : "1",
      specifications: {
        ...((d.slot_code === "cpu" || d.slot_code === "motherboard") && d.socket ? { socket: d.socket } : {}),
        ...((d.slot_code === "motherboard" || d.slot_code === "memory") && d.memoryType ? { memory_type: d.memoryType } : {}),
        ...(d.slot_code === "cpu" && d.watts ? { recommended_psu_watts: Number(d.watts) } : {}),
        ...(d.slot_code === "power_supply" && d.watts ? { watts: Number(d.watts) } : {}),
      },
      warranty: {},
    }));
};

const parsePcTestTemplateDefinition = (value: Json): PcTestTemplateItem[] => {
  if (!Array.isArray(value)) return [];
  const items: PcTestTemplateItem[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const { key, label, required } = entry;
    if (typeof key !== "string" || key.trim() === "" || typeof label !== "string" || label.trim() === "") continue;
    items.push({
      key: key.trim(),
      label: label.trim(),
      required: typeof required === "boolean" ? required : true,
    });
  }
  return items;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  reserved: "Reservado",
  tested: "Testeado",
  completed: "Completado",
  cancelled: "Cancelado",
};

const STATUS_PILL: Record<string, string> = {
  draft: "flow-status-pill neutral",
  reserved: "flow-status-pill confirmed",
  tested: "flow-status-pill confirmed",
  completed: "flow-status-pill completed",
  cancelled: "flow-status-pill cancelled",
};

const COMPAT_LABEL: Record<string, string> = {
  pass: "Compatible",
  warning: "Advertencia",
  fail: "Falla",
};

const COMPAT_PILL: Record<string, string> = {
  pass: "flow-status-pill completed",
  warning: "flow-status-pill processing",
  fail: "flow-status-pill cancelled",
};

const statusLabel = (s: PcBuildProjectOverview["current_state"]): string => {
  if (!s) return "Sin estado";
  return STATUS_LABEL[s] ?? s;
};

const statusPill = (s: PcBuildProjectOverview["current_state"]): string => {
  if (!s) return "flow-status-pill";
  return STATUS_PILL[s] ?? "flow-status-pill";
};

const compatLabel = (o: PcBuildProjectOverview["latest_compatibility_outcome"]): string => {
  if (!o) return "Sin chequeo";
  return COMPAT_LABEL[o] ?? o;
};

const compatPill = (o: PcBuildProjectOverview["latest_compatibility_outcome"]): string => {
  if (!o) return "flow-status-pill";
  return COMPAT_PILL[o] ?? "flow-status-pill";
};

const shortId = (id: string): string => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

const nextBuildStep = (project: PcBuildProjectOverview): number => {
  if (!project.latest_revision_id) return 1;
  if (!project.latest_compatibility_outcome) return 2;
  if (project.current_state === "reserved") return 4;
  if (project.current_state === "tested" || project.current_state === "completed") return 5;
  // Keep draft projects at revision so their component list can be prepared before reserving.
  return 1;
};

interface ComponentRowsProps {
  fields: Array<{ id: string }>;
  products: PcBuildFormOptions["products"];
  getRowError: (index: number) => FieldErrors<PcBuildComponentFormInput> | undefined;
  getFieldProps: (index: number, field: "slot_code" | "product_id" | "quantity" | "socket" | "memoryType" | "watts") => UseFormRegisterReturn;
  getSlot: (index: number) => string;
  onRemove: (index: number) => void;
  onAdd: () => void;
  addLabel: string;
  disabled?: boolean;
}

const ComponentRowsFieldArray = ({
  fields,
  products,
  getRowError,
  getFieldProps,
  getSlot,
  onRemove,
  onAdd,
  addLabel,
  disabled = false,
}: ComponentRowsProps) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
    {fields.map((field, index) => {
      const rowErrors = getRowError(index);
      const slot = getSlot(index);
      return (
        <div
          key={field.id}
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr 132px 44px", gap: "8px", alignItems: "start" }}
        >
          <Field label="Slot" required error={rowErrors?.slot_code?.message}>
            {(a11y) => (
              <select
                {...a11y}
                {...getFieldProps(index, "slot_code")}
                className="erp-form-input"
                disabled={disabled}
              >
                {PC_BUILD_SLOT_OPTIONS.map((slot) => (
                  <option key={slot.code} value={slot.code}>
                    {slot.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Producto" required error={rowErrors?.product_id?.message}>
            {(a11y) => (
              <select
                {...a11y}
                {...getFieldProps(index, "product_id")}
                className="erp-form-input"
                disabled={disabled}
              >
                <option value="">Seleccionar producto…</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.internal_code} · {product.internal_name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Cant." required error={rowErrors?.quantity?.message}>
            {(a11y) => (
              <input
                {...a11y}
                {...getFieldProps(index, "quantity")}
                type="text"
                className="erp-form-input"
                placeholder="1"
                disabled={disabled}
              />
            )}
          </Field>

          <button
            type="button"
            className="pag-btn"
            style={{ marginTop: "24px", minHeight: "40px" }}
            onClick={() => onRemove(index)}
            disabled={disabled || fields.length <= 1}
            aria-label={`Quitar componente ${index + 1}`}
          >
            ✕
          </button>
          {slot !== "storage" && slot !== "gpu" && (
            <div className="erp-form-row" style={{ gridColumn: "1 / -1" }}>
              {(slot === "cpu" || slot === "motherboard") && (
                <Field label="Socket" error={rowErrors?.socket?.message}>
                  {(a11y) => <input {...a11y} {...getFieldProps(index, "socket")} className="erp-form-input" disabled={disabled} />}
                </Field>
              )}
              {(slot === "motherboard" || slot === "memory") && (
                <Field label="Tipo de memoria" error={rowErrors?.memoryType?.message}>
                  {(a11y) => <input {...a11y} {...getFieldProps(index, "memoryType")} className="erp-form-input" disabled={disabled} />}
                </Field>
              )}
              {(slot === "cpu" || slot === "power_supply") && (
                <Field label={slot === "cpu" ? "Potencia de fuente recomendada (W)" : "Potencia nominal de la fuente (W)"} error={rowErrors?.watts?.message}>
                  {(a11y) => <input {...a11y} {...getFieldProps(index, "watts")} className="erp-form-input" inputMode="numeric" disabled={disabled} />}
                </Field>
              )}
            </div>
          )}
        </div>
      );
    })}

    <button
      type="button"
      className="pag-btn"
      style={{ alignSelf: "flex-start" }}
      onClick={onAdd}
      disabled={disabled}
    >
      {addLabel}
    </button>
  </div>
);

export const PcBuildsWorkspace = () => {
  const { hasPermission } = useErpAuth();
  const canManage = hasPermission("pc_builds.manage");
  const canViewCosts = hasPermission("pc_builds.view") && hasPermission("costs.view");

  const [projects, setProjects] = useState<PcBuildProjectOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeDetailStep, setActiveDetailStep] = useState(1);
  const [compatibilityResults, setCompatibilityResults] = useState<PcBuildCompatibilityResult[]>([]);
  const [compatibilityResultsLoading, setCompatibilityResultsLoading] = useState(false);
  const [compatibilityResultsError, setCompatibilityResultsError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [formOptions, setFormOptions] = useState<PcBuildFormOptions>(emptyFormOptions);

  // Plantillas de testeo final
  const [testTemplates, setTestTemplates] = useState<PcTestTemplateVersionOption[]>([]);
  const [defaultTestTemplateId, setDefaultTestTemplateId] = useState("");
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  // Modal Nuevo Armado (RHF + Zod)
  const [createError, setCreateError] = useState<string | null>(null);
  const createForm = useForm<CreatePcBuildFormInput>({
    resolver: zodResolver(createPcBuildSchema),
    defaultValues: {
      branchId: "",
      customerId: "",
      title: "",
      notes: "",
      reason: "",
      components: [emptyDraft()],
    },
  });
  const createComponents = useFieldArray({
    control: createForm.control,
    name: "components",
  });

  // Detalle: formularios y estados por etapa
  const [detailReason, setDetailReason] = useState("");
  const revForm = useForm<PcBuildRevisionFormInput>({
    resolver: zodResolver(pcBuildRevisionSchema),
    defaultValues: {
      specVersionId: "",
      ruleSetVersionId: "",
      components: [emptyDraft()],
    },
  });
  const revComponents = useFieldArray({
    control: revForm.control,
    name: "components",
  });
  const reserveForm = useForm<PcBuildReserveFormInput>({
    resolver: zodResolver(pcBuildReserveSchema),
    defaultValues: {
      expiresAt: defaultReserveExpires(),
      locationId: "",
    },
  });

  const [testTemplateVersionId, setTestTemplateVersionId] = useState("");
  const [testChecks, setTestChecks] = useState<Record<string, PcTestCheckResult>>({});
  const [testNotes, setTestNotes] = useState("");
  const [testFieldErrors, setTestFieldErrors] = useState<{ templateVersionId?: string; notes?: string }>({});

  const completeForm = useForm<CompletePcBuildFormInput, unknown, CompletePcBuildFormValues>({
    resolver: zodResolver(completePcBuildSchema),
    defaultValues: {
      serial: "",
      warrantyDays: "",
      warrantyConditions: "",
    },
  });

  const [costs, setCosts] = useState<PcBuildCostLine[] | null>(null);
  const [detailPending, setDetailPending] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadTestTemplates = useCallback(async () => {
    setTemplatesError(null);
    try {
      const { data, error: tplError } = await supabase
        .from("pc_test_template_versions")
        .select("id, template_id, version, definition, pc_test_templates (id, code, name, is_active)")
        .order("version", { ascending: false });

      if (tplError) throw tplError;

      const parsedTemplates: PcTestTemplateVersionOption[] = [];
      for (const row of data ?? []) {
        const templateMeta = Array.isArray(row.pc_test_templates)
          ? row.pc_test_templates[0]
          : row.pc_test_templates;
        if (templateMeta && templateMeta.is_active === false) continue;

        parsedTemplates.push({
          id: row.id,
          templateId: row.template_id,
          templateCode: templateMeta?.code ?? "standard_pc_final",
          templateName: templateMeta?.name ?? "Prueba final de PC",
          version: row.version,
          definition: parsePcTestTemplateDefinition(row.definition),
        });
      }

      let configuredTemplateId: string | null = null;
      try {
        const { data: cfgData, error: cfgError } = await supabase
          .from("configuration_values")
          .select("value")
          .eq("key", "pc_builds.final_test_template_version")
          .is("branch_id", null)
          .maybeSingle();

        if (!cfgError && cfgData && typeof cfgData.value === "string") {
          configuredTemplateId = cfgData.value;
        }
      } catch {
        // Ignorar si el usuario no tiene permiso configuration.view.
      }

      setTestTemplates(parsedTemplates);

      const resolvedDefault =
        (configuredTemplateId && parsedTemplates.some((t) => t.id === configuredTemplateId)
          ? configuredTemplateId
          : parsedTemplates.length === 1
            ? parsedTemplates[0].id
            : "");

      setDefaultTestTemplateId(resolvedDefault);
      setTestTemplateVersionId((current) => {
        if (current && parsedTemplates.some((t) => t.id === current)) return current;
        return resolvedDefault;
      });
    } catch (err) {
      setTemplatesError(toUserMessage(err, "No se pudieron cargar las plantillas de testeo."));
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, options] = await Promise.all([listPcBuildProjects(), listPcBuildFormOptions()]);
      setProjects(rows);
      setFormOptions(options);
      if (options.branches.length === 1 && !createForm.getValues("branchId")) {
        createForm.setValue("branchId", options.branches[0].id);
      }
      await loadTestTemplates();
    } catch (err) {
      setError(toUserMessage(err, "No se pudieron cargar los proyectos de armado."));
    } finally {
      setLoading(false);
    }
  }, [createForm, loadTestTemplates]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return projects.find((p) => p.id === selectedId) ?? null;
  }, [projects, selectedId]);

  const selectedTestTemplate = useMemo(
    () => testTemplates.find((tpl) => tpl.id === testTemplateVersionId) ?? null,
    [testTemplates, testTemplateVersionId],
  );

  const requiredTestItems = useMemo(
    () => (selectedTestTemplate ? selectedTestTemplate.definition.filter((item) => item.required) : []),
    [selectedTestTemplate],
  );

  const compatibilityProjectId = selected?.id;
  const compatibilityRevisionId = selected?.latest_revision_id;
  const compatibilityOutcome = selected?.latest_compatibility_outcome;
  const compatibilityCheckedAt = selected?.compatibility_checked_at;

  useEffect(() => {
    if (
      !compatibilityProjectId ||
      !compatibilityRevisionId ||
      (compatibilityOutcome !== "fail" && compatibilityOutcome !== "warning")
    ) {
      setCompatibilityResults([]);
      setCompatibilityResultsError(null);
      setCompatibilityResultsLoading(false);
      return;
    }

    let isCurrentSelection = true;
    setCompatibilityResults([]);
    setCompatibilityResultsError(null);
    setCompatibilityResultsLoading(true);
    void listLatestPcBuildCompatibilityResults(compatibilityProjectId, compatibilityRevisionId)
      .then((results) => {
        if (isCurrentSelection) setCompatibilityResults(results);
      })
      .catch((err: unknown) => {
        if (isCurrentSelection) {
          setCompatibilityResultsError(toUserMessage(err, "No se pudieron cargar las causas de compatibilidad."));
        }
      })
      .finally(() => {
        if (isCurrentSelection) setCompatibilityResultsLoading(false);
      });

    return () => {
      isCurrentSelection = false;
    };
  }, [compatibilityProjectId, compatibilityRevisionId, compatibilityOutcome, compatibilityCheckedAt]);

  const resetCreateForm = useCallback(() => {
    createForm.reset({
      branchId: formOptions.branches.length === 1 ? formOptions.branches[0].id : "",
      customerId: "",
      title: "",
      notes: "",
      reason: "",
      components: [emptyDraft()],
    });
    setCreateError(null);
  }, [createForm, formOptions.branches]);

  const openCreateModal = () => {
    if (!canManage) return;
    resetCreateForm();
    setIsModalOpen(true);
  };

  const closeCreateModal = () => {
    if (createForm.formState.isSubmitting) return;
    setIsModalOpen(false);
    setCreateError(null);
  };

  const openProjectDetail = (project: PcBuildProjectOverview) => {
    setSelectedId(project.id);
    setCosts(null);
    setDetailError(null);
    setActiveDetailStep(nextBuildStep(project));
    setTestTemplateVersionId((current) =>
      current && testTemplates.some((tpl) => tpl.id === current) ? current : defaultTestTemplateId,
    );
    setTestChecks({});
    setTestNotes("");
    setTestFieldErrors({});
    reserveForm.reset({ expiresAt: defaultReserveExpires(), locationId: "" });
    completeForm.reset({
      serial: "",
      warrantyDays: "",
      warrantyConditions: "",
    });
  };

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return projects;
    return projects.filter((p) => {
      return (
        p.title.toLowerCase().includes(q) ||
        p.customer_name.toLowerCase().includes(q) ||
        (p.built_serial_number ?? "").toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    });
  }, [projects, search]);

  const handleCreateBuild = async (values: CreatePcBuildFormInput) => {
    if (!canManage) {
      setCreateError(NO_MANAGE_PERMISSION);
      return;
    }
    setCreateError(null);
    setFeedback(null);

    try {
      const result = await createPcBuildAtomic({
        branchId: values.branchId,
        customerId: values.customerId,
        title: values.title,
        notes: values.notes ? values.notes : null,
        components: toComponentInputs(values.components),
        reason: values.reason ? values.reason : undefined,
      });
      setFeedback({
        type: "success",
        message: `Armado creado. Compatibilidad inicial: ${result.compatibility_outcome ?? "sin resultado"}.`,
      });
      setIsModalOpen(false);
      resetCreateForm();
      await refresh();
      setSelectedId(result.project_id);
    } catch (err) {
      setCreateError(toUserMessage(err, "No se pudo crear el armado."));
    }
  };

  const runDetailAction = async (key: string, fn: () => Promise<string | null>) => {
    if (detailPending) return;
    setDetailPending(key);
    setDetailError(null);
    setFeedback(null);
    try {
      const message = await fn();
      if (message) setFeedback({ type: "success", message });
      await refresh();
      const nextStepByAction: Record<string, number> = {
        revision: 2,
        compatibilidad: 3,
        reserva: 4,
        test: 5,
      };
      if (nextStepByAction[key]) setActiveDetailStep(nextStepByAction[key]);
    } catch (err) {
      setDetailError(toUserMessage(err, "La acción no pudo completarse."));
    } finally {
      setDetailPending(null);
    }
  };

  const handleCreateRevision = (values: PcBuildRevisionFormInput) => {
    if (!canManage) {
      setDetailError(NO_MANAGE_PERMISSION);
      return;
    }
    if (!selected) return;
    const components = toComponentInputs(values.components);
    void runDetailAction("revision", async () => {
      if (!selected) return null;
      const revisionId = await createPcBuildRevision({
        projectId: selected.id,
        specVersionId: values.specVersionId ? values.specVersionId : null,
        ruleSetVersionId: values.ruleSetVersionId ? values.ruleSetVersionId : null,
        configuration: { platform: "desktop_custom", created_via: "erp_workspace" },
        components,
        reason: detailReason.trim() ? detailReason.trim() : undefined,
      });
      return `Revisión creada (${revisionId.slice(0, 8)}…). Ahora registrá la compatibilidad.`;
    });
  };

  const handleCompatibility = () => {
    if (!canManage) {
      setDetailError(NO_MANAGE_PERMISSION);
      return;
    }
    if (!selected?.latest_revision_id) {
      setDetailError("El proyecto todavía no tiene revisión para chequear.");
      return;
    }
    const revisionId = selected.latest_revision_id;
    void runDetailAction("compatibilidad", async () => {
      const runId = await recordPcCompatibilityRun(
        revisionId,
        detailReason.trim() ? detailReason.trim() : undefined,
      );
      return `Compatibilidad registrada (${runId.slice(0, 8)}…).`;
    });
  };

  const handleReserve = (values: PcBuildReserveFormInput) => {
    if (!canManage) {
      setDetailError(NO_MANAGE_PERMISSION);
      return;
    }
    if (!selected?.latest_revision_id) {
      setDetailError("El proyecto todavía no tiene revisión para reservar.");
      return;
    }
    const projectId = selected.id;
    const revisionId = selected.latest_revision_id;
    if (!selected.latest_compatibility_outcome || selected.latest_compatibility_outcome === "fail") {
      setDetailError("Registrá una revisión compatible antes de reservar los componentes.");
      return;
    }

    void runDetailAction("reserva", async () => {
      const components = await listPcBuildRevisionComponents(revisionId);
      if (components.length === 0) throw new Error("La revisión no tiene componentes para reservar.");
      const lines = components.map((component) => ({ ...component, location_id: values.locationId }));
      const batchId = await reservePcBuildComponents({
        projectId,
        revisionId,
        expiresAt: new Date(values.expiresAt).toISOString(),
        lines,
        reason: detailReason.trim() ? detailReason.trim() : undefined,
      });
      return `Componentes reservados (lote ${batchId.slice(0, 8)}…).`;
    });
  };

  const handleTest = () => {
    if (!canManage) {
      setDetailError(NO_MANAGE_PERMISSION);
      return;
    }
    if (!selected?.latest_revision_id) {
      setDetailError("El proyecto todavía no tiene revisión para testear.");
      return;
    }

    setDetailError(null);
    setTestFieldErrors({});

    const requiredKeys = requiredTestItems.map((item) => item.key);
    const schema = createPcBuildTestSchema(requiredKeys);
    const parsed = schema.safeParse({
      templateVersionId: testTemplateVersionId,
      notes: testNotes,
      checks: testChecks,
    });

    if (!parsed.success) {
      const nextFieldErrors: { templateVersionId?: string; notes?: string } = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "templateVersionId" && !nextFieldErrors.templateVersionId) {
          nextFieldErrors.templateVersionId = issue.message;
        } else if (issue.path[0] === "notes" && !nextFieldErrors.notes) {
          nextFieldErrors.notes = issue.message;
        }
      }
      setTestFieldErrors(nextFieldErrors);
      setDetailError(parsed.error.issues[0]?.message ?? "Revisá los datos del testeo antes de continuar.");
      return;
    }

    const revisionId = selected.latest_revision_id;
    const results = buildPcTestResultsPayload(requiredKeys, parsed.data.checks);
    const notesValue = parsed.data.notes ? parsed.data.notes : null;

    void runDetailAction("test", async () => {
      const runId = await recordPcTestRun({
        revisionId,
        templateVersionId: parsed.data.templateVersionId,
        results,
        notes: notesValue,
      });
      return `Testeo registrado (${runId.slice(0, 8)}…).`;
    });
  };

  const handleComplete = (values: CompletePcBuildFormValues) => {
    if (!canManage) {
      setDetailError(NO_MANAGE_PERMISSION);
      return;
    }
    if (!selected?.latest_revision_id) {
      setDetailError("El proyecto todavía no tiene revisión para completar.");
      return;
    }
    if (!selected.reservation_batch_id) {
      setDetailError("Primero reservá los componentes antes de completar el armado.");
      return;
    }

    const projectId = selected.id;
    const revisionId = selected.latest_revision_id;
    const batchId = selected.reservation_batch_id;
    const warranty = serializePcBuildWarranty(values.warrantyDays, values.warrantyConditions);

    void runDetailAction("complete", async () => {
      const equipmentId = await completePcBuild({
        projectId,
        revisionId,
        reservationBatchId: batchId,
        serial: values.serial,
        warranty,
        reason: detailReason.trim() ? detailReason.trim() : undefined,
      });
      return `Armado completado. Equipo: ${equipmentId.slice(0, 8)}… Serie: ${values.serial}.`;
    });
  };

  const handleLoadCosts = () => {
    if (!canViewCosts) {
      setDetailError(NO_COSTS_PERMISSION);
      return;
    }
    if (!selected?.completion_id) {
      setDetailError("Todavía no hay completitud registrada para ver costos.");
      return;
    }
    const completionId = selected.completion_id;
    void runDetailAction("costos", async () => {
      const lines = await getPcBuildCosts(completionId);
      setCosts(lines);
      return null;
    });
  };

  const createComponentsError =
    createForm.formState.errors.components?.root?.message ??
    createForm.formState.errors.components?.message;

  const revComponentsError =
    revForm.formState.errors.components?.root?.message ??
    revForm.formState.errors.components?.message;

  const completedTestCount = requiredTestItems.filter((item) => Boolean(testChecks[item.key])).length;

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Armados de PC"
        description="Proyectos de armado a medida: revisiones, compatibilidad, reserva, testeo y completitud."
        badge={`${projects.length} Armados`}
        badgeTone="neutral"
      />

      {feedback && (
        <FeedbackAlert
          type={feedback.type}
          message={feedback.message}
          onClose={() => setFeedback(null)}
        />
      )}

      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Proyectos de Armado</h2>
            <p className="flow-card__subtitle">Proyectos ordenados desde el más reciente</p>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <div className="flow-search-pill" style={{ width: "260px" }}>
              <Search size={15} />
              <input
                type="text"
                aria-label="Buscar armados por título, cliente, serie o ID"
                placeholder="Buscar por título, cliente, serie o ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={openCreateModal}
              disabled={!canManage}
              title={!canManage ? NO_MANAGE_PERMISSION : undefined}
            >
              <Plus size={16} /> Nuevo armado
            </button>
          </div>
        </div>

        {loading && (
          <StatePanel type="loading" title="Cargando armados" message="Consultando proyectos en Supabase…" />
        )}

        {!loading && error && (
          <StatePanel
            type="error"
            title="No se pudieron cargar los armados"
            message={error}
            action={
              <button type="button" className="btn-primary" onClick={() => void refresh()}>
                Reintentar
              </button>
            }
          />
        )}

        {!loading && !error && (
          <div className="flow-table-wrapper">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Cliente</th>
                  <th>Título</th>
                  <th className="num">Costo</th>
                  <th>Estado</th>
                  <th>Compatibilidad</th>
                  <th className="text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                      No hay proyectos de armado para mostrar.
                    </td>
                  </tr>
                ) : (
                  filteredProjects.map((p) => (
                    <tr
                      key={p.id}
                      className="interactive-row"
                      role="button"
                      tabIndex={0}
                      aria-label={`Abrir proyecto ${p.title} de ${p.customer_name}`}
                      onClick={() => openProjectDetail(p)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openProjectDetail(p);
                        }
                      }}
                    >
                      <td>
                        <span className="type-badge purple" style={{ fontFamily: "monospace" }} title={p.id} aria-label={`ID completo: ${p.id}`}>
                          {shortId(p.id)}
                        </span>
                      </td>
                      <td>
                        <strong style={{ display: "block", lineHeight: 1.35, overflowWrap: "anywhere" }}>{p.customer_name}</strong>
                        {p.customer_code && (
                          <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>
                            {p.customer_code}
                          </span>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: "13px", fontWeight: 650 }}>{p.title}</span>
                      </td>
                      <td className="num">
                        <span className="amount-val">
                          {formatCurrency(p.total_components_cost, "ARS")}
                        </span>
                        <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>
                          {p.components_count} comp.
                        </span>
                      </td>
                      <td>
                        <span className={statusPill(p.current_state)}>{statusLabel(p.current_state)}</span>
                      </td>
                      <td>
                        <span className={compatPill(p.latest_compatibility_outcome)}>
                          {compatLabel(p.latest_compatibility_outcome)}
                        </span>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="pag-btn"
                          style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            openProjectDetail(p);
                          }}
                          title="Ver detalle y acciones"
                        >
                          <Eye size={12} /> Detalle
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <Modal
          isOpen={Boolean(selected)}
          onClose={() => {
            setSelectedId(null);
            setCosts(null);
            setDetailError(null);
          }}
          title={`Armado: ${selected.title}`}
          subtitle={`${shortId(selected.id)} • Cliente: ${selected.customer_name}`}
          icon={Cpu}
          maxWidth="680px"
          scrollBody
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
                background: "var(--canvas-bg)",
                padding: "12px",
                borderRadius: "10px",
              }}
            >
              <div>
                <span className="stat-label">Estado</span>
                <strong style={{ display: "block", fontSize: "13px", marginTop: "2px" }}>
                  {statusLabel(selected.current_state)}
                </strong>
              </div>
              <div>
                <span className="stat-label">Compatibilidad</span>
                <strong style={{ display: "block", fontSize: "13px", marginTop: "2px" }}>
                  {compatLabel(selected.latest_compatibility_outcome)}
                  {selected.compatibility_checked_at && (
                    <span style={{ fontWeight: 500, color: "var(--text-muted)" }}>
                      {" "}
                      • {formatDateTime(selected.compatibility_checked_at)}
                    </span>
                  )}
                </strong>
                {(selected.latest_compatibility_outcome === "fail" || selected.latest_compatibility_outcome === "warning") && (
                  <div style={{ marginTop: "7px", fontSize: "11px", fontWeight: 500 }}>
                    <span className="stat-label">Resultados de la última corrida</span>
                    {compatibilityResultsLoading && <p role="status" style={{ margin: "3px 0 0", color: "var(--text-muted)" }}>Consultando detalles…</p>}
                    {compatibilityResultsError && <p role="alert" style={{ margin: "3px 0 0", color: "var(--rose-accent)" }}>{compatibilityResultsError}</p>}
                    {!compatibilityResultsLoading && !compatibilityResultsError && compatibilityResults.length === 0 && (
                      <p style={{ margin: "3px 0 0", color: "var(--text-muted)" }}>No hay causas específicas guardadas para esta corrida.</p>
                    )}
                    {!compatibilityResultsLoading && !compatibilityResultsError && compatibilityResults.length > 0 && (
                      <ul style={{ margin: "4px 0 0", paddingLeft: "16px", color: "var(--text-main)" }}>
                        {compatibilityResults.map((result) => (
                          <li key={result.result_code} style={{ marginBottom: "4px" }}>
                            <strong>{result.result_code}:</strong> {result.message}
                            {typeof result.details === "object" &&
                              result.details !== null &&
                              !Array.isArray(result.details) &&
                              typeof result.details.missing === "string" && (
                                <span style={{ display: "block", color: "var(--text-muted)" }}>
                                  Slots faltantes: {result.details.missing}
                                </span>
                              )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <div>
                <span className="stat-label">Revisión actual</span>
                <span style={{ display: "block", fontSize: "13px", marginTop: "2px", fontWeight: 650 }}>
                  {selected.latest_revision_version !== null
                    ? `v${selected.latest_revision_version}`
                    : "Sin revisión"}
                </span>
              </div>
              <div>
                <span className="stat-label">Costo de componentes</span>
                <strong style={{ display: "block", fontSize: "14px", marginTop: "2px", color: "var(--brand-primary)" }}>
                  {formatCurrency(selected.total_components_cost, "ARS")}
                </strong>
              </div>
              <div>
                <span className="stat-label">Reserva</span>
                <span style={{ display: "block", fontSize: "12px", marginTop: "2px", fontWeight: 600 }}>
                  {selected.reservation_batch_id
                    ? `${shortId(selected.reservation_batch_id)} • ${selected.reservation_status ? labelOf(RESERVATION_STATUS_LABELS, selected.reservation_status, selected.reservation_status) : "—"}`
                    : "Sin reserva"}
                </span>
                {selected.reservation_expires_at && (
                  <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>
                    Vence: {formatDateTime(selected.reservation_expires_at)}
                  </span>
                )}
              </div>
              <div>
                <span className="stat-label">Serie / Testeo</span>
                <span style={{ display: "block", fontSize: "12px", marginTop: "2px", fontWeight: 600 }}>
                  {selected.built_serial_number ?? "Sin serie"}
                </span>
                {selected.test_completed_at && (
                  <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>
                    Test: {formatDateTime(selected.test_completed_at)}
                  </span>
                )}
              </div>
            </div>

            {selected.notes && (
              <div style={{ padding: "12px", background: "var(--surface-subtle)", borderRadius: "10px" }}>
                <span className="stat-label">Notas:</span>
                <p style={{ margin: "4px 0 0", fontSize: "13px", fontWeight: 500 }}>{selected.notes}</p>
              </div>
            )}

            <Field label="Motivo de operación (para todas las acciones)">
              {(a11y) => (
                <input
                  {...a11y}
                  type="text"
                  className="erp-form-input"
                  placeholder="Ej: Avance de armado en taller"
                  value={detailReason}
                  onChange={(e) => setDetailReason(e.target.value)}
                  disabled={!canManage}
                />
              )}
            </Field>

            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 2,
                padding: "10px 0",
                background: "var(--surface-card)",
              }}
            >
              <div
                role="tablist"
                aria-label="Etapas del armado"
                style={{
                  display: "flex",
                  gap: "8px",
                  overflowX: "auto",
                }}
              >
                {BUILD_STEPS.map((step, index) => (
                  <button
                    key={step}
                    id={`pc-build-step-${index + 1}`}
                    type="button"
                    role="tab"
                    aria-selected={activeDetailStep === index + 1}
                    aria-current={activeDetailStep === index + 1 ? "step" : undefined}
                    aria-controls={`pc-build-panel-${index + 1}`}
                    tabIndex={activeDetailStep === index + 1 ? 0 : -1}
                    className={activeDetailStep === index + 1 ? "btn-primary" : "pag-btn"}
                    style={{ flex: "1 0 112px", justifyContent: "center", whiteSpace: "nowrap" }}
                    onClick={() => setActiveDetailStep(index + 1)}
                    onKeyDown={(event) => {
                      const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                      if (event.key === "Home" || event.key === "End" || direction !== 0) {
                        event.preventDefault();
                        const nextIndex = event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? BUILD_STEPS.length - 1
                            : (index + direction + BUILD_STEPS.length) % BUILD_STEPS.length;
                        setActiveDetailStep(nextIndex + 1);
                        document.getElementById(`pc-build-step-${nextIndex + 1}`)?.focus();
                      }
                    }}
                    disabled={detailPending !== null}
                  >
                    {index + 1}. {step}
                  </button>
                ))}
              </div>
            </div>
            <div aria-live="polite" style={{ fontSize: "12px", fontWeight: 650, color: "var(--brand-primary)" }}>
              Etapa {activeDetailStep} de {BUILD_STEPS.length}: {BUILD_STEPS[activeDetailStep - 1]}
            </div>

            {activeDetailStep === 1 && (
              <div id="pc-build-panel-1" role="tabpanel" aria-labelledby="pc-build-step-1" style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
                <strong style={{ fontSize: "13px" }}>1. Nueva revisión</strong>
                <p style={{ margin: "4px 0 8px", fontSize: "12px", color: "var(--text-muted)" }}>
                  Crea una versión nueva con los componentes del constructor. La reserva posterior debe
                  coincidir exactamente con esta revisión.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                  <Field
                    label="Versión de especificación (opcional)"
                    error={revForm.formState.errors.specVersionId?.message}
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        {...revForm.register("specVersionId")}
                        type="text"
                        className="erp-form-input"
                        placeholder="UUID o vacío"
                        disabled={!canManage}
                      />
                    )}
                  </Field>
                  <Field
                    label="Versión de reglas (opcional)"
                    error={revForm.formState.errors.ruleSetVersionId?.message}
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        {...revForm.register("ruleSetVersionId")}
                        type="text"
                        className="erp-form-input"
                        placeholder="UUID o vacío"
                        disabled={!canManage}
                      />
                    )}
                  </Field>
                </div>
                <ComponentRowsFieldArray
                  fields={revComponents.fields}
                  products={formOptions.products}
                  getRowError={(index) => revForm.formState.errors.components?.[index]}
                  getFieldProps={(index, fieldName) => revForm.register(`components.${index}.${fieldName}`)}
                  getSlot={(index) => revForm.watch(`components.${index}.slot_code`)}
                  onRemove={(index) => {
                    if (revComponents.fields.length > 1) revComponents.remove(index);
                  }}
                  onAdd={() => revComponents.append(emptyDraft())}
                  addLabel="+ Componente"
                  disabled={!canManage}
                />
                {revComponentsError && <FieldError id="rev-components-error" message={revComponentsError} />}
              </div>
            )}

            {activeDetailStep === 2 && (
              <div id="pc-build-panel-2" role="tabpanel" aria-labelledby="pc-build-step-2" style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
                <strong style={{ fontSize: "13px" }}>2. Compatibilidad</strong>
                <p style={{ margin: "4px 0 8px", fontSize: "12px", color: "var(--text-muted)" }}>
                  Ejecuta el chequeo de compatibilidad sobre la revisión actual.
                </p>
              </div>
            )}

            {activeDetailStep === 3 && (
              <div id="pc-build-panel-3" role="tabpanel" aria-labelledby="pc-build-step-3" style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
                <strong style={{ fontSize: "13px" }}>3. Reserva de componentes</strong>
                <p style={{ margin: "4px 0 8px", fontSize: "12px", color: "var(--text-muted)" }}>
                  Se reservan los componentes de la última revisión guardada.
                </p>
                <Field label="Ubicación de stock" required error={reserveForm.formState.errors.locationId?.message}>
                  {(a11y) => (
                    <select {...a11y} {...reserveForm.register("locationId")} className="erp-form-input" disabled={!canManage}>
                      <option value="">Elegí una ubicación…</option>
                      {formOptions.locations.filter((location) => location.branch_id === selected.branch_id).map((location) => (
                        <option key={location.id} value={location.id}>{location.name}</option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field
                  label="Vencimiento de reserva"
                  required
                  error={reserveForm.formState.errors.expiresAt?.message}
                >
                  {(a11y) => (
                    <input
                      {...a11y}
                      {...reserveForm.register("expiresAt")}
                      type="datetime-local"
                      className="erp-form-input"
                      disabled={!canManage}
                    />
                  )}
                </Field>
              </div>
            )}

            {activeDetailStep === 4 && (
              <div id="pc-build-panel-4" role="tabpanel" aria-labelledby="pc-build-step-4" style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <strong style={{ fontSize: "13px" }}>4. Testeo final</strong>
                  <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
                    Requiere reserva activa. Elegí la plantilla y registrá el resultado de cada control obligatorio.
                  </p>
                </div>

                <FormError message={templatesError} onDismiss={() => setTemplatesError(null)} />

                <Field
                  label="Plantilla de testeo"
                  required
                  error={testFieldErrors.templateVersionId}
                >
                  {(a11y) => (
                    <select
                      {...a11y}
                      className="erp-form-input"
                      value={testTemplateVersionId}
                      disabled={!canManage || detailPending !== null}
                      onChange={(e) => {
                        setTestTemplateVersionId(e.target.value);
                        setTestChecks({});
                        setTestFieldErrors((prev) => ({ ...prev, templateVersionId: undefined }));
                        setDetailError(null);
                      }}
                    >
                      <option value="">Seleccionar plantilla…</option>
                      {testTemplates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.templateName} (v{tpl.version})
                        </option>
                      ))}
                    </select>
                  )}
                </Field>

                {selectedTestTemplate && (
                  <>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)", padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: "6px" }}>
                      Plantilla: <strong>{selectedTestTemplate.templateName}</strong> (v{selectedTestTemplate.version}) • Controles completados:{" "}
                      <strong>
                        {completedTestCount}/{requiredTestItems.length}
                      </strong>
                    </div>

                    {requiredTestItems.length === 0 ? (
                      <StatePanel
                        type="info"
                        message="La plantilla seleccionada no tiene controles obligatorios configurados."
                      />
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {requiredTestItems.map((item) => (
                          <div
                            key={item.key}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "10px 14px",
                              background: "rgba(255,255,255,0.03)",
                              borderRadius: "6px",
                              border: "1px solid var(--border-line)",
                            }}
                          >
                            <span style={{ fontWeight: 600, fontSize: "13px" }}>
                              {item.label}
                              {!testChecks[item.key] && (
                                <span style={{ display: "block", color: "var(--text-muted)", fontSize: "11px", fontWeight: 500 }}>
                                  Resultado pendiente
                                </span>
                              )}
                            </span>
                            <div style={{ display: "flex", gap: "8px" }} role="group" aria-label={`Resultado de ${item.label}`}>
                              <button
                                type="button"
                                disabled={!canManage || detailPending !== null}
                                onClick={() => {
                                  setTestChecks((prev) => ({ ...prev, [item.key]: "pass" }));
                                  setDetailError(null);
                                }}
                                aria-pressed={testChecks[item.key] === "pass"}
                                style={{
                                  padding: "4px 12px",
                                  borderRadius: "14px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  cursor: canManage ? "pointer" : "not-allowed",
                                  border: "1px solid var(--emerald-text)",
                                  background: testChecks[item.key] === "pass" ? "var(--emerald-text)" : "transparent",
                                  color: testChecks[item.key] === "pass" ? "var(--surface-white)" : "var(--emerald-text)",
                                }}
                              >
                                Aprobado
                              </button>
                              <button
                                type="button"
                                disabled={!canManage || detailPending !== null}
                                onClick={() => {
                                  setTestChecks((prev) => ({ ...prev, [item.key]: "fail" }));
                                  setDetailError(null);
                                }}
                                aria-pressed={testChecks[item.key] === "fail"}
                                style={{
                                  padding: "4px 12px",
                                  borderRadius: "14px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  cursor: canManage ? "pointer" : "not-allowed",
                                  border: "1px solid var(--rose-text)",
                                  background: testChecks[item.key] === "fail" ? "var(--rose-text)" : "transparent",
                                  color: testChecks[item.key] === "fail" ? "var(--surface-white)" : "var(--rose-text)",
                                }}
                              >
                                Falla
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {!selectedTestTemplate && testTemplates.length === 0 && !templatesError && (
                  <StatePanel
                    type="info"
                    message="No hay plantillas de testeo activas disponibles para seleccionar."
                  />
                )}

                <Field label="Notas del testeo" error={testFieldErrors.notes}>
                  {(a11y) => (
                    <input
                      {...a11y}
                      type="text"
                      className="erp-form-input"
                      placeholder="Observaciones de laboratorio o pruebas de estrés (opcional)"
                      value={testNotes}
                      disabled={!canManage || detailPending !== null}
                      onChange={(e) => {
                        setTestNotes(e.target.value);
                        setTestFieldErrors((prev) => ({ ...prev, notes: undefined }));
                      }}
                    />
                  )}
                </Field>
              </div>
            )}

            {activeDetailStep === 5 && (
              <div id="pc-build-panel-5" role="tabpanel" aria-labelledby="pc-build-step-5" style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div>
                  <strong style={{ fontSize: "13px" }}>5. Completar armado</strong>
                  <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
                    Requiere reserva activa y testeo completo aprobado. Genera el equipo y su serie.
                  </p>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <Field
                    label="Número de serie"
                    required
                    error={completeForm.formState.errors.serial?.message}
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        {...completeForm.register("serial")}
                        type="text"
                        className="erp-form-input"
                        placeholder="Ej: NT-PC-0001"
                        disabled={!canManage || Boolean(selected.completion_id)}
                      />
                    )}
                  </Field>

                  <Field
                    label="Días de garantía"
                    required
                    error={completeForm.formState.errors.warrantyDays?.message}
                  >
                    {(a11y) => (
                      <input
                        {...a11y}
                        {...completeForm.register("warrantyDays")}
                        type="number"
                        min={0}
                        step={1}
                        className="erp-form-input"
                        placeholder="Ej: 180"
                        disabled={!canManage || Boolean(selected.completion_id)}
                      />
                    )}
                  </Field>
                </div>

                <Field
                  label="Condiciones"
                  error={completeForm.formState.errors.warrantyConditions?.message}
                >
                  {(a11y) => (
                    <input
                      {...a11y}
                      {...completeForm.register("warrantyConditions")}
                      type="text"
                      className="erp-form-input"
                      placeholder="Ej: Cobertura de hardware ante fallas de fábrica (opcional)"
                      disabled={!canManage || Boolean(selected.completion_id)}
                    />
                  )}
                </Field>

                {costs && (
                  <div style={{ marginTop: "4px", fontSize: "12px" }}>
                    <strong>Costos registrados ({costs.length}):</strong>
                    <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                      {costs.map((c) => (
                        <li key={c.component_id}>
                          <span style={{ fontFamily: "monospace" }}>{shortId(c.component_id)}</span>
                          {" • "}
                          {c.quantity} u. • {formatCurrency(c.unit_cost_snapshot, "ARS")}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <FormError message={detailError} onDismiss={() => setDetailError(null)} />
            <div className="erp-modal-footer">
              <button
                type="button"
                className="pag-btn"
                style={{ marginRight: "auto" }}
                onClick={() => setActiveDetailStep((step) => Math.max(1, step - 1))}
                disabled={activeDetailStep === 1 || detailPending !== null}
              >
                <ChevronLeft size={15} /> Anterior
              </button>
              {activeDetailStep === 1 && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void revForm.handleSubmit(handleCreateRevision)()}
                  disabled={!canManage || detailPending !== null}
                  title={!canManage ? NO_MANAGE_PERMISSION : undefined}
                >
                  {detailPending === "revision" ? "Creando…" : "Crear revisión"}
                </button>
              )}
              {activeDetailStep === 2 && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleCompatibility}
                  disabled={!canManage || detailPending !== null || !selected.latest_revision_id}
                  title={!canManage ? NO_MANAGE_PERMISSION : undefined}
                >
                  {detailPending === "compatibilidad" ? "Registrando…" : "Registrar compatibilidad"}
                </button>
              )}
              {activeDetailStep === 3 && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void reserveForm.handleSubmit(handleReserve)()}
                  disabled={!canManage || detailPending !== null || !selected.latest_revision_id}
                  title={!canManage ? NO_MANAGE_PERMISSION : undefined}
                >
                  {detailPending === "reserva" ? "Reservando…" : "Reservar componentes"}
                </button>
              )}
              {activeDetailStep === 4 && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleTest}
                  disabled={!canManage || detailPending !== null || !selected.latest_revision_id}
                  title={!canManage ? NO_MANAGE_PERMISSION : undefined}
                >
                  {detailPending === "test" ? "Registrando…" : "Registrar testeo"}
                </button>
              )}
              {activeDetailStep === 5 && (
                <>
                  {selected.completion_id && (
                    <button
                      type="button"
                      className="pag-btn"
                      onClick={handleLoadCosts}
                      disabled={!canViewCosts || detailPending !== null}
                      title={!canViewCosts ? NO_COSTS_PERMISSION : undefined}
                    >
                      {detailPending === "costos" ? "Cargando…" : "Ver costos"}
                    </button>
                  )}
                  {!selected.completion_id && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void completeForm.handleSubmit(handleComplete)()}
                      disabled={!canManage || detailPending !== null}
                      title={!canManage ? NO_MANAGE_PERMISSION : undefined}
                    >
                      {detailPending === "complete" ? "Completando…" : "Completar armado"}
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                className="pag-btn"
                onClick={() => setActiveDetailStep((step) => Math.min(BUILD_STEPS.length, step + 1))}
                disabled={activeDetailStep === BUILD_STEPS.length || detailPending !== null}
              >
                Siguiente <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </Modal>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={closeCreateModal}
        title="Nuevo armado de PC"
        subtitle="Crea proyecto + revisión inicial + chequeo de compatibilidad"
        icon={Sparkles}
        maxWidth="600px"
        scrollBody
      >
        <form
          onSubmit={createForm.handleSubmit(handleCreateBuild)}
          noValidate
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          <FormError message={createError} onDismiss={() => setCreateError(null)} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field
              label="Sucursal"
              required
              error={createForm.formState.errors.branchId?.message}
            >
              {(a11y) => (
                <select
                  {...a11y}
                  {...createForm.register("branchId")}
                  className="erp-form-input"
                  required
                >
                  <option value="">Seleccionar sucursal…</option>
                  {formOptions.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.code} · {branch.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field
              label="Cliente"
              required
              error={createForm.formState.errors.customerId?.message}
            >
              {(a11y) => (
                <select
                  {...a11y}
                  {...createForm.register("customerId")}
                  className="erp-form-input"
                  required
                >
                  <option value="">Seleccionar cliente…</option>
                  {formOptions.customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.code} · {customer.display_name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <Field
            label="Título del armado"
            required
            error={createForm.formState.errors.title?.message}
          >
            {(a11y) => (
              <input
                {...a11y}
                {...createForm.register("title")}
                type="text"
                required
                placeholder="Ej: Rig Gamer Ultra 4K"
                className="erp-form-input"
              />
            )}
          </Field>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase" }}>
              Componentes (slot + producto + cantidad)
            </span>
            <ComponentRowsFieldArray
              fields={createComponents.fields}
              products={formOptions.products}
              getRowError={(index) => createForm.formState.errors.components?.[index]}
              getFieldProps={(index, fieldName) => createForm.register(`components.${index}.${fieldName}`)}
              getSlot={(index) => createForm.watch(`components.${index}.slot_code`)}
              onRemove={(index) => {
                if (createComponents.fields.length > 1) createComponents.remove(index);
              }}
              onAdd={() => createComponents.append(emptyDraft())}
              addLabel="+ Agregar componente"
            />
            {createComponentsError && <FieldError id="create-components-error" message={createComponentsError} />}
          </div>

          <Field label="Notas" error={createForm.formState.errors.notes?.message}>
            {(a11y) => (
              <textarea
                {...a11y}
                {...createForm.register("notes")}
                rows={2}
                placeholder="Gabinete, refrigeración, perfil de uso…"
                className="erp-form-textarea"
              />
            )}
          </Field>

          <Field label="Motivo de operación" error={createForm.formState.errors.reason?.message}>
            {(a11y) => (
              <input
                {...a11y}
                {...createForm.register("reason")}
                type="text"
                placeholder="Ej: Pedido de cliente en mostrador"
                className="erp-form-input"
              />
            )}
          </Field>

          <div className="erp-modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={closeCreateModal}
              disabled={createForm.formState.isSubmitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!canManage || createForm.formState.isSubmitting}
              title={!canManage ? NO_MANAGE_PERMISSION : undefined}
            >
              {createForm.formState.isSubmitting ? "Creando…" : "Crear armado"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
