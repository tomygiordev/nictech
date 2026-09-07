import { supabase } from "../../lib/supabase";
import { generateIdempotencyKey } from "../../lib/formatters";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

export const newOpKey = (prefix: string): string => generateIdempotencyKey(prefix);

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

export interface FulfillOnlineOrderResult {
  sale_id: string;
  stock_document_id: string;
  journal_entry_id: string;
}

/**
 * Lee los pedidos online ordenados por fecha de creación descendente.
 *
 * Mecanismo verificado contra DashboardOverview (L385-389): usa el cliente
 * ERP compartido (`supabase`) con `.from("orders")` sin calificador de schema.
 * NOTA: el cliente está creado con `db: { schema: "erp" }`
 * (apps/erp/src/lib/supabase.ts) mientras que `orders` vive en el schema
 * `public`. Se replica exactamente el mecanismo del dashboard; si PostgREST
 * no resuelve `erp.orders`, el error de la API se propaga al workspace y se
 * muestra tal cual en el StatePanel (sin swallowing).
 */
export const listOnlineOrders = async (): Promise<DbOrder[]> => {
  const { data, error } = await client()
    .from("orders")
    .select("id, payment_id, status, total, items, payer, created_at, stock_decremented, payment_method_id")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DbOrder[];
};

const parseResultId = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Respuesta inválida del fulfill: falta ${label}.`);
  }
  return value;
};

/**
 * Cumple un pedido online de forma transaccional (venta + remisión de stock +
 * asiento contable) vía RPC `fulfill_online_order`.
 *
 * Si el RPC aún no existe en la DB local, el error de PostgREST se propaga
 * tal cual para mostrarlo en el workspace. No se simula el fulfill.
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
