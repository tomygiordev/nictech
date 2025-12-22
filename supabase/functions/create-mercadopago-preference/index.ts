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

    // Build MercadoPago preference
    const preference = {
      items: body.items.map((item) => ({
        id: item.id,
        title: item.name,
        quantity: item.quantity,
        unit_price: item.price,
        currency_id: "ARS",
        picture_url: item.image_url || undefined,
      })),
      payer: body.payer ? {
        name: body.payer.name || "",
        email: body.payer.email || "",
        phone: body.payer.phone ? { number: body.payer.phone } : undefined,
      } : undefined,
      back_urls: {
        success: `${req.headers.get("origin")}/tienda?payment=success`,
        failure: `${req.headers.get("origin")}/tienda?payment=failure`,
        pending: `${req.headers.get("origin")}/tienda?payment=pending`,
      },
      auto_return: "approved",
      payment_methods: {
        excluded_payment_types: [],
        installments: 12,
        default_installments: 1,
      },
      statement_descriptor: "NICTECH",
      external_reference: `order-${Date.now()}`,
    };

    console.log("Creating MercadoPago preference:", JSON.stringify(preference));

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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
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
