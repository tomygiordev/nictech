import { useQuery } from "@tanstack/react-query";
import { Wallet, Clock, CheckCircle2 } from "lucide-react";
import { listOpenCashSessions } from "./api";
import { StatePanel, WorkspaceHeader } from "../../components/erp/WorkspaceUi";

export const CashWorkspace = () => {
  const sessions = useQuery({ queryKey: ["erp", "cash", "sessions"], queryFn: listOpenCashSessions });

  if (sessions.isLoading) {
    return <StatePanel type="loading" message="Cargando sesiones de caja…" />;
  }
  if (sessions.error) {
    return <StatePanel type="error" title="Error al cargar caja" message={sessions.error.message} />;
  }

  const items = sessions.data ?? [];

  return (
    <div>
      <WorkspaceHeader
        title="Gestión de Caja"
        description="Apertura, arqueos, retiros y trazabilidad de sesiones activas."
        badge={`${items.length} Sesiones Abiertas`}
      />

      {items.length === 0 ? (
        <StatePanel
          type="empty"
          title="No hay sesiones de caja abiertas"
          message="La apertura de un nuevo turno requiere autorización y un arqueo ciego inicial."
        />
      ) : (
        <div className="records-grid">
          {items.map((session) => (
            <article className="record-card" key={session.id}>
              <div className="record-card__header">
                <div className="record-card__icon-box amber">
                  <Wallet size={18} />
                </div>
                <span className="status-pill status-pill--mint">
                  <CheckCircle2 size={11} /> Turno Abierto
                </span>
              </div>
              <div className="record-card__body">
                <strong>Sesión #{session.id.slice(0, 8)}</strong>
                <span className="record-card__code">{session.reason || "Operación regular de turno"}</span>
              </div>
              <div className="record-card__footer">
                <Clock size={13} color="#64748b" />
                <span>Abierta: {new Date(session.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} hs</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
