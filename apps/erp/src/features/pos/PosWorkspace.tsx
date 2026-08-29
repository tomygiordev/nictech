import { useQuery } from "@tanstack/react-query";
import { listRegisters } from "./api";

export const PosWorkspace = () => {
  const registers = useQuery({ queryKey: ["erp", "pos", "registers"], queryFn: listRegisters });
  if (registers.isLoading) return <div className="module-state">Cargando cajas…</div>;
  if (registers.error) return <div className="module-state" role="alert">Error al cargar cajas: {registers.error.message}</div>;
  const items = registers.data ?? [];
  return (
    <div className="finance-workspace">
      <div className="section-heading"><div><h2>Punto de venta</h2><p>Ventas atómicas mediante el núcleo transaccional del ERP.</p></div><span>{items.length} cajas activas</span></div>
      {items.length === 0 ? <div className="empty-ledger"><strong>No hay cajas activas.</strong><p>Configurá una caja antes de iniciar una venta.</p></div> : <div className="finance-list">{items.map((register) => <article className="finance-card" key={register.id}><strong>{register.code} · {register.name}</strong><span>Sucursal {register.branch_id}</span></article>)}</div>}
    </div>
  );
};
