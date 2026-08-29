import type { ReactNode } from "react";
import { useErpAuth } from "./ErpAuthContext";

type ErpAccessGateProps = {
  permission?: string;
  children: ReactNode;
};

export const ErpAccessGate = ({ permission, children }: ErpAccessGateProps) => {
  const { session, loading, error, hasPermission } = useErpAuth();

  if (loading) return <div className="module-state">Cargando sesión local…</div>;
  if (error) return <div className="module-state">Error de configuración o sesión: {error}</div>;
  if (!session) return <div className="module-state">Iniciá sesión para acceder al ERP.</div>;
  if (permission && !hasPermission(permission)) {
    return <div className="module-state">No tenés permiso para acceder a este módulo.</div>;
  }
  return <>{children}</>;
};
