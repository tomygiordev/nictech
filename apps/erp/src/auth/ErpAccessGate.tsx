import type { ReactNode } from "react";
import { useErpAuth } from "./ErpAuthContext";
import { StatePanel } from "../components/erp/WorkspaceUi";

type ErpAccessGateProps = {
  permission?: string;
  children: ReactNode;
};

export const ErpAccessGate = ({ permission, children }: ErpAccessGateProps) => {
  const { session, loading, error, hasPermission } = useErpAuth();

  if (loading) {
    return <StatePanel type="loading" message="Cargando sesión del ERP…" />;
  }
  if (error && !import.meta.env.DEV) {
    return <StatePanel type="error" title="Error de autenticación" message={error} />;
  }
  if (!session && !import.meta.env.DEV) {
    return (
      <StatePanel
        type="info"
        title="Acceso Restringido"
        message="Iniciá sesión con tus credenciales de operador para acceder a este módulo."
      />
    );
  }
  if (permission && !hasPermission(permission)) {
    return (
      <StatePanel
        type="error"
        title="Permiso Requerido"
        message={`No tenés el permiso (${permission}) requerido para operar este módulo.`}
      />
    );
  }
  return <>{children}</>;
};
