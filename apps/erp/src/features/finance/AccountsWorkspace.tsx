import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useErpAuth } from "../../auth/ErpAuthContext";
import {
  createFinancingContract,
  listFinancingContracts,
  recordReceivablePayment,
} from "./api";
import { financingSchema, receivablePaymentSchema, type FinancingInput, type ReceivablePaymentInput } from "./schemas";

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
    return <div className="module-state">No tenés permiso para ver cuentas corrientes.</div>;
  }
  if (contractsQuery.isLoading) return <div className="module-state">Cargando cuentas corrientes…</div>;
  if (contractsQuery.error) return <div className="module-state">Error al cargar cuentas: {contractsQuery.error.message}</div>;

  const contracts = contractsQuery.data ?? [];
  return (
    <div className="finance-workspace">
      <div className="section-heading">
        <div><h2>Cuentas corrientes</h2><p>Financiaciones, cuotas y cobros parciales.</p></div>
        <span>{contracts.length} contratos</span>
      </div>
      {contracts.length === 0 ? (
        <div className="empty-ledger"><strong>No hay financiaciones registradas todavía.</strong><p>Creá la primera cuenta corriente desde el formulario.</p></div>
      ) : (
        <div className="finance-list">
          {contracts.map((contract) => (
            <article className="finance-card" key={contract.id}>
              <div><strong>{contract.contract_reference ?? contract.id.slice(0, 8)}</strong><span>{contract.status} · {contract.currency_code}</span></div>
              <dl><div><dt>Principal</dt><dd>{contract.principal_amount}</dd></div><div><dt>Saldo financiado</dt><dd>{contract.financed_amount}</dd></div><div><dt>Cuotas</dt><dd>{contract.installment_count}</dd></div></dl>
              {contract.financing_installments?.length ? <ol>{contract.financing_installments.map((installment) => <li key={installment.id}>{installment.installment_number}. {installment.due_date} — {installment.status}</li>)}</ol> : null}
            </article>
          ))}
        </div>
      )}
      {hasPermission("accounts_receivable.manage") && (
        <div className="finance-forms">
          <form onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}>
            <h3>Nueva financiación</h3>
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
            <button type="submit" disabled={createMutation.isPending}>Crear financiación</button>
          </form>
          <form onSubmit={paymentForm.handleSubmit((values) => paymentMutation.mutate(values))}>
            <h3>Registrar cobro parcial</h3>
            <input placeholder="Sucursal UUID" {...paymentForm.register("branchId")} />
            <input placeholder="Contrato UUID" {...paymentForm.register("contractId")} />
            <input placeholder="Importe" {...paymentForm.register("amount")} />
            <input placeholder="Clave idempotencia" {...paymentForm.register("operationKey")} />
            <input placeholder="Motivo" {...paymentForm.register("reason")} />
            <button type="submit" disabled={paymentMutation.isPending}>Registrar cobro</button>
          </form>
        </div>
      )}
      {createMutation.error ? <p role="alert">{createMutation.error.message}</p> : null}
      {paymentMutation.error ? <p role="alert">{paymentMutation.error.message}</p> : null}
    </div>
  );
};
