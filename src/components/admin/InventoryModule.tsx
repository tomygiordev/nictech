
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import {
  Trash2, Search, Package, AlertTriangle, TrendingDown, Layers, Smartphone,
  BarChart3, RefreshCw, Loader2, CheckSquare, Square, Zap, ClipboardList, PackagePlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getProductType, TYPE_META, type ProductType } from '@/lib/productTypes';
import { StockMovementModal, type ModalProduct } from './StockMovementModal';
import { QuickSaleModal } from './QuickSaleModal';
import { QuickRestockModal } from './QuickRestockModal';
import { InventoryHistory } from './InventoryHistory';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvProduct {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  price: number;
  price_usd: number | null;
  stock: number;
  image_url: string | null;
  is_active: boolean | null;
}

// ─── Stock badge ──────────────────────────────────────────────────────────────

function StockBadge({ stock }: { stock: number }) {
  if (stock === 0) return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Sin stock</span>;
  if (stock < 5)   return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{stock}</span>;
  if (stock < 15)  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">{stock}</span>;
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">{stock}</span>;
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string | number;
  sub?: string; accent?: 'red' | 'amber' | 'green' | 'blue';
}) {
  const cls = {
    red:   'border-l-red-500 bg-red-50/50 dark:bg-red-950/20',
    amber: 'border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20',
    green: 'border-l-green-500 bg-green-50/50 dark:bg-green-950/20',
    blue:  'border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20',
  }[accent ?? 'blue'];
  return (
    <div className={`border-l-4 rounded-lg border border-border p-4 ${cls}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div className="opacity-30 mt-1">{icon}</div>
      </div>
    </div>
  );
}

const TYPE_ICONS: Record<ProductType, React.ReactNode> = {
  phone:   <Smartphone className="h-3.5 w-3.5" />,
  case:    <Layers className="h-3.5 w-3.5" />,
  variant: <Layers className="h-3.5 w-3.5" />,
  generic: <Package className="h-3.5 w-3.5" />,
};

// ─── Main ─────────────────────────────────────────────────────────────────────

export const InventoryModule = () => {
  const [products, setProducts] = useState<InvProduct[]>([]);
  const [variantIds, setVariantIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // View
  const [activeView, setActiveView] = useState<'inventory' | 'history'>('inventory');

  // Modals
  const [modalProduct, setModalProduct] = useState<ModalProduct | null>(null);
  const [quickSaleOpen, setQuickSaleOpen] = useState(false);
  const [quickRestockOpen, setQuickRestockOpen] = useState(false);

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Filters
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | ProductType>('all');
  const [filterStock, setFilterStock] = useState<'all' | 'critical' | 'out'>('all');

  // ── Fetch ────────────────────────────────────────────────────────
  const fetchAll = async () => {
    setLoading(true);
    setSelected(new Set());
    const [prodRes, varRes] = await Promise.all([
      (supabase as any).from('products')
        .select('id, name, category_id, price, price_usd, stock, image_url, is_active, category:categories(name)')
        .order('name'),
      (supabase as any).from('product_variants').select('product_id'),
    ]);
    if (prodRes.data) {
      setProducts(prodRes.data.map((item: any) => ({
        id: item.id, name: item.name, category_id: item.category_id,
        category_name: item.category?.name ?? 'Sin categoría',
        price: item.price, price_usd: item.price_usd ?? null,
        stock: item.stock, image_url: item.image_url, is_active: item.is_active,
      })));
    }
    if (varRes.data) setVariantIds(new Set((varRes.data as any[]).map((v: any) => v.product_id)));
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // ── Open modal ───────────────────────────────────────────────────
  const openModal = (p: InvProduct) => {
    const type = getType(p);
    setModalProduct({
      id: p.id, name: p.name, image_url: p.image_url,
      price: p.price, stock: p.stock,
      category_name: p.category_name, type,
    });
  };

  const handleDone = (productId: string, newStock: number) => {
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, stock: newStock } : p));
  };

  // ── Delete ───────────────────────────────────────────────────────
  const deleteProduct = async (id: string, name: string) => {
    if (!window.confirm(`¿Eliminar "${name}"?`)) return;
    await (supabase as any).from('products').delete().eq('id', id);
    setProducts(prev => prev.filter(p => p.id !== id));
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
    toast({ title: 'Eliminado', description: name });
  };

  const bulkDelete = async () => {
    if (!selected.size || !window.confirm(`¿Eliminar ${selected.size} producto(s)?`)) return;
    for (const id of selected) await (supabase as any).from('products').delete().eq('id', id);
    setProducts(prev => prev.filter(p => !selected.has(p.id)));
    setSelected(new Set());
    toast({ title: `${selected.size} productos eliminados` });
  };

  const deleteZeroStock = async () => {
    const ids = filtered.filter(p => p.stock === 0).map(p => p.id);
    if (!ids.length) { toast({ title: 'No hay productos sin stock' }); return; }
    if (!window.confirm(`¿Eliminar ${ids.length} producto(s) sin stock?`)) return;
    for (const id of ids) await (supabase as any).from('products').delete().eq('id', id);
    setProducts(prev => prev.filter(p => !ids.includes(p.id)));
    toast({ title: `${ids.length} productos eliminados` });
  };

  // ── Helpers ──────────────────────────────────────────────────────
  const getType = (p: InvProduct) => getProductType(p.category_name, variantIds, p.id);

  const filtered = useMemo(() => products.filter(p => {
    const type = getType(p);
    if (activeTab !== 'all' && type !== activeTab) return false;
    if (filterStock === 'out' && p.stock !== 0) return false;
    if (filterStock === 'critical' && p.stock >= 5) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.category_name.toLowerCase().includes(q);
  }), [products, variantIds, activeTab, filterStock, search]);

  const stats = useMemo(() => ({
    total:      products.length,
    units:      products.reduce((s, p) => s + p.stock, 0),
    outOfStock: products.filter(p => p.stock === 0).length,
    critical:   products.filter(p => p.stock > 0 && p.stock < 5).length,
    value:      products.reduce((s, p) => s + p.price * p.stock, 0),
  }), [products]);

  const TABS: { key: 'all' | ProductType; label: string }[] = [
    { key: 'all',     label: `Todo (${products.length})` },
    { key: 'phone',   label: `Celulares (${products.filter(p => getType(p) === 'phone').length})` },
    { key: 'case',    label: `Fundas (${products.filter(p => getType(p) === 'case').length})` },
    { key: 'variant', label: `Variantes (${products.filter(p => getType(p) === 'variant').length})` },
    { key: 'generic', label: `Otros (${products.filter(p => getType(p) === 'generic').length})` },
  ];

  const allSelected = filtered.length > 0 && filtered.every(p => selected.has(p.id));
  const toggleAll = () => {
    if (allSelected) setSelected(prev => { const s = new Set(prev); filtered.forEach(p => s.delete(p.id)); return s; });
    else setSelected(prev => { const s = new Set(prev); filtered.forEach(p => s.add(p.id)); return s; });
  };

  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Top bar: view tabs + Venta Rápida */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button type="button"
            onClick={() => setActiveView('inventory')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
              activeView === 'inventory'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}>
            <Package className="h-4 w-4" /> Inventario
          </button>
          <button type="button"
            onClick={() => setActiveView('history')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-l border-border ${
              activeView === 'history'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}>
            <ClipboardList className="h-4 w-4" /> Historial
          </button>
        </div>

        <div className="ml-auto flex gap-2">
          <Button
            onClick={() => setQuickRestockOpen(true)}
            className="gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold shadow-sm">
            <PackagePlus className="h-4 w-4" /> Reponer
          </Button>
          <Button
            onClick={() => setQuickSaleOpen(true)}
            className="gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold shadow-sm">
            <Zap className="h-4 w-4" /> Venta Rápida
          </Button>
        </div>
      </div>

      {/* History view */}
      {activeView === 'history' && <InventoryHistory />}

      {/* Inventory view */}
      {activeView === 'inventory' && <>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<Package className="h-6 w-6" />} label="Total SKUs" value={stats.total} sub="productos registrados" accent="blue" />
        <StatCard icon={<BarChart3 className="h-6 w-6" />} label="Unidades en stock" value={stats.units.toLocaleString('es-AR')} sub="unidades totales" accent="green" />
        <StatCard icon={<AlertTriangle className="h-6 w-6" />} label="Stock crítico" value={stats.outOfStock + stats.critical}
          sub={`${stats.outOfStock} sin stock · ${stats.critical} bajos`} accent={stats.outOfStock + stats.critical > 0 ? 'amber' : 'green'} />
        <StatCard icon={<TrendingDown className="h-6 w-6" />} label="Valor inventario"
          value={`$${stats.value.toLocaleString('es-AR')}`} sub="precio × unidades (ARS)" accent="blue" />
      </div>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border bg-muted/30">
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Buscar producto..." value={search}
              onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
          </div>

          <Select value={filterStock} onValueChange={v => setFilterStock(v as any)}>
            <SelectTrigger className="h-8 text-xs w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los stocks</SelectItem>
              <SelectItem value="critical">Stock crítico (&lt;5)</SelectItem>
              <SelectItem value="out">Sin stock</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={fetchAll} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </Button>

          {selected.size > 0 && (
            <Button variant="destructive" size="sm" className="h-8 gap-1 text-xs" onClick={bulkDelete}>
              <Trash2 className="h-3.5 w-3.5" /> Eliminar {selected.size}
            </Button>
          )}

          <Button variant="outline" size="sm"
            className="h-8 gap-1 text-xs text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5"
            onClick={deleteZeroStock}>
            <Trash2 className="h-3.5 w-3.5" /> Limpiar sin stock
          </Button>
        </div>

        {/* Type tabs */}
        <div className="flex overflow-x-auto border-b border-border">
          {TABS.map(tab => (
            <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
              className={`flex-shrink-0 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="w-8 px-3 py-2.5">
                  <button type="button" onClick={toggleAll} className="text-muted-foreground hover:text-foreground">
                    {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  </button>
                </th>
                <th className="w-8 px-1 py-2.5" />
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Producto</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tipo</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stock</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Precio</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide pr-4">Gestión</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">Sin resultados</td></tr>
              ) : filtered.map(p => {
                const type  = getType(p);
                const meta  = TYPE_META[type];
                const isSel = selected.has(p.id);

                const borderCls = {
                  phone:   'border-l-blue-400',
                  case:    'border-l-purple-400',
                  variant: 'border-l-orange-400',
                  generic: 'border-l-gray-300 dark:border-l-gray-600',
                }[type];

                return (
                  <tr key={p.id}
                    className={`border-b border-border border-l-2 ${borderCls} transition-colors ${
                      isSel ? 'bg-primary/5' : p.stock === 0 ? 'bg-red-50/30 dark:bg-red-950/10' : 'hover:bg-muted/30'
                    }`}>

                    {/* Checkbox */}
                    <td className="px-3 py-2.5">
                      <button type="button"
                        onClick={() => setSelected(prev => { const s = new Set(prev); s.has(p.id) ? s.delete(p.id) : s.add(p.id); return s; })}
                        className="text-muted-foreground hover:text-foreground">
                        {isSel ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                      </button>
                    </td>

                    {/* Thumbnail */}
                    <td className="px-1 py-2.5">
                      <div className="h-9 w-9 rounded bg-muted overflow-hidden">
                        {p.image_url
                          ? <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                          : <div className="h-full w-full flex items-center justify-center opacity-30"><Package className="h-4 w-4" /></div>}
                      </div>
                    </td>

                    {/* Name */}
                    <td className="px-3 py-2.5">
                      <p className="font-medium leading-tight line-clamp-1">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.category_name}</p>
                    </td>

                    {/* Type */}
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>
                        {TYPE_ICONS[type]} {meta.label}
                      </span>
                    </td>

                    {/* Stock */}
                    <td className="px-3 py-2.5"><StockBadge stock={p.stock} /></td>

                    {/* Price */}
                    <td className="px-3 py-2.5 text-sm font-medium">
                      {p.price_usd != null
                        ? <><span className="text-green-600">USD {p.price_usd}</span><span className="text-xs text-muted-foreground ml-1">(${p.price.toLocaleString('es-AR')})</span></>
                        : `$${p.price.toLocaleString('es-AR')}`}
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          className={`h-7 gap-1.5 text-xs font-semibold min-w-[90px] justify-center ${
                            p.stock === 0
                              ? 'px-4 bg-red-500 hover:bg-red-600 text-white'
                              : 'px-3 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20'
                          }`}
                          variant="ghost"
                          onClick={() => openModal(p)}>
                          <Zap className="h-3 w-3" />
                          {p.stock === 0 ? 'Reponer' : 'Gestionar'}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteProduct(p.id, p.name)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        {!loading && filtered.length > 0 && (
          <div className="px-4 py-2.5 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
            <span>{filtered.length} producto{filtered.length !== 1 ? 's' : ''}</span>
            {selected.size > 0 && <span className="font-medium text-foreground">{selected.size} seleccionado{selected.size !== 1 ? 's' : ''}</span>}
          </div>
        )}
      </div>

      </> /* end inventory view */}

      {/* Modals */}
      <StockMovementModal
        product={modalProduct}
        open={!!modalProduct}
        onClose={() => setModalProduct(null)}
        onDone={handleDone}
      />
      <QuickSaleModal
        open={quickSaleOpen}
        onClose={() => setQuickSaleOpen(false)}
        onSaleComplete={handleDone}
        variantProductIds={variantIds}
      />
      <QuickRestockModal
        open={quickRestockOpen}
        onClose={() => setQuickRestockOpen(false)}
        onRestockComplete={handleDone}
        variantProductIds={variantIds}
      />
    </div>
  );
};
