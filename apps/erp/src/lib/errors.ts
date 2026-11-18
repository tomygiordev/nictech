const INVALID_CREDENTIALS = "Correo o contraseña incorrectos.";
const TOO_MANY_ATTEMPTS = "Demasiados intentos. Esperá unos minutos y volvé a probar.";
const SESSION_EXPIRED = "Tu sesión venció. Volvé a iniciar sesión.";
const PERMISSION_REQUIRED = "No tenés permiso para realizar esta acción.";
const OPERATION_CONFLICT = "Ya hay una operación registrada con esta referencia. Revisá si se completó antes de reintentar.";

const ERROR_CODES = new Map<string, string>([
  ["invalid_credentials", INVALID_CREDENTIALS],
  ["email_not_confirmed", "Tu correo todavía no está confirmado."],
  ["over_request_rate_limit", TOO_MANY_ATTEMPTS],
  ["over_email_send_rate_limit", TOO_MANY_ATTEMPTS],
  ["session_expired", SESSION_EXPIRED],
  ["refresh_token_not_found", SESSION_EXPIRED],
  ["PGRST301", SESSION_EXPIRED],
  ["42501", PERMISSION_REQUIRED],
  ["23505", "Ya existe un registro con esos datos."],
  ["23503", "El registro está vinculado a otros datos y no se puede completar la operación."],
  ["40001", "Otra operación modificó estos datos al mismo tiempo. Reintentá."],
  ["PGRST116", "No se encontró el registro."],
]);

const KNOWN_SERVER_MESSAGES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^insufficient available stock on line \d+$/i, "No hay stock suficiente. Revisá las cantidades y reintentá."],
  [/^insufficient stock for reservation$/i, "No hay stock suficiente para hacer la reserva."],
  [/^inventory unit is not in the expected location on line \d+$/i, "La unidad no está en la ubicación seleccionada."],
  [/^inventory unit changed concurrently on line \d+$/i, "Otra operación modificó la unidad de stock. Actualizá los datos y reintentá."],
  [/^active stock product not found on line \d+$/i, "No se encontró el producto o ya no está activo."],
  [/^active variant not found on line \d+$/i, "No se encontró la variante o ya no está activa."],
  [/^(?:source|destination) location not found on line \d+$/i, "No se encontró una de las ubicaciones del movimiento. Revisá el origen y el destino."],
  [/^active sale location in the trade-in branch is required$/i, "Elegí una ubicación habilitada para venta en la sucursal del canje."],
  [/^(?:the )?location is not enabled for sale$/i, "Elegí una ubicación habilitada para venta."],
  [/^purchase receipts cannot target quarantine locations$/i, "Elegí una ubicación fuera de cuarentena para recibir la compra."],
  [/^cash register already has an open session$/i, "Esa caja ya tiene una sesión abierta."],
  [/^cash session is (?:already )?closed$/i, "La caja ya está cerrada."],
  [/^an active cash register is required$/i, "No hay una caja activa. Revisá la configuración de la sucursal."],
  [/^(?:payment method requires an open cash session|open branch cash session is required)$/i, "Necesitás una caja abierta en la sucursal para registrar el pago."],
  [/^(?:an )?open same-branch cash session with (?:the )?(?:contract currency|payable currency|payment currency) is required$/i, "Usá una caja abierta en la misma sucursal y en la moneda del pago."],
  [/^(?:an open refund cash session is required(?: after the original session closes)?|open same-branch refund session with payment currency is required)$/i, "Para la devolución, usá una caja abierta en la misma sucursal y en la moneda del pago."],
  [/^payment cash session does not match its payment method$/i, "La caja seleccionada no corresponde al medio de pago."],
  [/^payment currency is not open in its cash session$/i, "La caja no está abierta en la moneda del pago."],
  [/^cash movement is already reversed$/i, "Ese movimiento de caja ya fue revertido."],
  [/^[\w.-]+(?:[ ,]+[\w.-]+)* permissions? (?:(?:in an active (?:organization|branch) )?(?:is|are) )?required(?: for .+)?$/i, PERMISSION_REQUIRED],
  [/^(?:[\w -]+ )?(?:idempotency|operation|reversal) key is already used by another (?:request|operation|source event|integration retry request)$/i, OPERATION_CONFLICT],
  [/^integration event already has a pending retry request$/i, "Ya hay un reintento pendiente. Esperá a que termine antes de intentar de nuevo."],
  [/^(?:the )?operation is already in progress$/i, "La operación ya está en curso. Esperá a que termine antes de reintentar."],
  [/^stale quote: catalog price or tax rate has changed, requote required$/i, "Cambió el precio o el impuesto de un producto. Volvé a cotizar antes de cobrar."],
  [/^online order not found$/i, "No se encontró el pedido web."],
  [/^web order is not eligible for fulfillment$/i, "El pedido no está en un estado que permita completarlo."],
  [/^web order delivery state is not eligible for fulfillment$/i, "Prepará el pedido y marcalo como listo antes de completar la entrega."],
  [/^purchase order not found$/i, "No se encontró la orden de compra."],
  [/^repair order not found$/i, "No se encontró la orden de reparación."],
  [/^identity_document already belongs to another customer$/i, "El documento ya está registrado para otro cliente."],
  [/^tax_id already belongs to another customer$/i, "La identificación fiscal ya está registrada para otro cliente."],
  [/^initial_stock debe ser un arreglo$/i, "Revisá los datos del stock inicial."],
];

const SPANISH_START = /^(?:el|la|los|las|un|una|tu|tus|este|esta|ese|esa|ingresa|revisa|selecciona|elegi|completa|carga|espera|reintenta|verifica|falta|faltan|debe|deben|debes|podes|tenes|hace|volve|ocurrio|ocurre|se|ya|hay|sin|no (?:se|hay|es|esta|estan|puede|pudo|podes|tenes|tiene|tienen|encontramos|existe|existen|ingresaste|coincide|coinciden|alcanza|alcanzo|encontrado|valido|disponible)|error (?:al|de|en|por))\b/i;
const TECHNICAL_DETAIL = /\b(?:erp|public|auth|pg_catalog|information_schema)\s*\.\s*["\w]|\b[a-z\d]+(?:_[a-z\d]+)+\b|\bPGRST\d+\b|\bSQLSTATE\b|\b\w+\s*\([^)]*\)\s*(?:no existe|does not exist)|\b(?:tabla|columna|función|restricción)\s+["`]/i;

export function toUserMessage(err: unknown, fallback: string): string {
  const error = typeof err === "object" && err !== null ? err : null;
  const code = error && "code" in error && typeof error.code === "string" ? error.code : undefined;
  const name = error && "name" in error && typeof error.name === "string" ? error.name : undefined;
  const message = typeof err === "string"
    ? err
    : error && "message" in error && typeof error.message === "string" ? error.message : "";
  const text = message.trim();
  const matchText = text.replace(/\.$/, "");

  // RPC guards sometimes reuse generic SQLSTATEs for actionable business errors.
  const knownServerMessage = KNOWN_SERVER_MESSAGES.find(([pattern]) => pattern.test(matchText));
  if (knownServerMessage) return knownServerMessage[1];

  const codeMessage = code ? ERROR_CODES.get(code) : undefined;
  if (codeMessage) return codeMessage;
  if (name === "AuthSessionMissingError" || /^JWT expired$/i.test(matchText)) return SESSION_EXPIRED;
  if (/^invalid login credentials$/i.test(matchText)) return INVALID_CREDENTIALS;
  if (/^(?:\w*Error:\s*)?(?:Failed to fetch|NetworkError when attempting to fetch resource|Load failed)$/i.test(matchText)) {
    return "Sin conexión con el servidor. Revisá internet y reintentá.";
  }

  if (text && !TECHNICAL_DETAIL.test(text) && (/[áéíóúñ¿¡]/i.test(text) || SPANISH_START.test(text))) {
    return message;
  }
  return fallback;
}
