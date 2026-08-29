export type PermissionEffect = "allow" | "deny";

export interface PermissionGrant {
  code: string;
  effect: PermissionEffect;
  branchId?: string;
}

export interface PermissionContext {
  rolePermissions: ReadonlySet<string>;
  overrides: readonly PermissionGrant[];
  branchId?: string;
}

const appliesToBranch = (grant: PermissionGrant, branchId?: string) =>
  grant.branchId === undefined || grant.branchId === branchId;

export const hasPermission = (
  context: PermissionContext,
  permissionCode: string,
): boolean => {
  const matchingOverrides = context.overrides.filter(
    (grant) =>
      grant.code === permissionCode &&
      appliesToBranch(grant, context.branchId),
  );

  if (matchingOverrides.some((grant) => grant.effect === "deny")) {
    return false;
  }

  if (matchingOverrides.some((grant) => grant.effect === "allow")) {
    return true;
  }

  return context.rolePermissions.has(permissionCode);
};
