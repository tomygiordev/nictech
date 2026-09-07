import { useState, useEffect } from "react";
import {
  Settings,
  Users,
  Building2,
  Shield,
  Key,
  Database,
  Globe,
  Bell,
  Save,
  Plus,
  Trash2,
} from "lucide-react";
import {
  WorkspaceHeader,
  WorkspaceModuleTabs,
  Modal,
  ConfirmDialog,
  FeedbackAlert,
} from "../../components/erp/WorkspaceUi";
import { formatDateTime } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";
import { type ErpModuleId } from "@nictech/domain";

export interface SystemWorkspaceProps {
  activeModuleId?: "users" | "locations" | "settings";
  onSelectModule?: (id: ErpModuleId) => void;
}

interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: string;
  branch: string;
  status: "active" | "inactive";
}

interface BranchItem {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  is_active: boolean;
}

export const SystemWorkspace: React.FC<SystemWorkspaceProps> = ({
  activeModuleId = "users",
  onSelectModule,
}) => {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form states for new user
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState("Vendedor / POS");
  const [userBranch, setUserBranch] = useState("Sucursal Central");

  // Settings states
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState("30");
  const [autoEmailReceipts, setAutoEmailReceipts] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const { data: profData } = await supabase
          .from("profiles")
          .select("id, display_name, employee_code, phone, is_active, created_at");

        const mapped: UserAccount[] = (profData || []).map((p) => ({
          id: p.id,
          name: p.display_name,
          email: p.phone || "usuario@nictech.com.ar",
          role: p.employee_code || "Operador",
          branch: "Sucursal Central",
          status: p.is_active ? "active" : "inactive",
        }));
        setUsers(mapped);

        const { data: bData } = await supabase
          .from("branches")
          .select("id, code, name, phone, is_active");
        setBranches((bData || []) as BranchItem[]);
      } catch (e) {
        console.warn("Aviso al consultar profiles/branches:", e);
      } finally {
        setLoading(false);
      }
    };
    void fetchData();
  }, []);

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback("El alta de nuevos operadores con credenciales y RBAC se administra a nivel de Supabase Auth en la FASE F.");
    setIsNewUserModalOpen(false);
    setUserName("");
    setUserEmail("");
  };

  const confirmDelete = () => {
    if (!userToDelete) return;
    setUsers(users.filter((u) => u.id !== userToDelete));
    setUserToDelete(null);
    setFeedback("Usuario desvinculado.");
  };

  const handleSaveSettings = () => {
    setFeedback("Las políticas de seguridad y caducidad de tokens se aplican directamente en Supabase Auth / Vault.");
  };

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title={
          activeModuleId === "locations"
            ? "Sucursales & Estructura Operativa"
            : activeModuleId === "settings"
            ? "Configuración General & Seguridad"
            : "Usuarios, Roles & Permisos (RBAC)"
        }
        description={
          activeModuleId === "locations"
            ? "Administración de locales comerciales, depósitos centrales y laboratorios técnicos."
            : activeModuleId === "settings"
            ? "Políticas de seguridad, autenticación en dos pasos, caducidad de tokens y parámetros del sistema."
            : "Control granular de accesos, roles de usuario y permisos por sucursal."
        }
        badge="Super Admin"
      />

      {feedback && (
        <FeedbackAlert
          type="success"
          message={feedback}
          onClose={() => setFeedback(null)}
        />
      )}

      {onSelectModule && (
        <WorkspaceModuleTabs
          moduleIds={["users", "locations", "settings"]}
          activeModuleId={activeModuleId}
          onSelectModule={onSelectModule}
        />
      )}

      {activeModuleId === "users" && (
        <div className="flow-card">
          <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
            <div>
              <h2 className="flow-card__title">Operadores y Usuarios del ERP</h2>
              <p className="flow-card__subtitle">Control de accesos y asignación de permisos por sucursal</p>
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setIsNewUserModalOpen(true)}
            >
              <Plus size={16} /> Nuevo Usuario
            </button>
          </div>

          <div className="flow-table-wrapper">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>Nombre y Apellido</th>
                  <th>Email / Contacto</th>
                  <th>Rol Asignado</th>
                  <th>Sucursal Asignada</th>
                  <th>Estado</th>
                  <th className="text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                      Cargando operadores del ERP...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                      No hay operadores registrados en la base de datos central.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id}>
                      <td><strong>{u.name}</strong></td>
                      <td><span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{u.email}</span></td>
                      <td><span className="type-badge green">{u.role}</span></td>
                      <td><span style={{ fontSize: "12px", fontWeight: 600 }}>{u.branch}</span></td>
                      <td><span className="flow-status-pill completed">Activo</span></td>
                      <td className="text-right">
                        <span style={{ fontSize: "11px", color: "var(--text-light)", fontWeight: 600 }}>Activo</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeModuleId === "locations" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "20px" }}>
          {branches.length === 0 ? (
            <div className="flow-card" style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
              No hay sucursales registradas en la base de datos central.
            </div>
          ) : (
            branches.map((b) => (
              <div key={b.id} className="flow-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div className="flow-kpi-card__icon-box green">
                    <Building2 size={20} />
                  </div>
                  <span className={`flow-status-pill ${b.is_active ? "completed" : "pending"}`}>
                    {b.is_active ? "Activa" : "Inactiva"}
                  </span>
                </div>
                <strong style={{ fontSize: "18px" }}>{b.name}</strong>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "4px 0 16px" }}>
                  Código: {b.code} {b.phone ? `• Tel: ${b.phone}` : ""}
                </p>
                <div style={{ padding: "12px", background: "var(--canvas-bg)", borderRadius: "10px", fontSize: "12px", color: "var(--text-muted)" }}>
                  Sucursal habilitada para transacciones y control de inventario.
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeModuleId === "settings" && (
        <div className="flow-card" style={{ maxWidth: "650px" }}>
          <h2 className="flow-card__title">Políticas de Seguridad & Operación</h2>
          <p className="flow-card__subtitle">Configuración de sesión, caducidad de tokens y parámetros del sistema</p>

          <div style={{ marginTop: "18px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px", background: "var(--canvas-bg)", borderRadius: "10px" }}>
              <div>
                <strong>Autenticación en Dos Pasos (2FA)</strong>
                <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>Obligatorio para roles de Administración y Finanzas</span>
              </div>
              <button
                type="button"
                className={`flow-select-pill ${twoFactorEnabled ? "active" : ""}`}
                onClick={() => setTwoFactorEnabled(!twoFactorEnabled)}
              >
                {twoFactorEnabled ? "✓ Habilitado" : "Deshabilitado"}
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px", background: "var(--canvas-bg)", borderRadius: "10px" }}>
              <div>
                <strong>Cierre Automático de Sesión por Inactividad</strong>
                <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>Tiempo máximo de inactividad antes de requerir reingreso</span>
              </div>
              <select
                value={sessionTimeout}
                onChange={(e) => setSessionTimeout(e.target.value)}
                className="erp-form-select"
                style={{ width: "160px", padding: "6px 12px" }}
              >
                <option value="15">15 Minutos</option>
                <option value="30">30 Minutos</option>
                <option value="60">60 Minutos</option>
                <option value="120">2 Horas</option>
              </select>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px", background: "var(--canvas-bg)", borderRadius: "10px" }}>
              <div>
                <strong>Envío Automático de Comprobantes por Email</strong>
                <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>Enviar copia PDF al email del cliente al emitir factura fiscal</span>
              </div>
              <button
                type="button"
                className={`flow-select-pill ${autoEmailReceipts ? "active" : ""}`}
                onClick={() => setAutoEmailReceipts(!autoEmailReceipts)}
              >
                {autoEmailReceipts ? "✓ Activado" : "Desactivado"}
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
              <button type="button" className="btn-primary" onClick={handleSaveSettings}>
                <Save size={15} /> Guardar Preferencias
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Nuevo Usuario */}
      <Modal
        isOpen={isNewUserModalOpen}
        onClose={() => setIsNewUserModalOpen(false)}
        title="Registrar Nuevo Operador ERP"
        subtitle="Creación de usuario con acceso RBAC y asignación de sucursal"
        icon={Users}
        maxWidth="480px"
      >
        <form onSubmit={handleCreateUser} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="erp-form-group">
            <label className="erp-form-label">Nombre Completo *</label>
            <input
              type="text"
              required
              placeholder="Ej: Marcelo Gallardo"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="erp-form-input"
            />
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Email Institucional *</label>
            <input
              type="email"
              required
              placeholder="operador@nictech.com.ar"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              className="erp-form-input"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Rol Asignado</label>
              <select
                value={userRole}
                onChange={(e) => setUserRole(e.target.value)}
                className="erp-form-select"
              >
                <option value="Vendedor / POS">Vendedor / POS</option>
                <option value="Técnico Laboratorio">Técnico Laboratorio</option>
                <option value="Encargado de Stock">Encargado de Stock</option>
                <option value="Administrador">Administrador</option>
              </select>
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Sucursal</label>
              <select
                value={userBranch}
                onChange={(e) => setUserBranch(e.target.value)}
                className="erp-form-select"
              >
                <option value="Sucursal Central">Sucursal Central</option>
                <option value="Depósito Central">Depósito Central</option>
                <option value="Todas">Todas</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsNewUserModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary">
              Crear Operador
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(userToDelete)}
        title="Dar de baja usuario"
        message="¿Estás seguro de que deseás dar de baja este usuario del sistema?"
        confirmLabel="Dar de Baja"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setUserToDelete(null)}
      />
    </div>
  );
};
