
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Zap, Search, Loader2, Check, Package, X, ShoppingCart,
  Plus, Minus, Trash2, TrendingDown, FileText, RotateCcw,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  name: string;
  price: number;
  price_usd: number | null;
  stock: number;
  image_url: string | null;
  category_name: string;
  has_variants: boolean;
}

interface Variant {
  id: string;
  color: string;
  stock: number;
}

interface CartItem {
  key: string;           // `${productId}::${variantId ?? 'none'}`
  productId: string;
  variantId: string | null;
  name: string;
  variantColor: string | null;
  imageUrl: string | null;
  qty: number;
  unitPrice: number;
  availableStock: number;
}

interface SaleSnapshot {
  orderNumber: string;
  date: string;         // ISO
  items: CartItem[];
  channel: string;
  notes: string;
  total: number;
}

const CHANNELS = ['Efectivo', 'Débito', 'Transferencia', 'Crédito', 'Otro'];
const QUICK_QTY = [1, 2, 3, 5, 10];

// ─── PDF generation ───────────────────────────────────────────────────────────

function generateOrderPDF(sale: SaleSnapshot) {
  const fmt = (n: number) => n.toLocaleString('es-AR');
  const dateObj = new Date(sale.date);
  const dateStr = dateObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = dateObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  const rows = sale.items.map(item => `
    <tr>
      <td>${item.name}${item.variantColor ? `<br><small>${item.variantColor}</small>` : ''}</td>
      <td class="center">${item.qty}</td>
      <td class="right">${item.unitPrice > 0 ? '$' + fmt(item.unitPrice) : '—'}</td>
      <td class="right">${item.unitPrice > 0 ? '$' + fmt(item.qty * item.unitPrice) : '—'}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Orden de Venta ${sale.orderNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; padding: 36px 40px; max-width: 680px; margin: 0 auto; }

    /* Header */
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 16px; margin-bottom: 20px; }
    .brand { font-size: 26px; font-weight: 900; letter-spacing: -1px; color: #111; }
    .brand span { color: #0060d6; }
    .brand-sub { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
    .order-meta { text-align: right; }
    .order-title { font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #111; }
    .order-num { font-size: 13px; color: #0060d6; font-weight: 700; margin-top: 2px; }
    .order-date { font-size: 11px; color: #666; margin-top: 4px; }

    /* Info row */
    .info-row { display: flex; gap: 40px; margin-bottom: 20px; font-size: 12px; }
    .info-block label { display: block; font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .info-block strong { font-size: 13px; color: #111; }

    /* Table */
    table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
    thead tr { background: #111; color: #fff; }
    thead th { padding: 9px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
    thead th.center { text-align: center; }
    thead th.right { text-align: right; }
    tbody tr { border-bottom: 1px solid #e5e5e5; }
    tbody tr:last-child { border-bottom: none; }
    tbody td { padding: 9px 12px; font-size: 13px; vertical-align: top; }
    tbody td small { display: block; font-size: 11px; color: #888; margin-top: 2px; }
    td.center { text-align: center; }
    td.right { text-align: right; }

    /* Totals */
    .totals { border-top: 2px solid #111; margin-top: 0; }
    .totals-row { display: flex; justify-content: flex-end; }
    .totals-table { width: 240px; }
    .totals-table td { padding: 6px 12px; font-size: 13px; }
    .totals-table .total-row td { font-size: 16px; font-weight: 800; border-top: 1px solid #ddd; padding-top: 8px; }
    .totals-table td:last-child { text-align: right; }

    /* Notes */
    .notes { margin-top: 16px; padding: 10px 14px; background: #f9f9f9; border-left: 3px solid #0060d6; font-size: 12px; color: #444; }
    .notes strong { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 3px; }

    /* Footer */
    .footer { margin-top: 32px; text-align: center; font-size: 11px; color: #aaa; border-top: 1px solid #e5e5e5; padding-top: 14px; }
    .footer strong { color: #555; }

    @media print {
      body { padding: 20px 24px; }
      @page { margin: 1cm; size: A4; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">Nic<span>Tech</span></div>
      <div class="brand-sub">Tecnología &amp; Reparaciones</div>
    </div>
    <div class="order-meta">
      <div class="order-title">Orden de Venta</div>
      <div class="order-num">${sale.orderNumber}</div>
      <div class="order-date">${dateStr} · ${timeStr}</div>
    </div>
  </div>

  <div class="info-row">
    <div class="info-block">
      <label>Método de pago</label>
      <strong>${sale.channel}</strong>
    </div>
    <div class="info-block">
      <label>Artículos</label>
      <strong>${sale.items.reduce((s, i) => s + i.qty, 0)} unidades</strong>
    </div>
    ${sale.total > 0 ? `<div class="info-block">
      <label>Total</label>
      <strong>$${fmt(sale.total)}</strong>
    </div>` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th>Producto</th>
        <th class="center">Cant.</th>
        <th class="right">Precio unit.</th>
        <th class="right">Subtotal</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  ${sale.total > 0 ? `
  <div class="totals">
    <div class="totals-row">
      <table class="totals-table">
        <tbody>
          <tr class="total-row">
            <td><strong>TOTAL</strong></td>
            <td><strong>$${fmt(sale.total)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>` : ''}

  ${sale.notes ? `<div class="notes"><strong>Notas</strong>${sale.notes}</div>` : ''}

  <div class="footer">
    <strong>¡Gracias por su compra!</strong><br>
    NicTech · Este documento es un comprobante interno de venta
  </div>

  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=780,height=900');
  if (!win) { alert('Permitir ventanas emergentes para generar el PDF'); return; }
  win.document.write(html);
  win.document.close();
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onSaleComplete: (productId: string, newStock: number) => void;
  variantProductIds: Set<string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ProductThumb({ url, size = 8 }: { url: string | null; size?: number }) {
  const cls = `h-${size} w-${size} rounded bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center`;
  return (
    <div className={cls}>
      {url
        ? <img src={url} alt="" className="h-full w-full object-cover" />
        : <Package className="h-4 w-4 text-muted-foreground opacity-50" />}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function QuickSaleModal({ open, onClose, onSaleComplete, variantProductIds }: Props) {
  // ── Search state ──────────────────────────────────────────────────
  const searchRef  = useRef<HTMLInputElement>(null);
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // ── Item-being-configured state ───────────────────────────────────
  const [selected, setSelected]   = useState<SearchResult | null>(null);
  const [variants, setVariants]   = useState<Variant[]>([]);
  const [loadingV, setLoadingV]   = useState(false);
  const [selVariant, setSelVariant] = useState<Variant | null>(null);
  const [qty, setQty]     = useState('1');
  const [price, setPrice] = useState('');

  // ── Cart ──────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([]);

  // ── Sale-level fields ─────────────────────────────────────────────
  const [channel, setChannel] = useState('Efectivo');
  const [notes, setNotes]     = useState('');

  // ── Submission ────────────────────────────────────────────────────
  const [saving, setSaving]                 = useState(false);
  const [completedSale, setCompletedSale]   = useState<SaleSnapshot | null>(null);

  // ── Reset on open ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    resetAll();
    setTimeout(() => searchRef.current?.focus(), 100);
  }, [open]);

  const resetAll = () => {
    setQuery(''); setResults([]); setShowResults(false);
    setSelected(null); setVariants([]); setSelVariant(null);
    setQty('1'); setPrice('');
    setCart([]); setChannel('Efectivo'); setNotes('');
    setCompletedSale(null);
  };

  const clearSelection = () => {
    setSelected(null); setVariants([]); setSelVariant(null);
    setQty('1'); setPrice(''); setQuery(''); setShowResults(false);
    setTimeout(() => searchRef.current?.focus(), 80);
  };

  // ── Search (debounced 220ms) ──────────────────────────────────────
  useEffect(() => {
    if (!query.trim()) { setResults([]); setShowResults(false); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const { data } = await (supabase as any)
        .from('products')
        .select('id, name, price, price_usd, stock, image_url, category:categories(name)')
        .ilike('name', `%${query}%`)
        .eq('is_active', true)
        .order('name')
        .limit(10);
      if (data) {
        setResults(data.map((p: any) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          price_usd: p.price_usd ?? null,
          stock: p.stock,
          image_url: p.image_url,
          category_name: p.category?.name ?? '',
          has_variants: variantProductIds.has(p.id),
        })));
        setShowResults(true);
      }
      setSearching(false);
    }, 220);
    return () => clearTimeout(debounceRef.current);
  }, [query, variantProductIds]);

  // ── Select product from dropdown ──────────────────────────────────
  const selectProduct = useCallback(async (p: SearchResult) => {
    setSelected(p);
    setShowResults(false);
    setQuery(p.name);
    setPrice(p.price.toString());
    setQty('1');
    setVariants([]);
    setSelVariant(null);

    if (p.has_variants) {
      setLoadingV(true);
      const { data } = await (supabase as any)
        .from('product_variants')
        .select('id, color, stock')
        .eq('product_id', p.id)
        .gt('stock', 0)
        .order('color');
      setVariants((data || []) as Variant[]);
      setLoadingV(false);
    }
  }, []);

  // ── Derived: current item being built ─────────────────────────────
  const qtyNum   = Math.max(0, parseInt(qty) || 0);
  const priceNum = parseFloat(price) || 0;
  const currentStock = selected?.has_variants && selVariant
    ? selVariant.stock
    : (selected?.stock ?? 0);
  const stockOk = qtyNum > 0 && qtyNum <= currentStock;
  const canAdd  = !!selected && (!selected.has_variants || !!selVariant) && stockOk;

  // ── Add item to cart ──────────────────────────────────────────────
  const addToCart = () => {
    if (!canAdd || !selected) return;
    const variantId    = selVariant?.id ?? null;
    const variantColor = selVariant?.color ?? null;
    const key = `${selected.id}::${variantId ?? 'none'}`;

    setCart(prev => {
      const existing = prev.find(i => i.key === key);
      if (existing) {
        const mergedQty = existing.qty + qtyNum;
        if (mergedQty > existing.availableStock) {
          toast({ title: `Stock máximo: ${existing.availableStock}`, variant: 'destructive' });
          return prev;
        }
        return prev.map(i => i.key === key ? { ...i, qty: mergedQty, unitPrice: priceNum } : i);
      }
      return [...prev, {
        key,
        productId: selected.id,
        variantId,
        name: selected.name,
        variantColor,
        imageUrl: selected.image_url,
        qty: qtyNum,
        unitPrice: priceNum,
        availableStock: currentStock,
      }];
    });

    clearSelection();
  };

  // ── Cart manipulation ─────────────────────────────────────────────
  const changeItemQty = (key: string, delta: number) => {
    setCart(prev => prev.map(i => {
      if (i.key !== key) return i;
      const next = i.qty + delta;
      if (next <= 0) return i; // use remove button instead
      if (next > i.availableStock) return i;
      return { ...i, qty: next };
    }));
  };

  const removeItem = (key: string) => setCart(prev => prev.filter(i => i.key !== key));

  const cartTotal = cart.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const cartUnits = cart.reduce((s, i) => s + i.qty, 0);

  // ── Confirm sale ──────────────────────────────────────────────────
  const confirmSale = async () => {
    if (!cart.length) return;
    setSaving(true);

    // Track which product stocks we've already recalculated (variant products)
    const recalcedProducts = new Set<string>();

    for (const item of cart) {
      try {
        if (item.variantId) {
          // Update variant stock
          const newVariantStock = item.availableStock - item.qty;
          await (supabase as any)
            .from('product_variants')
            .update({ stock: newVariantStock })
            .eq('id', item.variantId);

          // Recalc product-level stock once per product
          if (!recalcedProducts.has(item.productId)) {
            recalcedProducts.add(item.productId);
            const { data: allV } = await (supabase as any)
              .from('product_variants')
              .select('stock')
              .eq('product_id', item.productId);
            const totalStock = (allV || []).reduce((s: number, v: any) => s + (v.stock || 0), 0);
            await (supabase as any)
              .from('products')
              .update({ stock: totalStock })
              .eq('id', item.productId);
            onSaleComplete(item.productId, totalStock);
          }
        } else {
          const newStock = item.availableStock - item.qty;
          await (supabase as any)
            .from('products')
            .update({ stock: newStock })
            .eq('id', item.productId);
          onSaleComplete(item.productId, newStock);
        }

        await (supabase as any).from('inventory_movements').insert({
          product_id: item.productId,
          variant_id: item.variantId ?? null,
          type: 'sale',
          quantity: item.qty,
          unit_price: item.unitPrice || null,
          channel,
          notes: notes || null,
        });
      } catch (e: any) {
        toast({ title: `Error en "${item.name}"`, description: e.message, variant: 'destructive' });
      }
    }

    const now = new Date();
    const orderNumber = `#ORD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

    setSaving(false);
    setCompletedSale({
      orderNumber,
      date: now.toISOString(),
      items: [...cart],
      channel,
      notes,
      total: cart.reduce((s, i) => s + i.qty * i.unitPrice, 0),
    });
    setCart([]);
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden gap-0 h-[90vh] flex flex-col">

        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3 flex items-center flex-shrink-0">
          <DialogTitle className="text-white font-bold text-base flex items-center gap-2">
            <Zap className="h-4 w-4" /> Venta Rápida
          </DialogTitle>
        </div>

        {/* Body: two columns */}
        <div className="flex flex-1 min-h-0 divide-x divide-border">

          {/* ── Left: product search + item config ─── */}
          <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">

            {/* Search bar */}
            <div className="p-3 border-b border-border bg-muted/20 relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Buscar producto por nombre o categoría..."
                  value={query}
                  onChange={e => { setQuery(e.target.value); if (selected) { setSelected(null); setVariants([]); setSelVariant(null); } }}
                  className="w-full pl-9 pr-9 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
                  autoComplete="off"
                />
                {searching
                  ? <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
                  : selected
                    ? <Check className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                    : null}
              </div>

              {/* Dropdown */}
              {showResults && (
                <div className="absolute left-3 right-3 top-full mt-1 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden max-h-72 overflow-y-auto">
                  {results.length === 0 && !searching
                    ? <p className="text-sm text-muted-foreground px-3 py-3">Sin resultados para "{query}"</p>
                    : results.map(r => (
                      <button key={r.id} type="button"
                        onClick={() => selectProduct(r)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted transition-colors text-left border-b border-border/40 last:border-0">
                        <ProductThumb url={r.image_url} size={9} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{r.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {r.category_name}
                            {r.has_variants
                              ? <span className="ml-1.5 text-purple-600 font-medium">variantes</span>
                              : <span className="ml-1.5">· {r.stock} en stock</span>}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {r.price_usd != null
                            ? <><p className="text-sm font-bold text-green-600">USD {r.price_usd}</p>
                               <p className="text-xs text-muted-foreground">${r.price.toLocaleString('es-AR')}</p></>
                            : <p className="text-sm font-bold">${r.price.toLocaleString('es-AR')}</p>}
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>

            {/* Item config */}
            <div className="flex-1 p-4 space-y-4">
              {!selected ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-3 py-12">
                  <Search className="h-10 w-10 opacity-20" />
                  <p className="text-sm">Buscá un producto para agregarlo al carrito</p>
                  <p className="text-xs opacity-60">Celulares, fundas, vidrios, accesorios…</p>
                </div>
              ) : (
                <>
                  {/* Selected product header */}
                  <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/30">
                    <ProductThumb url={selected.image_url} size={10} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-tight truncate">{selected.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {selected.category_name}
                        {selected.has_variants
                          ? ' · seleccioná variante'
                          : <> · <span className={selected.stock === 0 ? 'text-red-500 font-bold' : 'font-medium'}>{selected.stock} en stock</span></>}
                      </p>
                    </div>
                    <button type="button" onClick={clearSelection}
                      className="text-muted-foreground hover:text-destructive flex-shrink-0 transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Variant selector */}
                  {selected.has_variants && (
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Variante / Color
                      </Label>
                      {loadingV
                        ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        : variants.length === 0
                          ? <p className="text-sm text-red-500">Sin stock en ninguna variante</p>
                          : (
                            <div className="flex flex-wrap gap-1.5">
                              {variants.map(v => (
                                <button key={v.id} type="button"
                                  onClick={() => setSelVariant(v)}
                                  className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                                    selVariant?.id === v.id
                                      ? 'bg-foreground text-background border-foreground scale-105'
                                      : 'border-border hover:border-foreground/40 hover:bg-muted'
                                  }`}>
                                  {v.color}
                                  <span className={`ml-1.5 text-xs ${selVariant?.id === v.id ? 'opacity-60' : 'text-muted-foreground'}`}>
                                    ({v.stock})
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                    </div>
                  )}

                  {/* Qty + Price (shown when ready) */}
                  {(!selected.has_variants || selVariant) && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        {/* Quantity */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cantidad</Label>
                            {qtyNum > 0 && (
                              <span className={`text-xs font-semibold ${!stockOk ? 'text-red-500' : 'text-green-600'}`}>
                                {!stockOk
                                  ? `máx. ${currentStock}`
                                  : `${currentStock - qtyNum} restantes`}
                              </span>
                            )}
                          </div>
                          <Input
                            type="number" min="1" max={currentStock}
                            value={qty}
                            onChange={e => setQty(e.target.value)}
                            className={`h-10 text-center text-lg font-bold ${!stockOk && qtyNum > 0 ? 'border-red-500' : ''}`}
                          />
                          <div className="grid grid-cols-5 gap-1">
                            {QUICK_QTY.map(n => (
                              <button key={n} type="button"
                                disabled={n > currentStock}
                                onClick={() => setQty(n.toString())}
                                className={`py-1 rounded text-xs font-bold border transition-colors ${
                                  qty === n.toString()
                                    ? 'bg-foreground text-background border-foreground'
                                    : n > currentStock
                                      ? 'opacity-25 cursor-not-allowed border-border text-muted-foreground'
                                      : 'border-border hover:bg-muted text-muted-foreground'
                                }`}>
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Price */}
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Precio unitario
                          </Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">$</span>
                            <Input
                              type="number" min="0"
                              value={price}
                              onChange={e => setPrice(e.target.value)}
                              placeholder="0"
                              className="h-10 pl-7 text-base font-semibold"
                            />
                          </div>
                          {priceNum > 0 && qtyNum > 0 && (
                            <p className="text-xs text-muted-foreground text-right">
                              Subtotal: <span className="font-bold text-foreground">${(priceNum * qtyNum).toLocaleString('es-AR')}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Add to cart button */}
                      <Button
                        onClick={addToCart}
                        disabled={!canAdd}
                        className="w-full h-10 gap-2 font-semibold bg-amber-500 hover:bg-amber-600 text-white border-0 disabled:opacity-40">
                        <Plus className="h-4 w-4" />
                        Agregar al carrito
                        {canAdd && priceNum > 0 && qtyNum > 0 && (
                          <span className="ml-auto font-bold opacity-90">
                            ${(priceNum * qtyNum).toLocaleString('es-AR')}
                          </span>
                        )}
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── Right: cart + checkout ─── */}
          <div className="w-72 flex-shrink-0 flex flex-col bg-muted/10">

            {/* Cart header */}
            <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-background">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Carrito</span>
                {cart.length > 0 && (
                  <span className="bg-amber-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
                    {cart.length}
                  </span>
                )}
              </div>
              {cart.length > 0 && (
                <button type="button" onClick={() => setCart([])}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1">
                  <Trash2 className="h-3 w-3" /> Vaciar
                </button>
              )}
            </div>

            {/* Cart items */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2 py-8">
                  <ShoppingCart className="h-8 w-8 opacity-20" />
                  <p className="text-xs">El carrito está vacío</p>
                </div>
              ) : cart.map(item => (
                <div key={item.key}
                  className="bg-background rounded-xl border border-border p-2.5 space-y-2">
                  {/* Item header */}
                  <div className="flex items-start gap-2">
                    <ProductThumb url={item.imageUrl} size={8} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold leading-tight line-clamp-2">{item.name}</p>
                      {item.variantColor && (
                        <span className="text-xs text-purple-600 font-medium">{item.variantColor}</span>
                      )}
                    </div>
                    <button type="button" onClick={() => removeItem(item.key)}
                      className="text-muted-foreground hover:text-destructive flex-shrink-0 mt-0.5 transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Qty controls + subtotal */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 rounded-lg border border-border overflow-hidden">
                      <button type="button"
                        onClick={() => changeItemQty(item.key, -1)}
                        disabled={item.qty <= 1}
                        className="px-2 py-1 hover:bg-muted transition-colors disabled:opacity-30">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="px-2 text-sm font-bold min-w-[1.5rem] text-center">{item.qty}</span>
                      <button type="button"
                        onClick={() => changeItemQty(item.key, 1)}
                        disabled={item.qty >= item.availableStock}
                        className="px-2 py-1 hover:bg-muted transition-colors disabled:opacity-30">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="text-right">
                      {item.unitPrice > 0
                        ? <p className="text-sm font-bold">${(item.qty * item.unitPrice).toLocaleString('es-AR')}</p>
                        : <p className="text-xs text-muted-foreground">sin precio</p>}
                      {item.unitPrice > 0 && item.qty > 1 && (
                        <p className="text-xs text-muted-foreground">${item.unitPrice.toLocaleString('es-AR')} c/u</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Checkout panel */}
            <div className="border-t border-border px-4 py-3 space-y-3 bg-background">

              {/* Total */}
              {(cart.length > 0 || completedSale) && (
                <div className="flex items-center justify-between rounded-xl px-3 py-2.5 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border border-amber-200 dark:border-amber-800">
                  <div className="text-xs text-muted-foreground">
                    {(() => {
                      const units = completedSale
                        ? completedSale.items.reduce((s, i) => s + i.qty, 0)
                        : cartUnits;
                      const count = completedSale ? completedSale.items.length : cart.length;
                      return <>
                        <p>{units} unidad{units !== 1 ? 'es' : ''}</p>
                        <p>{count} producto{count !== 1 ? 's' : ''}</p>
                      </>;
                    })()}
                  </div>
                  <div className="text-right">
                    {(() => {
                      const total = completedSale ? completedSale.total : cartTotal;
                      return total > 0
                        ? <p className="text-xl font-bold">${total.toLocaleString('es-AR')}</p>
                        : <p className="text-sm font-semibold text-muted-foreground">s/ precio</p>;
                    })()}
                  </div>
                </div>
              )}

              {/* Channel */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Canal</Label>
                <div className="flex flex-wrap gap-1">
                  {CHANNELS.map(c => (
                    <button key={c} type="button" onClick={() => setChannel(c)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        channel === c
                          ? 'bg-foreground text-background border-foreground'
                          : 'border-border hover:bg-muted text-muted-foreground'
                      }`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <Input
                placeholder="Notas (opcional)"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="h-8 text-xs"
              />

              {/* Confirm / Post-sale */}
              {completedSale ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 bg-green-100 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400">
                    <Check className="h-4 w-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold leading-tight">Venta registrada</p>
                      <p className="text-xs opacity-70">{completedSale.orderNumber}</p>
                    </div>
                  </div>
                  <Button
                    onClick={() => generateOrderPDF(completedSale)}
                    className="w-full h-9 gap-2 font-semibold bg-blue-600 hover:bg-blue-700 text-white border-0">
                    <FileText className="h-4 w-4" /> Generar PDF
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { setCompletedSale(null); setTimeout(() => searchRef.current?.focus(), 80); }}
                    className="w-full h-9 gap-2 text-sm">
                    <RotateCcw className="h-3.5 w-3.5" /> Nueva venta
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={confirmSale}
                  disabled={saving || cart.length === 0}
                  className="w-full h-10 font-bold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0 gap-2 disabled:opacity-40">
                  {saving
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <TrendingDown className="h-4 w-4" />}
                  {saving ? 'Procesando…' : cart.length === 0 ? 'Carrito vacío' : `Confirmar · ${cart.length} ítem${cart.length !== 1 ? 's' : ''}`}
                </Button>
              )}

              <button type="button" onClick={onClose}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
