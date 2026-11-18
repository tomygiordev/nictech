import { describe, expect, it } from "vitest";
import {
  buildWarrantyTerms,
  createRepairPaymentSchema,
  deliverySchema,
  intakeFormSchema,
  laborSchema,
  partSchema,
  paymentSchema,
  repairNoteSchema,
  warrantyClaimSchema,
} from "./schemas";

const validIntake = {
  branchId: "758df8ed-05e9-48bf-a70a-29053d171a10",
  isNewCustomer: false,
  customerId: "c36c881e-d05e-4a81-9b39-f1f959afaf15",
  newCustomerName: "",
  deviceType: "Notebook",
  deviceBrand: "Lenovo",
  model: " ThinkPad T14 ",
  reportedFault: " No carga la batería. ",
  serialNumber: " ABC-123 ",
};

describe("ingreso de reparación", () => {
  it("acepta cliente existente y recorta los datos sin exigir estado estético ni accesorios", () => {
    expect(intakeFormSchema.parse(validIntake)).toEqual({
      ...validIntake,
      model: "ThinkPad T14",
      reportedFault: "No carga la batería.",
      serialNumber: "ABC-123",
    });
    expect(intakeFormSchema.safeParse({ ...validIntake, customerId: "" }).error?.issues[0]?.path).toEqual(["customerId"]);
  });

  it("pide nombre para el alta de un cliente pero permite dejar DNI y teléfono vacíos", () => {
    const newCustomer = { ...validIntake, isNewCustomer: true, customerId: "" };
    expect(intakeFormSchema.safeParse(newCustomer).error?.issues[0]?.path).toEqual(["newCustomerName"]);
    expect(intakeFormSchema.safeParse({ ...newCustomer, newCustomerName: " Ana Pérez " }).success).toBe(true);
  });

  it.each(["123456", "123456789", "DNI 38123456"])("rechaza el DNI %s", (newCustomerDni) => {
    const result = intakeFormSchema.safeParse({ ...validIntake, isNewCustomer: true, newCustomerName: "Ana Pérez", newCustomerDni });
    expect(result.error?.issues[0]).toMatchObject({ path: ["newCustomerDni"], message: "El DNI debe tener 7 u 8 dígitos." });
  });

  it.each(["3812345", "38.123.456"])("acepta el DNI %s", (newCustomerDni) => {
    expect(intakeFormSchema.safeParse({ ...validIntake, isNewCustomer: true, newCustomerName: "Ana Pérez", newCustomerDni }).success).toBe(true);
  });

  it("acepta IMEI sin serie y rechaza identificadores que el servidor normaliza a vacío", () => {
    expect(intakeFormSchema.safeParse({ ...validIntake, serialNumber: "", imei: "123456789012345" }).success).toBe(true);
    const result = intakeFormSchema.safeParse({ ...validIntake, serialNumber: " - ", imei: "sin datos" });
    expect(result.error?.issues[0]).toMatchObject({
      path: ["serialNumber"],
      message: "Ingresá el número de serie o el IMEI del equipo.",
    });
  });
});

describe("nota de reparación", () => {
  it("recorta y valida la visibilidad", () => {
    expect(repairNoteSchema.parse({ content: "  Listo  ", isPublic: true })).toEqual({ content: "Listo", isPublic: true });
  });
  it("rechaza notas vacías, extensas o sin visibilidad", () => {
    expect(repairNoteSchema.safeParse({ content: " ", isPublic: false }).success).toBe(false);
    expect(repairNoteSchema.safeParse({ content: "x".repeat(4001), isPublic: true }).success).toBe(false);
    expect(repairNoteSchema.safeParse({ content: "hola" }).success).toBe(false);
  });
});

describe("mano de obra", () => {
  const work = { description: " Diagnóstico de placa ", hours: "1.25", unitCost: "1250.50", confirmZeroCost: false };

  it("entrega horas y costo numéricos y rechaza horas cero, costo negativo y valores no finitos", () => {
    expect(laborSchema.parse(work)).toMatchObject({ description: "Diagnóstico de placa", hours: 1.25, unitCost: 1250.5 });
    expect(laborSchema.safeParse({ ...work, hours: "0", unitCost: "-1" }).error?.issues.map((issue) => issue.path[0])).toEqual(["hours", "unitCost"]);
    expect(laborSchema.safeParse({ ...work, hours: "Infinity" }).success).toBe(false);
  });

  it("distingue costo vacío de cero aunque el checkbox esté confirmado", () => {
    expect(laborSchema.safeParse({ ...work, unitCost: " ", confirmZeroCost: true }).error?.issues[0]?.path).toEqual(["unitCost"]);
    expect(laborSchema.safeParse({ ...work, unitCost: "0" }).error?.issues[0]?.path).toEqual(["confirmZeroCost"]);
    expect(laborSchema.parse({ ...work, unitCost: "0", confirmZeroCost: true }).unitCost).toBe(0);
  });
});

describe("cobro de reparación", () => {
  const payment = {
    paymentMethodId: validIntake.customerId,
    exchangeSnapshotId: validIntake.branchId,
    amount: "1500.50",
    currency: "ARS",
    cashSessionId: "",
    reason: " Seña del arreglo ",
  };

  it("requiere un importe positivo y finito", () => {
    for (const amount of ["", " ", "0", "-1", "Infinity", "abc"]) {
      expect(paymentSchema.safeParse({ ...payment, amount }).error?.issues[0]?.path).toEqual(["amount"]);
    }
    expect(paymentSchema.parse(payment)).toMatchObject({ amount: 1500.5, reason: "Seña del arreglo" });
  });

  it("valida la moneda de la cotización y que la caja requerida esté disponible", () => {
    const schema = createRepairPaymentSchema(
      [{ id: payment.paymentMethodId, requires_cash_session: true }],
      [{ id: payment.exchangeSnapshotId, quote_currency: "ARS" }],
      [{ id: "caja-centro" }],
    );
    expect(schema.safeParse({ ...payment, currency: "USD", cashSessionId: "caja-norte" }).error?.issues.map((issue) => issue.path[0]))
      .toEqual(["cashSessionId", "exchangeSnapshotId"]);
    expect(schema.safeParse({ ...payment, cashSessionId: "caja-centro" }).success).toBe(true);
  });
});

describe("consumo de repuestos", () => {
  it("valida la cantidad entera positiva y el motivo recortado de al menos cinco caracteres", () => {
    const part = { locationId: validIntake.branchId, productId: validIntake.customerId, quantity: "2", reason: " Cambio del módulo " };
    for (const quantity of ["", "1.5", "0", "-1", "Infinity"]) {
      expect(partSchema.safeParse({ ...part, quantity }).error?.issues[0]?.path).toEqual(["quantity"]);
    }
    expect(partSchema.safeParse({ ...part, reason: " abcd " }).error?.issues[0]?.path).toEqual(["reason"]);
    expect(partSchema.parse(part)).toMatchObject({ quantity: 2, reason: "Cambio del módulo" });
  });
});

describe("entrega de reparación", () => {
  const validDelivery = {
    recipientName: " Ana Pérez ",
    documentSuffix: " 1234 ",
    warrantyDays: "90",
    warrantyTerms: buildWarrantyTerms(90),
  };

  it("genera los términos de la póliza según los días elegidos y recorta campos válidos", () => {
    expect(buildWarrantyTerms(30)).toBe("Garantía de 30 días sobre mano de obra y repuestos instalados en NicTech.");
    expect(deliverySchema.parse(validDelivery)).toEqual({
      recipientName: "Ana Pérez",
      documentSuffix: "1234",
      warrantyDays: 90,
      warrantyTerms: "Garantía de 90 días sobre mano de obra y repuestos instalados en NicTech.",
    });
  });

  it("permite terminación de DNI vacía, pero exige receptor y términos cuando hay garantía", () => {
    expect(deliverySchema.safeParse({ ...validDelivery, documentSuffix: "" }).success).toBe(true);
    expect(deliverySchema.safeParse({ ...validDelivery, documentSuffix: "123456789" }).error?.issues[0]?.path).toEqual(["documentSuffix"]);
    expect(deliverySchema.safeParse({ ...validDelivery, recipientName: "  " }).error?.issues[0]?.path).toEqual(["recipientName"]);
    expect(deliverySchema.safeParse({ ...validDelivery, warrantyTerms: "  " }).error?.issues[0]?.path).toEqual(["warrantyTerms"]);
    expect(deliverySchema.safeParse({ ...validDelivery, warrantyDays: "0", warrantyTerms: "" }).success).toBe(true);
  });
});

describe("reclamo de garantía", () => {
  it("exige una póliza vigente y la descripción de la falla", () => {
    const validClaim = { warrantyId: validIntake.branchId, reportedIssue: " Volvió a apagarse solo. " };
    expect(warrantyClaimSchema.parse(validClaim)).toEqual({
      warrantyId: validIntake.branchId,
      reportedIssue: "Volvió a apagarse solo.",
    });
    expect(warrantyClaimSchema.safeParse({ warrantyId: "", reportedIssue: "   " }).error?.issues.map((issue) => issue.path[0]))
      .toEqual(["warrantyId", "reportedIssue"]);
  });
});
