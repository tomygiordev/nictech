import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  DollarSign,
  ShieldCheck,
  ShoppingCart,
  Layers,
  FileText,
  TrendingUp,
  Package,
  Wrench,
  Warehouse,
  Receipt,
  CircleDollarSign,
  Loader2,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { type ErpModuleId } from "@nictech/domain";
import { KpiCard } from "../../components/erp/WorkspaceUi";
import { formatCurrency, formatCurrencyCompact, getInitials } from "../../lib/formatters";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { supabase } from "../../lib/supabase";

export interface DashboardOverviewProps {
  onSelectModule: (moduleId: ErpModuleId) => void;
}

interface RecentRepairItem {
  id: string;
  tracking_code: string;
  client_name: string | null;
  device_brand: string | null;
  device_model: string | null;
  status: string;
  quoted_price: number | null;
  created_at: string;
}

interface LowStockProductItem {
  id: string;
  name: string;
  stock: number | null;
}

interface OrderRecordItem {
  id: string;
  total: number;
  status: string;
  created_at: string;
}

interface StockMovementItem {
  id: string;
  quantity: number;
  unit_price: number | null;
  type: string;
  created_at: string;
}

type PeriodType = "year" | "6m" | "month" | "30d";

interface ChartPoint {
  label: string;
  fullLabel: string;
  revenue: number;
  orders: number;
}

const MONTHS_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MONTHS_FULL = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

function generateCommercialEvolution(
  period: PeriodType,
  orders: OrderRecordItem[],
  repairs: RecentRepairItem[],
  movements: StockMovementItem[]
): ChartPoint[] {
  const now = new Date();

  const getParsedDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  };

  if (period === "year") {
    const currentYear = now.getFullYear();
    const result: ChartPoint[] = [];

    for (let m = 0; m < 12; m++) {
      let revenue = 0;
      let orderCount = 0;

      for (const o of orders) {
        if (o.status === "cancelled") continue;
        const d = getParsedDate(o.created_at);
        if (d && d.getFullYear() === currentYear && d.getMonth() === m) {
          revenue += Number(o.total || 0);
          orderCount += 1;
        }
      }

      for (const mov of movements) {
        const d = getParsedDate(mov.created_at);
        if (d && d.getFullYear() === currentYear && d.getMonth() === m) {
          revenue += Math.abs(mov.quantity || 1) * Number(mov.unit_price || 0);
          orderCount += 1;
        }
      }

      for (const r of repairs) {
        if (r.status !== "Finalizado") continue;
        const d = getParsedDate(r.created_at);
        if (d && d.getFullYear() === currentYear && d.getMonth() === m) {
          revenue += Number(r.quoted_price || 0);
          orderCount += 1;
        }
      }

      result.push({
        label: MONTHS_SHORT[m],
        fullLabel: `${MONTHS_FULL[m]} ${currentYear}`,
        revenue: Math.round(revenue),
        orders: orderCount,
      });
    }
    return result;
  }

  if (period === "6m") {
    const result: ChartPoint[] = [];
    for (let i = 5; i >= 0; i--) {
      const dTarget = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = dTarget.getFullYear();
      const m = dTarget.getMonth();

      let revenue = 0;
      let orderCount = 0;

      for (const o of orders) {
        if (o.status === "cancelled") continue;
        const d = getParsedDate(o.created_at);
        if (d && d.getFullYear() === y && d.getMonth() === m) {
          revenue += Number(o.total || 0);
          orderCount += 1;
        }
      }

      for (const mov of movements) {
        const d = getParsedDate(mov.created_at);
        if (d && d.getFullYear() === y && d.getMonth() === m) {
          revenue += Math.abs(mov.quantity || 1) * Number(mov.unit_price || 0);
          orderCount += 1;
        }
      }

      for (const r of repairs) {
        if (r.status !== "Finalizado") continue;
        const d = getParsedDate(r.created_at);
        if (d && d.getFullYear() === y && d.getMonth() === m) {
          revenue += Number(r.quoted_price || 0);
          orderCount += 1;
        }
      }

      result.push({
        label: MONTHS_SHORT[m],
        fullLabel: `${MONTHS_FULL[m]} ${y}`,
        revenue: Math.round(revenue),
        orders: orderCount,
      });
    }
    return result;
  }

  if (period === "month") {
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const result: ChartPoint[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      let revenue = 0;
      let orderCount = 0;

      for (const o of orders) {
        if (o.status === "cancelled") continue;
        const d = getParsedDate(o.created_at);
        if (d && d.getFullYear() === currentYear && d.getMonth() === currentMonth && d.getDate() === day) {
          revenue += Number(o.total || 0);
          orderCount += 1;
        }
      }

      for (const mov of movements) {
        const d = getParsedDate(mov.created_at);
        if (d && d.getFullYear() === currentYear && d.getMonth() === currentMonth && d.getDate() === day) {
          revenue += Math.abs(mov.quantity || 1) * Number(mov.unit_price || 0);
          orderCount += 1;
        }
      }

      for (const r of repairs) {
        if (r.status !== "Finalizado") continue;
        const d = getParsedDate(r.created_at);
        if (d && d.getFullYear() === currentYear && d.getMonth() === currentMonth && d.getDate() === day) {
          revenue += Number(r.quoted_price || 0);
          orderCount += 1;
        }
      }

      result.push({
        label: `${day}`,
        fullLabel: `${day} de ${MONTHS_FULL[currentMonth]} ${currentYear}`,
        revenue: Math.round(revenue),
        orders: orderCount,
      });
    }
    return result;
  }

  // period === "30d"
  const result: ChartPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const targetDate = new Date(now.getTime() - i * 86400000);
    const y = targetDate.getFullYear();
    const m = targetDate.getMonth();
    const day = targetDate.getDate();

    let revenue = 0;
    let orderCount = 0;

    for (const o of orders) {
      if (o.status === "cancelled") continue;
      const d = getParsedDate(o.created_at);
      if (d && d.getFullYear() === y && d.getMonth() === m && d.getDate() === day) {
        revenue += Number(o.total || 0);
        orderCount += 1;
      }
    }

    for (const mov of movements) {
      const d = getParsedDate(mov.created_at);
      if (d && d.getFullYear() === y && d.getMonth() === m && d.getDate() === day) {
        revenue += Math.abs(mov.quantity || 1) * Number(mov.unit_price || 0);
        orderCount += 1;
      }
    }

    for (const r of repairs) {
      if (r.status !== "Finalizado") continue;
      const d = getParsedDate(r.created_at);
      if (d && d.getFullYear() === y && d.getMonth() === m && d.getDate() === day) {
        revenue += Number(r.quoted_price || 0);
        orderCount += 1;
      }
    }

    result.push({
      label: `${day} ${MONTHS_SHORT[m]}`,
      fullLabel: `${day} de ${MONTHS_FULL[m]} ${y}`,
      revenue: Math.round(revenue),
      orders: orderCount,
    });
  }
  return result;
}

const CustomChartTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint; value: number }>;
  label?: string;
}) => {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid var(--border-line, #E2E8F0)",
        borderRadius: "10px",
        padding: "10px 14px",
        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)",
        fontSize: "12px",
        minWidth: "170px",
      }}
    >
      <div style={{ fontWeight: 700, color: "#0F172A", marginBottom: "6px" }}>{point.fullLabel || label}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#64748B" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#9ec5fe", display: "inline-block" }} />
          <span>Facturación:</span>
        </div>
        <strong style={{ color: "#005BD5" }}>{formatCurrency(point.revenue, "ARS")}</strong>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#64748B" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#005BD5", display: "inline-block" }} />
          <span>Órdenes / Trabajos:</span>
        </div>
        <strong style={{ color: "#0F172A" }}>{point.orders}</strong>
      </div>
    </div>
  );
};

const formatAxisCurrency = (val: number): string => {
  if (val === 0) return "$0";
  if (val >= 1_000_000) {
    const m = val / 1_000_000;
    return `$${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (val >= 1_000) {
    const k = val / 1_000;
    return `$${Number.isInteger(k) ? k : k.toFixed(0)}k`;
  }
  return `$${val}`;
};

const formatAxisOrders = (val: number): string => {
  if (val === 0) return "0";
  return String(Math.round(val));
};

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({ onSelectModule }) => {
  const { session } = useErpAuth();
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>("year");
  const [loading, setLoading] = useState<boolean>(true);
  const [rawOrders, setRawOrders] = useState<OrderRecordItem[]>([]);
  const [rawRepairs, setRawRepairs] = useState<RecentRepairItem[]>([]);
  const [rawMovements, setRawMovements] = useState<StockMovementItem[]>([]);
  const [stats, setStats] = useState({
    productsCount: 0,
    inventoryValueArs: 0,
    repairsCount: 0,
    ordersCount: 0,
    totalRevenueArs: 0,
  });
  const [recentRepairs, setRecentRepairs] = useState<RecentRepairItem[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<LowStockProductItem[]>([]);

  const operatorName = session?.user.user_metadata?.full_name || "Operador NicTech";
  const initials = getInitials(operatorName, "NT");

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);

      // 1. Products
      const { data: prodData } = await supabase
        .from("products")
        .select("id, name, price, stock, is_active");

      const products = prodData || [];
      const prodCount = products.length;
      const invValue = products.reduce((acc, p) => acc + (p.price || 0) * (p.stock || 0), 0);
      const lowStock = products.filter((p) => (p.stock ?? 0) <= 3 && (p.is_active ?? true)).slice(0, 3);

      // 2. Repairs
      const { data: repData } = await supabase
        .from("repairs")
        .select("id, tracking_code, client_name, device_brand, device_model, status, quoted_price, created_at")
        .or("is_deleted.is.null,is_deleted.eq.false")
        .order("created_at", { ascending: false });

      const repairs = (repData || []) as RecentRepairItem[];
      const activeRepairs = repairs.filter((r) => r.status !== "Finalizado");

      // 3. Orders
      const { data: ordData } = await supabase
        .from("orders")
        .select("id, total, status, created_at")
        .order("created_at", { ascending: false });

      const orders = (ordData || []) as OrderRecordItem[];

      // 4. Inventory Movements (sales)
      const { data: movData } = await supabase
        .from("inventory_movements")
        .select("id, quantity, unit_price, type, created_at")
        .eq("type", "sale")
        .order("created_at", { ascending: false });

      const movements = (movData || []) as StockMovementItem[];

      const orderRevenue = orders
        .filter((o) => o.status === "approved" || o.status === "completed")
        .reduce((a, b) => a + Number(b.total || 0), 0);
      const movementRevenue = movements
        .reduce((a, b) => a + Math.abs(b.quantity || 1) * Number(b.unit_price || 0), 0);
      const repairRevenue = repairs
        .filter((r) => r.status === "Finalizado")
        .reduce((a, b) => a + Number(b.quoted_price || 0), 0);

      const totalRevenue = Math.max(orderRevenue + repairRevenue, movementRevenue + repairRevenue, orderRevenue);

      setStats({
        productsCount: prodCount,
        inventoryValueArs: invValue,
        repairsCount: activeRepairs.length,
        ordersCount: orders.length + movements.length,
        totalRevenueArs: totalRevenue,
      });

      setRawOrders(orders);
      setRawRepairs(repairs);
      setRawMovements(movements);
      setRecentRepairs(repairs.slice(0, 5));
      setLowStockProducts(lowStock);
    } catch (e) {
      console.error("Error al cargar dashboard:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const chartData = useMemo(() => {
    return generateCommercialEvolution(selectedPeriod, rawOrders, rawRepairs, rawMovements);
  }, [selectedPeriod, rawOrders, rawRepairs, rawMovements]);

  return (
    <div className="flow-dashboard">
      {/* 4 KPI Metrics Row */}
      <section className="kpi-grid" aria-label="Métricas Principales">
        <KpiCard
          icon={DollarSign}
          iconVariant="green"
          label="Facturación Web & POS"
          value={loading ? "…" : formatCurrencyCompact(stats.totalRevenueArs, "ARS")}
          trend={{ text: "Live", positive: true, icon: TrendingUp }}
          sublabel={`${stats.ordersCount} órdenes procesadas`}
        />

        <KpiCard
          icon={ShoppingCart}
          iconVariant="navy"
          label="Artículos en Catálogo"
          value={loading ? "…" : stats.productsCount}
          trend={{ text: "Activos", positive: true, icon: TrendingUp }}
          sublabel="Sincronizados en tienda"
        />

        <KpiCard
          icon={Layers}
          iconVariant="steel"
          label="Valorización de Stock"
          value={loading ? "…" : formatCurrencyCompact(stats.inventoryValueArs, "ARS")}
          trend={{ text: "ARS", positive: true, icon: TrendingUp }}
          sublabel="Almacén Central & Pañol"
        />

        <KpiCard
          icon={Wrench}
          iconVariant="dark"
          label="Equipos en Taller"
          value={loading ? "…" : stats.repairsCount}
          trend={{ text: "En Proceso", positive: true, icon: TrendingUp }}
          sublabel="Con código de seguimiento"
        />
      </section>

      {/* Main Grid */}
      <div className="flow-dashboard-grid">
        {/* Left Column */}
        <div className="flow-dashboard-main">
          {/* Business Performance Dual-Axis Chart */}
          <section className="flow-card flow-performance-card" aria-label="Rendimiento del Negocio">
            <div className="flow-card__header">
              <div>
                <h3 className="flow-card__title">Evolución Comercial NicTech</h3>
                <p className="flow-card__subtitle">Facturación consolidada y órdenes de trabajo (ARS / USD)</p>
              </div>
              <div className="flow-period-selector-wrapper">
                <select
                  id="dashboard-period-select"
                  aria-label="Seleccionar período"
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value as PeriodType)}
                  className="flow-period-select"
                >
                  <option value="year">Este Año ({new Date().getFullYear()})</option>
                  <option value="6m">Últimos 6 Meses</option>
                  <option value="month">Este Mes</option>
                  <option value="30d">Últimos 30 Días</option>
                </select>
              </div>
            </div>

            <div className="flow-chart-container">
              {loading ? (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", gap: "8px" }}>
                  <Loader2 size={20} className="animate-spin" style={{ color: "var(--brand-primary)" }} />
                  <span style={{ fontSize: "13px" }}>Cargando métricas comerciales…</span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 12, right: 12, left: -4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                    <XAxis
                      dataKey="label"
                      stroke="#64748b"
                      fontSize={11}
                      fontWeight={600}
                      tickLine={false}
                      axisLine={{ stroke: "#E2E8F0" }}
                      dy={6}
                      interval={selectedPeriod === "30d" ? 3 : selectedPeriod === "month" ? 2 : 0}
                    />
                    <YAxis
                      yAxisId="left"
                      orientation="left"
                      stroke="#94a3b8"
                      fontSize={10}
                      fontWeight={600}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={formatAxisCurrency}
                      domain={[0, (dataMax: number) => (dataMax > 0 ? Math.ceil(dataMax * 1.15) : 500000)]}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="#94a3b8"
                      fontSize={10}
                      fontWeight={600}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      tickFormatter={formatAxisOrders}
                      domain={[0, (dataMax: number) => (dataMax > 0 ? Math.max(5, Math.ceil(dataMax * 1.25)) : 10)]}
                    />
                    <Tooltip content={<CustomChartTooltip />} />
                    <Bar
                      yAxisId="left"
                      dataKey="revenue"
                      name="Volumen Facturado"
                      fill="#DCE8F2"
                      radius={[5, 5, 0, 0]}
                      maxBarSize={32}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="orders"
                      name="Órdenes Concretadas"
                      stroke="#005BD5"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: "#005BD5", stroke: "#FFFFFF", strokeWidth: 2 }}
                      activeDot={{ r: 6, fill: "#005BD5", stroke: "#FFFFFF", strokeWidth: 2 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Chart Legend */}
            <div className="flow-chart-legend">
              <div className="legend-item">
                <span className="legend-dot blue" />
                <span>Volumen Facturado</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot green" />
                <span>Órdenes Concretadas</span>
              </div>
            </div>
          </section>

          {/* Recent Repairs Table */}
          <section className="flow-card" aria-label="Órdenes Recientes">
            <div className="flow-card__header">
              <div>
                <h3 className="flow-card__title">Últimas Reparaciones en Taller</h3>
                <p className="flow-card__subtitle">Órdenes de servicio técnico registradas en el laboratorio</p>
              </div>
              <button type="button" className="flow-link-btn" onClick={() => onSelectModule("repairs")}>
                Ver Taller →
              </button>
            </div>

            {loading ? (
              <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
                <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px", color: "var(--brand-primary)" }} />
                <p style={{ margin: 0, fontSize: "13px" }}>Cargando actividad reciente…</p>
              </div>
            ) : recentRepairs.length === 0 ? (
              <p style={{ padding: "16px", color: "var(--text-muted)", fontSize: "13px" }}>No hay reparaciones recientes.</p>
            ) : (
              <div className="flow-table-wrapper">
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>Código Tracking</th>
                      <th>Cliente</th>
                      <th>Dispositivo</th>
                      <th>Estado</th>
                      <th className="text-right">Presupuesto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRepairs.map((r) => (
                      <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => onSelectModule("repairs")}>
                        <td>
                          <div className="order-id-cell">
                            <span className="type-badge green" style={{ fontFamily: "monospace" }}>
                              {r.tracking_code}
                            </span>
                          </div>
                        </td>
                        <td>{r.client_name || "Cliente"}</td>
                        <td>{r.device_brand} {r.device_model}</td>
                        <td>
                          <span className={`flow-status-pill ${r.status === "Finalizado" ? "completed" : "processing"}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="text-right amount-val">
                          {r.quoted_price ? formatCurrency(r.quoted_price, "ARS") : "A presupuestar"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Right Column */}
        <div className="flow-dashboard-sidebar">
          {/* Operator Profile Card */}
          <section className="flow-card operator-card" aria-label="Perfil del Operador">
            <div className="operator-card__header">
              <div className="operator-avatar-wrapper">
                <div className="operator-avatar">
                  <span className="avatar-initials">{initials}</span>
                </div>
                <span className="online-dot" />
              </div>
              <div className="operator-info">
                <strong>{operatorName}</strong>
                <span className="operator-role-tag">Administración & Taller</span>
              </div>
            </div>

            <div className="operator-metrics-grid">
              <div className="operator-stat">
                <span className="stat-label">Sucursal</span>
                <strong className="stat-val">Central</strong>
              </div>
              <div className="operator-stat">
                <span className="stat-label">Rol</span>
                <strong className="stat-val">Admin</strong>
              </div>
              <div className="operator-stat">
                <span className="stat-label">Caja</span>
                <strong className="stat-val">01 Abierta</strong>
              </div>
              <div className="operator-stat">
                <span className="stat-label">Base de Datos</span>
                <strong className="stat-val" style={{ color: "var(--emerald-success)" }}>Conectada</strong>
              </div>
            </div>
          </section>

          {/* Quick Actions Grid */}
          <section className="flow-card" aria-label="Acciones Rápidas">
            <h3 className="flow-card__title">Accesos Directos</h3>
            <div className="quick-actions-grid">
              <button
                type="button"
                className="quick-action-tile"
                onClick={() => onSelectModule("pos")}
              >
                <div className="tile-icon">
                  <Receipt size={20} />
                </div>
                <span>Nueva Venta</span>
              </button>

              <button
                type="button"
                className="quick-action-tile"
                onClick={() => onSelectModule("repairs")}
              >
                <div className="tile-icon">
                  <Wrench size={20} />
                </div>
                <span>Nuevo Ingreso Taller</span>
              </button>

              <button
                type="button"
                className="quick-action-tile"
                onClick={() => onSelectModule("catalog")}
              >
                <div className="tile-icon">
                  <Package size={20} />
                </div>
                <span>Agregar Producto</span>
              </button>

              <button
                type="button"
                className="quick-action-tile"
                onClick={() => onSelectModule("cash")}
              >
                <div className="tile-icon">
                  <CircleDollarSign size={20} />
                </div>
                <span>Control de Caja</span>
              </button>

              <button
                type="button"
                className="quick-action-tile"
                onClick={() => onSelectModule("quotes")}
              >
                <div className="tile-icon">
                  <FileText size={20} />
                </div>
                <span>Presupuestos</span>
              </button>

              <button
                type="button"
                className="quick-action-tile"
                onClick={() => onSelectModule("audit")}
              >
                <div className="tile-icon">
                  <ShieldCheck size={20} />
                </div>
                <span>Auditoría</span>
              </button>
            </div>
          </section>

          {/* Low Stock Alerts */}
          <section className="flow-card" aria-label="Alertas de Stock Bajo">
            <div className="flow-card__header">
              <h3 className="flow-card__title">Stock Crítico en Base de Datos</h3>
              <button type="button" className="flow-link-btn" onClick={() => onSelectModule("stock")}>
                Ver Stock →
              </button>
            </div>

            <div className="low-stock-list">
              {lowStockProducts.length === 0 ? (
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "8px 0" }}>
                  No hay artículos con stock crítico en este momento.
                </p>
              ) : (
                lowStockProducts.map((p) => (
                  <div key={p.id} className="low-stock-item" style={{ cursor: "pointer" }} onClick={() => onSelectModule("catalog")}>
                    <div className="item-thumbnail">
                      <Warehouse size={18} color="var(--text-muted)" />
                    </div>
                    <div className="item-details">
                      <strong>{p.name}</strong>
                      <span>Almacén Central</span>
                    </div>
                    <div className="item-qty-badge">
                      <strong className="qty-val">{p.stock ?? 0}</strong>
                      <span className="qty-unit">Unidades</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};