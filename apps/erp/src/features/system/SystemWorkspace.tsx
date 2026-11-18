import { RoleAssignment } from "./RoleAssignment";
import { NavigationSettings } from "./NavigationSettings";
import { UpdatesCard } from "./UpdatesCard";
import { useState, useEffect } from "react";
import { Building2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useErpAuth } from "../../auth/ErpAuthContext";
import {
  WorkspaceHeader,
  WorkspaceModuleTabs,
  StatePanel,
} from "../../components/erp/WorkspaceUi";
import {
  listBranches,
  listSystemUsers,
  isActiveAssignment,
  listRolesAndAssignments,
  roleAssignmentsQueryKey,
  roleDisplayName,
  type SystemBranch,
  type SystemUser,
} from "./api";
import { type ErpModuleId } from "@nictech/domain";

export interface SystemWorkspaceProps {
  activeModuleId?: "users" | "locations" | "settings";
  onSelectModule?: (id: ErpModuleId) => void;
}

export const SystemWorkspace: React.FC<SystemWorkspaceProps> = ({
  activeModuleId = "users",
  onSelectModule,
}) => {
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [branches, setBranches] = useState<SystemBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  const { session, organizationId } = useErpAuth();
  const profileId = session?.user.id;
  const rolesQuery = useQuery({
    queryKey: roleAssignmentsQueryKey(organizationId, profileId),
    queryFn: listRolesAndAssignments,
    enabled: Boolean(profileId),
  });

  const now = Date.now();
  const assignedRoleIds = new Set(
    rolesQuery.data?.assignments
      .filter((assignment) => assignment.profile_id === profileId && isActiveAssignment(assignment, now))
      .map((assignment) => assignment.role_id),
  );
  const roleNames = rolesQuery.data?.roles
    .filter((role) => assignedRoleIds.has(role.id))
    .map(roleDisplayName) ?? [];
  const roleBadge = rolesQuery.isError
    ? "Rol no disponible"
    : profileId && rolesQuery.isPending
      ? undefined
      : [...new Set(roleNames)].join(", ") || (assignedRoleIds.size ? "Rol no disponible" : "Sin rol asignado");

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title={
          activeModuleId === "locations"
            ? "Sucursales y ubicaciones"
            : activeModuleId === "settings"
            ? "Configuración general"
            : "Usuarios y permisos"
        }
        description={
          activeModuleId === "locations"
            ? "Administración de locales comerciales, depósitos centrales y laboratorios técnicos."
            : activeModuleId === "settings"
            ? "Elegí qué módulos aparecen en el menú y consultá las actualizaciones del ERP."
            : "Consultá los operadores, sus sucursales y los roles que tienen asignados."
        }
        badge={roleBadge}
      />

      {onSelectModule && (
        <WorkspaceModuleTabs
          moduleIds={["users", "locations", "settings"]}
          activeModuleId={activeModuleId}
          onSelectModule={onSelectModule}
        />
      )}

      {activeModuleId === "users" && !loading && !loadError && <RoleAssignment users={users} />}
      {activeModuleId === "users" && (
        <div className="flow-card">
          <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
            <div>
              <h2 className="flow-card__title">Operadores del ERP</h2>
              <p className="flow-card__subtitle">Datos de contacto, sucursal asignada y estado de cada operador.</p>
            </div>
          </div>

          <StatePanel
            type="info"
            title="Alta de usuarios no disponible en el ERP"
            message="Pedile a quien administra el sistema que dé de alta al operador antes de asignarle un rol."
          />

          {loading ? (
            <StatePanel type="loading" message="Cargando operadores…" />
          ) : loadError ? (
            <StatePanel type="error" title="No se pudieron leer los operadores" message={loadError} />
          ) : users.length === 0 ? (
            <StatePanel
              type="empty"
              title="Sin operadores"
              message="Todavía no hay operadores registrados."
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
            <StatePanel type="loading" message="Cargando sucursales…" />
          ) : loadError ? (
            <StatePanel type="error" title="No se pudieron leer las sucursales" message={loadError} />
          ) : branches.length === 0 ? (
            <div className="flow-card" style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
              Todavía no hay sucursales registradas.
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

      {activeModuleId === "settings" && <UpdatesCard />}
      {activeModuleId === "settings" && <NavigationSettings />}
    </div>
  );
};
