import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, ShoppingCart, Wrench, Package,
  AlertTriangle, RefreshCw, CheckCircle2, Clock, DollarSign, Activity, Minus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface KpiData {
  revenueThisMonth: number;
  revenueLastMonth: number;
  ordersThisMonth: number;
  ordersLastMonth: number;
  activeRepairs: number;
  finishedThisMonth: number;
  zeroStock: number;
  criticalStock: number; // 1-4 units
  totalProducts: number;
}

interface SalePoint { date: string; total: number; orders: number }
interface RepairStatusPoint { status: string; count: number }
interface RecentRepair {
  id: string; tracking_code: string; client_name: string | null;
  device_brand: string | null; device_model: string;
  status: string; created_at: string;
}
interface RecentOrder {
  id: string; total: number; status: string; created_at: string; payer: { first_name?: string; last_name?: string; email?: string } | null;
}
interface CriticalProduct { id: string; name: string; stock: number; category: string | null }

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  'Recibido':   '#3b82f6',
  'Diagnóstico':'#eab308',
  'Repuestos':  '#f97316',
  'Reparación': '#8b5cf6',
  'Finalizado': '#22c55e',
};

const FALLBACK_COLOR = '#94a3b8';

const fmt = (n: number) =>
  n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

const fmtShort = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return fmt(n);
};

function trend(current: number, previous: number) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function fillDays(data: SalePoint[], days = 30): SalePoint[] {
  const map = new Map(data.map(d => [d.date, d]));
  const result: SalePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push(map.get(key) ?? { date: key, total: 0, orders: 0 });
  }
  return result;
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

const SalesTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const d = new Date(label + 'T12:00:00');
  const dateStr = d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2 shadow-lg text-sm">
      <p className="font-medium mb-1">{dateStr}</p>
      <p className="text-primary">{fmt(payload[0].value)}</p>
      <p className="text-muted-foreground">{payload[1]?.value ?? 0} {payload[1]?.value === 1 ? 'orden' : 'órdenes'}</p>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  iconBg: string;
  trendValue?: number | null;
  trendLabel?: string;
  sub?: string;
}

const KpiCard = ({ title, value, icon, iconBg, trendValue, trendLabel, sub }: KpiCardProps) => {
  const isUp   = trendValue !== null && trendValue !== undefined && trendValue > 0;
  const isDown = trendValue !== null && trendValue !== undefined && trendValue < 0;
  return (
    <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground font-medium">{title}</p>
        <div className={cn('p-2 rounded-xl', iconBg)}>{icon}</div>
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {trendValue !== null && trendValue !== undefined && (
        <div className="flex items-center gap-1.5 text-xs">
          {isUp   && <TrendingUp  className="h-3.5 w-3.5 text-green-500" />}
          {isDown && <TrendingDown className="h-3.5 w-3.5 text-red-500"  />}
          {!isUp && !isDown && <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className={cn(isUp ? 'text-green-600' : isDown ? 'text-red-500' : 'text-muted-foreground')}>
            {isUp ? '+' : ''}{trendValue}%
          </span>
          {trendLabel && <span className="text-muted-foreground">{trendLabel}</span>}
        </div>
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const DashboardModule = () => {
  const [kpi, setKpi]               = useState<KpiData | null>(null);
  const [salesByDay, setSalesByDay] = useState<SalePoint[]>([]);
  const [repairStatus, setRepairStatus] = useState<RepairStatusPoint[]>([]);
  const [recentRepairs, setRecentRepairs] = useState<RecentRepair[]>([]);
  const [recentOrders, setRecentOrders]   = useState<RecentOrder[]>([]);
  const [criticalProducts, setCriticalProducts] = useState<CriticalProduct[]>([]);
  const [loading, setLoading]       = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const now = new Date();
    const startThisMonth  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startLastMonth  = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const endLastMonth    = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();
    const thirtyDaysAgo   = new Date(Date.now() - 30 * 864e5).toISOString();

    // Parallel fetches
    const [
      { data: ordersAll },
      { data: salesRaw },
      { data: repairsAll },
      { data: productsZero },
      { data: productsCritical },
      { data: totalProductsRes },
      { data: recentRepairsData },
      { data: recentOrdersData },
    ] = await Promise.all([
      // All approved orders for KPI
      supabase.from('orders').select('total, created_at').eq('status', 'approved'),
      // Sales by day last 30 days
      supabase.rpc
        ? supabase.from('orders')
            .select('total, created_at')
            .eq('status', 'approved')
            .gte('created_at', thirtyDaysAgo)
        : supabase.from('orders').select('total, created_at').eq('status', 'approved').gte('created_at', thirtyDaysAgo),
      // All non-deleted repairs
      supabase.from('repairs').select('status, created_at').neq('is_deleted', true),
      // Zero stock products
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('stock', 0),
      // Critical stock (1-4)
      supabase.from('products')
        .select('id, name, stock, category_id')
        .gt('stock', 0).lt('stock', 5)
        .order('stock', { ascending: true })
        .limit(8),
      // Total products count
      supabase.from('products').select('id', { count: 'exact', head: true }),
      // Recent repairs
      supabase.from('repairs')
        .select('id, tracking_code, client_name, device_brand, device_model, status, created_at')
        .neq('is_deleted', true)
        .order('created_at', { ascending: false })
        .limit(6),
      // Recent orders
      supabase.from('orders')
        .select('id, total, status, created_at, payer')
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    // ── KPI calculations ──────────────────────────────────────────────────────
    const approved = (ordersAll ?? []).filter(o => true); // already filtered by eq
    const revenueThisMonth = (ordersAll ?? [])
      .filter(o => o.created_at >= startThisMonth)
      .reduce((s, o) => s + Number(o.total), 0);
    const revenueLastMonth = (ordersAll ?? [])
      .filter(o => o.created_at >= startLastMonth && o.created_at <= endLastMonth)
      .reduce((s, o) => s + Number(o.total), 0);
    const ordersThisMonth = (ordersAll ?? []).filter(o => o.created_at >= startThisMonth).length;
    const ordersLastMonth = (ordersAll ?? [])
      .filter(o => o.created_at >= startLastMonth && o.created_at <= endLastMonth).length;

    const repairs = repairsAll ?? [];
    const activeRepairs = repairs.filter(r => r.status !== 'Finalizado').length;
    const finishedThisMonth = repairs.filter(r => r.status === 'Finalizado' && r.created_at && r.created_at >= startThisMonth).length;

    setKpi({
      revenueThisMonth,
      revenueLastMonth,
      ordersThisMonth,
      ordersLastMonth,
      activeRepairs,
      finishedThisMonth,
      zeroStock: (productsZero as any)?.length ?? 0,
      criticalStock: (productsCritical ?? []).length,
      totalProducts: (totalProductsRes as any)?.length ?? 0,
    });

    // ── Sales by day ──────────────────────────────────────────────────────────
    const dayMap = new Map<string, { total: number; orders: number }>();
    for (const o of (salesRaw ?? [])) {
      const key = o.created_at.slice(0, 10);
      const prev = dayMap.get(key) ?? { total: 0, orders: 0 };
      dayMap.set(key, { total: prev.total + Number(o.total), orders: prev.orders + 1 });
    }
    const salesPoints: SalePoint[] = Array.from(dayMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));
    setSalesByDay(fillDays(salesPoints, 30));

    // ── Repairs by status ─────────────────────────────────────────────────────
    const statusMap = new Map<string, number>();
    for (const r of repairs) {
      statusMap.set(r.status, (statusMap.get(r.status) ?? 0) + 1);
    }
    setRepairStatus(
      Array.from(statusMap.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count)
    );

    // ── Recent repairs ────────────────────────────────────────────────────────
    setRecentRepairs((recentRepairsData ?? []) as RecentRepair[]);

    // ── Recent orders ─────────────────────────────────────────────────────────
    setRecentOrders(
      (recentOrdersData ?? []).map((o: any) => ({
        ...o,
        payer: typeof o.payer === 'object' ? o.payer : null,
      }))
    );

    // ── Critical products ─────────────────────────────────────────────────────
    setCriticalProducts(
      (productsCritical ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        stock: p.stock,
        category: null,
      }))
    );

    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ─── Render loading ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-muted rounded-2xl h-32" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-muted rounded-2xl h-64" />
          <div className="bg-muted rounded-2xl h-64" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-muted rounded-2xl h-56" />
          <div className="bg-muted rounded-2xl h-56" />
        </div>
      </div>
    );
  }

  const revTrend = trend(kpi!.revenueThisMonth, kpi!.revenueLastMonth);
  const ordTrend = trend(kpi!.ordersThisMonth, kpi!.ordersLastMonth);
  const hasAnySales = salesByDay.some(d => d.total > 0);

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Dashboard
          </h2>
          {lastUpdated && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Actualizado: {lastUpdated.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={load} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          Actualizar
        </Button>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Ingresos del mes"
          value={fmtShort(kpi!.revenueThisMonth)}
          sub={kpi!.ordersThisMonth > 0 ? `${kpi!.ordersThisMonth} ${kpi!.ordersThisMonth === 1 ? 'orden' : 'órdenes'}` : 'Sin ventas aún'}
          icon={<DollarSign className="h-4 w-4 text-green-600" />}
          iconBg="bg-green-100 dark:bg-green-900/30"
          trendValue={revTrend}
          trendLabel="vs mes anterior"
        />
        <KpiCard
          title="Órdenes aprobadas"
          value={String(kpi!.ordersThisMonth)}
          sub="este mes"
          icon={<ShoppingCart className="h-4 w-4 text-blue-600" />}
          iconBg="bg-blue-100 dark:bg-blue-900/30"
          trendValue={ordTrend}
          trendLabel="vs mes anterior"
        />
        <KpiCard
          title="Reparaciones activas"
          value={String(kpi!.activeRepairs)}
          sub={kpi!.finishedThisMonth > 0 ? `${kpi!.finishedThisMonth} finalizadas este mes` : 'En curso'}
          icon={<Wrench className="h-4 w-4 text-violet-600" />}
          iconBg="bg-violet-100 dark:bg-violet-900/30"
          trendValue={null}
        />
        <KpiCard
          title="Stock crítico"
          value={String(kpi!.zeroStock + kpi!.criticalStock)}
          sub={`${kpi!.zeroStock} sin stock · ${kpi!.criticalStock} bajos`}
          icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
          iconBg="bg-amber-100 dark:bg-amber-900/30"
          trendValue={null}
        />
      </div>

      {/* ── Charts row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Sales bar chart */}
        <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-5">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Ventas online — últimos 30 días
          </h3>
          {hasAnySales ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={salesByDay} barSize={10}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={v => {
                    const d = new Date(v + 'T12:00:00');
                    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
                  }}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  interval={4}
                />
                <YAxis
                  tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}`}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip content={<SalesTooltip />} cursor={{ fill: 'hsl(var(--muted))', radius: 4 }} />
                <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="orders" fill="hsl(var(--primary) / 0.2)" radius={[4, 4, 0, 0]} hide />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground gap-2">
              <ShoppingCart className="h-10 w-10 opacity-20" />
              <p className="text-sm">Sin ventas en los últimos 30 días</p>
            </div>
          )}
        </div>

        {/* Repairs donut chart */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <Wrench className="h-4 w-4 text-primary" />
            Estado de reparaciones
          </h3>
          {repairStatus.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={repairStatus}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="45%"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={3}
                >
                  {repairStatus.map((entry) => (
                    <Cell
                      key={entry.status}
                      fill={STATUS_COLORS[entry.status] ?? FALLBACK_COLOR}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [value, name]}
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '12px',
                    fontSize: '12px',
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => <span style={{ fontSize: 11, color: 'hsl(var(--foreground))' }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Wrench className="h-10 w-10 opacity-20" />
              <p className="text-sm">Sin reparaciones registradas</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom tables ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Recent repairs */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Últimas reparaciones
          </h3>
          {recentRepairs.length > 0 ? (
            <div className="space-y-2">
              {recentRepairs.map(r => (
                <div
                  key={r.id}
                  className="flex items-center justify-between p-2.5 rounded-xl hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {r.client_name ?? 'Sin nombre'} — {r.device_brand ? `${r.device_brand} ` : ''}{r.device_model}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">{r.tracking_code}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 flex flex-col items-center text-muted-foreground gap-2">
              <Wrench className="h-8 w-8 opacity-20" />
              <p className="text-sm">Sin reparaciones registradas</p>
            </div>
          )}
        </div>

        {/* Stock crítico */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Productos con stock crítico
          </h3>
          {criticalProducts.length > 0 || kpi!.zeroStock > 0 ? (
            <div className="space-y-2">
              {/* Zero stock warning */}
              {kpi!.zeroStock > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm">
                  <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
                  <span className="text-red-700 dark:text-red-400 font-medium">
                    {kpi!.zeroStock} producto{kpi!.zeroStock !== 1 ? 's' : ''} sin stock
                  </span>
                </div>
              )}
              {criticalProducts.map(p => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-2.5 rounded-xl hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                  </div>
                  <StockBadge stock={p.stock} />
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 flex flex-col items-center text-muted-foreground gap-2">
              <CheckCircle2 className="h-8 w-8 opacity-20" />
              <p className="text-sm">Stock en buen estado</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Recent orders ───────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-primary" />
          Últimas órdenes
        </h3>
        {recentOrders.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left pb-2 font-medium">ID</th>
                  <th className="text-left pb-2 font-medium">Cliente</th>
                  <th className="text-left pb-2 font-medium">Total</th>
                  <th className="text-left pb-2 font-medium">Estado</th>
                  <th className="text-left pb-2 font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {recentOrders.map(o => (
                  <tr key={o.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">
                      #{o.id.slice(0, 8)}
                    </td>
                    <td className="py-2.5 pr-3">
                      {o.payer ? `${o.payer.first_name ?? ''} ${o.payer.last_name ?? ''}`.trim() || o.payer.email || '—' : '—'}
                    </td>
                    <td className="py-2.5 pr-3 font-semibold">{fmt(o.total)}</td>
                    <td className="py-2.5 pr-3">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="py-2.5 text-muted-foreground text-xs">
                      {new Date(o.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 flex flex-col items-center text-muted-foreground gap-2">
            <ShoppingCart className="h-8 w-8 opacity-20" />
            <p className="text-sm">Sin órdenes registradas</p>
          </div>
        )}
      </div>

    </div>
  );
};

// ─── Helper components ────────────────────────────────────────────────────────

const StatusBadge = ({ status }: { status: string }) => {
  const color = STATUS_COLORS[status] ?? FALLBACK_COLOR;
  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ml-2"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {status}
    </span>
  );
};

const StockBadge = ({ stock }: { stock: number }) => {
  if (stock === 0) return <span className="text-xs font-bold text-red-600 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full">Sin stock</span>;
  if (stock <= 2)  return <span className="text-xs font-bold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full">{stock} u.</span>;
  return               <span className="text-xs font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">{stock} u.</span>;
};

const ORDER_STATUS: Record<string, { label: string; className: string }> = {
  approved: { label: 'Aprobada',  className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  pending:  { label: 'Pendiente', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  rejected: { label: 'Rechazada', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

const OrderStatusBadge = ({ status }: { status: string }) => {
  const s = ORDER_STATUS[status] ?? { label: status, className: 'bg-muted text-muted-foreground' };
  return <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', s.className)}>{s.label}</span>;
};
