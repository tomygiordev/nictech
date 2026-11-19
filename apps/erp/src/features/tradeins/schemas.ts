import { z } from "zod";
import type { Json } from "../../types/supabase";

export type TradeInProductTracking = "serial" | "imei";
export type TradeInJsonObject = { [key: string]: Json | undefined };

export const IMEI_REGEX = /^[0-9]{14,16}$/;
export const MAX_IMEI_DOCUMENTATION_BYTES = 256 * 1024;

export const MAX_IMEI_NOTES_LENGTH = 2000;

export function isZeroAmount(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed === 0;
}

export function buildImeiFallbackDocumentation(values: {
  sellerDniVerified: boolean;
  originalInvoiceOrBox: boolean;
  chargerOrAccessories: boolean;
  notes: string;
}): TradeInJsonObject {
  const documentation: TradeInJsonObject = {};
  if (values.sellerDniVerified) documentation.dni_vendedor_verificado = true;
  if (values.originalInvoiceOrBox) documentation.factura_o_caja_original = true;
  if (values.chargerOrAccessories) documentation.cargador_accesorios = true;
  const trimmedNotes = values.notes.trim();
  if (trimmedNotes !== "") documentation.observaciones = trimmedNotes;
  return documentation;
}

const optionalUuidSchema = (message = "Ingresá un UUID válido.") =>
  z.union([z.literal(""), z.string().trim().uuid(message)]);

const nonNegativeDecimalString = (requiredMessage: string, invalidMessage: string) =>
  z
    .string()
    .trim()
    .min(1, requiredMessage)
    .refine((value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0;
    }, invalidMessage);

const positiveDecimalString = (requiredMessage: string, invalidMessage: string) =>
  z
    .string()
    .trim()
    .min(1, requiredMessage)
    .refine((value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0;
    }, invalidMessage);

const baseTradeInIntakeSchema = z.object({
  branchId: z.string().trim().uuid("Elegí una sucursal."),
  customerId: z.string().trim().uuid("Elegí un cliente."),
  productId: z.string().trim().uuid("Elegí un producto compatible."),
  variantId: optionalUuidSchema("Elegí una variante válida."),
  deviceSerial: z.string().trim().max(200, "El número de serie no puede superar los 200 caracteres."),
  deviceImei: z.string().trim(),
  ownerName: z
    .string()
    .trim()
    .min(1, "Ingresá el nombre del titular del equipo.")
    .max(200, "El nombre del titular no puede superar los 200 caracteres."),
  declarationText: z
    .string()
    .trim()
    .min(1, "Ingresá la declaración de procedencia.")
    .max(4000, "La declaración no puede superar los 4000 caracteres."),
  declaredValue: nonNegativeDecimalString(
    "Ingresá el valor declarado.",
    "Ingresá un valor declarado válido igual o mayor a cero.",
  ),
  confirmZeroDeclaredValue: z.boolean(),
  evidenceDoc: z.string().trim().max(500, "La referencia de evidencia no puede superar los 500 caracteres."),
  intakeReason: z.string().trim().max(500, "El motivo operativo no puede superar los 500 caracteres."),
});

export type TradeInIntakeFormValues = z.infer<typeof baseTradeInIntakeSchema>;

export const createTradeInIntakeSchema = (
  getProductTracking?: (productId: string) => TradeInProductTracking | null,
) =>
  baseTradeInIntakeSchema.superRefine((values, context) => {
    const imei = values.deviceImei.trim();
    const serial = values.deviceSerial.trim();

    if (imei !== "" && !IMEI_REGEX.test(imei)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deviceImei"],
        message: "El IMEI debe contener entre 14 y 16 dígitos numéricos.",
      });
    }

    const tracking = getProductTracking ? getProductTracking(values.productId.trim()) : null;

    if (tracking === "serial" && serial === "") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deviceSerial"],
        message: "El producto seleccionado requiere un número de serie.",
      });
    } else if (tracking === "imei" && imei === "") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deviceImei"],
        message: "El producto seleccionado requiere un IMEI válido.",
      });
    } else if (tracking === null && values.productId.trim() !== "" && serial === "" && imei === "") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deviceSerial"],
        message: "Ingresá el número de serie o el IMEI del equipo.",
      });
    }

    if (isZeroAmount(values.declaredValue) && !values.confirmZeroDeclaredValue) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmZeroDeclaredValue"],
        message: "Confirmá el valor declarado de $0.",
      });
    }
  });

export const emptyTradeInIntake = (branchId = ""): TradeInIntakeFormValues => ({
  branchId,
  customerId: "",
  productId: "",
  variantId: "",
  deviceSerial: "",
  deviceImei: "",
  ownerName: "",
  declarationText: "",
  declaredValue: "",
  confirmZeroDeclaredValue: false,
  evidenceDoc: "",
  intakeReason: "",
});

export const tradeInImeiCheckSchema = z.object({
  providerName: z
    .string()
    .trim()
    .min(1, "Indicá el proveedor de verificación IMEI.")
    .max(120, "El nombre del proveedor no puede superar los 120 caracteres."),
});

export type TradeInImeiCheckFormValues = z.infer<typeof tradeInImeiCheckSchema>;

export const emptyTradeInImeiCheck = (): TradeInImeiCheckFormValues => ({
  providerName: "",
});

export const tradeInImeiFallbackSchema = z
  .object({
    fallbackStatus: z.string().pipe(
      z.enum(["clear", "not_required"], {
        message: "Elegí el resultado del respaldo manual.",
      }),
    ),
    sellerDniVerified: z.boolean(),
    originalInvoiceOrBox: z.boolean(),
    chargerOrAccessories: z.boolean(),
    notes: z
      .string()
      .trim()
      .max(MAX_IMEI_NOTES_LENGTH, "Las observaciones no pueden superar los 2000 caracteres."),
  })
  .superRefine((values, context) => {
    const documentation = buildImeiFallbackDocumentation(values);
    if (Object.keys(documentation).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notes"],
        message: "Marcá al menos una casilla de documentación o ingresá observaciones.",
      });
      return;
    }
    if (new TextEncoder().encode(JSON.stringify(documentation)).length > MAX_IMEI_DOCUMENTATION_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notes"],
        message: "La documentación supera el máximo de 256 KB.",
      });
    }
  });

export type TradeInImeiFallbackFormInput = z.input<typeof tradeInImeiFallbackSchema>;
export type TradeInImeiFallbackFormValues = z.output<typeof tradeInImeiFallbackSchema>;

export const emptyTradeInImeiFallback = (): TradeInImeiFallbackFormInput => ({
  fallbackStatus: "",
  sellerDniVerified: false,
  originalInvoiceOrBox: false,
  chargerOrAccessories: false,
  notes: "",
});

export const tradeInEvaluationSchema = z
  .object({
    appraisedValue: nonNegativeDecimalString(
      "Ingresá el valor tasado.",
      "Ingresá un valor tasado válido igual o mayor a cero.",
    ),
    confirmZeroAppraisedValue: z.boolean(),
    refurbEstimate: nonNegativeDecimalString(
      "Ingresá el costo estimado de reacondicionamiento.",
      "El costo estimado de reacondicionamiento no puede ser negativo.",
    ),
    conditionNotes: z
      .string()
      .trim()
      .min(1, "Ingresá el estado o condición del equipo.")
      .max(2000, "La descripción del estado no puede superar los 2000 caracteres."),
    batteryHealth: z
      .string()
      .trim()
      .refine((value) => {
        if (value === "") return true;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 1 && parsed <= 100;
      }, "La salud de batería debe estar entre 1 y 100."),
  })
  .superRefine((values, context) => {
    if (isZeroAmount(values.appraisedValue) && !values.confirmZeroAppraisedValue) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmZeroAppraisedValue"],
        message: "Confirmá el valor tasado de $0.",
      });
    }
  });

export type TradeInEvaluationFormValues = z.infer<typeof tradeInEvaluationSchema>;

export const emptyTradeInEvaluation = (): TradeInEvaluationFormValues => ({
  appraisedValue: "",
  confirmZeroAppraisedValue: false,
  refurbEstimate: "",
  conditionNotes: "",
  batteryHealth: "",
});

export const tradeInRefurbishmentSchema = z.object({
  refurbDesc: z
    .string()
    .trim()
    .min(1, "Describí el trabajo de reacondicionamiento.")
    .max(2000, "La descripción no puede superar los 2000 caracteres."),
  refurbCost: nonNegativeDecimalString(
    "Ingresá el costo real del reacondicionamiento.",
    "El costo real no puede ser negativo.",
  ),
  repairOrderId: optionalUuidSchema("Elegí una orden de reparación válida."),
});

export type TradeInRefurbishmentFormValues = z.infer<typeof tradeInRefurbishmentSchema>;

export const emptyTradeInRefurbishment = (): TradeInRefurbishmentFormValues => ({
  refurbDesc: "",
  refurbCost: "",
  repairOrderId: "",
});

export const tradeInReleaseSchema = z.object({
  locationId: z.string().trim().uuid("Elegí un depósito destino."),
});

export type TradeInReleaseFormValues = z.infer<typeof tradeInReleaseSchema>;

export const emptyTradeInRelease = (): TradeInReleaseFormValues => ({
  locationId: "",
});

export const tradeInApplyPaymentSchema = z.object({
  saleId: z.string().trim().uuid("Elegí una venta destino."),
  paymentAmount: positiveDecimalString(
    "Ingresá el monto del pago.",
    "El monto del pago debe ser mayor a cero.",
  ),
});

export type TradeInApplyPaymentFormValues = z.infer<typeof tradeInApplyPaymentSchema>;

export const emptyTradeInApplyPayment = (): TradeInApplyPaymentFormValues => ({
  saleId: "",
  paymentAmount: "",
});
