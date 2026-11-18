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
  StatusPill,
} from "../../components/erp/WorkspaceUi";
import { FormError } from "../../components/erp/FormFeedback";
import { toUserMessage } from "../../lib/errors";
import {
  DELIVERY_STATE_LABELS,
  SALE_PAYMENT_STATE_LABELS,
  WEB_ORDER_STATUS_LABELS,
  WEB_PAYMENT_STATUS_LABELS,
  labelOf,
} from "../../lib/labels";
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

type OrderFilter = "all" | "fulfilled" | "paid" | "pending" | "cancelled";
type LifecycleAction = "preparing" | "ready" | "delivered" | "cancelled" | "refund";

const shortId = (id: string): string => id.slice(0, 8).toUpperCase();

const ORDER_EVENT_REASON_LABELS: Readonly<Record<string, string>> = {
  "Web order placed": "Pedido web recibido",
  "Awaiting payment": "Esperando el pago",
  "Awaiting preparation": "Esperando preparación",
  "Mercado Pago approved; prepare storefront order": "Pago aprobado por Mercado Pago; preparar pedido",
  "Mercado Pago approved; storefront order ready for fulfillment": "Pago aprobado por Mercado Pago; pedido listo para despachar",
  "Mercado Pago approved storefront fulfillment": "Pago aprobado por Mercado Pago",
  "Provider payment status pending": "Pago pendiente en proveedor",
  "Provider payment status approved": "Pago aprobado por el proveedor",
  "Provider payment status rejected": "Pago rechazado por el proveedor",
  "Provider payment status cancelled": "Pago cancelado por el proveedor",
  "Provider payment status refunded": "Pago reembolsado por el proveedor",
};

const ORDER_EVENT_REASON_LOWER = new Map<string, string>(
  Object.entries(ORDER_EVENT_REASON_LABELS).map(([key, value]) => [key.toLowerCase(), value]),
);

const UNKNOWN_ENGLISH_OR_TECHNICAL = /\b(?:the|and|for|with|from|into|this|that|was|were|been|have|has|had|not|but|due|until|after|before|while|because|awaiting|waiting|order|orders|payment|payments|provider|status|placed|fulfilled|fulfillment|prepared|preparation|storefront|cancelled|canceled|refunded|rejected|approved|pending|dispatched|delivered|returned|failed|error|unknown|timeout|expired|processing|completed|created|updated|reservation|released|webhook|gateway|reason|missing|invalid|unexpected|already|cannot|could|would|should)\b|\b[a-z\d]+(?:_[a-z\d]+)+\b/i;

const formatEventReason = (reason: string | null | undefined): string | null => {
  const trimmed = reason?.trim() ?? "";
  if (!trimmed) return null;

  const mapped = ORDER_EVENT_REASON_LOWER.get(trimmed.toLowerCase());
  if (mapped) return mapped;

  if (/\b[a-z\d]+(?:_[a-z\d]+)+\b/i.test(trimmed)) return null;
  if (/[áéíóúñü¿¡]/i.test(trimmed)) return trimmed;
  if (UNKNOWN_ENGLISH_OR_TECHNICAL.test(trimmed)) return null;

  return trimmed;
};

const orderStateLabel = (state: string | null): string => {
  if (!state) return "Sin estado";
  if (state === "fulfilled") return "Despachado";
  return labelOf(WEB_ORDER_STATUS_LABELS, state, "Sin estado");
};

const deliveryLabel = (state: string | null): string =>
  state ? labelOf(DELIVERY_STATE_LABELS, state, "Sin estado") : "Sin estado";

const eventLabel = (event: DbOrder["events"][number]): string => {
  if (event.order_state) return `Pedido: ${orderStateLabel(event.order_state)}`;
  if (event.payment_state) return `Pago: ${labelOf(SALE_PAYMENT_STATE_LABELS, event.payment_state, "Actualizado")}`;
  if (event.delivery_state) return `Entrega: ${deliveryLabel(event.delivery_state)}`;
  return "Evento operativo";
};

const isClosedOrder = (order: DbOrder): boolean =>
  order.order_state === "cancelled" || order.order_state === "refunded" || order.payment_state === "refunded";

const customerDisplay = (order: DbOrder): string => {
  if ("customer_name" in order && typeof order.customer_name === "string" && order.customer_name.trim()) {
    return order.customer_name.trim();
  }
  return "Cliente de la tienda";
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

/** Etiqueta de pago derivada del último evento (nunca inventada). */
const paymentLabel = (order: DbOrder): string => {
  if (order.payment_state) return labelOf(SALE_PAYMENT_STATE_LABELS, order.payment_state, "—");
  if (order.last_payment_status) return labelOf(WEB_PAYMENT_STATUS_LABELS, order.last_payment_status, "—");
  return "—";
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
      setError(toUserMessage(err, "No se pudieron cargar los pedidos. Reintentá."));
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
      const parsed = onlineOrderDispatchSchema.safeParse({ paymentReference, reason: operationReason });
      if (!parsed.success) {
        setFulfillError(parsed.error.issues[0]?.message ?? "Revisá los datos del despacho.");
        return;
      }
      const result = await fulfillOnlineOrder(
        fulfillOrder.id,
        parsed.data.paymentReference,
        parsed.data.reason,
        fulfillOperationKey,
      );
      setFulfillResult(result);
      setFeedback({
        type: "success",
        message: `Pedido despachado. Venta ${shortId(result.sale_id)} · Stock ${shortId(result.stock_document_id)} · Asiento ${shortId(result.journal_entry_id)}.`,
      });
      await fetchOrders();
    } catch (err: unknown) {
      setFulfillError(toUserMessage(err, "No se pudo despachar el pedido."));
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
        const parsed = onlineOrderRefundSchema.safeParse({
          reason: lifecycleReason,
          physicalReturnConfirmed,
        });
        if (!parsed.success) {
          setLifecycleError(parsed.error.issues[0]?.message ?? "Revisá los datos del reembolso.");
          return;
        }
        if (!order.refundable_payment_event_id) {
          setLifecycleError("Todavía no existe un evento de reembolso del proveedor pendiente de aplicar.");
          return;
        }
        await refundOnlineOrder(order.id, order.refundable_payment_event_id, parsed.data.reason, operationKey);
      } else {
        const parsed = onlineOrderReasonSchema.safeParse({ reason: lifecycleReason });
        if (!parsed.success) {
          setLifecycleError(parsed.error.issues[0]?.message ?? "Indicá el motivo de la operación.");
          return;
        }
        await transitionOnlineOrder(
          order.id,
          kind === "cancelled" ? { orderState: "cancelled" } : { deliveryState: kind },
          parsed.data.reason,
          operationKey,
        );
      }
      setFeedback({ type: "success", message: `${actionTitle[kind]} registrado con trazabilidad.` });
      closeLifecycleAction();
      await fetchOrders();
    } catch (err: unknown) {
      setLifecycleError(toUserMessage(err, "No se pudo actualizar el pedido."));
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
        return !o.fulfilled && !isClosedOrder(o) && o.payment_state === "paid";
      case "pending":
        return !o.fulfilled && !isClosedOrder(o) && o.payment_state !== "paid";
      case "cancelled":
        return isClosedOrder(o);
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
  const paidCount = orders.filter((o) => !o.fulfilled && !isClosedOrder(o) && o.payment_state === "paid").length;
  const pendingCount = orders.filter((o) => !o.fulfilled && !isClosedOrder(o) && o.payment_state !== "paid").length;
  const closedCount = orders.filter((o) => isClosedOrder(o)).length;
  const paidRevenue = orders
    .filter((o) => o.payment_state === "paid" || o.fulfilled)
    .reduce((a, b) => a + Number(b.total_amount || 0), 0);

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Pedidos de la tienda online"
        description="Consulta y gestión de pedidos web: pago, preparación, despacho y cambios registrados."
        badge={`${orders.length} Pedidos`}
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
            { id: "paid", label: `Pagados para despachar (${paidCount})` },
            { id: "pending", label: `Pendientes (${pendingCount})` },
            { id: "fulfilled", label: `Despachados (${fulfilledCount})` },
            { id: "cancelled", label: `Cancelados / Reembolsados (${closedCount})` },
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
                  <th>Despacho</th>
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
                        <span className="flow-status-pill completed">{labelOf(SALE_PAYMENT_STATE_LABELS, "paid")}</span>
                      ) : order.payment_state === "partial" ? (
                        <span className="flow-status-pill processing">{labelOf(SALE_PAYMENT_STATE_LABELS, "partial")}</span>
                      ) : order.payment_state === "refunded" ? (
                        <StatusPill variant="rose">{labelOf(SALE_PAYMENT_STATE_LABELS, "refunded")}</StatusPill>
                      ) : order.payment_state === "unpaid" ? (
                        <span className="flow-status-pill pending">{labelOf(SALE_PAYMENT_STATE_LABELS, "unpaid")}</span>
                      ) : (
                        <span className="flow-status-pill pending">
                          {order.last_payment_status ? labelOf(WEB_PAYMENT_STATUS_LABELS, order.last_payment_status, "Sin eventos") : "Sin eventos"}
                        </span>
                      )}
                    </td>
                    <td>
                      {order.fulfilled ? (
                        <span className="flow-status-pill completed">Despachado</span>
                      ) : order.order_state === "cancelled" ? (
                        <StatusPill variant="rose">Cancelado</StatusPill>
                      ) : order.order_state === "refunded" ? (
                        <StatusPill variant="rose">Reembolsado</StatusPill>
                      ) : (
                        <span className="flow-status-pill pending">{deliveryLabel(order.delivery_state)}</span>
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
                            <CheckCircle2 size={12} /> Despachar
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
                Estado actual del pedido
              </span>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                {selectedOrder.order_state === "cancelled" || selectedOrder.order_state === "refunded" ? (
                  <StatusPill variant="rose">Pedido: {orderStateLabel(selectedOrder.order_state)}</StatusPill>
                ) : (
                  <span className={`flow-status-pill ${selectedOrder.fulfilled ? "completed" : "confirmed"}`}>
                    Pedido: {orderStateLabel(selectedOrder.order_state)}
                  </span>
                )}
                {selectedOrder.payment_state === "refunded" ? (
                  <StatusPill variant="rose">Pago: {paymentLabel(selectedOrder)}</StatusPill>
                ) : (
                  <span
                    className={`flow-status-pill ${
                      selectedOrder.payment_state === "paid"
                        ? "completed"
                        : selectedOrder.payment_state === "partial"
                          ? "processing"
                          : "pending"
                    }`}
                  >
                    Pago: {paymentLabel(selectedOrder)}
                  </span>
                )}
                <span className={`flow-status-pill ${selectedOrder.fulfilled ? "completed" : "pending"}`}>
                  Entrega: {selectedOrder.fulfilled ? "Despachado" : deliveryLabel(selectedOrder.delivery_state)}
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
                    <CheckCircle2 size={12} /> Despachar pedido
                  </button>
                )}
              </div>
              {selectedOrder.fulfilled && (selectedOrder.sale_id || selectedOrder.stock_document_id) && (
                <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "8px 0 0" }}>
                  {[
                    selectedOrder.sale_id ? `Venta ${shortId(selectedOrder.sale_id)}` : null,
                    selectedOrder.stock_document_id ? `Movimiento de stock ${shortId(selectedOrder.stock_document_id)}` : null,
                  ].filter(Boolean).join(" · ")}
                </p>
              )}
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
              <span className="stat-label" style={{ display: "block", marginBottom: "8px" }}>Historial de eventos</span>
              {selectedOrder.events.length === 0 ? (
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Todavía no hay eventos operativos registrados.</span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {selectedOrder.events.map((event) => {
                    const reasonText = formatEventReason(event.reason);
                    return (
                      <div key={event.id} style={{ display: "grid", gridTemplateColumns: "44px 1fr auto", gap: "8px", alignItems: "start", borderBottom: "1px solid var(--border-light)", paddingBottom: "8px" }}>
                        <span className="type-badge green" style={{ fontFamily: "monospace", fontSize: "10px" }}>#{event.event_sequence}</span>
                        <div>
                          <strong style={{ display: "block", fontSize: "12px" }}>
                            {eventLabel(event)}
                          </strong>
                          {reasonText && (
                            <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>{reasonText}</span>
                          )}
                          <span style={{ display: "block", fontSize: "10px", color: "var(--text-muted)" }}>
                            {event.actor_name ?? (event.actor_id ? `Usuario ${shortId(event.actor_id)}` : "Sistema")}
                          </span>
                        </div>
                        <span style={{ fontSize: "10px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{formatDateTime(event.occurred_at)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", background: "var(--canvas-bg)", padding: "12px", borderRadius: "10px" }}>
              <div>
                <span className="stat-label">Cliente</span>
                <strong style={{ display: "block", fontSize: "12px", marginTop: "2px" }}>
                  {customerDisplay(selectedOrder)}
                </strong>
              </div>
              <div>
                <span className="stat-label">Último pago (evento)</span>
                <span style={{ display: "block", fontSize: "12px", marginTop: "2px", fontWeight: 600 }}>
                  {selectedOrder.last_payment_status
                    ? labelOf(WEB_PAYMENT_STATUS_LABELS, selectedOrder.last_payment_status, "Sin eventos")
                    : "Sin eventos"}
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
                <span className="stat-label" style={{ marginBottom: "6px", display: "block" }}>Ítems comprados</span>
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
          title={`Despachar pedido ORD-${shortId(fulfillOrder.id)}`}
          subtitle={`Total ${formatCurrency(Number(fulfillOrder.total_amount || 0), "ARS")} • Registra venta, stock y asiento`}
          icon={CheckCircle2}
          maxWidth="520px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <FormError message={fulfillError} onDismiss={() => setFulfillError(null)} />
            <div>
              <label htmlFor="fulfill-payment-ref" style={{ fontSize: "12px", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                Referencia de pago (Mercado Pago) *
              </label>
              <input
                id="fulfill-payment-ref"
                type="text"
                className="flow-input"
                placeholder="Ej. 1234567890 (ID de pago aprobado)"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                disabled={fulfilling}
                style={{ width: "100%" }}
              />
              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "4px 0 0" }}>
                Requiere pago aprobado por el total y referencia coincidente con Mercado Pago.
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
                placeholder="Despacho de pedido online"
                value={operationReason}
                onChange={(e) => setOperationReason(e.target.value)}
                disabled={fulfilling}
                style={{ width: "100%" }}
              />
            </div>

            {fulfillResult && (
              <div style={{ background: "var(--canvas-bg)", padding: "12px", borderRadius: "10px", fontSize: "12px" }}>
                <strong style={{ display: "block", marginBottom: "6px" }}>Despacho completado:</strong>
                <span style={{ display: "block", fontFamily: "monospace" }}>Venta: {shortId(fulfillResult.sale_id)}</span>
                <span style={{ display: "block", fontFamily: "monospace" }}>Movimiento de stock: {shortId(fulfillResult.stock_document_id)}</span>
                <span style={{ display: "block", fontFamily: "monospace" }}>Asiento contable: {shortId(fulfillResult.journal_entry_id)}</span>
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
                  Confirmar despacho
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
            <FormError message={lifecycleError} onDismiss={() => setLifecycleError(null)} />
            <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
              La acción se valida según el estado actual y los permisos. El motivo queda registrado en el historial.
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
