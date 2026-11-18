import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepairIntakeModal } from "./RepairIntakeModal";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ eq: mocks.eq }) }),
  },
}));

const organizationId = "25b32846-f32b-45d0-8a9d-93f807da1107";
const branch = { id: "99cea2b2-7d66-4170-ac23-cada552c4c82", name: "Centro" };
const otherBranch = { id: "03c56d7e-490c-4943-b7ed-c98864883f6a", name: "Norte" };
const existingCustomer = { id: "ae1eeded-cfe1-46fc-a792-16384e6cdb6b", display_name: "Ana Pérez", phone: null };
const newCustomerId = "2c6e6bc2-3c83-4c20-8d42-539bd19c7e1c";
const intakeResponse = {
  data: {
    repair_order_id: "a7edefcf-2be1-451f-87d2-1f8698bb580d",
    equipment_id: "2b588577-35a1-40f5-b6d9-469805ac318e",
    order_code: "REP-0001",
    public_tracking_code: "ABC-123",
    tracking_token: "token",
  },
  error: null,
};
const dialogTitle = "Ingreso de Reparación a Taller";
const missingIdentifier = "Ingresá el número de serie o el IMEI del equipo.";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.eq.mockReturnValue({ eq: mocks.eq, order: mocks.order });
  mocks.order.mockResolvedValue({ data: [existingCustomer], error: null });
  mocks.rpc.mockResolvedValue(intakeResponse);
});

async function openModal({ branches = [branch], canRecordDni = true } = {}) {
  const user = userEvent.setup();
  const onCreated = vi.fn();
  const onClose = vi.fn();

  function Harness() {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setIsOpen(true)}>Nueva reparación</button>
        <RepairIntakeModal
          isOpen={isOpen}
          onClose={() => { onClose(); setIsOpen(false); }}
          onCreated={onCreated}
          branches={branches}
          organizationId={organizationId}
          hasPermission={(permission) => permission === "customers.view_sensitive" && canRecordDni}
        />
      </>
    );
  }

  render(<Harness />);
  expect(mocks.order).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Nueva reparación" }));
  const dialog = screen.getByRole("dialog", { name: dialogTitle });
  const form = within(dialog);
  await form.findByRole("option", { name: existingCustomer.display_name });
  return { user, dialog, form, onCreated, onClose };
}

type OpenModal = Awaited<ReturnType<typeof openModal>>;

async function fillEquipment({ user, form }: OpenModal) {
  await user.selectOptions(form.getByLabelText(/^Tipo de equipo/), "Notebook");
  await user.selectOptions(form.getByLabelText(/^Marca/), "Lenovo");
  await user.type(form.getByLabelText(/^Modelo exacto/), "ThinkPad T14");
  await user.type(form.getByLabelText(/^Falla declarada/), "No carga la batería.");
}

async function selectCustomer({ user, form }: OpenModal) {
  await user.selectOptions(form.getByLabelText(/^Cliente titular/), existingCustomer.id);
}

async function submit({ user, form }: OpenModal) {
  await user.click(form.getByRole("button", { name: "Ingresar al taller" }));
}

describe("Ingreso de reparación a taller", () => {
  it("carga los clientes al abrir, sin elegir ninguno ni inventar datos del equipo", async () => {
    const { form } = await openModal();

    expect(mocks.eq).toHaveBeenCalledWith("organization_id", organizationId);
    expect(form.getByLabelText(/^Sucursal/)).toHaveValue(branch.id);
    expect(form.getByLabelText(/^Cliente titular/)).toHaveValue("");
    expect(form.getByRole("option", { name: "Elegí un cliente…", selected: true })).toBeInTheDocument();
    expect(form.getByLabelText(/^Tipo de equipo/)).toHaveValue("");
    expect(form.getByLabelText(/^Marca/)).toHaveValue("");
    expect(form.getByLabelText("Estado estético de ingreso")).toHaveValue("");
    expect(form.getByLabelText("Accesorios dejados")).toHaveValue("");
  });

  it("muestra los errores de un ingreso vacío dentro del diálogo, sin invocar el RPC", async () => {
    const modal = await openModal({ branches: [branch, otherBranch] });
    const { form, onClose } = modal;

    expect(form.getByLabelText(/^Sucursal/)).toHaveValue("");
    await submit(modal);

    for (const [label, message] of [
      [/^Sucursal/, "Elegí una sucursal."],
      [/^Cliente titular/, "Elegí un cliente."],
      [/^Tipo de equipo/, "Elegí el tipo de equipo."],
      [/^Marca/, "Elegí la marca."],
      [/^Modelo exacto/, "Indicá el modelo del equipo."],
      [/^Falla declarada/, "Describí la falla con al menos 5 caracteres."],
    ] as const) {
      const control = form.getByLabelText(label);
      expect(control).toHaveAttribute("aria-invalid", "true");
      expect(control).toHaveAccessibleDescription(message);
      expect(form.getByText(message)).toHaveAttribute("role", "alert");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("muestra la falta de serie o IMEI dentro del diálogo y borra el error al ingresar IMEI", async () => {
    const modal = await openModal();
    const { user, form } = modal;
    await selectCustomer(modal);
    await fillEquipment(modal);
    await submit(modal);

    expect(form.getByRole("alert")).toHaveTextContent(missingIdentifier);
    expect(form.getByLabelText("Número de serie")).toHaveFocus();
    expect(mocks.rpc).not.toHaveBeenCalled();

    await user.type(form.getByLabelText("IMEI"), "123456789012345");
    await waitFor(() => expect(form.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("informa el error de la orden dentro del diálogo y conserva lo ingresado", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "raw technical error" } });
    const modal = await openModal();
    const { user, dialog, form, onClose, onCreated } = modal;
    await selectCustomer(modal);
    await fillEquipment(modal);
    await user.type(form.getByLabelText("Número de serie"), "ABC-123");
    await submit(modal);

    expect(within(dialog).getByRole("alert")).toHaveTextContent("No tenés permiso para realizar esta acción.");
    expect(form.queryByText("raw technical error")).not.toBeInTheDocument();
    expect(form.getByLabelText(/^Modelo exacto/)).toHaveValue("ThinkPad T14");
    expect(onClose).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("enfoca el control al hacer clic en cada etiqueta, incluso en el alta del cliente", async () => {
    const { user, dialog, form } = await openModal();
    const checkLabels = async () => {
      for (const label of dialog.querySelectorAll("label")) {
        const control = form.getByLabelText(label.textContent ?? "");
        await user.click(label);
        expect(control).toHaveFocus();
      }
    };
    expect(dialog.querySelectorAll("label")).toHaveLength(10);
    await checkLabels();

    await user.click(form.getByRole("button", { name: "Crear un cliente nuevo" }));
    expect(dialog.querySelectorAll("label")).toHaveLength(12);
    await checkLabels();
  });

  it("impide reenviar mientras espera el RPC, avisa el éxito y cierra; al reabrir vuelve vacío", async () => {
    let complete!: (result: typeof intakeResponse) => void;
    mocks.rpc.mockReturnValue(new Promise<typeof intakeResponse>((resolve) => { complete = resolve; }));
    const modal = await openModal();
    const { user, form, onClose, onCreated } = modal;
    await selectCustomer(modal);
    await fillEquipment(modal);
    await user.type(form.getByLabelText("Número de serie"), " ABC-123 ");
    await submit(modal);
    const pending = form.getByRole("button", { name: "Ingresando la orden…" });
    expect(pending).toBeDisabled();
    await user.click(pending);
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("intake_repair_order", {
      target_branch_id: branch.id,
      target_customer_id: existingCustomer.id,
      equipment_type: "Notebook",
      brand_name: "Lenovo",
      model_name: "ThinkPad T14",
      serial_number: "ABC-123",
      imei: undefined,
      accessories: [],
      intake_condition: "Recibido en taller",
      intake_damage: undefined,
      intake_notes: undefined,
      reported_fault: "No carga la batería.",
      operation_reason: "Ingreso técnico taller",
    });

    await act(async () => complete(intakeResponse));
    expect(onCreated).toHaveBeenCalledExactlyOnceWith("REP-0001");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Nueva reparación" }));
    const reopened = within(screen.getByRole("dialog", { name: dialogTitle }));
    await reopened.findByRole("option", { name: existingCustomer.display_name });
    expect(reopened.getByLabelText(/^Cliente titular/)).toHaveValue("");
    expect(reopened.getByLabelText(/^Modelo exacto/)).toHaveValue("");
  });

  it("valida nombre y DNI del cliente nuevo, y envía el documento normalizado", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: newCustomerId, error: null }).mockResolvedValueOnce(intakeResponse);
    const modal = await openModal();
    const { user, form } = modal;
    await user.click(form.getByRole("button", { name: "Crear un cliente nuevo" }));
    await fillEquipment(modal);
    await user.type(form.getByLabelText("IMEI"), "123456789012345");
    await user.type(form.getByLabelText("DNI"), "1234");
    await submit(modal);
    expect(form.getByLabelText(/^Nombre completo/)).toHaveAccessibleDescription("Ingresá el nombre del nuevo cliente.");
    expect(form.getByLabelText("DNI")).toHaveAccessibleDescription(/El DNI debe tener 7 u 8 dígitos./);
    expect(mocks.rpc).not.toHaveBeenCalled();

    await user.type(form.getByLabelText(/^Nombre completo/), " Ana Pérez ");
    await user.clear(form.getByLabelText("DNI"));
    await user.type(form.getByLabelText("DNI"), "38.123.456");
    await user.type(form.getByLabelText("Accesorios dejados"), "Cargador, funda, ");
    await user.type(form.getByLabelText("Estado estético de ingreso"), "Rayones en la tapa");
    await submit(modal);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "create_customer_with_private_details", expect.objectContaining({
      new_display_name: "Ana Pérez",
      new_identity_document: "38123456",
      new_phone: undefined,
    }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "intake_repair_order", expect.objectContaining({
      target_customer_id: newCustomerId,
      accessories: ["Cargador", "funda"],
      intake_condition: "Rayones en la tapa",
      imei: "123456789012345",
    }));
  });

  it("no muestra el DNI ni lo envía si el rol no puede registrar datos privados", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: newCustomerId, error: null }).mockResolvedValueOnce(intakeResponse);
    const modal = await openModal({ canRecordDni: false });
    const { user, form } = modal;
    await user.click(form.getByRole("button", { name: "Crear un cliente nuevo" }));
    expect(form.queryByLabelText("DNI")).not.toBeInTheDocument();
    await user.type(form.getByLabelText(/^Nombre completo/), "Ana Pérez");
    await fillEquipment(modal);
    await user.type(form.getByLabelText("Número de serie"), "ABC-123");
    await submit(modal);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "create_customer_with_private_details", expect.objectContaining({
      new_identity_document: undefined,
    }));
  });

  it("reutiliza el cliente recién creado si falla el ingreso y se reintenta", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: newCustomerId, error: null })
      .mockResolvedValueOnce({ data: null, error: new TypeError("Failed to fetch") })
      .mockResolvedValueOnce(intakeResponse);

    const modal = await openModal();
    const { user, dialog, form, onCreated, onClose } = modal;
    await user.click(form.getByRole("button", { name: "Crear un cliente nuevo" }));
    await user.type(form.getByLabelText(/^Nombre completo/), "Ana Pérez");
    await user.type(form.getByLabelText("DNI"), "38123456");
    await fillEquipment(modal);
    await user.type(form.getByLabelText("Número de serie"), "ABC-123");

    await submit(modal);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Sin conexión con el servidor.");
    expect(onClose).not.toHaveBeenCalled();

    await submit(modal);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "create_customer_with_private_details")).toHaveLength(1);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "intake_repair_order", expect.objectContaining({
      target_customer_id: newCustomerId,
    }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, "intake_repair_order", expect.objectContaining({
      target_customer_id: newCustomerId,
    }));
    expect(onCreated).toHaveBeenCalledExactlyOnceWith("REP-0001");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
