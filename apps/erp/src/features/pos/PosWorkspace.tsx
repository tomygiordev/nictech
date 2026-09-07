import React, { useState, useEffect, useMemo, useCallback } from "react";
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
import { formatCurrency, formatDateTime } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";

export interface PosVariantItem {
  id: string;
  code: string;
  name: string;
  priceDelta: number;
  stock: number;
  barcodes: string[];
}

export interface PosProductItem {
  id: string;
  code: string;
  name: string;
  category: string;
  priceArs: number;
  priceUsd: number;
  stock: number;
  hasVariants: boolean;
  variants: PosVariantItem[];
  barcodes: string[];
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
}

interface RawProductData {
  id: string;
  internal_code: string;
  internal_name: string;
  base_sale_price: number | null;
  tax_rate_percent: number | null;
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

const DEFAULT_LOCATION_ID = "30000000-0000-0000-0000-000000000001"; // Mostrador
const DEFAULT_BRANCH_ID = "20000000-0000-0000-0000-000000000001"; // Sucursal central

export const PosWorkspace: React.FC = () => {
  const [products, setProducts] = useState<PosProductItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [dollarRate, setDollarRate] = useState<number>(1250);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "qr" | "transfer">("cash");
  const [customerName, setCustomerName] = useState<string>("Consumidor Final");
  const [submittingSale, setSubmittingSale] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [lastTicket, setLastTicket] = useState<{
    saleId: string;
    ticketNumber: string;
    items: CartItem[];
    totalArs: number;
    totalUsd: number;
    paymentMethod: string;
    customer: string;
    date: string;
  } | null>(null);

  const fetchProductsAndSettings = useCallback(async () => {
    try {
      setLoading(true);
      // 1. Fetch dollar rate from ERP exchange rate snapshots or default
      const { data: fxData } = await supabase
        .from("exchange_rate_snapshots")
        .select("rate_to_base")
        .eq("quote_currency", "USD")
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const currentRate = fxData?.rate_to_base ? Number(fxData.rate_to_base) : 1250;
      setDollarRate(currentRate);

      // 2. Fetch products, active variants, barcodes and stock balances from ERP schema
      const { data: prodData, error: prodErr } = await supabase
        .from("products")
        .select(`
          id,
          internal_code,
          internal_name,
          base_sale_price,
          tax_rate_percent,
          product_categories(name),
          product_variants(id, code, name, price_delta, is_active, product_identifiers(kind, value)),
          stock_balances(location_id, quantity_on_hand, quantity_reserved, variant_id)
        `)
        .eq("is_active", true)
        .eq("can_sell", true)
        .order("internal_name");

      if (prodErr) throw prodErr;

      const rawProducts = (prodData as unknown as RawProductData[]) || [];
      const mapped: PosProductItem[] = rawProducts.map((p) => {
        const baseArs = Number(p.base_sale_price || 0);
        const baseUsd = currentRate > 0 ? Math.round(baseArs / currentRate) : 0;
        const catName = p.product_categories?.name || "General";

        const balances = p.stock_balances || [];
        const activeVariants = (p.product_variants || []).filter((v) => v.is_active);
        const hasVariants = activeVariants.length > 0;

        const variants: PosVariantItem[] = activeVariants.map((v) => {
          const varBalances = balances.filter(
            (sb) => sb.variant_id === v.id && sb.location_id === DEFAULT_LOCATION_ID,
          );
          const varStock = varBalances.reduce((sum, b) => sum + Number(b.quantity_on_hand || 0), 0);
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
          };
        });

        const simpleBalances = balances.filter(
          (sb) => !sb.variant_id && sb.location_id === DEFAULT_LOCATION_ID,
        );
        const simpleStock = hasVariants
          ? variants.reduce((sum, v) => sum + v.stock, 0)
          : simpleBalances.reduce((sum, b) => sum + Number(b.quantity_on_hand || 0), 0);

        const allBarcodes = variants.flatMap((v) => v.barcodes);

        return {
          id: p.id,
          code: p.internal_code || p.id.slice(0, 8).toUpperCase(),
          name: p.internal_name,
          category: catName,
          priceArs: baseArs,
          priceUsd: baseUsd,
          stock: simpleStock,
          hasVariants,
          variants,
          barcodes: allBarcodes,
        };
      });

      setProducts(mapped);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error al cargar catálogo ERP para POS";
      console.error("Error al cargar productos para POS:", e);
      setFeedback({ type: "error", message: msg });
    } finally {
      setLoading(false);
    }
  }, []);

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

  const addToCart = (product: PosProductItem, variant?: PosVariantItem) => {
    const key = `${product.id}:${variant ? variant.id : "base"}`;
    const targetStock = variant ? variant.stock : product.stock;
    const priceArs = product.priceArs + (variant ? variant.priceDelta : 0);
    const priceUsd = dollarRate > 0 ? Math.round(priceArs / dollarRate) : 0;
    const displayName = variant ? `${product.name} (${variant.name})` : product.name;
    const displayCode = variant ? variant.code : product.code;

    setCart((prev) => {
      const existing = prev.find((item) => item.key === key);
      const currentQty = existing ? existing.quantity : 0;

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
          locationId: DEFAULT_LOCATION_ID,
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
          addToCart(prod, v);
          setSearch("");
          setFeedback({ type: "success", message: `Agregado por código: ${prod.name} (${v.name})` });
          return;
        }
      }
      if (prod.code.toLowerCase() === term) {
        if (prod.hasVariants && prod.variants.length > 0) {
          addToCart(prod, prod.variants[0]);
        } else {
          addToCart(prod);
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
        .filter(Boolean) as CartItem[];
    });
  };

  const removeFromCart = (key: string) => {
    setCart((prev) => prev.filter((item) => item.key !== key));
  };

  const clearCart = () => {
    setCart([]);
  };

  const subtotalArs = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.priceArs * item.quantity, 0);
  }, [cart]);

  const subtotalUsd = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.priceUsd * item.quantity, 0);
  }, [cart]);

  const handleCheckout = async () => {
    if (cart.length === 0 || submittingSale) return;

    // Check available stock limits before posting
    for (const item of cart) {
      if (item.quantity > item.availableStock) {
        setFeedback({
          type: "error",
          message: `No se puede procesar: ${item.displayName} supera el stock disponible (${item.availableStock}).`,
        });
        return;
      }
    }

    try {
      setSubmittingSale(true);
      setFeedback(null);

      // 1. Get or create exchange rate snapshot for ARS
      const { data: snapId, error: snapErr } = await supabase.rpc("get_or_create_exchange_snapshot", {
        target_quote_currency: "ARS",
      });
      if (snapErr || !snapId) {
        throw new Error(`Error al obtener snapshot de tipo de cambio: ${snapErr?.message || "Sin snapshot"}`);
      }

      // 2. Get or create POS customer
      const { data: custId, error: custErr } = await supabase.rpc("get_or_create_pos_customer", {
        p_display_name: customerName.trim() || "Consumidor Final",
      });
      if (custErr || !custId) {
        throw new Error(`Error al identificar cliente POS: ${custErr?.message || "Sin cliente"}`);
      }

      // 3. Prepare payment lines
      let paymentLines: Array<Record<string, unknown>> = [];
      if (paymentMethod === "cash") {
        const { data: cashSessionId, error: cashErr } = await supabase.rpc("get_or_open_pos_cash_session", {
          target_branch_id: DEFAULT_BRANCH_ID,
        });
        if (cashErr || !cashSessionId) {
          throw new Error(`Error al verificar sesión de caja para cobro en efectivo: ${cashErr?.message || "Sin caja"}`);
        }
        paymentLines = [
          {
            payment_method_id: "82000000-0000-0000-0000-000000000001", // Efectivo
            cash_session_id: cashSessionId,
            amount: subtotalArs,
          },
        ];
      } else if (paymentMethod === "card") {
        paymentLines = [
          {
            payment_method_id: "82000000-0000-0000-0000-000000000002", // Tarjeta
            amount: subtotalArs,
          },
        ];
      } else if (paymentMethod === "qr" || paymentMethod === "transfer") {
        paymentLines = [
          {
            payment_method_id: "82000000-0000-0000-0000-000000000003", // Mercado Pago
            amount: subtotalArs,
          },
        ];
      }

      // 4. Prepare lines for atomic create_sale
      const lines = cart.map((item) => ({
        kind: "product",
        product_id: item.productId,
        variant_id: item.variantId || null,
        from_location_id: item.locationId || DEFAULT_LOCATION_ID,
        description: item.displayName,
        quantity: item.quantity,
        unit_price: item.priceArs,
        discount_amount: 0,
        tax_rate_percent: 0,
        tax_amount: 0,
      }));

      const opKey = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      // 5. Atomic sale creation with variant isolation & stock deduction
      const { data: saleId, error: saleErr } = await supabase.rpc("create_sale", {
        target_branch_id: DEFAULT_BRANCH_ID,
        target_customer_id: custId,
        sale_currency: "ARS",
        target_exchange_snapshot_id: snapId,
        operation_key: opKey,
        operation_reason: `Venta Mostrador POS - ${customerName}`,
        lines,
        payment_lines: paymentLines,
      });

      if (saleErr || !saleId) {
        throw new Error(`Error en el backend ERP al asentar la venta: ${saleErr?.message || "Fallo transaccional"}`);
      }

      // 6. Generate real persistent ticket and notify
      const ticketNum = opKey.toUpperCase();
      const receiptData = {
        saleId: saleId as string,
        ticketNumber: ticketNum,
        items: [...cart],
        totalArs: subtotalArs,
        totalUsd: subtotalUsd,
        paymentMethod:
          paymentMethod === "cash"
            ? "Efectivo"
            : paymentMethod === "card"
            ? "Tarjeta Débito/Crédito"
            : paymentMethod === "qr"
            ? "Mercado Pago QR"
            : "Transferencia Bancaria",
        customer: customerName || "Consumidor Final",
        date: formatDateTime(new Date()),
      };

      setLastTicket(receiptData);
      setCart([]);
      setFeedback({
        type: "success",
        message: `¡Venta ${ticketNum} completada con éxito! Stock descontado atómicamente en ERP.`,
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

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Punto de Venta (POS)"
        description="Terminal de facturación rápida con aislamiento de variantes de stock, lector de código de barras y cobro transaccional ERP."
        badge={`Dólar: ${formatCurrency(dollarRate, "ARS")} • Caja 01 Central`}
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
                  ¡Venta Confirmada! #{lastTicket.ticketNumber}
                </strong>
                <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
                  {lastTicket.customer} • {lastTicket.paymentMethod} • {formatCurrency(lastTicket.totalArs, "ARS")}
                </p>
                <span style={{ fontSize: "10px", color: "var(--text-light)", fontFamily: "monospace" }}>
                  ID Venta ERP: {lastTicket.saleId}
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
                <Printer size={14} /> Imprimir Comprobante
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
                            <button
                              key={v.id}
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
                          ))}
                        </div>
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
                        {formatCurrency(product.priceArs, "ARS")}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 600 }}>
                        {formatCurrency(product.priceUsd, "USD")}
                      </div>
                    </div>

                    {!product.hasVariants && (
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
        <div
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
              type="text"
              placeholder="Nombre del cliente (Consumidor Final)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
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
              {[
                { id: "cash" as const, label: "Efectivo", icon: Banknote },
                { id: "card" as const, label: "Tarjeta", icon: CreditCard },
                { id: "qr" as const, label: "MP QR", icon: QrCode },
                { id: "transfer" as const, label: "Transf.", icon: Receipt },
              ].map((m) => {
                const Icon = m.icon;
                const isSel = paymentMethod === m.id;
                return (
                  <button
                    key={m.id}
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
                    onClick={() => setPaymentMethod(m.id)}
                  >
                    <Icon size={14} />
                    <span style={{ fontSize: "11px", fontWeight: 700 }}>{m.label}</span>
                  </button>
                );
              })}
            </div>
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
              <span style={{ fontSize: "11px", color: "var(--text-light)", fontWeight: 600 }}>Equivalente USD:</span>
              <span style={{ fontSize: "13px", fontWeight: 800, color: "var(--brand-primary)" }}>
                {formatCurrency(subtotalUsd, "USD")}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="btn-primary btn-block"
            style={{ marginTop: "14px", height: "46px", fontSize: "14px", fontWeight: 850 }}
            disabled={cart.length === 0 || submittingSale}
            onClick={handleCheckout}
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
        </div>
      </div>
    </div>
  );
};
