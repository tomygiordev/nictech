import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const topic = url.searchParams.get("topic") || url.searchParams.get("type");
    const id = url.searchParams.get("id") || url.searchParams.get("data.id");

    console.log(`Received webhook: topic=${topic}, id=${id}`);

    // We only care about payments
    if (topic !== "payment") {
      // Check body just in case it's a JSON payload
      try {
        const body = await req.json();
        console.log("Webhook body:", body);
        if (body.type === "payment" && body.data && body.data.id) {
          return processPayment(body.data.id);
        }
      } catch (e) {
        // ignore JSON parse error, likely query params only
      }

      if (!id) {
        return new Response("Ignored", { status: 200, headers: corsHeaders });
      }
    }

    if (id) {
      return processPayment(id);
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
});

async function processPayment(paymentId: string) {
  console.log(`Processing payment ${paymentId}`);

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
    console.error("Error fetching payment from MP");
    throw new Error("Failed to fetch payment");
  }

  const paymentData = await mpResponse.json();
  console.log("Payment status:", paymentData.status);

  // 2. Extract relevant info
  const status = paymentData.status; // a.g. approved, pending, rejected
  const total = paymentData.transaction_amount;
  const items = paymentData.additional_info?.items || [];
  const payer = paymentData.payer;
  const metadata = paymentData.metadata || {};

  // 3. Upsert order in Supabase
  // We use payment_id as unique key to avoid duplicates
  const { error: dbError } = await supabase
    .from("orders")
    .upsert({
      payment_id: String(paymentId),
      status: status,
      total: total,
      items: items, // or metadata.items if MP strips it
      payer: payer,
      updated_at: new Date().toISOString()
    }, { onConflict: "payment_id" });

  if (dbError) {
    console.error("Error saving order:", dbError);
    throw dbError;
  }

  // 4. Dec Stock if approved
  if (status === "approved") {
    console.log("Payment approved, updating stock...");

    // We parse items from metadata if additional_info is empty (sometimes happens)
    let itemsToProcess = items;
    if (items.length === 0 && metadata.items) {
      try {
        itemsToProcess = JSON.parse(metadata.items);
      } catch (e) {
        console.error("Error parsing metadata items:", e);
      }
    }

    for (const item of itemsToProcess) {
      // If item has an ID (it should), decrement stock
      if (item.id) {
        // We use a stored procedure or direct update. 
        // Direct update is risky for concurrency but fine for this scale.
        // Better: "rpc" call to decrement specific row, but let's try direct update first checking current stock

        // Simplest approach: supabase.rpc ideally, but let's do fetch-then-update for now or assume simple decrement
        // Actually, SQL `update products set stock = stock - quantity where id = ...` is best but Supabase JS client 
        // doesn't support relative updates easily without RPC.

        // Let's create a simple RPC in the next step if needed, but for now we can fetch and update

        const { data: product } = await supabase
          .from("products")
          .select("stock")
          .eq("id", item.id)
          .single();

        if (product) {
          const newStock = Math.max(0, product.stock - Number(item.quantity));
          await supabase
            .from("products")
            .update({ stock: newStock })
            .eq("id", item.id);
          console.log(`Updated stock for ${item.id}: ${product.stock} -> ${newStock}`);
        }
      }
    }
  }

  console.log("Order saved successfully");
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200
  });
}
