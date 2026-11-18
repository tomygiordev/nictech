import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordRepairLabor } from "./api";
import { RepairLaborModal } from "./RepairLaborModal";

vi.mock("./api", () => ({ recordRepairLabor: vi.fn() }));

const record = vi.mocked(recordRepairLabor);
const title = "Registrar mano de obra";
const orderId = "orden-1";

beforeEach(() => record.mockReset().mockResolvedValue("trabajo-1"));

async function setup() {
  const user = userEvent.setup();
  const onRecorded = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Abrir mano de obra</button>
        <RepairLaborModal isOpen={open} orderId={orderId} onClose={() => setOpen(false)} onRecorded={onRecorded} />
      </>
    );
  }
  render(<Harness />);
  const open = async () => {
    await user.click(screen.getByRole("button", { name: "Abrir mano de obra" }));
    return within(screen.getByRole("dialog", { name: title }));
  };
  return { user, onRecorded, open, form: await open() };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function fill(user: Setup["user"], form: Setup["form"], cost: string) {
  await user.type(form.getByLabelText(/^Trabajo realizado/), "  Limpieza de placa  ");
  await user.type(form.getByLabelText(/^Horas/), "1.5");
  await user.type(form.getByLabelText(/^Costo por hora/), cost);
}

describe("Registrar mano de obra", () => {
  it("abre vacío y marca cada campo obligatorio dentro del diálogo sin registrar nada", async () => {
    const { user, form } = await setup();
    const fields = [/^Trabajo realizado/, /^Horas/, /^Costo por hora/].map((name) => form.getByLabelText(name));
    expect(fields[0]).toHaveValue("");
    expect(fields[1]).toHaveValue(null);
    expect(fields[2]).toHaveValue(null);
    expect(form.queryByRole("checkbox")).not.toBeInTheDocument();

    await user.click(form.getByRole("button", { name: "Registrar trabajo" }));
    expect(form.getAllByRole("alert")).toHaveLength(3);
    fields.forEach((field) => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(fields[2]).toHaveAccessibleDescription("Ingresá el costo por hora.");
    expect(record).not.toHaveBeenCalled();
  });

  it("solo envía un costo cero si la persona lo confirma explícitamente", async () => {
    const { user, form, onRecorded } = await setup();
    await fill(user, form, "0");
    const confirm = form.getByRole("checkbox", { name: "Confirmo costo cero" });
    expect(confirm).not.toBeChecked();
    await user.click(form.getByRole("button", { name: "Registrar trabajo" }));
    expect(form.getByRole("alert")).toHaveTextContent("Confirmá que el costo por hora es cero.");
    expect(record).not.toHaveBeenCalled();

    await user.click(confirm);
    await user.click(form.getByRole("button", { name: "Registrar trabajo" }));
    expect(record).toHaveBeenCalledWith(orderId, "Limpieza de placa", 1.5, 0, expect.stringMatching(/^repair-labor-/));
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument();
  });

  it("muestra el error de red en el diálogo, conserva la clave al reintentar y la cambia después del éxito", async () => {
    record.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { user, form, open, onRecorded } = await setup();
    await fill(user, form, "1200");
    await user.click(form.getByRole("button", { name: "Registrar trabajo" }));
    expect(form.getByRole("alert")).toHaveTextContent("Sin conexión con el servidor.");
    expect(onRecorded).not.toHaveBeenCalled();

    await user.click(form.getByRole("button", { name: "Registrar trabajo" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument());
    expect(record.mock.calls[1]).toEqual(record.mock.calls[0]);

    const reopened = await open();
    expect(reopened.getByLabelText(/^Horas/)).toHaveValue(null);
    await fill(user, reopened, "1200");
    await user.click(reopened.getByRole("button", { name: "Registrar trabajo" }));
    expect(record.mock.calls[2]?.[4]).not.toBe(record.mock.calls[0]?.[4]);
    expect(onRecorded).toHaveBeenCalledTimes(2);
  });

  it("descarta la clave de idempotencia ante conflicto de operación y avisa que actualice", async () => {
    record.mockRejectedValueOnce({ message: "operation key is already used by another operation" });
    const { user, form, onRecorded } = await setup();
    await fill(user, form, "1200");
    await user.click(form.getByRole("button", { name: "Registrar trabajo" }));

    expect(form.getByRole("alert")).toHaveTextContent(
      "Ya hay una operación registrada con esta referencia. Revisá si se completó antes de reintentar. Actualizá la reparación para ver si la operación quedó registrada.",
    );
    expect(onRecorded).not.toHaveBeenCalled();

    await user.click(form.getByRole("button", { name: "Registrar trabajo" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument());
    expect(record.mock.calls[1]?.[4]).not.toBe(record.mock.calls[0]?.[4]);
    expect(onRecorded).toHaveBeenCalledTimes(1);
  });
});
