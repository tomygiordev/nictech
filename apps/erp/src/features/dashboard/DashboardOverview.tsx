import React, { useState, useEffect, useMemo } from "react";
import {
  DollarSign,
  ShieldCheck,
  ShoppingCart,
  Layers,
  FileText,
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
import { z } from "zod";
import { KpiCard, StatePanel } from "../../components/erp/WorkspaceUi";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { addDaysIsoAR, addMonthsIsoAR, AR_TIME_ZONE, todayIsoAR } from "../../lib/dates";
import { toUserMessage } from "../../lib/errors";
import { formatCurrency, getInitials } from "../../lib/formatters";
import { labelOf, REPAIR_STATUS_LABELS } from "../../lib/labels";
import { supabase } from "../../lib/supabase";
import { fetchDashboardMetrics, type DashboardMetrics, type DashboardRange } from "./dashboardApi";

export interface DashboardOverviewProps {
  onSelectModule: (moduleId: ErpModuleId) => void;
}

type PeriodType = "year" | "6m" | "month" | "30d";
type LoadState<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; message: string };

const localCurrency = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const axisCurrency = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  notation: "compact",
  maximumFractionDigits: 1,
});
const shortDay = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: AR_TIME_ZONE });
const fullDay = new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: AR_TIME_ZONE });
const shortMonth = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: AR_TIME_ZONE });
const fullMonth = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: AR_TIME_ZONE });

const asCalendarDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
const currencyValue = (value: number) => (
  <span style={{ overflowWrap: "anywhere" }}>{localCurrency.format(value)}</span>
);

function getDashboardRange(period: PeriodType): DashboardRange {
  const today = todayIsoAR();
  const monthStart = `${today.slice(0, 7)}-01`;
  let start = monthStart;
  if (period === "year") start = `${today.slice(0, 4)}-01-01`;
  if (period === "30d") start = addDaysIsoAR(today, -29);
  if (period === "6m") start = addMonthsIsoAR(monthStart, -5);
  return { date_from: start, date_to: today };
}

type DailyMetrics = DashboardMetrics["series"][number];
type ChartAmounts = Omit<DailyMetrics, "day">;
type ChartPoint = ChartAmounts & { label: string; fullLabel: string };

const channels = [
  { key: "pos_ars", label: "POS", color: "#1e293b" },
  { key: "web_ars", label: "Web", color: "#005bd5" },
  { key: "repairs_ars", label: "Reparaciones", color: "#087657" },
] as const;
const repairLine = { label: "Reparaciones abiertas", color: "#a15416" };

function generateCommercialEvolution(period: PeriodType, series: DashboardMetrics["series"]): ChartPoint[] {
  const byMonth = period === "year" || period === "6m";
  const buckets = new Map<string, ChartAmounts & { first: string; last: string }>();

  for (const row of series) {
    const key = byMonth
      ? row.day.slice(0, 7)
      : addDaysIsoAR(row.day, -((asCalendarDate(row.day).getUTCDay() + 6) % 7));
    const bucket = buckets.get(key);
    if (bucket) {
      for (const { key: channel } of channels) bucket[channel] += row[channel];
      bucket.repairs_opened += row.repairs_opened;
      bucket.last = row.day;
    } else {
      const { day, ...amounts } = row;
      buckets.set(key, { ...amounts, first: day, last: day });
    }
  }

  return Array.from(buckets.values(), ({ first, last, ...amounts }) => {
    const firstDate = asCalendarDate(first);
    return {
      ...amounts,
      label: byMonth ? shortMonth.format(firstDate) : shortDay.format(firstDate),
      fullLabel: byMonth
        ? fullMonth.format(firstDate)
        : first === last
          ? fullDay.format(firstDate)
          : `${shortDay.format(firstDate)} al ${fullDay.format(asCalendarDate(last))}`,
    };
  });
}

function CustomChartTooltip({
  active,
  payload,
  visibleChannels,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  visibleChannels: ReadonlyArray<(typeof channels)[number]>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div style={{ background: "#fff", border: "1px solid var(--border-line)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
      <strong>{point.fullLabel}</strong>
      {visibleChannels.map(({ key, label }) => (
        <div key={key}>{label}: {formatCurrency(point[key])}</div>
      ))}
      <div>{repairLine.label}: {point.repairs_opened}</div>
    </div>
  );
}

const quoteSummary = z.object({
  total_amount: z.number().finite(),
  currency_code: z.string().regex(/^[A-Z]{3}$/),
});

async function fetchRecentRepairs() {
  const { data, error } = await supabase
    .from("repair_orders_overview")
    .select("id, order_code, customer_name, brand_snapshot, model_snapshot, status_code, status_name, status_is_terminal, delivery_id, latest_quote")
    .order("opened_at", { ascending: false })
    .limit(5);
  if (error) throw error;

  return (data ?? []).flatMap((repair) => {
    if (!repair.id || !repair.order_code) return [];
    const quote = quoteSummary.safeParse(repair.latest_quote);
    return [{
      id: repair.id,
      code: repair.order_code,
      customer: repair.customer_name,
      device: [repair.brand_snapshot, repair.model_snapshot].filter(Boolean).join(" "),
      terminal: Boolean(repair.status_is_terminal || repair.delivery_id),
      status: labelOf(
        REPAIR_STATUS_LABELS,
        repair.delivery_id ? "delivered" : repair.status_code,
        labelOf(REPAIR_STATUS_LABELS, repair.status_name, repair.status_name || "Sin estado"),
      ),
      budget: quote.success
        ? formatCurrency(quote.data.total_amount, quote.data.currency_code)
        : repair.latest_quote === null ? "Sin presupuesto" : "No disponible",
    }];
  });
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({ onSelectModule }) => {
  const { session, branchIds, permissions } = useErpAuth();
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>("year");
  const [dashboard, setDashboard] = useState<LoadState<DashboardMetrics>>({ status: "loading" });
  const [refresh, setRefresh] = useState(0);
  const [recent, setRecent] = useState<LoadState<Awaited<ReturnType<typeof fetchRecentRepairs>>>>({ status: "loading" });

  const operatorName = session?.user.user_metadata?.full_name || "Operador NicTech";
  const initials = getInitials(operatorName, "NT");
  const branchScopeLabel = branchIds.length === 0
    ? "Sin asignar"
    : branchIds.length === 1
      ? "1 asignada"
      : `${branchIds.length} asignadas`;

  useEffect(() => {
    let ignore = false;
    async function fetchDashboardData() {
      try {
        const range = getDashboardRange(selectedPeriod);
        let data: DashboardMetrics;
        try {
          data = await fetchDashboardMetrics(range);
        } catch (error) {
          const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
          if (code !== "42501" || branchIds.length !== 1) throw error;
          data = await fetchDashboardMetrics(range, branchIds[0]);
        }
        if (!ignore) setDashboard({ status: "success", data });
      } catch (error) {
        if (!ignore) {
          const message = toUserMessage(error, "No se pudieron consultar los datos del Centro operativo.");
          setDashboard({ status: "error", message });
        }
      }
    }
    void fetchDashboardData();
    return () => { ignore = true; };
  }, [selectedPeriod, refresh, branchIds]);

  useEffect(() => {
    let ignore = false;
    async function loadRecentRepairs() {
      try {
        const data = await fetchRecentRepairs();
        if (!ignore) setRecent({ status: "success", data });
      } catch (error) {
        if (!ignore) {
          const message = toUserMessage(error, "No se pudieron consultar las reparaciones recientes.");
          setRecent({ status: "error", message });
        }
      }
    }
    void loadRecentRepairs();
    return () => { ignore = true; };
  }, []);

  const metrics = dashboard.status === "success" ? dashboard.data : null;
  const loading = dashboard.status === "loading";
  const loadError = dashboard.status === "error" ? dashboard.message : null;
  const pendingValue = loading ? "…" : "No disponible";
  const visibleChannels = metrics && !metrics.can_view_sales ? [] : channels;
  const chartData = useMemo(
    () => metrics ? generateCommercialEvolution(selectedPeriod, metrics.series) : [],
    [selectedPeriod, metrics],
  );
  const hasChartActivity = chartData.some((point) =>
    point.repairs_opened > 0 || visibleChannels.some(({ key }) => point[key] !== 0),
  );

  return (
    <div className="flow-dashboard">
      <section className="kpi-grid" aria-label="Métricas principales" aria-busy={loading}>
        <KpiCard
          icon={DollarSign}
          iconVariant="green"
          label="Ventas del período"
          value={
            !metrics
              ? pendingValue
              : !metrics.can_view_sales
                ? "Sin permiso"
                : currencyValue(metrics.sales.total_ars)
          }
          sublabel={
            !metrics
              ? undefined
              : !metrics.can_view_sales
                ? "Requiere permiso para ver ventas"
                : channels.map(({ key, label }) => `${label} ${localCurrency.format(metrics.sales[key])}`).join(" · ")
          }
        />

        <KpiCard
          icon={ShoppingCart}
          iconVariant="navy"
          label="Productos activos"
          value={metrics?.products_active_count ?? pendingValue}
          sublabel="Catálogo interno"
        />

        <KpiCard
          icon={Layers}
          iconVariant="steel"
          label="Stock vendible a precio de venta"
          value={metrics ? currencyValue(metrics.inventory.value_at_sale_price_ars) : pendingValue}
          sublabel="Ubicaciones habilitadas para venta"
        />

        <KpiCard
          icon={Wrench}
          iconVariant="dark"
          label="Equipos en taller"
          value={metrics?.active_repairs_count ?? pendingValue}
          sublabel="Órdenes no finalizadas"
        />
      </section>

      {loadError && (
        <StatePanel
          type="error"
          title="No se pudo actualizar el resumen"
          message={loadError}
          action={(
            <button type="button" className="btn-secondary" onClick={() => {
              setDashboard({ status: "loading" });
              setRefresh((value) => value + 1);
            }}>
              Reintentar consulta
            </button>
          )}
        />
      )}

      {/* Main Grid */}
      <div className="flow-dashboard-grid">
        {/* Left Column */}
        <div className="flow-dashboard-main">
          <section className="flow-card flow-performance-card" aria-labelledby="dashboard-chart-title">
            <div className="flow-card__header">
              <div>
                <h3 className="flow-card__title" id="dashboard-chart-title">Ventas por canal</h3>
                <p className="flow-card__subtitle">Importes en pesos e ingresos al taller</p>
              </div>
              <div className="flow-period-selector-wrapper">
                <select
                  id="dashboard-period-select"
                  aria-label="Seleccionar período"
                  value={selectedPeriod}
                  onChange={(event) => {
                    const period = event.target.value;
                    if (period !== "year" && period !== "6m" && period !== "month" && period !== "30d") return;
                    if (period === selectedPeriod) return;
                    setDashboard({ status: "loading" });
                    setSelectedPeriod(period);
                  }}
                  className="flow-period-select"
                >
                  <option value="year">Este año ({todayIsoAR().slice(0, 4)})</option>
                  <option value="6m">Últimos 6 meses</option>
                  <option value="month">Este mes</option>
                  <option value="30d">Últimos 30 días</option>
                </select>
              </div>
            </div>

            <div className="flow-chart-container">
              {loading ? (
                <div role="status" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", gap: "8px" }}>
                  <Loader2 size={20} className="animate-spin" style={{ color: "var(--brand-primary)" }} />
                  <span style={{ fontSize: "13px" }}>Cargando métricas comerciales…</span>
                </div>
              ) : loadError ? (
                <p>El gráfico no está disponible.</p>
              ) : !hasChartActivity ? (
                <StatePanel type="empty" message="No hubo ventas ni ingresos al taller en este período." />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 12, right: 12, left: -4, bottom: 4 }}
                    accessibilityLayer
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
                      minTickGap={12}
                    />
                    {visibleChannels.length > 0 && (
                      <YAxis
                        yAxisId="left"
                        orientation="left"
                        stroke="#94a3b8"
                        fontSize={10}
                        fontWeight={600}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={axisCurrency.format}
                      />
                    )}
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="#94a3b8"
                      fontSize={10}
                      fontWeight={600}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<CustomChartTooltip visibleChannels={visibleChannels} />} />
                    {visibleChannels.map(({ key, label, color }) => (
                      <Bar key={key} yAxisId="left" dataKey={key} name={label} fill={color} maxBarSize={24} isAnimationActive={false} />
                    ))}
                    <Line
                      yAxisId="right"
                      dataKey="repairs_opened"
                      name={repairLine.label}
                      stroke={repairLine.color}
                      strokeDasharray="5 3"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            {hasChartActivity && (
              <div className="flow-chart-legend" style={{ flexWrap: "wrap", gap: "8px 16px" }}>
                {visibleChannels.map(({ key, label, color }) => (
                  <div className="legend-item" key={key}>
                    <span aria-hidden="true" className="legend-dot" style={{ background: color }} />
                    <span>{label}</span>
                  </div>
                ))}
                <div className="legend-item">
                  <span aria-hidden="true" style={{ width: 14, borderTop: `2px dashed ${repairLine.color}` }} />
                  <span>{repairLine.label}</span>
                </div>
              </div>
            )}
          </section>

          <section className="flow-card" aria-labelledby="dashboard-repairs-title">
            <div className="flow-card__header">
              <div>
                <h3 className="flow-card__title" id="dashboard-repairs-title">Reparaciones recientes</h3>
              </div>
              <button type="button" className="flow-link-btn" onClick={() => onSelectModule("repairs")}>
                Ver Taller →
              </button>
            </div>

            {recent.status === "loading" ? (
              <div role="status" style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
                <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px", color: "var(--brand-primary)" }} />
                <p style={{ margin: 0, fontSize: "13px" }}>Cargando actividad reciente…</p>
              </div>
            ) : recent.status === "error" ? (
              <StatePanel type="error" message={recent.message} />
            ) : recent.data.length === 0 ? (
              <p style={{ padding: "16px", color: "var(--text-muted)", fontSize: "13px" }}>No hay reparaciones recientes.</p>
            ) : (
              <div className="flow-table-wrapper">
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>Código de orden</th>
                      <th>Cliente</th>
                      <th>Dispositivo</th>
                      <th>Estado</th>
                      <th className="text-right">Presupuesto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.data.map((r) => (
                      <tr
                        key={r.id}
                        className="interactive-row"
                        role="button"
                        tabIndex={0}
                        aria-label={`Abrir reparación ${r.code}`}
                        onClick={() => onSelectModule("repairs")}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelectModule("repairs");
                          }
                        }}
                      >
                        <td>
                          <div className="order-id-cell">
                            <span className="type-badge green" style={{ fontFamily: "monospace" }}>
                              {r.code}
                            </span>
                          </div>
                        </td>
                        <td>{r.customer || "Sin cliente informado"}</td>
                        <td>{r.device || "Sin equipo informado"}</td>
                        <td>
                          <span className={`flow-status-pill ${r.terminal ? "completed" : "processing"}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="text-right amount-val">{r.budget}</td>
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
                <span className="operator-role-tag">
                  {permissions.length > 0 ? `${permissions.length} permisos habilitados` : "Sin permisos habilitados"}
                </span>
              </div>
            </div>

            <div className="operator-metrics-grid">
              <div className="operator-stat">
                <span className="stat-label">Sucursal</span>
                <strong className="stat-val">{branchScopeLabel}</strong>
              </div>
              <div className="operator-stat">
                <span className="stat-label">Acceso</span>
                <strong className="stat-val">{permissions.length > 0 ? "Autorizado" : "Sin permisos"}</strong>
              </div>
              <div className="operator-stat">
                <span className="stat-label">Caja</span>
                <strong className="stat-val">Ver módulo Caja</strong>
              </div>
              <div className="operator-stat">
                <span className="stat-label">Datos del tablero</span>
                <strong className="stat-val" style={{ color: loadError ? "var(--rose-accent)" : undefined }}>
                  {loading ? "Consultando" : loadError ? "No disponibles" : "Actualizados"}
                </strong>
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

          <section className="flow-card" aria-labelledby="dashboard-stock-title">
            <div className="flow-card__header">
              <h3 className="flow-card__title" id="dashboard-stock-title">Stock bajo</h3>
              <button type="button" className="flow-link-btn" onClick={() => onSelectModule("stock")}>
                Ver Stock →
              </button>
            </div>

            <div className="low-stock-list">
              {loading ? (
                <p role="status" style={{ fontSize: "12px", color: "var(--text-muted)", margin: "8px 0" }}>
                  Consultando existencias…
                </p>
              ) : loadError ? (
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "8px 0" }}>
                  No se pudo consultar el stock bajo.
                </p>
              ) : !metrics?.low_stock.length ? (
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "8px 0" }}>
                  No hay artículos con stock bajo.
                </p>
              ) : (
                metrics.low_stock.map((p) => (
                  <button
                    key={p.product_id}
                    type="button"
                    className="low-stock-item low-stock-item--button"
                    onClick={() => onSelectModule("stock")}
                    aria-label={`Abrir stock para revisar ${p.name}`}
                  >
                    <div className="item-thumbnail">
                      <Warehouse size={18} color="var(--text-muted)" />
                    </div>
                    <div className="item-details">
                      <strong>{p.name}</strong>
                      <span>Disponible para venta</span>
                    </div>
                    <div className="item-qty-badge">
                      <strong className="qty-val">{p.available}</strong>
                      <span className="qty-unit">Unidades</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
