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
  const phone = payer?.phone ? `${payer.phone.area_code || ""}${payer.phone.number || ""}` : "-";
  const dni = payer?.identification?.number || "-";
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

  const ADMIN_EMAIL = "Nictech.ar@gmail.com";

  // Email al cliente
  const clientRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Nictech Ventas <ventas@nictech.com.ar>",
      to: [toEmail],
      subject: "Confirmacion de compra - Nictech",
      html: buildOrderEmail(payer, items, total, paymentId),
    }),
  });
  if (!clientRes.ok) console.error("Resend client error:", await clientRes.text());
  else console.log(`Email cliente enviado a ${toEmail}`);

  // Aviso al negocio
  const adminRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Nictech Ventas <ventas@nictech.com.ar>",
      to: [ADMIN_EMAIL],
      subject: `Nueva venta - $${Number(total).toLocaleString("es-AR")}`,
      html: buildAdminEmail(payer, items, total, paymentId),
    }),
  });
  if (!adminRes.ok) console.error("Resend admin error:", await adminRes.text());
  else console.log(`Aviso de venta enviado a ${ADMIN_EMAIL}`);
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const url = new URL(req.url);
    const topic = url.searchParams.get("topic") || url.searchParams.get("type");
    const id = url.searchParams.get("id") || url.searchParams.get("data.id");

    if (topic !== "payment") {
      try {
        const body = await req.json();
        if (body.type === "payment" && body.data && body.data.id) {
          return processPayment(body.data.id, req);
        }
      } catch (_e) {
        // ignore JSON parse error
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
    headers: { "Authorization": `Bearer ${accessToken}` }
  });

  if (!mpResponse.ok) throw new Error("Failed to fetch payment");

  const paymentData = await mpResponse.json();

  const status = paymentData.status;
  const total = paymentData.transaction_amount;
  const items = paymentData.additional_info?.items || [];
  const payer = paymentData.payer;
  const metadata = paymentData.metadata || {};

  // 2. Check if order already exists
  const { data: existingOrder } = await supabase
    .from("orders")
    .select("stock_decremented, email_sent")
    .eq("payment_id", String(paymentId))
    .single();

  const stockAlreadyDecremented = existingOrder?.stock_decremented || false;
  const emailAlreadySent = existingOrder?.email_sent || false;
  const shouldDecrementStock = status === "approved" && !stockAlreadyDecremented;

  // 3. Upsert order
  const { error: dbError } = await supabase
    .from("orders")
    .upsert({
      payment_id: String(paymentId),
      status,
      total,
      items,
      payer,
      updated_at: new Date().toISOString(),
      stock_decremented: stockAlreadyDecremented || shouldDecrementStock,
    }, { onConflict: "payment_id" });

  if (dbError) {
    console.error("Error saving order:", dbError);
    throw dbError;
  }

  // 4. Decrement stock if approved and not yet done
  if (shouldDecrementStock) {
    const { data: recheckOrder } = await supabase
      .from("orders")
      .select("stock_decremented")
      .eq("payment_id", String(paymentId))
      .single();

    if (recheckOrder?.stock_decremented) {
      let itemsToProcess = items;
      if (items.length === 0 && metadata.items) {
        try { itemsToProcess = JSON.parse(metadata.items); } catch (_e) { /* ignore */ }
      }

      for (const item of itemsToProcess) {
        if (item.id) {
          const { error: rpcError } = await supabase.rpc("decrement_stock", {
            row_id: item.id,
            qty: Number(item.quantity)
          });
          if (rpcError) console.error(`Error decrementing stock for ${item.id}:`, rpcError);
        }
      }
    }
  }

  // 5. Send confirmation email (only once per approved order)
  if (status === "approved" && !emailAlreadySent) {
    let itemsForEmail = items;
    if (itemsForEmail.length === 0 && metadata.items) {
      try { itemsForEmail = JSON.parse(metadata.items); } catch (_e) { /* ignore */ }
    }
    await sendConfirmationEmail(payer, itemsForEmail, total, String(paymentId));

    // Mark email as sent (best-effort, ignore error)
    await supabase
      .from("orders")
      .update({ email_sent: true })
      .eq("payment_id", String(paymentId));
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    status: 200
  });
}
