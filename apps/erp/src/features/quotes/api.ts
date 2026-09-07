import { supabase } from "../../lib/supabase";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

export interface QuoteOverview {
  id: string;
  repair_order_id: string;
  order_code: string;
  customer_name: string;
  customer_phone: string | null;
  version: number;
  currency_code: string;
  subtotal_amount: number;
  tax_amount: number;
  total_amount: number;
  issued_at: string | null;
  expires_at: string | null;
  created_at: string;
  decision: "approved" | "rejected" | null;
  decision_at: string | null;
  lines: QuoteLineRecord[];
}

export interface QuoteLineRecord {
  id: string;
  line_number: number;
  kind: "product" | "service" | "free_concept";
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate_percent: number;
  tax_amount: number;
  line_total: number;
}

export interface CreateQuoteInput {
  repairOrderId: string;
  currencyCode?: string;
  lines: Array<{
    kind: "product" | "service" | "free_concept";
    product_id?: string;
    variant_id?: string;
    description: string;
    quantity: number;
    unit_price: number;
    unit_cost?: number;
    tax_rate_percent?: number;
  }>;
  reason?: string;
}

export const listQuotes = async (): Promise<QuoteOverview[]> => {
  const { data, error } = await client()
    .from("repair_quotes")
    .select(`
      id,
      repair_order_id,
      version,
      currency_code,
      subtotal_amount,
      tax_amount,
      total_amount,
      issued_at,
      expires_at,
      created_at,
      repair_orders (
        order_code,
        customers ( display_name, phone )
      ),
      repair_quote_lines (
        id,
        line_number,
        kind,
        description,
        quantity,
        unit_price,
        tax_rate_percent,
        tax_amount,
        line_total
      )
    `)
    .order("created_at", { ascending: false });

  if (error) throw error;

  // Also fetch decisions from response events
  const { data: responses } = await client()
    .from("repair_quote_response_events")
    .select("quote_id, decision, occurred_at");

  const decisionMap = new Map<string, { decision: "approved" | "rejected"; at: string }>();
  (responses || []).forEach((r: any) => {
    decisionMap.set(r.quote_id, { decision: r.decision, at: r.occurred_at });
  });

  return (data || []).map((q: any) => {
    const dec = decisionMap.get(q.id);
    return {
      id: q.id,
      repair_order_id: q.repair_order_id,
      order_code: q.repair_orders?.order_code ?? "—",
      customer_name: q.repair_orders?.customers?.display_name ?? "Cliente Taller",
      customer_phone: q.repair_orders?.customers?.phone ?? null,
      version: q.version,
      currency_code: q.currency_code,
      subtotal_amount: Number(q.subtotal_amount),
      tax_amount: Number(q.tax_amount),
      total_amount: Number(q.total_amount),
      issued_at: q.issued_at,
      expires_at: q.expires_at,
      created_at: q.created_at,
      decision: dec?.decision ?? null,
      decision_at: dec?.at ?? null,
      lines: (q.repair_quote_lines || []).map((l: any) => ({
        id: l.id,
        line_number: l.line_number,
        kind: l.kind,
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        tax_rate_percent: Number(l.tax_rate_percent),
        tax_amount: Number(l.tax_amount),
        line_total: Number(l.line_total),
      })),
    };
  });
};

export const createRepairQuote = async (input: CreateQuoteInput): Promise<string> => {
  const currency = input.currencyCode || "ARS";

  // Find active exchange rate snapshot for currency
  let { data: snapshots } = await client()
    .from("exchange_rate_snapshots")
    .select("id")
    .eq("quote_currency", currency)
    .order("quoted_at", { ascending: false })
    .limit(1);

  if (!snapshots || snapshots.length === 0) {
    const rate = currency === "ARS" ? 1 : 1250;
    const opKey = `fx-auto-${currency.toLowerCase()}-${Date.now()}`;
    await client().rpc("capture_exchange_rate", {
      target_quote_currency: currency,
      captured_rate_to_base: rate,
      rate_source: "manual-system",
      quote_time: new Date().toISOString(),
      operation_key: opKey,
      operation_reason: "Auto-captura de tipo de cambio para presupuestos",
    });

    const { data: retrySnapshots } = await client()
      .from("exchange_rate_snapshots")
      .select("id")
      .eq("quote_currency", currency)
      .order("quoted_at", { ascending: false })
      .limit(1);
    snapshots = retrySnapshots;
  }

  if (!snapshots || snapshots.length === 0) {
    throw new Error(`No hay una cotización FX registrada para la moneda ${currency}.`);
  }

  const snapshotId = snapshots[0].id;
  const opKey = `quote-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const formattedLines = input.lines.map((l) => ({
    kind: l.kind,
    product_id: l.product_id || null,
    variant_id: l.variant_id || null,
    description: l.description.trim(),
    quantity: l.quantity,
    unit_price: l.unit_price,
    unit_cost: l.unit_cost !== undefined ? l.unit_cost : 0,
    tax_rate_percent: l.tax_rate_percent !== undefined ? l.tax_rate_percent : 21,
  }));

  const { data, error } = await client().rpc("create_repair_quote_version", {
    target_repair_order_id: input.repairOrderId,
    quote_currency: currency,
    target_exchange_snapshot_id: snapshotId,
    lines: formattedLines,
    operation_key: opKey,
    operation_reason: input.reason || "Emisión de cotización formal",
  });

  if (error) throw error;
  return data as string;
};

export const issueRepairQuote = async (quoteId: string): Promise<{ quote_id: string; response_token: string }> => {
  const opKey = `quote-issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const expiresAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await client().rpc("issue_repair_quote", {
    target_quote_id: quoteId,
    expires_at: expiresAt,
    operation_key: opKey,
    operation_reason: "Emisión de presupuesto para cliente",
  });

  if (error) throw error;
  return data as { quote_id: string; response_token: string };
};

export const respondQuoteDecision = async (
  quoteId: string,
  decision: "approved" | "rejected",
  notes?: string
): Promise<string> => {
  const { data, error } = await client().rpc("respond_quote_direct", {
    target_quote_id: quoteId,
    decision,
    customer_message: notes || null,
  });

  if (error) throw error;
  return data as string;
};
