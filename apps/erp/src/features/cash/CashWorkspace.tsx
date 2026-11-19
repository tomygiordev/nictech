import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Wallet,
  Clock,
  Plus,
  CheckCircle2,
  AlertTriangle,
  History,
  Receipt,
  ArrowDownRight,
  ArrowUpRight,
  Lock,
  ArrowLeftRight,
  RotateCcw,
} from "lucide-react";
import {
  ConfirmDialog,
  StatePanel,
  WorkspaceHeader,
  Modal,
  FeedbackAlert,
} from "../../components/erp/WorkspaceUi";
import { Field, FormError } from "../../components/erp/FormFeedback";
import { toUserMessage } from "../../lib/errors";
import { formatCurrency, formatDateTime, formatPosCurrency, generateIdempotencyKey } from "../../lib/formatters";
import { CASH_MOVEMENT_KIND_LABELS, labelOf } from "../../lib/labels";
import { supabase } from "../../lib/supabase";
import { useErpAuth } from "../../auth/ErpAuthContext";
import {
  cashCloseReasonSchema,
  cashCountSchema,
  manualCashMovementSchema,
  openCashSchema,
  reverseManualCashMovementSchema,
} from "./schemas";
import { postManualCashMovement, reverseManualCashMovement } from "./api";

export interface CashMovementItem {
  id: string;
  fullId: string;
  kind: string;
  currencyCode: string;
  amount: number;
  reason: string;
  occurredAt: string;
  reversalOfMovementId: string | null;
  reversed: boolean;
}

export interface CashClosureItem {
  id: string;
  closedAt: string;
  reason: string;
  expectedAmount: number;
  countedAmount: number;
  differenceAmount: number;
}

export interface CashSessionItem {
  id: string;
  fullId: string;
  registerId: string;
  registerName: string;
  branchId: string;
  initialAmountArs: number;
  expectedAmountArs: number;
  openedAt: string;
  status: "open" | "closed";
  notes: string;
  currencies: string[];
  closure?: CashClosureItem;
  movements: CashMovementItem[];
}

interface CashRegister {
  id: string;
  name: string;
  code: string;
  branch_id: string;
}

interface RawCashSessionRow {
  id: string;
  branch_id: string;
  cash_register_id: string;
  opened_at: string;
  reason: string;
  cash_session_opening_counts?: Array<{ amount: number; currency_code: string }>;
  cash_movements?: Array<{
    id: string;
    kind: string;
    amount: number;
    currency_code: string;
    reason: string;
    occurred_at: string;
    reversal_of_movement_id: string | null;
  }>;
  cash_closures?: Array<{
    id: string;
    closed_at: string;
    reason: string;
    cash_close_counts?: Array<{
      currency_code: string;
      expected_amount: number;
      counted_amount: number;
      difference_amount: number;
    }>;
  }>;
}

export const CashWorkspace: React.FC = () => {
  const { session: authSession, hasPermission } = useErpAuth();
  const user = authSession?.user;
  const fullName: unknown = user?.user_metadata.full_name;
  const cashier = (typeof fullName === "string" ? fullName.trim() : "") || user?.email || "Sin nombre registrado";
  const [sessions, setSessions] = useState<CashSessionItem[]>([]);
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Active tab: "active" | "history"
  const [viewTab, setViewTab] = useState<"active" | "history">("active");

  // Modal: Open Session
  const [isOpenModalOpen, setIsOpenModalOpen] = useState(false);
  const [selectedRegisterId, setSelectedRegisterId] = useState("");
  const [initialAmount, setInitialAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);
  const [submittingOpen, setSubmittingOpen] = useState(false);

  const [sessionToClose, setSessionToClose] = useState<CashSessionItem | null>(null);
  const [countedAmountInput, setCountedAmountInput] = useState("");
  const [closeReview, setCloseReview] = useState<{ counted: number; difference: number; operationKey: string } | null>(null);
  const [closeReasonInput, setCloseReasonInput] = useState("");
  const [reasonToConfirm, setReasonToConfirm] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [submittingClose, setSubmittingClose] = useState(false);

  // Modal: Movements Ledger Detail
  const [movementModalSession, setMovementModalSession] = useState<CashSessionItem | null>(null);

  // Modal: manual cash contribution / withdrawal / expense
  const [manualMovementSession, setManualMovementSession] = useState<CashSessionItem | null>(null);
  const [manualMovementKind, setManualMovementKind] = useState<"contribution" | "withdrawal" | "expense">("contribution");
  const [manualMovementCurrency, setManualMovementCurrency] = useState("ARS");
  const [manualMovementAmount, setManualMovementAmount] = useState("");
  const [manualMovementReason, setManualMovementReason] = useState("");
  const [movementError, setMovementError] = useState<string | null>(null);
  const [submittingMovement, setSubmittingMovement] = useState(false);

  // Modal: append-only reversal of a manual movement
  const [movementToReverse, setMovementToReverse] = useState<CashMovementItem | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reversalError, setReversalError] = useState<string | null>(null);
  const [submittingReversal, setSubmittingReversal] = useState(false);

  const fetchRegistersAndSessions = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);

      // 1. Fetch cash registers
      const { data: regData, error: regErr } = await supabase
        .from("cash_registers")
        .select("id, name, code, branch_id")
        .order("code");
      if (regErr) throw regErr;
      const regs = (regData || []) as CashRegister[];
      setRegisters(regs);
      setSelectedRegisterId((current) => regs.some((register) => register.id === current) ? current : regs[0]?.id ?? "");

      // 2. Fetch sessions with opening counts, movements, and closures
      const { data: sessData, error: sessErr } = await supabase
        .from("cash_sessions")
        .select(`
          id, branch_id, cash_register_id, opened_at, reason,
          cash_session_opening_counts(amount, currency_code),
          cash_movements(id, kind, amount, currency_code, reason, occurred_at, reversal_of_movement_id),
          cash_closures(id, closed_at, reason, cash_close_counts(currency_code, expected_amount, counted_amount, difference_amount))
        `)
        .order("opened_at", { ascending: false });

      if (sessErr) throw sessErr;

      const regMap = new Map(regs.map((r) => [r.id, r.name]));
      const rawSessions: RawCashSessionRow[] = sessData || [];

      const mapped: CashSessionItem[] = rawSessions.map((s) => {
        const counts = s.cash_session_opening_counts || [];
        const arsOpening = counts.find((c) => c.currency_code === "ARS")?.amount || 0;
        const initialAmt = Number(arsOpening);

        const allMovements = s.cash_movements || [];
        const movementsRaw = allMovements.filter((m) => m.currency_code === "ARS");
        const movementsTotal = movementsRaw.reduce((acc, m) => acc + Number(m.amount || 0), 0);
        const expectedAmt = initialAmt + movementsTotal;

        const closureRaw = s.cash_closures && s.cash_closures.length > 0 ? s.cash_closures[0] : null;
        let closureItem: CashClosureItem | undefined;

        if (closureRaw) {
          const closeCount = (closureRaw.cash_close_counts || []).find((c) => c.currency_code === "ARS");
          closureItem = {
            id: closureRaw.id,
            closedAt: formatDateTime(closureRaw.closed_at),
            reason: closureRaw.reason,
            expectedAmount: closeCount ? Number(closeCount.expected_amount) : expectedAmt,
            countedAmount: closeCount ? Number(closeCount.counted_amount) : expectedAmt,
            differenceAmount: closeCount ? Number(closeCount.difference_amount) : 0,
          };
        }

        const isClosed = Boolean(closureRaw);

        const reversedMovementIds = new Set(
          allMovements.map((movement) => movement.reversal_of_movement_id).filter(Boolean),
        );
        const movements: CashMovementItem[] = allMovements.map((m) => ({
          id: m.id,
          fullId: m.id,
          kind: m.kind,
          currencyCode: m.currency_code,
          amount: Number(m.amount),
          reason: m.reason || "Movimiento registrado",
          occurredAt: formatDateTime(m.occurred_at),
          reversalOfMovementId: m.reversal_of_movement_id,
          reversed: reversedMovementIds.has(m.id),
        }));

        return {
          id: s.id.slice(0, 8).toUpperCase(),
          fullId: s.id,
          registerId: s.cash_register_id,
          registerName: regMap.get(s.cash_register_id) || "Caja Mostrador",
          branchId: s.branch_id,
          initialAmountArs: initialAmt,
          expectedAmountArs: expectedAmt,
          openedAt: formatDateTime(s.opened_at),
          status: isClosed ? "closed" : "open",
          notes: s.reason || "Turno operativo",
          currencies: counts.map((count) => count.currency_code),
          closure: closureItem,
          movements,
        };
      });

      setSessions(mapped);
    } catch (err: unknown) {
      setLoadError(toUserMessage(err, "No se pudieron cargar los turnos de caja. Reintentá."));
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRegistersAndSessions();
  }, [fetchRegistersAndSessions]);

  const openSessions = useMemo(() => sessions.filter((s) => s.status === "open"), [sessions]);
  const closedSessions = useMemo(() => sessions.filter((s) => s.status === "closed"), [sessions]);

  const openOpeningModal = () => {
    setInitialAmount("");
    setNotes("");
    setOpenError(null);
    setIsOpenModalOpen(true);
  };

  const dismissOpeningModal = () => {
    if (!submittingOpen) setIsOpenModalOpen(false);
  };

  const handleOpenSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingOpen) return;
    if (!user) {
      setOpenError("Volvé a iniciar sesión antes de abrir un turno.");
      return;
    }
    if (!selectedRegisterId) {
      setOpenError("No hay una caja disponible para abrir el turno.");
      return;
    }
    const parsed = openCashSchema.safeParse({
      cashRegisterId: selectedRegisterId,
      operationKey: generateIdempotencyKey("open-cash"),
      reason: notes.trim() || "Apertura de turno",
      currency: "ARS",
      amount: initialAmount,
    });
    if (!parsed.success) {
      setOpenError(toUserMessage(parsed.error.issues[0], "Revisá los datos de apertura del turno."));
      return;
    }

    try {
      setSubmittingOpen(true);
      setOpenError(null);
      const { cashRegisterId, operationKey, reason, currency, amount } = parsed.data;

      const { error: rpcErr } = await supabase.rpc("open_cash_session", {
        target_cash_register_id: cashRegisterId,
        operation_key: operationKey,
        operation_reason: reason,
        opening_counts: [{ currency_code: currency, amount }],
      });

      if (rpcErr) throw rpcErr;

      setFeedback("Turno de caja abierto.");
      setIsOpenModalOpen(false);
      await fetchRegistersAndSessions();
    } catch (err: unknown) {
      setOpenError(toUserMessage(err, "No se pudo abrir el turno de caja. Reintentá."));
    } finally {
      setSubmittingOpen(false);
    }
  };

  const openArqueoModal = (session: CashSessionItem) => {
    setSessionToClose(session);
    setCountedAmountInput("");
    setCloseReview(null);
    setCloseReasonInput("");
    setReasonToConfirm(null);
    setCloseError(null);
  };

  const dismissArqueoModal = () => {
    if (submittingClose) return;
    setReasonToConfirm(null);
    setSessionToClose(null);
  };

  const handleReviewCount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionToClose || closeReview) return;
    const parsed = cashCountSchema.safeParse({ amount: countedAmountInput });
    if (!parsed.success) {
      setCloseError(toUserMessage(parsed.error.issues[0], "Revisá el efectivo contado."));
      return;
    }
    // Compare at the same four-decimal precision as the closing RPC.
    const counted = parsed.data.amount;
    const difference = (Math.round(counted * 10_000) - Math.round(sessionToClose.expectedAmountArs * 10_000)) / 10_000;
    setCloseError(null);
    setCloseReview({ counted, difference, operationKey: generateIdempotencyKey("close-cash") });
  };

  const requestCloseConfirmation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!closeReview || submittingClose) return;
    const parsed = cashCloseReasonSchema(closeReview.difference).safeParse({ reason: closeReasonInput });
    if (!parsed.success) {
      setCloseError(toUserMessage(parsed.error.issues[0], "Revisá el motivo del cierre."));
      return;
    }
    setCloseError(null);
    setReasonToConfirm(parsed.data.reason);
  };

  const handleConfirmClose = async () => {
    if (!sessionToClose || !closeReview || reasonToConfirm === null || submittingClose) return;
    try {
      setSubmittingClose(true);
      const { error: rpcErr } = await supabase.rpc("close_cash_session", {
        target_cash_session_id: sessionToClose.fullId,
        operation_key: closeReview.operationKey,
        // Even a balanced close needs a non-empty audit reason on the server.
        operation_reason: reasonToConfirm || "Cierre sin diferencias",
        counted_amounts: [{ currency_code: "ARS", amount: closeReview.counted }],
      });

      if (rpcErr) throw rpcErr;

      setFeedback(`Turno #${sessionToClose.id} cerrado.`);
      setSessionToClose(null);
      await fetchRegistersAndSessions();
    } catch (err: unknown) {
      setCloseError(toUserMessage(err, "No se pudo cerrar el turno. Reintentá."));
    } finally {
      setReasonToConfirm(null);
      setSubmittingClose(false);
    }
  };

  const openManualMovementModal = (session: CashSessionItem) => {
    setManualMovementSession(session);
    setManualMovementKind("contribution");
    setManualMovementCurrency(session.currencies[0] ?? "ARS");
    setManualMovementAmount("");
    setManualMovementReason("");
    setMovementError(null);
  };

  const handleManualMovement = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!manualMovementSession || submittingMovement) return;
    const parsed = manualCashMovementSchema.safeParse({
      cashSessionId: manualMovementSession.fullId,
      kind: manualMovementKind,
      currencyCode: manualMovementCurrency,
      amount: manualMovementAmount,
      operationKey: generateIdempotencyKey("cash-movement"),
      reason: manualMovementReason,
    });
    if (!parsed.success) {
      setMovementError(toUserMessage(parsed.error.issues[0], "Revisá los datos del movimiento de caja."));
      return;
    }

    try {
      setSubmittingMovement(true);
      setMovementError(null);
      await postManualCashMovement(parsed.data);
      setFeedback("Movimiento manual registrado en el libro de caja.");
      setManualMovementSession(null);
      await fetchRegistersAndSessions();
    } catch (err: unknown) {
      setMovementError(toUserMessage(err, "No se pudo registrar el movimiento de caja. Reintentá."));
    } finally {
      setSubmittingMovement(false);
    }
  };

  const dismissMovementModal = () => {
    if (!submittingMovement) setManualMovementSession(null);
  };

  const openReversalModal = (movement: CashMovementItem) => {
    setMovementModalSession(null);
    setMovementToReverse(movement);
    setReversalReason("");
    setReversalError(null);
  };

  const handleReverseMovement = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!movementToReverse || submittingReversal) return;
    const parsed = reverseManualCashMovementSchema.safeParse({
      cashMovementId: movementToReverse.fullId,
      operationKey: generateIdempotencyKey("cash-reversal"),
      reason: reversalReason,
    });
    if (!parsed.success) {
      setReversalError(toUserMessage(parsed.error.issues[0], "Indicá el motivo de la reversa."));
      return;
    }

    try {
      setSubmittingReversal(true);
      setReversalError(null);
      await reverseManualCashMovement(parsed.data);
      setFeedback("Movimiento revertido mediante un asiento compensatorio de caja.");
      setMovementToReverse(null);
      await fetchRegistersAndSessions();
    } catch (err: unknown) {
      setReversalError(toUserMessage(err, "No se pudo revertir el movimiento de caja. Reintentá."));
    } finally {
      setSubmittingReversal(false);
    }
  };

  const dismissReversalModal = () => {
    if (!submittingReversal) setMovementToReverse(null);
  };

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Caja y arqueos de turno"
        description="Abrí turnos, registrá ingresos o retiros y revisá el historial de cierres."
        badge={openSessions.length === 1 ? "1 caja abierta" : `${openSessions.length} cajas abiertas`}
        badgeTone="neutral"
      />

      {loadError && (
        <FeedbackAlert
          type="error"
          message={loadError}
          onClose={() => setLoadError(null)}
        />
      )}

      {feedback && (
        <FeedbackAlert
          type="success"
          message={feedback}
          onClose={() => setFeedback(null)}
        />
      )}



      {/* View Tabs: Open Sessions vs Closure History */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
        <div className="flow-tabs-nav flow-tabs-nav--switcher" aria-label="Vista de caja">
          <button
            type="button"
            className={`flow-tab-btn ${viewTab === "active" ? "active" : ""}`}
            aria-pressed={viewTab === "active"}
            onClick={() => setViewTab("active")}
          >
            Turnos activos ({openSessions.length})
          </button>
          <button
            type="button"
            className={`flow-tab-btn ${viewTab === "history" ? "active" : ""}`}
            aria-pressed={viewTab === "history"}
            onClick={() => setViewTab("history")}
          >
            Historial de arqueos ({closedSessions.length})
          </button>
        </div>

        {hasPermission("cash.open") && (
          <button
            type="button"
            className="btn-primary"
            onClick={openOpeningModal}
          >
            <Plus size={16} /> Abrir nueva caja
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
          Cargando turnos de caja…
        </div>
      ) : viewTab === "active" ? (
        openSessions.length === 0 ? (
          <StatePanel
            type="empty"
            title="No hay turnos abiertos"
            message="Para empezar un turno, abrí una caja y registrá el fondo inicial."
          />
        ) : (
          <div className="flow-card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="flow-table">
              <thead>
                <tr>
                  <th scope="col">Sesión / Caja</th>
                  <th scope="col">Apertura</th>
                  <th scope="col" className="num">Esperado</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {openSessions.map((session) => (
                  <tr key={session.fullId}>
                    <td>
                      <strong>#{session.id}</strong>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{session.registerName}</div>
                    </td>
                    <td>{session.openedAt}</td>
                    <td className="num">Se revela al cerrar</td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        <button type="button" className="pag-btn" onClick={() => setMovementModalSession(session)}>
                          <Receipt size={14} /> Ver movimientos ({session.movements.length})
                        </button>
                        {hasPermission("cash.adjust") && (
                          <button type="button" className="pag-btn" onClick={() => openManualMovementModal(session)}>
                            <ArrowLeftRight size={14} /> Ingreso o egreso
                          </button>
                        )}
                        {hasPermission("cash.close") && (
                          <button type="button" className="pag-btn" onClick={() => openArqueoModal(session)}>
                            <Lock size={14} /> Arqueo y cierre
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        /* Historial de Arqueos y Cierres */
        closedSessions.length === 0 ? (
          <StatePanel
            type="empty"
            title="Sin historial de arqueos cerrados"
            message="Los turnos cerrados con su conciliación física aparecerán aquí."
          />
        ) : (
          <div className="flow-card">
            <div className="flow-table-wrapper">
              <table className="flow-table flow-table--actions flow-table--compact">
                <thead>
                  <tr>
                    <th>Sesión / Caja</th>
                    <th>Apertura</th>
                    <th>Cierre & Arqueo</th>
                    <th className="num">Esperado</th>
                    <th className="num">Contado Físico</th>
                    <th className="num">Diferencia Conciliada</th>
                    <th>Observaciones</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {closedSessions.map((session) => {
                    const diff = session.closure?.differenceAmount ?? 0;
                    return (
                      <tr key={session.fullId}>
                        <td>
                          <strong>#{session.id}</strong>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{session.registerName}</div>
                        </td>
                        <td className="nowrap" style={{ fontSize: "12px" }}>{session.openedAt}</td>
                        <td className="nowrap" style={{ fontSize: "12px" }}>{session.closure?.closedAt || "—"}</td>
                        <td className="num">
                          <span className="amount-val">{formatPosCurrency(session.closure?.expectedAmount)}</span>
                        </td>
                        <td className="num">
                          <span className="amount-val">{formatPosCurrency(session.closure?.countedAmount)}</span>
                        </td>
                        <td className="num">
                          <span className={`flow-status-pill ${diff === 0 ? "completed" : diff > 0 ? "pending" : "cancelled"}`}>
                            {diff === 0
                              ? `Cuadrada (${formatCurrency(0, "ARS")})`
                              : diff > 0
                              ? `+${formatPosCurrency(diff)}`
                              : formatPosCurrency(diff)}
                          </span>
                        </td>
                        <td style={{ fontSize: "11px", color: "var(--text-muted)", maxWidth: "180px" }}>
                          {session.closure?.reason || session.notes}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="pag-btn"
                            onClick={() => setMovementModalSession(session)}
                          >
                            <Receipt size={12} /> Movimientos
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      <Modal
        isOpen={isOpenModalOpen}
        onClose={dismissOpeningModal}
        title="Abrir turno de caja"
        subtitle="Registrá el fondo inicial para empezar el turno."
        icon={Wallet}
        maxWidth="480px"
      >
        <form noValidate onSubmit={handleOpenSession} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <FormError message={openError} onDismiss={() => setOpenError(null)} />
          {registers.length > 1 && (
            <Field label="Caja registradora" required>
              {(field) => (
                <select
                  {...field}
                  required
                  className="erp-form-select"
                  value={selectedRegisterId}
                  onChange={(e) => setSelectedRegisterId(e.target.value)}
                >
                  {registers.map((register) => (
                    <option key={register.id} value={register.id}>{register.name} ({register.code})</option>
                  ))}
                </select>
              )}
            </Field>
          )}

          <Field label="Operador">
            {(field) => <input {...field} type="text" readOnly value={cashier} className="erp-form-input" />}
          </Field>

          <Field label="Fondo inicial en efectivo (ARS)" required hint="Si no hay fondo inicial, ingresá 0.">
            {(field) => (
              <input
                {...field}
                type="number"
                required
                min="0"
                step="any"
                data-autofocus
                value={initialAmount}
                onChange={(e) => setInitialAmount(e.target.value)}
                className="erp-form-input"
              />
            )}
          </Field>

          <Field label="Observaciones del turno">
            {(field) => (
              <input
                {...field}
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="erp-form-input"
              />
            )}
          </Field>

          <div className="erp-modal-footer">
            <button type="button" className="btn-secondary" onClick={dismissOpeningModal} disabled={submittingOpen}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={submittingOpen}>
              {submittingOpen ? "Abriendo…" : "Abrir turno"}
            </button>
          </div>
        </form>
      </Modal>

      {sessionToClose && reasonToConfirm === null && (
        <Modal
          key={closeReview ? "review" : "count"}
          isOpen
          onClose={dismissArqueoModal}
          title="Arqueo y cierre de caja"
          subtitle={`Turno #${sessionToClose.id} · ${closeReview ? "2 de 2: revisá el resultado" : "1 de 2: contá el efectivo"}`}
          icon={Lock}
          maxWidth="520px"
        >
          <form noValidate onSubmit={closeReview ? requestCloseConfirmation : handleReviewCount} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <FormError message={closeError} onDismiss={() => setCloseError(null)} />
            {closeReview ? (
              <>
                <dl
                  style={{
                    margin: 0,
                    padding: "12px",
                    background: "var(--canvas-bg)",
                    borderRadius: "10px",
                    border: "1px solid var(--border-light)",
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: "10px",
                  }}
                >
                  <div>
                    <dt className="stat-label">Fondo inicial</dt>
                    <dd style={{ margin: 0 }}>{formatPosCurrency(sessionToClose.initialAmountArs)}</dd>
                  </div>
                  <div>
                    <dt className="stat-label">Movimientos netos</dt>
                    <dd style={{ margin: 0 }}>{formatPosCurrency(sessionToClose.expectedAmountArs - sessionToClose.initialAmountArs)}</dd>
                  </div>
                  <div>
                    <dt className="stat-label">Total teórico esperado</dt>
                    <dd style={{ margin: 0 }}><strong>{formatPosCurrency(sessionToClose.expectedAmountArs)}</strong></dd>
                  </div>
                  <div>
                    <dt className="stat-label">Efectivo contado</dt>
                    <dd style={{ margin: 0 }}><strong>{formatPosCurrency(closeReview.counted)}</strong></dd>
                  </div>
                </dl>

                <div
                  data-autofocus
                  tabIndex={-1}
                  className={closeReview.difference === 0 ? "type-badge green" : "type-badge red"}
                  style={{ alignSelf: "flex-start" }}
                >
                  {closeReview.difference === 0 ? (
                    <><CheckCircle2 size={16} aria-hidden="true" /> Sin diferencia</>
                  ) : (
                    <><AlertTriangle size={16} aria-hidden="true" /> {`${closeReview.difference < 0 ? "Faltante" : "Sobrante"} de ${formatPosCurrency(Math.abs(closeReview.difference))}`}</>
                  )}
                </div>

                <Field
                  label="Motivo del cierre"
                  required={closeReview.difference !== 0}
                  hint={closeReview.difference !== 0 ? "Explicá la diferencia en al menos 5 caracteres." : "Podés agregar una observación."}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="text"
                      required={closeReview.difference !== 0}
                      value={closeReasonInput}
                      onChange={(e) => {
                        setCloseReasonInput(e.target.value);
                        if (closeError) setCloseError(null);
                      }}
                      className="erp-form-input"
                    />
                  )}
                </Field>
              </>
            ) : (
              <Field label="Efectivo contado (ARS)" required hint="Ingresá lo que contaste en la caja. Si no hay efectivo, ingresá 0.">
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    required
                    min="0"
                    step="any"
                    value={countedAmountInput}
                    onChange={(e) => {
                      setCountedAmountInput(e.target.value);
                      if (closeError) setCloseError(null);
                    }}
                    className="erp-form-input"
                  />
                )}
              </Field>
            )}

            <div className="erp-modal-footer">
              <button type="button" className="btn-secondary" onClick={dismissArqueoModal} disabled={submittingClose}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={submittingClose}>
                {closeReview ? "Cerrar turno" : "Ver resultado"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {sessionToClose && closeReview && reasonToConfirm !== null && (
        <ConfirmDialog
          isOpen
          title={closeReview.difference === 0
            ? "Cerrar turno"
            : `Cerrar turno con ${closeReview.difference < 0 ? "faltante" : "sobrante"} de ${formatPosCurrency(Math.abs(closeReview.difference))}`}
          message="Una vez cerrado, no podés reabrir el turno."
          confirmLabel="Confirmar cierre"
          onConfirm={handleConfirmClose}
          onCancel={dismissArqueoModal}
          isPending={submittingClose}
        />
      )}

      <Modal
        isOpen={Boolean(manualMovementSession)}
        onClose={dismissMovementModal}
        title="Registrar ingreso o egreso manual"
        subtitle={`Turno #${manualMovementSession?.id ?? ""} · elegí una moneda habilitada en la caja.`}
        icon={ArrowLeftRight}
        maxWidth="500px"
      >
        {manualMovementSession && (
          <form noValidate onSubmit={handleManualMovement} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <FormError message={movementError} onDismiss={() => setMovementError(null)} />
            <Field label="Tipo de movimiento" required>
              {(field) => (
                <select
                  {...field}
                  required
                  className="erp-form-select"
                  value={manualMovementKind}
                  onChange={(event) => setManualMovementKind(event.target.value as typeof manualMovementKind)}
                >
                  <option value="contribution">{CASH_MOVEMENT_KIND_LABELS.contribution}</option>
                  <option value="withdrawal">{CASH_MOVEMENT_KIND_LABELS.withdrawal}</option>
                  <option value="expense">{CASH_MOVEMENT_KIND_LABELS.expense}</option>
                </select>
              )}
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
              <Field label="Moneda" required>
                {(field) => (
                  <select
                    {...field}
                    required
                    className="erp-form-select"
                    value={manualMovementCurrency}
                    onChange={(event) => setManualMovementCurrency(event.target.value)}
                  >
                    {manualMovementSession.currencies.map((currency) => (
                      <option key={currency} value={currency}>{currency}</option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Importe" required>
                {(field) => (
                  <input
                    {...field}
                    className="erp-form-input"
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={manualMovementAmount}
                    onChange={(event) => setManualMovementAmount(event.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="Motivo o comprobante" required hint="Detallá el origen o destino del efectivo.">
              {(field) => (
                <input
                  {...field}
                  required
                  className="erp-form-input"
                  value={manualMovementReason}
                  onChange={(event) => setManualMovementReason(event.target.value)}
                />
              )}
            </Field>
            <div className="erp-modal-footer">
              <button type="button" className="btn-secondary" onClick={dismissMovementModal} disabled={submittingMovement}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={submittingMovement}>
                {submittingMovement ? "Registrando…" : "Registrar movimiento"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(movementToReverse)}
        onClose={dismissReversalModal}
        title="Revertir movimiento manual"
        subtitle={movementToReverse
          ? `${labelOf(CASH_MOVEMENT_KIND_LABELS, movementToReverse.kind)} · ${formatCurrency(movementToReverse.amount, movementToReverse.currencyCode)}`
          : ""}
        icon={RotateCcw}
        maxWidth="480px"
      >
        {movementToReverse && (
          <form noValidate onSubmit={handleReverseMovement} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <FormError message={reversalError} onDismiss={() => setReversalError(null)} />
            <p className="erp-modal-subtitle">
              El movimiento original queda registrado. La reversa agrega un movimiento por el mismo importe en sentido contrario.
            </p>
            <Field label="Motivo de la reversa" required>
              {(field) => (
                <input
                  {...field}
                  required
                  className="erp-form-input"
                  value={reversalReason}
                  onChange={(event) => setReversalReason(event.target.value)}
                />
              )}
            </Field>
            <div className="erp-modal-footer">
              <button type="button" className="btn-secondary" onClick={dismissReversalModal} disabled={submittingReversal}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={submittingReversal}>
                {submittingReversal ? "Revirtiendo…" : "Confirmar reversa"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Movements Ledger Detail */}
      <Modal
        isOpen={Boolean(movementModalSession)}
        onClose={() => setMovementModalSession(null)}
        title={`Libro de Movimientos — Sesión #${movementModalSession?.id}`}
        subtitle={`${movementModalSession?.registerName} • Abierta: ${movementModalSession?.openedAt}`}
        icon={Receipt}
        maxWidth="600px"
      >
        {movementModalSession && (
          <div>
            {movementModalSession.closure && (
              <div
                style={{
                  padding: "10px 14px",
                  background: "var(--canvas-bg)",
                  borderRadius: "8px",
                  marginBottom: "12px",
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <span className="stat-label">Fondo inicial</span>
                  <strong>{formatPosCurrency(movementModalSession.initialAmountArs)}</strong>
                </div>
                <div>
                  <span className="stat-label">Efectivo contado al cerrar</span>
                  <strong>{formatPosCurrency(movementModalSession.closure.countedAmount)}</strong>
                </div>
              </div>
            )}

            {movementModalSession.movements.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px", color: "var(--text-muted)" }}>
                No hay movimientos de cobro o retiro registrados en esta sesión.
              </div>
            ) : (
              <div style={{ maxHeight: "320px", overflowY: "auto" }}>
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Fecha/Hora</th>
                      <th>Concepto</th>
                      <th className="num">Importe</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementModalSession.movements.map((mov) => (
                      <tr key={mov.id}>
                        <td>
                          <span
                            className={`type-badge ${mov.amount >= 0 ? "green" : "red"}`}
                            style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}
                          >
                            {mov.amount >= 0 ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
                            {labelOf(CASH_MOVEMENT_KIND_LABELS, mov.kind)}
                          </span>
                        </td>
                        <td style={{ fontSize: "11px" }}>{mov.occurredAt}</td>
                        <td style={{ fontSize: "11px" }}>{mov.reason}</td>
                        <td className="num">
                          <span className="amount-val">{formatCurrency(mov.amount, mov.currencyCode)}</span>
                        </td>
                        <td>
                          {movementModalSession.status === "open"
                            && hasPermission("cash.adjust")
                            && ["contribution", "withdrawal", "expense"].includes(mov.kind)
                            && !mov.reversalOfMovementId
                            && !mov.reversed ? (
                              <button
                                type="button"
                                className="pag-btn"
                                style={{ fontSize: "10px", display: "inline-flex", alignItems: "center", gap: "3px" }}
                                onClick={() => openReversalModal(mov)}
                              >
                                <RotateCcw size={11} /> Revertir
                              </button>
                            ) : mov.reversed ? (
                              <span className="type-badge">Revertido</span>
                            ) : mov.reversalOfMovementId ? (
                              <span className="type-badge green">Compensación</span>
                            ) : (
                              "—"
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="erp-modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setMovementModalSession(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
