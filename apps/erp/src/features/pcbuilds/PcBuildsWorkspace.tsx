import { useState, useEffect, useMemo } from "react";
import {
  Sparkles,
  Search,
  Eye,
  Plus,
  Cpu,
  Monitor,
  HardDrive,
  Trash2,
} from "lucide-react";
import {
  WorkspaceHeader,
  Modal,
  ConfirmDialog,
  FeedbackAlert,
} from "../../components/erp/WorkspaceUi";
import { formatCurrency } from "../../lib/formatters";

export interface PcBuildItem {
  id: string;
  client: string;
  name: string;
  cpu: string;
  gpu: string;
  ram: string;
  storage: string;
  motherboard?: string;
  psu?: string;
  status: "assembly" | "benchmarking" | "ready";
  priceArs: number;
  notes?: string;
}

const STATUS_MAP = {
  assembly: { label: "En Ensamble", pillClass: "flow-status-pill processing" },
  benchmarking: { label: "Pruebas de Estrés", pillClass: "flow-status-pill confirmed" },
  ready: { label: "Listo / Testeado", pillClass: "flow-status-pill completed" },
};

export const PcBuildsWorkspace = () => {
  const [builds, setBuilds] = useState<PcBuildItem[]>([]);
  const [search, setSearch] = useState("");
  const [selectedBuild, setSelectedBuild] = useState<PcBuildItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [buildToDelete, setBuildToDelete] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form states
  const [client, setClient] = useState("");
  const [name, setName] = useState("");
  const [cpu, setCpu] = useState("AMD Ryzen 7 7800X3D");
  const [gpu, setGpu] = useState("NVIDIA RTX 4070 12GB");
  const [ram, setRam] = useState("32GB DDR5");
  const [storage, setStorage] = useState("1TB NVMe Gen4");
  const [priceArs, setPriceArs] = useState("");
  const [notes, setNotes] = useState("");

  const handleCreateBuild = (e: React.FormEvent) => {
    e.preventDefault();
    if (!client.trim() || !name.trim()) return;

    setFeedback("[Módulo DEMO]: La persistencia transaccional y validación de componentes de PC Builds se implementa en la FASE E.");
    setIsModalOpen(false);
    setClient("");
    setName("");
    setPriceArs("");
    setNotes("");
  };

  const handleUpdateStatus = (id: string, nextStatus: PcBuildItem["status"]) => {
    setBuilds((prev) =>
      prev.map((b) => (b.id === id ? { ...b, status: nextStatus } : b))
    );
    if (selectedBuild && selectedBuild.id === id) {
      setSelectedBuild({ ...selectedBuild, status: nextStatus });
    }
    setFeedback(`¡Estado de armado actualizado a "${STATUS_MAP[nextStatus].label}"!`);
  };

  const confirmDelete = () => {
    if (!buildToDelete) return;
    setBuilds((prev) => prev.filter((b) => b.id !== buildToDelete));
    if (selectedBuild?.id === buildToDelete) setSelectedBuild(null);
    setBuildToDelete(null);
    setFeedback("Armado de PC eliminado.");
  };

  const filteredBuilds = useMemo(() => {
    return builds.filter((b) => {
      const q = search.toLowerCase();
      return (
        b.name.toLowerCase().includes(q) ||
        b.client.toLowerCase().includes(q) ||
        b.cpu.toLowerCase().includes(q) ||
        b.gpu.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q)
      );
    });
  }, [builds, search]);

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Armado & Ensamblado de Computadoras (PC Builds)"
        description="Configurador de hardware a medida, compatibilidad de sockets y fuentes, control de ensamblado y pruebas de estrés."
        badge={`${builds.length} Armados en Taller`}
      />

      {feedback && (
        <FeedbackAlert
          type="success"
          message={feedback}
          onClose={() => setFeedback(null)}
        />
      )}

      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Órdenes de Armado de PC</h2>
            <p className="flow-card__subtitle">Configuraciones en laboratorio de ensamble y testing</p>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <div className="flow-search-pill" style={{ width: "240px" }}>
              <Search size={15} />
              <input type="text" placeholder="Buscar armado..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={() => setIsModalOpen(true)}
            >
              <Plus size={16} /> Nuevo Armado
            </button>
          </div>
        </div>

        <div style={{ padding: "12px 16px", background: "rgba(234, 179, 8, 0.1)", borderBottom: "1px solid var(--border-line)", display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--amber-accent)" }}>
          <Cpu size={16} style={{ flexShrink: 0 }} />
          <span><strong>[Módulo DEMO / En Desarrollo - FASE E]:</strong> El módulo de ensamblado de PC con verificación técnica de compatibilidad y control de hardware se integrará en la FASE E. Actualmente no almacena datos ficticios ni simula benchmarking.</span>
        </div>

        <div className="flow-table-wrapper">
          <table className="flow-table">
            <thead>
              <tr>
                <th>Código Armado</th>
                <th>Cliente / Titular</th>
                <th>Proyecto / Perfil</th>
                <th>Componentes Clave (CPU / GPU)</th>
                <th>Presupuesto ARS</th>
                <th>Estado</th>
                <th className="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filteredBuilds.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    No hay órdenes de armado de PC registradas en el taller.
                  </td>
                </tr>
              ) : (
                filteredBuilds.map((b) => {
                const st = STATUS_MAP[b.status];
                return (
                  <tr key={b.id} style={{ cursor: "pointer" }} onClick={() => setSelectedBuild(b)}>
                    <td>
                      <span className="type-badge purple" style={{ fontFamily: "monospace" }}>{b.id}</span>
                    </td>
                    <td><strong>{b.client}</strong></td>
                    <td><span style={{ fontSize: "13px", fontWeight: 650 }}>{b.name}</span></td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", fontSize: "12px" }}>
                        <span>{b.cpu}</span>
                        <span style={{ color: "var(--steel-blue)", fontWeight: 600 }}>{b.gpu}</span>
                      </div>
                    </td>
                    <td><strong style={{ color: "var(--brand-primary)" }}>{formatCurrency(b.priceArs, "ARS")}</strong></td>
                    <td><span className={st.pillClass}>{st.label}</span></td>
                    <td className="text-right">
    <div style={{ display: "inline-flex", gap: "6px" }}>
      <button
        type="button"
        className="pag-btn"
        style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--brand-primary)", borderColor: "var(--brand-border)" }}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedBuild(b);
        }}
        title="Ver Desglose de Componentes"
      >
        <Eye size={12} /> Desglose
      </button>
      <button
        type="button"
        className="pag-btn"
        style={{ color: "var(--rose-accent)", padding: "4px 8px" }}
        onClick={(e) => {
          e.stopPropagation();
          setBuildToDelete(b.id);
        }}
        aria-label={`Eliminar armado ${b.id}`}
      >
        <Trash2 size={13} />
      </button>
    </div>
  </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Build Detail Modal */}
      {selectedBuild && (
        <Modal
          isOpen={Boolean(selectedBuild)}
          onClose={() => setSelectedBuild(null)}
          title={`Ficha de Ensamble: ${selectedBuild.name}`}
          subtitle={`${selectedBuild.id} • Cliente: ${selectedBuild.client}`}
          icon={Cpu}
          maxWidth="600px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* Status Change Buttons */}
            <div style={{ padding: "12px", background: "var(--surface-white)", borderRadius: "10px", border: "1px solid var(--border-line)" }}>
              <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
                Cambiar Etapa de Ensamble:
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                {(["assembly", "benchmarking", "ready"] as const).map((stKey) => (
                  <button
                    key={stKey}
                    type="button"
                    className={`flow-select-pill ${selectedBuild.status === stKey ? "active" : ""}`}
                    onClick={() => handleUpdateStatus(selectedBuild.id, stKey)}
                  >
                    {STATUS_MAP[stKey].label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: "var(--canvas-bg)", padding: "12px", borderRadius: "10px" }}>
              <div>
                <span className="stat-label">CPU / Procesador</span>
                <strong style={{ display: "block", fontSize: "13px", marginTop: "2px" }}>
                  {selectedBuild.cpu}
                </strong>
              </div>
              <div>
                <span className="stat-label">GPU / Gráfica</span>
                <strong style={{ display: "block", fontSize: "13px", marginTop: "2px", color: "var(--steel-blue)" }}>
                  {selectedBuild.gpu}
                </strong>
              </div>
              <div>
                <span className="stat-label">RAM & Almacenamiento</span>
                <span style={{ display: "block", fontSize: "13px", marginTop: "2px", fontWeight: 650 }}>
                  {selectedBuild.ram} • {selectedBuild.storage}
                </span>
              </div>
              <div>
                <span className="stat-label">Presupuesto Total</span>
                <strong style={{ display: "block", fontSize: "14px", marginTop: "2px", color: "var(--brand-primary)" }}>
                  {formatCurrency(selectedBuild.priceArs, "ARS")}
                </strong>
              </div>
            </div>

            {selectedBuild.notes && (
              <div style={{ padding: "12px", background: "var(--surface-subtle)", borderRadius: "10px" }}>
                <span className="stat-label">Notas de Laboratorio:</span>
                <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-main)", fontWeight: 500 }}>
                  {selectedBuild.notes}
                </p>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Modal: New Build */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Nueva Orden de Armado de PC"
        subtitle="Configuración personalizada para cliente o stock de exhibición"
        icon={Sparkles}
        maxWidth="540px"
      >
        <form onSubmit={handleCreateBuild} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Cliente / Solicitante *</label>
              <input
                type="text"
                required
                placeholder="Ej: Gonzalo Valenzuela"
                value={client}
                onChange={(e) => setClient(e.target.value)}
                className="erp-form-input"
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Nombre del Proyecto / Setup *</label>
              <input
                type="text"
                required
                placeholder="Ej: Rig Gamer Ultra 4K"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Procesador (CPU) *</label>
              <input
                type="text"
                required
                placeholder="Ej: AMD Ryzen 7 7800X3D"
                value={cpu}
                onChange={(e) => setCpu(e.target.value)}
                className="erp-form-input"
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Placa de Video (GPU) *</label>
              <input
                type="text"
                required
                placeholder="Ej: NVIDIA RTX 4070 Ti Super"
                value={gpu}
                onChange={(e) => setGpu(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Memoria RAM</label>
              <input
                type="text"
                placeholder="Ej: 32GB DDR5 6000MHz"
                value={ram}
                onChange={(e) => setRam(e.target.value)}
                className="erp-form-input"
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Almacenamiento</label>
              <input
                type="text"
                placeholder="Ej: 2TB NVMe Gen4"
                value={storage}
                onChange={(e) => setStorage(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Precio Total ($ ARS)</label>
            <input
              type="number"
              placeholder="Ej: 2950000"
              value={priceArs}
              onChange={(e) => setPriceArs(e.target.value)}
              className="erp-form-input"
            />
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Notas de Hardware & Ensamblado</label>
            <textarea
              rows={2}
              placeholder="Gabinete, refrigeración, perfil de ventiladores..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="erp-form-textarea"
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary">
              Crear Armado
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(buildToDelete)}
        title="Eliminar Armado"
        message="¿Estás seguro de que deseás eliminar esta orden de armado de PC?"
        confirmLabel="Eliminar Armado"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setBuildToDelete(null)}
      />
    </div>
  );
};
