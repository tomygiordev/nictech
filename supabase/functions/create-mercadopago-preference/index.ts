import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image_url?: string;
}

interface RequestBody {
  items: CartItem[];
  payer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  origin?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!accessToken) {
      console.error("MERCADOPAGO_ACCESS_TOKEN not configured");
      throw new Error("MercadoPago access token not configured");
    }

    const body: RequestBody = await req.json();
    console.log("Received request body:", JSON.stringify(body));

    if (!body.items || body.items.length === 0) {
      throw new Error("No items provided");
    }

    // Get origin from body or headers
    let origin = body.origin || req.headers.get("origin") || "";

    // Remove trailing slash if present
    if (origin.endsWith("/")) {
      origin = origin.slice(0, -1);
    }

    console.log("Using origin:", origin);

    // Validate origin but proceed with fallback if needed for testing
    const validOrigin = (origin && origin.startsWith("http")) ? origin : "https://www.google.com";

    // IMPORTANT: Mercado Pago sometimes dislikes localhost for auto_return
    // We strictly format the back_urls here.

    // Ensure payer email is present if payer object exists
    const payerData = (body.payer && body.payer.email) ? {
      name: body.payer.name,
      email: body.payer.email,
    } : undefined;

    // Build MercadoPago preference - MINIMAL DEBUG VERSION
    const preference = {
      items: body.items.map((item) => ({
        id: item.id,
        title: item.name,
        currency_id: "ARS",
        picture_url: item.image_url || undefined,
        description: item.name,
        category_id: "others",
        quantity: Number(item.quantity),
        unit_price: Number(item.price)
      })),
      back_urls: {
        success: "https://www.google.com",
        failure: "https://www.google.com",
        pending: "https://www.google.com",
      },
      payer: payerData,
      auto_return: "approved",
      statement_descriptor: "NICTECH",
      external_reference: `order-${Date.now()}`,
      notification_url: "https://tuzpcofywkhglkqplhnn.supabase.co/functions/v1/mercadopago-webhook",
      metadata: {
        // redundant but useful for easy access in webhook without parsing description
        items: JSON.stringify(body.items.map(i => ({ id: i.id, quantity: i.quantity })))
      }
    };

    console.log("PAYLOAD TO MP:", JSON.stringify(preference, null, 2));

    // Create preference via MercadoPago API
    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify(preference),
    });

    const mpData = await mpResponse.json();
    console.log("MercadoPago response:", JSON.stringify(mpData));

    if (!mpResponse.ok) {
      console.error("MercadoPago API error:", mpData);
      throw new Error(mpData.message || "Error creating payment preference");
    }

    return new Response(
      JSON.stringify({
        id: mpData.id,
        init_point: mpData.init_point,
        sandbox_init_point: mpData.sandbox_init_point,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";
    console.error("Error in create-mercadopago-preference:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
