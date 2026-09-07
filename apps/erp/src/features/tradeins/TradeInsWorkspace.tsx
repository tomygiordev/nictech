import { useState, useEffect, useMemo } from "react";
import {
  Smartphone,
  Search,
  Eye,
  Plus,
  ShieldCheck,
  RefreshCw,
  DollarSign,
  Trash2,
} from "lucide-react";
import {
  WorkspaceHeader,
  Modal,
  ConfirmDialog,
  FeedbackAlert,
  KpiCard,
} from "../../components/erp/WorkspaceUi";
import { formatCurrency, formatDateTime } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";

export interface TradeInItem {
  id: string;
  trackingCode: string;
  customerName: string;
  customerDni: string;
  deviceBrand: string;
  deviceModel: string;
  serialImei: string;
  imeiStatus: "clear" | "blocked" | "checking" | "not_required";
  conditionScore: string;
  batteryHealth: number;
  declaredValueUsd: number;
  assessedValueArs: number;
  status: "quarantine" | "evaluating" | "ready_for_stock" | "applied_to_sale" | "rejected";
  targetSaleId?: string;
  entryDate: string;
  notes: string;
}

const STATUS_MAP = {
  quarantine: { label: "En Cuarentena", pillClass: "flow-status-pill pending" },
  evaluating: { label: "En Evaluación Técnica", pillClass: "flow-status-pill processing" },
  ready_for_stock: { label: "Listo para Stock", pillClass: "flow-status-pill confirmed" },
  applied_to_sale: { label: "Aplicado a Venta", pillClass: "flow-status-pill completed" },
  rejected: { label: "Rechazado", pillClass: "flow-status-pill cancelled" },
};

export const TradeInsWorkspace = () => {
  const [items, setItems] = useState<TradeInItem[]>([]);
  const [dollarRate, setDollarRate] = useState<number>(1250);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<TradeInItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [tradeInToDelete, setTradeInToDelete] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form states for receiving trade-in
  const [customerName, setCustomerName] = useState("");
  const [customerDni, setCustomerDni] = useState("");
  const [deviceBrand, setDeviceBrand] = useState("Apple");
  const [deviceModel, setDeviceModel] = useState("");
  const [serialImei, setSerialImei] = useState("");
  const [conditionScore, setConditionScore] = useState("8.5 / 10 - Muy Bueno");
  const [batteryHealth, setBatteryHealth] = useState("85");
  const [declaredValueUsd, setDeclaredValueUsd] = useState("");
  const [assessedValueArs, setAssessedValueArs] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const fetchRate = async () => {
      try {
        const { data } = await supabase.from("dollar_settings").select("rate").limit(1).maybeSingle();
        if (data?.rate) setDollarRate(Number(data.rate));
      } catch (e) {
        console.error(e);
      }
    };
    void fetchRate();
  }, []);

  const handleCreateTradeIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !deviceModel.trim()) return;

    setFeedback("[Módulo DEMO]: La persistencia de canjes y validación de IMEI se integrará en la FASE E.");
    setIsModalOpen(false);
    setCustomerName("");
    setCustomerDni("");
    setDeviceModel("");
    setSerialImei("");
    setDeclaredValueUsd("");
    setAssessedValueArs("");
    setNotes("");
  };

  const handleUpdateStatus = (id: string, nextStatus: TradeInItem["status"]) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, status: nextStatus } : it))
    );
    if (selectedItem && selectedItem.id === id) {
      setSelectedItem({ ...selectedItem, status: nextStatus });
    }
    setFeedback(`¡Estado actualizado a "${STATUS_MAP[nextStatus].label}"!`);
  };

  const confirmDelete = () => {
    if (!tradeInToDelete) return;
    setItems((prev) => prev.filter((it) => it.id !== tradeInToDelete));
    if (selectedItem?.id === tradeInToDelete) setSelectedItem(null);
    setTradeInToDelete(null);
    setFeedback("Registro de canje eliminado.");
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchFilter = activeFilter === "all" || item.status === activeFilter;
      const q = search.toLowerCase();
      const matchSearch =
        item.customerName.toLowerCase().includes(q) ||
        item.deviceModel.toLowerCase().includes(q) ||
        item.trackingCode.toLowerCase().includes(q) ||
        item.serialImei.includes(q);
      return matchFilter && matchSearch;
    });
  }, [items, activeFilter, search]);

  const totalAssessedArs = useMemo(() => {
    return items.reduce((acc, it) => acc + it.assessedValueArs, 0);
  }, [items]);

  const totalDeclaredUsd = useMemo(() => {
    return items.reduce((acc, it) => acc + it.declaredValueUsd, 0);
  }, [items]);

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Equipos Usados & Canjes en Parte de Pago (Trade-in)"
        description="Gestión integral de recepción de usados, declaración jurada de procedencia, verificación ENACOM/IMEI, tasación y liberación a inventario."
        badge={`${items.length} Canjes Registrados`}
      />

      {feedback && (
        <FeedbackAlert
          type="success"
          message={feedback}
          onClose={() => setFeedback(null)}
        />
      )}

      {/* KPI Cards */}
      <div className="kpi-grid">
        <KpiCard
          icon={Smartphone}
          iconVariant="green"
          label="Equipos Recibidos"
          value={items.length}
          trend={{ text: "Canjes", positive: true }}
          sublabel={`${items.filter((i) => i.status === "quarantine" || i.status === "evaluating").length} en revisión`}
        />

        <KpiCard
          icon={DollarSign}
          iconVariant="navy"
          label="Tasación Total"
          value={formatCurrency(totalAssessedArs, "ARS")}
          trend={{ text: formatCurrency(totalDeclaredUsd, "USD"), positive: true }}
          sublabel="Crédito a favor de clientes"
        />

        <KpiCard
          icon={ShieldCheck}
          iconVariant="steel"
          label="Verificación IMEI"
          value={items.length > 0 ? `${items.filter((i) => i.imeiStatus === "clear").length} Verificados` : "0"}
          trend={{ text: "Control IMEI", positive: true }}
          sublabel="Pendiente de consulta formal"
        />

        <KpiCard
          icon={RefreshCw}
          iconVariant="dark"
          label="Liberados a Stock"
          value={items.filter((i) => i.status === "ready_for_stock" || i.status === "applied_to_sale").length}
          trend={{ text: "Stock Usados", positive: true }}
          sublabel="Garantía 90 días"
        />
      </div>

      <div style={{ padding: "12px 16px", background: "rgba(234, 179, 8, 0.1)", border: "1px solid rgba(234, 179, 8, 0.3)", borderRadius: "8px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--amber-accent)" }}>
        <ShieldCheck size={16} style={{ flexShrink: 0 }} />
        <span><strong>[Módulo DEMO / En Desarrollo - FASE E]:</strong> La verificación técnica de IMEI (ENACOM), declaraciones juradas y liberación formal a inventario se integrarán en la FASE E. No se generan IMEIs inventados ni se certifican estados sin evidencia técnica.</span>
      </div>

      {/* Main Card */}
      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Registro de Equipos en Parte de Pago</h2>
            <p className="flow-card__subtitle">Trazabilidad de origen, declaraciones de procedencia y tasación técnica</p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div className="flow-search-pill" style={{ width: "260px" }}>
              <Search size={15} />
              <input
                type="text"
                placeholder="Buscar por cliente, modelo, IMEI o código..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={() => setIsModalOpen(true)}
            >
              <Plus size={16} />
              Recibir Equipo Usado
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", overflowX: "auto" }}>
          {[
            { id: "all", label: "Todos los Canjes" },
            { id: "quarantine", label: "En Cuarentena" },
            { id: "evaluating", label: "En Evaluación" },
            { id: "ready_for_stock", label: "Listos para Stock" },
            { id: "applied_to_sale", label: "Aplicados a Venta" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`flow-select-pill ${activeFilter === tab.id ? "active" : ""}`}
              onClick={() => setActiveFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="flow-table-wrapper">
          <table className="flow-table">
            <thead>
              <tr>
                <th>Código Canje</th>
                <th>Cliente Titular</th>
                <th>Equipo / Modelo</th>
                <th>IMEI / Serie</th>
                <th>Estado Físico / Batería</th>
                <th>Tasación (ARS / USD)</th>
                <th>Estado</th>
                <th className="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    No hay equipos en canje ni usados registrados en el sistema.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                const st = STATUS_MAP[item.status] || STATUS_MAP.quarantine;
                return (
                  <tr key={item.id} style={{ cursor: "pointer" }} onClick={() => setSelectedItem(item)}>
                    <td>
                      <span className="type-badge purple" style={{ fontFamily: "monospace" }}>
                        {item.trackingCode}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <strong>{item.customerName}</strong>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>DNI {item.customerDni}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <Smartphone size={15} color="var(--brand-primary)" />
                        <strong>{item.deviceBrand} {item.deviceModel}</strong>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-main)" }}>
                          {item.serialImei}
                        </span>
                        {item.imeiStatus === "clear" && (
                          <span title="IMEI Verificado Limpio" style={{ color: "var(--emerald-success)", fontSize: "11px", fontWeight: 700 }}>
                            ✓ Limpio
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "12px", color: "var(--text-main)", fontWeight: 600 }}>{item.conditionScore}</span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Salud Batería: {item.batteryHealth}%</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <strong style={{ color: "var(--brand-primary)" }}>{formatCurrency(item.assessedValueArs, "ARS")}</strong>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{formatCurrency(item.declaredValueUsd, "USD")}</span>
                      </div>
                    </td>
                    <td>
                      <span className={st.pillClass}>{st.label}</span>
                    </td>
                    <td className="text-right">
    <div style={{ display: "inline-flex", gap: "6px" }}>
      <button
        type="button"
        className="pag-btn"
        style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--brand-primary)", borderColor: "var(--brand-border)" }}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedItem(item);
        }}
        title="Ver Peritaje Técnico"
      >
        <Eye size={12} /> Peritaje
      </button>
      <button
        type="button"
        className="pag-btn"
        style={{ color: "var(--rose-accent)", padding: "4px 8px" }}
        onClick={(e) => {
          e.stopPropagation();
          setTradeInToDelete(item.id);
        }}
        aria-label={`Eliminar canje ${item.trackingCode}`}
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

      {/* Trade-in Detail Modal */}
      {selectedItem && (
        <Modal
          isOpen={Boolean(selectedItem)}
          onClose={() => setSelectedItem(null)}
          title={`Ficha de Canje: ${selectedItem.deviceBrand} ${selectedItem.deviceModel}`}
          subtitle={`${selectedItem.trackingCode} • Titular: ${selectedItem.customerName}`}
          icon={Smartphone}
          maxWidth="620px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* Status Progression Actions */}
            <div style={{ padding: "12px", background: "var(--surface-white)", borderRadius: "10px", border: "1px solid var(--border-line)" }}>
              <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
                Actualizar Etapa del Canje:
              </span>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {(["quarantine", "evaluating", "ready_for_stock", "applied_to_sale", "rejected"] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={`flow-select-pill ${selectedItem.status === st ? "active" : ""}`}
                    onClick={() => handleUpdateStatus(selectedItem.id, st)}
                  >
                    {STATUS_MAP[st].label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px", background: "var(--canvas-bg)", padding: "12px", borderRadius: "10px" }}>
              <div>
                <span className="stat-label">IMEI / Nro Serie</span>
                <strong style={{ display: "block", fontSize: "13px", marginTop: "2px", fontFamily: "monospace" }}>
                  {selectedItem.serialImei}
                </strong>
              </div>
              <div>
                <span className="stat-label">Declaración Jurada</span>
                <strong style={{ display: "block", fontSize: "13px", marginTop: "2px", color: "var(--text-muted)" }}>
                  {selectedItem.notes?.toLowerCase().includes("declaracion") ? "Presentada" : "Pendiente de formalización"}
                </strong>
              </div>
              <div>
                <span className="stat-label">Fecha de Ingreso</span>
                <span style={{ display: "block", fontSize: "13px", marginTop: "2px", fontWeight: 600 }}>
                  {selectedItem.entryDate}
                </span>
              </div>
              <div>
                <span className="stat-label">Valor Acreditado</span>
                <strong style={{ display: "block", fontSize: "14px", marginTop: "2px", color: "var(--brand-primary)" }}>
                  {formatCurrency(selectedItem.assessedValueArs, "ARS")} ({formatCurrency(selectedItem.declaredValueUsd, "USD")})
                </strong>
              </div>
            </div>

            {selectedItem.notes && (
              <div style={{ padding: "12px", background: "var(--surface-subtle)", borderRadius: "10px" }}>
                <span className="stat-label">Observaciones y Condiciones:</span>
                <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-main)", fontWeight: 500 }}>
                  {selectedItem.notes}
                </p>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Modal: Recibir Equipo Usado */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Recibir Equipo en Parte de Pago (Trade-in)"
        subtitle={`Tasación con tipo de cambio $${dollarRate.toLocaleString("es-AR")}`}
        icon={Smartphone}
        maxWidth="540px"
      >
        <form onSubmit={handleCreateTradeIn} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Cliente Titular *</label>
              <input
                type="text"
                required
                placeholder="Ej: Mariano Castiglione"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="erp-form-input"
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">DNI / CUIT</label>
              <input
                type="text"
                placeholder="Ej: 38.921.049"
                value={customerDni}
                onChange={(e) => setCustomerDni(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Marca *</label>
              <select
                value={deviceBrand}
                onChange={(e) => setDeviceBrand(e.target.value)}
                className="erp-form-select"
              >
                <option value="Apple">Apple</option>
                <option value="Samsung">Samsung</option>
                <option value="Motorola">Motorola</option>
                <option value="Xiaomi">Xiaomi</option>
                <option value="Sony">Sony</option>
              </select>
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Modelo del Dispositivo *</label>
              <input
                type="text"
                required
                placeholder="Ej: iPhone 13 Pro 128GB Azul Sierra"
                value={deviceModel}
                onChange={(e) => setDeviceModel(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Número IMEI / Serie</label>
              <input
                type="text"
                placeholder="15 dígitos IMEI (opcional)"
                value={serialImei}
                onChange={(e) => setSerialImei(e.target.value)}
                className="erp-form-input"
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Batería (%)</label>
              <input
                type="number"
                min="1"
                max="100"
                value={batteryHealth}
                onChange={(e) => setBatteryHealth(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Tasación (USD)</label>
              <input
                type="number"
                placeholder="Ej: 350"
                value={declaredValueUsd}
                onChange={(e) => setDeclaredValueUsd(e.target.value)}
                className="erp-form-input"
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Tasación ($ ARS)</label>
              <input
                type="number"
                placeholder="Ej: 437500"
                value={assessedValueArs}
                onChange={(e) => setAssessedValueArs(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Detalles del Estado / Accesorios Entregados</label>
            <textarea
              rows={2}
              placeholder="Incluye caja, cargador, detalles estéticos..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="erp-form-textarea"
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary">
              Registrar Canje
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(tradeInToDelete)}
        title="Eliminar Canje"
        message="¿Estás seguro de que deseás eliminar este registro de canje?"
        confirmLabel="Eliminar Canje"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setTradeInToDelete(null)}
      />
    </div>
  );
};
