import { z } from "zod";
import { toUserMessage } from "../../lib/errors";

const OPERATION_CONFLICT_MESSAGE =
  "Ya hay una operación registrada con esta referencia. Revisá si se completó antes de reintentar.";

/**
 * Translates a repair mutation error and clears the stored idempotency key on
 * conflict so the next attempt can submit with a fresh key.
 */
export function resolveIdempotentRepairError(
  error: unknown,
  fallback: string,
  operationKeys: Map<string, string>,
  orderId: string,
): string {
  const userMessage = toUserMessage(error, "");
  if (userMessage === OPERATION_CONFLICT_MESSAGE) {
    operationKeys.delete(orderId);
    return `${userMessage} Actualizá la reparación para ver si la operación quedó registrada.`;
  }
  return toUserMessage(error, fallback);
}

const clientIdSchema = z.string().uuid();

export const intakeFormSchema = z.object({
  branchId: z.string().uuid("Elegí una sucursal."),
  isNewCustomer: z.boolean(),
  customerId: z.string(),
  newCustomerName: z.string().trim(),
  newCustomerDni: z.string().trim().optional(),
  newCustomerPhone: z.string().trim().optional(),
  deviceType: z.string().trim().min(1, "Elegí el tipo de equipo."),
  deviceBrand: z.string().trim().min(1, "Elegí la marca."),
  model: z.string().trim().min(2, "Indicá el modelo del equipo.").max(160, "El modelo no puede superar los 160 caracteres."),
  reportedFault: z.string().trim().min(5, "Describí la falla con al menos 5 caracteres.").max(1000, "La falla no puede superar los 1000 caracteres."),
  serialNumber: z.string().trim().max(120, "El número de serie no puede superar los 120 caracteres.").optional(),
  imei: z.string().trim().max(30, "El IMEI no puede superar los 30 caracteres.").optional(),
  intakeCondition: z.string().trim().optional(),
  intakeAccessories: z.string().trim().optional(),
}).superRefine((value, context) => {
  if (value.isNewCustomer) {
    if (!value.newCustomerName) {
      context.addIssue({ code: "custom", path: ["newCustomerName"], message: "Ingresá el nombre del nuevo cliente." });
    }
    const dni = value.newCustomerDni?.replace(/[.\s-]/g, "");
    if (value.newCustomerDni && !/^\d{7,8}$/.test(dni ?? "")) {
      context.addIssue({ code: "custom", path: ["newCustomerDni"], message: "El DNI debe tener 7 u 8 dígitos." });
    }
  } else if (!clientIdSchema.safeParse(value.customerId).success) {
    context.addIssue({ code: "custom", path: ["customerId"], message: "Elegí un cliente." });
  }

  if (!value.serialNumber?.replace(/[\s-]/g, "") && !/\d/.test(value.imei ?? "")) {
    context.addIssue({
      code: "custom",
      path: ["serialNumber"],
      message: "Ingresá el número de serie o el IMEI del equipo.",
    });
  }
});

export type IntakeFormInput = z.infer<typeof intakeFormSchema>;

export const repairNoteSchema = z.object({
  content: z.string().trim().min(1, "Escribí una nota.").max(4000, "La nota no puede superar 4000 caracteres."),
  isPublic: z.boolean(),
});
export type RepairNoteInput = z.infer<typeof repairNoteSchema>;

const requiredNumber = (required: string, rule: z.ZodNumber) =>
  z.string().trim().min(1, required)
    .transform(Number)
    .pipe(rule);

export const laborSchema = z.object({
  description: z.string().trim()
    .min(5, "Describí el trabajo con al menos 5 caracteres.")
    .max(1000, "La descripción no puede superar los 1000 caracteres."),
  hours: requiredNumber("Ingresá las horas trabajadas.", z.number({ invalid_type_error: "Ingresá un número válido de horas." })
    .positive("Las horas deben ser mayores a cero.").max(1000, "Las horas no pueden superar las 1000.")),
  unitCost: requiredNumber("Ingresá el costo por hora.", z.number({ invalid_type_error: "Ingresá un costo válido." })
    .min(0, "El costo no puede ser negativo.").max(1_000_000_000, "El costo no puede superar los 1.000 millones.")),
  confirmZeroCost: z.boolean(),
}).refine(({ unitCost, confirmZeroCost }) => unitCost !== 0 || confirmZeroCost, {
  path: ["confirmZeroCost"],
  message: "Confirmá que el costo por hora es cero.",
});

export const paymentSchema = z.object({
  paymentMethodId: z.string().uuid("Elegí un medio de pago."),
  amount: requiredNumber("Ingresá el importe.", z.number({ invalid_type_error: "Ingresá un importe válido." })
    .finite("Ingresá un importe válido.").positive("El importe debe ser mayor a cero.")),
  currency: z.string().trim().length(3, "Elegí la moneda del cobro."),
  exchangeSnapshotId: z.string().uuid("Elegí una cotización registrada."),
  cashSessionId: z.string(),
  reason: z.string().trim()
    .min(5, "Indicá el motivo del cobro con al menos 5 caracteres.")
    .max(300, "El motivo no puede superar los 300 caracteres."),
});

export const createRepairPaymentSchema = (
  methods: ReadonlyArray<{ id: string; requires_cash_session: boolean }>,
  snapshots: ReadonlyArray<{ id: string; quote_currency: string }>,
  sessions: ReadonlyArray<{ id: string }>,
) => paymentSchema.superRefine((values, context) => {
  const method = methods.find((candidate) => candidate.id === values.paymentMethodId);
  if (method?.requires_cash_session && !sessions.some((session) => session.id === values.cashSessionId)) {
    context.addIssue({ code: "custom", path: ["cashSessionId"], message: "Elegí una caja abierta de la misma sucursal." });
  }
  if (values.paymentMethodId && !method) {
    context.addIssue({ code: "custom", path: ["paymentMethodId"], message: "Elegí un medio de pago disponible." });
  }
  if (values.exchangeSnapshotId && !snapshots.some(
    (snapshot) => snapshot.id === values.exchangeSnapshotId && snapshot.quote_currency === values.currency,
  )) {
    context.addIssue({ code: "custom", path: ["exchangeSnapshotId"], message: "Elegí una cotización para la moneda del cobro." });
  }
});

export const partSchema = z.object({
  locationId: z.string().uuid("Elegí una ubicación de stock."),
  productId: z.string().uuid("Elegí un repuesto."),
  quantity: requiredNumber("Ingresá la cantidad.", z.number({ invalid_type_error: "Ingresá una cantidad válida." })
    .int("Ingresá una cantidad entera.").min(1, "La cantidad debe ser de al menos 1 unidad.")),
  reason: z.string().trim().min(5, "Indicá el motivo con al menos 5 caracteres."),
});

export const buildWarrantyTerms = (days: number): string =>
  `Garantía de ${days} días sobre mano de obra y repuestos instalados en NicTech.`;

export const deliverySchema = z.object({
  recipientName: z.string().trim()
    .min(1, "Ingresá el nombre de quien retira.")
    .max(200, "El nombre no puede superar los 200 caracteres."),
  documentSuffix: z.string().trim()
    .regex(/^[0-9A-Za-z]{0,8}$/, "La terminación del DNI debe tener hasta 8 letras o números."),
  warrantyDays: requiredNumber("Elegí los días de garantía.", z.number({ invalid_type_error: "Elegí un plazo de garantía válido." })
    .int("Los días de garantía deben ser un número entero.")
    .min(0, "Los días de garantía no pueden ser negativos.")
    .max(3650, "La garantía no puede superar los 3650 días.")),
  warrantyTerms: z.string().trim()
    .max(8000, "Los términos de la póliza no pueden superar los 8000 caracteres."),
}).superRefine((value, context) => {
  if (value.warrantyDays > 0 && !value.warrantyTerms) {
    context.addIssue({
      code: "custom",
      path: ["warrantyTerms"],
      message: "Ingresá los términos de la póliza de garantía.",
    });
  }
});

export const warrantyClaimSchema = z.object({
  warrantyId: z.string().uuid("Elegí una póliza de garantía vigente."),
  reportedIssue: z.string().trim()
    .min(1, "Describí la falla o defecto reportado.")
    .max(8000, "La falla reportada no puede superar los 8000 caracteres."),
});

export type RepairLaborInput = z.input<typeof laborSchema>;
export type RepairLaborValues = z.output<typeof laborSchema>;
export type RepairPaymentInput = z.input<typeof paymentSchema>;
export type RepairPaymentValues = z.output<typeof paymentSchema>;
export type RepairPartInput = z.input<typeof partSchema>;
export type RepairPartValues = z.output<typeof partSchema>;
export type RepairDeliveryInput = z.input<typeof deliverySchema>;
export type RepairDeliveryValues = z.output<typeof deliverySchema>;
export type RepairWarrantyClaimInput = z.input<typeof warrantyClaimSchema>;
export type RepairWarrantyClaimValues = z.output<typeof warrantyClaimSchema>;
