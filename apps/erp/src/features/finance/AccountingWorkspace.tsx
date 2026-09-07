
import React, { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  DollarSign,
  Percent,
  FileText,
  FileSpreadsheet,
  Download,
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
  listAccountingPeriods,
  listBranches,
  listChartOfAccounts,
  listJournalEntries,
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
import { type ErpModuleId } from "@nictech/domain";
import { formatCurrency, formatDate, generateIdempotencyKey } from "../../lib/formatters";

const downloadDraftFile = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const ProfitabilitySection = () => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{
        padding: "12px 16px",
        background: "#eff6ff",
        border: "1px solid #bfdbfe",
        borderRadius: "8px",
        color: "#1e40af",
        fontSize: "13px"
      }}>
        <strong>[Módulo DEMO / Proyección - FASE G]:</strong> Los indicadores de rentabilidad, márgenes brutos y ticket promedio mostrados abajo son proyecciones analíticas de demostración. En FASE G se calcularán dinámicamente sobre los asientos de ventas y compras del ejercicio cerrado.
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <KpiCard
          icon={Percent}
          iconVariant="green"
          label="Margen Bruto Consolidado"
          value="43.8%"
          trend={{ text: "+2.4% vs mes ant.", positive: true }}
          sublabel="Rentabilidad promedio ponderada"
        />
        <KpiCard
          icon={DollarSign}
          iconVariant="navy"
          label="Ganancia Bruta Acumulada"
          value="$6.960.000"
          trend={{ text: "ARS", positive: true }}
          sublabel="Ingresos netos menos costo de mercadería"
        />
        <KpiCard
          icon={TrendingUp}
          iconVariant="steel"
          label="Línea Más Rentable"
          value="Taller (68.5%)"
          trend={{ text: "Servicios", positive: true }}
          sublabel="Alta contribución marginal"
        />
        <KpiCard
          icon={BarChart3}
          iconVariant="dark"
          label="Ticket Promedio Taller"
          value="$58.400"
          trend={{ text: "Mano de Obra", positive: true }}
          sublabel="Diagnósticos y reparaciones"
        />
      </div>

      {/* Main Table: Rentabilidad por Línea de Negocio */}
      <div className="flow-card">
        <div className="flow-card__header">
          <div>
            <h2 className="flow-card__title">Rentabilidad por Unidad de Negocio</h2>
            <p className="flow-card__subtitle">Desglose de ingresos, costo directo de ventas (COGS) y margen bruto porcentual</p>
          </div>
        </div>

        <div className="flow-table-wrapper">
          <table className="flow-table">
            <thead>
              <tr>
                <th>Unidad de Negocio</th>
                <th>Ingresos Netos</th>
                <th>Costo Directo (COGS)</th>
                <th>Margen Bruto</th>
                <th>% Margen</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Dispositivos & Celulares</strong></td>
                <td>$8.450.000</td>
                <td>$5.490.000</td>
                <td>$2.960.000</td>
                <td><span className="flow-status-pill completed">35.0%</span></td>
              </tr>
              <tr>
                <td><strong>Servicio Técnico & Taller</strong></td>
                <td>$3.820.000</td>
                <td>$1.200.000</td>
                <td>$2.620.000</td>
                <td><span className="flow-status-pill completed">68.5%</span></td>
              </tr>
              <tr>
                <td><strong>Fundas & Accesorios</strong></td>
                <td>$2.120.000</td>
                <td>$848.000</td>
                <td>$1.272.000</td>
                <td><span className="flow-status-pill completed">60.0%</span></td>
              </tr>
              <tr>
                <td><strong>Ensamble de PCs & Armados</strong></td>
                <td>$1.490.000</td>
                <td>$1.392.000</td>
                <td>$98.000</td>
                <td><span className="flow-status-pill processing">6.5%</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};


const ReportsSection = () => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{
        padding: "12px 16px",
        background: "#eff6ff",
        border: "1px solid #bfdbfe",
        borderRadius: "8px",
        color: "#1e40af",
        fontSize: "13px"
      }}>
        <strong>[Módulo DEMO / Informes Fiscales - FASE G]:</strong> Los informes fiscales y libros de IVA se integrarán con la API de ARCA y los períodos contables cerrados en FASE G. Los botones de exportación descargan borradores de prueba para verificación de estructura.
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <KpiCard
          icon={DollarSign}
          iconVariant="green"
          label="Ventas Netas Período"
          value="$15.880.000"
          trend={{ text: "ARS", positive: true }}
          sublabel="Facturación bruta sin descuentos"
        />
        <KpiCard
          icon={PieChart}
          iconVariant="navy"
          label="Débito Fiscal (IVA 21%)"
          value="$2.756.000"
          trend={{ text: "ARCA", positive: true }}
          sublabel="Impuesto generado en facturación"
        />
        <KpiCard
          icon={Layers}
          iconVariant="steel"
          label="Crédito Fiscal Compras"
          value="$1.840.000"
          trend={{ text: "Deducción", positive: true }}
          sublabel="IVA computable de proveedores"
        />
        <KpiCard
          icon={CheckCircle2}
          iconVariant="dark"
          label="Saldo Técnico a Pagar"
          value="$916.000"
          trend={{ text: "Posición IVA", positive: true }}
          sublabel="Vencimiento DDJJ día 20"
        />
      </div>

      {/* Reports Download Grid */}
      <div className="flow-card">
        <div className="flow-card__header">
          <div>
            <h2 className="flow-card__title">Centro de Informes & Exportaciones Fiscales</h2>
            <p className="flow-card__subtitle">Generación de archivos reglamentarios para AFIP/ARCA, balances contables y auditorías de inventario</p>
          </div>
          <span className="type-badge blue">Formatos TXT / CSV / PDF</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
          <div style={{ padding: "16px", background: "var(--canvas-bg)", borderRadius: "12px", border: "1px solid var(--border-line)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "12px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <FileText size={18} color="var(--brand-primary)" />
                <strong style={{ fontSize: "14px" }}>Libro IVA Ventas Digital</strong>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                Régimen de información RG 4597 para importación directa en el portal ARCA.
              </p>
            </div>
            <button
              type="button"
              className="pag-btn"
              style={{ justifyContent: "center", gap: "6px" }}
              onClick={() => downloadDraftFile("libro_iva_ventas_borrador.txt", "ENCABEZADO_LIBRO_IVA_VENTAS\nPERIODO: 202608\n(Borrador demostrativo no fiscal - FASE G)\n")}
            >
              <Download size={14} /> Exportar TXT / CSV
            </button>
          </div>

          <div style={{ padding: "16px", background: "var(--canvas-bg)", borderRadius: "12px", border: "1px solid var(--border-line)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "12px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <FileSpreadsheet size={18} color="var(--emerald-success)" />
                <strong style={{ fontSize: "14px" }}>Balance de Sumas y Saldos</strong>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                Resumen analítico de todas las cuentas del plan con saldos deudores y acreedores.
              </p>
            </div>
            <button
              type="button"
              className="pag-btn"
              style={{ justifyContent: "center", gap: "6px" }}
              onClick={() => downloadDraftFile("balance_sumas_saldos_borrador.csv", "Cuenta,Debe,Haber,Saldo\nCaja Central,0,0,0\n(Borrador demostrativo - FASE G)\n")}
            >
              <Download size={14} /> Exportar Excel (.csv)
            </button>
          </div>

          <div style={{ padding: "16px", background: "var(--canvas-bg)", borderRadius: "12px", border: "1px solid var(--border-line)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "12px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <TrendingUp size={18} color="var(--steel-blue)" />
                <strong style={{ fontSize: "14px" }}>Estado de Resultados & EBITDA</strong>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                Informe ejecutivo mensual de ingresos, costos directos y gastos operativos.
              </p>
            </div>
            <button
              type="button"
              className="pag-btn"
              style={{ justifyContent: "center", gap: "6px" }}
              onClick={() => downloadDraftFile("estado_resultados_borrador.txt", "ESTADO DE RESULTADOS\n(Borrador demostrativo - FASE G)\n")}
            >
              <Download size={14} /> Descargar Borrador
            </button>
          </div>

          <div style={{ padding: "16px", background: "var(--canvas-bg)", borderRadius: "12px", border: "1px solid var(--border-line)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "12px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <BarChart3 size={18} color="var(--purple-accent)" />
                <strong style={{ fontSize: "14px" }}>Auditoría de Rotación de Stock</strong>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                Tasa de rotación de artículos, stock inmovilizado y valorización contable.
              </p>
            </div>
            <button
              type="button"
              className="pag-btn"
              style={{ justifyContent: "center", gap: "6px" }}
              onClick={() => downloadDraftFile("rotacion_stock_borrador.csv", "SKU,Descripcion,Rotacion\n(Borrador demostrativo - FASE G)\n")}
            >
              <Download size={14} /> Exportar CSV
            </button>
          </div>
        </div>
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
        <ProfitabilitySection />
      ) : activeModuleId === "reports" ? (
        <ReportsSection />
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
                          <span className="flow-status-pill completed">{entry.status}</span>
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
