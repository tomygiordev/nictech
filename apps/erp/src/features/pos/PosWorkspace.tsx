import { useQuery } from "@tanstack/react-query";
import { Store, Building2, CheckCircle2 } from "lucide-react";
import { listRegisters } from "./api";
import { StatePanel, WorkspaceHeader } from "../../components/erp/WorkspaceUi";

export const PosWorkspace = () => {
  const registers = useQuery({ queryKey: ["erp", "pos", "registers"], queryFn: listRegisters });

  if (registers.isLoading) {
    return <StatePanel type="loading" message="Cargando terminales y cajas del punto de venta…" />;
  }
  if (registers.error) {
    return <StatePanel type="error" title="Error al cargar cajas" message={registers.error.message} />;
  }

  const items = registers.data ?? [];

  return (
    <div>
      <WorkspaceHeader
        title="Punto de Venta"
        description="Terminales de facturación rápida y cajas de cobro sincronizadas."
        badge={`${items.length} Cajas Registradas`}
      />

      {items.length === 0 ? (
        <StatePanel
          type="empty"
          title="No hay cajas activas registradas"
          message="Configurá una caja registradora en el sistema antes de iniciar una venta."
        />
      ) : (
        <div className="records-grid">
          {items.map((register) => (
            <article className="record-card" key={register.id}>
              <div className="record-card__header">
                <div className="record-card__icon-box green">
                  <Store size={18} />
                </div>
                <span className="status-pill status-pill--mint">
                  <CheckCircle2 size={11} /> Activa
                </span>
              </div>
              <div className="record-card__body">
                <strong>{register.name}</strong>
                <span className="record-card__code">Código: {register.code}</span>
              </div>
              <div className="record-card__footer">
                <Building2 size={13} color="#64748b" />
                <span>Sucursal {register.branch_id.slice(0, 8)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
