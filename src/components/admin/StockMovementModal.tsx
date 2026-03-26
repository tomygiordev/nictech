
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Loader2, Package, TrendingUp, TrendingDown, ArrowRight,
  ChevronDown, ChevronUp, Clock,
} from 'lucide-react';
import { type ProductType, TYPE_META } from '@/lib/productTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModalProduct {
  id: string;
  name: string;
  image_url: string | null;
  price: number;
  stock: number;
  category_name: string;
  type: ProductType;
}

interface Variant {
  id: string;
  color: string;
  stock: number;
}

interface Movement {
  id: string;
  type: 'restock' | 'sale';
  quantity: number;
  unit_price: number | null;
  channel: string | null;
  notes: string | null;
  created_at: string;
  variant_color?: string | null;
}

type Mode = 'restock' | 'sale';

const CHANNELS = ['Efectivo', 'Débito', 'Transferencia', 'Crédito', 'Otro'];
const QUICK_AMOUNTS = [1, 5, 10, 20, 50];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StockArrow({ from, delta, mode }: { from: number; delta: number; mode: Mode }) {
  const to = from + (mode === 'restock' ? delta : -delta);
  const toColor = to < 0 ? 'text-red-600' : to === 0 ? 'text-red-500' : to < 5 ? 'text-amber-500' : 'text-green-600';
  return (
    <div className="flex items-center gap-1.5 text-sm font-semibold">
      <span className="text-muted-foreground">{from}</span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
      <span className={toColor}>{to < 0 ? '⚠ ' : ''}{to}</span>
    </div>
  );
}

function MovementRow({ m }: { m: Movement }) {
  const isRestock = m.type === 'restock';
  const date = new Date(m.created_at);
  const dateStr = date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  const timeStr = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0 text-sm">
      <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
        isRestock ? 'bg-green-100 text-green-700 dark:bg-green-900/40' : 'bg-red-100 text-red-700 dark:bg-red-900/40'
      }`}>
        {isRestock ? '+' : '-'}
      </span>
      <span className={`font-bold w-6 text-center ${isRestock ? 'text-green-600' : 'text-red-600'}`}>
        {isRestock ? '+' : '-'}{m.quantity}
      </span>
      <div className="flex-1 min-w-0">
        <span className="text-muted-foreground text-xs truncate block">
          {m.variant_color ? `${m.variant_color} · ` : ''}
          {m.channel ?? (isRestock ? 'Reposición' : 'Venta')}
          {m.notes ? ` · ${m.notes}` : ''}
        </span>
      </div>
      {!isRestock && m.unit_price && (
        <span className="text-xs font-medium text-foreground flex-shrink-0">
          ${(m.quantity * m.unit_price).toLocaleString('es-AR')}
        </span>
      )}
      <span className="text-xs text-muted-foreground flex-shrink-0">{dateStr} {timeStr}</span>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface Props {
  product: ModalProduct | null;
  open: boolean;
  onClose: () => void;
  onDone: (productId: string, newStock: number) => void;
}

export function StockMovementModal({ product, open, onClose, onDone }: Props) {
  const hasVariants = product?.type === 'case' || product?.type === 'variant';

  // Mode
  const [mode, setMode] = useState<Mode>('restock');

  // Simple product state
  const [simpleQty, setSimpleQty] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [channel, setChannel] = useState('Efectivo');
  const [notes, setNotes] = useState('');

  // Variant state: Record<variantId, qty string>
  const [variants, setVariants] = useState<Variant[]>([]);
  const [variantQtys, setVariantQtys] = useState<Record<string, string>>({});
  const [loadingVariants, setLoadingVariants] = useState(false);

  // History
  const [history, setHistory] = useState<Movement[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Saving
  const [saving, setSaving] = useState(false);

  // ── Reset on open ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !product) return;
    setMode('restock');
    setSimpleQty('');
    setSalePrice(product.price.toString());
    setChannel('Local');
    setNotes('');
    setVariantQtys({});
    setHistory([]);
    setShowHistory(false);

    if (hasVariants) {
      setLoadingVariants(true);
      (supabase as any)
        .from('product_variants')
        .select('id, color, stock')
        .eq('product_id', product.id)
        .order('color')
        .then(({ data }: any) => {
          const rows = (data || []) as Variant[];
          setVariants(rows);
          setVariantQtys(Object.fromEntries(rows.map(v => [v.id, ''])));
          setLoadingVariants(false);
        });
    }
  }, [open, product?.id]);

  // ── Load history ───────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!product) return;
    setLoadingHistory(true);
    const { data } = await (supabase as any)
      .from('inventory_movements')
      .select('id, type, quantity, unit_price, channel, notes, created_at, variant_id')
      .eq('product_id', product.id)
      .order('created_at', { ascending: false })
      .limit(20);

    // Enrich with variant color names
    const variantIds = [...new Set((data || []).map((m: any) => m.variant_id).filter(Boolean))];
    let variantColors: Record<string, string> = {};
    if (variantIds.length) {
      const { data: vd } = await (supabase as any)
        .from('product_variants').select('id, color').in('id', variantIds);
      if (vd) variantColors = Object.fromEntries((vd as any[]).map(v => [v.id, v.color]));
    }

    setHistory((data || []).map((m: any) => ({
      ...m,
      variant_color: m.variant_id ? variantColors[m.variant_id] ?? null : null,
    })));
    setLoadingHistory(false);
  }, [product?.id]);

  useEffect(() => {
    if (showHistory) loadHistory();
  }, [showHistory, loadHistory]);

  // ── Confirm ────────────────────────────────────────────────────────
  const confirm = async () => {
    if (!product) return;
    setSaving(true);

    try {
      if (hasVariants) {
        // Validate at least one qty entered
        const entries = Object.entries(variantQtys).filter(([, v]) => v && parseInt(v) > 0);
        if (!entries.length) { toast({ title: 'Ingresá al menos una cantidad', variant: 'destructive' }); setSaving(false); return; }

        for (const [variantId, qtyStr] of entries) {
          const qty = parseInt(qtyStr);
          if (!qty || qty <= 0) continue;
          const variant = variants.find(v => v.id === variantId)!;
          const delta = mode === 'restock' ? qty : -qty;
          const newStock = Math.max(0, variant.stock + delta);

          // Update variant stock
          await (supabase as any).from('product_variants').update({ stock: newStock }).eq('id', variantId);

          // Record movement
          await (supabase as any).from('inventory_movements').insert({
            product_id: product.id,
            variant_id: variantId,
            type: mode,
            quantity: qty,
            unit_price: mode === 'sale' && salePrice ? parseFloat(salePrice) : null,
            channel: mode === 'sale' ? channel : null,
            notes: notes || null,
          });
        }

        // Update product-level stock = sum of variant stocks
        const { data: allVariants } = await (supabase as any)
          .from('product_variants').select('stock').eq('product_id', product.id);
        const totalStock = (allVariants || []).reduce((s: number, v: any) => s + (v.stock || 0), 0);
        await (supabase as any).from('products').update({ stock: totalStock }).eq('id', product.id);

        onDone(product.id, totalStock);
      } else {
        const qty = parseInt(simpleQty);
        if (!qty || qty <= 0) { toast({ title: 'Ingresá una cantidad válida', variant: 'destructive' }); setSaving(false); return; }

        const delta = mode === 'restock' ? qty : -qty;
        const newStock = Math.max(0, product.stock + delta);

        await (supabase as any).from('products').update({ stock: newStock }).eq('id', product.id);
        await (supabase as any).from('inventory_movements').insert({
          product_id: product.id,
          variant_id: null,
          type: mode,
          quantity: qty,
          unit_price: mode === 'sale' && salePrice ? parseFloat(salePrice) : null,
          channel: mode === 'sale' ? channel : null,
          notes: notes || null,
        });

        onDone(product.id, newStock);
      }

      const label = mode === 'restock' ? 'Entrada registrada' : 'Venta registrada';
      toast({ title: label, description: product.name });
      onClose();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  // ── Derived ────────────────────────────────────────────────────────
  const simpleQtyNum = parseInt(simpleQty) || 0;
  const salePriceNum = parseFloat(salePrice) || 0;
  const simpleNewStock = product
    ? Math.max(0, product.stock + (mode === 'restock' ? simpleQtyNum : -simpleQtyNum))
    : 0;
  const saleTotal = mode === 'sale' && simpleQtyNum > 0 && salePriceNum > 0
    ? simpleQtyNum * salePriceNum : 0;

  const variantTotal = mode === 'sale' && salePriceNum > 0
    ? Object.values(variantQtys).reduce((s, v) => s + (parseInt(v) || 0), 0) * salePriceNum
    : 0;

  if (!product) return null;

  const meta = TYPE_META[product.type];
  const isRestock = mode === 'restock';

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">

        {/* ── Header ──────────────────────────────────────────── */}
        <div className={`px-5 pt-5 pb-4 border-b border-border ${isRestock ? 'bg-green-50/50 dark:bg-green-950/20' : 'bg-red-50/50 dark:bg-red-950/20'}`}>
          <div className="flex items-start gap-3">
            <div className="h-12 w-12 rounded-lg bg-background border border-border overflow-hidden flex-shrink-0">
              {product.image_url
                ? <img src={product.image_url} alt="" className="h-full w-full object-cover" />
                : <div className="h-full w-full flex items-center justify-center"><Package className="h-5 w-5 text-muted-foreground" /></div>}
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base font-semibold leading-tight line-clamp-2">{product.name}</DialogTitle>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${meta.cls}`}>{meta.label}</span>
                <span className="text-xs text-muted-foreground">{product.category_name}</span>
                {!hasVariants && (
                  <span className="text-xs font-medium text-muted-foreground ml-auto">
                    Stock actual: <strong className="text-foreground">{product.stock}</strong>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex mt-4 rounded-lg overflow-hidden border border-border bg-background">
            <button type="button"
              onClick={() => setMode('restock')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-colors ${
                isRestock ? 'bg-green-600 text-white' : 'text-muted-foreground hover:bg-muted/60'
              }`}>
              <TrendingUp className="h-4 w-4" /> Entrada de stock
            </button>
            <button type="button"
              onClick={() => setMode('sale')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-colors ${
                !isRestock ? 'bg-red-500 text-white' : 'text-muted-foreground hover:bg-muted/60'
              }`}>
              <TrendingDown className="h-4 w-4" /> Registrar venta
            </button>
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────── */}
        <div className="px-5 py-4 space-y-4 max-h-[55vh] overflow-y-auto">

          {/* ── SIMPLE PRODUCT ──────────────────────────────── */}
          {!hasVariants && (
            <>
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  {isRestock ? '¿Cuántas unidades ingresaron?' : '¿Cuántas unidades se vendieron?'}
                </Label>

                {/* Big input */}
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min="1"
                    placeholder="0"
                    value={simpleQty}
                    onChange={e => setSimpleQty(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && confirm()}
                    className="text-2xl font-bold h-14 text-center text-3xl"
                    autoFocus
                  />
                </div>

                {/* Quick buttons */}
                <div className="flex gap-1.5">
                  {QUICK_AMOUNTS.map(n => (
                    <button key={n} type="button"
                      onClick={() => setSimpleQty(n.toString())}
                      className={`flex-1 py-1.5 rounded-md text-xs font-bold border transition-colors ${
                        simpleQty === n.toString()
                          ? isRestock ? 'bg-green-600 text-white border-green-600' : 'bg-red-500 text-white border-red-500'
                          : 'border-border hover:bg-muted text-muted-foreground'
                      }`}>
                      {isRestock ? '+' : '-'}{n}
                    </button>
                  ))}
                </div>

                {/* Preview */}
                {simpleQtyNum > 0 && (
                  <div className={`flex items-center justify-between rounded-lg px-4 py-3 border ${
                    isRestock ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Nuevo stock:</span>
                      <StockArrow from={product.stock} delta={simpleQtyNum} mode={mode} />
                    </div>
                    {saleTotal > 0 && (
                      <span className="text-sm font-bold text-green-700 dark:text-green-400">
                        💰 ${saleTotal.toLocaleString('es-AR')}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Sale price (only for venta) */}
              {!isRestock && (
                <div className="space-y-1.5">
                  <Label className="text-sm">Precio de venta (por unidad)</Label>
                  <Input type="number" min="0" placeholder={product.price.toString()}
                    value={salePrice}
                    onChange={e => setSalePrice(e.target.value)}
                    className="h-9" />
                </div>
              )}
            </>
          )}

          {/* ── VARIANT PRODUCT ─────────────────────────────── */}
          {hasVariants && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  {isRestock ? 'Cantidad por variante' : 'Vendido por variante'}
                </Label>
                {!isRestock && salePriceNum > 0 && Object.values(variantQtys).some(v => parseInt(v) > 0) && (
                  <span className="text-sm font-bold text-green-700">💰 ${variantTotal.toLocaleString('es-AR')}</span>
                )}
              </div>

              {loadingVariants ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {variants.map(v => {
                    const qty = parseInt(variantQtys[v.id] || '0') || 0;
                    const newStock = Math.max(0, v.stock + (isRestock ? qty : -qty));
                    const stockCls = newStock === 0 ? 'text-red-500' : newStock < 5 ? 'text-amber-500' : 'text-green-600';
                    return (
                      <div key={v.id} className={`grid grid-cols-[1fr_80px_auto] items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                        variantQtys[v.id] && parseInt(variantQtys[v.id]) > 0
                          ? isRestock ? 'border-green-300 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20'
                                      : 'border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20'
                          : 'border-border bg-background hover:bg-muted/30'
                      }`}>
                        <div>
                          <p className="text-sm font-medium">{v.color}</p>
                          <p className="text-xs text-muted-foreground">Stock: {v.stock}</p>
                        </div>
                        <Input
                          type="number" min="1" placeholder="qty"
                          value={variantQtys[v.id] ?? ''}
                          onChange={e => setVariantQtys(prev => ({ ...prev, [v.id]: e.target.value }))}
                          className="h-8 text-sm text-center px-1"
                        />
                        <div className="text-right min-w-[36px]">
                          {qty > 0
                            ? <span className={`text-sm font-bold ${stockCls}`}>{newStock}</span>
                            : <span className="text-xs text-muted-foreground">{v.stock}</span>
                          }
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Sale price for variants */}
              {!isRestock && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Precio de venta (por unidad)</Label>
                  <Input type="number" min="0" placeholder={product.price.toString()}
                    value={salePrice} onChange={e => setSalePrice(e.target.value)} className="h-8 text-sm" />
                </div>
              )}
            </div>
          )}

          {/* ── Channel (sale only) ──────────────────────────── */}
          {!isRestock && (
            <div className="space-y-1.5">
              <Label className="text-sm">Canal de venta</Label>
              <div className="flex flex-wrap gap-1.5">
                {CHANNELS.map(c => (
                  <button key={c} type="button"
                    onClick={() => setChannel(c)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      channel === c ? 'bg-foreground text-background border-foreground' : 'border-border hover:bg-muted text-muted-foreground'
                    }`}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Notes ───────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Notas (opcional)</Label>
            <Input placeholder={isRestock ? 'Ej: Pedido de proveedor, lote Mayo...' : 'Ej: Cliente Juan, seña pendiente...'}
              value={notes} onChange={e => setNotes(e.target.value)} className="h-8 text-sm" />
          </div>

          {/* ── History ─────────────────────────────────────── */}
          <div className="border border-border rounded-lg overflow-hidden">
            <button type="button"
              className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium bg-muted/30 hover:bg-muted/50 transition-colors"
              onClick={() => setShowHistory(v => !v)}>
              <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-muted-foreground" /> Historial de movimientos</span>
              {showHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showHistory && (
              <div className="px-3 py-2 max-h-48 overflow-y-auto">
                {loadingHistory ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
                ) : history.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 text-center">Sin movimientos registrados</p>
                ) : (
                  history.map(m => <MovementRow key={m.id} m={m} />)
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────── */}
        <div className="px-5 py-3.5 border-t border-border flex gap-2 bg-muted/20">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button
            className={`flex-1 font-semibold ${!isRestock ? 'bg-red-500 hover:bg-red-600' : 'bg-green-600 hover:bg-green-700'}`}
            onClick={confirm}
            disabled={saving}>
            {saving
              ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
              : isRestock ? <TrendingUp className="h-4 w-4 mr-2" /> : <TrendingDown className="h-4 w-4 mr-2" />}
            {isRestock ? 'Registrar entrada' : 'Registrar venta'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
