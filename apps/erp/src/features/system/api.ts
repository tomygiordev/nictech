import { supabase } from "../../lib/supabase";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

export interface SystemBranch {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  is_active: boolean;
}

export interface SystemUser {
  id: string;
  display_name: string;
  employee_code: string | null;
  phone: string | null;
  is_active: boolean;
  branch_name: string | null;
}

export interface SystemSetting {
  key: string;
  branch_id: string | null;
  value: unknown;
  updated_at: string;
}

export const SYSTEM_SETTING_KEYS = {
  twoFactor: "security.two_factor",
  sessionTimeout: "security.session_timeout",
  autoEmailReceipts: "billing.auto_email_receipts",
} as const;

interface ProfileRow {
  id: string;
  display_name: string;
  employee_code: string | null;
  phone: string | null;
  is_active: boolean;
}

interface ProfileRoleRow {
  profile_id: string;
  branch_id: string | null;
}

const mensajeError = (accion: string, detalle: string): string => `${accion}: ${detalle}`;

export const listBranches = async (): Promise<SystemBranch[]> => {
  const { data, error } = await client()
    .from("branches")
    .select("id, code, name, phone, is_active")
    .order("name", { ascending: true });
  if (error) throw new Error(mensajeError("No se pudieron leer las sucursales", error.message));
  return ((data ?? []) as SystemBranch[]).map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    phone: b.phone ?? null,
    is_active: b.is_active,
  }));
};

export const listSystemUsers = async (): Promise<SystemUser[]> => {
  const { data: perfiles, error: errorPerfiles } = await client()
    .from("profiles")
    .select("id, display_name, employee_code, phone, is_active")
    .order("display_name", { ascending: true });
  if (errorPerfiles) {
    throw new Error(mensajeError("No se pudieron leer los operadores", errorPerfiles.message));
  }

  const { data: roles, error: errorRoles } = await client()
    .from("profile_roles")
    .select("profile_id, branch_id");
  if (errorRoles) {
    throw new Error(mensajeError("No se pudieron leer las asignaciones de sucursal", errorRoles.message));
  }

  const { data: sucursales, error: errorSucursales } = await client()
    .from("branches")
    .select("id, name");
  if (errorSucursales) {
    throw new Error(mensajeError("No se pudieron leer las sucursales", errorSucursales.message));
  }

  const nombrePorSucursal = new Map<string, string>();
  for (const s of (sucursales ?? []) as Array<{ id: string; name: string }>) {
    nombrePorSucursal.set(s.id, s.name);
  }

  const sucursalPorPerfil = new Map<string, string>();
  for (const r of (roles ?? []) as ProfileRoleRow[]) {
    if (r.branch_id && !sucursalPorPerfil.has(r.profile_id)) {
      const nombre = nombrePorSucursal.get(r.branch_id);
      if (nombre) sucursalPorPerfil.set(r.profile_id, nombre);
    }
  }

  return ((perfiles ?? []) as ProfileRow[]).map((p) => ({
    id: p.id,
    display_name: p.display_name,
    employee_code: p.employee_code ?? null,
    phone: p.phone ?? null,
    is_active: p.is_active,
    branch_name: sucursalPorPerfil.get(p.id) ?? null,
  }));
};

export const listSystemSettings = async (): Promise<SystemSetting[]> => {
  const { data, error } = await client()
    .from("system_settings")
    .select("key, branch_id, value, updated_at");
  if (error) {
    throw new Error(mensajeError("No se pudieron leer los ajustes del sistema", error.message));
  }
  return ((data ?? []) as SystemSetting[]).map((s) => ({
    key: s.key,
    branch_id: s.branch_id ?? null,
    value: s.value,
    updated_at: s.updated_at,
  }));
};

const obtenerOrganizacionId = async (): Promise<string> => {
  const { data: sesion, error: errorSesion } = await client().auth.getUser();
  if (errorSesion) {
    throw new Error(mensajeError("No se pudo obtener la sesión activa", errorSesion.message));
  }
  const userId = sesion.user?.id;
  if (!userId) throw new Error("No hay sesión activa para guardar ajustes.");
  const { data, error } = await client()
    .from("profiles")
    .select("organization_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(mensajeError("No se pudo leer el perfil del operador", error.message));
  }
  const organizationId = (data as { organization_id: string | null } | null)?.organization_id;
  if (!organizationId) throw new Error("El perfil del operador no tiene organización asignada.");
  return organizationId;
};

export const guardarAjuste = async (
  key: string,
  value: unknown,
  branchId: string | null = null,
): Promise<void> => {
  const organizationId = await obtenerOrganizacionId();
  const { error } = await client()
    .from("system_settings")
    .upsert(
      { organization_id: organizationId, branch_id: branchId, key, value },
      { onConflict: "organization_id,branch_scope,key" },
    );
  if (error) throw new Error(mensajeError(`No se pudo guardar el ajuste ${key}`, error.message));
};
