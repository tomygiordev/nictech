
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import {
  Loader2, Search, TrendingUp, TrendingDown, Package,
  DollarSign, BarChart3, RefreshCw, X, FileText, Wrench, Trash2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Movement {
  id: string;
  type: 'restock' | 'sale';
  quantity: number;
  unit_price: number | null;
  channel: string | null;
  notes: string | null;
  created_at: string;
  product_name: string;
  product_image: string | null;
  variant_color: string | null;
}

type DateRange = 'today' | 'week' | 'month' | 'all';
type TypeFilter = 'all' | 'sale' | 'restock';

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getDateBound(range: DateRange): string | null {
  const now = new Date();
  if (range === 'today') {
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }
  if (range === 'week') {
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    now.setDate(now.getDate() + diff);
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }
  if (range === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }
  return null;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }),
    time: d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
  };
}

// ─── PDF report ───────────────────────────────────────────────────────────────

interface ReportMeta {
  dateRange: DateRange;
  typeFilter: TypeFilter;
  channelFilter: string;
  generatedAt: string;
}

interface ReportStats {
  revenue: number;
  unitsSold: number;
  unitsIn: number;
  totalMov: number;
}

function generateHistoryPDF(movements: Movement[], stats: ReportStats, meta: ReportMeta) {
  const fmt  = (n: number) => n.toLocaleString('es-AR');
  const now  = new Date(meta.generatedAt);
  const genDate = now.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const genTime = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  const rangeLabel: Record<DateRange, string> = {
    today: 'Hoy',
    week: 'Esta semana',
    month: 'Este mes',
    all: 'Todo el historial',
  };

  const typeLabel: Record<TypeFilter, string> = {
    all: 'Todos',
    sale: 'Ventas',
    restock: 'Entradas',
  };

  const rows = movements.map(m => {
    const { date, time } = fmtDate(m.created_at);
    const isSale = m.type === 'sale';
    const lineTotal = m.quantity * (m.unit_price ?? 0);
    return `
    <tr>
      <td class="nowrap">${date}<br><small>${time}</small></td>
      <td>${m.product_name}${m.variant_color ? `<br><small>${m.variant_color}</small>` : ''}</td>
      <td class="center">
        <span class="badge ${isSale ? 'badge-red' : 'badge-green'}">${isSale ? 'Venta' : 'Entrada'}</span>
      </td>
      <td class="center ${isSale ? 'red' : 'green'}">${isSale ? '-' : '+'}${m.quantity}</td>
      <td class="right">${lineTotal > 0 ? '$' + fmt(lineTotal) : '—'}</td>
      <td>${m.channel ?? '—'}</td>
      <td class="muted">${m.notes ?? '—'}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Informe de Inventario — NicTech</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI',Arial,sans-serif; font-size:12px; color:#111; background:#fff; padding:32px 36px; max-width:900px; margin:0 auto; }

    .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #111; padding-bottom:14px; margin-bottom:18px; }
    .brand { font-size:24px; font-weight:900; letter-spacing:-1px; }
    .brand span { color:#16a34a; }
    .brand-sub { font-size:10px; color:#666; text-transform:uppercase; letter-spacing:1px; margin-top:2px; }
    .report-meta { text-align:right; }
    .report-title { font-size:16px; font-weight:800; text-transform:uppercase; letter-spacing:1px; }
    .report-sub { font-size:11px; color:#666; margin-top:4px; }

    .filters { display:flex; gap:24px; margin-bottom:18px; font-size:11px; }
    .filter-block label { display:block; font-size:10px; color:#888; text-transform:uppercase; letter-spacing:.5px; margin-bottom:2px; }
    .filter-block strong { font-size:12px; }

    .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px; }
    .stat { border:1px solid #e5e5e5; border-left:3px solid #111; border-radius:6px; padding:10px 12px; }
    .stat.green { border-left-color:#16a34a; }
    .stat.red   { border-left-color:#dc2626; }
    .stat.blue  { border-left-color:#2563eb; }
    .stat label { display:block; font-size:9px; text-transform:uppercase; letter-spacing:.5px; color:#888; margin-bottom:3px; }
    .stat strong { font-size:16px; font-weight:800; display:block; }
    .stat small { font-size:10px; color:#666; }

    table { width:100%; border-collapse:collapse; font-size:11.5px; }
    thead tr { background:#111; color:#fff; }
    thead th { padding:8px 10px; text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.4px; font-weight:600; }
    thead th.center { text-align:center; }
    thead th.right  { text-align:right; }
    tbody tr { border-bottom:1px solid #eee; }
    tbody tr:nth-child(even) { background:#fafafa; }
    tbody tr:last-child { border-bottom:none; }
    td { padding:7px 10px; vertical-align:top; }
    td small { display:block; color:#888; font-size:10px; margin-top:1px; }
    td.center { text-align:center; }
    td.right  { text-align:right; }
    td.nowrap { white-space:nowrap; }
    td.muted  { color:#888; }
    td.green  { color:#16a34a; font-weight:700; }
    td.red    { color:#dc2626; font-weight:700; }

    .badge { display:inline-block; padding:1px 7px; border-radius:999px; font-size:10px; font-weight:700; }
    .badge-green { background:#dcfce7; color:#15803d; }
    .badge-red   { background:#fee2e2; color:#b91c1c; }

    .footer { margin-top:24px; text-align:center; font-size:10px; color:#aaa; border-top:1px solid #e5e5e5; padding-top:12px; }

    @media print {
      body { padding:16px 20px; }
      @page { margin:.8cm; size:A4 landscape; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">Nic<span>Tech</span></div>
      <div class="brand-sub">Tecnología &amp; Reparaciones</div>
    </div>
    <div class="report-meta">
      <div class="report-title">Informe de Inventario</div>
      <div class="report-sub">Generado el ${genDate} a las ${genTime}</div>
    </div>
  </div>

  <div class="filters">
    <div class="filter-block"><label>Período</label><strong>${rangeLabel[meta.dateRange]}</strong></div>
    <div class="filter-block"><label>Tipo</label><strong>${typeLabel[meta.typeFilter]}</strong></div>
    ${meta.channelFilter !== 'all' ? `<div class="filter-block"><label>Canal</label><strong>${meta.channelFilter}</strong></div>` : ''}
    <div class="filter-block"><label>Movimientos</label><strong>${movements.length}</strong></div>
  </div>

  <div class="stats">
    <div class="stat green">
      <label>Ingresos (ventas)</label>
      <strong>$${fmt(stats.revenue)}</strong>
      <small>${stats.unitsSold} unidades vendidas</small>
    </div>
    <div class="stat red">
      <label>Unidades vendidas</label>
      <strong>${stats.unitsSold}</strong>
      <small>en el período</small>
    </div>
    <div class="stat blue">
      <label>Unidades repuestas</label>
      <strong>${stats.unitsIn}</strong>
      <small>entradas de stock</small>
    </div>
    <div class="stat">
      <label>Total movimientos</label>
      <strong>${stats.totalMov}</strong>
      <small>ventas + entradas</small>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Fecha</th>
        <th>Producto</th>
        <th class="center">Tipo</th>
        <th class="center">Cant.</th>
        <th class="right">Total</th>
        <th>Canal</th>
        <th>Notas</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="footer">NicTech · Informe generado el ${genDate} · ${movements.length} movimiento${movements.length !== 1 ? 's' : ''}</div>

  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=1000,height=900');
  if (!win) { alert('Permitir ventanas emergentes para generar el PDF'); return; }
  win.document.write(html);
  win.document.close();
}

// ─── Stat mini-card ───────────────────────────────────────────────────────────

function MiniStat({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${color}`}>
      <div className="opacity-60">{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-lg font-bold leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export const InventoryHistory = () => {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [dateRange, setDateRange] = useState<DateRange>('week');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [search, setSearch] = useState('');

  // ── Fetch ──────────────────────────────────────────────────────
  const fetchMovements = async () => {
    setLoading(true);
    let q = (supabase as any)
      .from('inventory_movements')
      .select('id, type, quantity, unit_price, channel, notes, created_at, products(name, image_url), product_variants(color)')
      .order('created_at', { ascending: false })
      .limit(500);

    const bound = getDateBound(dateRange);
    if (bound) q = q.gte('created_at', bound);

    const { data } = await q;
    if (data) {
      setMovements(data.map((m: any) => ({
        id: m.id, type: m.type, quantity: m.quantity,
        unit_price: m.unit_price, channel: m.channel, notes: m.notes,
        created_at: m.created_at,
        product_name: m.products?.name ?? (m.channel === 'Reparación' ? 'Servicio de reparación' : 'Producto eliminado'),
        product_image: m.products?.image_url ?? null,
        variant_color: m.product_variants?.color ?? null,
      })));
    }
    setLoading(false);
  };

  useEffect(() => { fetchMovements(); }, [dateRange]);

  const deleteMovement = async (id: string) => {
    if (!window.confirm('¿Eliminar este movimiento del historial?')) return;
    const { error } = await (supabase as any).from('inventory_movements').delete().eq('id', id);
    if (error) { toast({ title: 'Error al eliminar', variant: 'destructive' }); return; }
    setMovements(prev => prev.filter(m => m.id !== id));
  };

  // ── Filtered ───────────────────────────────────────────────────
  const filtered = useMemo(() => movements.filter(m => {
    if (typeFilter !== 'all' && m.type !== typeFilter) return false;
    if (channelFilter !== 'all' && (m.channel ?? 'Local') !== channelFilter) return false;
    if (!search.trim()) return true;
    return m.product_name.toLowerCase().includes(search.toLowerCase());
  }), [movements, typeFilter, channelFilter, search]);

  // ── Stats (from ALL loaded, not just filtered) ─────────────────
  const stats = useMemo(() => {
    const sales    = movements.filter(m => m.type === 'sale');
    const restocks = movements.filter(m => m.type === 'restock');
    const revenue  = sales.reduce((s, m) => s + m.quantity * (m.unit_price ?? 0), 0);
    const unitsSold = sales.reduce((s, m) => s + m.quantity, 0);
    const unitsIn   = restocks.reduce((s, m) => s + m.quantity, 0);
    return { revenue, unitsSold, unitsIn, totalMov: movements.length };
  }, [movements]);

  // ── Unique channels ────────────────────────────────────────────
  const channels = useMemo(() => {
    const set = new Set(movements.map(m => m.channel ?? 'Local'));
    return Array.from(set).sort();
  }, [movements]);

  const DATE_TABS: { key: DateRange; label: string }[] = [
    { key: 'today', label: 'Hoy' },
    { key: 'week',  label: 'Esta semana' },
    { key: 'month', label: 'Este mes' },
    { key: 'all',   label: 'Todo' },
  ];

  return (
    <div className="space-y-4">

      {/* Date range tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {DATE_TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setDateRange(t.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              dateRange === t.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}>
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex gap-1.5">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={fetchMovements} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </Button>
          <Button
            variant="outline" size="sm"
            className="h-8 gap-1.5 text-xs font-semibold border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/30"
            disabled={loading || filtered.length === 0}
            onClick={() => generateHistoryPDF(filtered, stats, {
              dateRange, typeFilter, channelFilter,
              generatedAt: new Date().toISOString(),
            })}>
            <FileText className="h-3.5 w-3.5" /> Generar PDF
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MiniStat icon={<DollarSign className="h-5 w-5" />} label="Ingresos (ventas)"
          value={`$${stats.revenue.toLocaleString('es-AR')}`}
          sub={`${stats.unitsSold} unidades vendidas`}
          color="border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20" />
        <MiniStat icon={<TrendingDown className="h-5 w-5" />} label="Unidades vendidas"
          value={stats.unitsSold.toString()}
          sub="en el período"
          color="border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20" />
        <MiniStat icon={<TrendingUp className="h-5 w-5" />} label="Unidades repuestas"
          value={stats.unitsIn.toString()}
          sub="entradas de stock"
          color="border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20" />
        <MiniStat icon={<BarChart3 className="h-5 w-5" />} label="Total movimientos"
          value={stats.totalMov.toString()}
          sub="entradas + ventas"
          color="border-border bg-muted/30" />
      </div>

      {/* Table card */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border bg-muted/30">
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Buscar producto..." value={search}
              onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
          </div>

          {/* Type filter chips */}
          <div className="flex gap-1">
            {(['all', 'sale', 'restock'] as TypeFilter[]).map(t => (
              <button key={t} type="button" onClick={() => setTypeFilter(t)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  typeFilter === t
                    ? t === 'sale' ? 'bg-red-500 text-white border-red-500'
                      : t === 'restock' ? 'bg-green-600 text-white border-green-600'
                      : 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}>
                {t === 'all' ? 'Todo' : t === 'sale' ? 'Ventas' : 'Entradas'}
              </button>
            ))}
          </div>

          {/* Channel filter */}
          {channels.length > 1 && (
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue placeholder="Canal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los canales</SelectItem>
                {channels.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          {(search || typeFilter !== 'all' || channelFilter !== 'all') && (
            <button type="button" className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
              onClick={() => { setSearch(''); setTypeFilter('all'); setChannelFilter('all'); }}>
              <X className="h-3 w-3" /> Limpiar
            </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fecha</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Producto</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tipo</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cant.</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Canal</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notas</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-muted-foreground text-sm">
                  Sin movimientos en este período
                </td></tr>
              ) : filtered.map(m => {
                const isSale   = m.type === 'sale';
                const isRepair = m.channel === 'Reparación';
                const { date, time } = fmtDate(m.created_at);
                const lineTotal = m.quantity * (m.unit_price ?? 0);
                return (
                  <tr key={m.id}
                    className={`border-b border-border/50 border-l-2 transition-colors hover:bg-muted/20 ${
                      isRepair ? 'border-l-blue-400' : isSale ? 'border-l-red-400' : 'border-l-green-400'
                    }`}>

                    {/* Date */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <p className="text-sm font-medium">{date}</p>
                      <p className="text-xs text-muted-foreground">{time}</p>
                    </td>

                    {/* Product */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className={`h-7 w-7 rounded overflow-hidden flex-shrink-0 flex items-center justify-center ${isRepair ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-muted'}`}>
                          {m.product_image
                            ? <img src={m.product_image} alt="" className="h-full w-full object-cover" />
                            : isRepair
                              ? <Wrench className="h-3 w-3 text-blue-500" />
                              : <Package className="h-3 w-3 text-muted-foreground" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate max-w-[180px]">{m.product_name}</p>
                          {isRepair && m.notes
                            ? <p className="text-xs text-blue-500 font-medium truncate max-w-[180px]">{m.notes}</p>
                            : m.variant_color
                              ? <p className="text-xs text-muted-foreground">{m.variant_color}</p>
                              : null}
                        </div>
                      </div>
                    </td>

                    {/* Type badge */}
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                        isRepair
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : isSale
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      }`}>
                        {isRepair ? <Wrench className="h-3 w-3" /> : isSale ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                        {isRepair ? 'Reparación' : isSale ? 'Venta' : 'Entrada'}
                      </span>
                    </td>

                    {/* Quantity */}
                    <td className="px-3 py-2.5 text-center">
                      <span className={`font-bold text-sm ${isRepair ? 'text-blue-600' : isSale ? 'text-red-600' : 'text-green-600'}`}>
                        {isRepair ? '' : isSale ? '-' : '+'}{m.quantity}
                      </span>
                    </td>

                    {/* Total */}
                    <td className="px-3 py-2.5 text-right font-semibold text-sm">
                      {lineTotal > 0 ? `$${lineTotal.toLocaleString('es-AR')}` : <span className="text-muted-foreground">—</span>}
                    </td>

                    {/* Channel */}
                    <td className="px-3 py-2.5">
                      {m.channel
                        ? <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{m.channel}</span>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>

                    {/* Notes */}
                    <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[140px] truncate">
                      {m.notes ?? '—'}
                    </td>

                    {/* Delete */}
                    <td className="px-2 py-2.5">
                      <button type="button"
                        onClick={() => deleteMovement(m.id)}
                        className="text-muted-foreground/40 hover:text-destructive transition-colors p-1 rounded hover:bg-destructive/10">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
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
            <span>{filtered.length} movimiento{filtered.length !== 1 ? 's' : ''}</span>
            {typeFilter === 'all' && (
              <span>
                {filtered.filter(m => m.type === 'sale').length} ventas ·{' '}
                {filtered.filter(m => m.type === 'restock').length} entradas
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
