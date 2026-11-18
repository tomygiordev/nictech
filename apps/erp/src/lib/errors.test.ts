import { describe, expect, it } from "vitest";
import { toUserMessage } from "./errors";

const fallback = "No se pudo completar la operación.";

describe("toUserMessage", () => {
  it.each([
    ["invalid_credentials", "Correo o contraseña incorrectos."],
    ["email_not_confirmed", "Tu correo todavía no está confirmado."],
    ["over_request_rate_limit", "Demasiados intentos. Esperá unos minutos y volvé a probar."],
    ["over_email_send_rate_limit", "Demasiados intentos. Esperá unos minutos y volvé a probar."],
    ["session_expired", "Tu sesión venció. Volvé a iniciar sesión."],
    ["refresh_token_not_found", "Tu sesión venció. Volvé a iniciar sesión."],
    ["PGRST301", "Tu sesión venció. Volvé a iniciar sesión."],
    ["42501", "No tenés permiso para realizar esta acción."],
    ["23505", "Ya existe un registro con esos datos."],
    ["23503", "El registro está vinculado a otros datos y no se puede completar la operación."],
    ["40001", "Otra operación modificó estos datos al mismo tiempo. Reintentá."],
    ["PGRST116", "No se encontró el registro."],
  ])("traduce el código %s", (code, expected) => {
    expect(toUserMessage({ code, message: "Internal server error" }, fallback)).toBe(expected);
  });

  it.each([
    [new Error("Invalid login credentials"), "Correo o contraseña incorrectos."],
    [{ name: "AuthSessionMissingError" }, "Tu sesión venció. Volvé a iniciar sesión."],
    ["JWT expired", "Tu sesión venció. Volvé a iniciar sesión."],
    [new TypeError("Failed to fetch"), "Sin conexión con el servidor. Revisá internet y reintentá."],
    ["TypeError: Failed to fetch", "Sin conexión con el servidor. Revisá internet y reintentá."],
    [new TypeError("NetworkError when attempting to fetch resource."), "Sin conexión con el servidor. Revisá internet y reintentá."],
    ["TypeError: NetworkError when attempting to fetch resource.", "Sin conexión con el servidor. Revisá internet y reintentá."],
    [new TypeError("Load failed"), "Sin conexión con el servidor. Revisá internet y reintentá."],
    ["TypeError: Load failed", "Sin conexión con el servidor. Revisá internet y reintentá."],
  ])("reconoce errores sin código (%s)", (error, expected) => {
    expect(toUserMessage(error, fallback)).toBe(expected);
  });

  it.each([
    ["insufficient available stock on line 3", "No hay stock suficiente. Revisá las cantidades y reintentá."],
    ["insufficient stock for reservation", "No hay stock suficiente para hacer la reserva."],
    ["inventory unit is not in the expected location on line 2", "La unidad no está en la ubicación seleccionada."],
    ["inventory unit changed concurrently on line 3", "Otra operación modificó la unidad de stock. Actualizá los datos y reintentá."],
    ["active stock product not found on line 1", "No se encontró el producto o ya no está activo."],
    ["active variant not found on line 1", "No se encontró la variante o ya no está activa."],
    ["source location not found on line 4", "No se encontró una de las ubicaciones del movimiento. Revisá el origen y el destino."],
    ["destination location not found on line 4", "No se encontró una de las ubicaciones del movimiento. Revisá el origen y el destino."],
    ["active sale location in the trade-in branch is required", "Elegí una ubicación habilitada para venta en la sucursal del canje."],
    ["location is not enabled for sale", "Elegí una ubicación habilitada para venta."],
    ["purchase receipts cannot target quarantine locations", "Elegí una ubicación fuera de cuarentena para recibir la compra."],
    ["cash register already has an open session", "Esa caja ya tiene una sesión abierta."],
    ["cash session is closed", "La caja ya está cerrada."],
    ["cash session is already closed", "La caja ya está cerrada."],
    ["an active cash register is required", "No hay una caja activa. Revisá la configuración de la sucursal."],
    ["payment method requires an open cash session", "Necesitás una caja abierta en la sucursal para registrar el pago."],
    ["open branch cash session is required", "Necesitás una caja abierta en la sucursal para registrar el pago."],
    ["an open same-branch cash session with the contract currency is required", "Usá una caja abierta en la misma sucursal y en la moneda del pago."],
    ["an open same-branch cash session with the payable currency is required", "Usá una caja abierta en la misma sucursal y en la moneda del pago."],
    ["open same-branch cash session with payment currency is required", "Usá una caja abierta en la misma sucursal y en la moneda del pago."],
    ["an open refund cash session is required after the original session closes", "Para la devolución, usá una caja abierta en la misma sucursal y en la moneda del pago."],
    ["open same-branch refund session with payment currency is required", "Para la devolución, usá una caja abierta en la misma sucursal y en la moneda del pago."],
    ["payment cash session does not match its payment method", "La caja seleccionada no corresponde al medio de pago."],
    ["payment currency is not open in its cash session", "La caja no está abierta en la moneda del pago."],
    ["cash movement is already reversed", "Ese movimiento de caja ya fue revertido."],
    ["catalog.manage permission is required", "No tenés permiso para realizar esta acción."],
    ["cash.open permission in an active branch is required", "No tenés permiso para realizar esta acción."],
    ["sales.create permission required", "No tenés permiso para realizar esta acción."],
    ["orders.manage, sales.cancel and stock.adjust permissions are required", "No tenés permiso para realizar esta acción."],
    ["idempotency key is already used by another request", "Ya hay una operación registrada con esta referencia. Revisá si se completó antes de reintentar."],
    ["stock operation key is already used by another operation", "Ya hay una operación registrada con esta referencia. Revisá si se completó antes de reintentar."],
    ["integration event already has a pending retry request", "Ya hay un reintento pendiente. Esperá a que termine antes de intentar de nuevo."],
    ["operation is already in progress", "La operación ya está en curso. Esperá a que termine antes de reintentar."],
    ["stale quote: catalog price or tax rate has changed, requote required", "Cambió el precio o el impuesto de un producto. Volvé a cotizar antes de cobrar."],
    ["online order not found", "No se encontró el pedido web."],
    ["web order is not eligible for fulfillment", "El pedido no está en un estado que permita completarlo."],
    ["web order delivery state is not eligible for fulfillment", "Prepará el pedido y marcalo como listo antes de completar la entrega."],
    ["purchase order not found", "No se encontró la orden de compra."],
    ["repair order not found", "No se encontró la orden de reparación."],
    ["identity_document already belongs to another customer", "El documento ya está registrado para otro cliente."],
    ["tax_id already belongs to another customer", "La identificación fiscal ya está registrada para otro cliente."],
    ["initial_stock debe ser un arreglo", "Revisá los datos del stock inicial."],
  ])("traduce el mensaje de servidor %s", (message, expected) => {
    expect(toUserMessage({ code: "P0001", message }, fallback)).toBe(expected);
  });

  it("prefiere un mensaje de negocio conocido a un código SQL genérico", () => {
    expect(toUserMessage({
      code: "23505",
      message: "idempotency key is already used by another request",
    }, fallback)).toBe("Ya hay una operación registrada con esta referencia. Revisá si se completó antes de reintentar.");
    expect(toUserMessage({
      code: "23503",
      message: "active sale location in the trade-in branch is required",
    }, fallback)).toBe("Elegí una ubicación habilitada para venta en la sucursal del canje.");
  });

  it.each([
    "Elegí un producto.",
    "La caja sigue abierta.",
    "No se pudo guardar.",
    "  El importe es menor.  ",
    "No hay stock: quedan 10000 unidades.",
  ])(
    "conserva el texto en español: %s",
    (message) => expect(toUserMessage(new Error(message), fallback)).toBe(message),
  );

  it.each([
    "No rows found",
    "Unexpected server error",
    "Error loading data",
    "No se encontró erp.products.",
    'No se encontró la tabla "products".',
    "Falló create_sale_with_invoice.",
    "La operación falló con PGRST202.",
    "La operación falló con SQLSTATE 23514.",
    "23514",
    "   ",
    null,
    undefined,
    42,
    { message: 101 },
    { code: "toString" },
  ])("usa el fallback sin exponer detalles internos (%s)", (error) => {
    expect(toUserMessage(error, fallback)).toBe(fallback);
  });
});
