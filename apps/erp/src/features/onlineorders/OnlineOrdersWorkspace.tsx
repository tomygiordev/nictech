import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ShoppingBag,
  Search,
  CreditCard,
  PackageCheck,
  Truck,
  Loader2,
  RefreshCw,
  Eye,
  CheckCircle2,
} from "lucide-react";
import {
  WorkspaceHeader,
  StatePanel,
  Modal,
  FeedbackAlert,
  KpiCard,
} from "../../components/erp/WorkspaceUi";
import { formatCurrency, formatDateTime } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";

export interface OrderPayerInfo {
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

export interface OrderItemInfo {
  title?: string;
  name?: string;
  quantity?: number;
  unit_price?: number;
  price?: number;
}

export interface DbOrder {
  id: string;
  payment_id: string | null;
  status: string;
  total: number;
  items: OrderItemInfo[] | null;
  payer: OrderPayerInfo | null;
  created_at: string;
  stock_decremented: boolean | null;
  payment_method_id: string | null;
}

export const OnlineOrdersWorkspace = () => {
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [selectedOrder, setSelectedOrder] = useState<DbOrder | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: dbErr } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

      if (dbErr) throw dbErr;
      setOrders(data || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al cargar pedidos";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleUpdateOrderStatus = async (orderId: string, nextStatus: string) => {
    try {
      const { error: updErr } = await supabase
        .from("orders")
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq("id", orderId);

      if (updErr) throw updErr;

      setFeedback({ type: "success", message: `¡Pedido actualizado a "${nextStatus}"!` });
      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder({ ...selectedOrder, status: nextStatus });
      }
      fetchOrders();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al actualizar estado del pedido";
      setFeedback({ type: "error", message: msg });
    }
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchFilter = activeFilter === "all" || o.status === activeFilter;
      const q = search.toLowerCase();
      const payerName = o.payer?.name || `${o.payer?.first_name || ""} ${o.payer?.last_name || ""}`.trim() || "";
      const payerEmail = o.payer?.email || "";
      const matchSearch =
        o.id.toLowerCase().includes(q) ||
        (o.payment_id && o.payment_id.toLowerCase().includes(q)) ||
        payerName.toLowerCase().includes(q) ||
        payerEmail.toLowerCase().includes(q);
      return matchFilter && matchSearch;
    });
  }, [orders, activeFilter, search]);

  const approvedCount = orders.filter((o) => o.status === "approved" || o.status === "completed").length;
  const pendingCount = orders.filter((o) => o.status === "pending" || o.status === "in_process").length;
  const totalRevenue = orders.filter((o) => o.status === "approved" || o.status === "completed").reduce((a, b) => a + Number(b.total || 0), 0);

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Pedidos de la Tienda Online (E-commerce Fulfillment)"
        description="Bandeja centralizada de ventas web, confirmación de pagos de Mercado Pago, remisión de stock y despacho."
        badge={`${orders.length} Pedidos en Base de Datos`}
      />

      {feedback && (
        <FeedbackAlert
          type={feedback.type}
          message={feedback.message}
          onClose={() => setFeedback(null)}
        />
      )}

      {/* KPI Cards */}
      <div className="kpi-grid">
        <KpiCard
          icon={ShoppingBag}
          iconVariant="green"
          label="Total Pedidos"
          value={orders.length}
          trend={{ text: "Web", positive: true }}
          sublabel="Sincronizados con Storefront"
        />

        <KpiCard
          icon={CreditCard}
          iconVariant="navy"
          label="Cobrado Online"
          value={formatCurrency(totalRevenue, "ARS")}
          trend={{ text: "ARS", positive: true }}
          sublabel={`${approvedCount} pedidos aprobados`}
        />

        <KpiCard
          icon={PackageCheck}
          iconVariant="steel"
          label="Pendientes de Pago"
          value={pendingCount}
          trend={{ text: "Aguardando", positive: false }}
          sublabel="Mercado Pago / Transf."
        />

        <KpiCard
          icon={Truck}
          iconVariant="dark"
          label="Despachos"
          value={approvedCount}
          trend={{ text: "Logística", positive: true }}
          sublabel="Correo / Retiro local"
        />
      </div>

      {/* Main Card */}
      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Bandeja de Pedidos Web</h2>
            <p className="flow-card__subtitle">Preparación de paquetes, remisión de stock y control de entrega</p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              className="pag-btn"
              onClick={fetchOrders}
              disabled={loading}
              title="Recargar pedidos"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>

            <div className="flow-search-pill" style={{ width: "260px" }}>
              <Search size={15} />
              <input
                type="text"
                placeholder="Buscar por ID, cliente o pago..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", overflowX: "auto" }}>
          {[
            { id: "all", label: `Todos (${orders.length})` },
            { id: "approved", label: `Aprobados (${approvedCount})` },
            { id: "pending", label: `Pendientes (${pendingCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`flow-select-pill ${activeFilter === tab.id ? "active" : ""}`}
              onClick={() => setActiveFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)" }}>
            <Loader2 size={32} className="animate-spin" style={{ margin: "0 auto 12px", color: "var(--brand-primary)" }} />
            <p style={{ margin: 0, fontWeight: 600 }}>Cargando pedidos online…</p>
          </div>
        ) : error ? (
          <StatePanel type="error" title="Error al cargar pedidos" message={error} />
        ) : filteredOrders.length === 0 ? (
          <StatePanel
            type="empty"
            title="No se encontraron pedidos web"
            message="Cuando un cliente compre en la tienda online, su orden aparecerá aquí en tiempo real."
          />
        ) : (
          <div className="flow-table-wrapper">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>Nro Orden / ID</th>
                  <th>Cliente & Contacto</th>
                  <th>Fecha</th>
                  <th>Pago</th>
                  <th>Total</th>
                  <th>Estado</th>
                  <th className="text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  const payerName = order.payer?.name || `${order.payer?.first_name || ""} ${order.payer?.last_name || ""}`.trim() || "Consumidor Web";
                  const payerEmail = order.payer?.email || "—";
                  return (
                    <tr key={order.id} style={{ cursor: "pointer" }} onClick={() => setSelectedOrder(order)}>
                      <td>
                        <span className="type-badge green" style={{ fontFamily: "monospace" }}>
                          {order.id.slice(0, 8).toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <strong>{payerName}</strong>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{payerEmail}</span>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                          {formatDateTime(order.created_at)}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: "12px", textTransform: "uppercase", color: "var(--steel-blue)", fontWeight: 700 }}>
                          {order.payment_method_id || "Mercado Pago"}
                        </span>
                      </td>
                      <td>
                        <strong style={{ color: "var(--brand-primary)" }}>{formatCurrency(Number(order.total || 0), "ARS")}</strong>
                      </td>
                      <td>
                        {order.status === "approved" || order.status === "completed" ? (
                          <span className="flow-status-pill completed">Aprobado</span>
                        ) : order.status === "pending" ? (
                          <span className="flow-status-pill pending">Pendiente</span>
                        ) : (
                          <span className="flow-status-pill processing">{order.status}</span>
                        )}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="pag-btn"
                          style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedOrder(order);
                          }}
                        >
                          <Eye size={12} /> Ver Detalle
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedOrder && (
        <Modal
          isOpen={Boolean(selectedOrder)}
          onClose={() => setSelectedOrder(null)}
          title={`Pedido Web: ORD-${selectedOrder.id.slice(0, 8).toUpperCase()}`}
          subtitle={`Cliente: ${selectedOrder.payer?.name || selectedOrder.payer?.email || "Consumidor"} • ${formatDateTime(selectedOrder.created_at)}`}
          icon={ShoppingBag}
          maxWidth="600px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* Status Change Buttons */}
            <div style={{ padding: "12px", background: "var(--surface-white)", borderRadius: "10px", border: "1px solid var(--border-line)" }}>
              <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
                Marcar Estado del Pedido:
              </span>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {["approved", "preparing", "shipped", "delivered", "cancelled"].map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={`flow-select-pill ${selectedOrder.status === st ? "active" : ""}`}
                    onClick={() => handleUpdateOrderStatus(selectedOrder.id, st)}
                  >
                    {st === "approved" ? "Aprobado" : st === "preparing" ? "En Preparación" : st === "shipped" ? "Despachado" : st === "delivered" ? "Entregado" : "Cancelado"}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", background: "var(--canvas-bg)", padding: "12px", borderRadius: "10px" }}>
              <div>
                <span className="stat-label">ID de Pago MP</span>
                <strong style={{ display: "block", fontSize: "12px", marginTop: "2px", fontFamily: "monospace" }}>
                  {selectedOrder.payment_id || "—"}
                </strong>
              </div>
              <div>
                <span className="stat-label">Email de Contacto</span>
                <span style={{ display: "block", fontSize: "12px", marginTop: "2px", fontWeight: 600 }}>
                  {selectedOrder.payer?.email || "Sin email"}
                </span>
              </div>
              <div>
                <span className="stat-label">Total Facturado</span>
                <strong style={{ display: "block", fontSize: "14px", marginTop: "2px", color: "var(--brand-primary)" }}>
                  {formatCurrency(Number(selectedOrder.total || 0), "ARS")}
                </strong>
              </div>
            </div>

            {/* Items breakdown */}
            {selectedOrder.items && Array.isArray(selectedOrder.items) && selectedOrder.items.length > 0 && (
              <div style={{ background: "var(--surface-white)", padding: "12px", borderRadius: "10px", border: "1px solid var(--border-line)" }}>
                <span className="stat-label" style={{ marginBottom: "6px", display: "block" }}>Ítems Comprados:</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {selectedOrder.items.map((it: OrderItemInfo, idx: number) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-light)", paddingBottom: "6px" }}>
                      <div>
                        <strong style={{ fontSize: "13px" }}>{it.title || it.name || `Producto ${idx + 1}`}</strong>
                        <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>Cantidad: {it.quantity || 1}</span>
                      </div>
                      <strong style={{ color: "var(--text-main)" }}>{formatCurrency(Number(it.unit_price || it.price || 0), "ARS")}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
