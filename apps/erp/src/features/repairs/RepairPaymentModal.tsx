import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Field, FormError } from "../../components/erp/FormFeedback";
import { Modal } from "../../components/erp/WorkspaceUi";
import { formatDateTime } from "../../lib/formatters";
import { toUserMessage } from "../../lib/errors";
import { listOpenCashSessions } from "../cash/api";
import {
  listRepairExchangeSnapshots,
  listRepairPaymentMethods,
  recordRepairPayment,
  type RepairExchangeSnapshot,
  type RepairPaymentMethod,
} from "./api";
import {
  createRepairPaymentSchema,
  resolveIdempotentRepairError,
  type RepairPaymentInput,
  type RepairPaymentValues,
} from "./schemas";

type Props = {
  isOpen: boolean;
  orderId?: string;
  branchId?: string;
  onClose: () => void;
  onRecorded: () => void;
};

type PaymentOptions = {
  methods: RepairPaymentMethod[];
  snapshots: RepairExchangeSnapshot[];
  sessions: Array<{ id: string }>;
};

export function RepairPaymentModal({ isOpen, orderId, branchId, ...props }: Props) {
  const paymentOperationKeys = useRef(new Map<string, string>());
  if (!isOpen || !orderId || !branchId) return null;

  return <RepairPaymentForm key={orderId} orderId={orderId} branchId={branchId} operationKeys={paymentOperationKeys.current} {...props} />;
}

function RepairPaymentForm({
  orderId,
  branchId,
  operationKeys,
  onClose,
  onRecorded,
}: Pick<Props, "onClose" | "onRecorded"> & { orderId: string; branchId: string; operationKeys: Map<string, string> }) {
  const [options, setOptions] = useState<PaymentOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const schema = useMemo(
    () => createRepairPaymentSchema(options?.methods ?? [], options?.snapshots ?? [], options?.sessions ?? []),
    [options],
  );
  const {
    register, watch, resetField, handleSubmit, setError, formState: { errors, isSubmitting },
  } = useForm<RepairPaymentInput, unknown, RepairPaymentValues>({
    resolver: zodResolver(schema),
    defaultValues: { paymentMethodId: "", amount: "", currency: "", exchangeSnapshotId: "", cashSessionId: "", reason: "" },
  });

  useEffect(() => {
    let active = true;
    void Promise.all([listRepairPaymentMethods(), listRepairExchangeSnapshots(), listOpenCashSessions()])
      .then(([methods, snapshots, sessions]) => {
        if (active) setOptions({ methods, snapshots, sessions: sessions.filter((session) => session.branch_id === branchId) });
      })
      .catch((error: unknown) => {
        if (active) setLoadError(toUserMessage(error, "No se pudo preparar el cobro. Cerrá el formulario y volvé a abrirlo."));
      });
    return () => { active = false; };
  }, [branchId]);

  const currency = watch("currency");
  const paymentMethodId = watch("paymentMethodId");
  const requiresCashSession = options?.methods.some((method) => method.id === paymentMethodId && method.requires_cash_session);
  const currencies = Array.from(new Set(options?.snapshots.map((snapshot) => snapshot.quote_currency)));
  const snapshots = options?.snapshots.filter((snapshot) => snapshot.quote_currency === currency) ?? [];

  const submit = handleSubmit(async (values) => {
    if (!options) return;
    const method = options.methods.find((candidate) => candidate.id === values.paymentMethodId);
    try {
      const paymentOperationKey = operationKeys.get(orderId) ?? `repair-payment-${crypto.randomUUID()}`;
      operationKeys.set(orderId, paymentOperationKey);
      await recordRepairPayment({
        repairOrderId: orderId,
        paymentMethodId: values.paymentMethodId,
        cashSessionId: method?.requires_cash_session ? values.cashSessionId : null,
        amount: values.amount,
        currency: values.currency,
        exchangeSnapshotId: values.exchangeSnapshotId,
        operationKey: paymentOperationKey,
        reason: values.reason,
      });
      operationKeys.delete(orderId);
    } catch (error) {
      setError("root.server", {
        message: resolveIdempotentRepairError(
          error,
          "No se pudo registrar el cobro. Reintentá.",
          operationKeys,
          orderId,
        ),
      });
      return;
    }
    onClose();
    onRecorded();
  });

  const requestClose = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Modal isOpen onClose={requestClose} title="Cobro o seña de reparación" scrollBody>
      {!options ? (
        loadError ? <FormError message={loadError} /> : <p role="status">Cargando medios de pago, cotizaciones y cajas…</p>
      ) : (
        <form onSubmit={submit} noValidate>
          <fieldset disabled={isSubmitting} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <Field label="Medio de pago" required error={errors.paymentMethodId?.message} hint={!options.methods.length ? "No hay medios de pago activos." : undefined}>
              {(a11y) => (
                <select {...a11y} {...register("paymentMethodId", { onChange: () => resetField("cashSessionId") })} className="erp-form-input" required>
                  <option value="">Elegí un medio de pago…</option>
                  {options.methods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                </select>
              )}
            </Field>
            <Field label="Moneda" required error={errors.currency?.message} hint={!currencies.length ? "No hay cotizaciones registradas." : undefined}>
              {(a11y) => (
                <select {...a11y} {...register("currency", { onChange: () => resetField("exchangeSnapshotId") })} className="erp-form-input" required>
                  <option value="">Elegí la moneda…</option>
                  {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
                </select>
              )}
            </Field>
            <Field label="Cotización" required error={errors.exchangeSnapshotId?.message}>
              {(a11y) => (
                <select {...a11y} {...register("exchangeSnapshotId")} className="erp-form-input" required>
                  <option value="">{currency ? "Elegí una cotización…" : "Elegí la moneda primero"}</option>
                  {snapshots.map((snapshot) => (
                    <option key={snapshot.id} value={snapshot.id}>{snapshot.rate_to_base} · {snapshot.source} · {formatDateTime(snapshot.quoted_at)}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Importe" required error={errors.amount?.message}>
              {(a11y) => <input {...a11y} {...register("amount")} className="erp-form-input" type="number" step="0.01" min="0.01" required />}
            </Field>
            {requiresCashSession && (
              <Field label="Caja abierta" required error={errors.cashSessionId?.message} hint={!options.sessions.length ? "No hay cajas abiertas en la sucursal de la reparación." : undefined}>
                {(a11y) => (
                  <select {...a11y} {...register("cashSessionId")} className="erp-form-input" required>
                    <option value="">Elegí una caja abierta…</option>
                    {options.sessions.map((session) => <option key={session.id} value={session.id}>{session.id}</option>)}
                  </select>
                )}
              </Field>
            )}
            <Field label="Motivo del cobro" required error={errors.reason?.message}>
              {(a11y) => <input {...a11y} {...register("reason")} className="erp-form-input" required />}
            </Field>
            <FormError message={errors.root?.server?.message ?? null} />
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
              <button type="button" className="btn-ghost" onClick={requestClose}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={isSubmitting}>
                {isSubmitting ? "Registrando cobro…" : "Registrar cobro"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
