import { z } from "zod";
import type { PosInvoiceSaleInput, PosSaleInput } from "./types";
import { mul4, round4, POS_MAX_AMOUNT_ARS, calculatePosCartTotals } from "./pricing";

const uuid = z.string().uuid();
const requiredText = z.string().trim().min(1);
const currencyCode = requiredText
  .length(3, "La moneda debe tener un código ISO de tres letras.")
  .transform((value) => value.toUpperCase());
const finiteAmount = z
  .number()
  .finite()
  .max(POS_MAX_AMOUNT_ARS, `El importe supera el límite permitido de $${POS_MAX_AMOUNT_ARS.toLocaleString()} ARS`);

export const ERP_BASE_CURRENCY = "ARS" as const;

export const posSaleLineSchema = z.object({
  kind: z.enum(["product", "service", "free_concept"]),
  product_id: uuid.nullable().optional(),
  variant_id: uuid.nullable().optional(),
  inventory_unit_id: uuid.nullable().optional(),
  from_location_id: uuid.nullable().optional(),
  description: requiredText.max(500),
  quantity: finiteAmount.positive(),
  unit_price: finiteAmount.nonnegative(),
  expected_unit_price: finiteAmount.nonnegative().optional(),
  expected_tax_rate: z.number().finite().min(0).max(100).optional(),
  unit_gross_price: finiteAmount.nonnegative().optional(),
  discount_amount: finiteAmount.nonnegative(),
  gross_discount_amount: finiteAmount.nonnegative().optional(),
  discount_reason: z.string().trim().max(250).nullable().optional(),
  tax_rate_percent: z.number().finite().min(0).max(100),
  tax_amount: finiteAmount.nonnegative(),
}).superRefine((line, context) => {
  if (line.kind !== "free_concept" && !line.product_id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["product_id"],
      message: "Las líneas de producto o servicio requieren un producto válido.",
    });
  }
  if (line.kind === "product" && !line.from_location_id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["from_location_id"],
      message: "Las líneas de producto requieren una ubicación de salida.",
    });
  }
  const effectiveUnit = line.unit_gross_price ?? line.unit_price;
  const effectiveSubtotal = mul4(line.quantity, effectiveUnit);
  if (effectiveSubtotal > POS_MAX_AMOUNT_ARS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["quantity"],
      message: `El subtotal de la línea supera el límite permitido de $${POS_MAX_AMOUNT_ARS.toLocaleString()} ARS`,
    });
  }
  const effectiveDiscount = round4(line.gross_discount_amount ?? line.discount_amount);
  if (effectiveDiscount > effectiveSubtotal) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["discount_amount"],
      message: "El descuento no puede superar el subtotal de la línea.",
    });
  }
});

export const posPaymentLineSchema = z.object({
  payment_method_id: uuid,
  cash_session_id: uuid.nullable(),
  amount: finiteAmount.positive(),
  currency_code: currencyCode.optional(),
});

export const saleSchema: z.ZodType<PosSaleInput> = z.object({
  branchId: uuid,
  customerId: uuid,
  currency: currencyCode,
  exchangeSnapshotId: uuid,
  operationKey: requiredText.max(120),
  reason: requiredText.max(500),
  lines: z.array(posSaleLineSchema).min(1).max(250),
  paymentLines: z.array(posPaymentLineSchema).max(20),
}).superRefine((sale, context) => {
  const totals = calculatePosCartTotals(
    sale.lines.map((l) => ({
      priceArs: l.unit_gross_price ?? l.unit_price,
      quantity: l.quantity,
      taxRatePercent: l.tax_rate_percent,
      grossDiscount: l.gross_discount_amount ?? l.discount_amount,
    })),
  );
  if (!totals.isValid) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lines"],
      message: totals.error ?? `El total de la venta supera el límite permitido de $${POS_MAX_AMOUNT_ARS.toLocaleString()} ARS`,
    });
  }
});

export const invoiceSaleSchema: z.ZodType<PosInvoiceSaleInput> = saleSchema.and(z.object({
  invoiceKind: z.enum(["fiscal", "non_fiscal"]),
}));

export type SaleFormInput = z.infer<typeof saleSchema>;

export type ExchangeRateRequirement = {
  saleCurrency: string;
  paymentCurrencies: readonly string[];
};

/**
 * The ERP base currency is ARS. A quote is only required when the sale or one
 * of its tenders introduces a non-base currency.
 */
export const requiresExternalExchangeRate = ({
  saleCurrency,
  paymentCurrencies,
}: ExchangeRateRequirement): boolean => {
  const normalizedSaleCurrency = saleCurrency.trim().toUpperCase();
  if (normalizedSaleCurrency !== ERP_BASE_CURRENCY) return true;
  return paymentCurrencies.some((currency) => currency.trim().toUpperCase() !== ERP_BASE_CURRENCY);
};

export const canSubmitWithExchangeRate = (
  requirement: ExchangeRateRequirement,
  rateToArs: number | null,
): boolean => {
  if (!requiresExternalExchangeRate(requirement)) return true;
  return rateToArs !== null && Number.isFinite(rateToArs) && rateToArs > 0;
};
