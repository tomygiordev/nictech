import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Clock3, DollarSign, Plus, RefreshCw } from "lucide-react";
import {
  FeedbackAlert,
  KpiCard,
  StatePanel,
  WorkspaceHeader,
  WorkspaceModuleTabs,
} from "../../components/erp/WorkspaceUi";
import { type ErpModuleId } from "@nictech/domain";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { formatDateTime } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";

interface ExchangeSnapshot {
  id: string;
  base_currency: string;
  quote_currency: string;
  rate_to_base: number;
  source: string;
  quoted_at: string;
  captured_at: string;
}

const exchangeRateSchema = z.object({
  quoteCurrency: z.enum(["ARS", "USD"]),
  rateToBase: z.coerce.number().finite().positive("La cotización debe ser mayor que cero."),
  source: z.string().trim().min(2, "Indicá la fuente de la cotización.").max(80),
  quotedAt: z.string().min(1, "Indicá la fecha y hora de la cotización."),
  reason: z.string().trim().min(5, "Indicá un motivo de al menos 5 caracteres.").max(240),
}).superRefine((values, context) => {
  if (values.quoteCurrency === "ARS" && values.rateToBase !== 1) {
    context.addIssue({
      code: "custom",
      path: ["rateToBase"],
      message: "La cotización de ARS debe ser exactamente 1,00.",
    });
  }
});

type ExchangeRateValues = z.infer<typeof exchangeRateSchema>;

const localDateTimeValue = (): string => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
};

export interface PricingWorkspaceProps {
  onSelectModule?: (id: ErpModuleId) => void;
}

export const PricingWorkspace: React.FC<PricingWorkspaceProps> = ({ onSelectModule }) => {
  const { organizationId, hasPermission } = useErpAuth();
  const [snapshots, setSnapshots] = useState<ExchangeSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const canManage = hasPermission("pricing.manage");
  const form = useForm<ExchangeRateValues>({
    resolver: zodResolver(exchangeRateSchema),
    defaultValues: {
      quoteCurrency: "ARS",
      rateToBase: 1,
      source: "Manual",
      quotedAt: localDateTimeValue(),
      reason: "Actualización de cotización operativa",
    },
  });
  const quoteCurrency = form.watch("quoteCurrency");

  const fetchSnapshots = useCallback(async () => {
    if (!organizationId) {
      setError("No hay una organización ERP activa para consultar cotizaciones.");
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { data, error: dbError } = await supabase
        .from("exchange_rate_snapshots")
        .select("id, base_currency, quote_currency, rate_to_base, source, quoted_at, captured_at")
        .eq("organization_id", organizationId)
        .order("quoted_at", { ascending: false })
        .limit(100);
      if (dbError) throw dbError;
      setSnapshots((data ?? []) as ExchangeSnapshot[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las cotizaciones.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void fetchSnapshots();
  }, [fetchSnapshots]);

  useEffect(() => {
    if (quoteCurrency === "ARS") form.setValue("rateToBase", 1, { shouldValidate: true });
  }, [form, quoteCurrency]);

  const arsSnapshot = useMemo(
    () => snapshots.find((snapshot) => snapshot.quote_currency === "ARS"),
    [snapshots],
  );
  const usdSnapshot = useMemo(
    () => snapshots.find((snapshot) => snapshot.quote_currency === "USD"),
    [snapshots],
  );

  const handleSubmit = async (values: ExchangeRateValues) => {
    if (!canManage) {
      setFeedback({ type: "error", message: "Tu rol sólo permite consultar cotizaciones." });
      return;
    }
    const parsed = exchangeRateSchema.safeParse(values);
    if (!parsed.success) {
      setFeedback({ type: "error", message: parsed.error.issues[0]?.message ?? "Revisá la cotización." });
      return;
    }
    try {
      setSubmitting(true);
      setFeedback(null);
      const { data, error: rpcError } = await supabase.rpc("capture_exchange_rate", {
        target_quote_currency: parsed.data.quoteCurrency,
        captured_rate_to_base: parsed.data.rateToBase,
        rate_source: parsed.data.source,
        quote_time: new Date(parsed.data.quotedAt).toISOString(),
        operation_key: `fx-ui-${crypto.randomUUID()}`,
        operation_reason: parsed.data.reason,
      });
      if (rpcError) throw rpcError;
      setFeedback({ type: "success", message: `Cotización ${parsed.data.quoteCurrency} registrada. Snapshot: ${String(data).slice(0, 8).toUpperCase()}.` });
      await fetchSnapshots();
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "No se pudo registrar la cotización." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Listas de Precios, Monedas & Cotizaciones"
        description="Cotizaciones históricas y snapshots inmutables usados para presupuestos y operaciones del ERP."
        badge={`${snapshots.length} snapshots`}
      />

      {onSelectModule && (
        <WorkspaceModuleTabs moduleIds={["catalog", "pricing"]} activeModuleId="pricing" onSelectModule={onSelectModule} />
      )}

      {feedback && <FeedbackAlert type={feedback.type} message={feedback.message} onClose={() => setFeedback(null)} />}

      <div className="kpi-grid">
        <KpiCard icon={DollarSign} iconVariant="green" label="ARS vigente" value={arsSnapshot ? `${arsSnapshot.rate_to_base}` : "Pendiente"} trend={{ text: "Base ERP", positive: Boolean(arsSnapshot) }} sublabel="Debe ser 1,00" />
        <KpiCard icon={DollarSign} iconVariant="navy" label="USD vigente" value={usdSnapshot ? `${usdSnapshot.rate_to_base}` : "Pendiente"} trend={{ text: "Snapshot", positive: Boolean(usdSnapshot) }} sublabel="Última cotización registrada" />
        <KpiCard icon={Clock3} iconVariant="steel" label="Histórico" value={snapshots.length} trend={{ text: "Inmutable", positive: true }} sublabel="Snapshots de la organización" />
        <KpiCard icon={CheckCircle2} iconVariant="dark" label="Permiso de edición" value={canManage ? "Sí" : "No"} trend={{ text: "pricing.manage", positive: canManage }} sublabel="Controlado por RBAC" />
      </div>

      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Capturar cotización</h2>
            <p className="flow-card__subtitle">Cada registro crea un snapshot auditable para congelar la cotización de la operación.</p>
          </div>
          <button type="button" className="pag-btn" onClick={() => void fetchSnapshots()} disabled={loading} title="Recargar cotizaciones"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
        </div>
        {!canManage && <StatePanel type="empty" title="Modo consulta" message="Tu rol puede consultar el histórico, pero no registrar nuevas cotizaciones." />}
        {canManage && (
          <form onSubmit={form.handleSubmit(handleSubmit)} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px" }} noValidate>
            <label className="erp-form-group">Moneda destino<select className="erp-form-input" {...form.register("quoteCurrency")}><option value="ARS">ARS ($)</option><option value="USD">USD (Dólares)</option></select></label>
            <label className="erp-form-group">Cotización a moneda base<input className="erp-form-input" type="number" min="0.000001" step="0.000001" readOnly={quoteCurrency === "ARS"} {...form.register("rateToBase")} />{form.formState.errors.rateToBase && <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>{form.formState.errors.rateToBase.message}</span>}</label>
            <label className="erp-form-group">Fuente<input className="erp-form-input" {...form.register("source")} />{form.formState.errors.source && <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>{form.formState.errors.source.message}</span>}</label>
            <label className="erp-form-group">Fecha y hora<input className="erp-form-input" type="datetime-local" {...form.register("quotedAt")} />{form.formState.errors.quotedAt && <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>{form.formState.errors.quotedAt.message}</span>}</label>
            <label className="erp-form-group" style={{ gridColumn: "1 / -1" }}>Motivo<input className="erp-form-input" {...form.register("reason")} />{form.formState.errors.reason && <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>{form.formState.errors.reason.message}</span>}</label>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}><button className="btn-primary" type="submit" disabled={submitting}><Plus size={15} />{submitting ? "Registrando…" : "Registrar cotización"}</button></div>
          </form>
        )}
      </div>

      <div className="flow-card">
        <div className="flow-card__header"><div><h2 className="flow-card__title">Histórico de snapshots</h2><p className="flow-card__subtitle">Los presupuestos toman el snapshot más reciente visible de su moneda.</p></div></div>
        {loading ? <StatePanel type="loading" title="Cargando cotizaciones" message="Consultando el histórico ERP…" /> : error ? <StatePanel type="error" title="Error al cargar cotizaciones" message={error} /> : snapshots.length === 0 ? <StatePanel type="empty" title="Sin cotizaciones registradas" message="Registrá ARS a 1,00 para habilitar presupuestos en moneda local." /> : (
          <div className="flow-table-wrapper"><table className="flow-table"><thead><tr><th>Moneda</th><th>Cotización</th><th>Fuente</th><th>Fecha de cotización</th><th>Capturada</th><th>Snapshot</th></tr></thead><tbody>{snapshots.map((snapshot) => <tr key={snapshot.id}><td>{snapshot.quote_currency} / {snapshot.base_currency}</td><td style={{ fontWeight: 700 }}>{snapshot.rate_to_base}</td><td>{snapshot.source}</td><td>{formatDateTime(snapshot.quoted_at)}</td><td>{formatDateTime(snapshot.captured_at)}</td><td style={{ fontFamily: "monospace", fontSize: "11px" }}>{snapshot.id.slice(0, 8).toUpperCase()}</td></tr>)}</tbody></table></div>
        )}
      </div>
    </div>
  );
};
