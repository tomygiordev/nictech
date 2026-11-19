import { useState, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle, PackageCheck } from "lucide-react";
import { Field, FormError } from "../../components/erp/FormFeedback";
import { Modal } from "../../components/erp/WorkspaceUi";
import { toUserMessage } from "../../lib/errors";
import { deliverRepairOrder, type RepairOrderOverview } from "./api";
import {
  buildWarrantyTerms,
  deliverySchema,
  type RepairDeliveryInput,
  type RepairDeliveryValues,
} from "./schemas";

type DeliveryOrder = Pick<
  RepairOrderOverview,
  "id" | "order_code" | "brand_snapshot" | "model_snapshot" | "customer_name"
>;

type Props = {
  isOpen: boolean;
  order?: DeliveryOrder;
  onClose: () => void;
  onDelivered: (recipientName: string, warrantyDays: number) => void;
};

const WARRANTY_DAY_OPTIONS = [
  { value: "30", label: "30 días" },
  { value: "60", label: "60 días" },
  { value: "90", label: "90 días (Estándar)" },
  { value: "180", label: "180 días (Semestral)" },
  { value: "365", label: "365 días (Anual)" },
];

export function RepairDeliveryModal({ isOpen, order, ...props }: Props) {
  if (!isOpen || !order) return null;

  return <RepairDeliveryForm key={order.id} order={order} {...props} />;
}

function RepairDeliveryForm({
  order,
  onClose,
  onDelivered,
}: Omit<Props, "isOpen" | "order"> & { order: DeliveryOrder }) {
  const [hasEditedTerms, setHasEditedTerms] = useState(false);
  const [termsDaysWarning, setTermsDaysWarning] = useState<number | null>(null);
  const {
    register,
    setValue,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RepairDeliveryInput, unknown, RepairDeliveryValues>({
    resolver: zodResolver(deliverySchema),
    defaultValues: {
      recipientName: "",
      documentSuffix: "",
      warrantyDays: "90",
      warrantyTerms: buildWarrantyTerms(90),
    },
  });

  const handleWarrantyDaysChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextDays = Number(event.target.value);
    if (!Number.isInteger(nextDays) || nextDays < 0) return;

    if (!hasEditedTerms) {
      setValue("warrantyTerms", buildWarrantyTerms(nextDays), { shouldValidate: true });
      setTermsDaysWarning(null);
      return;
    }

    setTermsDaysWarning(nextDays);
  };

  const handleWarrantyTermsChange = () => {
    setHasEditedTerms(true);
    setTermsDaysWarning(null);
  };

  const submit = handleSubmit(async (values) => {
    try {
      await deliverRepairOrder(
        order.id,
        values.recipientName,
        values.documentSuffix,
        values.warrantyDays,
        values.warrantyTerms,
      );
    } catch (error) {
      setError("root.server", {
        message: toUserMessage(error, "No se pudo registrar la entrega. Reintentá."),
      });
      return;
    }
    onClose();
    onDelivered(values.recipientName, values.warrantyDays);
  });

  const requestClose = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Modal isOpen onClose={requestClose} title={`Entrega formal de equipo: ${order.order_code}`} icon={PackageCheck} maxWidth="560px" scrollBody>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={isSubmitting} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ padding: "12px", background: "rgba(16, 185, 129, 0.1)", borderRadius: "8px", border: "1px solid rgba(16, 185, 129, 0.3)" }}>
            <div style={{ fontWeight: 600, color: "var(--emerald-text)", fontSize: "13px" }}>Acreditación de retiro</div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
              Dispositivo: <strong>{order.brand_snapshot} {order.model_snapshot}</strong> · Titular: <strong>{order.customer_name}</strong>
            </div>
          </div>

          <Field label="Nombre del receptor" required error={errors.recipientName?.message}>
            {(a11y) => (
              <input
                {...a11y}
                {...register("recipientName")}
                type="text"
                className="erp-form-input"
                placeholder="Nombre y apellido de quien retira"
                required
              />
            )}
          </Field>

          <Field
            label="Terminación DNI"
            error={errors.documentSuffix?.message}
            hint="Opcional. Hasta 8 letras o números."
          >
            {(a11y) => (
              <input
                {...a11y}
                {...register("documentSuffix")}
                type="text"
                maxLength={8}
                className="erp-form-input"
              />
            )}
          </Field>

          <Field label="Días de garantía" required error={errors.warrantyDays?.message}>
            {(a11y) => (
              <select
                {...a11y}
                {...register("warrantyDays", { onChange: handleWarrantyDaysChange })}
                className="erp-form-input"
                required
              >
                {WARRANTY_DAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Términos de la póliza" required error={errors.warrantyTerms?.message}>
            {(a11y) => (
              <textarea
                {...a11y}
                {...register("warrantyTerms", { onChange: handleWarrantyTermsChange })}
                className="erp-form-input"
                rows={2}
                required
              />
            )}
          </Field>

          {termsDaysWarning !== null && (
            <div
              role="status"
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid var(--amber-accent)",
                background: "var(--amber-soft)",
                color: "var(--amber-accent)",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              Revisá que los términos coincidan con {termsDaysWarning} días
            </div>
          )}

          <FormError message={errors.root?.server?.message ?? null} />

          <div className="erp-modal-footer">
            <button type="button" className="btn-secondary" onClick={requestClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting}
            >
              <CheckCircle size={16} />
              {isSubmitting ? "Registrando entrega…" : "Confirmar entrega y póliza"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
