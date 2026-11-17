/**
 * Authoritative 4-decimal exact arithmetic matching PostgreSQL numeric(18, 4) semantics.
 * Implemented using integer scaled arithmetic (scale = 10,000) to eliminate IEEE 754
 * floating-point drift and avoid unreliable Number.EPSILON heuristics.
 */

export const SCALE = 10_000n;
export const POS_MAX_AMOUNT_ARS = 1_000_000_000; // 1e9 ARS conservative limit for POS operations

/**
 * Converts any number or numeric string to 4-decimal scaled BigInt (scale 10,000)
 * applying half-away-from-zero rounding on the 5th decimal digit.
 * Unlike toScaledBigInt, this does not enforce the POS_MAX_AMOUNT_ARS cap, allowing
 * safe calculation of totals that may exceed the cap before rejection.
 */
export const toArbitraryScaledBigInt = (
  value: number | string,
): { sign: bigint; scaled: bigint } => {
  const { sign, intStr, fracStr } = normalizeDecimalParts(value);
  const intBig = BigInt(intStr);
  const paddedFrac4 = (fracStr + "0000").slice(0, 4);
  const frac4Big = BigInt(paddedFrac4);
  const fifthDigit = fracStr.length >= 5 ? parseInt(fracStr[4], 10) : 0;
  const roundUp = fifthDigit >= 5;
  const totalFrac = frac4Big + (roundUp ? 1n : 0n);
  return { sign, scaled: sign * (intBig * SCALE + totalFrac) };
};

/**
 * Normalizes any number or numeric string into exact integer and fractional string parts,
 * expanding scientific notation safely without floating point operations.
 */
export const normalizeDecimalParts = (
  value: number | string,
): { sign: bigint; intStr: string; fracStr: string } => {
  let str: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid non-finite number: ${value}`);
    }
    str = value.toString();
  } else {
    str = value.trim();
  }

  if (str === "") {
    throw new Error("Empty decimal string");
  }

  // Handle optional leading sign
  let sign = 1n;
  if (str.startsWith("-")) {
    sign = -1n;
    str = str.slice(1);
  } else if (str.startsWith("+")) {
    str = str.slice(1);
  }

  // Handle scientific notation (e.g. 1e-4, 2.5e3)
  const eIndex = str.search(/[eE]/);
  if (eIndex !== -1) {
    const baseStr = str.slice(0, eIndex);
    const expStr = str.slice(eIndex + 1);
    const exp = parseInt(expStr, 10);
    if (isNaN(exp)) {
      throw new Error(`Invalid scientific exponent in: ${value}`);
    }

    const [bInt, bFrac = ""] = baseStr.split(".");
    if (exp === 0) {
      str = baseStr;
    } else if (exp > 0) {
      if (exp >= bFrac.length) {
        str = bInt + bFrac + "0".repeat(exp - bFrac.length);
      } else {
        str = bInt + bFrac.slice(0, exp) + "." + bFrac.slice(exp);
      }
    } else {
      // exp < 0
      const absExp = -exp;
      if (absExp <= bInt.length) {
        const splitIdx = bInt.length - absExp;
        str = bInt.slice(0, splitIdx) + "." + bInt.slice(splitIdx) + bFrac;
        if (str.startsWith(".")) str = "0" + str;
      } else {
        const leadingZeros = "0".repeat(absExp - bInt.length);
        str = "0." + leadingZeros + bInt + bFrac;
      }
    }
  }

  // Split into integer and fraction
  const dotIndex = str.indexOf(".");
  let intStr = "";
  let fracStr = "";
  if (dotIndex === -1) {
    intStr = str;
    fracStr = "";
  } else {
    intStr = str.slice(0, dotIndex);
    fracStr = str.slice(dotIndex + 1);
  }

  if (intStr === "") intStr = "0";
  // Validate that intStr and fracStr are purely digits
  if (!/^\d+$/.test(intStr) || (fracStr !== "" && !/^\d+$/.test(fracStr))) {
    throw new Error(`Invalid decimal representation: ${value}`);
  }

  return { sign, intStr, fracStr };
};

/**
 * Parses a decimal number or string directly into a 4-decimal scaled BigInt (scale 10,000)
 * applying exact half-away-from-zero rounding on any 5th decimal digit.
 * Eliminates double-rounding and floating-point precision loss.
 */
export const toScaledBigInt = (value: number | string): bigint => {
  const { sign, intStr, fracStr } = normalizeDecimalParts(value);

  const intBig = BigInt(intStr);

  // Check POS 1e9 magnitude limit (integer part alone cannot exceed 1e9)
  if (intBig > BigInt(POS_MAX_AMOUNT_ARS)) {
    throw new Error(`Amount exceeds maximum allowed POS amount of ${POS_MAX_AMOUNT_ARS.toLocaleString()} ARS`);
  }

  // First 4 decimal places
  const paddedFrac4 = (fracStr + "0000").slice(0, 4);
  const frac4Big = BigInt(paddedFrac4);

  // 5th decimal digit determines standard half-away-from-zero rounding
  const fifthDigit = fracStr.length >= 5 ? parseInt(fracStr[4], 10) : 0;
  const roundUp = fifthDigit >= 5;

  const totalFrac = frac4Big + (roundUp ? 1n : 0n);
  const absScaled = intBig * SCALE + totalFrac;

  if (absScaled > BigInt(POS_MAX_AMOUNT_ARS) * SCALE) {
    throw new Error(`Amount exceeds maximum allowed POS amount of ${POS_MAX_AMOUNT_ARS.toLocaleString()} ARS`);
  }

  return sign * absScaled;
};

export const fromScaledBigInt = (scaled: bigint): number => {
  const sign = scaled < 0n ? -1 : 1;
  const absVal = scaled < 0n ? -scaled : scaled;
  const intPart = absVal / SCALE;
  const fracPart = absVal % SCALE;
  const str = `${sign < 0 ? "-" : ""}${intPart}.${fracPart.toString().padStart(4, "0")}`;
  return parseFloat(str);
};

export const round4 = (value: number | string): number => {
  return fromScaledBigInt(toScaledBigInt(value));
};

export const add4 = (a: number | string, b: number | string): number => {
  return fromScaledBigInt(toScaledBigInt(a) + toScaledBigInt(b));
};

export const sub4 = (a: number | string, b: number | string): number => {
  return fromScaledBigInt(toScaledBigInt(a) - toScaledBigInt(b));
};

export const mul4 = (a: number | string, b: number | string): number => {
  const scaledA = toScaledBigInt(a);
  const scaledB = toScaledBigInt(b);
  const product = scaledA * scaledB;
  const sign = product < 0n ? -1n : 1n;
  const absVal = product < 0n ? -product : product;
  const quotient = absVal / SCALE;
  const remainder = absVal % SCALE;
  const roundUp = remainder * 2n >= SCALE;
  const rounded = quotient + (roundUp ? 1n : 0n);
  return fromScaledBigInt(sign * rounded);
};

export const div4 = (numerator: number | string, denominator: number | string): number => {
  const num = toScaledBigInt(numerator);
  const den = toScaledBigInt(denominator);
  if (den === 0n) {
    throw new Error("Division by zero");
  }
  const scaledNum = num * SCALE;
  const sign = scaledNum < 0n !== den < 0n ? -1n : 1n;
  const absNum = scaledNum < 0n ? -scaledNum : scaledNum;
  const absDen = den < 0n ? -den : den;
  const quotient = absNum / absDen;
  const remainder = absNum % absDen;
  const roundUp = remainder * 2n >= absDen;
  const rounded = quotient + (roundUp ? 1n : 0n);
  return fromScaledBigInt(sign * rounded);
};

/**
 * Exact rational net derivation from gross line:
 * Net = Gross / (1 + TaxRate/100) = (Gross * 100) / (100 + TaxRate)
 * netScaled = (grossScaled * 1,000,000) / (1,000,000 + taxRateScaled)
 * with exact half-away-from-zero rounding. Matches PostgreSQL numeric(18, 4) exactly.
 */
export const divideGrossByTax = (grossScaled: bigint, taxRateScaled: bigint): bigint => {
  if (taxRateScaled === 0n) {
    return grossScaled;
  }
  const numerator = grossScaled * 1_000_000n;
  const denominator = 1_000_000n + taxRateScaled;
  if (denominator <= 0n) {
    throw new Error(`Invalid tax rate denominator: ${denominator}`);
  }
  const sign = grossScaled < 0n ? -1n : 1n;
  const absNum = grossScaled < 0n ? -grossScaled * 1_000_000n : numerator;
  const quotient = absNum / denominator;
  const remainder = absNum % denominator;
  const roundUp = remainder * 2n >= denominator;
  return sign * (quotient + (roundUp ? 1n : 0n));
};

export interface LineTaxBreakdown {
  unitGrossPrice: number;
  quantity: number;
  taxRatePercent: number;
  grossSubtotal: number;
  grossDiscount: number;
  lineTotal: number;
  netSubtotal: number;
  netDiscount: number;
  taxAmount: number;
}

export const calculateGrossTaxBreakdown = (
  unitGrossPrice: number | string,
  quantity: number | string,
  taxRatePercent: number | string,
  grossDiscount: number | string = 0,
): LineTaxBreakdown => {
  const unitGrossScaled = toScaledBigInt(unitGrossPrice);
  const qtyScaled = toScaledBigInt(quantity);
  const taxRateScaled = toScaledBigInt(taxRatePercent);
  const grossDiscountScaled = toScaledBigInt(grossDiscount);

  if (unitGrossScaled < 0n) {
    throw new Error("Unit gross price cannot be negative");
  }
  if (qtyScaled <= 0n) {
    throw new Error("Quantity must be positive");
  }
  if (taxRateScaled < 0n || taxRateScaled > 100n * SCALE) {
    throw new Error("Tax rate percent must be between 0 and 100");
  }
  if (grossDiscountScaled < 0n) {
    throw new Error("Gross discount cannot be negative");
  }

  // grossSubtotalScaled = round4(quantity * unit_gross)
  const grossSubtotalProduct = qtyScaled * unitGrossScaled;
  const grossSubtotalQuotient = grossSubtotalProduct / SCALE;
  const grossSubtotalRem = grossSubtotalProduct % SCALE;
  const grossSubtotalScaled = grossSubtotalQuotient + (grossSubtotalRem * 2n >= SCALE ? 1n : 0n);

  if (grossDiscountScaled > grossSubtotalScaled) {
    throw new Error("Gross discount cannot exceed gross subtotal");
  }

  const lineTotalScaled = grossSubtotalScaled - grossDiscountScaled;

  // Exact rational derivations
  const netSubtotalScaled = divideGrossByTax(grossSubtotalScaled, taxRateScaled);
  const netDiscountScaled = divideGrossByTax(grossDiscountScaled, taxRateScaled);
  const netAfterDiscountScaled = netSubtotalScaled - netDiscountScaled;
  const taxAmountScaled = lineTotalScaled - netAfterDiscountScaled;

  return {
    unitGrossPrice: fromScaledBigInt(unitGrossScaled),
    quantity: fromScaledBigInt(qtyScaled),
    taxRatePercent: fromScaledBigInt(taxRateScaled),
    grossSubtotal: fromScaledBigInt(grossSubtotalScaled),
    grossDiscount: fromScaledBigInt(grossDiscountScaled),
    lineTotal: fromScaledBigInt(lineTotalScaled),
    netSubtotal: fromScaledBigInt(netSubtotalScaled),
    netDiscount: fromScaledBigInt(netDiscountScaled),
    taxAmount: fromScaledBigInt(taxAmountScaled),
  };
};

// ============================================================================
// Stale Quote Cart Synchronization Helper (Controller shared with POS UI)
// ============================================================================

export interface CartItemToSync {
  key: string;
  productId: string;
  variantId?: string | null;
  displayName: string;
  priceArs: number;
  taxRatePercent: number;
  quantity: number;
  availableStock: number;
}

export interface CatalogVariantForSync {
  id: string;
  effectiveGrossPrice: number;
  stock: number;
  isPriceOutOfRange?: boolean;
  priceRangeError?: string | null;
  hasOverride?: boolean;
  finalPriceArs?: number | null;
}

export interface CatalogProductForSync {
  id: string;
  name: string;
  priceArs: number;
  taxRatePercent: number;
  stock: number;
  hasVariants: boolean;
  variants?: CatalogVariantForSync[];
  isPriceOutOfRange?: boolean;
  priceRangeError?: string | null;
}

export const parsePriceSafe = (
  raw: unknown,
): { valid: boolean; price: number; error: string | null } => {
  if (raw === null || raw === undefined) {
    return { valid: true, price: 0, error: null };
  }
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) {
    return { valid: false, price: -1, error: "Precio inválido (no numérico)" };
  }
  if (num < 0) {
    return { valid: false, price: num, error: "Precio negativo inválido (< $0 ARS)" };
  }
  if (num > POS_MAX_AMOUNT_ARS) {
    return {
      valid: false,
      price: num,
      error: `Precio fuera de rango (> $${POS_MAX_AMOUNT_ARS.toLocaleString("es-AR")} ARS)`,
    };
  }
  try {
    return { valid: true, price: round4(num), error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Precio fuera de rango";
    return { valid: false, price: num, error: msg };
  }
};

export interface ResolveVariantPriceParams {
  baseGrossPrice: number;
  productPriceOutOfRange?: boolean;
  productPriceRangeError?: string | null;
  hasOverride: boolean;
  finalPriceArs?: unknown;
  priceDelta?: unknown;
}

export interface ResolvedVariantPrice {
  effectiveGrossPrice: number;
  finalPrice: number | null;
  delta: number;
  isPriceOutOfRange: boolean;
  priceRangeError: string | null;
}

export const resolveVariantPrice = (
  params: ResolveVariantPriceParams,
): ResolvedVariantPrice => {
  const {
    baseGrossPrice,
    productPriceOutOfRange = false,
    productPriceRangeError = null,
    hasOverride,
    finalPriceArs,
    priceDelta,
  } = params;

  let variantPriceOutOfRange = false;
  let variantPriceRangeError: string | null = null;
  let finalPrice: number | null = null;
  let delta = 0;
  let effectivePrice = 0;

  if (hasOverride) {
    const finalCheck = parsePriceSafe(finalPriceArs);
    finalPrice = finalCheck.price;
    if (!finalCheck.valid) {
      variantPriceOutOfRange = true;
      variantPriceRangeError = finalCheck.error;
    }
    effectivePrice = finalPrice;
  } else {
    const rawDelta = Number(priceDelta || 0);
    if (!Number.isFinite(rawDelta)) {
      variantPriceOutOfRange = true;
      variantPriceRangeError = "Delta de precio no numérico";
      delta = 0;
      effectivePrice = -1;
    } else {
      try {
        delta = round4(rawDelta);
      } catch (err: unknown) {
        variantPriceOutOfRange = true;
        variantPriceRangeError =
          err instanceof Error ? err.message : "Delta de precio fuera de rango";
        delta = 0;
        effectivePrice = -1;
      }

      if (!variantPriceOutOfRange) {
        if (productPriceOutOfRange) {
          variantPriceOutOfRange = true;
          variantPriceRangeError = productPriceRangeError;
          effectivePrice = baseGrossPrice;
        } else {
          const candidate = baseGrossPrice + delta;
          if (candidate < 0) {
            variantPriceOutOfRange = true;
            variantPriceRangeError = "Precio resultante negativo (< $0 ARS)";
            effectivePrice = candidate;
          } else if (candidate > POS_MAX_AMOUNT_ARS) {
            variantPriceOutOfRange = true;
            variantPriceRangeError = `Precio resultante fuera de rango (> $${POS_MAX_AMOUNT_ARS.toLocaleString("es-AR")} ARS)`;
            effectivePrice = candidate;
          } else {
            try {
              effectivePrice = add4(baseGrossPrice, delta);
            } catch (err: unknown) {
              variantPriceOutOfRange = true;
              variantPriceRangeError =
                err instanceof Error ? err.message : "Precio fuera de rango";
              effectivePrice = candidate;
            }
          }
        }
      }
    }
  }

  return {
    effectiveGrossPrice: effectivePrice,
    finalPrice,
    delta,
    isPriceOutOfRange: variantPriceOutOfRange,
    priceRangeError: variantPriceRangeError,
  };
};

export interface PriceChangeReport {
  key: string;
  displayName: string;
  oldPrice: number;
  newPrice: number;
  oldTaxRate: number;
  newTaxRate: number;
  priceChanged: boolean;
  taxChanged: boolean;
}

export interface SyncCartResult<T extends CartItemToSync> {
  isValid: boolean;
  error: string | null;
  errorReason?: "product_missing" | "variant_missing" | "price_out_of_range" | null;
  updatedCart: T[];
  changes: PriceChangeReport[];
  hasChanges: boolean;
  newTotalArs: number;
}

/**
 * Synchronizes cart items with refreshed catalog items and recomputes totals.
 * Pure and non-mutating. Does NOT auto-create sales or change operation keys.
 * Blocks requote if products/variants are missing or marked isPriceOutOfRange.
 * Updates availableStock even when prices and tax rates match.
 */
export const syncCartWithCatalog = <T extends CartItemToSync>(
  cart: T[],
  catalog: CatalogProductForSync[],
): SyncCartResult<T> => {
  const changes: PriceChangeReport[] = [];
  let newTotalScaled = 0n;
  const updatedCart: T[] = [];

  for (const item of cart) {
    const prod = catalog.find((p) => p.id === item.productId);
    if (!prod) {
      return {
        isValid: false,
        error: `El producto "${item.displayName}" ya no existe en el catálogo vigente.`,
        errorReason: "product_missing",
        updatedCart: cart,
        changes: [],
        hasChanges: false,
        newTotalArs: 0,
      };
    }

    let freshPrice = prod.priceArs;
    let freshTaxRate = prod.taxRatePercent;
    let freshStock = prod.stock;

    if (item.variantId) {
      if (!prod.hasVariants || !prod.variants) {
        return {
          isValid: false,
          error: `La variante solicitada para "${item.displayName}" ya no existe en el catálogo vigente.`,
          errorReason: "variant_missing",
          updatedCart: cart,
          changes: [],
          hasChanges: false,
          newTotalArs: 0,
        };
      }

      const v = prod.variants.find((variant) => variant.id === item.variantId);
      if (!v) {
        return {
          isValid: false,
          error: `La variante seleccionada para "${item.displayName}" ya no existe en el catálogo vigente.`,
          errorReason: "variant_missing",
          updatedCart: cart,
          changes: [],
          hasChanges: false,
          newTotalArs: 0,
        };
      }

      const hasOverride = Boolean(
        v.hasOverride || (v.finalPriceArs !== null && v.finalPriceArs !== undefined),
      );

      if (
        !hasOverride &&
        (prod.isPriceOutOfRange ||
          prod.priceArs < 0 ||
          prod.priceArs > POS_MAX_AMOUNT_ARS ||
          !Number.isFinite(prod.priceArs))
      ) {
        return {
          isValid: false,
          error: `La variante "${item.displayName}" hereda un precio base fuera de rango en el catálogo vigente: ${prod.priceRangeError || "precio base inválido"}.`,
          errorReason: "price_out_of_range",
          updatedCart: cart,
          changes: [],
          hasChanges: false,
          newTotalArs: 0,
        };
      }

      if (v.isPriceOutOfRange) {
        return {
          isValid: false,
          error: `La variante "${item.displayName}" tiene un precio fuera de rango en el catálogo vigente: ${v.priceRangeError || "precio inválido"}.`,
          errorReason: "price_out_of_range",
          updatedCart: cart,
          changes: [],
          hasChanges: false,
          newTotalArs: 0,
        };
      }

      freshPrice = v.effectiveGrossPrice;
      freshStock = v.stock;
    } else {
      if (
        prod.isPriceOutOfRange ||
        prod.priceArs < 0 ||
        prod.priceArs > POS_MAX_AMOUNT_ARS ||
        !Number.isFinite(prod.priceArs)
      ) {
        return {
          isValid: false,
          error: `El producto "${item.displayName}" tiene un precio fuera de rango en el catálogo vigente: ${prod.priceRangeError || "precio inválido"}.`,
          errorReason: "price_out_of_range",
          updatedCart: cart,
          changes: [],
          hasChanges: false,
          newTotalArs: 0,
        };
      }
    }

    if (!Number.isFinite(freshPrice) || freshPrice < 0 || freshPrice > POS_MAX_AMOUNT_ARS) {
      return {
        isValid: false,
        error: `El precio de "${item.displayName}" ($${freshPrice}) no es válido o está fuera de rango.`,
        errorReason: "price_out_of_range",
        updatedCart: cart,
        changes: [],
        hasChanges: false,
        newTotalArs: 0,
      };
    }

    if (!Number.isFinite(freshTaxRate) || freshTaxRate < 0 || freshTaxRate > 100) {
      return {
        isValid: false,
        error: `La alícuota de IVA de "${item.displayName}" (${freshTaxRate}%) no es válida.`,
        errorReason: "price_out_of_range",
        updatedCart: cart,
        changes: [],
        hasChanges: false,
        newTotalArs: 0,
      };
    }

    const priceChanged = round4(freshPrice) !== round4(item.priceArs);
    const taxChanged = round4(freshTaxRate) !== round4(item.taxRatePercent);

    if (priceChanged || taxChanged) {
      changes.push({
        key: item.key,
        displayName: item.displayName,
        oldPrice: round4(item.priceArs),
        newPrice: round4(freshPrice),
        oldTaxRate: round4(item.taxRatePercent),
        newTaxRate: round4(freshTaxRate),
        priceChanged,
        taxChanged,
      });
    }

    const updatedItem: T = {
      ...item,
      priceArs: round4(freshPrice),
      taxRatePercent: round4(freshTaxRate),
      availableStock: freshStock,
    };

    const itemSubtotal = mul4(updatedItem.priceArs, updatedItem.quantity);
    newTotalScaled += toArbitraryScaledBigInt(itemSubtotal).scaled;

    updatedCart.push(updatedItem);
  }

  return {
    isValid: true,
    error: null,
    errorReason: null,
    updatedCart,
    changes,
    hasChanges: changes.length > 0,
    newTotalArs: fromScaledBigInt(newTotalScaled),
  };
};

// ============================================================================
// Safe POS Cart Totals Calculation (Shared by POS UI render, checkout & schemas)
// ============================================================================

export interface CartTotalsItemInput {
  priceArs: number | string;
  quantity: number | string;
  taxRatePercent?: number | string;
  grossDiscount?: number | string;
}

export interface PosCartLineTotals {
  unitGrossPrice: number;
  quantity: number;
  taxRatePercent: number;
  grossSubtotal: number;
  grossDiscount: number;
  lineTotal: number;
  netSubtotal: number;
  netDiscount: number;
  taxAmount: number;
}

export interface PosCartTotalsResult {
  isValid: boolean;
  error: string | null;
  totalGrossArs: number;
  totalNetArs: number;
  totalTaxArs: number;
  totalUsd: number | null;
  lines: PosCartLineTotals[];
}

/**
 * Calculates cart totals and tax breakdown without throwing exceptions on numbers
 * that exceed POS_MAX_AMOUNT_ARS in aggregate or through quantity * price.
 * Pure and non-mutating. Used consistently by render, preflight checkout, and schema validation.
 */
export const calculatePosCartTotals = (
  items: CartTotalsItemInput[],
  dollarRate?: number | null,
): PosCartTotalsResult => {
  if (!items || items.length === 0) {
    return {
      isValid: true,
      error: null,
      totalGrossArs: 0,
      totalNetArs: 0,
      totalTaxArs: 0,
      totalUsd: 0,
      lines: [],
    };
  }

  let totalGrossScaled = 0n;
  let totalNetScaled = 0n;
  let totalTaxScaled = 0n;
  let hasError = false;
  let errorMessage: string | null = null;
  const lines: PosCartLineTotals[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const priceArbitrary = toArbitraryScaledBigInt(item.priceArs);
      if (priceArbitrary.scaled < 0n) {
        hasError = true;
        if (!errorMessage) errorMessage = "El precio del artículo no puede ser negativo.";
      }

      const qtyArbitrary = toArbitraryScaledBigInt(item.quantity);
      if (qtyArbitrary.scaled <= 0n) {
        hasError = true;
        if (!errorMessage) errorMessage = "La cantidad debe ser mayor a cero.";
      }

      const taxRateArbitrary =
        item.taxRatePercent !== undefined && item.taxRatePercent !== null
          ? toArbitraryScaledBigInt(item.taxRatePercent)
          : { sign: 1n, scaled: 0n };
      if (taxRateArbitrary.scaled < 0n || taxRateArbitrary.scaled > 100n * SCALE) {
        hasError = true;
        if (!errorMessage) errorMessage = "La alícuota de IVA debe estar entre 0% y 100%.";
      }

      const discountArbitrary =
        item.grossDiscount !== undefined && item.grossDiscount !== null
          ? toArbitraryScaledBigInt(item.grossDiscount)
          : { sign: 1n, scaled: 0n };
      if (discountArbitrary.scaled < 0n) {
        hasError = true;
        if (!errorMessage) errorMessage = "El descuento no puede ser negativo.";
      }

      const grossProduct = qtyArbitrary.scaled * priceArbitrary.scaled;
      const grossQuotient = grossProduct / SCALE;
      const grossRem = grossProduct % SCALE;
      const grossSubtotalScaled = grossQuotient + (grossRem * 2n >= SCALE ? 1n : 0n);

      if (discountArbitrary.scaled > grossSubtotalScaled) {
        hasError = true;
        if (!errorMessage) errorMessage = "El descuento no puede superar el subtotal de la línea.";
      }

      const lineTotalScaled = grossSubtotalScaled - discountArbitrary.scaled;

      const maxCapScaled = BigInt(POS_MAX_AMOUNT_ARS) * SCALE;
      if (lineTotalScaled > maxCapScaled) {
        hasError = true;
        if (!errorMessage) {
          errorMessage = `El subtotal de la línea supera el límite permitido de $${POS_MAX_AMOUNT_ARS.toLocaleString("es-AR")} ARS. Reduzca la cantidad para continuar.`;
        }
      }

      const netSubtotalScaled = divideGrossByTax(grossSubtotalScaled, taxRateArbitrary.scaled);
      const netDiscountScaled = divideGrossByTax(discountArbitrary.scaled, taxRateArbitrary.scaled);
      const netAfterDiscountScaled = netSubtotalScaled - netDiscountScaled;
      const taxAmountScaled = lineTotalScaled - netAfterDiscountScaled;

      lines.push({
        unitGrossPrice: fromScaledBigInt(priceArbitrary.scaled),
        quantity: fromScaledBigInt(qtyArbitrary.scaled),
        taxRatePercent: fromScaledBigInt(taxRateArbitrary.scaled),
        grossSubtotal: fromScaledBigInt(grossSubtotalScaled),
        grossDiscount: fromScaledBigInt(discountArbitrary.scaled),
        lineTotal: fromScaledBigInt(lineTotalScaled),
        netSubtotal: fromScaledBigInt(netSubtotalScaled),
        netDiscount: fromScaledBigInt(netDiscountScaled),
        taxAmount: fromScaledBigInt(taxAmountScaled),
      });

      totalGrossScaled += lineTotalScaled;
      totalNetScaled += netAfterDiscountScaled;
      totalTaxScaled += taxAmountScaled;
    } catch (err: unknown) {
      hasError = true;
      if (!errorMessage) {
        errorMessage = err instanceof Error ? err.message : "Error al calcular importes del artículo";
      }
    }
  }

  const maxAllowedScaled = BigInt(POS_MAX_AMOUNT_ARS) * SCALE;
  if (totalGrossScaled > maxAllowedScaled) {
    hasError = true;
    errorMessage = `El total del carrito ($${fromScaledBigInt(totalGrossScaled).toLocaleString("es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })} ARS) supera el límite máximo permitido de $${POS_MAX_AMOUNT_ARS.toLocaleString("es-AR")} ARS. Reduzca la cantidad o elimine artículos para continuar.`;
  }

  const totalGrossArs = fromScaledBigInt(totalGrossScaled);
  const totalNetArs = fromScaledBigInt(totalNetScaled);
  const totalTaxArs = fromScaledBigInt(totalTaxScaled);

  let totalUsd: number | null = null;
  if (dollarRate !== undefined && dollarRate !== null && Number.isFinite(dollarRate) && dollarRate > 0) {
    try {
      const rateArbitrary = toArbitraryScaledBigInt(dollarRate);
      if (rateArbitrary.scaled > 0n) {
        const scaledNum = totalGrossScaled * SCALE;
        const quotient = scaledNum / rateArbitrary.scaled;
        const remainder = scaledNum % rateArbitrary.scaled;
        const roundUp = remainder * 2n >= rateArbitrary.scaled;
        totalUsd = fromScaledBigInt(quotient + (roundUp ? 1n : 0n));
      }
    } catch {
      totalUsd = null;
    }
  }

  return {
    isValid: !hasError,
    error: hasError ? errorMessage || "El importe total supera el límite permitido" : null,
    totalGrossArs,
    totalNetArs,
    totalTaxArs,
    totalUsd,
    lines,
  };
};

/**
 * Builds payment lines for POS checkout.
 * For total = 0 (free sales / zero-total transactions), returns an empty array []
 * because schema requires positive amount (> 0) and no tender was exchanged.
 */
export const buildPosPaymentLines = (
  totalGrossArs: number,
  paymentMethodId: string,
  cashSessionId: string | null = null,
  currencyCode: string = "ARS",
): Array<{
  payment_method_id: string;
  cash_session_id: string | null;
  amount: number;
  currency_code: string;
}> => {
  if (totalGrossArs <= 0) {
    return [];
  }
  return [
    {
      payment_method_id: paymentMethodId,
      cash_session_id: cashSessionId,
      amount: totalGrossArs,
      currency_code: currencyCode,
    },
  ];
};
