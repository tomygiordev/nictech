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
import { toDateTimeInputAR } from "../../lib/dates";
import { toUserMessage } from "../../lib/errors";
import { formatCurrency, formatDateTime } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";
import { PromotionsPanel } from "./PromotionsPanel";

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
  rateToBase: z.coerce.number().finite().positive("El tipo de cambio debe ser mayor que cero."),
  source: z.string().trim().min(2, "Indicá la fuente del tipo de cambio.").max(80),
  quotedAt: z.string().min(1, "Indicá la fecha y hora del tipo de cambio."),
  reason: z.string().trim().min(5, "Indicá un motivo de al menos 5 caracteres.").max(240),
}).superRefine((values, context) => {
  if (values.quoteCurrency === "ARS" && values.rateToBase !== 1) {
    context.addIssue({
      code: "custom",
      path: ["rateToBase"],
      message: "El tipo de cambio de ARS debe ser exactamente 1,00.",
    });
  }
});

type ExchangeRateValues = z.infer<typeof exchangeRateSchema>;

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
      quotedAt: toDateTimeInputAR(),
      reason: "Actualización de tipo de cambio operativo",
    },
  });
  const quoteCurrency = form.watch("quoteCurrency");

  const fetchSnapshots = useCallback(async () => {
    if (!organizationId) {
      setError("No hay una organización ERP activa para consultar tipos de cambio.");
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
      setError(toUserMessage(err, "No se pudieron cargar los tipos de cambio."));
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
      setFeedback({ type: "error", message: "Tu rol solo permite consultar tipos de cambio." });
      return;
    }
    const parsed = exchangeRateSchema.safeParse(values);
    if (!parsed.success) {
      setFeedback({ type: "error", message: parsed.error.issues[0]?.message ?? "Revisá el tipo de cambio." });
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
      setFeedback({ type: "success", message: `Tipo de cambio ${parsed.data.quoteCurrency} registrado. Referencia: ${String(data).slice(0, 8).toUpperCase()}.` });
      await fetchSnapshots();
    } catch (err) {
      setFeedback({ type: "error", message: toUserMessage(err, "No se pudo registrar el tipo de cambio.") });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Precios, monedas y tipo de cambio"
        description="Historial de tipos de cambio usados en presupuestos y ventas."
        badge={snapshots.length === 1 ? "1 registro" : `${snapshots.length} registros`}
        badgeTone="neutral"
      />

      {onSelectModule && (
        <WorkspaceModuleTabs moduleIds={["catalog", "pricing"]} activeModuleId="pricing" onSelectModule={onSelectModule} />
      )}

      {feedback && <FeedbackAlert type={feedback.type} message={feedback.message} onClose={() => setFeedback(null)} />}

      <div className="kpi-grid">
        <KpiCard icon={DollarSign} iconVariant="green" label="ARS vigente" value={arsSnapshot ? formatCurrency(arsSnapshot.rate_to_base, arsSnapshot.base_currency || "ARS") : "Pendiente"} trend={{ text: "Base ERP", positive: Boolean(arsSnapshot) }} sublabel="Debe ser ARS 1,00" />
        <KpiCard icon={DollarSign} iconVariant="navy" label="USD vigente" value={usdSnapshot ? formatCurrency(usdSnapshot.rate_to_base, usdSnapshot.base_currency || "ARS") : "Pendiente"} trend={{ text: "Vigente", positive: Boolean(usdSnapshot) }} sublabel="Último tipo de cambio registrado" />
        <KpiCard icon={Clock3} iconVariant="steel" label="Histórico" value={snapshots.length} trend={{ text: "Registrados", positive: true }} sublabel="Registros de la organización" />
        <KpiCard icon={CheckCircle2} iconVariant="dark" label="Permiso de edición" value={canManage ? "Sí" : "No"} trend={{ text: canManage ? "Habilitado" : "Restringido", positive: canManage }} sublabel="Tu rol define si podés registrar tipos de cambio y promociones" />
      </div>

      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Registrar tipo de cambio</h2>
            <p className="flow-card__subtitle">Cada registro guarda el tipo de cambio aplicado en operaciones futuras.</p>
          </div>
          <button type="button" className="pag-btn" onClick={() => void fetchSnapshots()} disabled={loading} title="Recargar tipos de cambio"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
        </div>
        {!canManage && <StatePanel type="empty" title="Modo consulta" message="Tu rol puede consultar el historial, pero no registrar nuevos tipos de cambio." />}
        {canManage && (
          <form onSubmit={form.handleSubmit(handleSubmit)} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px" }} noValidate>
            <label className="erp-form-group">Moneda destino<select className="erp-form-input" {...form.register("quoteCurrency")}><option value="ARS">ARS ($)</option><option value="USD">USD (Dólares)</option></select></label>
            <label className="erp-form-group">Tipo de cambio a moneda base (obligatorio)<input className="erp-form-input" type="number" min="0.000001" step="0.000001" readOnly={quoteCurrency === "ARS"} {...form.register("rateToBase")} />{form.formState.errors.rateToBase && <span role="alert" style={{ color: "var(--rose-text)", fontSize: "12px" }}>{form.formState.errors.rateToBase.message}</span>}</label>
            <label className="erp-form-group">Fuente<input className="erp-form-input" {...form.register("source")} />{form.formState.errors.source && <span role="alert" style={{ color: "var(--rose-text)", fontSize: "12px" }}>{form.formState.errors.source.message}</span>}</label>
            <label className="erp-form-group">Fecha y hora<input className="erp-form-input" type="datetime-local" {...form.register("quotedAt")} />{form.formState.errors.quotedAt && <span role="alert" style={{ color: "var(--rose-text)", fontSize: "12px" }}>{form.formState.errors.quotedAt.message}</span>}</label>
            <label className="erp-form-group" style={{ gridColumn: "1 / -1" }}>Motivo<input className="erp-form-input" {...form.register("reason")} />{form.formState.errors.reason && <span role="alert" style={{ color: "var(--rose-text)", fontSize: "12px" }}>{form.formState.errors.reason.message}</span>}</label>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}><button className="btn-primary" type="submit" disabled={submitting}><Plus size={15} />{submitting ? "Registrando…" : "Registrar tipo de cambio"}</button></div>
          </form>
        )}
      </div>

      <div className="flow-card">
        <div className="flow-card__header"><div><h2 className="flow-card__title">Historial de tipos de cambio</h2><p className="flow-card__subtitle">Los presupuestos y ventas toman el último tipo de cambio vigente de cada moneda.</p></div></div>
        {loading ? <StatePanel type="loading" title="Cargando tipos de cambio" message="Consultando el historial del ERP…" /> : error ? <StatePanel type="error" title="Error al cargar tipos de cambio" message={error} /> : snapshots.length === 0 ? <StatePanel type="empty" title="Sin tipos de cambio registrados" message="Registrá ARS a 1,00 para habilitar presupuestos en moneda local." /> : (
          <div className="flow-table-wrapper"><table className="flow-table"><thead><tr><th>Moneda</th><th className="num">Tipo de cambio</th><th>Fuente</th><th>Fecha de vigencia</th><th>Registrado</th><th>Referencia</th></tr></thead><tbody>{snapshots.map((snapshot) => <tr key={snapshot.id}><td>{snapshot.quote_currency} / {snapshot.base_currency}</td><td className="num"><span className="amount-val">{formatCurrency(snapshot.rate_to_base, snapshot.base_currency || "ARS")}</span></td><td>{snapshot.source}</td><td className="nowrap">{formatDateTime(snapshot.quoted_at)}</td><td className="nowrap">{formatDateTime(snapshot.captured_at)}</td><td style={{ fontFamily: "monospace", fontSize: "11px" }}>{snapshot.id.slice(0, 8).toUpperCase()}</td></tr>)}</tbody></table></div>
        )}
      </div>

      <PromotionsPanel />
    </div>
  );
};
