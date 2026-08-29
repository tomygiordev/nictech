import { useQuery } from "@tanstack/react-query";
import { listOpenCashSessions } from "./api";

export const CashWorkspace = () => {
  const sessions = useQuery({ queryKey: ["erp", "cash", "sessions"], queryFn: listOpenCashSessions });
  if (sessions.isLoading) return <div className="module-state">Cargando sesiones de caja…</div>;
  if (sessions.error) return <div className="module-state" role="alert">Error al cargar caja: {sessions.error.message}</div>;
  const items = sessions.data ?? [];
  return <div className="finance-workspace"><div className="section-heading"><div><h2>Caja</h2><p>Sesiones abiertas y trazabilidad de movimientos.</p></div><span>{items.length} sesiones</span></div>{items.length === 0 ? <div className="empty-ledger"><strong>No hay sesiones abiertas.</strong><p>La apertura requiere permiso y un arqueo inicial.</p></div> : <div className="finance-list">{items.map((session) => <article className="finance-card" key={session.id}><strong>{session.id.slice(0, 8)}</strong><span>{session.opened_at} · {session.reason}</span></article>)}</div>}</div>;
};
