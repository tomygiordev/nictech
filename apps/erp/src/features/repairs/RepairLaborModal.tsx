import { useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Hammer } from "lucide-react";
import { Field, FormError } from "../../components/erp/FormFeedback";
import { Modal } from "../../components/erp/WorkspaceUi";
import { recordRepairLabor } from "./api";
import {
  laborSchema,
  resolveIdempotentRepairError,
  type RepairLaborInput,
  type RepairLaborValues,
} from "./schemas";

type Props = {
  isOpen: boolean;
  orderId?: string;
  onClose: () => void;
  onRecorded: () => void;
};

export function RepairLaborModal({ isOpen, orderId, ...props }: Props) {
  const laborOperationKeys = useRef(new Map<string, string>());
  if (!isOpen || !orderId) return null;

  return <RepairLaborForm key={orderId} orderId={orderId} operationKeys={laborOperationKeys.current} {...props} />;
}

function RepairLaborForm({
  orderId,
  operationKeys,
  onClose,
  onRecorded,
}: Pick<Props, "onClose" | "onRecorded"> & { orderId: string; operationKeys: Map<string, string> }) {
  const {
    register, watch, setValue, handleSubmit, setError, formState: { errors, isSubmitting },
  } = useForm<RepairLaborInput, unknown, RepairLaborValues>({
    resolver: zodResolver(laborSchema),
    defaultValues: { description: "", hours: "", unitCost: "", confirmZeroCost: false },
  });
  const unitCost = watch("unitCost");
  const isZeroCost = unitCost.trim() !== "" && Number(unitCost) === 0;

  const submit = handleSubmit(async (values) => {
    try {
      const laborOperationKey = operationKeys.get(orderId) ?? `repair-labor-${crypto.randomUUID()}`;
      operationKeys.set(orderId, laborOperationKey);
      await recordRepairLabor(orderId, values.description, values.hours, values.unitCost, laborOperationKey);
      operationKeys.delete(orderId);
    } catch (error) {
      setError("root.server", {
        message: resolveIdempotentRepairError(
          error,
          "No se pudo registrar la mano de obra. Reintentá.",
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
    <Modal isOpen onClose={requestClose} title="Registrar mano de obra" icon={Hammer} scrollBody>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={isSubmitting} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <Field label="Trabajo realizado" required error={errors.description?.message}>
            {(a11y) => <input {...a11y} {...register("description")} className="erp-form-input" required />}
          </Field>
          <Field label="Horas" required error={errors.hours?.message}>
            {(a11y) => <input {...a11y} {...register("hours")} className="erp-form-input" type="number" step="0.01" min="0.01" required />}
          </Field>
          <Field label="Costo por hora en moneda base" required error={errors.unitCost?.message}>
            {(a11y) => (
              <input
                {...a11y}
                {...register("unitCost", {
                  deps: ["confirmZeroCost"],
                  onChange: () => setValue("confirmZeroCost", false),
                })}
                className="erp-form-input"
                type="number"
                step="0.01"
                min="0"
                required
              />
            )}
          </Field>
          {isZeroCost && (
            <Field label="Confirmo costo cero" error={errors.confirmZeroCost?.message}>
              {(a11y) => <input {...a11y} {...register("confirmZeroCost")} type="checkbox" />}
            </Field>
          )}
          <FormError message={errors.root?.server?.message ?? null} />
          <div className="erp-modal-footer">
            <button type="button" className="btn-secondary" onClick={requestClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Registrando trabajo…" : "Registrar trabajo"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
