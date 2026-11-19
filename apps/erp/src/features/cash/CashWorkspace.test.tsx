import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatPosCurrency } from "../../lib/formatters";
import { CashWorkspace } from "./CashWorkspace";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  user: { user_metadata: { full_name: "Laura Pérez" }, email: "laura@example.test" },
}));

vi.mock("../../auth/ErpAuthContext", () => ({
  useErpAuth: () => ({ session: { user: mock.user }, hasPermission: () => true }),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: { from: mock.from, rpc: mock.rpc },
}));

const register = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  name: "Caja mostrador",
  code: "MOSTRADOR",
  branch_id: "550e8400-e29b-41d4-a716-446655440002",
};
const openSession = {
  id: "550e8400-e29b-41d4-a716-446655440003",
  cash_register_id: register.id,
  branch_id: register.branch_id,
  opened_at: "2026-11-18T12:00:00Z",
  reason: "Apertura de turno",
  cash_session_opening_counts: [{ amount: 1000, currency_code: "ARS" }],
  cash_movements: [
    {
      id: "550e8400-e29b-41d4-a716-446655440004",
      kind: "payment",
      amount: 400,
      currency_code: "ARS",
      reason: "Venta en mostrador",
      occurred_at: "2026-11-18T13:00:00Z",
      reversal_of_movement_id: null,
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440005",
      kind: "contribution",
      amount: 100,
      currency_code: "ARS",
      reason: "Cambio para mostrador",
      occurred_at: "2026-11-18T13:00:00Z",
      reversal_of_movement_id: null,
    },
  ],
  cash_closures: [],
};
const closedSession = {
  ...openSession,
  id: "550e8401-e29b-41d4-a716-446655440003",
  cash_closures: [{
    id: "550e8401-e29b-41d4-a716-446655440006",
    closed_at: "2026-11-18T18:00:00Z",
    reason: "Cierre del turno anterior",
    cash_close_counts: [{ currency_code: "ARS", expected_amount: 1490, counted_amount: 1490, difference_amount: 0 }],
  }],
};

const rows = (data: unknown, error: unknown = null) => ({
  select: () => ({ order: async () => ({ data, error }) }),
});
const moneyText = (amount: number) => formatPosCurrency(amount).replace(/\s/g, " ");

beforeEach(() => {
  mock.user.user_metadata.full_name = "Laura Pérez";
  mock.from.mockReset().mockImplementation((table: string) => {
    if (table === "cash_registers") return rows([register]);
    if (table === "cash_sessions") return rows([openSession, closedSession]);
    throw new Error(`Unexpected table: ${table}`);
  });
  mock.rpc.mockReset().mockResolvedValue({ data: "record-id", error: null });
});

afterEach(cleanup);

async function openCountDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Arqueo y cierre" }));
  return screen.getByRole("dialog", { name: "Arqueo y cierre de caja" });
}

function showResult(dialog: HTMLElement, amount: string) {
  fireEvent.change(within(dialog).getByRole("spinbutton", { name: /Efectivo contado/ }), { target: { value: amount } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Ver resultado" }));
  return screen.getByRole("dialog", { name: "Arqueo y cierre de caja" });
}

describe("arqueo ciego de caja", () => {
  it("oculta el esperado en los turnos abiertos y en el encabezado de movimientos", async () => {
    render(<CashWorkspace />);
    expect(await screen.findByRole("cell", { name: "Se revela al cerrar" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Esperado" })).toBeInTheDocument();
    expect(screen.getByText("1 caja abierta")).toBeInTheDocument();
    expect(screen.queryByText(moneyText(1500))).not.toBeInTheDocument();
    expect(screen.queryByText(moneyText(1000))).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ver movimientos (2)" }));
    const ledger = within(screen.getByRole("dialog"));
    expect(ledger.getByText("Cobro")).toBeInTheDocument();
    expect(ledger.queryByText(moneyText(1500))).not.toBeInTheDocument();
    expect(ledger.queryByText(moneyText(1000))).not.toBeInTheDocument();
    fireEvent.click(ledger.getByRole("button", { name: "Cerrar" }));

    fireEvent.click(screen.getByRole("button", { name: "Historial de arqueos (1)" }));
    expect(screen.getAllByRole("cell", { name: formatPosCurrency(1490) })).toHaveLength(2);
    expect(screen.getByText(`Cuadrada (${moneyText(0)})`)).toBeInTheDocument();
  });

  it("valida el conteo vacío antes de revelar un resultado que ya no se puede editar", async () => {
    render(<CashWorkspace />);
    const dialog = await openCountDialog();
    const countForm = within(dialog);
    expect(countForm.getByRole("spinbutton", { name: /Efectivo contado/ })).toHaveDisplayValue("");
    expect(countForm.queryByText("Total teórico esperado")).not.toBeInTheDocument();
    expect(countForm.queryByText("Movimientos netos")).not.toBeInTheDocument();
    expect(countForm.queryByText(moneyText(1500))).not.toBeInTheDocument();

    fireEvent.click(countForm.getByRole("button", { name: "Ver resultado" }));
    expect(countForm.getByRole("alert")).toHaveTextContent("Ingresá el efectivo contado.");
    expect(mock.rpc).not.toHaveBeenCalled();

    const result = within(showResult(dialog, "1300"));
    expect(result.getByText("Fondo inicial")).toBeInTheDocument();
    expect(result.getByText("Movimientos netos")).toBeInTheDocument();
    expect(result.getByText("Total teórico esperado")).toBeInTheDocument();
    expect(result.getByText(moneyText(1000))).toBeInTheDocument();
    expect(result.getByText(moneyText(500))).toBeInTheDocument();
    expect(result.getByText(moneyText(1500))).toBeInTheDocument();
    expect(result.getByText(moneyText(1300))).toBeInTheDocument();
    expect(result.getByText(`Faltante de ${moneyText(200)}`)).toBeInTheDocument();
    expect(result.queryByRole("spinbutton")).not.toBeInTheDocument();

    fireEvent.click(result.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const restarted = within(await openCountDialog());
    expect(restarted.getByRole("spinbutton", { name: /Efectivo contado/ })).toHaveDisplayValue("");
    expect(restarted.queryByText("Total teórico esperado")).not.toBeInTheDocument();
  });

  it("exige motivo por una diferencia y llama al RPC solo después de confirmar", async () => {
    render(<CashWorkspace />);
    const result = within(showResult(await openCountDialog(), "1300"));
    const reason = result.getByRole("textbox", { name: /Motivo del cierre/ });
    expect(reason).toHaveDisplayValue("");
    fireEvent.click(result.getByRole("button", { name: "Cerrar turno" }));
    expect(result.getByRole("alert")).toHaveTextContent("Ingresá un motivo de al menos 5 caracteres");
    expect(mock.rpc).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: "  Se entregó cambio de más.  " } });
    expect(result.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(result.getByRole("button", { name: "Cerrar turno" }));
    const confirmation = within(screen.getByRole("dialog", { name: `Cerrar turno con faltante de ${formatPosCurrency(200)}` }));
    expect(mock.rpc).not.toHaveBeenCalled();

    fireEvent.click(confirmation.getByRole("button", { name: "Confirmar cierre" }));
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("close_cash_session", {
      target_cash_session_id: openSession.id,
      operation_key: expect.stringMatching(/^close-cash-/),
      operation_reason: "Se entregó cambio de más.",
      counted_amounts: [{ currency_code: "ARS", amount: 1300 }],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("muestra la confirmación simple si el conteo coincide y bloquea un segundo envío", async () => {
    let resolveClose: (result: { data: string; error: null }) => void = () => {};
    mock.rpc.mockReturnValueOnce(new Promise((resolve) => { resolveClose = resolve; }));
    render(<CashWorkspace />);
    const result = within(showResult(await openCountDialog(), "1500"));
    expect(result.getByText("Sin diferencia")).toBeInTheDocument();
    expect(result.getByRole("textbox", { name: "Motivo del cierre" })).not.toBeRequired();
    fireEvent.click(result.getByRole("button", { name: "Cerrar turno" }));

    const dialog = screen.getByRole("dialog", { name: "Cerrar turno" });
    const confirmation = within(dialog);
    expect(confirmation.getByText("Una vez cerrado, no podés reabrir el turno.")).toBeInTheDocument();
    fireEvent.click(confirmation.getByRole("button", { name: "Confirmar cierre" }));
    expect(confirmation.getByRole("button", { name: "Procesando…" })).toBeDisabled();
    expect(confirmation.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("close_cash_session", {
      target_cash_session_id: openSession.id,
      operation_key: expect.stringMatching(/^close-cash-/),
      operation_reason: "Cierre sin diferencias",
      counted_amounts: [{ currency_code: "ARS", amount: 1500 }],
    });
    resolveClose({ data: "closed-id", error: null });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("muestra un error del RPC dentro del arqueo y conserva el resultado y el motivo", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "cash session is already closed" } });
    render(<CashWorkspace />);
    const result = within(showResult(await openCountDialog(), "1575"));
    fireEvent.change(result.getByRole("textbox", { name: /Motivo del cierre/ }), { target: { value: "Revisé los cobros." } });
    fireEvent.click(result.getByRole("button", { name: "Cerrar turno" }));
    const confirmation = within(screen.getByRole("dialog", { name: `Cerrar turno con sobrante de ${formatPosCurrency(75)}` }));
    fireEvent.click(confirmation.getByRole("button", { name: "Confirmar cierre" }));

    const dialog = await screen.findByRole("dialog", { name: "Arqueo y cierre de caja" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("La caja ya está cerrada.");
    expect(within(dialog).getByRole("textbox", { name: /Motivo del cierre/ })).toHaveValue("Revisé los cobros.");
    expect(within(dialog).getByText(moneyText(1575))).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

describe("formularios de caja", () => {
  it.each([
    ["Laura Pérez", "Laura Pérez"],
    ["  ", "laura@example.test"],
  ])("identifica al operador en un campo de solo lectura (%j)", async (name, expected) => {
    mock.user.user_metadata.full_name = name;
    render(<CashWorkspace />);
    await screen.findByRole("cell", { name: "Se revela al cerrar" });
    fireEvent.click(screen.getByRole("button", { name: "Abrir nueva caja" }));
    const form = within(screen.getByRole("dialog", { name: "Abrir turno de caja" }));
    expect(form.getByRole("textbox", { name: "Operador" })).toHaveValue(expected);
    expect(form.getByRole("textbox", { name: "Operador" })).toHaveAttribute("readonly");
  });

  it("exige ingresar el fondo y muestra el error de apertura dentro del modal", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "cash register already has an open session" } });
    render(<CashWorkspace />);
    await screen.findByRole("cell", { name: "Se revela al cerrar" });
    fireEvent.click(screen.getByRole("button", { name: "Abrir nueva caja" }));
    const form = within(screen.getByRole("dialog", { name: "Abrir turno de caja" }));
    const opening = form.getByRole("spinbutton", { name: /Fondo inicial/ });
    expect(opening).toHaveDisplayValue("");
    fireEvent.click(form.getByRole("button", { name: "Abrir turno" }));
    expect(form.getByRole("alert")).toHaveTextContent("Ingresá el fondo inicial.");
    expect(mock.rpc).not.toHaveBeenCalled();

    fireEvent.change(opening, { target: { value: "0" } });
    fireEvent.click(form.getByRole("button", { name: "Abrir turno" }));
    expect(mock.rpc).toHaveBeenCalledWith("open_cash_session", expect.objectContaining({
      opening_counts: [{ currency_code: "ARS", amount: 0 }],
    }));
    expect(await form.findByRole("alert")).toHaveTextContent("Esa caja ya tiene una sesión abierta.");
  });

  it("muestra el error de movimiento manual dentro de su modal", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "cash session is already closed" } });
    render(<CashWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Ingreso o egreso" }));
    const form = within(screen.getByRole("dialog", { name: "Registrar ingreso o egreso manual" }));
    fireEvent.click(form.getByRole("button", { name: "Registrar movimiento" }));
    expect(form.getByRole("alert")).toHaveTextContent("Ingresá un importe de al menos 0,01.");
    expect(mock.rpc).not.toHaveBeenCalled();

    fireEvent.change(form.getByRole("spinbutton", { name: /Importe/ }), { target: { value: "100" } });
    fireEvent.change(form.getByRole("textbox", { name: /Motivo o comprobante/ }), { target: { value: "Cambio para el mostrador" } });
    fireEvent.click(form.getByRole("button", { name: "Registrar movimiento" }));
    expect(await form.findByRole("alert")).toHaveTextContent("La caja ya está cerrada.");
  });

  it("muestra el error de reversa dentro de su modal", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "cash movement is already reversed" } });
    render(<CashWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver movimientos (2)" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revertir" }));
    const form = within(screen.getByRole("dialog", { name: "Revertir movimiento manual" }));
    fireEvent.change(form.getByRole("textbox", { name: /Motivo de la reversa/ }), { target: { value: "Ingreso duplicado" } });
    fireEvent.click(form.getByRole("button", { name: "Confirmar reversa" }));
    expect(await form.findByRole("alert")).toHaveTextContent("Ese movimiento de caja ya fue revertido.");
  });
});
