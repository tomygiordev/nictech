import { useEffect, useMemo, useState } from "react";
import { Search, Eye, Plus, Cpu, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import {
  WorkspaceHeader,
  Modal,
  FeedbackAlert,
  StatePanel,
} from "../../components/erp/WorkspaceUi";
import { formatCurrency, formatDateTime } from "../../lib/formatters";
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
  type PcBuildProjectOverview,
  type PcBuildCompatibilityResult,
  type PcBuildFormOptions,
  type PcBuildComponentInput,
  type PcBuildCostLine,
} from "./api";

const SLOT_OPTIONS = [
  { code: "cpu", label: "CPU" },
  { code: "gpu", label: "GPU" },
  { code: "ram", label: "RAM" },
  { code: "storage", label: "Storage" },
  { code: "motherboard", label: "Motherboard" },
  { code: "psu", label: "PSU" },
] as const;

const SLOT_CODES: ReadonlySet<string> = new Set(SLOT_OPTIONS.map((slot) => slot.code));
const BUILD_STEPS = ["Nueva revisión", "Compatibilidad", "Reserva", "Testeo final", "Completar"] as const;

interface ComponentDraft {
  slot_code: string;
  product_id: string;
  variant_id: string;
  inventory_unit_id: string;
  quantity: string;
}

const emptyDraft = (): ComponentDraft => ({
  slot_code: "cpu",
  product_id: "",
  variant_id: "",
  inventory_unit_id: "",
  quantity: "1",
});

const emptyFormOptions = (): PcBuildFormOptions => ({ branches: [], customers: [], products: [] });

const defaultReserveExpires = (): string => {
  const d = new Date(Date.now() + 48 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 16);
};

const toComponentInputs = (drafts: ComponentDraft[]): PcBuildComponentInput[] => {
  return drafts
    .filter((d) => d.product_id.trim() !== "" && d.slot_code.trim() !== "")
    .map((d) => ({
      slot_code: d.slot_code.trim(),
      product_id: d.product_id.trim(),
      variant_id: d.variant_id.trim() ? d.variant_id.trim() : null,
      inventory_unit_id: d.inventory_unit_id.trim() ? d.inventory_unit_id.trim() : null,
      quantity: d.quantity.trim() ? d.quantity.trim() : "1",
      specifications: {},
      warranty: {},
    }));
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  reserved: "Reservado",
  tested: "Testeado",
  completed: "Completado",
  cancelled: "Cancelado",
};

const STATUS_PILL: Record<string, string> = {
  draft: "flow-status-pill processing",
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

const errorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message.trim() !== "") return err.message;
  return fallback;
};

export const PcBuildsWorkspace = () => {
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

  // Form Nuevo Armado
  const [branchId, setBranchId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [drafts, setDrafts] = useState<ComponentDraft[]>([emptyDraft()]);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Detalle: acciones secuenciales
  const [detailReason, setDetailReason] = useState("");
  const [revSpecVersionId, setRevSpecVersionId] = useState("");
  const [revRuleSetVersionId, setRevRuleSetVersionId] = useState("");
  const [revDrafts, setRevDrafts] = useState<ComponentDraft[]>([emptyDraft()]);
  const [reserveExpires, setReserveExpires] = useState(defaultReserveExpires);
  const [testTemplateVersionId, setTestTemplateVersionId] = useState("");
  const [testResults, setTestResults] = useState('[{"item_key":"encendido","result":"pass"}]');
  const [testNotes, setTestNotes] = useState("");
  const [completeSerial, setCompleteSerial] = useState("");
  const [completeWarranty, setCompleteWarranty] = useState("{}");
  const [costs, setCosts] = useState<PcBuildCostLine[] | null>(null);
  const [detailPending, setDetailPending] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, options] = await Promise.all([listPcBuildProjects(), listPcBuildFormOptions()]);
      setProjects(rows);
      setFormOptions(options);
      if (options.branches.length === 1) {
        setBranchId((current) => current || options.branches[0].id);
      }
    } catch (err) {
      setError(errorMessage(err, "No se pudieron cargar los proyectos de armado."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return projects.find((p) => p.id === selectedId) ?? null;
  }, [projects, selectedId]);
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
      .catch((error: unknown) => {
        if (isCurrentSelection) {
          setCompatibilityResultsError(errorMessage(error, "No se pudieron cargar las causas de compatibilidad."));
        }
      })
      .finally(() => {
        if (isCurrentSelection) setCompatibilityResultsLoading(false);
      });

    return () => {
      isCurrentSelection = false;
    };
  }, [compatibilityProjectId, compatibilityRevisionId, compatibilityOutcome, compatibilityCheckedAt]);

  const openProjectDetail = (project: PcBuildProjectOverview) => {
    setSelectedId(project.id);
    setCosts(null);
    setDetailError(null);
    setActiveDetailStep(nextBuildStep(project));
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

  const updateDraft = (index: number, patch: Partial<ComponentDraft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const updateRevDraft = (index: number, patch: Partial<ComponentDraft>) => {
    setRevDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const handleCreateBuild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) return;
    setCreateError(null);
    setFeedback(null);

    if (branchId.trim() === "" || customerId.trim() === "" || title.trim() === "") {
      setCreateError("Completá sucursal, cliente y título del armado.");
      return;
    }
    const components = toComponentInputs(drafts);
    if (components.length === 0) {
      setCreateError("Agregá al menos un componente con slot y producto.");
      return;
    }
    if (components.some((component) => !SLOT_CODES.has(component.slot_code))) {
      setCreateError("Seleccioná un slot válido para cada componente.");
      return;
    }

    setIsCreating(true);
    try {
      const result = await createPcBuildAtomic({
        branchId: branchId.trim(),
        customerId: customerId.trim(),
        title: title.trim(),
        notes: notes.trim() ? notes.trim() : null,
        components,
        reason: reason.trim() ? reason.trim() : undefined,
      });
      setFeedback({
        type: "success",
        message: `Armado creado. Compatibilidad inicial: ${result.compatibility_outcome ?? "sin resultado"}.`,
      });
      setIsModalOpen(false);
      setBranchId("");
      setCustomerId("");
      setTitle("");
      setNotes("");
      setReason("");
      setDrafts([emptyDraft()]);
      await refresh();
      setSelectedId(result.project_id);
    } catch (err) {
      setCreateError(errorMessage(err, "No se pudo crear el armado."));
    } finally {
      setIsCreating(false);
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
      setDetailError(errorMessage(err, "La acción no pudo completarse."));
    } finally {
      setDetailPending(null);
    }
  };

  const handleCreateRevision = () => {
    if (!selected) return;
    const components = toComponentInputs(revDrafts);
    if (components.length === 0) {
      setDetailError("Cargá al menos un componente para la nueva revisión.");
      return;
    }
    if (components.some((component) => !SLOT_CODES.has(component.slot_code))) {
      setDetailError("Seleccioná un slot válido para cada componente.");
      return;
    }
    void runDetailAction("revision", async () => {
      if (!selected) return null;
      const revisionId = await createPcBuildRevision({
        projectId: selected.id,
        specVersionId: revSpecVersionId.trim() ? revSpecVersionId.trim() : null,
        ruleSetVersionId: revRuleSetVersionId.trim() ? revRuleSetVersionId.trim() : null,
        configuration: { platform: "desktop_custom", created_via: "erp_workspace" },
        components,
        reason: detailReason.trim() ? detailReason.trim() : undefined,
      });
      return `Revisión creada (${revisionId.slice(0, 8)}…). Ahora registrá la compatibilidad.`;
    });
  };

  const handleCompatibility = () => {
    if (!selected?.latest_revision_id) {
      setDetailError("El proyecto todavía no tiene revisión para chequear.");
      return;
    }
    const revisionId = selected.latest_revision_id;
    void runDetailAction("compatibilidad", async () => {
      const runId = await recordPcCompatibilityRun(
        revisionId,
        detailReason.trim() ? detailReason.trim() : undefined
      );
      return `Compatibilidad registrada (${runId.slice(0, 8)}…).`;
    });
  };

  const handleReserve = () => {
    if (!selected?.latest_revision_id) {
      setDetailError("El proyecto todavía no tiene revisión para reservar.");
      return;
    }
    const projectId = selected.id;
    const revisionId = selected.latest_revision_id;
    const lines = toComponentInputs(revDrafts)
      .map((c) => ({
        product_id: c.product_id,
        variant_id: c.variant_id ?? null,
        inventory_unit_id: c.inventory_unit_id ?? null,
        quantity: Number(c.quantity),
      }))
      .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0);
    if (lines.length === 0) {
      setDetailError("La reserva debe coincidir con los componentes de la revisión: completá el constructor.");
      return;
    }
    const expiresIso = reserveExpires.trim() === "" ? defaultReserveExpires() : reserveExpires.trim();
    void runDetailAction("reserva", async () => {
      const batchId = await reservePcBuildComponents({
        projectId,
        revisionId,
        expiresAt: new Date(expiresIso).toISOString(),
        lines,
        reason: detailReason.trim() ? detailReason.trim() : undefined,
      });
      return `Componentes reservados (lote ${batchId.slice(0, 8)}…).`;
    });
  };

  const handleTest = () => {
    if (!selected?.latest_revision_id) {
      setDetailError("El proyecto todavía no tiene revisión para testear.");
      return;
    }
    if (testTemplateVersionId.trim() === "") {
      setDetailError("Ingresá el ID de la versión de plantilla de testeo.");
      return;
    }
    let parsed: Array<{ item_key: string; result: "pass" | "fail" | "not_applicable"; notes?: string }>;
    try {
      const raw: unknown = JSON.parse(testResults);
      if (!Array.isArray(raw) || raw.length === 0) throw new Error("formato inválido");
      parsed = raw as Array<{ item_key: string; result: "pass" | "fail" | "not_applicable"; notes?: string }>;
    } catch {
      setDetailError("Los resultados deben ser un JSON array válido con item_key y result.");
      return;
    }
    const revisionId = selected.latest_revision_id;
    const templateVersionId = testTemplateVersionId.trim();
    const notesValue = testNotes.trim() ? testNotes.trim() : null;
    void runDetailAction("test", async () => {
      const runId = await recordPcTestRun({
        revisionId,
        templateVersionId,
        results: parsed,
        notes: notesValue,
      });
      return `Testeo registrado (${runId.slice(0, 8)}…).`;
    });
  };

  const handleComplete = () => {
    if (!selected?.latest_revision_id) {
      setDetailError("El proyecto todavía no tiene revisión para completar.");
      return;
    }
    if (!selected.reservation_batch_id) {
      setDetailError("Primero reservá los componentes antes de completar el armado.");
      return;
    }
    if (completeSerial.trim() === "") {
      setDetailError("Ingresá el número de serie del equipo armado.");
      return;
    }
    let warranty: Record<string, unknown> = {};
    try {
      const raw: unknown = JSON.parse(completeWarranty.trim() === "" ? "{}" : completeWarranty);
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("formato inválido");
      warranty = raw as Record<string, unknown>;
    } catch {
      setDetailError("La garantía debe ser un objeto JSON válido.");
      return;
    }
    const projectId = selected.id;
    const revisionId = selected.latest_revision_id;
    const batchId = selected.reservation_batch_id;
    const serial = completeSerial.trim();
    void runDetailAction("complete", async () => {
      const equipmentId = await completePcBuild({
        projectId,
        revisionId,
        reservationBatchId: batchId,
        serial,
        warranty,
        reason: detailReason.trim() ? detailReason.trim() : undefined,
      });
      return `Armado completado. Equipo: ${equipmentId.slice(0, 8)}… Serie: ${serial}.`;
    });
  };

  const handleLoadCosts = () => {
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

  const renderDraftRows = (
    rows: ComponentDraft[],
    onChange: (index: number, patch: Partial<ComponentDraft>) => void,
    onRemove: (index: number) => void
  ) => {
    return rows.map((d, i) => (
      <div
        key={`draft-${i}`}
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 64px 32px", gap: "8px", alignItems: "end" }}
      >
        <div className="erp-form-group">
          <label className="erp-form-label">Slot</label>
          <select
            className="erp-form-input"
            value={d.slot_code}
            onChange={(e) => onChange(i, { slot_code: e.target.value })}
          >
            {SLOT_OPTIONS.map((slot) => (
              <option key={slot.code} value={slot.code}>
                {slot.label}
              </option>
            ))}
          </select>
        </div>
        <div className="erp-form-group">
          <label className="erp-form-label">Producto</label>
          <select
            className="erp-form-input"
            value={d.product_id}
            onChange={(e) => onChange(i, { product_id: e.target.value })}
          >
            <option value="">Seleccionar producto…</option>
            {formOptions.products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.internal_code} · {product.internal_name}
              </option>
            ))}
          </select>
        </div>
        <div className="erp-form-group">
          <label className="erp-form-label">Cant.</label>
          <input
            type="text"
            className="erp-form-input"
            placeholder="1"
            value={d.quantity}
            onChange={(e) => onChange(i, { quantity: e.target.value })}
          />
        </div>
        <button
          type="button"
          className="pag-btn"
          onClick={() => onRemove(i)}
          disabled={rows.length <= 1}
          aria-label={`Quitar componente ${i + 1}`}
        >
          ✕
        </button>
      </div>
    ));
  };

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Armado & Ensamblado de Computadoras (PC Builds)"
        description="Proyectos de armado a medida: revisiones, compatibilidad, reserva, testeo y completitud."
        badge={`${projects.length} Armados`}
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
                placeholder="Buscar por título, cliente, serie o ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button type="button" className="btn-primary" onClick={() => setIsModalOpen(true)}>
              <Plus size={16} /> Nuevo Armado
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
                  <th>Costo</th>
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
                        <code
                          style={{ display: "block", maxWidth: "150px", fontFamily: "monospace", fontSize: "10px", lineHeight: 1.4, overflowWrap: "anywhere", whiteSpace: "normal", color: "var(--text-muted)" }}
                          aria-label={`ID completo: ${p.id}`}
                        >
                          {p.id}
                        </code>
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
                      <td>
                        <strong style={{ color: "var(--brand-primary)" }}>
                          {formatCurrency(p.total_components_cost, "ARS")}
                        </strong>
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
            {detailError && (
              <FeedbackAlert type="error" message={detailError} onClose={() => setDetailError(null)} />
            )}

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
                    ? `${shortId(selected.reservation_batch_id)} • ${selected.reservation_status ?? "—"}`
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

            <div className="erp-form-group">
              <label className="erp-form-label">Motivo de operación (para todas las acciones)</label>
              <input
                type="text"
                className="erp-form-input"
                placeholder="Ej: Avance de armado en taller"
                value={detailReason}
                onChange={(e) => setDetailReason(e.target.value)}
              />
            </div>

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
                <div className="erp-form-group">
                  <label className="erp-form-label">Spec version ID (opcional)</label>
                  <input
                    type="text"
                    className="erp-form-input"
                    placeholder="UUID o vacío"
                    value={revSpecVersionId}
                    onChange={(e) => setRevSpecVersionId(e.target.value)}
                  />
                </div>
                <div className="erp-form-group">
                  <label className="erp-form-label">Rule set version ID (opcional)</label>
                  <input
                    type="text"
                    className="erp-form-input"
                    placeholder="UUID o vacío"
                    value={revRuleSetVersionId}
                    onChange={(e) => setRevRuleSetVersionId(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "8px" }}>
                {renderDraftRows(
                  revDrafts,
                  updateRevDraft,
                  (i) => setRevDrafts((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)))
                )}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="pag-btn"
                  onClick={() => setRevDrafts((prev) => [...prev, emptyDraft()])}
                >
                  + Componente
                </button>
              </div>
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
                Cargá los componentes exactos en “Nueva revisión”, guardala y volvé acá para reservar
                su stock. Las líneas deben coincidir exactamente con esa revisión.
              </p>
              <div className="erp-form-group" style={{ marginBottom: "8px" }}>
                <label className="erp-form-label">Vencimiento de reserva</label>
                <input
                  type="datetime-local"
                  className="erp-form-input"
                  value={reserveExpires}
                  onChange={(e) => setReserveExpires(e.target.value)}
                />
              </div>
            </div>
            )}

            {activeDetailStep === 4 && (
            <div id="pc-build-panel-4" role="tabpanel" aria-labelledby="pc-build-step-4" style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
              <strong style={{ fontSize: "13px" }}>4. Testeo final</strong>
              <p style={{ margin: "4px 0 8px", fontSize: "12px", color: "var(--text-muted)" }}>
                Requiere reserva activa. Los resultados deben coincidir con las claves requeridas
                por la plantilla configurada.
              </p>
              <div className="erp-form-group" style={{ marginBottom: "8px" }}>
                <label className="erp-form-label">Plantilla de testeo (versión ID)</label>
                <input
                  type="text"
                  className="erp-form-input"
                  placeholder="UUID de versión de plantilla"
                  value={testTemplateVersionId}
                  onChange={(e) => setTestTemplateVersionId(e.target.value)}
                />
              </div>
              <div className="erp-form-group" style={{ marginBottom: "8px" }}>
                <label className="erp-form-label">Resultados (JSON)</label>
                <textarea
                  rows={2}
                  className="erp-form-textarea"
                  value={testResults}
                  onChange={(e) => setTestResults(e.target.value)}
                />
              </div>
              <div className="erp-form-group" style={{ marginBottom: "8px" }}>
                <label className="erp-form-label">Notas del testeo</label>
                <input
                  type="text"
                  className="erp-form-input"
                  value={testNotes}
                  onChange={(e) => setTestNotes(e.target.value)}
                />
              </div>
            </div>
            )}

            {activeDetailStep === 5 && (
            <div id="pc-build-panel-5" role="tabpanel" aria-labelledby="pc-build-step-5" style={{ padding: "12px", border: "1px solid var(--border-line)", borderRadius: "10px" }}>
              <strong style={{ fontSize: "13px" }}>5. Completar armado</strong>
              <p style={{ margin: "4px 0 8px", fontSize: "12px", color: "var(--text-muted)" }}>
                Requiere reserva activa y testeo completo aprobado. Genera el equipo y su serie.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                <div className="erp-form-group">
                  <label className="erp-form-label">Número de serie</label>
                  <input
                    type="text"
                    className="erp-form-input"
                    placeholder="Ej: NT-PC-0001"
                    value={completeSerial}
                    onChange={(e) => setCompleteSerial(e.target.value)}
                  />
                </div>
                <div className="erp-form-group">
                  <label className="erp-form-label">Garantía (JSON)</label>
                  <input
                    type="text"
                    className="erp-form-input"
                    value={completeWarranty}
                    onChange={(e) => setCompleteWarranty(e.target.value)}
                  />
                </div>
              </div>
              {costs && (
                <div style={{ marginTop: "8px", fontSize: "12px" }}>
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

            <div
              style={{
                position: "sticky",
                bottom: 0,
                zIndex: 2,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "8px",
                padding: "12px 0 4px",
                borderTop: "1px solid var(--border-line)",
                background: "var(--surface-card)",
              }}
            >
              <button
                type="button"
                className="pag-btn"
                onClick={() => setActiveDetailStep((step) => Math.max(1, step - 1))}
                disabled={activeDetailStep === 1 || detailPending !== null}
              >
                <ChevronLeft size={15} /> Anterior
              </button>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" }}>
                {activeDetailStep === 1 && (
                  <button type="button" className="btn-primary" onClick={handleCreateRevision} disabled={detailPending !== null}>
                    {detailPending === "revision" ? "Creando…" : "Crear revisión"}
                  </button>
                )}
                {activeDetailStep === 2 && (
                  <button type="button" className="btn-primary" onClick={handleCompatibility} disabled={detailPending !== null || !selected.latest_revision_id}>
                    {detailPending === "compatibilidad" ? "Registrando…" : "Registrar compatibilidad"}
                  </button>
                )}
                {activeDetailStep === 3 && (
                  <button type="button" className="btn-primary" onClick={handleReserve} disabled={detailPending !== null || !selected.latest_revision_id}>
                    {detailPending === "reserva" ? "Reservando…" : "Reservar componentes"}
                  </button>
                )}
                {activeDetailStep === 4 && (
                  <button type="button" className="btn-primary" onClick={handleTest} disabled={detailPending !== null || !selected.latest_revision_id}>
                    {detailPending === "test" ? "Registrando…" : "Registrar testeo"}
                  </button>
                )}
                {activeDetailStep === 5 && (
                  <>
                    {selected.completion_id && (
                      <button type="button" className="pag-btn" onClick={handleLoadCosts} disabled={detailPending !== null}>
                        {detailPending === "costos" ? "Cargando…" : "Ver costos"}
                      </button>
                    )}
                    {!selected.completion_id && (
                      <button type="button" className="btn-primary" onClick={handleComplete} disabled={detailPending !== null}>
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
          </div>
        </Modal>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setCreateError(null);
        }}
        title="Nuevo Armado de PC"
        subtitle="Crea proyecto + revisión inicial + chequeo de compatibilidad"
        icon={Sparkles}
        maxWidth="600px"
        scrollBody
      >
        <form onSubmit={(e) => void handleCreateBuild(e)} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {createError && (
            <FeedbackAlert type="error" message={createError} onClose={() => setCreateError(null)} />
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Sucursal *</label>
              <select
                required
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="erp-form-input"
              >
                <option value="">Seleccionar sucursal…</option>
                {formOptions.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>
                ))}
              </select>
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Cliente *</label>
              <select
                required
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="erp-form-input"
              >
                <option value="">Seleccionar cliente…</option>
                {formOptions.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.code} · {customer.display_name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Título del armado *</label>
            <input
              type="text"
              required
              placeholder="Ej: Rig Gamer Ultra 4K"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="erp-form-input"
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase" }}>
              Componentes (slot + producto + cantidad)
            </span>
            {renderDraftRows(
              drafts,
              updateDraft,
              (i) => setDrafts((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)))
            )}
            <button
              type="button"
              className="pag-btn"
              style={{ alignSelf: "flex-start" }}
              onClick={() => setDrafts((prev) => [...prev, emptyDraft()])}
            >
              + Agregar componente
            </button>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Notas</label>
            <textarea
              rows={2}
              placeholder="Gabinete, refrigeración, perfil de uso…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="erp-form-textarea"
            />
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Motivo de operación</label>
            <input
              type="text"
              placeholder="Ej: Pedido de cliente en mostrador"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="erp-form-input"
            />
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "10px",
              marginTop: "8px",
              paddingTop: "12px",
              borderTop: "1px solid var(--border-line)",
              position: "sticky",
              bottom: 0,
              zIndex: 2,
              background: "var(--surface-card)",
            }}
          >
            <button
              type="button"
              className="pag-btn"
              onClick={() => {
                setIsModalOpen(false);
                setCreateError(null);
              }}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={isCreating}>
              {isCreating ? "Creando…" : "Crear Armado"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
