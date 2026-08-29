import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BookOpen, Calendar, FileSpreadsheet, RotateCcw, CheckCheck, Lock, AlertCircle } from "lucide-react";
import { useErpAuth } from "../../auth/ErpAuthContext";
import {
  closeAccountingPeriod,
  listAccountingPeriods,
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
import { StatePanel, WorkspaceHeader } from "../../components/erp/WorkspaceUi";

const today = () => new Date().toISOString().slice(0, 10);

export const AccountingWorkspace = () => {
  const { hasPermission } = useErpAuth();
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["erp", "accounting", "accounts"], queryFn: listChartOfAccounts });
  const periods = useQuery({ queryKey: ["erp", "accounting", "periods"], queryFn: listAccountingPeriods });
  const entries = useQuery({ queryKey: ["erp", "accounting", "entries"], queryFn: listJournalEntries });
  
  const closeForm = useForm<ClosePeriodInput>({ resolver: zodResolver(closePeriodSchema) });
  const journalForm = useForm<JournalEntryInput>({
    resolver: zodResolver(journalEntrySchema),
    defaultValues: {
      entryDate: today(),
      operationKey: "",
      reason: "",
      lines: [
        { account_id: "", description: "Debe", debit: "0", credit: "0", currency_code: "ARS", exchange_rate: "1" },
        { account_id: "", description: "Haber", debit: "0", credit: "0", currency_code: "ARS", exchange_rate: "1" },
      ],
    },
  });
  const reversalForm = useForm<ReversalInput>({
    resolver: zodResolver(reversalSchema),
    defaultValues: { reversalDate: today(), operationKey: "", reason: "" },
  });
  const reconciliationForm = useForm<ReconciliationInput>({
    resolver: zodResolver(reconciliationSchema),
    defaultValues: { asOfDate: today(), subledgerBalance: "0", generalLedgerBalance: "0", reason: "" },
  });

  const closeMutation = useMutation({
    mutationFn: closeAccountingPeriod,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["erp", "accounting", "periods"] }),
  });
  const journalMutation = useMutation({
    mutationFn: postJournalEntry,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["erp", "accounting", "entries"] });
      journalForm.reset();
    },
  });
  const reversalMutation = useMutation({
    mutationFn: reverseJournalEntry,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["erp", "accounting", "entries"] });
      reversalForm.reset({ reversalDate: today(), operationKey: "", reason: "" });
    },
  });
  const reconciliationMutation = useMutation({
    mutationFn: reconcileAccountBalance,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["erp", "accounting"] }),
  });

  if (!hasPermission("accounting.view")) {
    return <div className="state-panel state-panel--error">No tenés permiso para ver contabilidad.</div>;
  }
  if (accounts.isLoading || periods.isLoading || entries.isLoading) {
    return <StatePanel type="loading" message="Cargando contabilidad…" />;
  }
  const error = accounts.error ?? periods.error ?? entries.error;
  if (error) {
    return <StatePanel type="error" title="Error al cargar contabilidad" message={error.message} />;
  }

  const journalEntries = entries.data ?? [];

  return (
    <div>
      <WorkspaceHeader
        title="Contabilidad & Libro Diario"
        description="Plan de cuentas, períodos fiscales y asientos de partida doble."
        badge={`${journalEntries.length} Asientos`}
      />

      {/* Plan de Cuentas y Períodos */}
      <div className="forms-grid" style={{ marginTop: 0, marginBottom: 20 }}>
        <section className="record-card">
          <div className="record-card__header">
            <div className="form-header" style={{ marginBottom: 0 }}>
              <BookOpen size={16} color="#16a34a" />
              <h3>Plan de cuentas</h3>
            </div>
            <span className="status-pill status-pill--mint">{(accounts.data ?? []).length} cuentas</span>
          </div>
          {(accounts.data ?? []).length === 0 ? (
            <p className="record-card__code">No hay cuentas inicializadas todavía.</p>
          ) : (
            <ul className="installments-mini-list">
              {accounts.data?.map((account) => (
                <li key={account.id}>
                  <strong>{account.code}</strong>
                  <span>— {account.name}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="record-card">
          <div className="record-card__header">
            <div className="form-header" style={{ marginBottom: 0 }}>
              <Calendar size={16} color="#16a34a" />
              <h3>Períodos</h3>
            </div>
            <span className="status-pill status-pill--mint">{(periods.data ?? []).length} períodos</span>
          </div>
          <div className="installments-mini-list">
            {(periods.data ?? []).map((period) => (
              <li key={period.id}>
                <strong>{period.period_start} → {period.period_end}</strong>
                <span className="status-pill status-pill--mint">{period.status}</span>
              </li>
            ))}
          </div>
        </section>
      </div>

      {/* Asientos Publicados */}
      {journalEntries.length === 0 ? (
        <StatePanel
          type="empty"
          title="Libro diario sin movimientos"
          message="No hay asientos publicados todavía."
        />
      ) : (
        <div className="records-grid">
          {journalEntries.map((entry) => (
            <article className="record-card" key={entry.id}>
              <div className="record-card__header">
                <strong>{entry.description}</strong>
                <span className="status-pill status-pill--mint">{entry.entry_date} · {entry.status}</span>
              </div>
              <dl className="record-card__metrics">
                <div>
                  <dt>Debe</dt>
                  <dd>${entry.total_debit}</dd>
                </div>
                <div>
                  <dt>Haber</dt>
                  <dd>${entry.total_credit}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}

      {/* Formularios Contables */}
      <div className="forms-grid">
        {hasPermission("accounting.post") && (
          <form className="erp-form" onSubmit={journalForm.handleSubmit((values) => journalMutation.mutate(values))}>
            <div className="form-header">
              <BookOpen size={18} color="#16a34a" />
              <h3>Nuevo asiento manual</h3>
            </div>
            <div className="form-fields-grid">
              <input type="date" {...journalForm.register("entryDate")} aria-label="Fecha del asiento" />
              <input placeholder="Clave idempotencia" {...journalForm.register("operationKey")} />
              <input placeholder="Motivo obligatorio" {...journalForm.register("reason")} />
            </div>

            {[0, 1].map((lineIndex) => (
              <fieldset className="form-fieldset" key={lineIndex}>
                <legend>Línea {lineIndex + 1}</legend>
                <div className="form-fields-grid">
                  <select aria-label={`Cuenta línea ${lineIndex + 1}`} {...journalForm.register(`lines.${lineIndex}.account_id`)}>
                    <option value="">Seleccioná una cuenta</option>
                    {(accounts.data ?? []).map((account) => (
                      <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
                    ))}
                  </select>
                  <input placeholder="Debe" {...journalForm.register(`lines.${lineIndex}.debit`)} />
                  <input placeholder="Haber" {...journalForm.register(`lines.${lineIndex}.credit`)} />
                </div>
              </fieldset>
            ))}

            <button className="btn-primary-form" type="submit" disabled={journalMutation.isPending}>
              {journalMutation.isPending ? "Publicando..." : "Publicar asiento"}
            </button>
            {journalMutation.error ? (
              <div className="form-error-alert" role="alert">
                <AlertCircle size={14} /> {journalMutation.error.message}
              </div>
            ) : null}
          </form>
        )}

        {hasPermission("accounting.post") && (
          <form className="erp-form" onSubmit={reversalForm.handleSubmit((values) => reversalMutation.mutate(values))}>
            <div className="form-header">
              <RotateCcw size={18} color="#e11d48" />
              <h3>Revertir asiento</h3>
            </div>
            <div className="form-fields-grid">
              <select aria-label="Asiento a revertir" {...reversalForm.register("entryId")}>
                <option value="">Seleccioná un asiento publicado</option>
                {journalEntries.filter((entry) => entry.status === "posted").map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.entry_date} — {entry.description}</option>
                ))}
              </select>
              <input type="date" {...reversalForm.register("reversalDate")} aria-label="Fecha de reversa" />
              <input placeholder="Clave idempotencia" {...reversalForm.register("operationKey")} />
              <input placeholder="Motivo obligatorio" {...reversalForm.register("reason")} />
            </div>
            <button className="btn-secondary-form" type="submit" disabled={reversalMutation.isPending}>
              {reversalMutation.isPending ? "Revirtiendo..." : "Revertir asiento"}
            </button>
            {reversalMutation.error ? (
              <div className="form-error-alert" role="alert">
                <AlertCircle size={14} /> {reversalMutation.error.message}
              </div>
            ) : null}
          </form>
        )}

        {hasPermission("accounting.view") && (
          <form className="erp-form" onSubmit={reconciliationForm.handleSubmit((values) => reconciliationMutation.mutate(values))}>
            <div className="form-header">
              <CheckCheck size={18} color="#16a34a" />
              <h3>Conciliación exacta</h3>
            </div>
            <div className="form-fields-grid">
              <select aria-label="Cuenta a conciliar" {...reconciliationForm.register("accountId")}>
                <option value="">Seleccioná una cuenta</option>
                {(accounts.data ?? []).map((account) => (
                  <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
                ))}
              </select>
              <input placeholder="Sucursal UUID" {...reconciliationForm.register("branchId")} />
              <input type="date" {...reconciliationForm.register("asOfDate")} aria-label="Fecha de corte" />
              <input placeholder="Saldo submayor" {...reconciliationForm.register("subledgerBalance")} />
              <input placeholder="Saldo mayor" {...reconciliationForm.register("generalLedgerBalance")} />
              <input placeholder="Motivo obligatorio" {...reconciliationForm.register("reason")} />
            </div>
            <button className="btn-primary-form" type="submit" disabled={reconciliationMutation.isPending}>
              {reconciliationMutation.isPending ? "Conciliando..." : "Conciliar cuenta"}
            </button>
            {reconciliationMutation.error ? (
              <div className="form-error-alert" role="alert">
                <AlertCircle size={14} /> {reconciliationMutation.error.message}
              </div>
            ) : null}
          </form>
        )}

        {hasPermission("accounting.close_period") && (
          <form className="erp-form" onSubmit={closeForm.handleSubmit((values) => closeMutation.mutate(values))}>
            <div className="form-header">
              <Lock size={18} color="#d97706" />
              <h3>Cerrar período</h3>
            </div>
            <div className="form-fields-grid">
              <input placeholder="Período UUID" {...closeForm.register("periodId")} />
              <input placeholder="Motivo obligatorio" {...closeForm.register("reason")} />
            </div>
            <button className="btn-secondary-form" type="submit" disabled={closeMutation.isPending}>
              {closeMutation.isPending ? "Cerrando..." : "Cerrar período"}
            </button>
            {closeFormStateAlert(closeMutation.error)}
          </form>
        )}
      </div>
    </div>
  );
};

const closeFormStateAlert = (error: Error | null) => {
  if (!error) return null;
  return (
    <div className="form-error-alert" role="alert">
      <AlertCircle size={14} /> {error.message}
    </div>
  );
};
