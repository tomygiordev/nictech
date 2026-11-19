import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldAlert } from "lucide-react";
import { Field, FormError } from "../../components/erp/FormFeedback";
import { Modal } from "../../components/erp/WorkspaceUi";
import { toUserMessage } from "../../lib/errors";
import { formatDate } from "../../lib/formatters";
import { openWarrantyClaim, type WarrantyRecord } from "./api";
import { warrantyClaimSchema, type RepairWarrantyClaimInput } from "./schemas";

type Props = {
  isOpen: boolean;
  warranties: ReadonlyArray<WarrantyRecord>;
  onClose: () => void;
  onCreated: (claimId: string) => void;
};

export function RepairWarrantyClaimModal({ isOpen, warranties, onClose, onCreated }: Props) {
  if (!isOpen) return null;

  return <RepairWarrantyClaimForm warranties={warranties} onClose={onClose} onCreated={onCreated} />;
}

function RepairWarrantyClaimForm({
  warranties,
  onClose,
  onCreated,
}: Omit<Props, "isOpen">) {
  const activeWarranties = warranties.filter((w) => w.is_active);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RepairWarrantyClaimInput>({
    resolver: zodResolver(warrantyClaimSchema),
    defaultValues: { warrantyId: "", reportedIssue: "" },
  });

  const submit = handleSubmit(async (values) => {
    let claimId: string;
    try {
      claimId = await openWarrantyClaim(values.warrantyId, values.reportedIssue);
    } catch (error) {
      setError("root.server", {
        message: toUserMessage(error, "No se pudo registrar el reclamo de garantía. Reintentá."),
      });
      return;
    }
    onClose();
    onCreated(claimId);
  });

  const requestClose = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Modal isOpen onClose={requestClose} title="Apertura de reclamo de garantía" icon={ShieldAlert} maxWidth="560px" scrollBody>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={isSubmitting} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
          <Field
            label="Póliza vigente"
            required
            error={errors.warrantyId?.message}
            hint={!activeWarranties.length ? "No hay pólizas de garantía vigentes." : undefined}
          >
            {(a11y) => (
              <select {...a11y} {...register("warrantyId")} className="erp-form-input" required>
                <option value="">Elegí una póliza vigente…</option>
                {activeWarranties.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.order_code} — {w.customer_name} ({w.equipment_model}) | Hasta {formatDate(w.ends_at)}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Defecto o falla reportada" required error={errors.reportedIssue?.message}>
            {(a11y) => (
              <textarea
                {...a11y}
                {...register("reportedIssue")}
                className="erp-form-input"
                rows={3}
                placeholder="Describí el motivo del reingreso por garantía…"
                required
              />
            )}
          </Field>

          <FormError message={errors.root?.server?.message ?? null} />

          <div className="erp-modal-footer">
            <button type="button" className="btn-secondary" onClick={requestClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              <ShieldAlert size={16} />
              {isSubmitting ? "Registrando reclamo…" : "Registrar reclamo"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
