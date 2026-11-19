import { describe, expect, it } from "vitest";
import {
  MAX_IMEI_DOCUMENTATION_BYTES,
  MAX_IMEI_NOTES_LENGTH,
  buildImeiFallbackDocumentation,
  createTradeInIntakeSchema,
  emptyTradeInEvaluation,
  emptyTradeInImeiFallback,
  emptyTradeInIntake,
  tradeInApplyPaymentSchema,
  tradeInEvaluationSchema,
  tradeInImeiCheckSchema,
  tradeInImeiFallbackSchema,
  tradeInRefurbishmentSchema,
  tradeInReleaseSchema,
} from "./schemas";

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_IMEI_ID = "33333333-3333-4333-8333-333333333333";
const PRODUCT_SERIAL_ID = "44444444-4444-4444-8444-444444444444";
const VARIANT_ID = "55555555-5555-4555-8555-555555555555";
const LOCATION_ID = "66666666-6666-4666-8666-666666666666";
const SALE_ID = "77777777-7777-4777-8777-777777777777";
const REPAIR_ID = "88888888-8888-4888-8888-888888888888";

const trackingLookup = (id: string) => {
  if (id === PRODUCT_IMEI_ID) return "imei" as const;
  if (id === PRODUCT_SERIAL_ID) return "serial" as const;
  return null;
};

describe("tradeins schemas", () => {
  describe("createTradeInIntakeSchema", () => {
    const schema = createTradeInIntakeSchema(trackingLookup);

    it("rechaza el formulario vacío sin defaults inventados", () => {
      const result = schema.safeParse(emptyTradeInIntake());
      expect(result.success).toBe(false);
      if (result.success) return;
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("branchId");
      expect(paths).toContain("customerId");
      expect(paths).toContain("productId");
      expect(paths).toContain("ownerName");
      expect(paths).toContain("declarationText");
      expect(paths).toContain("declaredValue");
    });

    it("exige IMEI válido para producto con seguimiento por IMEI", () => {
      const missingImei = schema.safeParse({
        ...emptyTradeInIntake(BRANCH_ID),
        customerId: CUSTOMER_ID,
        productId: PRODUCT_IMEI_ID,
        ownerName: "Ana Pérez",
        declarationText: "Equipo propio",
        declaredValue: "250000",
      });
      expect(missingImei.success).toBe(false);

      const invalidImei = schema.safeParse({
        ...emptyTradeInIntake(BRANCH_ID),
        customerId: CUSTOMER_ID,
        productId: PRODUCT_IMEI_ID,
        deviceImei: "1234",
        ownerName: "Ana Pérez",
        declarationText: "Equipo propio",
        declaredValue: "250000",
      });
      expect(invalidImei.success).toBe(false);

      const valid = schema.safeParse({
        ...emptyTradeInIntake(BRANCH_ID),
        customerId: CUSTOMER_ID,
        productId: PRODUCT_IMEI_ID,
        variantId: VARIANT_ID,
        deviceImei: "356938035643809",
        ownerName: "Ana Pérez",
        declarationText: "Equipo propio",
        declaredValue: "250000",
      });
      expect(valid.success).toBe(true);
    });

    it("exige número de serie para producto con seguimiento por serie", () => {
      const missingSerial = schema.safeParse({
        ...emptyTradeInIntake(BRANCH_ID),
        customerId: CUSTOMER_ID,
        productId: PRODUCT_SERIAL_ID,
        ownerName: "Ana Pérez",
        declarationText: "Equipo propio",
        declaredValue: "180000",
      });
      expect(missingSerial.success).toBe(false);

      const valid = schema.safeParse({
        ...emptyTradeInIntake(BRANCH_ID),
        customerId: CUSTOMER_ID,
        productId: PRODUCT_SERIAL_ID,
        deviceSerial: "SN-998877",
        ownerName: "Ana Pérez",
        declarationText: "Equipo propio",
        declaredValue: "180000",
      });
      expect(valid.success).toBe(true);
    });

    it("exige confirmación explícita cuando el valor declarado es 0", () => {
      const unconfirmed = schema.safeParse({
        ...emptyTradeInIntake(BRANCH_ID),
        customerId: CUSTOMER_ID,
        productId: PRODUCT_IMEI_ID,
        deviceImei: "356938035643809",
        ownerName: "Ana Pérez",
        declarationText: "Equipo sin valor comercial",
        declaredValue: "0",
        confirmZeroDeclaredValue: false,
      });
      expect(unconfirmed.success).toBe(false);
      if (!unconfirmed.success) {
        expect(unconfirmed.error.issues.map((i) => i.path.join("."))).toContain("confirmZeroDeclaredValue");
      }

      const confirmed = schema.safeParse({
        ...emptyTradeInIntake(BRANCH_ID),
        customerId: CUSTOMER_ID,
        productId: PRODUCT_IMEI_ID,
        deviceImei: "356938035643809",
        ownerName: "Ana Pérez",
        declarationText: "Equipo sin valor comercial",
        declaredValue: "0",
        confirmZeroDeclaredValue: true,
      });
      expect(confirmed.success).toBe(true);
    });
  });

  describe("tradeInImeiCheckSchema y tradeInImeiFallbackSchema", () => {
    it("valida proveedor IMEI", () => {
      expect(tradeInImeiCheckSchema.safeParse({ providerName: "" }).success).toBe(false);
      expect(tradeInImeiCheckSchema.safeParse({ providerName: "ENACOM" }).success).toBe(true);
    });

    it("exige estado explícito y al menos una casilla o una observación para el respaldo manual", () => {
      expect(tradeInImeiFallbackSchema.safeParse(emptyTradeInImeiFallback()).success).toBe(false);
      expect(
        tradeInImeiFallbackSchema.safeParse({
          ...emptyTradeInImeiFallback(),
          fallbackStatus: "clear",
        }).success,
      ).toBe(false);
      expect(
        tradeInImeiFallbackSchema.safeParse({
          ...emptyTradeInImeiFallback(),
          fallbackStatus: "clear",
          notes: "   ",
        }).success,
      ).toBe(false);
      expect(
        tradeInImeiFallbackSchema.safeParse({
          ...emptyTradeInImeiFallback(),
          fallbackStatus: "clear",
          notes: "a".repeat(MAX_IMEI_NOTES_LENGTH + 1),
        }).success,
      ).toBe(false);

      const withCheckbox = {
        ...emptyTradeInImeiFallback(),
        fallbackStatus: "clear",
        sellerDniVerified: true,
      };
      expect(tradeInImeiFallbackSchema.safeParse(withCheckbox).success).toBe(true);
      expect(buildImeiFallbackDocumentation(withCheckbox)).toEqual({
        dni_vendedor_verificado: true,
      });

      const withNotes = {
        ...emptyTradeInImeiFallback(),
        fallbackStatus: "not_required",
        originalInvoiceOrBox: true,
        chargerOrAccessories: true,
        notes: "Notebook solo con número de serie",
      };
      expect(tradeInImeiFallbackSchema.safeParse(withNotes).success).toBe(true);
      expect(buildImeiFallbackDocumentation(withNotes)).toEqual({
        factura_o_caja_original: true,
        cargador_accesorios: true,
        observaciones: "Notebook solo con número de serie",
      });
      expect(
        new TextEncoder().encode(JSON.stringify(buildImeiFallbackDocumentation(withNotes))).length,
      ).toBeLessThanOrEqual(MAX_IMEI_DOCUMENTATION_BYTES);
    });
  });

  describe("tradeInEvaluationSchema", () => {
    it("rechaza tasación vacía y exige confirmación explícita para valor 0", () => {
      expect(tradeInEvaluationSchema.safeParse(emptyTradeInEvaluation()).success).toBe(false);

      const zeroUnconfirmed = tradeInEvaluationSchema.safeParse({
        appraisedValue: "0",
        confirmZeroAppraisedValue: false,
        refurbEstimate: "0",
        conditionNotes: "Para repuestos",
        batteryHealth: "",
      });
      expect(zeroUnconfirmed.success).toBe(false);

      const zeroConfirmed = tradeInEvaluationSchema.safeParse({
        appraisedValue: "0",
        confirmZeroAppraisedValue: true,
        refurbEstimate: "0",
        conditionNotes: "Para repuestos",
        batteryHealth: "85",
      });
      expect(zeroConfirmed.success).toBe(true);
    });

    it("rechaza batería fuera de rango 1..100", () => {
      const badBattery = tradeInEvaluationSchema.safeParse({
        appraisedValue: "150000",
        confirmZeroAppraisedValue: false,
        refurbEstimate: "10000",
        conditionNotes: "Muy bueno",
        batteryHealth: "105",
      });
      expect(badBattery.success).toBe(false);
    });
  });

  describe("refurbishment, release y applyPayment schemas", () => {
    it("valida reacondicionamiento", () => {
      expect(
        tradeInRefurbishmentSchema.safeParse({ refurbDesc: "", refurbCost: "-1", repairOrderId: "bad" }).success,
      ).toBe(false);
      expect(
        tradeInRefurbishmentSchema.safeParse({
          refurbDesc: "Cambio de módulo",
          refurbCost: "25000",
          repairOrderId: REPAIR_ID,
        }).success,
      ).toBe(true);
    });

    it("valida depósito destino al liberar a stock", () => {
      expect(tradeInReleaseSchema.safeParse({ locationId: "no-uuid" }).success).toBe(false);
      expect(tradeInReleaseSchema.safeParse({ locationId: LOCATION_ID }).success).toBe(true);
    });

    it("valida venta destino y monto mayor a cero al aplicar pago", () => {
      expect(tradeInApplyPaymentSchema.safeParse({ saleId: SALE_ID, paymentAmount: "0" }).success).toBe(false);
      expect(tradeInApplyPaymentSchema.safeParse({ saleId: SALE_ID, paymentAmount: "120000" }).success).toBe(true);
    });
  });
});
