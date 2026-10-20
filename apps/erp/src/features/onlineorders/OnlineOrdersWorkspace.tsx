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
  ClipboardList,
  PackageOpen,
  XCircle,
  RotateCcw,
} from "lucide-react";
import {
  WorkspaceHeader,
  StatePanel,
  Modal,
  FeedbackAlert,
  KpiCard,
} from "../../components/erp/WorkspaceUi";
import { formatCurrency, formatDateTime } from "../../lib/formatters";
import { useErpAuth } from "../../auth/ErpAuthContext";
import {
  listOnlineOrders,
  fulfillOnlineOrder,
  newOpKey,
  refundOnlineOrder,
  transitionOnlineOrder,
  type DbOrder,
  type FulfillOnlineOrderResult,
} from "./api";
import {
  onlineOrderDispatchSchema,
  onlineOrderReasonSchema,
  onlineOrderRefundSchema,
} from "./schemas";

type OrderFilter = "all" | "fulfilled" | "paid" | "pending";
type LifecycleAction = "preparing" | "ready" | "delivered" | "cancelled" | "refund";

const shortId = (id: string): string => id.slice(0, 8).toUpperCase();

const deliveryLabel = (state: string | null): string => {
  switch (state) {
    case "pending": return "Pendiente";
    case "preparing": return "Preparando";
    case "ready": return "Listo";
    case "dispatched": return "Despachado";
    case "delivered": return "Entregado";
    case "returned": return "Devuelto";
    default: return "Sin estado";
  }
};

const eventLabel = (event: DbOrder["events"][number]): string => {
  if (event.order_state) return `Pedido: ${event.order_state}`;
  if (event.payment_state) return `Pago: ${event.payment_state}`;
  if (event.delivery_state) return `Entrega: ${deliveryLabel(event.delivery_state)}`;
  return "Evento operativo";
};

const actionTitle: Record<LifecycleAction, string> = {
  preparing: "Preparar pedido",
  ready: "Marcar pedido listo",
  delivered: "Confirmar entrega",
  cancelled: "Cancelar pedido",
  refund: "Devolver y reembolsar",
};

const actionIcon: Record<LifecycleAction, typeof ClipboardList> = {
  preparing: ClipboardList,
  ready: PackageOpen,
  delivered: Truck,
  cancelled: XCircle,
  refund: RotateCcw,
};

const availableLifecycleActions = (
  order: DbOrder,
  canManageOrders: boolean,
  canRefundOrders: boolean,
): LifecycleAction[] => {
  if (!canManageOrders) return [];

  const actions: LifecycleAction[] = [];
  const orderCanChange = order.order_state === "placed" || order.order_state === "confirmed";
  if (orderCanChange && order.delivery_state === "pending") actions.push("preparing");
  if (orderCanChange && order.delivery_state === "preparing") actions.push("ready");
  if (orderCanChange && order.payment_state === "unpaid") actions.push("cancelled");
  if (order.fulfilled && order.delivery_state === "dispatched") actions.push("delivered");
  if (
    canRefundOrders
    && order.fulfilled
    && order.delivery_state === "delivered"
    && order.refundable_payment_event_id
  ) {
    actions.push("refund");
  }
  return actions;
};

/** Etiqueta de pago derivada del último evento (nunca inventada): paid/partial/... o "—" sin eventos. */
const paymentLabel = (order: DbOrder): string => {
  if (order.fulfilled || order.order_state === "fulfilled") return "Cumplido";
  switch (order.payment_state) {
    case "paid":
      return "Aprobado";
    case "partial":
      return "Parcial";
    case "refunded":
      return "Reembolsado";
    case "unpaid":
      return "Pendiente";
    default:
      return order.last_payment_status ?? "—";
  }
};

export const OnlineOrdersWorkspace = () => {
  const { hasPermission } = useErpAuth();
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<OrderFilter>("all");
  const [search, setSearch] = useState<string>("");
  const [selectedOrder, setSelectedOrder] = useState<DbOrder | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [fulfillOrder, setFulfillOrder] = useState<DbOrder | null>(null);
  const [paymentReference, setPaymentReference] = useState<string>("");
  const [operationReason, setOperationReason] = useState<string>("");
  const [fulfilling, setFulfilling] = useState<boolean>(false);
  const [fulfillError, setFulfillError] = useState<string | null>(null);
  const [fulfillResult, setFulfillResult] = useState<FulfillOnlineOrderResult | null>(null);
  const [fulfillOperationKey, setFulfillOperationKey] = useState<string>("");
  const [lifecycleAction, setLifecycleAction] = useState<{ order: DbOrder; kind: LifecycleAction; operationKey: string } | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState<string>("");
  const [physicalReturnConfirmed, setPhysicalReturnConfirmed] = useState<boolean>(false);
  const [lifecycleBusy, setLifecycleBusy] = useState<boolean>(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listOnlineOrders();
      setOrders(data);
      setSelectedOrder((current) => current ? data.find((order) => order.id === current.id) ?? null : null);
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
    setPaymentReference("");
    setOperationReason("");
    setFulfillError(null);
    setFulfillResult(null);
    setFulfillOperationKey(newOpKey("online-dispatch-"));
  };

  const closeFulfill = () => {
    if (fulfilling) return;
    setFulfillOrder(null);
    setPaymentReference("");
    setOperationReason("");
    setFulfillError(null);
    setFulfillResult(null);
    setFulfillOperationKey("");
  };

  const handleFulfill = async () => {
    if (!fulfillOrder) return;
    try {
      setFulfilling(true);
      setFulfillError(null);
      setFulfillResult(null);
      const parsed = onlineOrderDispatchSchema.parse({ paymentReference, reason: operationReason });
      const result = await fulfillOnlineOrder(
        fulfillOrder.id,
        parsed.paymentReference,
        parsed.reason,
        fulfillOperationKey,
      );
      setFulfillResult(result);
      setFeedback({
        type: "success",
        message: `Pedido cumplido. Venta ${shortId(result.sale_id)} · Stock ${shortId(result.stock_document_id)} · Asiento ${shortId(result.journal_entry_id)}.`,
      });
      await fetchOrders();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al despachar el pedido";
      setFulfillError(msg);
    } finally {
      setFulfilling(false);
    }
  };

  const openLifecycleAction = (order: DbOrder, kind: LifecycleAction) => {
    setLifecycleAction({ order, kind, operationKey: newOpKey(`online-${kind}-`) });
    setLifecycleReason("");
    setPhysicalReturnConfirmed(false);
    setLifecycleError(null);
  };

  const closeLifecycleAction = () => {
    if (lifecycleBusy) return;
    setLifecycleAction(null);
    setLifecycleReason("");
    setPhysicalReturnConfirmed(false);
    setLifecycleError(null);
  };

  const handleLifecycleAction = async () => {
    if (!lifecycleAction) return;
    try {
      setLifecycleBusy(true);
      setLifecycleError(null);
      const { order, kind, operationKey } = lifecycleAction;
      if (kind === "refund") {
        const parsed = onlineOrderRefundSchema.parse({
          reason: lifecycleReason,
          physicalReturnConfirmed,
        });
        if (!order.refundable_payment_event_id) {
          throw new Error("Todavía no existe un evento de reembolso del proveedor pendiente de aplicar.");
        }
        await refundOnlineOrder(order.id, order.refundable_payment_event_id, parsed.reason, operationKey);
      } else {
        const parsed = onlineOrderReasonSchema.parse({ reason: lifecycleReason });
        await transitionOnlineOrder(
          order.id,
          kind === "cancelled" ? { orderState: "cancelled" } : { deliveryState: kind },
          parsed.reason,
          operationKey,
        );
      }
      setFeedback({ type: "success", message: `${actionTitle[kind]} registrado con trazabilidad.` });
      closeLifecycleAction();
      await fetchOrders();
    } catch (err: unknown) {
      setLifecycleError(err instanceof Error ? err.message : "No se pudo actualizar el pedido.");
    } finally {
      setLifecycleBusy(false);
    }
  };

  const canManageOrders = hasPermission("orders.manage");
  const canRefundOrders = canManageOrders
    && hasPermission("sales.cancel")
    && hasPermission("stock.adjust");

  const canFulfillOrder = (order: DbOrder): boolean => (
    canManageOrders
    && !order.fulfilled
    && order.payment_state === "paid"
    && order.delivery_state === "ready"
  );

  const openLifecycleFromDetail = (kind: LifecycleAction) => {
    if (!selectedOrder) return;
    const order = selectedOrder;
    setSelectedOrder(null);
    openLifecycleAction(order, kind);
  };

  const matchesFilter = (o: DbOrder): boolean => {
    switch (activeFilter) {
      case "fulfilled":
        return o.fulfilled;
      case "paid":
        return !o.fulfilled && o.payment_state === "paid";
      case "pending":
        return !o.fulfilled && o.payment_state !== "paid";
      default:
        return true;
    }
  };

  const filteredOrders = useMemo(() => {
    const q = search.toLowerCase();
    return orders.filter((o) => {
      if (!matchesFilter(o)) return false;
      if (q === "") return true;
      return (
        o.id.toLowerCase().includes(q) ||
        (o.customer_id ?? "").toLowerCase().includes(q) ||
        (o.sale_id ?? "").toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, activeFilter, search]);

  const fulfilledCount = orders.filter((o) => o.fulfilled).length;
  const paidCount = orders.filter((o) => !o.fulfilled && o.payment_state === "paid").length;
  const pendingCount = orders.filter((o) => !o.fulfilled && o.payment_state !== "paid").length;
  const paidRevenue = orders
    .filter((o) => o.payment_state === "paid" || o.fulfilled)
    .reduce((a, b) => a + Number(b.total_amount || 0), 0);

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Pedidos de la tienda online"
        description="Consulta y gestión de pedidos web: pago, preparación, despacho y cambios registrados."
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
          sublabel="Pedidos capturados desde la tienda"
        />

        <KpiCard
          icon={CreditCard}
          iconVariant="navy"
          label="Cobrado Online"
          value={formatCurrency(paidRevenue, "ARS")}
          trend={{ text: "ARS", positive: true }}
          sublabel={`${paidCount + fulfilledCount} pedidos con pago aprobado`}
        />

        <KpiCard
          icon={PackageCheck}
          iconVariant="steel"
          label="Pendientes de Pago"
          value={pendingCount}
          trend={{ text: "Aguardando", positive: false }}
          sublabel="Sin pago aprobado / sin eventos"
        />

        <KpiCard
          icon={Truck}
          iconVariant="dark"
          label="Despachados"
          value={fulfilledCount}
          trend={{ text: "Completados", positive: true }}
          sublabel="Venta + stock remitido"
        />
      </div>

      {/* Main Card */}
      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Bandeja de Pedidos Web</h2>
            <p className="flow-card__subtitle">Estado derivado del despacho y del último cambio registrado. Sin estados manuales.</p>
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
                placeholder="Buscar por ID de orden, cliente o venta..."
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
            { id: "paid", label: `Pagados p/ cumplir (${paidCount})` },
            { id: "pending", label: `Pendientes (${pendingCount})` },
            { id: "fulfilled", label: `Despachados (${fulfilledCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`flow-select-pill ${activeFilter === tab.id ? "active" : ""}`}
              onClick={() => setActiveFilter(tab.id as OrderFilter)}
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
                  <th>Total</th>
                  <th>Estado pago</th>
                  <th>Cumplimiento</th>
                  <th>Creada</th>
                  <th className="text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr
                    key={order.id}
                    className="interactive-row"
                    role="button"
                    tabIndex={0}
                    aria-label={`Abrir pedido ${shortId(order.id)}`}
                    onClick={() => setSelectedOrder(order)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedOrder(order);
                      }
                    }}
                  >
                    <td>
                      <span className="type-badge green" style={{ fontFamily: "monospace" }}>
                        {shortId(order.id)}
                      </span>
                    </td>
                    <td>
                      <strong style={{ color: "var(--brand-primary)" }}>{formatCurrency(Number(order.total_amount || 0), "ARS")}</strong>
                    </td>
                    <td>
                      {order.payment_state === "paid" ? (
                        <span className="flow-status-pill completed">Aprobado</span>
                      ) : order.payment_state === "partial" ? (
                        <span className="flow-status-pill processing">Parcial</span>
                      ) : order.payment_state === "refunded" ? (
                        <span className="flow-status-pill processing">Reembolsado</span>
                      ) : order.payment_state === "unpaid" ? (
                        <span className="flow-status-pill pending">Pendiente</span>
                      ) : (
                        <span className="flow-status-pill pending">{order.last_payment_status ?? "Sin eventos"}</span>
                      )}
                    </td>
                    <td>
                      {order.fulfilled ? (
                        <span className="flow-status-pill completed">Cumplido</span>
                      ) : (
                        <span className="flow-status-pill pending">Pendiente</span>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                        {formatDateTime(order.created_at)}
                      </span>
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
                        {canFulfillOrder(order) && (
                          <button
                            type="button"
                            className="pag-btn"
                            style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                            onClick={() => openFulfill(order)}
                          >
                            <CheckCircle2 size={12} /> Cumplir
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
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
          title={`Pedido Web: ORD-${shortId(selectedOrder.id)}`}
          subtitle={`${formatCurrency(Number(selectedOrder.total_amount || 0), "ARS")} • ${formatDateTime(selectedOrder.created_at)}`}
          icon={ShoppingBag}
          maxWidth="600px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ padding: "12px", background: "var(--surface-white)", borderRadius: "10px", border: "1px solid var(--border-line)" }}>
              <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
                Estado derivado (despacho + último cambio)
              </span>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                <span className="flow-status-pill processing">{paymentLabel(selectedOrder)}</span>
                <span className={`flow-status-pill ${selectedOrder.fulfilled ? "completed" : "pending"}`}>
                  Stock: {selectedOrder.fulfilled ? "remitido" : "pendiente"}
                </span>
                {canFulfillOrder(selectedOrder) && (
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
                )}
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "8px 0 0" }}>
                order_state: {selectedOrder.order_state ?? "—"} · payment_state: {selectedOrder.payment_state ?? "—"} · delivery_state: {selectedOrder.delivery_state ?? "—"}
                {selectedOrder.fulfilled && selectedOrder.sale_id ? ` · venta ${shortId(selectedOrder.sale_id)}` : ""}
                {selectedOrder.fulfilled && selectedOrder.stock_document_id ? ` · stock ${shortId(selectedOrder.stock_document_id)}` : ""}. El cumplimiento se ejecuta
                vía transacción (venta + stock + asiento). No hay cambios manuales de estado.
              </p>
            </div>

            {availableLifecycleActions(selectedOrder, canManageOrders, canRefundOrders).length > 0 && (
              <div style={{ padding: "12px", background: "var(--canvas-bg)", borderRadius: "10px" }}>
                <span className="stat-label" style={{ display: "block", marginBottom: "8px" }}>Acciones disponibles</span>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {availableLifecycleActions(selectedOrder, canManageOrders, canRefundOrders).map((kind) => {
                    const Icon = actionIcon[kind];
                    return (
                      <button
                        key={kind}
                        type="button"
                        className="pag-btn"
                        onClick={() => openLifecycleFromDetail(kind)}
                        style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}
                      >
                        <Icon size={13} /> {actionTitle[kind]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ background: "var(--surface-white)", padding: "12px", borderRadius: "10px", border: "1px solid var(--border-line)" }}>
              <span className="stat-label" style={{ display: "block", marginBottom: "8px" }}>Timeline de eventos</span>
              {selectedOrder.events.length === 0 ? (
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Todavía no hay eventos operativos registrados.</span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {selectedOrder.events.map((event) => (
                    <div key={event.id} style={{ display: "grid", gridTemplateColumns: "44px 1fr auto", gap: "8px", alignItems: "start", borderBottom: "1px solid var(--border-light)", paddingBottom: "8px" }}>
                      <span className="type-badge green" style={{ fontFamily: "monospace", fontSize: "10px" }}>#{event.event_sequence}</span>
                      <div>
                        <strong style={{ display: "block", fontSize: "12px" }}>
                          {eventLabel(event)}
                        </strong>
                        <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>{event.reason}</span>
                        <span style={{ display: "block", fontSize: "10px", color: "var(--text-muted)" }}>
                          {event.actor_name ?? (event.actor_id ? `Usuario ${shortId(event.actor_id)}` : "Sistema")}
                        </span>
                      </div>
                      <span style={{ fontSize: "10px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{formatDateTime(event.occurred_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", background: "var(--canvas-bg)", padding: "12px", borderRadius: "10px" }}>
              <div>
                <span className="stat-label">Cliente (ID)</span>
                <strong style={{ display: "block", fontSize: "12px", marginTop: "2px", fontFamily: "monospace" }}>
                  {selectedOrder.customer_id ? shortId(selectedOrder.customer_id) : "—"}
                </strong>
              </div>
              <div>
                <span className="stat-label">Último pago (evento)</span>
                <span style={{ display: "block", fontSize: "12px", marginTop: "2px", fontWeight: 600 }}>
                  {selectedOrder.last_payment_status ?? "Sin eventos"}
                  {selectedOrder.last_payment_amount != null ? ` · ${formatCurrency(selectedOrder.last_payment_amount, "ARS")}` : ""}
                </span>
              </div>
              <div>
                <span className="stat-label">Total Facturado</span>
                <strong style={{ display: "block", fontSize: "14px", marginTop: "2px", color: "var(--brand-primary)" }}>
                  {formatCurrency(Number(selectedOrder.total_amount || 0), "ARS")}
                </strong>
              </div>
            </div>

            {selectedOrder.lines.length > 0 && (
              <div style={{ background: "var(--surface-white)", padding: "12px", borderRadius: "10px", border: "1px solid var(--border-line)" }}>
                <span className="stat-label" style={{ marginBottom: "6px", display: "block" }}>Ítems Comprados (web_order_lines):</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {selectedOrder.lines.map((it, idx: number) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-light)", paddingBottom: "6px" }}>
                      <div>
                        <strong style={{ fontSize: "13px" }}>{it.description || `Producto ${idx + 1}`}</strong>
                        <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>Cantidad: {it.quantity || 1}</span>
                      </div>
                      <strong style={{ color: "var(--text-main)" }}>{formatCurrency(Number(it.unit_price || 0), "ARS")}</strong>
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
          title={`Cumplir pedido ORD-${shortId(fulfillOrder.id)}`}
          subtitle={`Total ${formatCurrency(Number(fulfillOrder.total_amount || 0), "ARS")} • Transacción: venta + stock + asiento`}
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
                placeholder="Ej. provider_payment_id aprobado por el total"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                disabled={fulfilling}
                style={{ width: "100%" }}
              />
              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "4px 0 0" }}>
                El RPC exige pago aprobado por el total y referencia coincidente con el provider payment.
              </p>
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

      {lifecycleAction && (
        <Modal
          isOpen={Boolean(lifecycleAction)}
          onClose={closeLifecycleAction}
          title={actionTitle[lifecycleAction.kind]}
          subtitle={`Pedido ORD-${shortId(lifecycleAction.order.id)} • operación auditable`}
          icon={actionIcon[lifecycleAction.kind]}
          maxWidth="520px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
              La acción se valida de nuevo en el RPC según estado, permisos e idempotencia. El motivo queda registrado en el timeline.
            </p>
            {lifecycleAction.kind === "refund" && (
              <label style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px" }}>
                <input
                  type="checkbox"
                  checked={physicalReturnConfirmed}
                  onChange={(event) => setPhysicalReturnConfirmed(event.target.checked)}
                  disabled={lifecycleBusy}
                />
                Confirmo que la devolución física fue recibida y revisada.
              </label>
            )}
            <div>
              <label htmlFor="lifecycle-reason" style={{ fontSize: "12px", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                Motivo de la operación *
              </label>
              <input
                id="lifecycle-reason"
                type="text"
                className="flow-input"
                placeholder="Describí el motivo operativo"
                value={lifecycleReason}
                onChange={(event) => setLifecycleReason(event.target.value)}
                disabled={lifecycleBusy}
                style={{ width: "100%" }}
              />
            </div>
            {lifecycleError && <StatePanel type="error" title="No se pudo actualizar el pedido" message={lifecycleError} />}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button type="button" className="pag-btn" onClick={closeLifecycleAction} disabled={lifecycleBusy}>Cancelar</button>
              <button
                type="button"
                className="pag-btn"
                onClick={handleLifecycleAction}
                disabled={lifecycleBusy || lifecycleReason.trim().length < 3 || (lifecycleAction.kind === "refund" && !physicalReturnConfirmed)}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                {lifecycleBusy && <Loader2 size={14} className="animate-spin" />}
                Confirmar acción
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
