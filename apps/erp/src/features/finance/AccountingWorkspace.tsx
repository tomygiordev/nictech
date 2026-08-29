import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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

  if (!hasPermission("accounting.view")) return <div className="module-state">No tenés permiso para ver contabilidad.</div>;
  if (accounts.isLoading || periods.isLoading || entries.isLoading) return <div className="module-state">Cargando contabilidad…</div>;
  const error = accounts.error ?? periods.error ?? entries.error;
  if (error) return <div className="module-state">Error al cargar contabilidad: {error.message}</div>;
  const journalEntries = entries.data ?? [];
  return (
    <div className="finance-workspace">
      <div className="section-heading"><div><h2>Contabilidad</h2><p>Plan de cuentas, períodos y libro diario.</p></div><span>{journalEntries.length} asientos</span></div>
      <div className="finance-columns">
        <section className="finance-card"><h3>Plan de cuentas</h3>{(accounts.data ?? []).length === 0 ? <p>No hay cuentas inicializadas todavía.</p> : <ul>{accounts.data?.map((account) => <li key={account.id}>{account.code} — {account.name}</li>)}</ul>}</section>
        <section className="finance-card"><h3>Períodos</h3>{(periods.data ?? []).map((period) => <div key={period.id}><strong>{period.period_start} → {period.period_end}</strong><span>{period.status}</span></div>)}</section>
      </div>
      {journalEntries.length === 0 ? <div className="empty-ledger"><strong>No hay asientos publicados todavía.</strong><p>Los movimientos aparecerán cuando se publique el primer asiento.</p></div> : <div className="finance-list">{journalEntries.map((entry) => <article className="finance-card" key={entry.id}><strong>{entry.description}</strong><span>{entry.entry_date} · {entry.status} · Debe {entry.total_debit} / Haber {entry.total_credit}</span></article>)}</div>}
      {hasPermission("accounting.post") && (
        <form onSubmit={journalForm.handleSubmit((values) => journalMutation.mutate(values))}>
          <h3>Nuevo asiento manual</h3>
          <input type="date" {...journalForm.register("entryDate")} aria-label="Fecha del asiento" />
          <input placeholder="Clave idempotencia" {...journalForm.register("operationKey")} />
          <input placeholder="Motivo obligatorio" {...journalForm.register("reason")} />
          {[0, 1].map((lineIndex) => (
            <fieldset key={lineIndex}>
              <legend>Línea {lineIndex + 1}</legend>
              <select aria-label={`Cuenta línea ${lineIndex + 1}`} {...journalForm.register(`lines.${lineIndex}.account_id`)}>
                <option value="">Seleccioná una cuenta</option>
                {(accounts.data ?? []).map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
              </select>
              <input placeholder="Debe" {...journalForm.register(`lines.${lineIndex}.debit`)} />
              <input placeholder="Haber" {...journalForm.register(`lines.${lineIndex}.credit`)} />
            </fieldset>
          ))}
          <button type="submit" disabled={journalMutation.isPending}>Publicar asiento</button>
        </form>
      )}
      {hasPermission("accounting.post") && (
        <form onSubmit={reversalForm.handleSubmit((values) => reversalMutation.mutate(values))}>
          <h3>Revertir asiento</h3>
          <select aria-label="Asiento a revertir" {...reversalForm.register("entryId")}>
            <option value="">Seleccioná un asiento publicado</option>
            {journalEntries.filter((entry) => entry.status === "posted").map((entry) => <option key={entry.id} value={entry.id}>{entry.entry_date} — {entry.description}</option>)}
          </select>
          <input type="date" {...reversalForm.register("reversalDate")} aria-label="Fecha de reversa" />
          <input placeholder="Clave idempotencia" {...reversalForm.register("operationKey")} />
          <input placeholder="Motivo obligatorio" {...reversalForm.register("reason")} />
          <button type="submit" disabled={reversalMutation.isPending}>Revertir asiento</button>
        </form>
      )}
      {hasPermission("accounting.view") && (
        <form onSubmit={reconciliationForm.handleSubmit((values) => reconciliationMutation.mutate(values))}>
          <h3>Conciliación exacta</h3>
          <select aria-label="Cuenta a conciliar" {...reconciliationForm.register("accountId")}>
            <option value="">Seleccioná una cuenta</option>
            {(accounts.data ?? []).map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
          </select>
          <input placeholder="Sucursal UUID" {...reconciliationForm.register("branchId")} />
          <input type="date" {...reconciliationForm.register("asOfDate")} aria-label="Fecha de corte" />
          <input placeholder="Saldo submayor" {...reconciliationForm.register("subledgerBalance")} />
          <input placeholder="Saldo mayor" {...reconciliationForm.register("generalLedgerBalance")} />
          <input placeholder="Motivo obligatorio" {...reconciliationForm.register("reason")} />
          <button type="submit" disabled={reconciliationMutation.isPending}>Conciliar cuenta</button>
        </form>
      )}
      {hasPermission("accounting.close_period") && (
        <form onSubmit={closeForm.handleSubmit((values) => closeMutation.mutate(values))}>
          <h3>Cerrar período</h3><input placeholder="Período UUID" {...closeForm.register("periodId")} /><input placeholder="Motivo obligatorio" {...closeForm.register("reason")} /><button type="submit" disabled={closeMutation.isPending}>Cerrar período</button>
        </form>
      )}
      {closeMutation.error ? <p role="alert">{closeMutation.error.message}</p> : null}
      {journalMutation.error ? <p role="alert">{journalMutation.error.message}</p> : null}
      {reversalMutation.error ? <p role="alert">{reversalMutation.error.message}</p> : null}
      {reconciliationMutation.error ? <p role="alert">{reconciliationMutation.error.message}</p> : null}
    </div>
  );
};
