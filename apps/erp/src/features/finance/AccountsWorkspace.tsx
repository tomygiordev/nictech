import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleDollarSign, PlusCircle, CreditCard, Users, Clock, AlertCircle } from "lucide-react";
import { useErpAuth } from "../../auth/ErpAuthContext";
import {
  createFinancingContract,
  listFinancingContracts,
  recordReceivablePayment,
} from "./api";
import { financingSchema, receivablePaymentSchema, type FinancingInput, type ReceivablePaymentInput } from "./schemas";
import { StatePanel, WorkspaceHeader, FeedbackAlert, KpiCard } from "../../components/erp/WorkspaceUi";
import { formatCurrency, formatDate, generateIdempotencyKey } from "../../lib/formatters";

const BRANCH_OPTIONS = [
  { id: "dev-branch-0000", name: "Sucursal Central (Belgrano)" },
  { id: "dev-branch-0001", name: "Depósito Central" },
];

export const AccountsWorkspace = () => {
  const { hasPermission } = useErpAuth();
  const queryClient = useQueryClient();
  const contractsQuery = useQuery({ queryKey: ["erp", "finance", "contracts"], queryFn: listFinancingContracts });
  const [feedback, setFeedback] = useState<string | null>(null);

  const createForm = useForm<FinancingInput>({
    resolver: zodResolver(financingSchema),
    defaultValues: {
      branchId: "dev-branch-0000",
      customerId: "dev-cust-0001",
      currency: "ARS",
      principal: "250000",
      downPayment: "50000",
      interestRate: "0.05",
      installmentsCount: 3,
      firstDue: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      operationKey: generateIdempotencyKey("fin"),
      reason: "Financiación de equipo en cuotas fijas",
    },
  });

  const paymentForm = useForm<ReceivablePaymentInput>({
    resolver: zodResolver(receivablePaymentSchema),
    defaultValues: {
      branchId: "dev-branch-0000",
      contractId: "",
      amount: "50000",
      operationKey: generateIdempotencyKey("pay"),
      reason: "Cobro de cuota presencial en mostrador",
    },
  });

  const createMutation = useMutation({
    mutationFn: createFinancingContract,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["erp", "finance", "contracts"] });
      createForm.reset({
        ...createForm.getValues(),
        operationKey: generateIdempotencyKey("fin"),
      });
      setFeedback("¡Financiación creada y cuotas calculadas con éxito!");
    },
  });

  const paymentMutation = useMutation({
    mutationFn: recordReceivablePayment,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["erp", "finance", "contracts"] });
      paymentForm.reset({
        ...paymentForm.getValues(),
        operationKey: generateIdempotencyKey("pay"),
      });
      setFeedback("¡Cobro parcial registrado y saldo actualizado!");
    },
  });

  if (!hasPermission("accounts_receivable.view")) {
    return <div className="state-panel state-panel--error">No tenés permiso para ver cuentas corrientes.</div>;
  }

  const contracts = contractsQuery.data ?? [];
  const totalPrincipal = contracts.reduce((acc, c) => acc + Number(c.principal_amount || 0), 0);
  const totalFinanced = contracts.reduce((acc, c) => acc + Number(c.financed_amount || 0), 0);

  const openPaymentForContract = (contractId: string) => {
    paymentForm.setValue("contractId", contractId);
    paymentForm.setValue("operationKey", generateIdempotencyKey("pay"));
  };

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Cuentas Corrientes & Financiaciones"
        description="Planes de pago en cuotas, intereses pactados, seguimiento de vencimientos y cobros parciales."
        badge={`${contracts.length} Contratos Activos`}
      />

      {feedback && (
        <FeedbackAlert
          type="success"
          message={feedback}
          onClose={() => setFeedback(null)}
        />
      )}

      {/* KPI Summary */}
      <div className="kpi-grid">
        <KpiCard
          icon={Users}
          iconVariant="green"
          label="Contratos Vigentes"
          value={contracts.length}
          sublabel="Planes de financiación en curso"
        />

        <KpiCard
          icon={CircleDollarSign}
          iconVariant="navy"
          label="Total Financiado"
          value={formatCurrency(totalFinanced, "ARS")}
          sublabel="Monto pactado en cuotas"
        />

        <KpiCard
          icon={CreditCard}
          iconVariant="steel"
          label="Capital Prestado"
          value={formatCurrency(totalPrincipal, "ARS")}
          sublabel="Principal inicial"
        />

        <KpiCard
          icon={Clock}
          iconVariant="dark"
          label="Tasa Promedio Mensual"
          value="5.0% TNA/TEM"
          sublabel="Interés pactado de financiación"
        />
      </div>

      {contractsQuery.isLoading ? (
        <StatePanel type="loading" message="Cargando cuentas corrientes…" />
      ) : contractsQuery.error ? (
        <StatePanel type="error" title="Error al cargar cuentas" message={contractsQuery.error.message} />
      ) : contracts.length === 0 ? (
        <StatePanel
          type="empty"
          title="Sin contratos registrados"
          message="No hay financiaciones registradas todavía."
        />
      ) : (
        <div className="records-grid">
          {contracts.map((contract) => (
            <article className="record-card flow-card" key={contract.id}>
              <div className="record-card__header">
                <div>
                  <strong style={{ fontSize: "15px" }}>{contract.contract_reference ?? contract.id.slice(0, 8)}</strong>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>
                    Cliente #{contract.customer_id ? contract.customer_id.slice(0, 8) : "General"}
                  </span>
                </div>
                <span className="flow-status-pill completed">{contract.status} · {contract.currency_code}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", padding: "12px", background: "var(--canvas-bg)", borderRadius: "10px", margin: "12px 0" }}>
                <div>
                  <span className="stat-label">Principal</span>
                  <strong style={{ fontSize: "13px", display: "block" }}>{formatCurrency(Number(contract.principal_amount), "ARS")}</strong>
                </div>
                <div>
                  <span className="stat-label">Financiado</span>
                  <strong style={{ fontSize: "13px", display: "block", color: "var(--brand-primary)" }}>
                    {formatCurrency(Number(contract.financed_amount), "ARS")}
                  </strong>
                </div>
                <div>
                  <span className="stat-label">Cuotas</span>
                  <strong style={{ fontSize: "13px", display: "block" }}>{contract.installment_count}</strong>
                </div>
              </div>

              {contract.financing_installments?.length ? (
                <ol className="installments-mini-list" style={{ listStyle: "none", padding: 0, margin: "0 0 14px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {contract.financing_installments.map((installment) => (
                    <li
                      key={installment.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "6px 10px",
                        background: "var(--surface-subtle)",
                        borderRadius: "6px",
                        fontSize: "12px",
                      }}
                    >
                      <span>
                        <strong>Cuota {installment.installment_number}</strong> — Vence: {formatDate(installment.due_date)}
                      </span>
                      <span className={`type-badge ${installment.status === "paid" ? "green" : "orange"}`} style={{ fontSize: "10px" }}>
                        {installment.status === "paid" ? "Pagada" : "Pendiente"}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}

              {hasPermission("accounts_receivable.manage") && (
                <div style={{ borderTop: "1px solid var(--border-light)", paddingTop: "10px", display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="pag-btn"
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--brand-primary)", borderColor: "var(--brand-border)" }}
                    onClick={() => openPaymentForContract(contract.id)}
                  >
                    <CreditCard size={13} /> Registrar Cobro Parcial
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {hasPermission("accounts_receivable.manage") && (
        <div className="forms-2col-grid">
          {/* Form: Crear Financiación */}
          <div className="flow-card" style={{ margin: 0 }}>
            <div className="flow-card__header">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <PlusCircle size={18} color="var(--brand-primary)" />
                <h3 className="flow-card__title" style={{ margin: 0 }}>Crear nueva financiación</h3>
              </div>
            </div>

            <form onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div className="erp-form-group" style={{ marginBottom: "6px" }}>
                  <label className="erp-form-label">Sucursal</label>
                  <select className="erp-form-select" {...createForm.register("branchId")}>
                    {BRANCH_OPTIONS.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div className="erp-form-group" style={{ marginBottom: "6px" }}>
                  <label className="erp-form-label">Moneda</label>
                  <input className="erp-form-input" placeholder="Moneda (ARS/USD)" {...createForm.register("currency")} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                <div className="erp-form-group" style={{ marginBottom: "6px" }}>
                  <label className="erp-form-label">Monto Principal ($)</label>
                  <input className="erp-form-input" type="number" placeholder="250000" {...createForm.register("principal")} />
                </div>
                <div className="erp-form-group" style={{ marginBottom: "6px" }}>
                  <label className="erp-form-label">Anticipo ($)</label>
                  <input className="erp-form-input" type="number" placeholder="50000" {...createForm.register("downPayment")} />
                </div>
                <div className="erp-form-group" style={{ marginBottom: "6px" }}>
                  <label className="erp-form-label">Interés Mensual</label>
                  <input className="erp-form-input" placeholder="Interés mensual" {...createForm.register("interestRate")} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div className="erp-form-group" style={{ marginBottom: "6px" }}>
                  <label className="erp-form-label">Cantidad Cuotas</label>
                  <input className="erp-form-input" type="number" min="1" max="24" {...createForm.register("installmentsCount", { valueAsNumber: true })} />
                </div>
                <div className="erp-form-group" style={{ marginBottom: "6px" }}>
                  <label className="erp-form-label">Primer Vencimiento</label>
                  <input className="erp-form-input" type="date" {...createForm.register("firstDue")} />
                </div>
              </div>

              <div className="erp-form-group" style={{ marginBottom: "6px" }}>
                <label className="erp-form-label">Motivo / Concepto del Plan</label>
                <input className="erp-form-input" placeholder="Financiación de equipo en cuotas fijas" {...createForm.register("reason")} />
              </div>

              {createMutation.error ? (
                <div className="form-error-alert" role="alert" style={{ color: "var(--rose-accent)", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <AlertCircle size={14} /> {createMutation.error.message}
                </div>
              ) : null}

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
                <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Generando Plan…" : "Crear financiación"}
                </button>
              </div>
            </form>
          </div>

          {/* Form: Registrar Cobro Parcial */}
          <div className="flow-card" style={{ margin: 0 }}>
            <div className="flow-card__header">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <CreditCard size={18} color="var(--emerald-success)" />
                <h3 className="flow-card__title" style={{ margin: 0 }}>Registrar cobro parcial</h3>
              </div>
            </div>

            <form onSubmit={paymentForm.handleSubmit((values) => paymentMutation.mutate(values))} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="erp-form-group">
                <label className="erp-form-label">Contrato de Financiación *</label>
                <select className="erp-form-select" {...paymentForm.register("contractId")}>
                  <option value="">Seleccioná un contrato</option>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.contract_reference || c.id.slice(0, 8)} — Financiado: {formatCurrency(Number(c.financed_amount), "ARS")}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div className="erp-form-group">
                  <label className="erp-form-label">Importe a Cobrar ($)</label>
                  <input className="erp-form-input" type="number" placeholder="50000" {...paymentForm.register("amount")} />
                </div>
                <div className="erp-form-group">
                  <label className="erp-form-label">Sucursal de Cobro</label>
                  <select className="erp-form-select" {...paymentForm.register("branchId")}>
                    {BRANCH_OPTIONS.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="erp-form-group">
                <label className="erp-form-label">Concepto / Comprobante de Cobro</label>
                <input className="erp-form-input" placeholder="Cobro cuota 1 en efectivo" {...paymentForm.register("reason")} />
              </div>

              {paymentMutation.error ? (
                <div className="form-error-alert" role="alert" style={{ color: "var(--rose-accent)", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <AlertCircle size={14} /> {paymentMutation.error.message}
                </div>
              ) : null}

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
                <button type="submit" className="btn-primary" disabled={paymentMutation.isPending}>
                  {paymentMutation.isPending ? "Registrando…" : "Registrar cobro"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
