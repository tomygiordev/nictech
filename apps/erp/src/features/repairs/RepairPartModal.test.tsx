import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumeRepairPart } from "./api";
import { RepairPartModal } from "./RepairPartModal";

const mocks = vi.hoisted(() => ({ order: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: mocks.order }) }) }),
  },
}));
vi.mock("./api", () => ({ consumeRepairPart: vi.fn() }));

const consume = vi.mocked(consumeRepairPart);
const order = { id: "orden-1", order_code: "REP-001" };
const location = { id: "758df8ed-05e9-48bf-a70a-29053d171a10", name: "Almacén del taller" };
const product = { id: "c36c881e-d05e-4a81-9b39-f1f959afaf15", internal_name: "Módulo", internal_code: "MOD-001" };
const title = "Consumir repuesto: REP-001";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.order.mockResolvedValue({ data: [product], error: null });
  consume.mockResolvedValue("movimiento-1");
});

async function setup() {
  const user = userEvent.setup();
  const onConsumed = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Abrir repuestos</button>
        <RepairPartModal isOpen={open} order={order} locations={[location]} onClose={() => setOpen(false)} onConsumed={onConsumed} />
      </>
    );
  }
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Abrir repuestos" }));
  return { user, form: within(screen.getByRole("dialog", { name: title })), onConsumed };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function fill({ user, form }: Setup, reason = "  Cambio de módulo  ") {
  await user.selectOptions(await form.findByLabelText(/^Ubicación de stock/), location.id);
  await user.selectOptions(form.getByLabelText(/^Repuesto del catálogo/), product.id);
  await user.type(form.getByLabelText(/^Cantidad/), "2");
  await user.type(form.getByLabelText(/^Motivo técnico/), reason);
}

describe("Consumir repuesto", () => {
  it("abre con cantidad, repuesto, ubicación y motivo vacíos y muestra los errores en el diálogo", async () => {
    const { user, form } = await setup();
    const submit = await form.findByRole("button", { name: "Descontar repuesto" });
    const names = [/^Ubicación de stock/, /^Repuesto del catálogo/, /^Motivo técnico/];
    names.forEach((name) => expect(form.getByLabelText(name)).toHaveValue(""));
    expect(form.getByLabelText(/^Cantidad/)).toHaveValue(null);

    await user.click(submit);
    expect(form.getAllByRole("alert")).toHaveLength(4);
    [...names, /^Cantidad/].forEach((name) => expect(form.getByLabelText(name)).toHaveAttribute("aria-invalid", "true"));
    expect(form.getByLabelText(/^Cantidad/)).toHaveAccessibleDescription("Ingresá la cantidad.");
    expect(consume).not.toHaveBeenCalled();
  });

  it("no envía cantidades fraccionarias ni motivos de menos de cinco caracteres", async () => {
    const setupResult = await setup();
    const { user, form } = setupResult;
    await fill(setupResult, "  faja  ");
    const quantity = form.getByLabelText(/^Cantidad/);
    await user.clear(quantity);
    await user.type(quantity, "1.5");
    await user.click(form.getByRole("button", { name: "Descontar repuesto" }));
    expect(form.getByText("Ingresá una cantidad entera.")).toBeVisible();
    expect(form.getByText("Indicá el motivo con al menos 5 caracteres.")).toBeVisible();
    expect(consume).not.toHaveBeenCalled();
  });

  it("muestra el error de stock en el diálogo y cierra solo al recibir el éxito", async () => {
    consume.mockRejectedValueOnce({ message: "insufficient available stock on line 1" });
    const setupResult = await setup();
    const { user, form, onConsumed } = setupResult;
    await fill(setupResult);
    const submit = form.getByRole("button", { name: "Descontar repuesto" });
    await user.click(submit);
    expect(form.getByRole("alert")).toHaveTextContent("No hay stock suficiente.");
    expect(onConsumed).not.toHaveBeenCalled();

    await user.click(submit);
    expect(consume).toHaveBeenLastCalledWith(order.id, location.id, product.id, undefined, 2, "Cambio de módulo");
    expect(onConsumed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument();
  });

  it("muestra el fallo de carga del catálogo sin cerrar el diálogo", async () => {
    mocks.order.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    const { form } = await setup();
    expect(form.getByRole("alert")).toHaveTextContent("No tenés permiso para realizar esta acción.");
    expect(consume).not.toHaveBeenCalled();
  });
});
