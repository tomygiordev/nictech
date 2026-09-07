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
import {
  listOnlineOrders,
  fulfillOnlineOrder,
  type DbOrder,
  type FulfillOnlineOrderResult,
} from "./api";

export const OnlineOrdersWorkspace = () => {
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [selectedOrder, setSelectedOrder] = useState<DbOrder | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [fulfillOrder, setFulfillOrder] = useState<DbOrder | null>(null);
  const [paymentReference, setPaymentReference] = useState<string>("");
  const [operationReason, setOperationReason] = useState<string>("");
  const [fulfilling, setFulfilling] = useState<boolean>(false);
  const [fulfillError, setFulfillError] = useState<string | null>(null);
  const [fulfillResult, setFulfillResult] = useState<FulfillOnlineOrderResult | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listOnlineOrders();
      setOrders(data);
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

  const openFulfill = (order: DbOrder) => {
    setFulfillOrder(order);
    setPaymentReference(order.payment_id ?? "");
    setOperationReason("");
    setFulfillError(null);
    setFulfillResult(null);
  };

  const closeFulfill = () => {
    if (fulfilling) return;
    setFulfillOrder(null);
    setPaymentReference("");
    setOperationReason("");
    setFulfillError(null);
    setFulfillResult(null);
  };

  const handleFulfill = async () => {
    if (!fulfillOrder) return;
    try {
      setFulfilling(true);
      setFulfillError(null);
      setFulfillResult(null);
      const result = await fulfillOnlineOrder(fulfillOrder.id, paymentReference, operationReason);
      setFulfillResult(result);
      setFeedback({
        type: "success",
        message: `Pedido cumplido. Venta ${result.sale_id.slice(0, 8).toUpperCase()} · Stock ${result.stock_document_id.slice(0, 8).toUpperCase()} · Asiento ${result.journal_entry_id.slice(0, 8).toUpperCase()}.`,
      });
      await fetchOrders();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al cumplir el pedido";
      setFulfillError(msg);
    } finally {
      setFulfilling(false);
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
                  <th>ID Orden</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Estado</th>
                  <th>Creada</th>
                  <th>Stock</th>
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
                      <td>
                        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                          {formatDateTime(order.created_at)}
                        </span>
                      </td>
                      <td>
                        {order.stock_decremented ? (
                          <span className="flow-status-pill completed">Descontado</span>
                        ) : (
                          <span className="flow-status-pill pending">Pendiente</span>
                        )}
                      </td>
                      <td className="text-right">
                        <div style={{ display: "inline-flex", gap: "6px" }} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="pag-btn"
                            style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                            onClick={() => setSelectedOrder(order)}
                          >
                            <Eye size={12} /> Ver
                          </button>
                          <button
                            type="button"
                            className="pag-btn"
                            style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                            onClick={() => openFulfill(order)}
                          >
                            <CheckCircle2 size={12} /> Cumplir
                          </button>
                        </div>
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
            <div style={{ padding: "12px", background: "var(--surface-white)", borderRadius: "10px", border: "1px solid var(--border-line)" }}>
              <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
                Estado actual
              </span>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                <span className="flow-status-pill processing">{selectedOrder.status}</span>
                <span className={`flow-status-pill ${selectedOrder.stock_decremented ? "completed" : "pending"}`}>
                  Stock: {selectedOrder.stock_decremented ? "descontado" : "pendiente"}
                </span>
                <button
                  type="button"
                  className="pag-btn"
                  style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                  onClick={() => {
                    const current = selectedOrder;
                    setSelectedOrder(null);
                    openFulfill(current);
                  }}
                >
                  <CheckCircle2 size={12} /> Cumplir pedido
                </button>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "8px 0 0" }}>
                El cumplimiento se ejecuta vía transacción (venta + stock + asiento). No hay cambios manuales de estado.
              </p>
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

            {selectedOrder.items && Array.isArray(selectedOrder.items) && selectedOrder.items.length > 0 && (
              <div style={{ background: "var(--surface-white)", padding: "12px", borderRadius: "10px", border: "1px solid var(--border-line)" }}>
                <span className="stat-label" style={{ marginBottom: "6px", display: "block" }}>Ítems Comprados:</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {selectedOrder.items.map((it, idx: number) => (
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

      {/* Fulfill Modal */}
      {fulfillOrder && (
        <Modal
          isOpen={Boolean(fulfillOrder)}
          onClose={closeFulfill}
          title={`Cumplir pedido ORD-${fulfillOrder.id.slice(0, 8).toUpperCase()}`}
          subtitle={`Total ${formatCurrency(Number(fulfillOrder.total || 0), "ARS")} • Transacción: venta + stock + asiento`}
          icon={CheckCircle2}
          maxWidth="520px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <label htmlFor="fulfill-payment-ref" style={{ fontSize: "12px", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                Referencia de pago (MercadoPago) *
              </label>
              <input
                id="fulfill-payment-ref"
                type="text"
                className="flow-input"
                placeholder="Ej. payment_id de MercadoPago"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                disabled={fulfilling}
                style={{ width: "100%" }}
              />
            </div>

            <div>
              <label htmlFor="fulfill-reason" style={{ fontSize: "12px", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                Motivo de la operación
              </label>
              <input
                id="fulfill-reason"
                type="text"
                className="flow-input"
                placeholder="Cumplimiento de pedido online"
                value={operationReason}
                onChange={(e) => setOperationReason(e.target.value)}
                disabled={fulfilling}
                style={{ width: "100%" }}
              />
            </div>

            {fulfillError && (
              <StatePanel type="error" title="No se pudo cumplir el pedido" message={fulfillError} />
            )}

            {fulfillResult && (
              <div style={{ background: "var(--canvas-bg)", padding: "12px", borderRadius: "10px", fontSize: "12px" }}>
                <strong style={{ display: "block", marginBottom: "6px" }}>Transacción completada:</strong>
                <span style={{ display: "block", fontFamily: "monospace" }}>sale_id: {fulfillResult.sale_id}</span>
                <span style={{ display: "block", fontFamily: "monospace" }}>stock_document_id: {fulfillResult.stock_document_id}</span>
                <span style={{ display: "block", fontFamily: "monospace" }}>journal_entry_id: {fulfillResult.journal_entry_id}</span>
              </div>
            )}

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button type="button" className="pag-btn" onClick={closeFulfill} disabled={fulfilling}>
                {fulfillResult ? "Cerrar" : "Cancelar"}
              </button>
              {!fulfillResult && (
                <button
                  type="button"
                  className="pag-btn"
                  onClick={handleFulfill}
                  disabled={fulfilling || paymentReference.trim() === ""}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  {fulfilling && <Loader2 size={14} className="animate-spin" />}
                  Confirmar fulfill
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
