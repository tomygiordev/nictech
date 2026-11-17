import { supabase } from "../../lib/supabase";
import { generateIdempotencyKey } from "../../lib/formatters";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

export const newOpKey = (prefix: string): string => generateIdempotencyKey(prefix);

export interface WebOrderLineInfo {
  description: string;
  quantity: number;
  unit_price: number;
}

export interface WebOrderEventInfo {
  id: string;
  event_sequence: number;
  order_state: string | null;
  payment_state: string | null;
  delivery_state: string | null;
  reason: string;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string | null;
}

/**
 * Pedido online leído de la fuente real `erp.web_orders`.
 *
 * La cabecera NO tiene columnas de estado (`status`, `stock_decremented`,
 * `payment_id`, `items`, `payer` no existen en la migración
 * 202608190006_erp_sales_cash_orders.sql L351-378). El estado se deriva —
 * nunca se inventa — de:
 * - `erp.web_order_fulfillments` (cumplido: venta + remisión de stock), y
 * - el último `erp.web_order_events` por `event_sequence`
 *   (`order_state`, `payment_state`, `delivery_state`).
 */
export interface DbOrder {
  id: string;
  branch_id: string;
  customer_id: string | null;
  currency_code: string;
  total_amount: number;
  created_at: string;
  expires_at: string;
  reservation_batch_id: string | null;
  order_state: string | null;
  payment_state: string | null;
  delivery_state: string | null;
  fulfilled: boolean;
  sale_id: string | null;
  stock_document_id: string | null;
  fulfilled_at: string | null;
  last_payment_status: string | null;
  last_payment_amount: number | null;
  refundable_payment_event_id: string | null;
  lines: WebOrderLineInfo[];
  events: WebOrderEventInfo[];
}

export interface FulfillOnlineOrderResult {
  sale_id: string;
  stock_document_id: string;
  journal_entry_id: string;
}

interface WebOrderRow {
  id: string;
  branch_id: string;
  customer_id: string | null;
  currency_code: string;
  total_amount: number;
  created_at: string;
  expires_at: string;
  reservation_batch_id: string | null;
}

interface FulfillmentRow {
  web_order_id: string;
  sale_id: string;
  stock_document_id: string;
  fulfilled_at: string;
}

interface OrderEventRow {
  id: string;
  web_order_id: string;
  order_state: string | null;
  payment_state: string | null;
  delivery_state: string | null;
  event_sequence: number;
  occurred_at: string;
  reason: string;
  actor_id: string | null;
}

interface OrderLineRow {
  web_order_id: string;
  description: string;
  quantity: number;
  unit_price: number;
}

interface PaymentEventRow {
  id: string;
  web_order_id: string;
  status: string;
  amount: number | null;
  received_at: string;
  applied: boolean;
}

interface ProfileRow {
  id: string;
  display_name: string;
}

/**
 * Lee los pedidos online desde `erp.web_orders` (columnas reales) y deriva
 * el estado desde fulfillment + último evento. Las columnas de
 * `web_payment_events` usadas (`status`, `amount`) están dentro del grant
 * por columna a `authenticated` (migración base L2344-2347).
 */
export const listOnlineOrders = async (): Promise<DbOrder[]> => {
  const { data: orderRows, error: ordersError } = await client()
    .from("web_orders")
    .select("id, branch_id, customer_id, currency_code, total_amount, created_at, expires_at, reservation_batch_id")
    .order("created_at", { ascending: false });
  if (ordersError) throw ordersError;
  const orders = ((orderRows ?? []) as WebOrderRow[]);
  if (orders.length === 0) return [];

  const ids = orders.map((o) => o.id);

  const { data: fulfillmentRows, error: fulfillError } = await client()
    .from("web_order_fulfillments")
    .select("web_order_id, sale_id, stock_document_id, fulfilled_at")
    .in("web_order_id", ids);
  if (fulfillError) throw fulfillError;

  const { data: eventRows, error: eventsError } = await client()
    .from("web_order_events")
    .select("id, web_order_id, order_state, payment_state, delivery_state, event_sequence, occurred_at, reason, actor_id")
    .in("web_order_id", ids)
    .order("event_sequence", { ascending: false });
  if (eventsError) throw eventsError;

  const { data: lineRows, error: linesError } = await client()
    .from("web_order_lines")
    .select("web_order_id, description, quantity, unit_price")
    .in("web_order_id", ids);
  if (linesError) throw linesError;

  const { data: paymentRows, error: paymentsError } = await client()
    .from("web_payment_events")
    .select("id, web_order_id, status, amount, received_at, applied")
    .in("web_order_id", ids)
    .order("received_at", { ascending: false });
  if (paymentsError) throw paymentsError;

  const actorIds = [...new Set(((eventRows ?? []) as OrderEventRow[])
    .map((event) => event.actor_id)
    .filter((actorId): actorId is string => actorId !== null))];
  const actorNameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profileRows, error: profilesError } = await client()
      .from("profiles")
      .select("id, display_name")
      .in("id", actorIds);
    if (profilesError) throw profilesError;
    for (const profile of (profileRows ?? []) as ProfileRow[]) {
      actorNameById.set(profile.id, profile.display_name);
    }
  }

  const fulfillByOrder = new Map<string, FulfillmentRow>();
  for (const f of ((fulfillmentRows ?? []) as FulfillmentRow[])) {
    if (!fulfillByOrder.has(f.web_order_id)) fulfillByOrder.set(f.web_order_id, f);
  }

  const latestOrderStateByOrder = new Map<string, string | null>();
  const latestPaymentStateByOrder = new Map<string, string | null>();
  const latestDeliveryStateByOrder = new Map<string, string | null>();
  const eventsByOrder = new Map<string, WebOrderEventInfo[]>();
  for (const e of ((eventRows ?? []) as OrderEventRow[])) {
    if (e.order_state !== null && !latestOrderStateByOrder.has(e.web_order_id)) {
      latestOrderStateByOrder.set(e.web_order_id, e.order_state);
    }
    if (e.payment_state !== null && !latestPaymentStateByOrder.has(e.web_order_id)) {
      latestPaymentStateByOrder.set(e.web_order_id, e.payment_state);
    }
    if (e.delivery_state !== null && !latestDeliveryStateByOrder.has(e.web_order_id)) {
      latestDeliveryStateByOrder.set(e.web_order_id, e.delivery_state);
    }
    const list = eventsByOrder.get(e.web_order_id) ?? [];
    list.push({
      id: e.id,
      event_sequence: Number(e.event_sequence),
      order_state: e.order_state,
      payment_state: e.payment_state,
      delivery_state: e.delivery_state,
      reason: e.reason,
      occurred_at: e.occurred_at,
      actor_id: e.actor_id,
      actor_name: e.actor_id ? actorNameById.get(e.actor_id) ?? null : null,
    });
    eventsByOrder.set(e.web_order_id, list);
  }

  const linesByOrder = new Map<string, WebOrderLineInfo[]>();
  for (const l of ((lineRows ?? []) as OrderLineRow[])) {
    const list = linesByOrder.get(l.web_order_id) ?? [];
    list.push({ description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price) });
    linesByOrder.set(l.web_order_id, list);
  }

  const latestPaymentByOrder = new Map<string, PaymentEventRow>();
  const refundablePaymentByOrder = new Map<string, PaymentEventRow>();
  for (const p of ((paymentRows ?? []) as PaymentEventRow[])) {
    if (!latestPaymentByOrder.has(p.web_order_id)) latestPaymentByOrder.set(p.web_order_id, p);
    if (p.status === "refunded" && !p.applied && !refundablePaymentByOrder.has(p.web_order_id)) {
      refundablePaymentByOrder.set(p.web_order_id, p);
    }
  }

  return orders.map((o) => {
    const fulfillment = fulfillByOrder.get(o.id) ?? null;
    const latestPayment = latestPaymentByOrder.get(o.id) ?? null;
    const currentOrderState = latestOrderStateByOrder.get(o.id) ?? null;
    return {
      id: o.id,
      branch_id: o.branch_id,
      customer_id: o.customer_id,
      currency_code: o.currency_code,
      total_amount: Number(o.total_amount),
      created_at: o.created_at,
      expires_at: o.expires_at,
      reservation_batch_id: o.reservation_batch_id,
      order_state: currentOrderState,
      payment_state: latestPaymentStateByOrder.get(o.id) ?? null,
      delivery_state: latestDeliveryStateByOrder.get(o.id) ?? null,
      fulfilled: currentOrderState === "fulfilled",
      sale_id: fulfillment?.sale_id ?? null,
      stock_document_id: fulfillment?.stock_document_id ?? null,
      fulfilled_at: fulfillment?.fulfilled_at ?? null,
      last_payment_status: latestPayment?.status ?? null,
      last_payment_amount: latestPayment?.amount == null ? null : Number(latestPayment.amount),
      refundable_payment_event_id: refundablePaymentByOrder.get(o.id)?.id ?? null,
      lines: linesByOrder.get(o.id) ?? [],
      events: eventsByOrder.get(o.id) ?? [],
    };
  });
};

const parseResultId = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Respuesta inválida del fulfill: falta ${label}.`);
  }
  return value;
};

/**
 * Cumple un pedido online de forma transaccional (venta + remisión de stock +
 * asiento contable) vía RPC `erp.fulfill_online_order(target_order_id,
 * payment_reference, operation_key, operation_reason)` — verificado en
 * `202609070012_erp_fulfill_online_order.sql` (devuelve
 * `{sale_id, stock_document_id, journal_entry_id}`, grant a `authenticated`).
 *
 * Si el RPC falla, el error de PostgREST se propaga tal cual para mostrarlo
 * en el workspace. No se simula el fulfill.
 */
export const fulfillOnlineOrder = async (
  orderId: string,
  paymentReference: string,
  operationReason: string,
  operationKey: string,
): Promise<FulfillOnlineOrderResult> => {
  if (!orderId || orderId.trim() === "") {
    throw new Error("El ID del pedido es obligatorio para cumplir la orden.");
  }
  if (!paymentReference || paymentReference.trim() === "") {
    throw new Error("La referencia de pago (MercadoPago) es obligatoria.");
  }
  const { data, error } = await client().rpc("fulfill_online_order", {
    target_order_id: orderId,
    payment_reference: paymentReference.trim(),
    operation_key: operationKey,
    operation_reason: operationReason.trim(),
  });
  if (error) throw error;
  const payload = data as { sale_id?: unknown; stock_document_id?: unknown; journal_entry_id?: unknown } | null;
  if (!payload || typeof payload !== "object") {
    throw new Error("Respuesta inválida del fulfill: se esperaba {sale_id, stock_document_id, journal_entry_id}.");
  }
  return {
    sale_id: parseResultId(payload.sale_id, "sale_id"),
    stock_document_id: parseResultId(payload.stock_document_id, "stock_document_id"),
    journal_entry_id: parseResultId(payload.journal_entry_id, "journal_entry_id"),
  };
};

export type OnlineOrderTransition =
  | { orderState: "confirmed" | "cancelled"; deliveryState?: never }
  | { orderState?: never; deliveryState: "preparing" | "ready" | "delivered" };

export const transitionOnlineOrder = async (
  orderId: string,
  transition: OnlineOrderTransition,
  operationReason: string,
  operationKey: string,
): Promise<string> => {
  const { data, error } = await client().rpc("record_web_order_event", {
    target_web_order_id: orderId,
    target_order_state: (transition.orderState ?? null) as string,
    target_delivery_state: (transition.deliveryState ?? null) as
      | "pending"
      | "preparing"
      | "ready"
      | "dispatched"
      | "delivered"
      | "returned",
    operation_key: operationKey,
    operation_reason: operationReason.trim(),
  });
  if (error) throw error;
  return parseResultId(data, "event_id");
};

export interface RefundOnlineOrderResult {
  refund_id: string;
  sale_id: string;
  stock_reversal_document_id: string;
  journal_reversal_entry_id: string;
  payment_reversal_ids: unknown;
  idempotent: boolean;
}

export const refundOnlineOrder = async (
  orderId: string,
  refundPaymentEventId: string,
  operationReason: string,
  operationKey: string,
): Promise<RefundOnlineOrderResult> => {
  const { data, error } = await client().rpc("refund_fulfilled_online_order", {
    target_web_order_id: orderId,
    target_refund_payment_event_id: refundPaymentEventId,
    physical_return_confirmed: true,
    operation_key: operationKey,
    operation_reason: operationReason.trim(),
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Respuesta inválida del reembolso online.");
  }
  const payload = data as Record<string, unknown>;
  return {
    refund_id: parseResultId(payload.refund_id, "refund_id"),
    sale_id: parseResultId(payload.sale_id, "sale_id"),
    stock_reversal_document_id: parseResultId(payload.stock_reversal_document_id, "stock_reversal_document_id"),
    journal_reversal_entry_id: parseResultId(payload.journal_reversal_entry_id, "journal_reversal_entry_id"),
    payment_reversal_ids: payload.payment_reversal_ids,
    idempotent: payload.idempotent === true,
  };
};
