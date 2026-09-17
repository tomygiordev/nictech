import { createClient } from "supabase";
import {
  aggregateCartItems,
  assertUuid,
  encodeMercadoPagoItemId,
  validateCatalogItems,
  type ProductRecord,
  type ValidatedCheckoutItem,
  type VariantRecord,
} from "./domain.ts";

const DEFAULT_ORIGINS = [
  "https://nictech.vercel.app",
  "https://www.nictech.vercel.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

interface PayerData {
  name: string;
  email: string;
  phone: string;
  dni: string;
  address: string;
}

interface RequestBody {
  checkout_id?: unknown;
  items?: unknown;
  payer?: unknown;
  origin?: unknown;
}

function getAllowedOrigins(): string[] {
  const configured = Deno.env.get("STOREFRONT_ALLOWED_ORIGINS")
    ?.split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_ORIGINS;
}

function getCorsHeaders(req: Request): Record<string, string> {
  const allowedOrigins = getAllowedOrigins();
  const requestOrigin = req.headers.get("origin")?.replace(/\/$/, "") ?? "";
  const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(req: Request, body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function requireEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`${name} no está configurado`);
  }
  return value;
}

function parsePayer(value: unknown): PayerData {
  if (!value || typeof value !== "object") {
    throw new Error("Faltan los datos del comprador");
  }

  const payer = value as Record<string, unknown>;
  const field = (name: keyof PayerData, maxLength: number): string => {
    const raw = payer[name];
    if (typeof raw !== "string" || !raw.trim() || raw.trim().length > maxLength) {
      throw new Error(`Dato de comprador inválido: ${name}`);
    }
    return raw.trim();
  };

  const parsed = {
    name: field("name", 120),
    email: field("email", 254).toLowerCase(),
    phone: field("phone", 40),
    dni: field("dni", 20).replace(/[.\s-]/g, ""),
    address: field("address", 300),
  };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email)) {
    throw new Error("Email inválido");
  }
  if (!/^\d{7,11}$/.test(parsed.dni)) {
    throw new Error("DNI o CUIL inválido");
  }

  return parsed;
}

function resolveStorefrontOrigin(req: Request, requestedOrigin: unknown): string {
  const allowedOrigins = getAllowedOrigins();
  const candidate = typeof requestedOrigin === "string"
    ? requestedOrigin.replace(/\/$/, "")
    : req.headers.get("origin")?.replace(/\/$/, "") ?? "";
  return allowedOrigins.includes(candidate) ? candidate : allowedOrigins[0];
}

function resolveNotificationUrl(supabaseUrl: string): string {
  const configured = Deno.env.get("MERCADOPAGO_NOTIFICATION_URL")?.trim();
  const notificationUrl = configured || new URL(
    "/functions/v1/mercadopago-webhook",
    supabaseUrl,
  ).toString();
  const parsed = new URL(notificationUrl);
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) {
    throw new Error("MERCADOPAGO_NOTIFICATION_URL debe usar HTTPS");
  }
  return notificationUrl;
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Mercado Pago devolvió una respuesta inválida");
  }
  return data as Record<string, unknown>;
}

function comparableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(comparableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${comparableJson(record[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Método no permitido" }, 405);
  }

  try {
    const accessToken = requireEnvironment("MERCADOPAGO_ACCESS_TOKEN");
    const supabaseUrl = requireEnvironment("SUPABASE_URL");
    const supabaseKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json() as RequestBody;
    assertUuid(body.checkout_id, "Identificador de checkout");
    const checkoutId = body.checkout_id;
    const payer = parsePayer(body.payer);
    const requestedItems = aggregateCartItems(body.items);

    const productIds = [...new Set(requestedItems.map((item) => item.product_id))];
    const variantIds = requestedItems
      .map((item) => item.variant_id)
      .filter((variantId): variantId is string => Boolean(variantId));
    const [productsResult, variantsResult] = await Promise.all([
      supabase.from("products").select("id, name, price, stock, image_url").in("id", productIds),
      variantIds.length
        ? supabase.from("product_variants").select("id, product_id, color, stock, image_url").in("id", variantIds)
        : Promise.resolve({ data: [] as VariantRecord[], error: null }),
    ]);

    if (productsResult.error || variantsResult.error) {
      console.error("Catalog validation failed", productsResult.error ?? variantsResult.error);
      throw new Error("No se pudo comprobar el inventario");
    }

    const validatedItems = validateCatalogItems(
      requestedItems,
      (productsResult.data ?? []) as ProductRecord[],
      (variantsResult.data ?? []) as VariantRecord[],
    );
    // Never offer a payment that the canonical ERP cannot identify and fulfill.
    const organizationId = requireEnvironment("ERP_ORGANIZATION_ID");
    assertUuid(organizationId, "Organización ERP");
    const { data: erpProducts, error: erpProductsError } = await supabase.schema("erp")
      .from("products").select("id, inventory_tracking")
      .eq("organization_id", organizationId).eq("is_active", true)
      .eq("can_sell", true).eq("publish_on_web", true).eq("allow_online_sale", true)
      .eq("item_kind", "product").in("id", productIds);
    if (erpProductsError || erpProducts?.length !== productIds.length ||
      erpProducts.some((product) => product.inventory_tracking !== "quantity")) {
      throw new Error("El catálogo no está habilitado para cobro online en el ERP. Contactá al local.");
    }
    if (variantIds.length) {
      const { data: erpVariants, error: erpVariantsError } = await supabase.schema("erp")
        .from("product_variants").select("id, product_id")
        .eq("organization_id", organizationId).eq("is_active", true).in("id", variantIds);
      if (erpVariantsError || requestedItems.some((item) => item.variant_id &&
        !erpVariants?.some((variant) => variant.id === item.variant_id && variant.product_id === item.product_id))) {
        throw new Error("La variante no está habilitada para cobro online en el ERP.");
      }
    }
    const total = validatedItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
    const persistedItems = validatedItems.map((item) => ({
      product_id: item.product_id,
      variant_id: item.variant_id,
      inventory_unit_id: null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      title: item.title,
    }));

    const { error: insertOrderError } = await supabase.from("orders").insert({
      id: checkoutId,
      status: "pending",
      total,
      items: persistedItems,
      payer,
      stock_decremented: false,
      updated_at: new Date().toISOString(),
    });
    if (insertOrderError?.code === "23505") {
      const { data: existingOrder, error: existingOrderError } = await supabase
        .from("orders")
        .select("id, status, total, items, payer")
        .eq("id", checkoutId)
        .single();
      if (
        existingOrderError ||
        !existingOrder ||
        existingOrder.total !== total ||
        comparableJson(existingOrder.items) !== comparableJson(persistedItems) ||
        comparableJson(existingOrder.payer) !== comparableJson(payer) ||
        !["pending", "in_process"].includes(existingOrder.status)
      ) {
        throw new Error("Este intento de checkout ya fue utilizado");
      }
    } else if (insertOrderError) {
      console.error("Unable to persist pending storefront order", insertOrderError);
      throw new Error("No se pudo iniciar la orden");
    }

    const validOrigin = resolveStorefrontOrigin(req, body.origin);
    const preference = {
      items: validatedItems.map((item: ValidatedCheckoutItem) => ({
        id: encodeMercadoPagoItemId(item.product_id, item.variant_id),
        title: item.title,
        currency_id: "ARS",
        picture_url: item.image_url ?? undefined,
        description: item.title,
        category_id: "others",
        quantity: item.quantity,
        unit_price: item.unit_price,
      })),
      back_urls: {
        success: `${validOrigin}/checkout?payment=success`,
        failure: `${validOrigin}/checkout?payment=failure`,
        pending: `${validOrigin}/checkout?payment=pending`,
      },
      payer: {
        name: payer.name,
        email: payer.email,
        phone: { area_code: "", number: payer.phone },
        identification: { type: payer.dni.length > 8 ? "CUIL" : "DNI", number: payer.dni },
      },
      auto_return: validOrigin.includes("localhost") ? undefined : "approved",
      statement_descriptor: "NICTECH",
      external_reference: checkoutId,
      notification_url: resolveNotificationUrl(supabaseUrl),
      metadata: {
        checkout_id: checkoutId,
        items: JSON.stringify(persistedItems),
        payer_dni: payer.dni,
        payer_phone: payer.phone,
        payer_address: payer.address,
      },
    };

    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": checkoutId,
      },
      body: JSON.stringify(preference),
    });
    const mpData = await parseJsonResponse(mpResponse);
    if (!mpResponse.ok) {
      console.error("Mercado Pago preference rejected", { status: mpResponse.status, cause: mpData.cause });
      throw new Error("Mercado Pago no pudo iniciar el pago");
    }
    if (typeof mpData.init_point !== "string") {
      throw new Error("Mercado Pago no devolvió una URL de pago");
    }

    return jsonResponse(req, {
      id: mpData.id,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point,
    }, 200);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("create-mercadopago-preference failed", message);
    return jsonResponse(req, { error: message }, 400);
  }
});
