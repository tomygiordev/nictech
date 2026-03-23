import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://nictech.vercel.app",
  "https://www.nictech.vercel.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

function getCorsHeaders(req?: Request) {
  const origin = req?.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const url = new URL(req.url);
    const topic = url.searchParams.get("topic") || url.searchParams.get("type");
    const id = url.searchParams.get("id") || url.searchParams.get("data.id");

    // We only care about payments
    if (topic !== "payment") {
      // Check body just in case it's a JSON payload
      try {
        const body = await req.json();
        if (body.type === "payment" && body.data && body.data.id) {
          return processPayment(body.data.id, req);
        }
      } catch (e) {
        // ignore JSON parse error, likely query params only
      }

      if (!id) {
        return new Response("Ignored", { status: 200, headers: getCorsHeaders(req) });
      }
    }

    if (id) {
      return processPayment(id, req);
    }

    return new Response("OK", { status: 200, headers: getCorsHeaders(req) });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: getCorsHeaders(req) });
  }
});

async function processPayment(paymentId: string, req: Request) {
  const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Fetch payment info from Mercado Pago
  const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      "Authorization": `Bearer ${accessToken}`
    }
  });

  if (!mpResponse.ok) {
    throw new Error("Failed to fetch payment");
  }

  const paymentData = await mpResponse.json();

  // 2. Extract relevant info
  const status = paymentData.status; // e.g. approved, pending, rejected
  const total = paymentData.transaction_amount;
  const items = paymentData.additional_info?.items || [];
  const payer = paymentData.payer;
  const metadata = paymentData.metadata || {};

  // 3. Upsert order in Supabase
  // Use payment_id as unique key to avoid duplicates
  // First, check if order already exists to see if we already decremented stock
  const { data: existingOrder } = await supabase
    .from("orders")
    .select("stock_decremented")
    .eq("payment_id", String(paymentId))
    .single();

  const stockAlreadyDecremented = existingOrder?.stock_decremented || false;

  // Set stock_decremented = true atomically in the upsert BEFORE actually decrementing
  // This prevents double-decrement if two webhooks arrive simultaneously
  const shouldDecrementStock = status === "approved" && !stockAlreadyDecremented;

  const { error: dbError } = await supabase
    .from("orders")
    .upsert({
      payment_id: String(paymentId),
      status: status,
      total: total,
      items: items,
      payer: payer,
      updated_at: new Date().toISOString(),
      stock_decremented: stockAlreadyDecremented || shouldDecrementStock,
    }, { onConflict: "payment_id" });

  if (dbError) {
    console.error("Error saving order:", dbError);
    throw dbError;
  }

  // 4. Decrement stock if approved AND we haven't already decremented for this order
  if (shouldDecrementStock) {
    // Re-check from DB to handle race condition: if another webhook already set it to true, skip
    const { data: recheckOrder } = await supabase
      .from("orders")
      .select("stock_decremented")
      .eq("payment_id", String(paymentId))
      .single();

    // Only proceed if we are the first to mark it
    if (recheckOrder?.stock_decremented) {
      let itemsToProcess = items;
      if (items.length === 0 && metadata.items) {
        try {
          itemsToProcess = JSON.parse(metadata.items);
        } catch (e) {
          // Invalid metadata items format
        }
      }

      for (const item of itemsToProcess) {
        if (item.id) {
          const { error: rpcError } = await supabase.rpc('decrement_stock', {
            row_id: item.id,
            qty: Number(item.quantity)
          });

          if (rpcError) {
            console.error(`Error decrementing stock for product ${item.id}:`, rpcError);
          }
        }
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    status: 200
  });
}
