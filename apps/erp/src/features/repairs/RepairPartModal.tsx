import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PackageMinus } from "lucide-react";
import { Field, FormError } from "../../components/erp/FormFeedback";
import { Modal } from "../../components/erp/WorkspaceUi";
import { toUserMessage } from "../../lib/errors";
import { supabase } from "../../lib/supabase";
import { consumeRepairPart } from "./api";
import { partSchema, type RepairPartInput, type RepairPartValues } from "./schemas";

type PartProduct = { id: string; internal_name: string; internal_code: string };

type Props = {
  isOpen: boolean;
  order?: { id: string; order_code: string };
  locations: ReadonlyArray<{ id: string; name: string }>;
  onClose: () => void;
  onConsumed: () => void;
};

export function RepairPartModal({ isOpen, order, ...props }: Props) {
  if (!isOpen || !order) return null;

  return <RepairPartForm key={order.id} order={order} {...props} />;
}

function RepairPartForm({
  order,
  locations,
  onClose,
  onConsumed,
}: Omit<Props, "isOpen" | "order"> & { order: NonNullable<Props["order"]> }) {
  const [products, setProducts] = useState<PartProduct[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const {
    register, handleSubmit, setError, formState: { errors, isSubmitting },
  } = useForm<RepairPartInput, unknown, RepairPartValues>({
    resolver: zodResolver(partSchema),
    defaultValues: { locationId: "", productId: "", quantity: "", reason: "" },
  });

  useEffect(() => {
    let active = true;
    const loadProducts = async () => {
      try {
        const { data, error } = await supabase
          .from("products")
          .select("id, internal_name, internal_code")
          .eq("is_active", true)
          .order("internal_name", { ascending: true });
        if (error) throw error;
        if (active) setProducts(data ?? []);
      } catch (error) {
        if (active) setLoadError(toUserMessage(error, "No se pudieron cargar los repuestos. Cerrá el formulario y volvé a abrirlo."));
      }
    };
    void loadProducts();
    return () => { active = false; };
  }, []);

  const submit = handleSubmit(async (values) => {
    try {
      await consumeRepairPart(order.id, values.locationId, values.productId, undefined, values.quantity, values.reason);
    } catch (error) {
      setError("root.server", { message: toUserMessage(error, "No se pudo descontar el repuesto. Revisá los datos y reintentá.") });
      return;
    }
    onClose();
    onConsumed();
  });

  const requestClose = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Modal isOpen onClose={requestClose} title={`Consumir repuesto: ${order.order_code}`} icon={PackageMinus} scrollBody>
      {!products ? (
        loadError ? <FormError message={loadError} /> : <p role="status">Cargando repuestos…</p>
      ) : (
        <form onSubmit={submit} noValidate>
          <fieldset disabled={isSubmitting} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <Field label="Ubicación de stock" required error={errors.locationId?.message} hint={!locations.length ? "No hay ubicaciones de stock en la sucursal de la reparación." : undefined}>
              {(a11y) => (
                <select {...a11y} {...register("locationId")} className="erp-form-input" required>
                  <option value="">Elegí una ubicación…</option>
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              )}
            </Field>
            <Field label="Repuesto del catálogo" required error={errors.productId?.message} hint={!products.length ? "No hay productos activos en el catálogo." : undefined}>
              {(a11y) => (
                <select {...a11y} {...register("productId")} className="erp-form-input" required>
                  <option value="">Elegí un repuesto…</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{product.internal_name} ({product.internal_code})</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Cantidad" required error={errors.quantity?.message}>
              {(a11y) => <input {...a11y} {...register("quantity")} className="erp-form-input" type="number" step="1" min="1" required />}
            </Field>
            <Field label="Motivo técnico" required error={errors.reason?.message}>
              {(a11y) => <input {...a11y} {...register("reason")} className="erp-form-input" required />}
            </Field>
            <p className="erp-modal-subtitle">
              El stock se descontará de la ubicación elegida. Si el equipo ya pasó el control final, volvé a inspeccionarlo antes de entregarlo.
            </p>
            <FormError message={errors.root?.server?.message ?? null} />
            <div className="erp-modal-footer">
              <button type="button" className="btn-secondary" onClick={requestClose}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={isSubmitting}>
                {isSubmitting ? "Descontando repuesto…" : "Descontar repuesto"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
