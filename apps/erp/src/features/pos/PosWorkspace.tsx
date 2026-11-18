import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
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
  Receipt,
  User,
  Barcode,
  Loader2,
  RefreshCw,
  Layers,
} from "lucide-react";
import { WorkspaceHeader, StatePanel, FeedbackAlert } from "../../components/erp/WorkspaceUi";
import { formatCurrency, formatPosCurrency } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { canSubmitWithExchangeRate, ERP_BASE_CURRENCY } from "./schemas";
import {
  calculatePosCartTotals,
  div4,
  mul4,
  POS_MAX_AMOUNT_ARS,
  parsePriceSafe,
} from "./pricing";
import { PosCoordinator } from "./posCoordinator";
import { runPosCatalogFetch, type PosCatalogOwner } from "./posCatalogFlow";
import { listPosCatalogQuotes, posQuoteKey, type CreateSaleWithInvoiceResult } from "./api";
import {
  recoverConfirmedTicket,
  type ConfirmedTicketState,
} from "./posReceiptFlow";
import { PosReceiptPanel } from "./PosReceiptPanel";
import type { InvoiceKind } from "./types";

type PaymentKind = "cash" | "card" | "qr" | "transfer";

export interface PosInventoryUnit {
  id: string;
  label: string;
}

export interface PosVariantItem {
  id: string;
  code: string;
  name: string;
  effectiveGrossPrice: number;
  promotionListPriceArs?: number;
  stock: number;
  barcodes: string[];
  inventoryUnits: PosInventoryUnit[];
  isPriceOutOfRange?: boolean;
  priceRangeError?: string | null;
}

export interface PosProductItem {
  id: string;
  code: string;
  name: string;
  category: string;
  priceArs: number;
  promotionListPriceArs?: number;
  priceUsd: number;
  stock: number;
  taxRatePercent: number;
  inventoryTracking: "none" | "quantity" | "serial" | "imei";
  hasVariants: boolean;
  variants: PosVariantItem[];
  barcodes: string[];
  inventoryUnits: PosInventoryUnit[];
  isPriceOutOfRange?: boolean;
  priceRangeError?: string | null;
}

export interface CartItem {
  key: string;
  productId: string;
  variantId?: string | null;
  variantName?: string | null;
  displayName: string;
  code: string;
  priceArs: number;
  promotionListPriceArs?: number;
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
  inventory_tracking: "none" | "quantity" | "serial" | "imei";
  product_categories?: { name: string } | null;
  product_variants?: Array<{
    id: string;
    code: string;
    name: string;
    is_active: boolean;
    product_identifiers?: Array<{ kind: string; value: string; is_active?: boolean }>;
  }> | null;
  stock_balances?: Array<{
    location_id: string;
    quantity_on_hand: number;
    quantity_reserved: number;
    variant_id: string | null;
  }> | null;
}

function PosAmount({ amount, list }: { amount: number; list?: number }) {
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 6px" }}>
      {list !== undefined && (
        <del title="Precio de lista" style={{ color: "var(--text-muted)", fontSize: "0.85em", fontWeight: 500 }}>
          {formatPosCurrency(list, "ARS")}
        </del>
      )}
      <span>{formatPosCurrency(amount, "ARS")}</span>
    </span>
  );
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

export interface PosWorkspaceProps {
  coordinator?: PosCoordinator;
}

export const PosWorkspace: React.FC<PosWorkspaceProps> = ({ coordinator: externalCoordinator }) => {
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
  const [staleQuoteDetected, setStaleQuoteDetected] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [lastTicket, setLastTicket] = useState<ConfirmedTicketState | null>(null);
  const coordinatorRef = useRef<PosCoordinator | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = externalCoordinator || new PosCoordinator({
      organizationId,
      branchId: "",
      locationId: "",
    });
  }
  const coordinator = externalCoordinator || coordinatorRef.current;

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

  useLayoutEffect(() => {
    if (organizationId !== coordinator.getCurrentContext().organizationId) {
      coordinator.notifyContextChanged({
        organizationId,
        branchId: "",
        locationId: "",
      });
      coordinator.notifyCartCleared();
      setCart([]);
    }
  }, [coordinator, organizationId]);

  const fetchProductsAndSettings = useCallback(async (owner?: PosCatalogOwner): Promise<PosProductItem[] | null> => {
    if (!organizationId) {
      setLoading(false);
      setFeedback({ type: "error", message: "No hay una organización ERP activa para operar el punto de venta." });
      return null;
    }

    return runPosCatalogFetch(coordinator, {
      owner,
      onLoading: setLoading,
      onError: (message) => setFeedback({ type: "error", message }),
      load: async () => {
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
            inventory_tracking,
            product_categories:product_categories!products_category_organization_fk(name),
            product_variants(id, code, name, is_active, product_identifiers(kind, value, is_active)),
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

      const currentCtx = coordinator.getCurrentContext();
      const resolvedBranchId = branchOptions.some((branch) => branch.id === currentCtx.branchId)
        ? currentCtx.branchId
        : branchOptions[0]?.id || "";
      const branchLocations = locationOptions.filter((location) => location.branch_id === resolvedBranchId);
      const resolvedLocationId = branchLocations.some((location) => location.id === currentCtx.locationId)
        ? currentCtx.locationId
        : branchLocations[0]?.id || "";
      const resolvedPaymentId = methodOptions.some((method) => method.id === selectedPaymentMethodId)
        ? selectedPaymentMethodId
        : methodOptions[0]?.id || "";

      const rawRate = Number(fxResult.data?.rate_to_base);
      const currentRate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : null;

      const rawUnits: RawInventoryUnit[] = unitResult.data ?? [];
      const rawProducts: RawProductData[] = productResult.data ?? [];
      const quotes = await listPosCatalogQuotes(rawProducts.map((product) => product.id));
      const priceFor = (productId: string, variantId?: string) => {
        const quote = quotes.get(posQuoteKey(productId, variantId));
        const checked = quote ? parsePriceSafe(quote.final_price_ars) : {
          price: -1, valid: false, error: "Precio POS no disponible",
        };
        return {
          ...checked,
          taxRatePercent: quote?.tax_rate_percent ?? 0,
          promotionListPriceArs: quote?.promotion_id ? quote.list_price_ars : undefined,
        };
      };

      const mapped: PosProductItem[] = rawProducts.map((p) => {
        const base = priceFor(p.id);
        const baseUsd = currentRate && base.valid ? div4(base.price, currentRate) : 0;
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
            .filter((pi) => pi.kind === "barcode" && pi.is_active !== false)
            .map((pi) => pi.value)
            .filter(Boolean);

          const price = priceFor(p.id, v.id);

          return {
            id: v.id,
            code: v.code,
            name: v.name,
            effectiveGrossPrice: price.price,
            promotionListPriceArs: price.promotionListPriceArs,
            stock: varStock,
            barcodes,
            inventoryUnits: variantUnits.map((unit) => ({
              id: unit.id,
              label: unit.imei || unit.serial_number || unit.id.slice(0, 8).toUpperCase(),
            })),
            isPriceOutOfRange: !price.valid,
            priceRangeError: price.error,
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
          priceArs: base.price,
          priceUsd: baseUsd,
          promotionListPriceArs: base.promotionListPriceArs,
          stock: simpleStock,
          taxRatePercent: base.taxRatePercent,
          inventoryTracking: p.inventory_tracking,
          hasVariants,
          variants,
          barcodes: allBarcodes,
          inventoryUnits: simpleUnits.map((unit) => ({
            id: unit.id,
            label: unit.imei || unit.serial_number || unit.id.slice(0, 8).toUpperCase(),
          })),
          isPriceOutOfRange: !base.valid,
          priceRangeError: base.error,
        };
      });

      return { mapped, branchOptions, locationOptions, methodOptions, currentRate,
        resolvedBranchId, resolvedLocationId, resolvedPaymentId };
      },
      apply: ({ mapped, branchOptions, locationOptions, methodOptions, currentRate,
        resolvedBranchId, resolvedLocationId, resolvedPaymentId }) => {
      // Adopt defaults in ONE validated synchronous block:
      // Update coordinator internal context before form so coordinator authority is updated first
      coordinator.notifyContextChanged({
        organizationId,
        branchId: resolvedBranchId,
        locationId: resolvedLocationId,
      });
      coordinator.markContextLoaded();

      checkoutForm.setValue("branchId", resolvedBranchId, { shouldValidate: false });
      checkoutForm.setValue("locationId", resolvedLocationId, { shouldValidate: false });
      checkoutForm.setValue("paymentMethodId", resolvedPaymentId, { shouldValidate: false });

      setBranches(branchOptions);
      setLocations(locationOptions);
      setPaymentMethods(methodOptions);
      setDollarRate(currentRate);
      setProducts(mapped);

      if (!resolvedBranchId || !resolvedLocationId) {
        setFeedback({
          type: "error",
          message: "La organización no tiene una sucursal con ubicación habilitada para venta.",
        });
      } else if (!resolvedPaymentId) {
        setFeedback({ type: "error", message: "No hay medios de pago operativos configurados." });
      }
      return mapped;
      },
    });
  }, [checkoutForm, organizationId, selectedPaymentMethodId, coordinator]);

  useEffect(() => {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    if (coordinator.isContextLoaded()) {
      return;
    }
    coordinator.requestAutoFetch(async (token) => {
      await fetchProductsAndSettings({ kind: "fetch", token });
    });
  }, [coordinator, organizationId, fetchProductsAndSettings]);

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
    if (coordinator.isCheckoutActive() || submittingSale) return;
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
    const priceArs = variant ? variant.effectiveGrossPrice : product.priceArs;
    const isOutOfRange = variant ? variant.isPriceOutOfRange : product.isPriceOutOfRange;
    const rangeError = variant ? variant.priceRangeError : product.priceRangeError;
    if (isOutOfRange || !parsePriceSafe(priceArs).valid) {
      setFeedback({
        type: "error",
        message: rangeError || `El artículo ${product.name} tiene un precio fuera de rango permitido.`,
      });
      return;
    }
    const baseDisplayName = variant ? `${product.name} (${variant.name})` : product.name;
    const displayName = inventoryUnit ? `${baseDisplayName} · ${inventoryUnit.label}` : baseDisplayName;
    const displayCode = variant ? variant.code : product.code;

    coordinator.notifyCartModified();
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
          promotionListPriceArs: variant ? variant.promotionListPriceArs : product.promotionListPriceArs,
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
    if (coordinator.isCheckoutActive() || submittingSale) return;
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
    if (coordinator.isCheckoutActive() || submittingSale) return;
    coordinator.notifyCartModified();
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
    if (coordinator.isCheckoutActive() || submittingSale) return;
    coordinator.notifyCartModified();
    setCart((prev) => prev.filter((item) => item.key !== key));
  };

  const clearCart = () => {
    if (coordinator.isCheckoutActive() || submittingSale) return;
    coordinator.notifyCartCleared();
    setCart([]);
  };

  const cartTotals = useMemo(() => {
    return calculatePosCartTotals(
      cart.map((item) => ({
        priceArs: item.priceArs,
        quantity: item.quantity,
        taxRatePercent: item.taxRatePercent,
        grossDiscount: 0,
      })),
      dollarRate,
    );
  }, [cart, dollarRate]);

  const subtotalArs = cartTotals.totalGrossArs;
  const subtotalNetArs = cartTotals.totalNetArs;
  const totalTaxArs = cartTotals.totalTaxArs;
  const subtotalUsd = cartTotals.totalUsd ?? 0;

  const handleRecover = async (targetDocumentId: string): Promise<void> => {
    await recoverConfirmedTicket(targetDocumentId, setLastTicket);
  };

  const handleRetryUncertain = async () => {
    const attempt = coordinator.getFinancialAttempt();
    if (!attempt || attempt.status !== "uncertain" || attempt.origin.organizationId !== organizationId) return;
    await coordinator.retryUncertainSale({
      onConfirmed: (result) => setLastTicket({ info: result, receipt: null,
        saleOrgId: attempt.origin.organizationId }),
      onSuccess: (result, receipt) => {
        setLastTicket({ info: result, receipt, saleOrgId: attempt.origin.organizationId,
          recoveryError: receipt ? null : "Venta confirmada. Puede recuperar el comprobante sin volver a cobrar." });
        setFeedback({ type: "success", message: `Venta confirmada: ${result.documentNumber}.` });
      },
      onError: (error) => setFeedback({ type: "error", message: error.message }),
      onClearCart: () => setCart([]),
      onSetSubmittingSale: setSubmittingSale,
      onAfterSaleFetch: () => coordinator.requestAutoFetch(async (token) => {
        await fetchProductsAndSettings({ kind: "fetch", token });
      }),
    });
  };

  const handleCheckout = async (values: PosCheckoutValues) => {
    if (cart.length === 0) return;
    if (submittingSale || coordinator.isCheckoutActive() || coordinator.isRequoteActive()) return;
    const pendingAttempt = coordinator.getFinancialAttempt();
    if (pendingAttempt && ["uncertain", "dispatched"].includes(pendingAttempt.status)) {
      setFeedback({ type: "error", message: "Resuelva el cobro pendiente antes de iniciar otra venta." });
      return;
    }
    if (staleQuoteDetected) {
      setFeedback({ type: "error", message: "Actualice los precios del carrito antes de volver a cobrar." });
      return;
    }

    if (!cartTotals.isValid) {
      setFeedback({
        type: "error",
        message:
          cartTotals.error ||
          `El importe total supera el límite permitido de $${POS_MAX_AMOUNT_ARS.toLocaleString("es-AR")} ARS.`,
      });
      return;
    }
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

    await coordinator.coordinateCheckout({
      values,
      cart,
      subtotalArs,
      selectedPaymentMethod: selectedMethod,
      dollarRate,
      getExchangeSnapshotFn: async (quoteCurrency) => {
        const { data, error } = await supabase.rpc("get_or_create_exchange_snapshot", {
          target_quote_currency: quoteCurrency,
        });
        if (error || !data) throw new Error(`Error al obtener snapshot de tipo de cambio: ${error?.message || "Sin snapshot"}`);
        return String(data);
      },
      getPosCustomerFn: async (displayName) => {
        const { data, error } = await supabase.rpc("get_or_create_pos_customer", {
          p_display_name: displayName,
        });
        if (error || !data) throw new Error(`Error al identificar cliente POS: ${error?.message || "Sin cliente"}`);
        return String(data);
      },
      getCashSessionFn: async (branchId) => {
        const { data, error } = await supabase.rpc("get_or_open_pos_cash_session", {
          target_branch_id: branchId,
        });
        if (error || !data) throw new Error(`Error al verificar sesión de caja para cobro en efectivo: ${error?.message || "Sin caja"}`);
        return String(data);
      },
      onConfirmed: (saleResult) => {
        const res = saleResult as CreateSaleWithInvoiceResult;
        setLastTicket({
          info: {
            saleId: res.saleId,
            documentId: res.documentId,
            documentNumber: res.documentNumber,
            invoiceKind: res.invoiceKind,
          },
          receipt: null,
          saleOrgId: organizationId,
        });
      },
      onSuccess: (saleResult, receipt) => {
        const res = saleResult as CreateSaleWithInvoiceResult;
        setLastTicket({
          info: {
            saleId: res.saleId,
            documentId: res.documentId,
            documentNumber: res.documentNumber,
            invoiceKind: res.invoiceKind,
          },
          receipt: receipt || null,
          saleOrgId: organizationId,
          recoveryError: receipt
            ? null
            : `Venta confirmada en ERP (${res.documentNumber}). No se pudo obtener el comprobante para impresión. Podés recuperarlo ahora.`,
        });
        setFeedback({
          type: "success",
          message: `¡Venta completada! Comprobante ${res.invoiceKind === "fiscal" ? "fiscal" : "no fiscal"} ${res.documentNumber} registrado en el ERP. Stock descontado atómicamente.`,
        });
      },
      onError: (err) => {
        const norm = typeof err === "string" ? { message: err, isStaleQuote: false } : err;
        if (norm.isStaleQuote) {
          setStaleQuoteDetected(true);
        }
        setFeedback({ type: "error", message: norm.message });
      },
      onClearCart: () => setCart([]),
      onSetStaleQuoteDetected: (stale) => setStaleQuoteDetected(stale),
      onSetSubmittingSale: (submitting) => setSubmittingSale(submitting),
      onAfterSaleFetch: () => coordinator.requestAutoFetch(async (token) => { await fetchProductsAndSettings({ kind: "fetch", token }); }),
    });
  };

  const handleSyncCartWithCatalog = async () => {
    if (coordinator.isCheckoutActive() || coordinator.isRequoteActive() || coordinator.isFetchActive() || submittingSale) return;
    await coordinator.coordinateRequote({
      cart,
      fetchCatalog: (requoteToken) => fetchProductsAndSettings(requoteToken === undefined ? undefined : { kind: "requote", token: requoteToken }),
      onApplyCart: (updatedCart) => setCart(updatedCart),
      onApplyFeedback: (fb) => setFeedback(fb),
      onSetStaleQuoteDetected: (stale) => setStaleQuoteDetected(stale),
      onSetLoading: (ld) => setLoading(ld),
    });
  };

  const financialAttempt = coordinator.getFinancialAttempt();
  const hasUnresolvedAttempt = financialAttempt?.status === "uncertain" || financialAttempt?.status === "dispatched";
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

      {hasUnresolvedAttempt && (
        <div role="status" className="erp-alert erp-alert-warning">
          <p>Hay un cobro con resultado incierto. No inicie otra venta hasta resolverlo.</p>
          {financialAttempt?.origin.organizationId !== organizationId ? (
            <p>Vuelva a la organización de origen para reintentar el mismo cobro.</p>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => { void handleRetryUncertain(); }}
              disabled={loading || submittingSale || !coordinator.isIdle()}>
              Reintentar cobro pendiente
            </button>
          )}
        </div>
      )}
      {lastTicket && (!lastTicket.saleOrgId || lastTicket.saleOrgId === organizationId) && (
        <PosReceiptPanel
          key={lastTicket.info.documentId}
          ticket={lastTicket}
          onClose={() => setLastTicket(null)}
          onRecover={handleRecover}
        />
      )}

      {lastTicket && lastTicket.saleOrgId && lastTicket.saleOrgId !== organizationId && (
        <div style={{ padding: "12px 16px", background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.3)", borderRadius: "8px", color: "var(--amber-accent, #f59e0b)", fontSize: "13px", marginBottom: "16px" }}>
          El comprobante emitido ({lastTicket.info.documentNumber}) corresponde a otra organización. Vuelva a la organización original para consultarlo o imprimirlo.
        </div>
      )}

      <div className="pos-workspace-grid" style={{ gap: "24px" }}>
        {/* Left: Product Catalog & Search */}
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {/* Search & Filter Bar */}
          <div className="flow-card" style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="pag-btn"
                onClick={() => { void fetchProductsAndSettings(); }}
                disabled={loading || coordinator.isCheckoutActive() || coordinator.isRequoteActive() || submittingSale}
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
                  disabled={coordinator.isCheckoutActive() || submittingSale}
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

                    {/* Variants selector buttons */}
                    {product.hasVariants && product.variants.length > 0 && (
                      <div style={{ marginTop: "10px" }}>
                        <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", marginBottom: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                          <Layers size={11} /> Seleccionar variante:
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                          {product.variants.map((v) => (
                            <React.Fragment key={v.id}>
                              {product.inventoryTracking === "serial" || product.inventoryTracking === "imei" ? (
                                v.inventoryUnits.map((unit) => {
                                  const isInvalidPrice = v.isPriceOutOfRange || v.effectiveGrossPrice < 0;
                                  return (
                                    <button
                                      key={unit.id}
                                      type="button"
                                      className="pag-btn"
                                      style={{
                                        fontSize: "11px",
                                        padding: "3px 7px",
                                        borderColor: isInvalidPrice ? "var(--rose-accent, #f43f5e)" : undefined,
                                        background: isInvalidPrice ? "var(--rose-soft, #fff1f2)" : undefined,
                                        color: isInvalidPrice ? "var(--rose-accent, #e11d48)" : undefined,
                                        cursor: isInvalidPrice ? "not-allowed" : "pointer",
                                      }}
                                      disabled={isInvalidPrice || coordinator.isCheckoutActive() || submittingSale}
                                      onClick={() => addToCart(product, v, unit)}
                                      title={
                                        isInvalidPrice
                                          ? (v.priceRangeError || `Precio fuera de rango (${v.effectiveGrossPrice})`)
                                          : `Agregar ${v.name}, ${unit.label}`
                                      }
                                    >
                                      {v.name} · {unit.label}
                                      {!isInvalidPrice && v.promotionListPriceArs !== undefined && (
                                        <> · <PosAmount amount={v.effectiveGrossPrice} list={v.promotionListPriceArs} /></>
                                      )}
                                    </button>
                                  );
                                })
                              ) : (
                                (() => {
                                  const isInvalidPrice = v.isPriceOutOfRange || v.effectiveGrossPrice < 0;
                                  return (
                                    <button
                                      type="button"
                                      className="pag-btn"
                                      style={{
                                        fontSize: "11px",
                                        padding: "3px 7px",
                                        borderRadius: "6px",
                                        borderColor: isInvalidPrice
                                          ? "var(--rose-accent, #f43f5e)"
                                          : v.stock > 0
                                            ? "var(--brand-border)"
                                            : "var(--border-line)",
                                        background: isInvalidPrice
                                          ? "var(--rose-soft, #fff1f2)"
                                          : v.stock > 0
                                            ? "var(--brand-soft)"
                                            : "var(--canvas-bg)",
                                        color: isInvalidPrice
                                          ? "var(--rose-accent, #e11d48)"
                                          : v.stock > 0
                                            ? "var(--brand-primary)"
                                            : "var(--text-light)",
                                        fontWeight: 700,
                                        cursor: isInvalidPrice || v.stock <= 0 ? "not-allowed" : "pointer",
                                      }}
                                      disabled={v.stock <= 0 || isInvalidPrice || coordinator.isCheckoutActive() || submittingSale}
                                      onClick={() => addToCart(product, v)}
                                      title={
                                        isInvalidPrice
                                          ? (v.priceRangeError || `Precio inválido (${v.effectiveGrossPrice})`)
                                          : `Agregar variante ${v.name} (Stock: ${v.stock})`
                                      }
                                    >
                                      {v.name} {isInvalidPrice ? `(${v.priceRangeError ? "Fuera de rango" : "Inválido"})` : `(${v.stock})`}
                                      {!isInvalidPrice && v.promotionListPriceArs !== undefined && (
                                        <> · <PosAmount amount={v.effectiveGrossPrice} list={v.promotionListPriceArs} /></>
                                      )}
                                    </button>
                                  );
                                })()
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
                            disabled={coordinator.isCheckoutActive() || submittingSale}
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
                      <div
                        style={{
                          fontSize: "16px",
                          fontWeight: 850,
                          color: product.isPriceOutOfRange ? "var(--rose-accent, #e11d48)" : "var(--brand-primary)",
                        }}
                      >
                        {product.isPriceOutOfRange
                          ? (product.priceRangeError || "Precio fuera de rango")
                          : <PosAmount amount={product.priceArs} list={product.promotionListPriceArs} />}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 600 }}>
                        {product.isPriceOutOfRange
                          ? "Artículo bloqueado en POS"
                          : dollarRate
                            ? formatCurrency(product.priceUsd, "USD")
                            : "Cotización pendiente"}
                      </div>
                    </div>

                    {!product.hasVariants && product.inventoryTracking !== "serial" && product.inventoryTracking !== "imei" && (
                      <button
                        type="button"
                        className="header-action-btn"
                        style={{
                          width: "32px",
                          height: "32px",
                          background: product.isPriceOutOfRange ? "var(--rose-soft, #fff1f2)" : "var(--brand-soft)",
                          color: product.isPriceOutOfRange ? "var(--rose-accent, #e11d48)" : "var(--brand-primary)",
                          border: product.isPriceOutOfRange ? "1px solid var(--rose-accent, #f43f5e)" : "1px solid var(--brand-border)",
                        }}
                        disabled={product.stock <= 0 || product.priceArs < 0 || product.isPriceOutOfRange || coordinator.isCheckoutActive() || submittingSale}
                        onClick={() => addToCart(product)}
                        aria-label={`Agregar ${product.name} al carrito`}
                        title={
                          product.isPriceOutOfRange
                            ? (product.priceRangeError || "Precio fuera de rango")
                            : product.priceArs < 0
                              ? "Precio negativo inválido"
                              : product.stock <= 0
                                ? "Sin stock"
                                : "Agregar al carrito"
                        }
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
                disabled={coordinator.isCheckoutActive() || submittingSale}
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
                disabled={coordinator.isCheckoutActive() || submittingSale}
                {...checkoutForm.register("branchId", {
                  onChange: (event) => {
                    if (coordinator.isCheckoutActive() || submittingSale) return;
                    const branchId = String(event.target.value);
                    const nextLocation = locations.find((location) => location.branch_id === branchId);
                    const nextLocationId = nextLocation?.id || "";
                    checkoutForm.setValue("locationId", nextLocationId, { shouldValidate: true });
                    coordinator.notifyContextChanged({
                      organizationId,
                      branchId,
                      locationId: nextLocationId,
                    });
                    coordinator.notifyCartCleared();
                    setCart([]);
                    coordinator.requestAutoFetch(async (token) => {
                      await fetchProductsAndSettings({ kind: "fetch", token });
                    });
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
                disabled={coordinator.isCheckoutActive() || submittingSale}
                {...checkoutForm.register("locationId", {
                  onChange: (event) => {
                    if (coordinator.isCheckoutActive() || submittingSale) return;
                    const locationId = String(event.target.value);
                    coordinator.notifyContextChanged({
                      organizationId,
                      branchId: selectedBranchId,
                      locationId,
                    });
                    coordinator.notifyCartCleared();
                    setCart([]);
                    coordinator.requestAutoFetch(async (token) => {
                      await fetchProductsAndSettings({ kind: "fetch", token });
                    });
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
              disabled={coordinator.isCheckoutActive() || submittingSale}
              {...checkoutForm.register("customerName", {
                onChange: () => { if (!coordinator.isCheckoutActive()) coordinator.notifyCartModified(); },
              })}
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
              disabled={coordinator.isCheckoutActive() || submittingSale}
              {...checkoutForm.register("invoiceKind", {
                onChange: () => { if (!coordinator.isCheckoutActive()) coordinator.notifyCartModified(); },
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
            role="group"
            aria-label="Artículos del carrito"
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
              cart.map((item, index) => (
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
                        <PosAmount
                          amount={item.promotionListPriceArs === undefined
                            ? cartTotals.lines[index]?.lineTotal ?? mul4(item.priceArs, item.quantity)
                            : item.priceArs}
                          list={item.promotionListPriceArs}
                        />
                      </span>
                      {item.promotionListPriceArs !== undefined && item.quantity > 1 && (
                        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>c/u</span>
                      )}
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
                      disabled={coordinator.isCheckoutActive() || submittingSale}
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
                      disabled={item.quantity >= item.availableStock || coordinator.isCheckoutActive() || submittingSale}
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
                      disabled={coordinator.isCheckoutActive() || submittingSale}
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
                    disabled={coordinator.isCheckoutActive() || submittingSale}
                    onClick={() => {
                      if (coordinator.isCheckoutActive() || submittingSale) return;
                      if (selectedPaymentMethodId !== method.id) coordinator.notifyCartModified();
                      checkoutForm.setValue("paymentMethodId", method.id, { shouldValidate: true });
                    }}
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
                {formatPosCurrency(subtotalArs, "ARS")}
              </strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: "11px", color: "var(--text-light)", fontWeight: 600 }}>Neto / IVA:</span>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-muted)" }}>
                {formatPosCurrency(subtotalNetArs, "ARS")} / {formatPosCurrency(totalTaxArs, "ARS")}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: "11px", color: "var(--text-light)", fontWeight: 600 }}>Equivalente USD:</span>
              <span style={{ fontSize: "13px", fontWeight: 800, color: "var(--brand-primary)" }}>
                {dollarRate ? formatCurrency(subtotalUsd, "USD") : "Sin cotización"}
              </span>
            </div>
          </div>

          {cartTotals.error && (
            <div
              style={{
                marginTop: "12px",
                padding: "10px",
                borderRadius: "8px",
                background: "var(--rose-soft, #fff1f2)",
                border: "1px solid var(--rose-accent, #f43f5e)",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <span style={{ fontSize: "12px", color: "var(--rose-accent, #e11d48)", fontWeight: 700 }}>
                {cartTotals.error}
              </span>
            </div>
          )}

          {staleQuoteDetected && (
            <div
              style={{
                marginTop: "12px",
                padding: "10px",
                borderRadius: "8px",
                background: "var(--rose-soft, #fff1f2)",
                border: "1px solid var(--rose-accent, #f43f5e)",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <span style={{ fontSize: "12px", color: "var(--rose-accent, #e11d48)", fontWeight: 700 }}>
                El catálogo cambió mientras armaba el carrito. Actualice los precios antes de confirmar.
              </span>
              <button
                type="button"
                onClick={handleSyncCartWithCatalog}
                className="btn-secondary btn-block"
                style={{
                  height: "36px",
                  fontSize: "12px",
                  fontWeight: 800,
                  borderColor: "var(--brand-primary)",
                  color: "var(--brand-primary)",
                }}
                disabled={loading || submittingSale || coordinator.isCheckoutActive() || coordinator.isRequoteActive()}
              >
                <RefreshCw size={14} className={loading || coordinator.isRequoteActive() ? "animate-spin" : ""} /> Actualizar precios del carrito
              </button>
            </div>
          )}

          <button
            type="submit"
            className="btn-primary btn-block"
            style={{ marginTop: "14px", height: "46px", fontSize: "14px", fontWeight: 850 }}
            disabled={
              cart.length === 0 ||
              hasUnresolvedAttempt ||
              staleQuoteDetected ||
              submittingSale ||
              loading ||
              coordinator.isCheckoutActive() ||
              coordinator.isRequoteActive() ||
              !activeLocation ||
              !cartTotals.isValid
            }
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
