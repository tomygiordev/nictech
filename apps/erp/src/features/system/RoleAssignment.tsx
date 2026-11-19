import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { roleAssignmentSchema, type RoleAssignmentValues } from "./roleAssignmentSchema";
import { useErpAuth } from "../../auth/ErpAuthContext";
import {
  assignProfileRole,
  isActiveAssignment,
  isAdministrationRole,
  listRoleAssignmentAccess,
  listRolesAndAssignments,
  roleAssignmentsQueryKey,
  roleDisplayName,
  type SystemUser,
} from "./api";

export const RoleAssignment = ({ users }: { users: SystemUser[] }) => {
  const { session, organizationId, hasPermission } = useErpAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const profileId = session?.user.id;
  const assignmentsKey = roleAssignmentsQueryKey(organizationId, profileId);
  const roleQuery = useQuery({
    queryKey: assignmentsKey,
    queryFn: listRolesAndAssignments,
    enabled: Boolean(profileId),
  });
  const { roles = [], assignments = [] } = roleQuery.data ?? {};

  const form = useForm<RoleAssignmentValues>({
    resolver: zodResolver(roleAssignmentSchema),
    defaultValues: {
      profileId: "",
      roleId: "",
    },
  });

  const now = Date.now();
  const activeAssignments = assignments.filter((assignment) =>
    isActiveAssignment(assignment, now),
  );
  const adminRoleIds = new Set(roles.filter(isAdministrationRole).map((role) => role.id));
  const actorAdminAssignments = activeAssignments.filter(
    (assignment) => assignment.profile_id === profileId && assignment.branch_id === null &&
      adminRoleIds.has(assignment.role_id),
  );
  const actorIsOwner = actorAdminAssignments.some((assignment) =>
    roles.some((role) => role.id === assignment.role_id && role.code === "owner"),
  );
  const canCheckAccess = hasPermission("users.manage") && actorAdminAssignments.length > 0 && !roleQuery.isError;
  const accessQuery = useQuery({
    queryKey: [...assignmentsKey, "access", actorIsOwner, roles.map((role) => role.id)],
    queryFn: () => listRoleAssignmentAccess(roles, actorIsOwner),
    enabled: canCheckAccess,
  });
  const access = accessQuery.data;
  const disabledReason = !hasPermission("users.manage")
    ? "No tenés permiso para administrar usuarios."
    : actorAdminAssignments.length === 0
      ? "Para asignar roles necesitás un rol global de responsable o administrador."
      : accessQuery.isError
        ? "No se pudieron verificar tus permisos."
        : accessQuery.isPending
          ? "Estamos verificando tus permisos."
          : !access?.canManage
            ? "Necesitás permiso para administrar usuarios en todas las sucursales."
            : undefined;

  const rolesOf = (profileId: string): string[] =>
    activeAssignments
      .filter((assignment) => assignment.profile_id === profileId)
      .map((assignment) => {
        const role = roles.find((item) => item.id === assignment.role_id);
        return role ? roleDisplayName(role) : "Rol no disponible";
      });

  const isUnassignedActive = (user: SystemUser): boolean =>
    user.is_active && rolesOf(user.id).length === 0;

  const sortedUsers = [...users].sort((left, right) => {
    const leftPending = isUnassignedActive(left);
    const rightPending = isUnassignedActive(right);
    if (leftPending === rightPending) return 0;
    return leftPending ? -1 : 1;
  });

  const assignableUsers = sortedUsers.filter(
    (user) => user.id !== profileId && user.is_active,
  );
  const userRestriction = (id: string): string | undefined => {
    const scheduled = assignments.some((assignment) => assignment.profile_id === id &&
      Date.parse(assignment.valid_from) > now &&
      (assignment.valid_until === null || Date.parse(assignment.valid_until) > now));
    if (scheduled) return "El operador tiene un cambio de rol programado.";
    if (!actorIsOwner && activeAssignments.some((assignment) =>
      assignment.profile_id === id && adminRoleIds.has(assignment.role_id))) {
      return "Solo el responsable del sistema puede cambiar este rol.";
    }
  };
  const roleRestriction = (id: string): string | undefined =>
    access?.allowedRoleIds.includes(id) ? undefined : "No tenés permiso para asignar este rol.";
  const selectedProfileId = form.watch("profileId");
  const selectedRoleId = form.watch("roleId");
  const submitDisabledReason = disabledReason ??
    (selectedProfileId ? userRestriction(selectedProfileId) : undefined) ??
    (selectedRoleId ? roleRestriction(selectedRoleId) : undefined);

  const submit = form.handleSubmit(async (values) => {
    if (disabledReason || roleRestriction(values.roleId) || userRestriction(values.profileId) ||
      !assignableUsers.some((user) => user.id === values.profileId)) return;
    try {
      await assignProfileRole(values.profileId, values.roleId);
      await queryClient.invalidateQueries({ queryKey: assignmentsKey });
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

  if (profileId && roleQuery.isPending) {
    return <p>Cargando roles…</p>;
  }
  if (roleQuery.isError) {
    return <p role="alert">No se pudieron leer los roles.</p>;
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
          fontSize: "13.5px",
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
              <strong style={{ fontWeight: 650 }}>{user.display_name}:{" "}</strong>
              {pendingRole ? (
                <span className="status-pill status-pill--amber">
                  Sin rol — pendiente de asignación
                </span>
              ) : (
                <span className="status-pill status-pill--navy">{userRoles.join(", ") || "Sin rol"}</span>
              )}
            </li>
          );
        })}
      </ul>

        <form onSubmit={(event) => void submit(event)}>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: "0 0 12px" }}>
            El cambio reemplaza las asignaciones vigentes por un rol global. No podés cambiar tu propio rol.
          </p>
          {disabledReason && <p id="role-assignment-restriction" style={{ fontSize: "13px", color: "var(--text-muted)", margin: "0 0 12px" }}>{disabledReason}</p>}

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
                disabled={Boolean(disabledReason)}
                title={disabledReason}
                aria-describedby={disabledReason ? "role-assignment-restriction" : undefined}
                {...form.register("profileId")}
              >
                <option value="">Seleccioná un operador</option>
                {assignableUsers.map((user) => (
                  <option
                    key={user.id}
                    value={user.id}
                    disabled={Boolean(userRestriction(user.id))}
                    title={userRestriction(user.id)}
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
                disabled={Boolean(disabledReason)}
                title={disabledReason}
                aria-describedby={disabledReason ? "role-assignment-restriction" : undefined}
                {...form.register("roleId")}
              >
                <option value="">Seleccioná un rol</option>
                {roles.map((role) => (
                  <option
                    key={role.id}
                    value={role.id}
                    disabled={Boolean(roleRestriction(role.id))}
                    title={roleRestriction(role.id)}
                  >
                    {roleDisplayName(role)}
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
            disabled={Boolean(submitDisabledReason) || form.formState.isSubmitting}
            title={submitDisabledReason}
            aria-describedby={disabledReason ? "role-assignment-restriction" : undefined}
          >
            Asignar rol
          </button>
        </form>

      {message && <p role="status">{message}</p>}
    </section>
  );
};
