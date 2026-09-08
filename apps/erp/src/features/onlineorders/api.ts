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
  lines: WebOrderLineInfo[];
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
  web_order_id: string;
  order_state: string | null;
  payment_state: string | null;
  delivery_state: string | null;
  event_sequence: number;
  occurred_at: string;
}

interface OrderLineRow {
  web_order_id: string;
  description: string;
  quantity: number;
  unit_price: number;
}

interface PaymentEventRow {
  web_order_id: string;
  status: string;
  amount: number | null;
  received_at: string;
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
    .select("web_order_id, order_state, payment_state, delivery_state, event_sequence, occurred_at")
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
    .select("web_order_id, status, amount, received_at")
    .in("web_order_id", ids)
    .order("received_at", { ascending: false });
  if (paymentsError) throw paymentsError;

  const fulfillByOrder = new Map<string, FulfillmentRow>();
  for (const f of ((fulfillmentRows ?? []) as FulfillmentRow[])) {
    if (!fulfillByOrder.has(f.web_order_id)) fulfillByOrder.set(f.web_order_id, f);
  }

  const latestEventByOrder = new Map<string, OrderEventRow>();
  for (const e of ((eventRows ?? []) as OrderEventRow[])) {
    if (!latestEventByOrder.has(e.web_order_id)) latestEventByOrder.set(e.web_order_id, e);
  }

  const linesByOrder = new Map<string, WebOrderLineInfo[]>();
  for (const l of ((lineRows ?? []) as OrderLineRow[])) {
    const list = linesByOrder.get(l.web_order_id) ?? [];
    list.push({ description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price) });
    linesByOrder.set(l.web_order_id, list);
  }

  const latestPaymentByOrder = new Map<string, PaymentEventRow>();
  for (const p of ((paymentRows ?? []) as PaymentEventRow[])) {
    if (!latestPaymentByOrder.has(p.web_order_id)) latestPaymentByOrder.set(p.web_order_id, p);
  }

  return orders.map((o) => {
    const fulfillment = fulfillByOrder.get(o.id) ?? null;
    const latestEvent = latestEventByOrder.get(o.id) ?? null;
    const latestPayment = latestPaymentByOrder.get(o.id) ?? null;
    return {
      id: o.id,
      branch_id: o.branch_id,
      customer_id: o.customer_id,
      currency_code: o.currency_code,
      total_amount: Number(o.total_amount),
      created_at: o.created_at,
      expires_at: o.expires_at,
      reservation_batch_id: o.reservation_batch_id,
      order_state: latestEvent?.order_state ?? null,
      payment_state: latestEvent?.payment_state ?? null,
      delivery_state: latestEvent?.delivery_state ?? null,
      fulfilled: fulfillment !== null || latestEvent?.order_state === "fulfilled",
      sale_id: fulfillment?.sale_id ?? null,
      stock_document_id: fulfillment?.stock_document_id ?? null,
      fulfilled_at: fulfillment?.fulfilled_at ?? null,
      last_payment_status: latestPayment?.status ?? null,
      last_payment_amount: latestPayment?.amount == null ? null : Number(latestPayment.amount),
      lines: linesByOrder.get(o.id) ?? [],
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
    operation_key: newOpKey("fulfill-"),
    operation_reason: operationReason.trim() === "" ? "Cumplimiento de pedido online" : operationReason.trim(),
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
