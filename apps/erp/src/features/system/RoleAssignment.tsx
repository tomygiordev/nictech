import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { roleAssignmentSchema, type RoleAssignmentValues } from "./roleAssignmentSchema";
import { useErpAuth } from "../../auth/ErpAuthContext";
import {
  assignProfileRole,
  listRolesAndAssignments,
  type SystemRole,
  type SystemRoleAssignment,
  type SystemUser,
} from "./api";

const isActiveAssignment = (
  assignment: SystemRoleAssignment,
  referenceTime: number,
): boolean => {
  const validFrom = new Date(assignment.valid_from).getTime();
  if (validFrom > referenceTime) return false;
  if (!assignment.valid_until) return true;
  return new Date(assignment.valid_until).getTime() > referenceTime;
};

const isGlobalAdminAssignment = (
  assignment: SystemRoleAssignment,
  roles: SystemRole[],
  userId?: string,
): boolean => {
  if (!userId || assignment.profile_id !== userId) return false;
  if (assignment.branch_id !== null) return false;
  return roles.some(
    (role) =>
      role.id === assignment.role_id &&
      (role.code === "owner" || role.code === "admin"),
  );
};

export const RoleAssignment = ({ users }: { users: SystemUser[] }) => {
  const { session } = useErpAuth();
  const [roles, setRoles] = useState<SystemRole[]>([]);
  const [assignments, setAssignments] = useState<SystemRoleAssignment[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const form = useForm<RoleAssignmentValues>({
    resolver: zodResolver(roleAssignmentSchema),
    defaultValues: {
      profileId: "",
      roleId: "",
    },
  });

  const refresh = async () => {
    const result = await listRolesAndAssignments();
    setRoles(result.roles);
    setAssignments(result.assignments);
  };

  useEffect(() => {
    void refresh()
      .catch(() => setMessage("No se pudieron leer los roles."))
      .finally(() => setLoading(false));
  }, []);

  const now = Date.now();
  const activeAssignments = assignments.filter((assignment) =>
    isActiveAssignment(assignment, now),
  );

  const rolesOf = (profileId: string): string[] =>
    activeAssignments
      .filter((assignment) => assignment.profile_id === profileId)
      .map((assignment) => {
        const role = roles.find((item) => item.id === assignment.role_id);
        return role?.name ?? "Rol no disponible";
      });

  const isUnassignedActive = (user: SystemUser): boolean =>
    user.is_active && rolesOf(user.id).length === 0;

  const sortedUsers = [...users].sort((left, right) => {
    const leftPending = isUnassignedActive(left);
    const rightPending = isUnassignedActive(right);
    if (leftPending === rightPending) return 0;
    return leftPending ? -1 : 1;
  });

  const actorIsAdmin = activeAssignments.some((assignment) =>
    isGlobalAdminAssignment(assignment, roles, session?.user.id),
  );

  const assignableUsers = sortedUsers.filter(
    (user) => user.id !== session?.user.id && user.is_active,
  );

  const submit = form.handleSubmit(async (values) => {
    try {
      await assignProfileRole(values.profileId, values.roleId);
      await refresh();
      setMessage(
        "Rol actualizado. El operador debe volver a iniciar sesión para renovar sus permisos.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el rol.",
      );
    }
  });

  if (loading) {
    return <p>Cargando roles…</p>;
  }

  return (
    <section
      className="flow-card"
      aria-labelledby="assign-role-title"
    >
      <h2
        id="assign-role-title"
        className="flow-card__title"
      >
        Roles de operadores
      </h2>
      <p className="flow-card__subtitle">
        Los usuarios nuevos no tienen acceso hasta que les asignes un rol
      </p>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "12px 0 16px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {sortedUsers.map((user) => {
          const userRoles = rolesOf(user.id);
          const pendingRole = user.is_active && userRoles.length === 0;

          return (
            <li
              key={user.id}
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <span>{user.display_name}:{" "}</span>
              {pendingRole ? (
                <span className="status-pill status-pill--amber">
                  Sin rol — pendiente de asignación
                </span>
              ) : (
                <span>{userRoles.join(", ") || "Sin rol"}</span>
              )}
            </li>
          );
        })}
      </ul>

      {actorIsAdmin && (
        <form onSubmit={(event) => void submit(event)}>
          <p>
            El cambio reemplaza las asignaciones vigentes por un rol global. No podés cambiar tu propio rol.
          </p>

          <div className="erp-form-row">
            <div className="erp-form-group">
              <label
                htmlFor="role-profile"
                className="erp-form-label"
              >
                Operador
              </label>
              <select
                id="role-profile"
                className="erp-form-select"
                {...form.register("profileId")}
              >
                <option value="">Seleccioná un operador</option>
                {assignableUsers.map((user) => (
                  <option
                    key={user.id}
                    value={user.id}
                  >
                    {user.display_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="erp-form-group">
              <label
                htmlFor="role-choice"
                className="erp-form-label"
              >
                Rol
              </label>
              <select
                id="role-choice"
                className="erp-form-select"
                {...form.register("roleId")}
              >
                <option value="">Seleccioná un rol</option>
                {roles.map((role) => (
                  <option
                    key={role.id}
                    value={role.id}
                  >
                    {role.code ? `${role.name} (${role.code})` : role.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(form.formState.errors.profileId || form.formState.errors.roleId) && (
            <p role="alert">Seleccioná operador y rol.</p>
          )}

          <button
            className="btn-primary"
            type="submit"
            disabled={form.formState.isSubmitting}
          >
            Asignar rol
          </button>
        </form>
      )}

      {message && <p role="status">{message}</p>}
    </section>
  );
};
