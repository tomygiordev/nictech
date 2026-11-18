import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listOpenCashSessions } from "../cash/api";
import { listRepairExchangeSnapshots, listRepairPaymentMethods, recordRepairPayment } from "./api";
import { RepairPaymentModal } from "./RepairPaymentModal";

vi.mock("../cash/api", () => ({ listOpenCashSessions: vi.fn() }));
vi.mock("./api", () => ({
  listRepairPaymentMethods: vi.fn(),
  listRepairExchangeSnapshots: vi.fn(),
  recordRepairPayment: vi.fn(),
}));

const record = vi.mocked(recordRepairPayment);
const title = "Cobro o seña de reparación";
const orderId = "orden-1";
const branchId = "centro";
const cash = { id: "c36c881e-d05e-4a81-9b39-f1f959afaf15", code: "CASH", name: "Efectivo", requires_cash_session: true };
const card = { id: "758df8ed-05e9-48bf-a70a-29053d171a10", code: "CARD", name: "Tarjeta", requires_cash_session: false };
const ars = {
  id: "ae1eeded-cfe1-46fc-a792-16384e6cdb6b", quote_currency: "ARS", rate_to_base: 1,
  source: "Moneda base", quoted_at: "2026-10-01T18:00:00Z",
};
const usd = { ...ars, id: "3d70ac77-df31-4007-99cb-4c7e5acaf394", quote_currency: "USD", rate_to_base: 1400 };
const session = { id: "caja-centro", branch_id: branchId, cash_register_id: "caja-1", opened_at: ars.quoted_at, reason: "Apertura" };
const otherSession = { ...session, id: "caja-norte", branch_id: "norte" };

beforeEach(() => {
  vi.resetAllMocks();
  record.mockResolvedValue("pago-1");
  vi.mocked(listRepairPaymentMethods).mockResolvedValue([cash, card]);
  vi.mocked(listRepairExchangeSnapshots).mockResolvedValue([ars, usd]);
  vi.mocked(listOpenCashSessions).mockResolvedValue([session, otherSession]);
});

async function setup() {
  const user = userEvent.setup();
  const onRecorded = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Abrir cobro</button>
        <RepairPaymentModal isOpen={open} orderId={orderId} branchId={branchId} onClose={() => setOpen(false)} onRecorded={onRecorded} />
      </>
    );
  }
  render(<Harness />);
  const open = async () => {
    await user.click(screen.getByRole("button", { name: "Abrir cobro" }));
    return within(screen.getByRole("dialog", { name: title }));
  };
  return { user, onRecorded, open, form: await open() };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function fill(user: Setup["user"], form: Setup["form"], methodId: string) {
  await user.selectOptions(await form.findByLabelText(/^Medio de pago/), methodId);
  await user.selectOptions(form.getByLabelText(/^Moneda/), "ARS");
  await user.selectOptions(form.getByLabelText(/^Cotización/), ars.id);
  await user.type(form.getByLabelText(/^Importe/), "3500.50");
  await user.type(form.getByLabelText(/^Motivo del cobro/), "  Seña del arreglo  ");
}

describe("Cobro o seña de reparación", () => {
  it("abre sin importe ni selecciones y muestra los errores de cada campo dentro del diálogo", async () => {
    const { user, form } = await setup();
    const submit = await form.findByRole("button", { name: "Registrar cobro" });
    const names = [/^Medio de pago/, /^Moneda/, /^Cotización/, /^Motivo del cobro/];
    names.forEach((name) => expect(form.getByLabelText(name)).toHaveValue(""));
    expect(form.getByLabelText(/^Importe/)).toHaveValue(null);
    await user.click(submit);
    expect(form.getAllByRole("alert")).toHaveLength(5);
    [...names, /^Importe/].forEach((name) => expect(form.getByLabelText(name)).toHaveAttribute("aria-invalid", "true"));
    expect(form.getByLabelText(/^Importe/)).toHaveAccessibleDescription("Ingresá el importe.");
    expect(record).not.toHaveBeenCalled();
  });

  it("pide caja abierta de la sucursal para el efectivo y envía la caja seleccionada", async () => {
    const { user, form, onRecorded } = await setup();
    await fill(user, form, cash.id);
    const cashSelect = form.getByLabelText(/^Caja abierta/);
    expect(form.queryByRole("option", { name: otherSession.id })).not.toBeInTheDocument();
    await user.click(form.getByRole("button", { name: "Registrar cobro" }));
    expect(form.getByRole("alert")).toHaveTextContent("Elegí una caja abierta de la misma sucursal.");
    expect(record).not.toHaveBeenCalled();

    await user.selectOptions(cashSelect, session.id);
    await user.click(form.getByRole("button", { name: "Registrar cobro" }));
    expect(record).toHaveBeenCalledWith({
      repairOrderId: orderId, paymentMethodId: cash.id, cashSessionId: session.id, amount: 3500.5,
      currency: "ARS", exchangeSnapshotId: ars.id, operationKey: expect.stringMatching(/^repair-payment-/), reason: "Seña del arreglo",
    });
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument();
  });

  it("borra la cotización anterior al cambiar de moneda", async () => {
    const { user, form } = await setup();
    await fill(user, form, card.id);
    await user.selectOptions(form.getByLabelText(/^Moneda/), "USD");
    const quote = form.getByLabelText(/^Cotización/);
    expect(quote).toHaveValue("");
    expect(within(quote).getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual(["", usd.id]);
  });

  it("mantiene el diálogo y la clave tras un fallo de red; el éxito cierra y libera la clave", async () => {
    record.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { user, form, open, onRecorded } = await setup();
    await fill(user, form, card.id);
    await user.click(form.getByRole("button", { name: "Registrar cobro" }));
    expect(form.getByRole("alert")).toHaveTextContent("Sin conexión con el servidor.");
    expect(onRecorded).not.toHaveBeenCalled();
    expect(record.mock.calls[0]?.[0].cashSessionId).toBeNull();

    await user.click(form.getByRole("button", { name: "Registrar cobro" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument());
    expect(record.mock.calls[1]).toEqual(record.mock.calls[0]);

    const reopened = await open();
    await fill(user, reopened, card.id);
    await user.click(reopened.getByRole("button", { name: "Registrar cobro" }));
    expect(record.mock.calls[2]?.[0].operationKey).not.toBe(record.mock.calls[0]?.[0].operationKey);
    expect(onRecorded).toHaveBeenCalledTimes(2);
  });

  it("muestra los errores al cargar medios de pago en el propio diálogo", async () => {
    vi.mocked(listRepairPaymentMethods).mockRejectedValueOnce({ code: "42501" });
    const { form } = await setup();
    expect(form.getByRole("alert")).toHaveTextContent("No tenés permiso para realizar esta acción.");
    expect(record).not.toHaveBeenCalled();
  });

  it("descarta la clave de idempotencia ante conflicto de operación y avisa que actualice", async () => {
    record.mockRejectedValueOnce({ message: "idempotency key is already used by another request" });
    const { user, form, onRecorded } = await setup();
    await fill(user, form, card.id);
    await user.click(form.getByRole("button", { name: "Registrar cobro" }));

    expect(form.getByRole("alert")).toHaveTextContent(
      "Ya hay una operación registrada con esta referencia. Revisá si se completó antes de reintentar. Actualizá la reparación para ver si la operación quedó registrada.",
    );
    expect(onRecorded).not.toHaveBeenCalled();

    await user.click(form.getByRole("button", { name: "Registrar cobro" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument());
    expect(record.mock.calls[1]?.[0].operationKey).not.toBe(record.mock.calls[0]?.[0].operationKey);
    expect(onRecorded).toHaveBeenCalledTimes(1);
  });
});
