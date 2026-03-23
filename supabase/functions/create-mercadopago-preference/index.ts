import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://nictech.vercel.app",
  "https://www.nictech.vercel.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

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
    dni?: string;
    address?: string;
  };
  origin?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!accessToken) {
      console.error("MERCADOPAGO_ACCESS_TOKEN not configured");
      throw new Error("MercadoPago access token not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: RequestBody = await req.json();

    // Validate request body structure
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      throw new Error("No items provided");
    }

    if (body.items.length > 50) {
      throw new Error("Too many items in cart");
    }

    // Validate each item has required fields
    for (const item of body.items) {
      if (!item.id || typeof item.id !== "string") {
        throw new Error("Item ID inválido");
      }
      if (!item.quantity || typeof item.quantity !== "number" || item.quantity < 1 || !Number.isInteger(item.quantity)) {
        throw new Error(`Cantidad inválida para ${item.name || "producto"}`);
      }
    }

    // Validate payer data if provided
    if (body.payer) {
      if (body.payer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.payer.email)) {
        throw new Error("Email inválido");
      }
      if (body.payer.dni) {
        const cleanDni = body.payer.dni.replace(/[.\s-]/g, "");
        if (!/^\d{7,8}$/.test(cleanDni)) {
          throw new Error("DNI inválido");
        }
        body.payer.dni = cleanDni;
      }
    }

    // ==========================================
    // SECURITY VALIDATION: Fetch real prices
    // ==========================================
    const itemIds = body.items.map((i) => i.id);
    const { data: dbProducts, error: dbError } = await supabase
      .from("products")
      .select("id, name, price, stock")
      .in("id", itemIds);

    if (dbError || !dbProducts) {
      throw new Error("Error comprobando el inventario");
    }

    const dbProductsMap = new Map(dbProducts.map((p) => [p.id, p]));

    // Validate that items requested still exist and have enough stock
    for (const item of body.items) {
      const realProduct = dbProductsMap.get(item.id);
      if (!realProduct) {
        throw new Error(`El producto ${item.name} ya no está disponible`);
      }
      if (item.quantity > realProduct.stock) {
        throw new Error(`Stock insuficiente para ${item.name}. Solo quedan ${realProduct.stock}`);
      }
      // Re-assign the REAL price from DB completely overwriting the frontend price
      item.price = realProduct.price;
      item.name = realProduct.name; // enforce real name to avoid invoice tampering
    }
    // ==========================================

    // Get origin from body or headers
    let origin = body.origin || req.headers.get("origin") || "";

    // Remove trailing slash if present
    if (origin.endsWith("/")) {
      origin = origin.slice(0, -1);
    }

    // Validate origin: only accept HTTPS in production, allow localhost for dev
    const validOrigin = (origin && (origin.startsWith("https://") || origin.startsWith("http://localhost")))
      ? origin
      : "https://nictech.vercel.app";

    // IMPORTANT: Mercado Pago sometimes dislikes localhost for auto_return
    // We strictly format the back_urls here.

    // Ensure payer email is present if payer object exists
    const payerData = (body.payer && body.payer.email) ? {
      name: body.payer.name,
      email: body.payer.email,
      phone: body.payer.phone ? { area_code: "", number: body.payer.phone } : undefined,
      identification: body.payer.dni ? { type: "DNI", number: body.payer.dni } : undefined,
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
        success: `${validOrigin}/checkout?payment=success`,
        failure: `${validOrigin}/checkout?payment=failure`,
        pending: `${validOrigin}/checkout?payment=pending`,
      },
      payer: payerData,
      auto_return: validOrigin.includes("localhost") ? undefined : "approved",
      statement_descriptor: "NICTECH",
      external_reference: `order-${Date.now()}`,
      notification_url: "https://tuzpcofywkhglkqplhnn.supabase.co/functions/v1/mercadopago-webhook",
      metadata: {
        // redundant but useful for easy access in webhook without parsing description
        items: JSON.stringify(body.items.map(i => ({ id: i.id, quantity: i.quantity }))),
        payer_dni: body.payer?.dni || "",
        payer_phone: body.payer?.phone || "",
        payer_address: body.payer?.address || ""
      }
    };

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
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";
    console.error("Error in create-mercadopago-preference:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
