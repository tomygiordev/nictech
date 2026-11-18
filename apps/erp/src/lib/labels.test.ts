import { describe, expect, it } from "vitest";
import { Constants } from "../types/supabase";
import {
  AUDIT_ACTION_LABELS,
  CASH_MOVEMENT_KIND_LABELS,
  CUSTOMER_STATUS_LABELS,
  DELIVERY_STATE_LABELS,
  FINANCING_STATUS_LABELS,
  REPAIR_STATUS_LABELS,
  SALE_PAYMENT_STATE_LABELS,
  STOCK_DOCUMENT_KIND_LABELS,
  TRADE_IN_DECISION_LABELS,
  WEB_ORDER_STATUS_LABELS,
  WEB_PAYMENT_STATUS_LABELS,
  auditTableLabel,
  labelOf,
} from "./labels";

const enumLabels = {
  cash_movement_kind: CASH_MOVEMENT_KIND_LABELS,
  financing_status: FINANCING_STATUS_LABELS,
  sale_delivery_state: DELIVERY_STATE_LABELS,
  sale_payment_state: SALE_PAYMENT_STATE_LABELS,
  stock_document_kind: STOCK_DOCUMENT_KIND_LABELS,
  trade_in_review_decision: TRADE_IN_DECISION_LABELS,
  web_payment_status: WEB_PAYMENT_STATUS_LABELS,
} satisfies Partial<Record<keyof typeof Constants.erp.Enums, Record<string, string>>>;

const enumCases = Object.entries(enumLabels).flatMap(([name, labels]) =>
  Constants.erp.Enums[name as keyof typeof enumLabels].map((raw) => ({ name, raw, labels })),
);

describe("etiquetas ERP", () => {
  it.each(enumCases)("$name tiene una etiqueta para $raw", ({ raw, labels }) => {
    const label = labelOf(labels, raw);
    expect(label).not.toBe("Otro");
    expect(label).not.toBe(raw);
  });

  it.each(["placed", "confirmed", "cancelled", "fulfilled", "refunded"])(
    "etiqueta el estado de pedido web %s",
    (raw) => expect(labelOf(WEB_ORDER_STATUS_LABELS, raw)).not.toBe("Otro"),
  );

  it.each([
    ["insert", "Alta"], ["update", "Modificación"], ["delete", "Baja"],
    ["execute", "Ejecución"], ["approve", "Aprobación"], ["reject", "Rechazo"],
    ["reverse", "Reversión"], ["login", "Inicio de sesión"], ["logout", "Cierre de sesión"],
    ["read_sensitive", "Consulta de datos sensibles"],
  ])("etiqueta la acción de auditoría %s", (action, expected) => {
    expect(labelOf(AUDIT_ACTION_LABELS, action)).toBe(expected);
  });

  it.each([
    ["erp.web_orders", "Pedidos web"],
    ["stock_cost_movements", "Movimientos de costo de stock"],
    ["erp.repair_notes", "Notas de reparación"],
    ["accounting_source_events", "Operaciones contabilizadas"],
    ["report_exports", "Exportaciones de reportes"],
    ["erp.tabla_desconocida", "Registro del sistema"],
    ["public.customers", "Registro del sistema"],
    [null, "Registro del sistema"],
  ])("etiqueta la tabla de auditoría %s", (table, expected) => {
    expect(auditTableLabel(table)).toBe(expected);
  });

  it.each([
    ["diagnosis", "Diagnóstico"],
    ["Diagnostico", "Diagnóstico"],
    ["Diagnóstico", "Diagnóstico"],
    ["Reparacion", "En reparación"],
    ["Reparación", "En reparación"],
    ["waiting_parts", "Esperando repuestos"],
    ["Listo para entregar", "Listo para entregar"],
    ["Finalizado", "Finalizado"],
  ])("normaliza el estado de reparación %s", (raw, expected) => {
    expect(labelOf(REPAIR_STATUS_LABELS, raw)).toBe(expected);
  });

  it("etiqueta los indicadores de cliente activo e inactivo", () => {
    expect(labelOf(CUSTOMER_STATUS_LABELS, true)).toBe("Activo");
    expect(labelOf(CUSTOMER_STATUS_LABELS, false)).toBe("Inactivo");
    expect(labelOf(CUSTOMER_STATUS_LABELS, "active")).toBe("Activo");
    expect(labelOf(CUSTOMER_STATUS_LABELS, "inactive")).toBe("Inactivo");
  });

  it.each(["__proto__", "toString", "constructor", "future_status", "", null, undefined])(
    "no expone claves desconocidas o heredadas (%s)",
    (raw) => expect(labelOf(DELIVERY_STATE_LABELS, raw)).toBe("Otro"),
  );

  it("permite elegir una etiqueta alternativa", () => {
    expect(labelOf(DELIVERY_STATE_LABELS, null, "Sin estado")).toBe("Sin estado");
    expect(labelOf({ pending: "  " }, "pending")).toBe("Otro");
  });
});
