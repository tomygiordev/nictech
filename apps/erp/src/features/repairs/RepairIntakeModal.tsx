import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2 } from "lucide-react";
import { Field, FormError } from "../../components/erp/FormFeedback";
import { Modal } from "../../components/erp/WorkspaceUi";
import { toUserMessage } from "../../lib/errors";
import { supabase } from "../../lib/supabase";
import { intakeRepairOrder } from "./api";
import { intakeFormSchema, type IntakeFormInput } from "./schemas";

type IntakeCustomer = { id: string; display_name: string; phone: string | null };

type RepairIntakeModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (orderCode: string) => void;
  branches: ReadonlyArray<{ id: string; name: string }>;
  organizationId: string | null;
  hasPermission: (permission: string) => boolean;
};

const deviceTypes = [
  ["Smartphone", "Smartphone"],
  ["Notebook", "Notebook"],
  ["Tablet", "Tablet"],
  ["Consola", "Consola"],
  ["PC", "PC armada"],
  ["Otro", "Otro dispositivo"],
];
const deviceBrands = ["Apple", "Samsung", "Xiaomi", "Motorola", "Lenovo", "ASUS", "HP", "Dell", "Otra"];

const createRepairCustomer = async (input: {
  displayName: string;
  phone: string | null;
  identityDocument: string | null;
}): Promise<string> => {
  const { data, error } = await supabase.rpc("create_customer_with_private_details", {
    new_kind: "person",
    new_display_name: input.displayName,
    new_legal_name: undefined,
    new_email: undefined,
    new_phone: input.phone ?? undefined,
    new_tax_id: undefined,
    new_identity_document: input.identityDocument ?? undefined,
    new_address: {},
    new_internal_notes: undefined,
  });
  if (error) throw error;
  if (!data) throw new Error("No se pudo confirmar el alta del cliente.");
  return data;
};

export function RepairIntakeModal({ isOpen, ...props }: RepairIntakeModalProps) {
  if (!isOpen) return null;
  return <RepairIntakeForm key={props.organizationId} {...props} />;
}

function RepairIntakeForm({
  onClose,
  onCreated,
  branches,
  organizationId,
  hasPermission,
}: Omit<RepairIntakeModalProps, "isOpen">) {
  const [customers, setCustomers] = useState<IntakeCustomer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(Boolean(organizationId));
  const [customersError, setCustomersError] = useState<string | null>(null);
  const createdCustomer = useRef<{ key: string; id: string } | null>(null);
  const onlyBranchId = branches.length === 1 ? branches[0].id : "";
  const canRecordDni = hasPermission("customers.view_sensitive");
  const {
    register,
    watch,
    handleSubmit,
    clearErrors,
    getFieldState,
    resetField,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<IntakeFormInput>({
    resolver: zodResolver(intakeFormSchema),
    defaultValues: {
      branchId: onlyBranchId,
      isNewCustomer: false,
      customerId: "",
      newCustomerName: "",
      newCustomerDni: "",
      newCustomerPhone: "",
      deviceType: "",
      deviceBrand: "",
      model: "",
      serialNumber: "",
      imei: "",
      reportedFault: "",
      intakeCondition: "",
      intakeAccessories: "",
    },
  });
  const isNewCustomer = watch("isNewCustomer");

  useEffect(() => {
    if (!getFieldState("branchId").isDirty) resetField("branchId", { defaultValue: onlyBranchId });
  }, [getFieldState, onlyBranchId, resetField]);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;

    const loadCustomers = async () => {
      try {
        const { data, error } = await supabase
          .from("customers")
          .select("id, display_name, phone")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("display_name", { ascending: true });
        if (error) throw error;
        if (active) setCustomers(data ?? []);
      } catch (error) {
        if (active) {
          setCustomersError(toUserMessage(error, "No se pudieron cargar los clientes. Cerrá y volvé a abrir el ingreso para reintentar."));
        }
      } finally {
        if (active) setLoadingCustomers(false);
      }
    };

    void loadCustomers();
    return () => { active = false; };
  }, [organizationId]);

  const submit = handleSubmit(async (values) => {
    if (!organizationId) {
      setError("root.server", { message: "La sesión no tiene una organización activa. Volvé a iniciar sesión." });
      return;
    }
    if (!branches.some((branch) => branch.id === values.branchId)) {
      setError("branchId", { message: "Elegí una sucursal disponible." }, { shouldFocus: true });
      return;
    }
    const dni = values.isNewCustomer ? values.newCustomerDni?.replace(/\D/g, "") : undefined;
    if (dni && !canRecordDni) {
      setError("root.server", { message: "Tu rol no permite registrar documentos privados." });
      return;
    }

    let orderCode: string;
    try {
      let customerId = values.customerId;
      if (values.isNewCustomer) {
        const key = JSON.stringify([values.newCustomerName, values.newCustomerPhone ?? "", dni ?? ""]);
        if (createdCustomer.current?.key !== key) {
          createdCustomer.current = {
            key,
            id: await createRepairCustomer({
              displayName: values.newCustomerName,
              phone: values.newCustomerPhone || null,
              identityDocument: dni || null,
            }),
          };
        }
        customerId = createdCustomer.current.id;
      }
      const result = await intakeRepairOrder({
        branchId: values.branchId,
        customerId,
        equipmentType: values.deviceType,
        brandName: values.deviceBrand,
        modelName: values.model,
        serialNumber: values.serialNumber || undefined,
        imei: values.imei || undefined,
        accessories: (values.intakeAccessories ?? "").split(",").map((item) => item.trim()).filter(Boolean),
        // El valor operativo del RPC no describe el estado estético del equipo.
        intakeCondition: values.intakeCondition || undefined,
        reportedFault: values.reportedFault,
      });
      orderCode = result.order_code;
    } catch (error) {
      setError("root.server", {
        message: toUserMessage(error, "No se pudo ingresar la orden. Revisá los datos y reintentá."),
      });
      return;
    }

    onCreated(orderCode);
    onClose();
  });

  const requestClose = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Modal isOpen onClose={requestClose} title="Ingreso de Reparación a Taller" maxWidth="720px">
      <form onSubmit={submit} noValidate>
        <fieldset disabled={isSubmitting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Field label="Sucursal" required error={errors.branchId?.message}>
            {(a11y) => (
              <select {...a11y} {...register("branchId")} className="erp-form-input" required>
                <option value="">Elegí una sucursal…</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            )}
          </Field>

          <button
            type="button"
            className="btn-ghost"
            style={{ marginBottom: 12 }}
            onClick={() => {
              setValue("isNewCustomer", !isNewCustomer);
              clearErrors(["customerId", "newCustomerName", "newCustomerDni"]);
              clearErrors("root.server");
            }}
          >
            {isNewCustomer ? "Elegir un cliente existente" : "Crear un cliente nuevo"}
          </button>
          {isNewCustomer ? (
            <div className="erp-form-row">
              <Field label="Nombre completo" required error={errors.newCustomerName?.message}>
                {(a11y) => <input {...a11y} {...register("newCustomerName")} className="erp-form-input" required />}
              </Field>
              {canRecordDni && (
                <Field label="DNI" error={errors.newCustomerDni?.message} hint="Ingresá 7 u 8 dígitos.">
                  {(a11y) => <input {...a11y} {...register("newCustomerDni")} className="erp-form-input" inputMode="numeric" />}
                </Field>
              )}
              <Field label="Teléfono / WhatsApp" error={errors.newCustomerPhone?.message}>
                {(a11y) => <input {...a11y} {...register("newCustomerPhone")} className="erp-form-input" type="tel" />}
              </Field>
            </div>
          ) : (
            <>
              <Field label="Cliente titular" required error={errors.customerId?.message} hint={loadingCustomers ? "Cargando clientes…" : undefined}>
                {(a11y) => (
                  <select {...a11y} {...register("customerId")} className="erp-form-input" required>
                    <option value="">Elegí un cliente…</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.display_name}{customer.phone ? ` — ${customer.phone}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <FormError message={customersError} />
            </>
          )}

          <div className="erp-form-row">
            <Field label="Tipo de equipo" required error={errors.deviceType?.message}>
              {(a11y) => (
                <select {...a11y} {...register("deviceType")} className="erp-form-input" required>
                  <option value="">Elegí un tipo…</option>
                  {deviceTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              )}
            </Field>
            <Field label="Marca" required error={errors.deviceBrand?.message}>
              {(a11y) => (
                <select {...a11y} {...register("deviceBrand")} className="erp-form-input" required>
                  <option value="">Elegí una marca…</option>
                  {deviceBrands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                </select>
              )}
            </Field>
            <Field label="Modelo exacto" required error={errors.model?.message}>
              {(a11y) => <input {...a11y} {...register("model")} className="erp-form-input" required />}
            </Field>
          </div>

          <div className="erp-form-row">
            <Field label="Número de serie" error={errors.serialNumber?.message} hint="Podés dejarlo vacío si ingresás el IMEI.">
              {(a11y) => <input {...a11y} {...register("serialNumber")} className="erp-form-input" />}
            </Field>
            <Field label="IMEI" error={errors.imei?.message} hint="Podés dejarlo vacío si ingresás el número de serie.">
              {(a11y) => <input {...a11y} {...register("imei", { deps: ["serialNumber"] })} className="erp-form-input" inputMode="numeric" />}
            </Field>
          </div>
          <Field label="Falla declarada por el cliente" required error={errors.reportedFault?.message}>
            {(a11y) => <textarea {...a11y} {...register("reportedFault")} className="erp-form-input" rows={2} required />}
          </Field>
          <div className="erp-form-row">
            <Field label="Estado estético de ingreso" error={errors.intakeCondition?.message}>
              {(a11y) => <input {...a11y} {...register("intakeCondition")} className="erp-form-input" />}
            </Field>
            <Field label="Accesorios dejados" error={errors.intakeAccessories?.message} hint="Separá los accesorios con comas.">
              {(a11y) => <input {...a11y} {...register("intakeAccessories")} className="erp-form-input" />}
            </Field>
          </div>

          <FormError message={errors.root?.server?.message ?? null} />
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
            <button type="button" className="btn-ghost" onClick={requestClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 aria-hidden="true" className="animate-spin" size={16} /> : <Check aria-hidden="true" size={16} />}
              {isSubmitting ? "Ingresando la orden…" : "Ingresar al taller"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
