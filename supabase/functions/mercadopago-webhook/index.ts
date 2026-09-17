/* eslint-disable @typescript-eslint/no-explicit-any -- email templates consume provider payloads defensively. */
import { createClient } from "supabase";
import { isUuid, mapPaymentStatus, normalizeOrderItems } from "./domain.ts";
import { verifyMercadoPagoSignature } from "./signature.ts";

// ── Webhook signature verification ────────────────────────────────────────────
// MercadoPago signs each webhook with HMAC-SHA256.
// Requires MERCADOPAGO_WEBHOOK_SECRET env var (set in Supabase secrets).
// Reference: https://www.mercadopago.com.ar/developers/en/docs/your-integrations/notifications/webhooks
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

// ── Email template ────────────────────────────────────────────────────────────
function buildOrderEmail(payer: any, items: any[], total: number, paymentId: string): string {
  const firstName = payer?.first_name || payer?.name || "Cliente";
  const itemRows = items.map((item: any) => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;">
        ${item.title || item.name || "Producto"}
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:center;">
        ${item.quantity}
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:right;">
        $${Number(item.unit_price || 0).toLocaleString("es-AR")}
      </td>
    </tr>
  `).join("");

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confirmación de compra - Nictech</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px 40px;text-align:center;">
              <img
                src="https://tuzpcofywkhglkqplhnn.supabase.co/storage/v1/object/public/resources/Copia%20de%20path5.png"
                alt="Nictech"
                style="height:48px;object-fit:contain;"
              />
              <p style="color:rgba(255,255,255,0.6);font-size:13px;margin:12px 0 0;">nictech.com.ar</p>
            </td>
          </tr>

          <!-- Success badge -->
          <tr>
            <td style="padding:32px 40px 0;text-align:center;">
              <div style="display:inline-block;background:#dcfce7;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;margin-bottom:16px;">✅</div>
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#111;">¡Compra confirmada!</h1>
              <p style="margin:0;font-size:16px;color:#555;">Hola <strong>${firstName}</strong>, tu pago fue procesado con éxito.</p>
            </td>
          </tr>

          <!-- Order details -->
          <tr>
            <td style="padding:24px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">
                <tr style="background:#f8f8f8;">
                  <th style="padding:12px 16px;text-align:left;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;">Producto</th>
                  <th style="padding:12px 16px;text-align:center;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;">Cant.</th>
                  <th style="padding:12px 16px;text-align:right;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;">Precio</th>
                </tr>
                ${itemRows}
                <tr style="background:#f8f8f8;">
                  <td colspan="2" style="padding:14px 16px;font-size:15px;font-weight:700;color:#111;">Total pagado</td>
                  <td style="padding:14px 16px;text-align:right;font-size:18px;font-weight:800;color:#111;">$${Number(total).toLocaleString("es-AR")}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Payment reference -->
          <tr>
            <td style="padding:0 40px 24px;">
              <div style="background:#f8f8f8;border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;">
                <span style="font-size:13px;color:#888;">N° de referencia de pago</span>
                <span style="font-size:13px;font-weight:600;color:#333;font-family:monospace;">${paymentId}</span>
              </div>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 40px 32px;text-align:center;">
              <p style="font-size:14px;color:#555;margin:0 0 16px;">¿Tenés alguna consulta sobre tu compra?</p>
              <a
                href="https://wa.me/5493446353769"
                style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;"
              >
                Contactar por WhatsApp
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8f8f8;padding:20px 40px;border-top:1px solid #e5e5e5;text-align:center;">
              <p style="margin:0;font-size:12px;color:#999;line-height:1.6;">
                Este es un correo automático, por favor <strong>no respondas este mensaje</strong>.<br/>
                Fue enviado porque realizaste una compra en <a href="https://nictech.com.ar" style="color:#888;">nictech.com.ar</a>.<br/>
                Si no realizaste esta compra, ignorá este correo.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

// ── Build admin notification email ────────────────────────────────────────────
function buildAdminEmail(payer: any, items: any[], total: number, paymentId: string): string {
  const name = [payer?.first_name, payer?.last_name].filter(Boolean).join(" ") || payer?.name || "Sin nombre";
  const email = payer?.email || "-";
  const phone = typeof payer?.phone === "string"
    ? payer.phone
    : payer?.phone ? `${payer.phone.area_code || ""}${payer.phone.number || ""}` : "-";
  const dni = payer?.dni || payer?.identification?.number || "-";
  const now = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });

  const itemRows = items.map((item: any) => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333;">${item.title || item.name || "Producto"}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333;text-align:center;">${item.quantity}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333;text-align:right;">$${Number(item.unit_price || 0).toLocaleString("es-AR")}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><title>Nueva venta - Nictech</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Segoe UI,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:28px 40px;text-align:center;">
    <img src="https://tuzpcofywkhglkqplhnn.supabase.co/storage/v1/object/public/resources/Copia%20de%20path5.png" alt="Nictech" style="height:44px;object-fit:contain;"/>
    <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:10px 0 0;">Panel de ventas</p>
  </td></tr>
  <tr><td style="padding:32px 40px 16px;text-align:center;">
    <div style="display:inline-block;background:#fef9c3;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;margin-bottom:12px;">&#128722;</div>
    <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#111;">Nueva venta recibida</h1>
    <p style="margin:0;font-size:14px;color:#666;">Se acabo de procesar un pago aprobado en la tienda.</p>
  </td></tr>
  <tr><td style="padding:8px 40px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">
      <tr><td colspan="2" style="background:#f0f9ff;padding:12px 18px;font-size:12px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:0.08em;">Datos del comprador</td></tr>
      <tr><td style="padding:12px 18px;font-size:13px;color:#888;border-bottom:1px solid #f0f0f0;width:40%;">Nombre</td><td style="padding:12px 18px;font-size:14px;font-weight:600;color:#111;border-bottom:1px solid #f0f0f0;">${name}</td></tr>
      <tr><td style="padding:12px 18px;font-size:13px;color:#888;border-bottom:1px solid #f0f0f0;">Email</td><td style="padding:12px 18px;font-size:14px;font-weight:600;color:#111;border-bottom:1px solid #f0f0f0;"><a href="mailto:${email}" style="color:#2563eb;">${email}</a></td></tr>
      <tr><td style="padding:12px 18px;font-size:13px;color:#888;border-bottom:1px solid #f0f0f0;">Telefono</td><td style="padding:12px 18px;font-size:14px;font-weight:600;color:#111;border-bottom:1px solid #f0f0f0;">${phone}</td></tr>
      <tr><td style="padding:12px 18px;font-size:13px;color:#888;">DNI</td><td style="padding:12px 18px;font-size:14px;font-weight:600;color:#111;">${dni}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 40px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">
      <tr><td colspan="3" style="background:#f0fdf4;padding:12px 18px;font-size:12px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.08em;">Productos vendidos</td></tr>
      <tr style="background:#f8f8f8;">
        <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:#888;text-transform:uppercase;">Producto</th>
        <th style="padding:10px 16px;text-align:center;font-size:11px;font-weight:600;color:#888;text-transform:uppercase;">Cant.</th>
        <th style="padding:10px 16px;text-align:right;font-size:11px;font-weight:600;color:#888;text-transform:uppercase;">Precio</th>
      </tr>
      ${itemRows}
      <tr style="background:#f0fdf4;"><td colspan="2" style="padding:14px 16px;font-size:15px;font-weight:700;color:#111;">TOTAL</td><td style="padding:14px 16px;text-align:right;font-size:20px;font-weight:800;color:#16a34a;">$${Number(total).toLocaleString("es-AR")}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 40px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8;border-radius:10px;">
      <tr><td style="padding:12px 18px;font-size:13px;color:#888;border-bottom:1px solid #eee;">N de referencia</td><td style="padding:12px 18px;font-size:13px;font-weight:600;color:#333;font-family:monospace;text-align:right;">${paymentId}</td></tr>
      <tr><td style="padding:12px 18px;font-size:13px;color:#888;border-bottom:1px solid #eee;">Fecha y hora</td><td style="padding:12px 18px;font-size:13px;font-weight:600;color:#333;text-align:right;">${now}</td></tr>
      <tr><td style="padding:12px 18px;font-size:13px;color:#888;">Estado</td><td style="padding:12px 18px;text-align:right;"><span style="background:#dcfce7;color:#16a34a;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;">APROBADO</span></td></tr>
    </table>
  </td></tr>
  <tr><td style="background:#f8f8f8;padding:20px 40px;border-top:1px solid #e5e5e5;text-align:center;">
    <p style="margin:0;font-size:12px;color:#999;line-height:1.6;">Aviso automatico del sistema de ventas de <strong>nictech.com.ar</strong><br/>No respondas este correo.</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

// ── Send emails via Resend ────────────────────────────────────────────────────
async function sendConfirmationEmail(payer: any, items: any[], total: number, paymentId: string) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) { console.warn("RESEND_API_KEY not set, skipping email."); return; }

  const toEmail = payer?.email;
  if (!toEmail) { console.warn("No payer email found, skipping email."); return; }

  const adminEmail = Deno.env.get("SALES_NOTIFICATION_EMAIL")?.trim() || "Nictech.ar@gmail.com";
  const fromEmail = Deno.env.get("SALES_FROM_EMAIL")?.trim() || "Nictech Ventas <ventas@nictech.com.ar>";

  // Email al cliente
  const clientRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `mercadopago-${paymentId}-customer`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject: "Confirmacion de compra - Nictech",
      html: buildOrderEmail(payer, items, total, paymentId),
    }),
  });
  if (!clientRes.ok) {
    console.error("Resend client error:", await clientRes.text());
    throw new Error("No se pudo enviar la confirmación al cliente");
  }

  // Aviso al negocio
  const adminRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `mercadopago-${paymentId}-admin`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [adminEmail],
      subject: `Nueva venta - $${Number(total).toLocaleString("es-AR")}`,
      html: buildAdminEmail(payer, items, total, paymentId),
    }),
  });
  if (!adminRes.ok) {
    console.error("Resend admin error:", await adminRes.text());
    throw new Error("No se pudo enviar el aviso de venta");
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
interface WebhookEnvelope {
  id?: unknown;
  type?: unknown;
  action?: unknown;
  data?: { id?: unknown };
}

function jsonResponse(req: Request, body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function requireEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} no está configurado`);
  return value;
}

function requireUuidEnvironment(name: string): string {
  const value = requireEnvironment(name);
  if (!isUuid(value)) throw new Error(`${name} no contiene un UUID válido`);
  return value;
}

function asRecord(value: unknown, errorMessage: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorMessage);
  return value as Record<string, unknown>;
}

function getNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function readEnvelope(req: Request): Promise<WebhookEnvelope> {
  if (req.method !== "POST") return {};
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  try {
    return await req.json() as WebhookEnvelope;
  } catch {
    return {};
  }
}

function extractPaymentId(url: URL, envelope: WebhookEnvelope): string | null {
  const queryId = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  const bodyId = envelope.data?.id === undefined ? null : String(envelope.data.id);
  if (queryId && bodyId && queryId !== bodyId) return null;
  const candidate = queryId ?? bodyId;
  return candidate && /^\d+$/.test(candidate) ? candidate : null;
}

function isPaymentNotification(url: URL, envelope: WebhookEnvelope): boolean {
  const topic = url.searchParams.get("topic") ?? url.searchParams.get("type");
  return topic === "payment" || envelope.type === "payment" ||
    (typeof envelope.action === "string" && envelope.action.startsWith("payment."));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders(req) });
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse(req, { error: "Método no permitido" }, 405);
  }

  try {
    const url = new URL(req.url);
    const envelope = await readEnvelope(req);
    if (!isPaymentNotification(url, envelope)) {
      return jsonResponse(req, { ignored: true }, 200);
    }

    const paymentId = extractPaymentId(url, envelope);
    if (!paymentId) return jsonResponse(req, { error: "Identificador de pago inválido" }, 400);

    const secret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET")?.trim();
    if (!secret) {
      console.error("MERCADOPAGO_WEBHOOK_SECRET is required");
      return jsonResponse(req, { error: "Webhook no configurado" }, 503);
    }
    const requestId = req.headers.get("x-request-id")?.trim() ?? "";
    const signatureIsValid = await verifyMercadoPagoSignature(
      secret,
      paymentId,
      requestId,
      req.headers.get("x-signature"),
    );
    if (!signatureIsValid) {
      console.error("Mercado Pago webhook signature rejected", { paymentId, requestId });
      return jsonResponse(req, { error: "Firma inválida" }, 401);
    }

    return await processPayment(paymentId, requestId, envelope, req);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("Mercado Pago webhook failed", message);
    return jsonResponse(req, { error: "No se pudo procesar la notificación" }, 500);
  }
});

async function processPayment(
  paymentId: string,
  requestId: string,
  envelope: WebhookEnvelope,
  req: Request,
): Promise<Response> {
  const accessToken = requireEnvironment("MERCADOPAGO_ACCESS_TOKEN");
  const supabaseUrl = requireEnvironment("SUPABASE_URL");
  const supabaseKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { "Authorization": `Bearer ${accessToken}` },
  });
  if (!mpResponse.ok) {
    console.error("Mercado Pago payment lookup failed", { paymentId, status: mpResponse.status });
    throw new Error("No se pudo verificar el pago con el proveedor");
  }

  const paymentData = asRecord(await mpResponse.json(), "Respuesta de pago inválida");
  if (String(paymentData.id ?? "") !== paymentId) throw new Error("El pago verificado no coincide");
  if (!isUuid(paymentData.external_reference)) throw new Error("La referencia externa no es válida");

  const storefrontOrderId = paymentData.external_reference;
  const total = paymentData.transaction_amount;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
    throw new Error("El total del pago no es válido");
  }
  const currencyCode = paymentData.currency_id;
  if (currencyCode !== "ARS") throw new Error("La moneda del pago no está permitida");

  const { data: storefrontOrder, error: orderError } = await supabase
    .from("orders")
    .select("id, status, total, items, payer")
    .eq("id", storefrontOrderId)
    .single();
  if (orderError || !storefrontOrder) throw new Error("La orden de storefront no existe");
  if (storefrontOrder.total !== total) throw new Error("El total pagado no coincide con la orden");

  const items = normalizeOrderItems(storefrontOrder.items);
  const payer = asRecord(storefrontOrder.payer, "Comprador de orden inválido");
  const status = mapPaymentStatus(paymentData.status);
  const paymentMethod = typeof paymentData.payment_method_id === "string"
    ? paymentData.payment_method_id
    : null;

  if (status !== "approved") {
    if (storefrontOrder.status !== "approved" || status === "refunded") {
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          status,
          payment_id: paymentId,
          payment_method_id: paymentMethod,
          updated_at: new Date().toISOString(),
        })
        .eq("id", storefrontOrderId);
      if (updateError) throw updateError;
    }
    return jsonResponse(req, { success: true, status }, 200);
  }

  const metadata = getNestedRecord(paymentData, "metadata");
  const metadataCheckoutId = metadata.checkout_id;
  if (metadataCheckoutId !== storefrontOrderId) {
    throw new Error("La metadata del pago no coincide con la orden");
  }

  const providerOccurredAt = [paymentData.date_approved, paymentData.date_last_updated, paymentData.date_created]
    .find((value): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)));
  if (!providerOccurredAt) throw new Error("El pago no contiene una fecha válida");

  const providerEventId = typeof envelope.id === "string" || typeof envelope.id === "number"
    ? String(envelope.id)
    : requestId;
  const { data: result, error: processError } = await supabase.schema("erp").rpc(
    "process_mercadopago_payment",
    {
      p_organization_id: requireUuidEnvironment("ERP_ORGANIZATION_ID"),
      p_branch_id: requireUuidEnvironment("ERP_BRANCH_ID"),
      p_location_id: requireUuidEnvironment("ERP_STOREFRONT_LOCATION_ID"),
      p_storefront_order_id: storefrontOrderId,
      p_customer_id: requireUuidEnvironment("ERP_STOREFRONT_CUSTOMER_ID"),
      p_exchange_snapshot_id: requireUuidEnvironment("ERP_STORE_EXCHANGE_SNAPSHOT_ID"),
      p_payment_method_id: requireUuidEnvironment("ERP_MERCADOPAGO_PAYMENT_METHOD_ID"),
      p_provider_payment_id: paymentId,
      p_provider_event_id: providerEventId,
      p_status: status,
      p_total: total,
      p_currency_code: currencyCode,
      p_external_reference: storefrontOrderId,
      p_payer: payer,
      p_items: items,
      p_provider_occurred_at: providerOccurredAt,
      p_raw_data: paymentData,
    },
  );
  if (processError) {
    console.error("Transactional payment processing failed", {
      paymentId,
      code: processError.code,
      details: processError.details,
    });
    throw new Error("La venta no pudo asentarse de forma transaccional");
  }

  await sendConfirmationEmail(payer, items, total, paymentId);
  return jsonResponse(req, { success: true, status, result }, 200);
}
 
