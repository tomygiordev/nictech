import { useState, useEffect } from "react";
import { Building2, Save } from "lucide-react";
import {
  WorkspaceHeader,
  WorkspaceModuleTabs,
  StatePanel,
  FeedbackAlert,
} from "../../components/erp/WorkspaceUi";
import {
  listBranches,
  listSystemUsers,
  listSystemSettings,
  guardarAjuste,
  SYSTEM_SETTING_KEYS,
  type SystemBranch,
  type SystemUser,
} from "./api";
import { type ErpModuleId } from "@nictech/domain";

export interface SystemWorkspaceProps {
  activeModuleId?: "users" | "locations" | "settings";
  onSelectModule?: (id: ErpModuleId) => void;
}

const esRegistro = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null;

export const SystemWorkspace: React.FC<SystemWorkspaceProps> = ({
  activeModuleId = "users",
  onSelectModule,
}) => {
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [branches, setBranches] = useState<SystemBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Ajustes persistidos en erp.system_settings (alcance global).
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState("30");
  const [autoEmailReceipts, setAutoEmailReceipts] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const [perfiles, sucursales] = await Promise.all([listSystemUsers(), listBranches()]);
        setUsers(perfiles);
        setBranches(sucursales);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "No se pudieron leer los datos del sistema.");
      } finally {
        setLoading(false);
      }
    };
    void fetchData();
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setSettingsLoading(true);
        setSettingsError(null);
        const ajustes = await listSystemSettings();
        const globales = ajustes.filter((a) => a.branch_id === null);
        for (const a of globales) {
          if (a.key === SYSTEM_SETTING_KEYS.twoFactor && esRegistro(a.value) && typeof a.value.habilitado === "boolean") {
            setTwoFactorEnabled(a.value.habilitado);
          }
          if (a.key === SYSTEM_SETTING_KEYS.sessionTimeout && esRegistro(a.value) && typeof a.value.minutos === "number") {
            setSessionTimeout(String(a.value.minutos));
          }
          if (a.key === SYSTEM_SETTING_KEYS.autoEmailReceipts && esRegistro(a.value) && typeof a.value.activado === "boolean") {
            setAutoEmailReceipts(a.value.activado);
          }
        }
      } catch (e) {
        setSettingsError(e instanceof Error ? e.message : "No se pudieron leer los ajustes del sistema.");
      } finally {
        setSettingsLoading(false);
      }
    };
    void fetchSettings();
  }, []);

  const handleSaveSettings = async () => {
    try {
      setSaving(true);
      setSaveError(null);
      setFeedback(null);
      await guardarAjuste(SYSTEM_SETTING_KEYS.twoFactor, { habilitado: twoFactorEnabled });
      await guardarAjuste(SYSTEM_SETTING_KEYS.sessionTimeout, { minutos: Number(sessionTimeout) });
      await guardarAjuste(SYSTEM_SETTING_KEYS.autoEmailReceipts, { activado: autoEmailReceipts });
      setFeedback("Ajustes del sistema guardados en erp.system_settings.");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "No se pudieron guardar los ajustes.");
    } finally {
      setSaving(false);
    }
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
            ? "Políticas de seguridad, autenticación en dos pasos, caducidad de sesión y parámetros del sistema."
            : "Operadores leídos de erp.profiles con su sucursal real por asignación."
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
              <p className="flow-card__subtitle">Lectura real de erp.profiles con sucursal por asignación</p>
            </div>
          </div>

          <StatePanel
            type="info"
            title="Alta de usuarios no disponible en el ERP"
            message="Sin backend de alta de usuarios Auth: el alta de operadores se realiza en Supabase Auth y no se simula desde el ERP."
          />

          {loading ? (
            <StatePanel type="loading" message="Cargando operadores desde erp.profiles..." />
          ) : loadError ? (
            <StatePanel type="error" title="No se pudieron leer los operadores" message={loadError} />
          ) : users.length === 0 ? (
            <StatePanel
              type="empty"
              title="Sin operadores"
              message="No hay operadores registrados en la base de datos central."
            />
          ) : (
            <div className="flow-table-wrapper">
              <table className="flow-table">
                <thead>
                  <tr>
                    <th>Nombre y Apellido</th>
                    <th>Legajo</th>
                    <th>Teléfono</th>
                    <th>Sucursal Asignada</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td><strong>{u.display_name}</strong></td>
                      <td><span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{u.employee_code ?? "—"}</span></td>
                      <td><span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{u.phone ?? "—"}</span></td>
                      <td><span style={{ fontSize: "12px", fontWeight: 600 }}>{u.branch_name ?? "Sin sucursal"}</span></td>
                      <td>
                        <span className={`flow-status-pill ${u.is_active ? "completed" : "pending"}`}>
                          {u.is_active ? "Activo" : "Inactivo"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeModuleId === "locations" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "20px" }}>
          {loading ? (
            <StatePanel type="loading" message="Cargando sucursales desde erp.branches..." />
          ) : loadError ? (
            <StatePanel type="error" title="No se pudieron leer las sucursales" message={loadError} />
          ) : branches.length === 0 ? (
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
          <p className="flow-card__subtitle">Ajustes persistidos en erp.system_settings (alcance global)</p>

          {settingsLoading ? (
            <StatePanel type="loading" message="Cargando ajustes desde erp.system_settings..." />
          ) : settingsError ? (
            <StatePanel type="error" title="No se pudieron leer los ajustes" message={settingsError} />
          ) : (
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

              {saveError && (
                <StatePanel type="error" title="No se pudieron guardar los ajustes" message={saveError} />
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
                <button type="button" className="btn-primary" onClick={() => void handleSaveSettings()} disabled={saving}>
                  <Save size={15} /> {saving ? "Guardando..." : "Guardar Preferencias"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
