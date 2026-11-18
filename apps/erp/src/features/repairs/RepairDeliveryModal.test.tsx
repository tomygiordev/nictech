import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliverRepairOrder } from "./api";
import { RepairDeliveryModal } from "./RepairDeliveryModal";

vi.mock("./api", () => ({ deliverRepairOrder: vi.fn() }));

const deliver = vi.mocked(deliverRepairOrder);
const order = {
  id: "758df8ed-05e9-48bf-a70a-29053d171a10",
  order_code: "REP-0042",
  brand_snapshot: "Apple",
  model_snapshot: "iPhone 14",
  customer_name: "Ana Pérez",
};
const title = `Entrega formal de equipo: ${order.order_code}`;

beforeEach(() => {
  deliver.mockReset().mockResolvedValue("deliv-1");
});

async function setup() {
  const user = userEvent.setup();
  const onDelivered = vi.fn();

  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Abrir entrega</button>
        <RepairDeliveryModal
          isOpen={open}
          order={order}
          onClose={() => setOpen(false)}
          onDelivered={onDelivered}
        />
      </>
    );
  }

  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Abrir entrega" }));
  const form = within(screen.getByRole("dialog", { name: title }));
  return { user, form, onDelivered };
}

describe("Entrega formal de equipo", () => {
  it("inicia con 90 días por defecto, regenera los términos al elegir 30 días y muestra aviso si se editaron", async () => {
    const { user, form } = await setup();
    const daysSelect = form.getByLabelText(/^Días de garantía/);
    const termsInput = form.getByLabelText(/^Términos de la póliza/);

    expect(daysSelect).toHaveValue("90");
    expect(termsInput).toHaveValue("Garantía de 90 días sobre mano de obra y repuestos instalados en NicTech.");

    await user.selectOptions(daysSelect, "30");
    expect(termsInput).toHaveValue("Garantía de 30 días sobre mano de obra y repuestos instalados en NicTech.");
    expect(form.queryByRole("status")).not.toBeInTheDocument();

    await user.clear(termsInput);
    await user.type(termsInput, "Cobertura especial de mostrador.");
    await user.selectOptions(daysSelect, "180");

    expect(termsInput).toHaveValue("Cobertura especial de mostrador.");
    expect(form.getByRole("status")).toHaveTextContent("Revisá que los términos coincidan con 180 días");
  });

  it("muestra errores dentro del diálogo al enviar vacío y no llama a la API", async () => {
    const { user, form, onDelivered } = await setup();
    const recipient = form.getByLabelText(/^Nombre del receptor/);
    expect(recipient).toHaveValue("");

    await user.click(form.getByRole("button", { name: "Confirmar entrega y póliza" }));

    expect(form.getByRole("alert")).toHaveTextContent("Ingresá el nombre de quien retira.");
    expect(recipient).toHaveAttribute("aria-invalid", "true");
    expect(deliver).not.toHaveBeenCalled();
    expect(onDelivered).not.toHaveBeenCalled();
  });

  it("muestra el error de API dentro del diálogo sin cerrarlo y cierra tras el éxito", async () => {
    deliver.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { user, form, onDelivered } = await setup();

    await user.type(form.getByLabelText(/^Nombre del receptor/), "  Carlos Gómez  ");
    await user.selectOptions(form.getByLabelText(/^Días de garantía/), "30");
    await user.click(form.getByRole("button", { name: "Confirmar entrega y póliza" }));

    expect(form.getByRole("alert")).toHaveTextContent("Sin conexión con el servidor.");
    expect(screen.getByRole("dialog", { name: title })).toBeInTheDocument();
    expect(onDelivered).not.toHaveBeenCalled();

    await user.click(form.getByRole("button", { name: "Confirmar entrega y póliza" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument());
    expect(deliver).toHaveBeenCalledWith(
      order.id,
      "Carlos Gómez",
      "",
      30,
      "Garantía de 30 días sobre mano de obra y repuestos instalados en NicTech.",
    );
    expect(onDelivered).toHaveBeenCalledWith("Carlos Gómez", 30);
  });
});
