import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleDollarSign, PlusCircle, CreditCard, AlertCircle } from "lucide-react";
import { useErpAuth } from "../../auth/ErpAuthContext";
import {
  createFinancingContract,
  listFinancingContracts,
  recordReceivablePayment,
} from "./api";
import { financingSchema, receivablePaymentSchema, type FinancingInput, type ReceivablePaymentInput } from "./schemas";
import { StatePanel, WorkspaceHeader } from "../../components/erp/WorkspaceUi";

export const AccountsWorkspace = () => {
  const { hasPermission } = useErpAuth();
  const queryClient = useQueryClient();
  const contractsQuery = useQuery({ queryKey: ["erp", "finance", "contracts"], queryFn: listFinancingContracts });
  const createForm = useForm<FinancingInput>({ resolver: zodResolver(financingSchema) });
  const paymentForm = useForm<ReceivablePaymentInput>({ resolver: zodResolver(receivablePaymentSchema) });

  const createMutation = useMutation({
    mutationFn: createFinancingContract,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["erp", "finance", "contracts"] });
      createForm.reset();
    },
  });

  const paymentMutation = useMutation({
    mutationFn: recordReceivablePayment,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["erp", "finance", "contracts"] });
      paymentForm.reset();
    },
  });

  if (!hasPermission("accounts_receivable.view")) {
    return <div className="state-panel state-panel--error">No tenés permiso para ver cuentas corrientes.</div>;
  }
  if (contractsQuery.isLoading) return <StatePanel type="loading" message="Cargando cuentas corrientes…" />;
  if (contractsQuery.error) return <StatePanel type="error" title="Error al cargar cuentas" message={contractsQuery.error.message} />;

  const contracts = contractsQuery.data ?? [];

  return (
    <div>
      <WorkspaceHeader
        title="Cuentas Corrientes & Financiaciones"
        description="Planes de pago en cuotas, intereses pactados y cobros parciales a clientes."
        badge={`${contracts.length} Contratos`}
      />

      {contracts.length === 0 ? (
        <StatePanel
          type="empty"
          title="Sin contratos registrados"
          message="No hay financiaciones registradas todavía."
        />
      ) : (
        <div className="records-grid">
          {contracts.map((contract) => (
            <article className="record-card" key={contract.id}>
              <div className="record-card__header">
                <strong>{contract.contract_reference ?? contract.id.slice(0, 8)}</strong>
                <span className="status-pill status-pill--mint">{contract.status} · {contract.currency_code}</span>
              </div>
              <dl className="record-card__metrics">
                <div>
                  <dt>Principal</dt>
                  <dd>${contract.principal_amount}</dd>
                </div>
                <div>
                  <dt>Financiado</dt>
                  <dd>${contract.financed_amount}</dd>
                </div>
                <div>
                  <dt>Cuotas</dt>
                  <dd>{contract.installment_count}</dd>
                </div>
              </dl>
              {contract.financing_installments?.length ? (
                <ol className="installments-mini-list">
                  {contract.financing_installments.map((installment) => (
                    <li key={installment.id}>
                      <span>Cuota {installment.installment_number} ({installment.due_date})</span>
                      <span className="status-pill status-pill--mint">{installment.status}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {hasPermission("accounts_receivable.manage") && (
        <div className="forms-grid">
          {/* Nueva Financiación */}
          <form className="erp-form" onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}>
            <div className="form-header">
              <PlusCircle size={18} color="#16a34a" />
              <h3>Nueva financiación</h3>
            </div>
            <div className="form-fields-grid">
              <input placeholder="Sucursal UUID" {...createForm.register("branchId")} />
              <input placeholder="Cliente UUID" {...createForm.register("customerId")} />
              <input placeholder="Moneda (ARS/USD)" defaultValue="ARS" {...createForm.register("currency")} />
              <input placeholder="Principal" {...createForm.register("principal")} />
              <input placeholder="Anticipo" {...createForm.register("downPayment")} />
              <input placeholder="Interés mensual" {...createForm.register("interestRate")} />
              <input placeholder="Cuotas" type="number" {...createForm.register("installmentsCount")} />
              <input placeholder="Primero vence (AAAA-MM-DD)" {...createForm.register("firstDue")} />
              <input placeholder="Clave idempotencia" {...createForm.register("operationKey")} />
              <input placeholder="Motivo" {...createForm.register("reason")} />
            </div>
            <button className="btn-primary-form" type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Procesando..." : "Crear financiación"}
            </button>
            {createMutation.error ? (
              <div className="form-error-alert" role="alert">
                <AlertCircle size={14} /> {createMutation.error.message}
              </div>
            ) : null}
          </form>

          {/* Cobro Parcial */}
          <form className="erp-form" onSubmit={paymentForm.handleSubmit((values) => paymentMutation.mutate(values))}>
            <div className="form-header">
              <CreditCard size={18} color="#16a34a" />
              <h3>Registrar cobro parcial</h3>
            </div>
            <div className="form-fields-grid">
              <input placeholder="Sucursal UUID" {...paymentForm.register("branchId")} />
              <input placeholder="Contrato UUID" {...paymentForm.register("contractId")} />
              <input placeholder="Importe" {...paymentForm.register("amount")} />
              <input placeholder="Clave idempotencia" {...paymentForm.register("operationKey")} />
              <input placeholder="Motivo" {...paymentForm.register("reason")} />
            </div>
            <button className="btn-primary-form" type="submit" disabled={paymentMutation.isPending}>
              {paymentMutation.isPending ? "Procesando..." : "Registrar cobro"}
            </button>
            {paymentMutation.error ? (
              <div className="form-error-alert" role="alert">
                <AlertCircle size={14} /> {paymentMutation.error.message}
              </div>
            ) : null}
          </form>
        </div>
      )}
    </div>
  );
};
