import { z } from "zod";

export const PC_BUILD_SLOT_OPTIONS = [
  { code: "cpu", label: "CPU" },
  { code: "gpu", label: "GPU" },
  { code: "memory", label: "RAM" },
  { code: "storage", label: "Almacenamiento" },
  { code: "motherboard", label: "Placa madre" },
  { code: "power_supply", label: "Fuente (PSU)" },
] as const;

export const PC_BUILD_SLOT_CODES: ReadonlySet<string> = new Set(
  PC_BUILD_SLOT_OPTIONS.map((slot) => slot.code),
);

export const pcBuildComponentSchema = z.object({
  slot_code: z.string().trim().refine(
    (value) => PC_BUILD_SLOT_CODES.has(value),
    "Elegí un slot válido.",
  ),
  product_id: z.string().uuid("Elegí un producto."),
  variant_id: z.string().trim(),
  inventory_unit_id: z.string().trim(),
  socket: z.string().trim().max(60).optional(),
  memoryType: z.string().trim().max(60).optional(),
  watts: z.string().trim().refine((value) =>
    !value || (/^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 100000),
  "Ingresá la potencia en watts como un entero positivo.").optional(),
  quantity: z.string().trim()
    .min(1, "Ingresá la cantidad.")
    .refine((value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0;
    }, "La cantidad debe ser un número mayor a cero."),
});

export type PcBuildComponentFormInput = z.infer<typeof pcBuildComponentSchema>;

export const createPcBuildSchema = z.object({
  branchId: z.string().uuid("Elegí una sucursal."),
  customerId: z.string().uuid("Elegí un cliente."),
  title: z.string().trim()
    .min(1, "Ingresá el título del armado.")
    .max(200, "El título no puede superar los 200 caracteres."),
  notes: z.string().trim()
    .max(8000, "Las notas no pueden superar los 8000 caracteres."),
  reason: z.string().trim()
    .max(500, "El motivo no puede superar los 500 caracteres."),
  components: z.array(pcBuildComponentSchema)
    .min(1, "Agregá al menos un componente."),
});

export type CreatePcBuildFormInput = z.infer<typeof createPcBuildSchema>;

const optionalUuidSchema = z.union([
  z.literal(""),
  z.string().trim().uuid("Ingresá un UUID válido."),
]);

export const pcBuildRevisionSchema = z.object({
  specVersionId: optionalUuidSchema,
  ruleSetVersionId: optionalUuidSchema,
  components: z.array(pcBuildComponentSchema)
    .min(1, "Cargá al menos un componente para la nueva revisión."),
});

export type PcBuildRevisionFormInput = z.infer<typeof pcBuildRevisionSchema>;

export const pcBuildReserveSchema = z.object({
  locationId: z.string().uuid("Elegí una ubicación para reservar los componentes."),
  expiresAt: z.string().trim()
    .min(1, "Ingresá el vencimiento de la reserva.")
    .refine((value) => !Number.isNaN(new Date(value).getTime()), "Ingresá una fecha de vencimiento válida."),
});

export type PcBuildReserveFormInput = z.infer<typeof pcBuildReserveSchema>;

export const pcTestCheckResultSchema = z.enum(["pass", "fail"]);
export type PcTestCheckResult = z.infer<typeof pcTestCheckResultSchema>;

export const createPcBuildTestSchema = (requiredKeys: readonly string[]) =>
  z.object({
    templateVersionId: z.string().uuid("Elegí una plantilla de testeo."),
    notes: z.string().trim().max(4000, "Las notas no pueden superar los 4000 caracteres."),
    checks: z.record(z.string(), pcTestCheckResultSchema),
  }).superRefine((value, context) => {
    if (requiredKeys.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["templateVersionId"],
        message: "La plantilla elegida no tiene controles obligatorios para registrar.",
      });
      return;
    }

    const missingKeys = requiredKeys.filter((key) => !value.checks[key]);
    if (missingKeys.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["checks"],
        message: "Registrá un resultado para cada control obligatorio antes de confirmar el testeo.",
      });
    }
  });

export const buildPcTestResultsPayload = (
  requiredKeys: readonly string[],
  checks: Record<string, PcTestCheckResult>,
): Array<{ item_key: string; result: PcTestCheckResult }> =>
  requiredKeys.map((itemKey) => ({
    item_key: itemKey,
    result: checks[itemKey],
  }));

const requiredInteger = (requiredMessage: string, rule: z.ZodNumber) =>
  z.string().trim().min(1, requiredMessage).transform(Number).pipe(rule);

export const completePcBuildSchema = z.object({
  serial: z.string().trim()
    .min(1, "Ingresá el número de serie del equipo armado.")
    .max(200, "El número de serie no puede superar los 200 caracteres.")
    .refine((value) => value.replace(/[\s-]+/g, "").length > 0, "Ingresá un número de serie válido."),
  warrantyDays: requiredInteger(
    "Ingresá los días de garantía.",
    z.number({ invalid_type_error: "Ingresá un número válido de días de garantía." })
      .finite("Ingresá un número válido de días de garantía.")
      .int("Los días de garantía deben ser un número entero.")
      .min(0, "Los días de garantía no pueden ser negativos.")
      .max(3650, "La garantía no puede superar los 3650 días."),
  ),
  warrantyConditions: z.string().trim()
    .max(2000, "Las condiciones no pueden superar los 2000 caracteres."),
});

export type CompletePcBuildFormInput = z.input<typeof completePcBuildSchema>;
export type CompletePcBuildFormValues = z.output<typeof completePcBuildSchema>;

export const serializePcBuildWarranty = (
  warrantyDays: number,
  warrantyConditions: string,
): Record<string, unknown> => ({
  warranty_days: warrantyDays,
  ...(warrantyConditions ? { conditions: warrantyConditions } : {}),
});
