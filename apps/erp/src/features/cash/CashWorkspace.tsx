import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Wallet,
  Clock,
  Plus,
  DollarSign,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  History,
  Receipt,
  ArrowDownRight,
  ArrowUpRight,
  Lock,
} from "lucide-react";
import {
  StatePanel,
  WorkspaceHeader,
  Modal,
  FeedbackAlert,
  KpiCard,
} from "../../components/erp/WorkspaceUi";
import { formatCurrency, formatDateTime } from "../../lib/formatters";
import { supabase } from "../../lib/supabase";

export interface CashMovementItem {
  id: string;
  kind: string;
  amount: number;
  reason: string;
  occurredAt: string;
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
  currentAmountArs: number;
  expectedAmountArs: number;
  openedAt: string;
  status: "open" | "closed";
  notes: string;
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
  const [sessions, setSessions] = useState<CashSessionItem[]>([]);
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Active tab: "active" | "history"
  const [viewTab, setViewTab] = useState<"active" | "history">("active");

  // Modal: Open Session
  const [isOpenModalOpen, setIsOpenModalOpen] = useState(false);
  const [selectedRegisterId, setSelectedRegisterId] = useState("");
  const [cashier, setCashier] = useState("Operador NicTech");
  const [initialAmount, setInitialAmount] = useState("0");
  const [notes, setNotes] = useState("Apertura de turno");
  const [submittingOpen, setSubmittingOpen] = useState(false);

  // Modal: Close / Arqueo Session (Finding 16)
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [sessionToClose, setSessionToClose] = useState<CashSessionItem | null>(null);
  const [countedAmountInput, setCountedAmountInput] = useState<string>("");
  const [closeReasonInput, setCloseReasonInput] = useState<string>("Arqueo y cierre de turno");
  const [submittingClose, setSubmittingClose] = useState(false);

  // Modal: Movements Ledger Detail
  const [movementModalSession, setMovementModalSession] = useState<CashSessionItem | null>(null);

  const fetchRegistersAndSessions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Fetch cash registers
      const { data: regData, error: regErr } = await supabase
        .from("cash_registers")
        .select("id, name, code, branch_id")
        .order("code");
      if (regErr) throw regErr;
      const regs = (regData || []) as CashRegister[];
      setRegisters(regs);
      if (regs.length > 0 && !selectedRegisterId) {
        setSelectedRegisterId(regs[0].id);
      }

      // 2. Fetch sessions with opening counts, movements, and closures
      const { data: sessData, error: sessErr } = await supabase
        .from("cash_sessions")
        .select(`
          id, branch_id, cash_register_id, opened_at, reason,
          cash_session_opening_counts(amount, currency_code),
          cash_movements(id, kind, amount, currency_code, reason, occurred_at),
          cash_closures(id, closed_at, reason, cash_close_counts(currency_code, expected_amount, counted_amount, difference_amount))
        `)
        .order("opened_at", { ascending: false });

      if (sessErr) throw sessErr;

      const regMap = new Map(regs.map((r) => [r.id, r.name]));
      const rawSessions = (sessData as unknown as RawCashSessionRow[]) || [];

      const mapped: CashSessionItem[] = rawSessions.map((s) => {
        const counts = s.cash_session_opening_counts || [];
        const arsOpening = counts.find((c) => c.currency_code === "ARS")?.amount || 0;
        const initialAmt = Number(arsOpening);

        const movementsRaw = (s.cash_movements || []).filter((m) => m.currency_code === "ARS");
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
        const currentAmt = isClosed && closureItem ? closureItem.countedAmount : expectedAmt;

        const movements: CashMovementItem[] = movementsRaw.map((m) => ({
          id: m.id,
          kind: m.kind,
          amount: Number(m.amount),
          reason: m.reason || "Movimiento registrado",
          occurredAt: formatDateTime(m.occurred_at),
        }));

        return {
          id: s.id.slice(0, 8).toUpperCase(),
          fullId: s.id,
          registerId: s.cash_register_id,
          registerName: regMap.get(s.cash_register_id) || "Caja Mostrador",
          branchId: s.branch_id,
          initialAmountArs: initialAmt,
          currentAmountArs: currentAmt,
          expectedAmountArs: expectedAmt,
          openedAt: formatDateTime(s.opened_at),
          status: isClosed ? "closed" : "open",
          notes: s.reason || "Turno operativo",
          closure: closureItem,
          movements,
        };
      });

      setSessions(mapped);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al consultar sesiones de caja");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [selectedRegisterId]);

  useEffect(() => {
    fetchRegistersAndSessions();
  }, [fetchRegistersAndSessions]);

  const openSessions = useMemo(() => sessions.filter((s) => s.status === "open"), [sessions]);
  const closedSessions = useMemo(() => sessions.filter((s) => s.status === "closed"), [sessions]);

  const totalCashInOpenDrawers = useMemo(
    () => openSessions.reduce((acc, s) => acc + s.currentAmountArs, 0),
    [openSessions],
  );
  const totalInitialFunds = useMemo(
    () => openSessions.reduce((acc, s) => acc + s.initialAmountArs, 0),
    [openSessions],
  );

  const handleOpenSession = async (e: React.FormEvent) => {
    e.preventDefault();
    const regId = selectedRegisterId || registers[0]?.id;
    if (!regId) {
      setError("No se encontró una caja registradora activa en la base de datos.");
      return;
    }

    try {
      setSubmittingOpen(true);
      setError(null);
      const initAmt = parseFloat(initialAmount) || 0;
      const opKey = `open-cash-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const reason = notes.trim() || `Apertura por ${cashier.trim()}`;

      const { error: rpcErr } = await supabase.rpc("open_cash_session", {
        target_cash_register_id: regId,
        operation_key: opKey,
        operation_reason: reason,
        opening_counts: [{ currency_code: "ARS", amount: initAmt }],
      });

      if (rpcErr) throw rpcErr;

      setFeedback("¡Sesión de caja abierta exitosamente en la base de datos central!");
      setIsOpenModalOpen(false);
      setInitialAmount("0");
      setNotes("Apertura de turno");
      await fetchRegistersAndSessions();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al abrir sesión de caja");
    } finally {
      setSubmittingOpen(false);
    }
  };

  const openArqueoModal = (session: CashSessionItem) => {
    setSessionToClose(session);
    setCountedAmountInput(session.expectedAmountArs.toString());
    setCloseReasonInput("Arqueo y cierre de turno");
    setIsCloseModalOpen(true);
  };

  const calculatedDifference = useMemo(() => {
    if (!sessionToClose) return 0;
    const counted = parseFloat(countedAmountInput) || 0;
    return counted - sessionToClose.expectedAmountArs;
  }, [sessionToClose, countedAmountInput]);

  const handleConfirmClose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionToClose) return;

    try {
      setSubmittingClose(true);
      setError(null);
      const counted = parseFloat(countedAmountInput);
      if (isNaN(counted) || counted < 0) {
        throw new Error("Debe ingresar un monto válido no negativo.");
      }

      const opKey = `close-cash-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const reason = closeReasonInput.trim() || "Arqueo y cierre de turno";

      const { error: rpcErr } = await supabase.rpc("close_cash_session", {
        target_cash_session_id: sessionToClose.fullId,
        operation_key: opKey,
        operation_reason: reason,
        counted_amounts: [{ currency_code: "ARS", amount: counted }],
      });

      if (rpcErr) throw rpcErr;

      setFeedback(
        `¡Arqueo y cierre completado! Sesión #${sessionToClose.id} cerrada. Diferencia conciliada: ${formatCurrency(
          calculatedDifference,
          "ARS",
        )}.`,
      );
      setIsCloseModalOpen(false);
      setSessionToClose(null);
      await fetchRegistersAndSessions();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al realizar el arqueo y cierre");
    } finally {
      setSubmittingClose(false);
    }
  };

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Gestión de Caja & Arqueos de Turno"
        description="Apertura, arqueos con conciliación física de diferencias, registro de ventas en efectivo y trazabilidad central en erp.cash_sessions."
        badge={`${openSessions.length} Cajas Abiertas`}
      />

      {error && (
        <FeedbackAlert
          type="error"
          message={error}
          onClose={() => setError(null)}
        />
      )}

      {feedback && (
        <FeedbackAlert
          type="success"
          message={feedback}
          onClose={() => setFeedback(null)}
        />
      )}

      {/* KPI Cards Row */}
      <div className="kpi-grid">
        <KpiCard
          icon={DollarSign}
          iconVariant="green"
          label="Total Efectivo en Cajas"
          value={formatCurrency(totalCashInOpenDrawers, "ARS")}
          trend={{ text: "En Mano", positive: true }}
          sublabel="Saldo real disponible en sucursal"
        />

        <KpiCard
          icon={Wallet}
          iconVariant="navy"
          label="Fondo Inicial Consolidado"
          value={formatCurrency(totalInitialFunds, "ARS")}
          trend={{ text: "Apertura", positive: true }}
          sublabel="Apertura de turnos activos"
        />

        <KpiCard
          icon={TrendingUp}
          iconVariant="steel"
          label="Cajas Activas"
          value={`${openSessions.length} de ${registers.length}`}
          trend={{ text: "Operativas", positive: true }}
          sublabel="Mostrador y cobro omnicanal"
        />
      </div>

      <div
        style={{
          padding: "12px 16px",
          background: "var(--bg-app)",
          border: "1px solid var(--border-line)",
          borderRadius: "8px",
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "12px",
          color: "var(--text-muted)",
        }}
      >
        <AlertCircle size={15} style={{ color: "var(--brand-primary)", flexShrink: 0 }} />
        <span>
          Persistencia transaccional de caja central vinculada a erp.cash_sessions y erp.cash_movements. Sin fondos ficticios ni simulación local.
        </span>
      </div>

      {/* View Tabs: Open Sessions vs Closure History */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className={`flow-select-pill ${viewTab === "active" ? "active" : ""}`}
            onClick={() => setViewTab("active")}
          >
            Turnos Activos ({openSessions.length})
          </button>
          <button
            type="button"
            className={`flow-select-pill ${viewTab === "history" ? "active" : ""}`}
            onClick={() => setViewTab("history")}
          >
            Historial de Arqueos ({closedSessions.length})
          </button>
        </div>

        <button
          type="button"
          className="btn-primary"
          onClick={() => setIsOpenModalOpen(true)}
        >
          <Plus size={16} /> Abrir Nueva Caja
        </button>
      </div>

      {loading ? (
        <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
          Cargando estado de cajas desde la base de datos central...
        </div>
      ) : viewTab === "active" ? (
        openSessions.length === 0 ? (
          <StatePanel
            type="empty"
            title="No hay sesiones de caja abiertas actualmente"
            message="Hacé click en 'Abrir Nueva Caja' para iniciar un turno de caja registrando el fondo inicial físico."
          />
        ) : (
          <div
            className="records-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
              gap: "16px",
            }}
          >
            {openSessions.map((session) => (
              <article key={session.fullId} className="flow-card" style={{ margin: 0, padding: "18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div className="flow-kpi-card__icon-box amber" style={{ width: "36px", height: "36px" }}>
                      <Wallet size={18} />
                    </div>
                    <div>
                      <strong style={{ fontSize: "14px" }}>Sesión #{session.id}</strong>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>
                        {session.registerName}
                      </span>
                    </div>
                  </div>

                  <span className="flow-status-pill completed">Turno Abierto</span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "10px",
                    padding: "12px",
                    background: "var(--canvas-bg)",
                    borderRadius: "10px",
                    marginBottom: "12px",
                  }}
                >
                  <div>
                    <span className="stat-label">Fondo Inicial</span>
                    <strong style={{ fontSize: "14px", display: "block" }}>
                      {formatCurrency(session.initialAmountArs, "ARS")}
                    </strong>
                  </div>
                  <div>
                    <span className="stat-label">Total en Caja</span>
                    <strong
                      style={{
                        fontSize: "14px",
                        display: "block",
                        color: "var(--emerald-success)",
                      }}
                    >
                      {formatCurrency(session.currentAmountArs, "ARS")}
                    </strong>
                  </div>
                </div>

                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "12px" }}>
                  <strong>Movimientos:</strong> {session.movements.length} transacciones registradas
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderTop: "1px solid var(--border-light)",
                    paddingTop: "12px",
                  }}
                >
                  <button
                    type="button"
                    className="flow-link-btn"
                    style={{ fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}
                    onClick={() => setMovementModalSession(session)}
                  >
                    <Receipt size={13} /> Ver Movimientos ({session.movements.length})
                  </button>

                  <button
                    type="button"
                    className="pag-btn"
                    style={{
                      color: "var(--rose-accent)",
                      borderColor: "var(--rose-border)",
                      fontSize: "11px",
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    onClick={() => openArqueoModal(session)}
                  >
                    <Lock size={12} /> Arqueo & Cierre
                  </button>
                </div>
              </article>
            ))}
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
          <div className="flow-card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="flow-table">
              <thead>
                <tr>
                  <th>Sesión / Caja</th>
                  <th>Apertura</th>
                  <th>Cierre & Arqueo</th>
                  <th>Esperado</th>
                  <th>Contado Físico</th>
                  <th>Diferencia Conciliada</th>
                  <th>Observaciones</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {closedSessions.map((session) => {
                  const diff = session.closure?.differenceAmount ?? 0;
                  const hasDiff = diff !== 0;

                  return (
                    <tr key={session.fullId}>
                      <td>
                        <strong>#{session.id}</strong>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{session.registerName}</div>
                      </td>
                      <td style={{ fontSize: "12px" }}>{session.openedAt}</td>
                      <td style={{ fontSize: "12px" }}>{session.closure?.closedAt || "—"}</td>
                      <td style={{ fontWeight: 600 }}>
                        {formatCurrency(session.closure?.expectedAmount ?? session.expectedAmountArs, "ARS")}
                      </td>
                      <td style={{ fontWeight: 700, color: "var(--brand-primary)" }}>
                        {formatCurrency(session.closure?.countedAmount ?? session.currentAmountArs, "ARS")}
                      </td>
                      <td>
                        <span
                          className={`flow-status-pill ${
                            diff === 0 ? "completed" : diff > 0 ? "pending" : "cancelled"
                          }`}
                          style={{ fontSize: "11px" }}
                        >
                          {diff === 0
                            ? "Cuadrada ($0)"
                            : diff > 0
                            ? `+${formatCurrency(diff, "ARS")}`
                            : formatCurrency(diff, "ARS")}
                        </span>
                      </td>
                      <td style={{ fontSize: "11px", color: "var(--text-muted)", maxWidth: "180px" }}>
                        {session.closure?.reason || session.notes}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="pag-btn"
                          style={{ fontSize: "11px" }}
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
        )
      )}

      {/* Modal: Open Session */}
      <Modal
        isOpen={isOpenModalOpen}
        onClose={() => setIsOpenModalOpen(false)}
        title="Apertura de Turno de Caja"
        subtitle="Registra el fondo inicial para iniciar operaciones en punto de venta"
        icon={Wallet}
        maxWidth="480px"
      >
        <form onSubmit={handleOpenSession} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {registers.length > 1 && (
            <div className="erp-form-group">
              <label className="erp-form-label">Caja Registradora *</label>
              <select
                value={selectedRegisterId}
                onChange={(e) => setSelectedRegisterId(e.target.value)}
                className="erp-form-input"
              >
                {registers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="erp-form-group">
            <label className="erp-form-label">Responsable / Operador *</label>
            <input
              type="text"
              required
              value={cashier}
              onChange={(e) => setCashier(e.target.value)}
              className="erp-form-input"
            />
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Fondo Inicial en Efectivo ($ ARS) *</label>
            <input
              type="number"
              required
              min="0"
              step="any"
              value={initialAmount}
              onChange={(e) => setInitialAmount(e.target.value)}
              className="erp-form-input"
            />
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Notas de Turno / Observaciones</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="erp-form-input"
            />
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "10px",
              marginTop: "8px",
              paddingTop: "12px",
              borderTop: "1px solid var(--border-line)",
            }}
          >
            <button
              type="button"
              className="pag-btn"
              onClick={() => setIsOpenModalOpen(false)}
              disabled={submittingOpen}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={submittingOpen}>
              {submittingOpen ? "Abriendo..." : "Abrir Turno"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Arqueo y Cierre de Caja (Finding 16) */}
      <Modal
        isOpen={isCloseModalOpen}
        onClose={() => {
          setIsCloseModalOpen(false);
          setSessionToClose(null);
        }}
        title="Arqueo y Cierre de Turno de Caja"
        subtitle={`Conciliación física de efectivo para la Sesión #${sessionToClose?.id}`}
        icon={Lock}
        maxWidth="520px"
      >
        {sessionToClose && (
          <form onSubmit={handleConfirmClose} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* System Breakdown */}
            <div
              style={{
                padding: "12px",
                background: "var(--canvas-bg)",
                borderRadius: "10px",
                border: "1px solid var(--border-light)",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "10px",
              }}
            >
              <div>
                <span className="stat-label">Fondo Inicial:</span>
                <strong>{formatCurrency(sessionToClose.initialAmountArs, "ARS")}</strong>
              </div>
              <div>
                <span className="stat-label">Movimientos (Ventas):</span>
                <strong>
                  {formatCurrency(sessionToClose.expectedAmountArs - sessionToClose.initialAmountArs, "ARS")}
                </strong>
              </div>
              <div style={{ gridColumn: "1 / -1", borderTop: "1px solid var(--border-line)", paddingTop: "8px" }}>
                <span className="stat-label">Total Teórico Esperado por Sistema:</span>
                <strong style={{ fontSize: "16px", color: "var(--brand-primary)" }}>
                  {formatCurrency(sessionToClose.expectedAmountArs, "ARS")}
                </strong>
              </div>
            </div>

            {/* Counted Physical Cash Input */}
            <div className="erp-form-group">
              <label className="erp-form-label">
                Efectivo Físico Contado en Caja ($ ARS) *
              </label>
              <input
                type="number"
                required
                min="0"
                step="any"
                value={countedAmountInput}
                onChange={(e) => setCountedAmountInput(e.target.value)}
                className="erp-form-input"
                style={{ fontSize: "16px", fontWeight: 700 }}
                placeholder="0"
                autoFocus
              />
            </div>

            {/* Live Difference Badge */}
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                background:
                  calculatedDifference === 0
                    ? "var(--emerald-soft)"
                    : calculatedDifference > 0
                    ? "rgba(59, 130, 246, 0.1)"
                    : "rgba(239, 68, 68, 0.1)",
                border: `1px solid ${
                  calculatedDifference === 0
                    ? "var(--emerald-border)"
                    : calculatedDifference > 0
                    ? "rgba(59, 130, 246, 0.3)"
                    : "rgba(239, 68, 68, 0.3)"
                }`,
              }}
            >
              {calculatedDifference === 0 ? (
                <CheckCircle2 size={18} style={{ color: "var(--emerald-success)", flexShrink: 0 }} />
              ) : (
                <AlertTriangle
                  size={18}
                  style={{
                    color: calculatedDifference > 0 ? "#3b82f6" : "var(--rose-accent)",
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ fontSize: "12px" }}>
                {calculatedDifference === 0 ? (
                  <strong style={{ color: "var(--emerald-success)" }}>
                    Caja cuadrada. El efectivo contado coincide con el sistema.
                  </strong>
                ) : calculatedDifference > 0 ? (
                  <span style={{ color: "#2563eb" }}>
                    <strong>Sobrante de caja: +{formatCurrency(calculatedDifference, "ARS")}.</strong> El dinero en mano supera el registro teórico.
                  </span>
                ) : (
                  <span style={{ color: "var(--rose-accent)" }}>
                    <strong>Faltante de caja: {formatCurrency(calculatedDifference, "ARS")}.</strong> Hay menos dinero en mano que el registro teórico.
                  </span>
                )}
              </div>
            </div>

            <div className="erp-form-group">
              <label className="erp-form-label">Motivo u Observaciones del Arqueo</label>
              <input
                type="text"
                value={closeReasonInput}
                onChange={(e) => setCloseReasonInput(e.target.value)}
                className="erp-form-input"
                placeholder="Observaciones de cierre..."
              />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                marginTop: "10px",
                paddingTop: "12px",
                borderTop: "1px solid var(--border-line)",
              }}
            >
              <button
                type="button"
                className="pag-btn"
                onClick={() => {
                  setIsCloseModalOpen(false);
                  setSessionToClose(null);
                }}
                disabled={submittingClose}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn-primary"
                style={{ background: "var(--rose-accent)", borderColor: "var(--rose-accent)" }}
                disabled={submittingClose}
              >
                {submittingClose ? "Arqueando..." : "Confirmar Arqueo y Cerrar"}
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
            <div
              style={{
                padding: "10px 14px",
                background: "var(--canvas-bg)",
                borderRadius: "8px",
                marginBottom: "12px",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <div>
                <span className="stat-label">Fondo Inicial:</span>
                <strong>{formatCurrency(movementModalSession.initialAmountArs, "ARS")}</strong>
              </div>
              <div>
                <span className="stat-label">Saldo Actual en Caja:</span>
                <strong style={{ color: "var(--emerald-success)" }}>
                  {formatCurrency(movementModalSession.currentAmountArs, "ARS")}
                </strong>
              </div>
            </div>

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
                      <th>Importe</th>
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
                            {mov.kind}
                          </span>
                        </td>
                        <td style={{ fontSize: "11px" }}>{mov.occurredAt}</td>
                        <td style={{ fontSize: "11px" }}>{mov.reason}</td>
                        <td
                          style={{
                            fontWeight: 700,
                            color: mov.amount >= 0 ? "var(--emerald-success)" : "var(--rose-accent)",
                          }}
                        >
                          {formatCurrency(mov.amount, "ARS")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "14px" }}>
              <button
                type="button"
                className="pag-btn"
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
