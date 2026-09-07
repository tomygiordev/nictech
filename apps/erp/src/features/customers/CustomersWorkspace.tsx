import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Users,
  Search,
  Eye,
  Plus,
  Phone,
  CreditCard,
  Trash2,
  DollarSign,
  TrendingUp,
} from "lucide-react";
import {
  WorkspaceHeader,
  Modal,
  ConfirmDialog,
  FeedbackAlert,
  KpiCard,
} from "../../components/erp/WorkspaceUi";
import { formatCurrency } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";
import { useErpAuth } from "../../auth/ErpAuthContext";

export interface CustomerRecord {
  id: string;
  name: string;
  docType: "DNI" | "CUIT";
  docNumber: string;
  email: string;
  phone: string;
  city: string;
  totalSpentArs: number;
  ordersCount: number;
  activeRepairs: number;
  creditBalanceArs: number;
  notes?: string;
  repairsList?: Array<{
    id: string;
    order_code: string;
    brand: string;
    model: string;
    status: string;
    status_is_terminal: boolean;
  }>;
}

export const CustomersWorkspace = () => {
  const { organizationId } = useErpAuth();
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState<string>("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form states for new customer
  const [name, setName] = useState("");
  const [docType, setDocType] = useState<"DNI" | "CUIT">("DNI");
  const [docNumber, setDocNumber] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("CABA");
  const [creditBalance, setCreditBalance] = useState("0");
  const [notes, setNotes] = useState("");

  const fetchCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [customersRes, repairsRes, salesRes] = await Promise.all([
        supabase
          .from("customers")
          .select("id, code, kind, display_name, legal_name, email, phone, whatsapp_phone, is_active, created_at")
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
        supabase
          .from("repair_orders_overview")
          .select("id, customer_id, order_code, brand, model, status, status_is_terminal, created_at"),
        supabase
          .from("sales")
          .select("id, customer_id, total_amount, status")
          .eq("status", "completed"),
      ]);

      if (customersRes.error) throw customersRes.error;

      const repairsByCustomer = new Map<string, Array<{ id: string; order_code: string; brand: string; model: string; status: string; status_is_terminal: boolean }>>();
      (repairsRes.data || []).forEach((r: any) => {
        if (!r.customer_id) return;
        const list = repairsByCustomer.get(r.customer_id) || [];
        list.push({
          id: r.id,
          order_code: r.order_code,
          brand: r.brand || "",
          model: r.model || "",
          status: r.status || "En taller",
          status_is_terminal: Boolean(r.status_is_terminal),
        });
        repairsByCustomer.set(r.customer_id, list);
      });

      const salesByCustomer = new Map<string, { count: number; totalArs: number }>();
      (salesRes.data || []).forEach((s: any) => {
        if (!s.customer_id) return;
        const cur = salesByCustomer.get(s.customer_id) || { count: 0, totalArs: 0 };
        cur.count += 1;
        cur.totalArs += Number(s.total_amount || 0);
        salesByCustomer.set(s.customer_id, cur);
      });

      const mapped: CustomerRecord[] = (customersRes.data || []).map((c) => {
        const cRepairs = repairsByCustomer.get(c.id) || [];
        const activeRepairsCount = cRepairs.filter((r) => !r.status_is_terminal).length;
        const cSales = salesByCustomer.get(c.id) || { count: 0, totalArs: 0 };

        return {
          id: c.id,
          name: c.display_name,
          docType: c.kind === "company" ? "CUIT" : "DNI",
          docNumber: c.code || "—",
          email: c.email || "—",
          phone: c.phone || c.whatsapp_phone || "—",
          city: "CABA",
          totalSpentArs: cSales.totalArs,
          ordersCount: cSales.count,
          activeRepairs: activeRepairsCount,
          creditBalanceArs: 0,
          notes: c.legal_name || undefined,
          repairsList: cRepairs,
        };
      });
      setCustomers(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar clientes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCustomers();
  }, [fetchCustomers]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      const orgId = organizationId || "10000000-0000-0000-0000-000000000001";
      const code = docNumber.trim() && docNumber.trim() !== "—"
        ? docNumber.trim()
        : `CLI-${Date.now().toString().slice(-6)}`;

      const { error: insErr } = await supabase.from("customers").insert([
        {
          organization_id: orgId,
          code,
          kind: docType === "CUIT" ? "company" : "person",
          display_name: name.trim(),
          legal_name: notes.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          is_active: true,
        },
      ]);

      if (insErr) throw insErr;

      setFeedback(`¡Cliente "${name.trim()}" registrado correctamente!`);
      setIsNewModalOpen(false);
      setName("");
      setDocNumber("");
      setEmail("");
      setPhone("");
      setCreditBalance("0");
      setNotes("");
      await fetchCustomers();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Error al registrar cliente");
    }
  };

  const confirmDeleteCustomer = async () => {
    if (!customerToDelete) return;
    try {
      const { error: delErr } = await supabase
        .from("customers")
        .update({ is_active: false })
        .eq("id", customerToDelete);
      if (delErr) throw delErr;
      if (selectedCustomer?.id === customerToDelete) setSelectedCustomer(null);
      setCustomerToDelete(null);
      setFeedback("Cliente dado de baja del padrón.");
      await fetchCustomers();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Error al dar de baja cliente");
    }
  };


  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.docNumber.includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.city.toLowerCase().includes(q)
      );
    });
  }, [customers, search]);

  const totalRevenue = useMemo(() => {
    return customers.reduce((acc, c) => acc + c.totalSpentArs, 0);
  }, [customers]);

  const totalCredit = useMemo(() => {
    return customers.reduce((acc, c) => acc + c.creditBalanceArs, 0);
  }, [customers]);

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Gestión de Clientes & CRM"
        description="Ficha unificada de clientes, historial de compras, reparaciones activas en taller y cuenta corriente de crédito."
        badge={`${customers.length} Clientes Registrados`}
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
          icon={Users}
          iconVariant="green"
          label="Clientes Activos"
          value={customers.length}
          trend={{ text: "Padrón", positive: true }}
          sublabel="Particulares & Corporativos"
        />

        <KpiCard
          icon={DollarSign}
          iconVariant="navy"
          label="Facturado a Clientes"
          value={formatCurrency(totalRevenue, "ARS")}
          trend={{ text: "ARS", positive: true }}
          sublabel="Historial acumulado en ventas"
        />

        <KpiCard
          icon={CreditCard}
          iconVariant="steel"
          label="Crédito Otorgado"
          value={formatCurrency(totalCredit, "ARS")}
          trend={{ text: "Saldos", positive: true }}
          sublabel="Cuentas corrientes activas"
        />

        <KpiCard
          icon={TrendingUp}
          iconVariant="dark"
          label="Ticket Promedio"
          value={customers.length > 0 ? formatCurrency(Math.round(totalRevenue / customers.length), "ARS") : "—"}
          trend={{ text: "LTV", positive: true }}
          sublabel="Promedio por cuenta"
        />
      </div>

      {/* Main Table */}
      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Directorio de Clientes</h2>
            <p className="flow-card__subtitle">Búsqueda rápida por nombre, DNI/CUIT, teléfono o ciudad</p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div className="flow-search-pill" style={{ width: "260px" }}>
              <Search size={15} />
              <input
                type="text"
                placeholder="Buscar cliente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={() => setIsNewModalOpen(true)}
            >
              <Plus size={16} />
              Nuevo Cliente
            </button>
          </div>
        </div>

        <div className="flow-table-wrapper">
          <table className="flow-table">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Nombre / Razón Social</th>
                <th>Contacto</th>
                <th>Ciudad</th>
                <th>Compras</th>
                <th>Taller</th>
                <th>Saldo Crédito</th>
                <th className="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "36px", color: "var(--text-muted)" }}>
                    {loading ? "Cargando clientes desde la base de datos…" : error ? `Error: ${error}` : "No hay clientes registrados en el sistema."}
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((c) => (
                <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setSelectedCustomer(c)}>
                  <td>
                    <span className="type-badge blue" style={{ fontFamily: "monospace" }}>
                      {c.docType}: {c.docNumber}
                    </span>
                  </td>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", fontSize: "12px" }}>
                      <span>{c.email}</span>
                      <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>{c.phone}</span>
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: "12px" }}>{c.city}</span>
                  </td>
                  <td>
                    <span className="type-badge green">{c.ordersCount} pedidos</span>
                  </td>
                  <td>
                    {c.activeRepairs > 0 ? (
                      <span className="flow-status-pill processing">{c.activeRepairs} en taller</span>
                    ) : (
                      <span style={{ fontSize: "12px", color: "var(--text-light)" }}>—</span>
                    )}
                  </td>
                  <td>
                    <strong style={{ color: c.creditBalanceArs > 0 ? "var(--emerald-success)" : "var(--text-muted)" }}>
                      {formatCurrency(c.creditBalanceArs, "ARS")}
                    </strong>
                  </td>
                  <td className="text-right">
    <div style={{ display: "inline-flex", gap: "6px" }}>
      <button
        type="button"
        className="pag-btn"
        style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--brand-primary)", borderColor: "var(--brand-border)" }}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedCustomer(c);
        }}
        title="Ver Ficha / Historial"
      >
        <Eye size={12} /> Ficha
      </button>
      <button
        type="button"
        className="pag-btn"
        style={{ color: "var(--rose-accent)", padding: "4px 8px" }}
        onClick={(e) => {
          e.stopPropagation();
          setCustomerToDelete(c.id);
        }}
        aria-label={`Eliminar cliente ${c.name}`}
      >
        <Trash2 size={13} />
      </button>
    </div>
  </td>
</tr>
)))}
</tbody>
          </table>
        </div>
      </div>

      {/* Customer Detail Modal */}
      {selectedCustomer && (
        <Modal
          isOpen={Boolean(selectedCustomer)}
          onClose={() => setSelectedCustomer(null)}
          title={`Ficha de Cliente: ${selectedCustomer.name}`}
          subtitle={`${selectedCustomer.docType}: ${selectedCustomer.docNumber} • ${selectedCustomer.city}`}
          icon={Users}
          maxWidth="560px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: "var(--canvas-bg)", padding: "12px", borderRadius: "10px" }}>
              <div>
                <span className="stat-label">Email de Contacto</span>
                <strong style={{ display: "block", fontSize: "13px", marginTop: "2px" }}>
                  {selectedCustomer.email}
                </strong>
              </div>
              <div>
                <span className="stat-label">Teléfono</span>
                <strong style={{ display: "block", fontSize: "13px", marginTop: "2px" }}>
                  {selectedCustomer.phone}
                </strong>
              </div>
              <div>
                <span className="stat-label">Saldo a Favor / Crédito</span>
                <strong style={{ display: "block", fontSize: "14px", marginTop: "2px", color: selectedCustomer.creditBalanceArs > 0 ? "var(--emerald-success)" : "var(--text-main)" }}>
                  {formatCurrency(selectedCustomer.creditBalanceArs, "ARS")}
                </strong>
              </div>
              <div>
                <span className="stat-label">Facturado Histórico</span>
                <strong style={{ display: "block", fontSize: "14px", marginTop: "2px", color: "var(--brand-primary)" }}>
                  {formatCurrency(selectedCustomer.totalSpentArs, "ARS")}
                </strong>
              </div>
            </div>

            {selectedCustomer.repairsList && selectedCustomer.repairsList.length > 0 && (
              <div style={{ padding: "12px", background: "var(--surface-subtle)", borderRadius: "10px" }}>
                <span className="stat-label" style={{ display: "block", marginBottom: "8px" }}>
                  Equipos y Reparaciones en Taller ({selectedCustomer.repairsList.length}):
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {selectedCustomer.repairsList.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: "12px",
                        background: "var(--bg-app)",
                        padding: "8px 10px",
                        borderRadius: "6px",
                      }}
                    >
                      <div>
                        <strong style={{ fontFamily: "monospace", color: "var(--brand-primary)" }}>{r.order_code}</strong>
                        <span style={{ marginLeft: "8px", color: "var(--text-main)" }}>{r.brand} {r.model}</span>
                      </div>
                      <span className={`flow-status-pill ${r.status_is_terminal ? "completed" : "processing"}`}>
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedCustomer.notes && (
              <div style={{ padding: "12px", background: "var(--surface-subtle)", borderRadius: "10px" }}>
                <span className="stat-label">Notas del Cliente:</span>
                <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-main)", fontWeight: 500 }}>
                  {selectedCustomer.notes}
                </p>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-line)", paddingTop: "12px" }}>
              {selectedCustomer.phone && selectedCustomer.phone !== "—" && (
                <a
                  href={`https://wa.me/${selectedCustomer.phone.replace(/[^0-9]/g, "")}?text=Hola%20${encodeURIComponent(selectedCustomer.name)},%20te%20escribimos%20desde%20NicTech.`}
                  target="_blank"
                  rel="noreferrer"
                  className="pag-btn"
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--brand-primary)", textDecoration: "none" }}
                >
                  <Phone size={14} /> WhatsApp
                </a>
              )}
              <button
                type="button"
                className="pag-btn"
                style={{ color: "var(--rose-accent)", marginLeft: "auto" }}
                onClick={() => setCustomerToDelete(selectedCustomer.id)}
              >
                <Trash2 size={14} /> Eliminar Cliente
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: New Customer */}
      <Modal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        title="Registrar Nuevo Cliente"
        subtitle="Agrega un cliente particular o corporativo al padrón del ERP"
        icon={Plus}
        maxWidth="520px"
      >
        <form onSubmit={handleCreateCustomer} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="erp-form-group">
            <label className="erp-form-label">Nombre Completo o Razón Social *</label>
            <input
              type="text"
              required
              placeholder="Ej: Florencia Álvarez o Tech Solutions SRL"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="erp-form-input"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Tipo Doc.</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as "DNI" | "CUIT")}
                className="erp-form-select"
              >
                <option value="DNI">DNI</option>
                <option value="CUIT">CUIT</option>
              </select>
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Número de Documento</label>
              <input
                type="text"
                placeholder="Ej: 38920194 o 30-71829104-8"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Email</label>
              <input
                type="email"
                placeholder="cliente@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="erp-form-input"
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Teléfono / WhatsApp</label>
              <input
                type="text"
                placeholder="+54 9 11 4829-1029"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Localidad / Ciudad</label>
              <input
                type="text"
                placeholder="Ej: Belgrano, CABA"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="erp-form-input"
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Crédito Inicial ($ ARS)</label>
              <input
                type="number"
                value={creditBalance}
                onChange={(e) => setCreditBalance(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Observaciones / Notas</label>
            <textarea
              rows={2}
              placeholder="Detalles sobre preferencias, cuenta corriente..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="erp-form-textarea"
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsNewModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary">
              Guardar Cliente
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(customerToDelete)}
        title="Eliminar Cliente"
        message="¿Estás seguro de que deseás eliminar este cliente del padrón del ERP?"
        confirmLabel="Eliminar Cliente"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={confirmDeleteCustomer}
        onCancel={() => setCustomerToDelete(null)}
      />
    </div>
  );
};
