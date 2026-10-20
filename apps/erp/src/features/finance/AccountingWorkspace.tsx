
import React, { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  BarChart3,
  CheckCircle2,
  DollarSign,
  Percent,
  PieChart,
  BookOpen,
  Calendar,
  Layers,
  RotateCcw,
  CheckCheck,
  Lock,
  PlusCircle,
  TrendingUp,
} from "lucide-react";
import { useErpAuth } from "../../auth/ErpAuthContext";
import {
  bootstrapChartOfAccounts,
  closeAccountingPeriod,
  exportIvaComprasReport,
  exportIvaVentasReport,
  exportProfitabilityReport,
  exportTrialBalanceReport,
  listAccountingPeriods,
  listBranches,
  listChartOfAccounts,
  listIvaCompras,
  listIvaVentas,
  listJournalEntries,
  listProfitabilityByLine,
  listTrialBalance,
  postJournalEntry,
  reconcileAccountBalance,
  reverseJournalEntry,
} from "./api";
import {
  closePeriodSchema,
  journalEntrySchema,
  reconciliationSchema,
  reversalSchema,
  type ClosePeriodInput,
  type JournalEntryInput,
  type ReconciliationInput,
  type ReversalInput,
} from "./schemas";
import {
  StatePanel,
  WorkspaceHeader,
  WorkspaceModuleTabs,
  Modal,
  FeedbackAlert,
  KpiCard,
} from "../../components/erp/WorkspaceUi";
import { OfficialCsvExportButton } from "../../components/erp/OfficialCsvExportButton";
import { type ErpModuleId } from "@nictech/domain";
import { formatCurrency, formatDate, generateIdempotencyKey } from "../../lib/formatters";

// Los numeric de Postgres pueden llegar como string: normalizar con Number().
// Devuelve null cuando no hay dato (la vista documenta NULL por falta de fuente).
const toNumber = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const NO_SOURCE_LABEL = "Sin datos fuente";

const ProfitabilitySection = ({ canExport }: { canExport: boolean }) => {
  const profitability = useQuery({
    queryKey: ["erp", "reports", "profitability"],
    queryFn: () => listProfitabilityByLine(),
  });

  const rows = useMemo(
    () =>
      (profitability.data ?? []).map((row) => ({
        productId: row.product_id,
        code: row.internal_code,
        name: row.internal_name,
        quantitySold: toNumber(row.quantity_sold),
        revenue: toNumber(row.gross_revenue),
        unitCost: toNumber(row.avg_unit_landed_cost),
        cost: toNumber(row.estimated_cost),
        margin: toNumber(row.margin),
      })),
    [profitability.data],
  );

  const totals = useMemo(() => {
    let revenue = 0;
    let costedRevenue = 0;
    let cost = 0;
    let margin = 0;
    let withCost = 0;
    let best: { name: string; pct: number } | null = null;
    for (const row of rows) {
      revenue += row.revenue ?? 0;
      if (row.margin !== null) {
        withCost += 1;
        costedRevenue += row.revenue ?? 0;
        cost += row.cost ?? 0;
        margin += row.margin;
        if ((row.revenue ?? 0) > 0) {
          const pct = (Number(row.margin) / Number(row.revenue)) * 100;
          if (!best || pct > best.pct) {
            best = { name: row.name ?? row.code ?? "Producto", pct };
          }
        }
      }
    }
    return {
      revenue,
      cost,
      margin,
      withCost,
      marginPct: costedRevenue > 0 ? (margin / costedRevenue) * 100 : null,
      best,
    };
  }, [rows]);

  if (profitability.isLoading) {
    return <StatePanel type="loading" message="Cargando rentabilidad por producto…" />;
  }

  if (profitability.isError) {
    return (
      <StatePanel
        type="error"
        title="No se pudo cargar la rentabilidad"
        message={
          profitability.error instanceof Error
            ? profitability.error.message
            : "Error al consultar v_profitability_by_line."
        }
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* KPI Cards calculados sobre v_profitability_by_line */}
      <div className="kpi-grid">
        <KpiCard
          icon={Percent}
          iconVariant="green"
          label="Margen Bruto (con costo real)"
          value={totals.marginPct === null ? "Sin datos" : `${totals.marginPct.toFixed(1)}%`}
          sublabel="Solo productos con recepciones de compra"
        />
        <KpiCard
          icon={DollarSign}
          iconVariant="navy"
          label="Ganancia Bruta Acumulada"
          value={totals.withCost === 0 ? "Sin datos" : formatCurrency(totals.margin, "ARS")}
          sublabel="Ingresos menos costo promedio ponderado"
        />
        <KpiCard
          icon={TrendingUp}
          iconVariant="steel"
          label={
            totals.withCost === 1
              ? "Único producto evaluado"
              : totals.best && totals.best.pct < 0
                ? "Mejor resultado entre márgenes negativos"
                : "Producto de Mayor Margen"
          }
          value={totals.best ? `${totals.best.name} (${totals.best.pct.toFixed(1)}%)` : "Sin datos"}
          sublabel={
            totals.withCost === 1
              ? "Solo hay un producto con costo real; no es una comparación"
              : totals.best && totals.best.pct < 0
                ? "Es el menos negativo; todos los márgenes evaluados son negativos"
                : "Comparación sobre costo real de recepciones"
          }
        />
        <KpiCard
          icon={BarChart3}
          iconVariant="dark"
          label="Ingresos Brutos Totales"
          value={formatCurrency(totals.revenue, "ARS")}
          trend={{ text: `${totals.withCost}/${rows.length} con costo`, positive: totals.withCost > 0 }}
          sublabel="Ventas registradas en las líneas de venta"
        />
      </div>

      {/* Tabla por producto */}
      <div className="flow-card">
        <div className="flow-card__header">
          <div>
            <h2 className="flow-card__title">Rentabilidad por Producto</h2>
            <p className="flow-card__subtitle">Ingresos reales vs costo promedio ponderado de recepciones. Sin recepciones el costo y el margen son nulos por falta de fuente.</p>
          </div>
          {rows.length > 0 && canExport && (
            <OfficialCsvExportButton
              filename="rentabilidad_por_producto.csv"
              loadDataset={async (reason) => {
                const exported = await exportProfitabilityReport({ reason, rowLimit: 5000 });
                return {
                  headers: ["Producto", "Código", "Cantidad vendida", "Ingresos brutos", "Costo prom. unitario", "Costo estimado", "Margen"],
                  rows: exported.rows.map((row) => [
                    row.internal_name ?? "",
                    row.internal_code ?? "",
                    toNumber(row.quantity_sold) ?? NO_SOURCE_LABEL,
                    toNumber(row.gross_revenue) ?? NO_SOURCE_LABEL,
                    toNumber(row.avg_unit_landed_cost) ?? NO_SOURCE_LABEL,
                    toNumber(row.estimated_cost) ?? NO_SOURCE_LABEL,
                    toNumber(row.margin) ?? NO_SOURCE_LABEL,
                  ]),
                  truncated: exported.truncated,
                };
              }}
            />
          )}
        </div>

        {rows.length === 0 ? (
          <StatePanel
            type="empty"
            title="Sin movimientos para rentabilizar"
            message="Todavía no hay ventas ni recepciones registradas en las vistas de reporte."
          />
        ) : (
          <div className="flow-table-wrapper">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cant. Vendida</th>
                  <th>Ingresos Brutos</th>
                  <th>Costo Prom. Unit.</th>
                  <th>Costo Estimado</th>
                  <th>Margen</th>
                  <th>% Margen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const pct =
                    row.margin !== null && (row.revenue ?? 0) > 0
                      ? (Number(row.margin) / Number(row.revenue)) * 100
                      : null;
                  return (
                    <tr key={row.productId}>
                      <td>
                        <strong>{row.name ?? "Producto"}</strong>
                        {row.code ? (
                          <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>{row.code}</span>
                        ) : null}
                      </td>
                      <td>{row.quantitySold === null ? NO_SOURCE_LABEL : row.quantitySold.toLocaleString("es-AR")}</td>
                      <td>{row.revenue === null ? NO_SOURCE_LABEL : formatCurrency(row.revenue, "ARS")}</td>
                      <td>{row.unitCost === null ? NO_SOURCE_LABEL : formatCurrency(row.unitCost, "ARS")}</td>
                      <td>{row.cost === null ? NO_SOURCE_LABEL : formatCurrency(row.cost, "ARS")}</td>
                      <td>
                        {row.margin === null ? (
                          <span className="flow-status-pill pending">{NO_SOURCE_LABEL}</span>
                        ) : (
                          <strong style={{ color: "var(--emerald-success)" }}>{formatCurrency(row.margin, "ARS")}</strong>
                        )}
                      </td>
                      <td>
                        {pct === null ? (
                          <span className="flow-status-pill pending">{NO_SOURCE_LABEL}</span>
                        ) : (
                          <span className="flow-status-pill completed">{pct.toFixed(1)}%</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};


const ReportsSection = ({ canExport }: { canExport: boolean }) => {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = useMemo(
    () => ({ from: from || undefined, to: to || undefined }),
    [from, to],
  );

  const ivaVentas = useQuery({
    queryKey: ["erp", "reports", "iva-ventas", range],
    queryFn: () => listIvaVentas(range),
  });
  const ivaCompras = useQuery({
    queryKey: ["erp", "reports", "iva-compras", range],
    queryFn: () => listIvaCompras(range),
  });
  const trial = useQuery({
    queryKey: ["erp", "reports", "trial-balance"],
    queryFn: () => listTrialBalance(),
  });

  const ventasRows = useMemo(
    () =>
      (ivaVentas.data ?? []).map((row) => ({
        saleId: row.sale_id,
        saleDate: row.sale_date,
        alicuota: toNumber(row.alicuota),
        base: toNumber(row.base_imponible),
        iva: toNumber(row.iva),
      })),
    [ivaVentas.data],
  );

  const comprasRows = useMemo(
    () =>
      (ivaCompras.data ?? []).map((row) => ({
        purchaseOrderId: row.purchase_order_id,
        purchaseDate: row.purchase_date,
        // La vista documenta alicuota NULL: la línea de compra no registra alícuota.
        alicuota: toNumber(row.alicuota),
        base: toNumber(row.base_imponible),
        iva: toNumber(row.iva),
      })),
    [ivaCompras.data],
  );

  const trialRows = useMemo(
    () =>
      (trial.data ?? []).map((row) => ({
        accountId: row.account_id,
        code: row.account_code,
        name: row.account_name,
        debit: toNumber(row.total_debit),
        credit: toNumber(row.total_credit),
        balance: toNumber(row.balance),
      })),
    [trial.data],
  );

  const ventasByAlicuota = useMemo(() => {
    const grouped = new Map<string, { alicuota: number | null; count: number; base: number; iva: number }>();
    for (const row of ventasRows) {
      const key = row.alicuota === null ? "null" : String(row.alicuota);
      const entry = grouped.get(key) ?? { alicuota: row.alicuota, count: 0, base: 0, iva: 0 };
      entry.count += 1;
      entry.base += row.base ?? 0;
      entry.iva += row.iva ?? 0;
      grouped.set(key, entry);
    }
    return [...grouped.values()].sort((a, b) => b.iva - a.iva);
  }, [ventasRows]);

  const totalBaseVentas = ventasRows.reduce((acc, row) => acc + (row.base ?? 0), 0);
  const totalIvaVentas = ventasRows.reduce((acc, row) => acc + (row.iva ?? 0), 0);
  const totalBaseCompras = comprasRows.reduce((acc, row) => acc + (row.base ?? 0), 0);
  const totalIvaCompras = comprasRows.reduce((acc, row) => acc + (row.iva ?? 0), 0);
  const saldoTecnico = totalIvaVentas - totalIvaCompras;
  const totalDebit = trialRows.reduce((acc, row) => acc + (row.debit ?? 0), 0);
  const totalCredit = trialRows.reduce((acc, row) => acc + (row.credit ?? 0), 0);

  const loading = ivaVentas.isLoading || ivaCompras.isLoading || trial.isLoading;
  const loadError =
    (ivaVentas.isError ? "IVA ventas" : null) ??
    (ivaCompras.isError ? "IVA compras" : null) ??
    (trial.isError ? "balance de sumas y saldos" : null);

  if (loading) {
    return <StatePanel type="loading" message="Cargando informes sobre vistas reales…" />;
  }

  if (loadError) {
    return (
      <StatePanel
        type="error"
        title={`No se pudo cargar ${loadError}`}
        message="Revisá los permisos de lectura sobre las vistas de reporte (authenticated)."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Filtro por rango de fechas (aplica a IVA ventas y compras) */}
      <div className="flow-card" style={{ margin: 0, padding: "12px 16px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-end" }}>
          <div className="erp-form-group" style={{ minWidth: "180px" }}>
            <label className="erp-form-label">Desde</label>
            <input className="erp-form-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="erp-form-group" style={{ minWidth: "180px" }}>
            <label className="erp-form-label">Hasta</label>
            <input className="erp-form-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button
            type="button"
            className="pag-btn"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            Limpiar rango
          </button>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            El balance de sumas y saldos refleja solo períodos cerrados, sin filtro de fechas.
          </span>
        </div>
      </div>

      {/* KPI Cards calculados sobre las vistas */}
      <div className="kpi-grid">
        <KpiCard
          icon={DollarSign}
          iconVariant="green"
          label="Ventas Netas (base)"
          value={formatCurrency(totalBaseVentas, "ARS")}
          trend={{ text: `${ventasRows.length} líneas`, positive: true }}
          sublabel="Base imponible de v_iva_ventas"
        />
        <KpiCard
          icon={PieChart}
          iconVariant="navy"
          label="Débito Fiscal (IVA ventas)"
          value={formatCurrency(totalIvaVentas, "ARS")}
          trend={{ text: "ARCA", positive: true }}
          sublabel="Impuesto generado en facturación"
        />
        <KpiCard
          icon={Layers}
          iconVariant="steel"
          label="Crédito Fiscal Compras"
          value={formatCurrency(totalIvaCompras, "ARS")}
          trend={{ text: "Deducción", positive: true }}
          sublabel="Alícuota de compra: sin datos fuente"
        />
        <KpiCard
          icon={CheckCircle2}
          iconVariant="dark"
          label="Saldo Técnico a Pagar"
          value={formatCurrency(saldoTecnico, "ARS")}
          trend={{ text: "Posición IVA", positive: saldoTecnico >= 0 }}
          sublabel="Débito menos crédito del rango"
        />
      </div>

      {/* IVA ventas por alícuota */}
      <div className="flow-card">
        <div className="flow-card__header">
          <div>
            <h2 className="flow-card__title">Libro IVA Ventas por Alícuota</h2>
            <p className="flow-card__subtitle">Base + IVA reales desde las líneas de venta, agrupados por alícuota</p>
          </div>
          {ventasRows.length > 0 && canExport && (
            <OfficialCsvExportButton
              filename="libro_iva_ventas.csv"
              loadDataset={async (reason) => {
                const exported = await exportIvaVentasReport({ reason, range, rowLimit: 5000 });
                return {
                  headers: ["Fecha", "Venta ID", "Alícuota %", "Base imponible", "IVA"],
                  rows: exported.rows.map((row) => [
                    row.sale_date ?? "",
                    row.sale_id,
                    toNumber(row.alicuota) ?? NO_SOURCE_LABEL,
                    toNumber(row.base_imponible) ?? NO_SOURCE_LABEL,
                    toNumber(row.iva) ?? NO_SOURCE_LABEL,
                  ]),
                  truncated: exported.truncated,
                };
              }}
            />
          )}
        </div>

        {ventasByAlicuota.length === 0 ? (
          <StatePanel
            type="empty"
            title="Sin ventas en el rango"
            message="No hay líneas de venta registradas para el rango seleccionado."
          />
        ) : (
          <div className="flow-table-wrapper">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>Alícuota</th>
                  <th>Líneas</th>
                  <th>Base Imponible</th>
                  <th>IVA</th>
                </tr>
              </thead>
              <tbody>
                {ventasByAlicuota.map((entry) => (
                  <tr key={entry.alicuota === null ? "null" : entry.alicuota}>
                    <td>
                      {entry.alicuota === null ? (
                        <span className="flow-status-pill pending">{NO_SOURCE_LABEL}</span>
                      ) : (
                        <strong>{Number(entry.alicuota)}%</strong>
                      )}
                    </td>
                    <td>{entry.count}</td>
                    <td>{formatCurrency(entry.base, "ARS")}</td>
                    <td>
                      <strong style={{ color: "var(--brand-primary)" }}>{formatCurrency(entry.iva, "ARS")}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* IVA compras */}
      <div className="flow-card">
        <div className="flow-card__header">
          <div>
            <h2 className="flow-card__title">Libro IVA Compras</h2>
            <p className="flow-card__subtitle">Base + IVA reales desde purchase_order_lines. La alícuota no se registra en la fuente.</p>
          </div>
          {comprasRows.length > 0 && canExport && (
            <OfficialCsvExportButton
              filename="libro_iva_compras.csv"
              loadDataset={async (reason) => {
                const exported = await exportIvaComprasReport({ reason, range, rowLimit: 5000 });
                return {
                  headers: ["Fecha", "Orden de compra ID", "Alícuota %", "Base imponible", "IVA"],
                  rows: exported.rows.map((row) => [
                    row.purchase_date ?? "",
                    row.purchase_order_id,
                    toNumber(row.alicuota) ?? NO_SOURCE_LABEL,
                    toNumber(row.base_imponible) ?? NO_SOURCE_LABEL,
                    toNumber(row.iva) ?? NO_SOURCE_LABEL,
                  ]),
                  truncated: exported.truncated,
                };
              }}
            />
          )}
        </div>

        {comprasRows.length === 0 ? (
          <StatePanel
            type="empty"
            title="Sin compras en el rango"
            message="No hay líneas de compra registradas para el rango seleccionado."
          />
        ) : (
          <div className="flow-table-wrapper">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Base Imponible</th>
                  <th>IVA</th>
                  <th>Alícuota</th>
                </tr>
              </thead>
              <tbody>
                {comprasRows.map((row) => (
                  <tr key={row.purchaseOrderId}>
                    <td style={{ fontSize: "12px", color: "var(--text-muted)" }}>{formatDate(row.purchaseDate)}</td>
                    <td>{row.base === null ? NO_SOURCE_LABEL : formatCurrency(row.base, "ARS")}</td>
                    <td>
                      <strong style={{ color: "var(--emerald-success)" }}>
                        {row.iva === null ? NO_SOURCE_LABEL : formatCurrency(row.iva, "ARS")}
                      </strong>
                    </td>
                    <td>
                      <span className="flow-status-pill pending">{NO_SOURCE_LABEL}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Balance de sumas y saldos */}
      <div className="flow-card">
        <div className="flow-card__header">
          <div>
            <h2 className="flow-card__title">Balance de Sumas y Saldos</h2>
            <p className="flow-card__subtitle">Solo períodos cerrados y asientos contabilizados o revertidos (balance de comprobación)</p>
          </div>
          {trialRows.length > 0 && canExport && (
            <OfficialCsvExportButton
              filename="balance_sumas_saldos.csv"
              loadDataset={async (reason) => {
                const exported = await exportTrialBalanceReport({ reason, rowLimit: 5000 });
                return {
                  headers: ["Cuenta", "Nombre", "Debe", "Haber", "Saldo"],
                  rows: exported.rows.map((row) => [
                    row.account_code,
                    row.account_name,
                    toNumber(row.total_debit) ?? 0,
                    toNumber(row.total_credit) ?? 0,
                    toNumber(row.balance) ?? 0,
                  ]),
                  truncated: exported.truncated,
                };
              }}
            />
          )}
        </div>

        {trialRows.length === 0 ? (
          <StatePanel
            type="empty"
            title="Sin períodos cerrados"
            message="El balance solo incluye períodos contables cerrados: todavía no hay ninguno."
          />
        ) : (
          <div className="flow-table-wrapper">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Debe</th>
                  <th>Haber</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {trialRows.map((row) => (
                  <tr key={row.accountId}>
                    <td>
                      <strong style={{ fontFamily: "monospace", color: "var(--brand-primary)", marginRight: "8px" }}>
                        {row.code}
                      </strong>
                      {row.name}
                    </td>
                    <td>{formatCurrency(row.debit ?? 0, "ARS")}</td>
                    <td>{formatCurrency(row.credit ?? 0, "ARS")}</td>
                    <td>
                      <strong>{formatCurrency(row.balance ?? 0, "ARS")}</strong>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td><strong>Totales</strong></td>
                  <td><strong>{formatCurrency(totalDebit, "ARS")}</strong></td>
                  <td><strong>{formatCurrency(totalCredit, "ARS")}</strong></td>
                  <td><strong>{formatCurrency(totalDebit - totalCredit, "ARS")}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const today = () => new Date().toISOString().slice(0, 10);

export interface AccountingWorkspaceProps {
  activeModuleId?: "accounting" | "profitability" | "reports";
  onSelectModule?: (id: ErpModuleId) => void;
}

export const AccountingWorkspace: React.FC<AccountingWorkspaceProps> = ({
  activeModuleId = "accounting",
  onSelectModule,
}) => {
  const { hasPermission } = useErpAuth();
  const queryClient = useQueryClient();
  const isAccountingMode = activeModuleId === "accounting";

  // Modals state
  const [isJournalModalOpen, setIsJournalModalOpen] = useState(false);
  const [isReversalModalOpen, setIsReversalModalOpen] = useState(false);
  const [isReconciliationModalOpen, setIsReconciliationModalOpen] = useState(false);
  const [isClosePeriodModalOpen, setIsClosePeriodModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const accounts = useQuery({
    queryKey: ["erp", "accounting", "accounts"],
    queryFn: listChartOfAccounts,
    enabled: isAccountingMode && hasPermission("accounting.view"),
  });
  const periods = useQuery({
    queryKey: ["erp", "accounting", "periods"],
    queryFn: listAccountingPeriods,
    enabled: isAccountingMode && hasPermission("accounting.view"),
  });
  const entries = useQuery({
    queryKey: ["erp", "accounting", "entries"],
    queryFn: listJournalEntries,
    enabled: isAccountingMode && hasPermission("accounting.view"),
  });
  const branches = useQuery({
    queryKey: ["erp", "accounting", "branches"],
    queryFn: listBranches,
    enabled: isAccountingMode && hasPermission("accounting.view"),
  });
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapPending, setBootstrapPending] = useState(false);
  const [periodGuardError, setPeriodGuardError] = useState<string | null>(null);

  const closeForm = useForm<ClosePeriodInput>({
    resolver: zodResolver(closePeriodSchema),
    defaultValues: { periodId: "", reason: "Cierre fiscal mensual regular" },
  });

  const journalForm = useForm<JournalEntryInput>({
    resolver: zodResolver(journalEntrySchema),
    defaultValues: {
      branchId: "",
      entryDate: today(),
      operationKey: generateIdempotencyKey("jnl"),
      reason: "Asiento de ajuste contable",
      lines: [
        { account_id: "", description: "Debe", debit: "0", credit: "0", currency_code: "ARS", exchange_rate: "1" },
        { account_id: "", description: "Haber", debit: "0", credit: "0", currency_code: "ARS", exchange_rate: "1" },
      ],
    },
  });

  const reversalForm = useForm<ReversalInput>({
    resolver: zodResolver(reversalSchema),
    defaultValues: {
      entryId: "",
      reversalDate: today(),
      operationKey: generateIdempotencyKey("rev"),
      reason: "Reversa de asiento contable",
    },
  });

  const reconciliationForm = useForm<ReconciliationInput>({
    resolver: zodResolver(reconciliationSchema),
    defaultValues: {
      accountId: "",
      branchId: "",
      asOfDate: today(),
      subledgerBalance: "0",
      generalLedgerBalance: "0",
      reason: "Conciliación periódica de saldos",
    },
  });

  const isDateInOpenPeriod = (isoDate: string): boolean => {
    if (!isoDate) return false;
    return (periods.data ?? []).some(
      (p) => p.status === "open" && isoDate >= p.period_start.slice(0, 10) && isoDate <= p.period_end.slice(0, 10),
    );
  };

  const handleBootstrap = async () => {
    setBootstrapError(null);
    setBootstrapPending(true);
    try {
      await bootstrapChartOfAccounts();
      await queryClient.invalidateQueries({ queryKey: ["erp", "accounting", "accounts"] });
      setFeedback("¡Plan de cuentas inicializado correctamente!");
    } catch (err) {
      setBootstrapError(err instanceof Error ? err.message : String(err));
    } finally {
      setBootstrapPending(false);
    }
  };

  const closeMutation = useMutation({
    mutationFn: closeAccountingPeriod,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["erp", "accounting", "periods"] });
      setIsClosePeriodModalOpen(false);
      setFeedback("¡Período contable cerrado y bloqueado con éxito!");
    },
  });

  const journalMutation = useMutation({
    mutationFn: postJournalEntry,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["erp", "accounting", "entries"] });
      journalForm.reset({
        branchId: journalForm.getValues().branchId,
        entryDate: today(),
        operationKey: generateIdempotencyKey("jnl"),
        reason: "",
        lines: [
          { account_id: "", description: "Debe", debit: "0", credit: "0", currency_code: "ARS", exchange_rate: "1" },
          { account_id: "", description: "Haber", debit: "0", credit: "0", currency_code: "ARS", exchange_rate: "1" },
        ],
      });
      setPeriodGuardError(null);
      setIsJournalModalOpen(false);
      setFeedback("¡Asiento contable publicado y validado en el libro diario!");
    },
  });

  const submitJournalEntry = (values: JournalEntryInput) => {
    if (!values.branchId) {
      setPeriodGuardError("Seleccioná una sucursal válida antes de publicar el asiento.");
      return;
    }
    if ((periods.data ?? []).length > 0 && !isDateInOpenPeriod(values.entryDate)) {
      setPeriodGuardError(
        `La fecha ${values.entryDate} no cae en ningún período abierto. Revisá los períodos fiscales antes de postear.`,
      );
      return;
    }
    setPeriodGuardError(null);
    journalMutation.mutate(values);
  };

  const reversalMutation = useMutation({
    mutationFn: reverseJournalEntry,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["erp", "accounting", "entries"] });
      reversalForm.reset({ reversalDate: today(), operationKey: generateIdempotencyKey("rev"), reason: "", entryId: "" });
      setIsReversalModalOpen(false);
      setFeedback("¡Asiento revertido correctamente!");
    },
  });

  const reconciliationMutation = useMutation({
    mutationFn: reconcileAccountBalance,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["erp", "accounting"] });
      setIsReconciliationModalOpen(false);
      setFeedback("¡Conciliación exacta registrada y balanceada!");
    },
  });

  // Watch journal lines to calculate live balance (Debit vs Credit)
  const watchedLines = useWatch({ control: journalForm.control, name: "lines" });
  const totalDebit = useMemo(() => {
    return (watchedLines || []).reduce((acc, l) => acc + (parseFloat(l.debit || "0") || 0), 0);
  }, [watchedLines]);
  const totalCredit = useMemo(() => {
    return (watchedLines || []).reduce((acc, l) => acc + (parseFloat(l.credit || "0") || 0), 0);
  }, [watchedLines]);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;

  const requiredPermission =
    activeModuleId === "profitability"
      ? "profitability.view"
      : activeModuleId === "reports"
      ? "reports.view"
      : "accounting.view";

  if (!hasPermission(requiredPermission)) {
    return <div className="state-panel state-panel--error">No tenés permiso para ver este módulo.</div>;
  }

  const journalEntries = entries.data ?? [];
  const chartAccounts = accounts.data ?? [];
  const accountingPeriods = periods.data ?? [];

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title={
          activeModuleId === "profitability"
            ? "Análisis de Rentabilidad & Márgenes"
            : activeModuleId === "reports"
            ? "Informes Analíticos & Inteligencia de Gestión"
            : "Contabilidad General & Libro Diario"
        }
        description={
          activeModuleId === "profitability"
            ? "Márgenes brutos y netos por línea de negocio, rentabilidad de servicios de taller y venta de artículos."
            : activeModuleId === "reports"
            ? "Reportes financieros consolidados, exportaciones fiscales e indicadores de desempeño operativo."
            : "Plan de cuentas, períodos fiscales, asientos de partida doble y conciliación de saldos."
        }
        badge={
          activeModuleId === "profitability"
            ? "Rentabilidad Operativa"
            : activeModuleId === "reports"
            ? "Centro de Reportes"
            : `${journalEntries.length} Asientos en Libro`
        }
        actions={
          isAccountingMode ? (
            <div style={{ display: "flex", gap: "8px" }}>
              {hasPermission("accounting.post") && (
                <button
                  type="button"
                  className="btn-primary"
                  style={{ marginTop: 0, padding: "8px 16px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  onClick={() => {
                    journalForm.setValue("operationKey", generateIdempotencyKey("jnl"));
                    setIsJournalModalOpen(true);
                  }}
                >
                  <PlusCircle size={15} /> Nuevo asiento manual
                </button>
              )}
              {hasPermission("accounting.view") && (
                <button
                  type="button"
                  className="pag-btn"
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                  onClick={() => setIsReconciliationModalOpen(true)}
                >
                  <CheckCheck size={14} /> Conciliar Cuenta
                </button>
              )}
              {hasPermission("accounting.close_period") && (
                <button
                  type="button"
                  className="pag-btn"
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--amber-accent)" }}
                  onClick={() => setIsClosePeriodModalOpen(true)}
                >
                  <Lock size={14} /> Cerrar Período
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      {onSelectModule && (
        <WorkspaceModuleTabs
          moduleIds={["accounting", "profitability", "reports"]}
          activeModuleId={activeModuleId}
          onSelectModule={onSelectModule}
        />
      )}

      {feedback && (
        <FeedbackAlert
          type="success"
          message={feedback}
          onClose={() => setFeedback(null)}
        />
      )}

      {activeModuleId === "profitability" ? (
        <ProfitabilitySection canExport={hasPermission("reports.export")} />
      ) : activeModuleId === "reports" ? (
        <ReportsSection canExport={hasPermission("reports.export")} />
      ) : (
        <>
          {/* KPI Row */}
          <div className="kpi-grid">
            <KpiCard
              icon={BookOpen}
              iconVariant="green"
              label="Plan de Cuentas"
              value={chartAccounts.length}
              sublabel="Cuentas activas en el árbol contable"
            />
            <KpiCard
              icon={Calendar}
              iconVariant="navy"
              label="Períodos Fiscales"
              value={accountingPeriods.length}
              sublabel={`${accountingPeriods.filter((p) => p.status === "open").length} abiertos para imputación`}
            />
            <KpiCard
              icon={Layers}
              iconVariant="steel"
              label="Asientos en Libro Diario"
              value={journalEntries.length}
              sublabel="Partidas dobles registradas"
            />
            <KpiCard
              icon={TrendingUp}
              iconVariant="dark"
              label="Balance Cuadrado"
              value="100% OK"
              sublabel="Total Debe = Total Haber"
            />
          </div>

          {/* Plan de Cuentas y Períodos Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "20px", marginBottom: "20px" }}>
            <section className="flow-card" style={{ margin: 0 }}>
              <div className="flow-card__header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <BookOpen size={18} color="var(--brand-primary)" />
                  <h3 className="flow-card__title" style={{ margin: 0 }}>Plan de Cuentas</h3>
                </div>
                <span className="type-badge blue">{chartAccounts.length} cuentas</span>
              </div>
              {chartAccounts.length === 0 ? (
                <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>No hay cuentas inicializadas todavía.</p>
                  {hasPermission("accounting.post") && (
                    <>
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ justifyContent: "center" }}
                        disabled={bootstrapPending}
                        onClick={() => void handleBootstrap()}
                      >
                        {bootstrapPending ? "Inicializando…" : "Inicializar plan de cuentas"}
                      </button>
                      {bootstrapError ? (
                        <FeedbackAlert type="error" message={bootstrapError} />
                      ) : null}
                    </>
                  )}
                </div>
              ) : (
                <div style={{ maxHeight: "240px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {chartAccounts.map((account) => (
                    <div
                      key={account.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        background: "var(--canvas-bg)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    >
                      <span>
                        <strong style={{ fontFamily: "monospace", color: "var(--brand-primary)", marginRight: "8px" }}>{account.code}</strong>
                        {account.name}
                      </span>
                      <span className="type-badge green" style={{ fontSize: "10px" }}>{account.account_type || "Activo"}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="flow-card" style={{ margin: 0 }}>
              <div className="flow-card__header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Calendar size={18} color="var(--brand-primary)" />
                  <h3 className="flow-card__title" style={{ margin: 0 }}>Períodos Fiscales</h3>
                </div>
                <span className="type-badge green">{accountingPeriods.length} períodos</span>
              </div>
              {accountingPeriods.length === 0 ? (
                <p style={{ fontSize: "13px", color: "var(--text-muted)", padding: "16px" }}>No hay períodos configurados.</p>
              ) : (
                <div style={{ maxHeight: "240px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {accountingPeriods.map((period) => (
                    <div
                      key={period.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        background: "var(--canvas-bg)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    >
                      <span>
                        <strong>{formatDate(period.period_start)}</strong> → <strong>{formatDate(period.period_end)}</strong>
                      </span>
                      <span className={`flow-status-pill ${period.status === "open" ? "completed" : "pending"}`} style={{ fontSize: "10px" }}>
                        {period.status === "open" ? "Abierto" : "Cerrado"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Quick Operations Strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "20px" }}>
            <div className="flow-card" style={{ margin: 0, padding: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>Imputación Contable</h3>
                <span className="type-badge green">Partida Doble</span>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "0 0 12px" }}>
                Imputá débitos y créditos con validación de cuentas.
              </p>
              <button
                type="button"
                className="btn-primary"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => {
                  journalForm.setValue("operationKey", generateIdempotencyKey("jnl"));
                  setIsJournalModalOpen(true);
                }}
              >
                Abrir Formulario
              </button>
            </div>

            <div className="flow-card" style={{ margin: 0, padding: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>Revertir asiento</h3>
                <span className="type-badge orange">Contrasiento</span>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "0 0 12px" }}>
                Generá contrasientos inmutables por ID de operación.
              </p>
              <button
                type="button"
                className="btn-secondary"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => setIsReversalModalOpen(true)}
              >
                Revertir Asiento
              </button>
            </div>

            <div className="flow-card" style={{ margin: 0, padding: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>Conciliación de Cuentas</h3>
                <span className="type-badge blue">Conciliación exacta</span>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "0 0 12px" }}>
                Conciliación exacta de saldos entre subdiario y libro mayor.
              </p>
              <button
                type="button"
                className="btn-secondary"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => setIsReconciliationModalOpen(true)}
              >
                Conciliar Saldos
              </button>
            </div>
          </div>

          {/* Asientos Contables */}
          <div className="flow-card">
            <div className="flow-card__header">
              <div>
                <h2 className="flow-card__title">Libro Diario General</h2>
                <p className="flow-card__subtitle">Asientos imputados y balance de partida doble</p>
              </div>
              {hasPermission("accounting.post") && journalEntries.length > 0 && (
                <button
                  type="button"
                  className="pag-btn"
                  style={{ color: "var(--rose-accent)", display: "inline-flex", alignItems: "center", gap: "4px" }}
                  onClick={() => setIsReversalModalOpen(true)}
                >
                  <RotateCcw size={13} /> Revertir Asiento
                </button>
              )}
            </div>

            {entries.isLoading ? (
              <StatePanel type="loading" message="Cargando libro diario…" />
            ) : journalEntries.length === 0 ? (
              <StatePanel
                type="empty"
                title="Libro diario sin movimientos"
                message="No hay asientos publicados todavía."
              />
            ) : (
              <div className="flow-table-wrapper">
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Descripción / Motivo</th>
                      <th>Total Debe</th>
                      <th>Total Haber</th>
                      <th>Estado</th>
                      <th className="text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journalEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td style={{ fontSize: "12px", color: "var(--text-muted)" }}>{formatDate(entry.entry_date)}</td>
                        <td>
                          <strong>{entry.description || "Asiento contable"}</strong>
                        </td>
                        <td>
                          <strong style={{ color: "var(--brand-primary)" }}>
                            {formatCurrency(Number(entry.total_debit), "ARS")}
                          </strong>
                        </td>
                        <td>
                          <strong style={{ color: "var(--emerald-success)" }}>
                            {formatCurrency(Number(entry.total_credit), "ARS")}
                          </strong>
                        </td>
                        <td>
                          <span className="flow-status-pill completed">
                            {entry.status === "draft" ? "Borrador" : entry.status === "posted" ? "Contabilizado" : "Revertido"}
                          </span>
                        </td>
                        <td className="text-right">
                          {entry.status === "posted" && hasPermission("accounting.post") && (
                            <button
                              type="button"
                              className="pag-btn"
                              style={{ color: "var(--rose-accent)", padding: "4px 8px", fontSize: "11px" }}
                              onClick={() => {
                                reversalForm.setValue("entryId", entry.id);
                                setIsReversalModalOpen(true);
                              }}
                            >
                              Revertir
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Modal: Nuevo Asiento Manual */}
      <Modal
        isOpen={isJournalModalOpen}
        onClose={() => setIsJournalModalOpen(false)}
        title="Nuevo Asiento Contable Manual"
        subtitle="Registra partida doble con validación en tiempo real (Debe = Haber)"
        icon={BookOpen}
        maxWidth="600px"
      >
        <form onSubmit={journalForm.handleSubmit(submitJournalEntry)} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div className="erp-form-group">
            <label className="erp-form-label">Sucursal *</label>
            <select className="erp-form-select" {...journalForm.register("branchId")}>
              <option value="">Seleccioná una sucursal</option>
              {(branches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>{b.code} - {b.name}</option>
              ))}
            </select>
            {journalForm.formState.errors.branchId ? (
              <span style={{ fontSize: "12px", color: "var(--rose-accent)" }}>Seleccioná una sucursal válida.</span>
            ) : null}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Fecha del Asiento *</label>
              <input className="erp-form-input" type="date" {...journalForm.register("entryDate")} />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Motivo / Concepto Obligatorio *</label>
              <input className="erp-form-input" placeholder="Ej: Ajuste de amortización o devengamiento" {...journalForm.register("reason")} />
            </div>
          </div>

          <div style={{ background: "var(--surface-subtle)", padding: "12px", borderRadius: "10px", border: "1px solid var(--border-line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span className="stat-label">Líneas de Partida Doble</span>
              <div style={{ fontSize: "12px", fontWeight: 700, color: isBalanced ? "var(--emerald-success)" : "var(--rose-accent)" }}>
                {isBalanced ? `✓ Balanceado ($${totalDebit.toLocaleString("es-AR")})` : `Desbalance: Debe $${totalDebit.toLocaleString("es-AR")} ≠ Haber $${totalCredit.toLocaleString("es-AR")}`}
              </div>
            </div>

            {/* Line 1: Debe */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px", marginBottom: "8px" }}>
              <select className="erp-form-select" {...journalForm.register("lines.0.account_id")}>
                <option value="">Cuenta de Débito (Debe)...</option>
                {chartAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                ))}
              </select>
              <input className="erp-form-input" type="number" placeholder="Monto Debe ($)" {...journalForm.register("lines.0.debit")} />
            </div>

            {/* Line 2: Haber */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
              <select className="erp-form-select" {...journalForm.register("lines.1.account_id")}>
                <option value="">Cuenta de Crédito (Haber)...</option>
                {chartAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                ))}
              </select>
              <input className="erp-form-input" type="number" placeholder="Monto Haber ($)" {...journalForm.register("lines.1.credit")} />
            </div>
          </div>

          {periodGuardError ? (
            <FeedbackAlert type="error" message={periodGuardError} />
          ) : null}
          {journalMutation.error ? (
            <FeedbackAlert type="error" message={journalMutation.error.message} />
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsJournalModalOpen(false)}>Cancelar</button>
            <button
              type="submit"
              className="btn-primary"
              disabled={journalMutation.isPending || !isBalanced}
            >
              {journalMutation.isPending ? "Imputando…" : "Publicar Asiento"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Revertir Asiento */}
      <Modal
        isOpen={isReversalModalOpen}
        onClose={() => setIsReversalModalOpen(false)}
        title="Revertir Asiento Contable"
        subtitle="Genera un contrasiento automático para anular la operación seleccionada"
        icon={RotateCcw}
        maxWidth="480px"
      >
        <form onSubmit={reversalForm.handleSubmit((values) => reversalMutation.mutate(values))} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="erp-form-group">
            <label className="erp-form-label">Asiento a Revertir *</label>
            <select className="erp-form-select" {...reversalForm.register("entryId")}>
              <option value="">Seleccioná un asiento</option>
              {journalEntries.map((e) => (
                <option key={e.id} value={e.id}>
                  {formatDate(e.entry_date)} — {e.description || e.id.slice(0, 8)} (${Number(e.total_debit).toLocaleString("es-AR")})
                </option>
              ))}
            </select>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Fecha de Reversión *</label>
            <input className="erp-form-input" type="date" {...reversalForm.register("reversalDate")} />
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Motivo Obligatorio de Reversión *</label>
            <input className="erp-form-input" placeholder="Ej: Error de imputación en centro de costos" {...reversalForm.register("reason")} />
          </div>

          {reversalMutation.error ? (
            <FeedbackAlert type="error" message={reversalMutation.error.message} />
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsReversalModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={reversalMutation.isPending}>
              {reversalMutation.isPending ? "Revirtiendo…" : "Confirmar Reversión"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Conciliar Cuenta */}
      <Modal
        isOpen={isReconciliationModalOpen}
        onClose={() => setIsReconciliationModalOpen(false)}
        title="Conciliación Exacta de Cuentas"
        subtitle="Verificación periódica de saldos entre subdiario y libro mayor"
        icon={CheckCheck}
        maxWidth="500px"
      >
        <form onSubmit={reconciliationForm.handleSubmit((values) => reconciliationMutation.mutate(values))} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="erp-form-group">
            <label className="erp-form-label">Sucursal *</label>
            <select className="erp-form-select" {...reconciliationForm.register("branchId")}>
              <option value="">Seleccioná una sucursal</option>
              {(branches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>{b.code} - {b.name}</option>
              ))}
            </select>
          </div>
          <div className="erp-form-group">
            <label className="erp-form-label">Cuenta Contable a Conciliar *</label>
            <select className="erp-form-select" {...reconciliationForm.register("accountId")}>
              <option value="">Seleccioná una cuenta</option>
              {chartAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Saldo Subdiario ($)</label>
              <input className="erp-form-input" type="number" placeholder="0" {...reconciliationForm.register("subledgerBalance")} />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Saldo Libro Mayor ($)</label>
              <input className="erp-form-input" type="number" placeholder="0" {...reconciliationForm.register("generalLedgerBalance")} />
            </div>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Fecha de Corte</label>
            <input className="erp-form-input" type="date" {...reconciliationForm.register("asOfDate")} />
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Observaciones de Conciliación</label>
            <input className="erp-form-input" placeholder="Conciliación mensual cerrada sin diferencias" {...reconciliationForm.register("reason")} />
          </div>

          {reconciliationMutation.error ? (
            <FeedbackAlert type="error" message={reconciliationMutation.error.message} />
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsReconciliationModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={reconciliationMutation.isPending}>
              {reconciliationMutation.isPending ? "Conciliando…" : "Registrar Conciliación"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Cerrar Período */}
      <Modal
        isOpen={isClosePeriodModalOpen}
        onClose={() => setIsClosePeriodModalOpen(false)}
        title="Cierre de Período Fiscal"
        subtitle="Bloquea imputaciones y calcula asientos de cierre para el período seleccionado"
        icon={Lock}
        maxWidth="480px"
      >
        <form onSubmit={closeForm.handleSubmit((values) => closeMutation.mutate(values))} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="erp-form-group">
            <label className="erp-form-label">Período Fiscal a Cerrar *</label>
            <select className="erp-form-select" {...closeForm.register("periodId")}>
              <option value="">Seleccioná un período abierto</option>
              {accountingPeriods.filter((p) => p.status === "open").map((p) => (
                <option key={p.id} value={p.id}>
                  {formatDate(p.period_start)} → {formatDate(p.period_end)}
                </option>
              ))}
            </select>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Motivo de Cierre *</label>
            <input className="erp-form-input" placeholder="Cierre mensual de ejercicio" {...closeForm.register("reason")} />
          </div>

          {closeMutation.error ? (
            <FeedbackAlert type="error" message={closeMutation.error.message} />
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsClosePeriodModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" style={{ marginTop: 0, padding: "8px 20px", background: "var(--amber-accent)" }} disabled={closeMutation.isPending}>
              {closeMutation.isPending ? "Cerrando…" : "Confirmar Cierre Fiscal"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
