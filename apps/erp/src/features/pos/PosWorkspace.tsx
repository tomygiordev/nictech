import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Search,
  ShoppingCart,
  ShoppingBag,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  Banknote,
  QrCode,
  CheckCircle2,
  Receipt,
  User,
  Barcode,
  Loader2,
  RefreshCw,
  Printer,
  Layers,
} from "lucide-react";
import { WorkspaceHeader, StatePanel, FeedbackAlert } from "../../components/erp/WorkspaceUi";
import SaleReceipt from "../../components/erp/SaleReceipt";
import { formatCurrency } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { createSaleWithInvoice } from "./api";
import { getDocumentSaleReceipt } from "../documents/api";
import { canSubmitWithExchangeRate, ERP_BASE_CURRENCY } from "./schemas";
import type { InvoiceKind, PosPaymentLineInput, PosSaleLineInput } from "./types";
import type { DocumentSaleReceipt } from "../../types/DocumentSaleReceipt";

type PaymentKind = "cash" | "card" | "qr" | "transfer";

export interface PosInventoryUnit {
  id: string;
  label: string;
}

export interface PosVariantItem {
  id: string;
  code: string;
  name: string;
  priceDelta: number;
  stock: number;
  barcodes: string[];
  inventoryUnits: PosInventoryUnit[];
}

export interface PosProductItem {
  id: string;
  code: string;
  name: string;
  category: string;
  priceArs: number;
  priceUsd: number;
  stock: number;
  taxRatePercent: number;
  inventoryTracking: "none" | "quantity" | "serial" | "imei";
  hasVariants: boolean;
  variants: PosVariantItem[];
  barcodes: string[];
  inventoryUnits: PosInventoryUnit[];
}

export interface CartItem {
  key: string;
  productId: string;
  variantId?: string | null;
  variantName?: string | null;
  displayName: string;
  code: string;
  priceArs: number;
  priceUsd: number;
  quantity: number;
  availableStock: number;
  locationId: string;
  inventoryUnitId?: string | null;
  taxRatePercent: number;
}

interface RawProductData {
  id: string;
  internal_code: string;
  internal_name: string;
  base_sale_price: number | null;
  tax_rate_percent: number | null;
  inventory_tracking: "none" | "quantity" | "serial" | "imei";
  product_categories?: { name: string } | null;
  product_variants?: Array<{
    id: string;
    code: string;
    name: string;
    price_delta: number | null;
    is_active: boolean;
    product_identifiers?: Array<{ kind: string; value: string }>;
  }> | null;
  stock_balances?: Array<{
    location_id: string;
    quantity_on_hand: number;
    quantity_reserved: number;
    variant_id: string | null;
  }> | null;
}

interface BranchOption {
  id: string;
  name: string;
}

interface LocationOption {
  id: string;
  branch_id: string;
  name: string;
}

interface PaymentMethodOption {
  id: string;
  code: string;
  name: string;
  settlement_kind: string;
  requires_cash_session: boolean;
  kind: PaymentKind;
}

interface RawInventoryUnit {
  id: string;
  product_id: string;
  variant_id: string | null;
  current_location_id: string | null;
  serial_number: string | null;
  imei: string | null;
}

const posCheckoutSchema = z.object({
  branchId: z.string().uuid("Seleccioná una sucursal válida."),
  locationId: z.string().uuid("Seleccioná una ubicación de venta válida."),
  paymentMethodId: z.string().uuid("Seleccioná un medio de pago disponible."),
  invoiceKind: z.enum(["", "fiscal", "non_fiscal"]).refine(
    (value): value is InvoiceKind => value !== "",
    "Seleccioná el tipo de comprobante.",
  ),
  customerName: z.string().trim().min(1, "Ingresá el nombre del cliente.").max(120, "El nombre no puede superar 120 caracteres."),
});

type PosCheckoutValues = z.infer<typeof posCheckoutSchema>;
type PosCheckoutInput = z.input<typeof posCheckoutSchema>;

const classifyPaymentMethod = (code: string, settlementKind: string): PaymentKind | null => {
  const normalizedCode = code.trim().toUpperCase();
  const normalizedSettlement = settlementKind.trim().toLowerCase();
  if (normalizedCode.includes("TRANSFER") || normalizedCode.includes("BANK")) return "transfer";
  if (normalizedCode.includes("QR") || normalizedCode.includes("MERCADOPAGO") || normalizedSettlement === "wallet") return "qr";
  if (normalizedSettlement === "cash" || normalizedCode === "CASH") return "cash";
  if (normalizedSettlement === "card" || normalizedCode.includes("CARD")) return "card";
  return null;
};

const calculateLineTax = (unitPrice: number, quantity: number, rate: number): number =>
  Math.round(unitPrice * quantity * rate * 100) / 10_000;

const resolveOperationKey = (
  previous: { signature: string; key: string } | null,
  signature: string,
): { signature: string; key: string } => {
  if (previous?.signature === signature) return previous;
  return { signature, key: `pos-${crypto.randomUUID()}` };
};

export const PosWorkspace: React.FC = () => {
  const { organizationId } = useErpAuth();
  const [products, setProducts] = useState<PosProductItem[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [dollarRate, setDollarRate] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [submittingSale, setSubmittingSale] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [lastTicket, setLastTicket] = useState<{
    receipt: DocumentSaleReceipt;
    paymentMethod: string;
  } | null>(null);
  const operationRef = useRef<{ signature: string; key: string } | null>(null);
  const checkoutForm = useForm<PosCheckoutInput, unknown, PosCheckoutValues>({
    resolver: zodResolver(posCheckoutSchema),
    defaultValues: {
      branchId: "",
      locationId: "",
      paymentMethodId: "",
      invoiceKind: "fiscal",
      customerName: "Consumidor Final",
    },
  });
  const selectedBranchId = checkoutForm.watch("branchId");
  const selectedLocationId = checkoutForm.watch("locationId");
  const selectedPaymentMethodId = checkoutForm.watch("paymentMethodId");

  const fetchProductsAndSettings = useCallback(async () => {
    if (!organizationId) {
      setLoading(false);
      setFeedback({ type: "error", message: "No hay una organización ERP activa para operar el punto de venta." });
      return;
    }

    try {
      setLoading(true);
      const [fxResult, branchResult, locationResult, paymentResult, productResult, unitResult] = await Promise.all([
        supabase
          .from("exchange_rate_snapshots")
          .select("rate_to_base")
          .eq("organization_id", organizationId)
          .eq("quote_currency", "USD")
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("branches")
          .select("id, name")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("locations")
          .select("id, branch_id, name")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .eq("allows_sale", true)
          .order("name"),
        supabase
          .from("payment_methods")
          .select("id, code, name, settlement_kind, requires_cash_session")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("products")
          .select(`
            id,
            internal_code,
            internal_name,
            base_sale_price,
            tax_rate_percent,
            inventory_tracking,
            product_categories:product_categories!products_category_organization_fk(name),
            product_variants(id, code, name, price_delta, is_active, product_identifiers(kind, value)),
            stock_balances(location_id, quantity_on_hand, quantity_reserved, variant_id)
          `)
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .eq("can_sell", true)
          .order("internal_name"),
        supabase.rpc("list_available_inventory_units_for_pos"),
      ]);

      const firstError = [
        branchResult.error,
        locationResult.error,
        paymentResult.error,
        productResult.error,
        unitResult.error,
      ].find(Boolean);
      if (firstError) throw firstError;

      const branchOptions: BranchOption[] = branchResult.data ?? [];
      const locationOptions: LocationOption[] = locationResult.data ?? [];
      const methodOptions = (paymentResult.data || [])
        .map((method) => {
          const kind = classifyPaymentMethod(method.code, method.settlement_kind);
          if (!kind) return null;
          return { ...method, kind };
        })
        .filter((method): method is PaymentMethodOption => method !== null);

      const resolvedBranchId = branchOptions.some((branch) => branch.id === selectedBranchId)
        ? selectedBranchId
        : branchOptions[0]?.id || "";
      const branchLocations = locationOptions.filter((location) => location.branch_id === resolvedBranchId);
      const resolvedLocationId = branchLocations.some((location) => location.id === selectedLocationId)
        ? selectedLocationId
        : branchLocations[0]?.id || "";
      const resolvedPaymentId = methodOptions.some((method) => method.id === selectedPaymentMethodId)
        ? selectedPaymentMethodId
        : methodOptions[0]?.id || "";

      setBranches(branchOptions);
      setLocations(locationOptions);
      setPaymentMethods(methodOptions);
      checkoutForm.setValue("branchId", resolvedBranchId, { shouldValidate: false });
      checkoutForm.setValue("locationId", resolvedLocationId, { shouldValidate: false });
      checkoutForm.setValue("paymentMethodId", resolvedPaymentId, { shouldValidate: false });

      const rawRate = Number(fxResult.data?.rate_to_base);
      const currentRate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : null;
      setDollarRate(currentRate);

      const rawUnits: RawInventoryUnit[] = unitResult.data ?? [];
      const rawProducts: RawProductData[] = productResult.data ?? [];
      const mapped: PosProductItem[] = rawProducts.map((p) => {
        const baseArs = Number(p.base_sale_price || 0);
        const taxRatePercent = Number(p.tax_rate_percent || 0);
        const baseGross = baseArs + calculateLineTax(baseArs, 1, taxRatePercent);
        const baseUsd = currentRate ? baseGross / currentRate : 0;
        const catName = p.product_categories?.name || "General";

        const balances = p.stock_balances || [];
        const activeVariants = (p.product_variants || []).filter((v) => v.is_active);
        const hasVariants = activeVariants.length > 0;
        const productUnits = rawUnits.filter(
          (unit) => unit.product_id === p.id && unit.current_location_id === resolvedLocationId,
        );

        const variants: PosVariantItem[] = activeVariants.map((v) => {
          const varBalances = balances.filter(
            (sb) => sb.variant_id === v.id && sb.location_id === resolvedLocationId,
          );
          const variantUnits = productUnits.filter((unit) => unit.variant_id === v.id);
          const varStock = p.inventory_tracking === "serial" || p.inventory_tracking === "imei"
            ? variantUnits.length
            : varBalances.reduce(
                (sum, balance) => sum + Math.max(0, Number(balance.quantity_on_hand || 0) - Number(balance.quantity_reserved || 0)),
                0,
              );
          const barcodes = (v.product_identifiers || [])
            .map((pi) => pi.value)
            .filter(Boolean);

          return {
            id: v.id,
            code: v.code,
            name: v.name,
            priceDelta: Number(v.price_delta || 0),
            stock: varStock,
            barcodes,
            inventoryUnits: variantUnits.map((unit) => ({
              id: unit.id,
              label: unit.imei || unit.serial_number || unit.id.slice(0, 8).toUpperCase(),
            })),
          };
        });

        const simpleBalances = balances.filter(
          (sb) => !sb.variant_id && sb.location_id === resolvedLocationId,
        );
        const simpleUnits = productUnits.filter((unit) => unit.variant_id === null);
        const simpleStock = hasVariants
          ? variants.reduce((sum, v) => sum + v.stock, 0)
          : p.inventory_tracking === "serial" || p.inventory_tracking === "imei"
            ? simpleUnits.length
            : simpleBalances.reduce(
                (sum, balance) => sum + Math.max(0, Number(balance.quantity_on_hand || 0) - Number(balance.quantity_reserved || 0)),
                0,
              );

        const allBarcodes = variants.flatMap((v) => v.barcodes);

        return {
          id: p.id,
          code: p.internal_code || p.id.slice(0, 8).toUpperCase(),
          name: p.internal_name,
          category: catName,
          priceArs: baseArs,
          priceUsd: baseUsd,
          stock: simpleStock,
          taxRatePercent,
          inventoryTracking: p.inventory_tracking,
          hasVariants,
          variants,
          barcodes: allBarcodes,
          inventoryUnits: simpleUnits.map((unit) => ({
            id: unit.id,
            label: unit.imei || unit.serial_number || unit.id.slice(0, 8).toUpperCase(),
          })),
        };
      });

      setProducts(mapped);
      if (!resolvedBranchId || !resolvedLocationId) {
        setFeedback({
          type: "error",
          message: "La organización no tiene una sucursal con ubicación habilitada para venta.",
        });
      } else if (!resolvedPaymentId) {
        setFeedback({ type: "error", message: "No hay medios de pago operativos configurados." });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error al cargar catálogo ERP para POS";
      console.error("Error al cargar productos para POS:", e);
      setFeedback({ type: "error", message: msg });
    } finally {
      setLoading(false);
    }
  }, [checkoutForm, organizationId, selectedBranchId, selectedLocationId, selectedPaymentMethodId]);

  useEffect(() => {
    fetchProductsAndSettings();
  }, [fetchProductsAndSettings]);

  const categories = useMemo(() => {
    return ["all", ...Array.from(new Set(products.map((p) => p.category)))];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchCat = activeTab === "all" || p.category === activeTab;
      const q = search.toLowerCase().trim();
      if (!q) return matchCat;

      const matchSearch =
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.barcodes.some((b) => b.toLowerCase().includes(q)) ||
        p.variants.some((v) => v.name.toLowerCase().includes(q) || v.code.toLowerCase().includes(q));

      return matchCat && matchSearch;
    });
  }, [products, activeTab, search]);

  const addToCart = (
    product: PosProductItem,
    variant?: PosVariantItem,
    inventoryUnit?: PosInventoryUnit,
  ) => {
    const requiresUnit = product.inventoryTracking === "serial" || product.inventoryTracking === "imei";
    if (requiresUnit && !inventoryUnit) {
      setFeedback({
        type: "error",
        message: `Seleccioná el ${product.inventoryTracking === "imei" ? "IMEI" : "número de serie"} específico de ${product.name}.`,
      });
      return;
    }

    const key = `${product.id}:${variant ? variant.id : "base"}:${inventoryUnit?.id || "quantity"}`;
    const targetStock = variant ? variant.stock : product.stock;
    const priceArs = product.priceArs + (variant ? variant.priceDelta : 0);
    const grossPriceArs = priceArs + calculateLineTax(priceArs, 1, product.taxRatePercent);
    const priceUsd = dollarRate ? grossPriceArs / dollarRate : 0;
    const baseDisplayName = variant ? `${product.name} (${variant.name})` : product.name;
    const displayName = inventoryUnit ? `${baseDisplayName} · ${inventoryUnit.label}` : baseDisplayName;
    const displayCode = variant ? variant.code : product.code;

    setCart((prev) => {
      const existing = prev.find((item) => item.key === key);
      const currentQty = existing ? existing.quantity : 0;

      if (requiresUnit && existing) {
        setFeedback({ type: "error", message: `${displayName} ya está agregado al carrito.` });
        return prev;
      }

      if (currentQty + 1 > targetStock) {
        setFeedback({
          type: "error",
          message: `Stock insuficiente para ${displayName}. Máximo disponible: ${targetStock}`,
        });
        return prev;
      }

      if (existing) {
        return prev.map((item) =>
          item.key === key ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }

      return [
        ...prev,
        {
          key,
          productId: product.id,
          variantId: variant ? variant.id : null,
          variantName: variant ? variant.name : null,
          displayName,
          code: displayCode,
          priceArs,
          priceUsd,
          quantity: 1,
          availableStock: targetStock,
          locationId: selectedLocationId,
          inventoryUnitId: inventoryUnit?.id || null,
          taxRatePercent: product.taxRatePercent,
        },
      ];
    });
  };

  const handleBarcodeSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || !search.trim()) return;

    const term = search.trim().toLowerCase();
    for (const prod of products) {
      for (const v of prod.variants) {
        if (v.barcodes.some((b) => b.toLowerCase() === term) || v.code.toLowerCase() === term) {
          addToCart(prod, v, v.inventoryUnits[0]);
          setSearch("");
          setFeedback({ type: "success", message: `Agregado por código: ${prod.name} (${v.name})` });
          return;
        }
      }
      if (prod.code.toLowerCase() === term) {
        if (prod.hasVariants && prod.variants.length > 0) {
          const firstVariant = prod.variants[0];
          addToCart(prod, firstVariant, firstVariant.inventoryUnits[0]);
        } else {
          addToCart(prod, undefined, prod.inventoryUnits[0]);
        }
        setSearch("");
        setFeedback({ type: "success", message: `Agregado por código: ${prod.name}` });
        return;
      }
    }
  };

  const updateQuantity = (key: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((item) => {
          if (item.key === key) {
            if (item.inventoryUnitId && delta > 0) {
              setFeedback({ type: "error", message: "Los artículos serializados se venden de a una unidad identificada." });
              return item;
            }
            const nextQty = item.quantity + delta;
            if (nextQty > item.availableStock) {
              setFeedback({
                type: "error",
                message: `Stock insuficiente para ${item.displayName}. Máximo disponible: ${item.availableStock}`,
              });
              return item;
            }
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter((item): item is CartItem => item !== null);
    });
  };

  const removeFromCart = (key: string) => {
    setCart((prev) => prev.filter((item) => item.key !== key));
  };

  const clearCart = () => {
    setCart([]);
  };

  const subtotalNetArs = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.priceArs * item.quantity, 0);
  }, [cart]);

  const totalTaxArs = useMemo(() => {
    return cart.reduce(
      (acc, item) => acc + calculateLineTax(item.priceArs, item.quantity, item.taxRatePercent),
      0,
    );
  }, [cart]);

  const subtotalArs = subtotalNetArs + totalTaxArs;

  const subtotalUsd = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.priceUsd * item.quantity, 0);
  }, [cart]);

  const handleCheckout = async (values: PosCheckoutValues) => {
    if (cart.length === 0 || submittingSale) return;
    const exchangeRequirement = {
      saleCurrency: ERP_BASE_CURRENCY,
      paymentCurrencies: [ERP_BASE_CURRENCY],
    } as const;
    if (!canSubmitWithExchangeRate(exchangeRequirement, dollarRate)) {
      setFeedback({
        type: "error",
        message: "La venta incluye una conversión de moneda y requiere una cotización vigente.",
      });
      return;
    }

    const selectedMethod = paymentMethods.find((method) => method.id === values.paymentMethodId);
    if (!selectedMethod) {
      setFeedback({ type: "error", message: "El medio de pago seleccionado ya no está disponible." });
      return;
    }

    // Check available stock limits before posting
    for (const item of cart) {
      if (item.quantity > item.availableStock) {
        setFeedback({
          type: "error",
          message: `No se puede procesar: ${item.displayName} supera el stock disponible (${item.availableStock}).`,
        });
        return;
      }
      if (item.inventoryUnitId && item.quantity !== 1) {
        setFeedback({ type: "error", message: `${item.displayName} debe venderse como una unidad serializada individual.` });
        return;
      }
    }

    try {
      setSubmittingSale(true);
      setFeedback(null);

      // 1. Get or create exchange rate snapshot for ARS
      const { data: snapId, error: snapErr } = await supabase.rpc("get_or_create_exchange_snapshot", {
        target_quote_currency: ERP_BASE_CURRENCY,
      });
      if (snapErr || !snapId) {
        throw new Error(`Error al obtener snapshot de tipo de cambio: ${snapErr?.message || "Sin snapshot"}`);
      }

      // 2. Get or create POS customer
      const { data: custId, error: custErr } = await supabase.rpc("get_or_create_pos_customer", {
        p_display_name: values.customerName,
      });
      if (custErr || !custId) {
        throw new Error(`Error al identificar cliente POS: ${custErr?.message || "Sin cliente"}`);
      }

      // 3. Prepare payment lines
      let cashSessionId: string | null = null;
      if (selectedMethod.requires_cash_session) {
        const { data: sessionId, error: cashErr } = await supabase.rpc("get_or_open_pos_cash_session", {
          target_branch_id: values.branchId,
        });
        if (cashErr || !sessionId) {
          throw new Error(`Error al verificar sesión de caja para cobro en efectivo: ${cashErr?.message || "Sin caja"}`);
        }
        cashSessionId = String(sessionId);
      }
      const paymentLines = [
        {
          payment_method_id: selectedMethod.id,
          cash_session_id: cashSessionId,
          amount: subtotalArs,
          currency_code: ERP_BASE_CURRENCY,
        },
      ] satisfies PosPaymentLineInput[];

      // 4. Prepare lines for atomic create_sale
      const lines = cart.map((item) => ({
        kind: "product",
        product_id: item.productId,
        variant_id: item.variantId || null,
        inventory_unit_id: item.inventoryUnitId || null,
        from_location_id: item.locationId,
        description: item.displayName,
        quantity: item.quantity,
        unit_price: item.priceArs,
        discount_amount: 0,
        tax_rate_percent: item.taxRatePercent,
        tax_amount: calculateLineTax(item.priceArs, item.quantity, item.taxRatePercent),
      })) satisfies PosSaleLineInput[];

      const operationSignature = JSON.stringify({
        branchId: values.branchId,
        customerName: values.customerName,
        paymentMethodId: selectedMethod.id,
        invoiceKind: values.invoiceKind,
        lines,
      });
      operationRef.current = resolveOperationKey(operationRef.current, operationSignature);
      const opKey = operationRef.current.key;

      // 5. Atomic sale and internally numbered invoice; checkout does not call a provider.
      const saleResult = await createSaleWithInvoice({
        branchId: values.branchId,
        customerId: String(custId),
        currency: ERP_BASE_CURRENCY,
        exchangeSnapshotId: String(snapId),
        operationKey: opKey,
        reason: `Venta Mostrador POS - ${values.customerName}`,
        invoiceKind: values.invoiceKind,
        lines,
        paymentLines,
      });

      // Prefer the committed sale and sale_lines read back through the
      // documents.view receipt RPC. Keep a request-matched fallback if that
      // read-back fails after the transaction has already committed.
      const fallbackConfirmedAt = new Date().toISOString();
      const localReceipt: DocumentSaleReceipt = {
        sale_id: saleResult.saleId,
        document_id: saleResult.documentId,
        document_number: saleResult.documentNumber,
        branch_name: branches.find((branch) => branch.id === values.branchId)?.name ?? "Sucursal",
        invoice_kind: saleResult.invoiceKind,
        customer_display_name: values.customerName,
        customer_legal_name: values.customerName,
        currency_code: ERP_BASE_CURRENCY,
        exchange_rate: 1,
        subtotal_amount: subtotalNetArs,
        discount_amount: 0,
        tax_amount: totalTaxArs,
        total_amount: subtotalArs,
        total_ars: subtotalArs,
        confirmed_at: fallbackConfirmedAt,
        document_status: "issued",
        sale_state: null,
        payment_state: null,
        lines: lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          discount_amount: line.discount_amount,
          tax_rate_percent: line.tax_rate_percent,
          tax_amount: line.tax_amount,
          line_total: line.quantity * line.unit_price - line.discount_amount + line.tax_amount,
        })),
        payments: [{
          method_name: selectedMethod.name,
          amount: subtotalArs,
          currency_code: ERP_BASE_CURRENCY,
          occurred_at: fallbackConfirmedAt,
          reversed: false,
        }],
      };
      let receipt = localReceipt;
      try {
        receipt = await getDocumentSaleReceipt(saleResult.documentId) ?? localReceipt;
      } catch {
        // The sale is already committed. Its authoritative receipt is
        // available from Documents even if this immediate read-back fails.
      }

      setLastTicket({ receipt, paymentMethod: selectedMethod.name });
      setCart([]);
      operationRef.current = null;
      setFeedback({
        type: "success",
        message: `¡Venta completada! Comprobante ${saleResult.invoiceKind === "fiscal" ? "fiscal" : "no fiscal"} ${saleResult.documentNumber} registrado en el ERP. Stock descontado atómicamente.`,
      });

      // Reload products to reflect updated variant stock immediately
      fetchProductsAndSettings();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al procesar la venta";
      // Finding 1 fix: Do not clear cart, show error, never report false success
      setFeedback({ type: "error", message: msg });
    } finally {
      setSubmittingSale(false);
    }
  };

  const activeBranch = branches.find((branch) => branch.id === selectedBranchId);
  const activeLocation = locations.find((location) => location.id === selectedLocationId);
  const availableLocations = locations.filter((location) => location.branch_id === selectedBranchId);
  const hasTransferMethod = paymentMethods.some((method) => method.kind === "transfer");

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Punto de Venta (POS)"
        description="Registrá la venta y elegí si el comprobante será fiscal o no fiscal."
        badge={
          dollarRate
            ? `Dólar: ${formatCurrency(dollarRate, "ARS")} • ${activeBranch?.name || "Sin sucursal"}`
            : `Sin cotización USD • ${activeBranch?.name || "Sin sucursal"}`
        }
      />

      {feedback && (
        <FeedbackAlert
          type={feedback.type}
          message={feedback.message}
          onClose={() => setFeedback(null)}
        />
      )}

      {lastTicket && (
        <div
          className="flow-card"
          style={{
            border: "2px solid var(--emerald-success)",
            background: "var(--emerald-soft)",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "10px",
                  background: "var(--emerald-success)",
                  color: "#ffffff",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <CheckCircle2 size={24} />
              </div>
              <div>
                <strong style={{ fontSize: "16px", color: "var(--emerald-success)" }}>
                  ¡Venta Confirmada! #{lastTicket.receipt.document_number}
                </strong>
                <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
                  {lastTicket.receipt.customer_display_name} • {lastTicket.paymentMethod} • {formatCurrency(lastTicket.receipt.total_amount, lastTicket.receipt.currency_code)}
                </p>
                <span style={{ fontSize: "10px", color: "var(--text-light)", fontFamily: "monospace" }}>
                  ID Venta ERP: {lastTicket.receipt.sale_id}
                </span>
                <span style={{ display: "block", fontSize: "10px", color: "var(--text-light)", fontFamily: "monospace" }}>
                  {lastTicket.receipt.invoice_kind === "fiscal" ? "Comprobante fiscal" : "Comprobante no fiscal"}: {lastTicket.receipt.document_number} • Documento ERP: {lastTicket.receipt.document_id}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="pag-btn"
                onClick={() => window.print()}
                style={{
                  background: "#ffffff",
                  color: "var(--emerald-success)",
                  borderColor: "var(--emerald-border)",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Printer size={14} /> Imprimir comprobante
              </button>
              <button
                type="button"
                className="pag-btn"
                onClick={() => setLastTicket(null)}
                style={{ background: "#ffffff" }}
              >
                ✕ Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {lastTicket && <SaleReceipt receipt={lastTicket.receipt} />}

      <div className="pos-workspace-grid" style={{ gap: "24px" }}>
        {/* Left: Product Catalog & Search */}
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {/* Search & Filter Bar */}
          <div className="flow-card" style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="pag-btn"
                onClick={fetchProductsAndSettings}
                disabled={loading}
                title="Recargar catálogo"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              </button>

              <div className="flow-search-pill" style={{ flex: 1, minWidth: "240px" }}>
                <Barcode size={16} color="var(--brand-primary)" />
                <input
                  type="text"
                  placeholder="Escanear código de barras o buscar por nombre (Enter agrega)..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleBarcodeSubmit}
                />
              </div>

              <div className="horizontal-scroll-pills">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`flow-select-pill ${activeTab === cat ? "active" : ""}`}
                    onClick={() => setActiveTab(cat)}
                  >
                    {cat === "all" ? "Todos los Productos" : cat}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Product Grid */}
          {loading ? (
            <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)" }}>
              <Loader2 size={32} className="animate-spin" style={{ margin: "0 auto 12px", color: "var(--brand-primary)" }} />
              <p style={{ margin: 0, fontWeight: 600 }}>Cargando catálogo ERP en tiempo real…</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <StatePanel
              type="empty"
              title="No se encontraron productos"
              message="Verificá el término de búsqueda o seleccioná otra categoría."
            />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "16px" }}>
              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  className="flow-card"
                  style={{
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    border: "1px solid var(--border-line)",
                    transition: "transform 0.15s ease, box-shadow 0.15s ease",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                      <span style={{ fontSize: "10px", fontWeight: 800, color: "var(--text-light)", textTransform: "uppercase" }}>
                        {product.code}
                      </span>
                      <span
                        className={`flow-status-pill ${
                          product.stock > 5 ? "completed" : product.stock > 0 ? "pending" : "cancelled"
                        }`}
                        style={{ fontSize: "10px" }}
                      >
                        Stock: {product.stock}
                      </span>
                    </div>

                    <strong
                      style={{
                        fontSize: "14px",
                        fontWeight: 750,
                        color: "var(--text-main)",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        lineHeight: "1.3",
                      }}
                    >
                      {product.name}
                    </strong>

                    {/* Variants selector buttons for phone cases / multi-variant products */}
                    {product.hasVariants && product.variants.length > 0 && (
                      <div style={{ marginTop: "10px" }}>
                        <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", marginBottom: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                          <Layers size={11} /> Seleccionar variante:
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                          {product.variants.map((v) => (
                            <React.Fragment key={v.id}>
                              {product.inventoryTracking === "serial" || product.inventoryTracking === "imei" ? (
                                v.inventoryUnits.map((unit) => (
                                  <button
                                    key={unit.id}
                                    type="button"
                                    className="pag-btn"
                                    style={{ fontSize: "11px", padding: "3px 7px" }}
                                    onClick={() => addToCart(product, v, unit)}
                                    title={`Agregar ${v.name}, ${unit.label}`}
                                  >
                                    {v.name} · {unit.label}
                                  </button>
                                ))
                              ) : (
                                <button
                                  type="button"
                                  className="pag-btn"
                                  style={{
                                    fontSize: "11px",
                                    padding: "3px 7px",
                                    borderRadius: "6px",
                                    borderColor: v.stock > 0 ? "var(--brand-border)" : "var(--border-line)",
                                    background: v.stock > 0 ? "var(--brand-soft)" : "var(--canvas-bg)",
                                    color: v.stock > 0 ? "var(--brand-primary)" : "var(--text-light)",
                                    fontWeight: 700,
                                    cursor: v.stock > 0 ? "pointer" : "not-allowed",
                                  }}
                                  disabled={v.stock <= 0}
                                  onClick={() => addToCart(product, v)}
                                  title={`Agregar variante ${v.name} (Stock: ${v.stock})`}
                                >
                                  {v.name} ({v.stock})
                                </button>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    )}

                    {!product.hasVariants && (product.inventoryTracking === "serial" || product.inventoryTracking === "imei") && (
                      <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {product.inventoryUnits.map((unit) => (
                          <button
                            key={unit.id}
                            type="button"
                            className="pag-btn"
                            style={{ fontSize: "11px", padding: "3px 7px" }}
                            onClick={() => addToCart(product, undefined, unit)}
                          >
                            {product.inventoryTracking === "imei" ? "IMEI" : "Serie"}: {unit.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      marginTop: "16px",
                      paddingTop: "12px",
                      borderTop: "1px solid var(--border-light)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "16px", fontWeight: 850, color: "var(--brand-primary)" }}>
                        {formatCurrency(product.priceArs + calculateLineTax(product.priceArs, 1, product.taxRatePercent), "ARS")}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 600 }}>
                        {dollarRate ? formatCurrency(product.priceUsd, "USD") : "Cotización pendiente"}
                      </div>
                    </div>

                    {!product.hasVariants && product.inventoryTracking !== "serial" && product.inventoryTracking !== "imei" && (
                      <button
                        type="button"
                        className="header-action-btn"
                        style={{
                          width: "32px",
                          height: "32px",
                          background: "var(--brand-soft)",
                          color: "var(--brand-primary)",
                          border: "1px solid var(--brand-border)",
                        }}
                        disabled={product.stock <= 0}
                        onClick={() => addToCart(product)}
                        aria-label={`Agregar ${product.name} al carrito`}
                        title={product.stock <= 0 ? "Sin stock" : "Agregar al carrito"}
                      >
                        <Plus size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Cart & Checkout Summary */}
        <form
          onSubmit={checkoutForm.handleSubmit(handleCheckout)}
          noValidate
          className="flow-card"
          style={{
            display: "flex",
            flexDirection: "column",
            height: "fit-content",
            position: "sticky",
            top: "88px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
              paddingBottom: "12px",
              borderBottom: "1px solid var(--border-light)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <ShoppingCart size={18} color="var(--brand-primary)" />
              <strong style={{ fontSize: "16px", fontWeight: 800 }}>Carrito de Venta</strong>
              <span className="type-badge green">{cart.reduce((a, c) => a + c.quantity, 0)}</span>
            </div>

            {cart.length > 0 && (
              <button
                type="button"
                className="flow-link-btn"
                style={{ color: "var(--rose-accent)", fontSize: "11px" }}
                onClick={clearCart}
              >
                Vaciar
              </button>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="pos-branch">Sucursal</label>
              <select
                id="pos-branch"
                className="erp-form-input"
                {...checkoutForm.register("branchId", {
                  onChange: (event) => {
                    const branchId = String(event.target.value);
                    const nextLocation = locations.find((location) => location.branch_id === branchId);
                    checkoutForm.setValue("locationId", nextLocation?.id || "", { shouldValidate: true });
                    setCart([]);
                    operationRef.current = null;
                  },
                })}
              >
                <option value="">Sin sucursal</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label" htmlFor="pos-location">Ubicación de salida</label>
              <select
                id="pos-location"
                className="erp-form-input"
                {...checkoutForm.register("locationId", {
                  onChange: () => {
                    setCart([]);
                    operationRef.current = null;
                  },
                })}
              >
                <option value="">Sin ubicación habilitada</option>
                {availableLocations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </div>
          </div>
          {(checkoutForm.formState.errors.branchId || checkoutForm.formState.errors.locationId) && (
            <p role="alert" style={{ margin: "0 0 10px", color: "var(--rose-accent)", fontSize: "12px" }}>
              {checkoutForm.formState.errors.branchId?.message || checkoutForm.formState.errors.locationId?.message}
            </p>
          )}

          {/* Customer Input */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 12px",
              background: "var(--canvas-bg)",
              borderRadius: "10px",
              border: "1px solid var(--border-line)",
              marginBottom: "14px",
            }}
          >
            <User size={16} color="var(--text-muted)" />
            <input
              id="pos-customer"
              type="text"
              placeholder="Nombre del cliente (Consumidor Final)"
              aria-label="Nombre del cliente"
              {...checkoutForm.register("customerName")}
              style={{
                border: 0,
                outline: 0,
                background: "transparent",
                fontSize: "12px",
                fontWeight: 600,
                width: "100%",
              }}
            />
          </div>
          {checkoutForm.formState.errors.customerName && (
            <p role="alert" style={{ margin: "-8px 0 10px", color: "var(--rose-accent)", fontSize: "12px" }}>
              {checkoutForm.formState.errors.customerName.message}
            </p>
          )}

          <div className="erp-form-group" style={{ marginBottom: "14px" }}>
            <label className="erp-form-label" htmlFor="pos-invoice-kind">Tipo de comprobante</label>
            <select
              id="pos-invoice-kind"
              className="erp-form-input"
              {...checkoutForm.register("invoiceKind", {
                onChange: () => {
                  operationRef.current = null;
                },
              })}
            >
              <option value="">Seleccioná el tipo</option>
              <option value="fiscal">Fiscal</option>
              <option value="non_fiscal">No fiscal</option>
            </select>
            <span style={{ marginTop: "4px", fontSize: "11px", color: "var(--text-muted)" }}>
              El comprobante fiscal se registra en el ERP. La autorización CAE/CAEA de ARCA queda pendiente de integración.
            </span>
            {checkoutForm.formState.errors.invoiceKind && (
              <p role="alert" style={{ margin: "4px 0 0", color: "var(--rose-accent)", fontSize: "12px" }}>
                {checkoutForm.formState.errors.invoiceKind.message}
              </p>
            )}
          </div>

          {/* Cart Items List */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              maxHeight: "300px",
              overflowY: "auto",
              marginBottom: "16px",
            }}
          >
            {cart.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-light)" }}>
                <ShoppingBag
                  size={36}
                  style={{ margin: "0 auto 8px", opacity: 0.6, color: "var(--brand-primary)" }}
                />
                <p style={{ fontSize: "13px", margin: 0, fontWeight: 600 }}>El carrito está vacío</p>
                <p style={{ fontSize: "11px", margin: "4px 0 0" }}>Seleccioná un producto o variante para agregarlo</p>
              </div>
            ) : (
              cart.map((item) => (
                <div
                  key={item.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    background: "var(--canvas-bg)",
                    borderRadius: "10px",
                    border: "1px solid var(--border-light)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0, paddingRight: "10px" }}>
                    <strong
                      style={{
                        fontSize: "12px",
                        fontWeight: 700,
                        display: "block",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={item.displayName}
                    >
                      {item.displayName}
                    </strong>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <span style={{ fontSize: "11px", color: "var(--brand-primary)", fontWeight: 800 }}>
                        {formatCurrency(item.priceArs * item.quantity, "ARS")}
                      </span>
                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                        (disp: {item.availableStock})
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button
                      type="button"
                      style={{
                        width: "24px",
                        height: "24px",
                        borderRadius: "6px",
                        border: "1px solid var(--border-line)",
                        background: "#ffffff",
                        display: "grid",
                        placeItems: "center",
                      }}
                      onClick={() => updateQuantity(item.key, -1)}
                      aria-label="Restar 1"
                    >
                      <Minus size={12} />
                    </button>
                    <span style={{ fontSize: "12px", fontWeight: 800, minWidth: "16px", textAlign: "center" }}>
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      style={{
                        width: "24px",
                        height: "24px",
                        borderRadius: "6px",
                        border: "1px solid var(--border-line)",
                        background: "#ffffff",
                        display: "grid",
                        placeItems: "center",
                      }}
                      disabled={item.quantity >= item.availableStock}
                      onClick={() => updateQuantity(item.key, 1)}
                      aria-label="Sumar 1"
                    >
                      <Plus size={12} />
                    </button>
                    <button
                      type="button"
                      style={{
                        border: 0,
                        background: "transparent",
                        color: "var(--rose-accent)",
                        marginLeft: "4px",
                      }}
                      onClick={() => removeFromCart(item.key)}
                      aria-label="Eliminar del carrito"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Payment Methods */}
          <div style={{ marginBottom: "16px" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 800,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                display: "block",
                marginBottom: "8px",
              }}
            >
              Medio de Pago
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
              {paymentMethods.map((method) => {
                const Icon = method.kind === "cash"
                  ? Banknote
                  : method.kind === "card"
                    ? CreditCard
                    : method.kind === "qr"
                      ? QrCode
                      : Receipt;
                const isSel = selectedPaymentMethodId === method.id;
                return (
                  <button
                    key={method.id}
                    type="button"
                    className="pag-btn"
                    style={{
                      height: "44px",
                      flexDirection: "column",
                      gap: "2px",
                      background: isSel ? "var(--brand-soft)" : "var(--surface-white)",
                      borderColor: isSel ? "var(--brand-border)" : "var(--border-line)",
                      color: isSel ? "var(--brand-primary)" : "var(--text-muted)",
                      borderRadius: "10px",
                    }}
                    onClick={() => checkoutForm.setValue("paymentMethodId", method.id, { shouldValidate: true })}
                  >
                    <Icon size={14} />
                    <span style={{ fontSize: "11px", fontWeight: 700 }}>{method.name}</span>
                  </button>
                );
              })}
            </div>
            {!hasTransferMethod && (
              <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                Transferencia bancaria no está configurada como medio de pago; QR se registra por separado.
              </p>
            )}
            {checkoutForm.formState.errors.paymentMethodId && (
              <p role="alert" style={{ margin: "8px 0 0", color: "var(--rose-accent)", fontSize: "12px" }}>
                {checkoutForm.formState.errors.paymentMethodId.message}
              </p>
            )}
          </div>

          {/* Totals & Confirm */}
          <div
            style={{
              padding: "14px",
              background: "var(--canvas-bg)",
              borderRadius: "12px",
              border: "1px solid var(--border-line)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: "4px",
              }}
            >
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600 }}>Total en Pesos:</span>
              <strong style={{ fontSize: "20px", fontWeight: 900, color: "var(--text-main)" }}>
                {formatCurrency(subtotalArs, "ARS")}
              </strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: "11px", color: "var(--text-light)", fontWeight: 600 }}>Neto / IVA:</span>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-muted)" }}>
                {formatCurrency(subtotalNetArs, "ARS")} / {formatCurrency(totalTaxArs, "ARS")}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: "11px", color: "var(--text-light)", fontWeight: 600 }}>Equivalente USD:</span>
              <span style={{ fontSize: "13px", fontWeight: 800, color: "var(--brand-primary)" }}>
                {dollarRate ? formatCurrency(subtotalUsd, "USD") : "Sin cotización"}
              </span>
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary btn-block"
            style={{ marginTop: "14px", height: "46px", fontSize: "14px", fontWeight: 850 }}
            disabled={cart.length === 0 || submittingSale || !activeLocation}
          >
            {submittingSale ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Procesando Venta ERP…
              </>
            ) : (
              <>
                <Receipt size={18} /> Cobrar y Emitir Comprobante
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
