import { useState, useEffect, useMemo, useCallback } from "react";
import { z } from "zod";
import {
  Users,
  Search,
  Eye,
  Plus,
  Phone,
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
  kind: "person" | "business";
  internalCode: string;
  email: string;
  phone: string;
  totalSpentArs: number;
  ordersCount: number;
  activeRepairs: number;
  repairsList?: Array<{
    id: string;
    order_code: string;
    brand: string;
    model: string;
    status: string;
    status_is_terminal: boolean;
  }>;
}

type CustomerPrivateDetails = {
  identity_document: string | null;
  tax_id: string | null;
  internal_notes: string | null;
};

type CustomerFeedback = {
  type: "success" | "error" | "info";
  message: string;
};

const customerFormSchema = z
  .object({
    name: z.string().trim().min(2, "Ingresá el nombre o razón social.").max(200),
    docType: z.enum(["DNI", "CUIT"]),
    docNumber: z.string().trim().max(30),
    email: z.union([z.literal(""), z.string().trim().email("Ingresá un email válido.")]),
    phone: z.string().trim().max(50),
    notes: z.string().trim().max(2000),
  })
  .superRefine((value, context) => {
    if (!value.docNumber) return;
    const digits = value.docNumber.replace(/\D/g, "");
    const valid = value.docType === "CUIT" ? digits.length === 11 : digits.length >= 7 && digits.length <= 8;
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["docNumber"],
        message: value.docType === "CUIT" ? "El CUIT debe tener 11 dígitos." : "El DNI debe tener 7 u 8 dígitos.",
      });
    }
  });

const createCustomerWithPrivateDetails = async (input: {
  kind: "person" | "business";
  displayName: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  identityDocument: string | null;
  internalNotes: string | null;
}): Promise<string> => {
  const { data, error } = await supabase.rpc("create_customer_with_private_details", {
    new_kind: input.kind,
    new_display_name: input.displayName,
    new_legal_name: input.kind === "business" ? input.displayName : undefined,
    new_email: input.email ?? undefined,
    new_phone: input.phone ?? undefined,
    new_tax_id: input.taxId ?? undefined,
    new_identity_document: input.identityDocument ?? undefined,
    new_address: {},
    new_internal_notes: input.internalNotes ?? undefined,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("La base no devolvió el identificador del cliente creado.");
  return data;
};

export const CustomersWorkspace = () => {
  const { organizationId, hasPermission } = useErpAuth();
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState<string>("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);
  const [customerToDeactivate, setCustomerToDeactivate] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<CustomerFeedback | null>(null);
  const [privateDetails, setPrivateDetails] = useState<CustomerPrivateDetails | null>(null);
  const [loadingPrivateDetails, setLoadingPrivateDetails] = useState(false);
  const [privateDetailsError, setPrivateDetailsError] = useState<string | null>(null);

  // Form states for new customer
  const [name, setName] = useState("");
  const [docType, setDocType] = useState<"DNI" | "CUIT">("DNI");
  const [docNumber, setDocNumber] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const fetchCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [customersRes, repairsRes, salesRes] = await Promise.all([
        supabase
          .from("customers")
          .select("id, code, kind, display_name, email, phone, whatsapp_phone, is_active, created_at")
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
        supabase
          .from("repair_orders_overview")
          .select("id, customer_id, order_code, brand_snapshot, model_snapshot, status_name, status_is_terminal, opened_at"),
        supabase
          .from("sales")
          .select("id, customer_id, total_amount"),
      ]);

      if (customersRes.error) throw customersRes.error;
      if (repairsRes.error) throw repairsRes.error;
      if (salesRes.error) throw salesRes.error;

      const repairsByCustomer = new Map<string, Array<{ id: string; order_code: string; brand: string; model: string; status: string; status_is_terminal: boolean }>>();
      (repairsRes.data || []).forEach((r) => {
        if (!r.customer_id || !r.id) return;
        const list = repairsByCustomer.get(r.customer_id) || [];
        list.push({
          id: r.id,
          order_code: r.order_code || "—",
          brand: r.brand_snapshot || "",
          model: r.model_snapshot || "",
          status: r.status_name || "En taller",
          status_is_terminal: Boolean(r.status_is_terminal),
        });
        repairsByCustomer.set(r.customer_id, list);
      });

      const salesByCustomer = new Map<string, { count: number; totalArs: number }>();
      (salesRes.data || []).forEach((s) => {
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
          kind: c.kind,
          internalCode: c.code,
          email: c.email || "—",
          phone: c.phone || c.whatsapp_phone || "—",
          totalSpentArs: cSales.totalArs,
          ordersCount: cSales.count,
          activeRepairs: activeRepairsCount,
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
    if (!organizationId) {
      setFeedback({ type: "error", message: "La sesión no tiene una organización activa. Volvé a iniciar sesión." });
      return;
    }

    const parsed = customerFormSchema.safeParse({ name, docType, docNumber, email, phone, notes });
    if (!parsed.success) {
      setFeedback({ type: "error", message: parsed.error.issues[0]?.message ?? "Revisá los datos del cliente." });
      return;
    }

    if ((parsed.data.docNumber || parsed.data.notes) && !hasPermission("customers.view_sensitive")) {
      setFeedback({ type: "error", message: "Tu rol no permite guardar documentos ni notas privadas." });
      return;
    }

    try {
      const normalizedDocument = parsed.data.docNumber.replace(/\D/g, "") || null;
      await createCustomerWithPrivateDetails({
        kind: parsed.data.docType === "CUIT" ? "business" : "person",
        displayName: parsed.data.name,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        taxId: parsed.data.docType === "CUIT" ? normalizedDocument : null,
        identityDocument: parsed.data.docType === "DNI" ? normalizedDocument : null,
        internalNotes: parsed.data.notes || null,
      });

      setFeedback({ type: "success", message: `¡Cliente "${parsed.data.name}" registrado correctamente!` });
      setIsNewModalOpen(false);
      setName("");
      setDocNumber("");
      setEmail("");
      setPhone("");
      setNotes("");
      await fetchCustomers();
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "Error al registrar cliente" });
    }
  };

  const openCustomerDetails = useCallback(async (customer: CustomerRecord) => {
    setSelectedCustomer(customer);
    setPrivateDetails(null);
    setPrivateDetailsError(null);
    if (!hasPermission("customers.view_sensitive")) return;

    try {
      setLoadingPrivateDetails(true);
      const { data, error: detailsError } = await supabase.rpc("get_customer_private_details", {
        target_customer_id: customer.id,
      });
      if (detailsError) throw detailsError;
      const details = data?.[0];
      setPrivateDetails(details ? {
        identity_document: details.identity_document,
        tax_id: details.tax_id,
        internal_notes: details.internal_notes,
      } : null);
    } catch (detailsError) {
      setPrivateDetailsError(detailsError instanceof Error ? detailsError.message : "No se pudieron cargar los datos privados.");
    } finally {
      setLoadingPrivateDetails(false);
    }
  }, [hasPermission]);

  const confirmDeactivateCustomer = async () => {
    if (!customerToDeactivate) return;
    try {
      const { error: delErr } = await supabase
        .from("customers")
        .update({ is_active: false })
        .eq("id", customerToDeactivate);
      if (delErr) throw delErr;
      if (selectedCustomer?.id === customerToDeactivate) setSelectedCustomer(null);
      setCustomerToDeactivate(null);
      setFeedback({ type: "success", message: "Cliente dado de baja del padrón." });
      await fetchCustomers();
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "Error al dar de baja cliente" });
    }
  };


  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.internalCode.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.includes(q)
      );
    });
  }, [customers, search]);

  const totalRevenue = useMemo(() => {
    return customers.reduce((acc, c) => acc + c.totalSpentArs, 0);
  }, [customers]);

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Gestión de Clientes & CRM"
        description="Ficha unificada de clientes, historial de compras y reparaciones activas en taller."
        badge={`${customers.length} Clientes Registrados`}
      />

      {feedback && (
        <FeedbackAlert
          type={feedback.type}
          message={feedback.message}
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
            <p className="flow-card__subtitle">Búsqueda por nombre, código interno, email o teléfono</p>
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
              disabled={!hasPermission("customers.manage")}
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
                <th>Código interno</th>
                <th>Nombre / Razón Social</th>
                <th>Contacto</th>
                <th>Compras</th>
                <th>Taller</th>
                <th className="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "36px", color: "var(--text-muted)" }}>
                    {loading ? "Cargando clientes desde la base de datos…" : error ? `Error: ${error}` : "No hay clientes registrados en el sistema."}
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((c) => (
                <tr
                  key={c.id}
                  className="interactive-row"
                  role="button"
                  tabIndex={0}
                  aria-label={`Abrir ficha de ${c.name}`}
                  onClick={() => void openCustomerDetails(c)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void openCustomerDetails(c);
                    }
                  }}
                >
                  <td>
                    <span className="type-badge blue" style={{ fontFamily: "monospace" }}>
                      {c.internalCode}
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
                    <span className="type-badge green">{c.ordersCount} pedidos</span>
                  </td>
                  <td>
                    {c.activeRepairs > 0 ? (
                      <span className="flow-status-pill processing">{c.activeRepairs} en taller</span>
                    ) : (
                      <span style={{ fontSize: "12px", color: "var(--text-light)" }}>—</span>
                    )}
                  </td>
                  <td className="text-right">
    <div style={{ display: "inline-flex", gap: "6px" }}>
      <button
        type="button"
        className="pag-btn"
        style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--brand-primary)", borderColor: "var(--brand-border)" }}
        onClick={(e) => {
          e.stopPropagation();
          void openCustomerDetails(c);
        }}
        title="Ver Ficha / Historial"
      >
        <Eye size={12} /> Ficha
      </button>
      {hasPermission("customers.manage") && (
        <button
          type="button"
          className="pag-btn"
          style={{ color: "var(--rose-accent)", padding: "4px 8px" }}
          onClick={(e) => {
            e.stopPropagation();
            setCustomerToDeactivate(c.id);
          }}
          aria-label={`Dar de baja a ${c.name}`}
          title={`Dar de baja a ${c.name}. El cliente quedará inactivo y conservará su historial.`}
        >
          <Trash2 size={13} />
        </button>
      )}
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
          subtitle={`Código interno: ${selectedCustomer.internalCode}`}
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
                <span className="stat-label">Facturado Histórico</span>
                <strong style={{ display: "block", fontSize: "14px", marginTop: "2px", color: "var(--brand-primary)" }}>
                  {formatCurrency(selectedCustomer.totalSpentArs, "ARS")}
                </strong>
              </div>
            </div>

            {hasPermission("customers.view_sensitive") ? (
              <div style={{ padding: "12px", background: "var(--surface-subtle)", borderRadius: "10px" }}>
                <span className="stat-label">Datos privados (acceso auditado)</span>
                {loadingPrivateDetails ? (
                  <p style={{ margin: "6px 0 0", fontSize: "13px" }}>Cargando datos privados…</p>
                ) : privateDetailsError ? (
                  <p style={{ margin: "6px 0 0", fontSize: "13px", color: "var(--rose-accent)" }}>{privateDetailsError}</p>
                ) : (
                  <div style={{ display: "grid", gap: "6px", marginTop: "8px", fontSize: "13px" }}>
                    <span>
                      {selectedCustomer.kind === "business" ? "CUIT" : "DNI"}: {selectedCustomer.kind === "business"
                        ? privateDetails?.tax_id || "No registrado"
                        : privateDetails?.identity_document || "No registrado"}
                    </span>
                    {privateDetails?.internal_notes && <span>Notas: {privateDetails.internal_notes}</span>}
                  </div>
                )}
              </div>
            ) : (
              <FeedbackAlert type="info" message="Los documentos y notas privadas requieren el permiso customers.view_sensitive." />
            )}

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
              {hasPermission("customers.manage") && (
                <button
                  type="button"
                  className="pag-btn"
                  style={{ color: "var(--rose-accent)", marginLeft: "auto" }}
                  onClick={() => setCustomerToDeactivate(selectedCustomer.id)}
                >
                  <Trash2 size={14} /> Dar de baja
                </button>
              )}
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

          {hasPermission("customers.view_sensitive") && <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px" }}>
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
          </div>}

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

          {hasPermission("customers.view_sensitive") && <div className="erp-form-group">
            <label className="erp-form-label">Observaciones / Notas</label>
            <textarea
              rows={2}
              placeholder="Detalles sobre preferencias, cuenta corriente..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="erp-form-textarea"
            />
          </div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsNewModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary">
              Guardar Cliente
            </button>
          </div>
        </form>
      </Modal>

      {/* Deactivate Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(customerToDeactivate)}
        title="Dar de baja al cliente"
        message="El cliente quedará inactivo y dejará de aparecer en el padrón activo. Se conserva su historial de compras y reparaciones."
        confirmLabel="Dar de baja"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={confirmDeactivateCustomer}
        onCancel={() => setCustomerToDeactivate(null)}
      />
    </div>
  );
};
