import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuotesWorkspace } from "./QuotesWorkspace";
import type { QuoteOverview } from "./api";

const mock = vi.hoisted(() => ({
  permissions: new Set<string>(["quotes.view", "quotes.manage"]),
  listQuotes: vi.fn(),
  createRepairQuote: vi.fn(),
  issueRepairQuote: vi.fn(),
  respondQuoteDecision: vi.fn(),
  from: vi.fn(),
}));

vi.mock("../../auth/ErpAuthContext", () => ({
  useErpAuth: () => ({
    hasPermission: (permission: string) => mock.permissions.has(permission),
  }),
}));

vi.mock("./api", () => ({
  listQuotes: mock.listQuotes,
  createRepairQuote: mock.createRepairQuote,
  issueRepairQuote: mock.issueRepairQuote,
  respondQuoteDecision: mock.respondQuoteDecision,
}));

vi.mock("../../lib/supabase", () => ({
  supabase: { from: mock.from },
}));

const ORDER_ID = "550e8400-e29b-41d4-a716-446655440001";
const PRODUCT_ID = "550e8400-e29b-41d4-a716-446655440002";
const SERVICE_ID = "550e8400-e29b-41d4-a716-446655440003";

const sampleDraftQuote: QuoteOverview = {
  id: "550e8400-e29b-41d4-a716-446655440010",
  repair_order_id: ORDER_ID,
  order_code: "ORD-0042",
  customer_name: "María Gómez",
  customer_phone: "5491155550000",
  version: 1,
  currency_code: "ARS",
  subtotal_amount: 10000,
  tax_amount: 2100,
  total_amount: 12100,
  issued_at: null,
  expires_at: null,
  created_at: "2026-11-18T10:00:00Z",
  decision: null,
  decision_at: null,
  lines: [
    {
      id: "550e8400-e29b-41d4-a716-446655440011",
      line_number: 1,
      kind: "free_concept",
      description: "Cambio de pin de carga",
      quantity: 1,
      unit_price: 10000,
      tax_rate_percent: 21,
      tax_amount: 2100,
      line_total: 12100,
    },
  ],
};

const repairOrderRows = [
  {
    id: ORDER_ID,
    order_code: "ORD-0042",
    customer_name: "María Gómez",
    brand: "Samsung",
    model: "Galaxy S23",
    status: "En diagnóstico",
    status_is_terminal: false,
  },
];

const productRows = [
  {
    id: PRODUCT_ID,
    internal_name: "Módulo OLED",
    internal_code: "MOD-S23",
    item_kind: "product",
  },
  {
    id: SERVICE_ID,
    internal_name: "Microsoldadura placa",
    internal_code: "SRV-MIC",
    item_kind: "service",
  },
];

beforeEach(() => {
  mock.permissions = new Set(["quotes.view", "quotes.manage"]);
  mock.listQuotes.mockReset().mockResolvedValue([sampleDraftQuote]);
  mock.createRepairQuote.mockReset().mockResolvedValue("new-quote-id");
  mock.issueRepairQuote.mockReset().mockResolvedValue({
    quote_id: sampleDraftQuote.id,
    response_token: "token-123",
  });
  mock.respondQuoteDecision.mockReset().mockResolvedValue("event-id");

  mock.from.mockReset().mockImplementation((table: string) => {
    const data = table === "repair_orders_overview" ? repairOrderRows : productRows;
    const result = Promise.resolve({ data, error: null });
    const query = {
      select: () => query,
      eq: () => query,
      order: () => result,
    };
    return query;
  });
});

afterEach(cleanup);

async function openNewQuoteModal() {
  const button = await screen.findByRole("button", { name: "Nuevo presupuesto" });
  fireEvent.click(button);
  const dialogEl = screen.getByRole("dialog", { name: "Nuevo presupuesto" });
  const dialog = within(dialogEl);
  await dialog.findByRole("option", { name: /ORD-0042/ });
  return { dialogEl, dialog };
}

describe("QuotesWorkspace", () => {
  it("usa el tono de rechazo en la tabla y la ficha, con totales alineados", async () => {
    mock.listQuotes.mockResolvedValue([{
      ...sampleDraftQuote,
      issued_at: "2026-11-18T10:00:00Z",
      decision: "rejected",
      decision_at: "2026-11-18T11:00:00Z",
    }]);
    render(<QuotesWorkspace />);

    expect(await screen.findByText("Rechazado")).toHaveClass("flow-status-pill", "cancelled");
    fireEvent.click(screen.getByRole("button", { name: /Ver/ }));
    const detail = within(screen.getByRole("dialog", { name: /Presupuesto: ORD-0042/ }));
    expect(detail.getByText("Rechazado por el cliente")).toHaveClass("flow-status-pill", "cancelled");
    for (const label of ["Subtotal:", "IVA / Impuestos:", "Total general:"]) {
      const row = detail.getByRole("row", { name: new RegExp(label) });
      expect(within(row).getAllByRole("cell")[1]).toHaveClass("num");
    }
  });

  it("no muestra la palabra Cotiz en la pantalla ni en los modales", async () => {
    render(<QuotesWorkspace />);
    await screen.findByText("ORD-0042 (v1)");
    expect(document.body.textContent).not.toMatch(/cotiz/i);

    fireEvent.click(screen.getByRole("button", { name: /Ver/ }));
    expect(screen.getByRole("dialog", { name: /Presupuesto: ORD-0042/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/cotiz/i);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    fireEvent.click(screen.getByRole("button", { name: /Decisión/ }));
    expect(screen.getByRole("dialog", { name: "Registrar decisión del cliente" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/cotiz/i);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await openNewQuoteModal();
    expect(document.body.textContent).not.toMatch(/cotiz/i);
  });

  it("submit vacío muestra errores por campo dentro de ambos diálogos y no llama a la API", async () => {
    render(<QuotesWorkspace />);
    await screen.findByText("ORD-0042 (v1)");

    const { dialog } = await openNewQuoteModal();
    expect(dialog.getByRole("combobox", { name: /Orden de reparación/ })).toHaveValue("");
    expect(dialog.getByRole("textbox", { name: /Motivo/ })).toHaveValue("");
    const line1 = within(dialog.getByRole("group", { name: "Línea 1" }));
    expect(line1.getByRole("spinbutton", { name: /Cantidad/ })).toHaveDisplayValue("");
    expect(line1.getByRole("spinbutton", { name: /Precio unitario/ })).toHaveDisplayValue("");

    fireEvent.click(dialog.getByRole("button", { name: "Guardar presupuesto formal" }));

    expect(await dialog.findByText("Elegí una orden de reparación.")).toHaveAttribute("role", "alert");
    expect(dialog.getByText("Indicá un motivo de al menos 5 caracteres.")).toHaveAttribute("role", "alert");
    expect(line1.getByText("Ingresá la descripción del concepto.")).toHaveAttribute("role", "alert");
    expect(line1.getByText("Ingresá la cantidad.")).toHaveAttribute("role", "alert");
    expect(line1.getByText("Ingresá el precio unitario.")).toHaveAttribute("role", "alert");
    expect(mock.createRepairQuote).not.toHaveBeenCalled();

    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    fireEvent.click(screen.getByRole("button", { name: /Decisión/ }));
    const decisionDialog = within(screen.getByRole("dialog", { name: "Registrar decisión del cliente" }));
    fireEvent.click(decisionDialog.getByRole("button", { name: "Confirmar decisión" }));

    expect(await decisionDialog.findByText("Elegí si el cliente aprobó o rechazó el presupuesto.")).toHaveAttribute("role", "alert");
    expect(mock.respondQuoteDecision).not.toHaveBeenCalled();
  });

  it("clic en cada label enfoca su control en ambos formularios", async () => {
    const user = userEvent.setup();
    render(<QuotesWorkspace />);
    await screen.findByText("ORD-0042 (v1)");

    const { dialogEl, dialog } = await openNewQuoteModal();
    const line1 = within(dialog.getByRole("group", { name: "Línea 1" }));
    await user.type(line1.getByRole("spinbutton", { name: /Precio unitario/ }), "0");

    const labels = Array.from(dialogEl.querySelectorAll("label"));
    expect(labels.length).toBeGreaterThanOrEqual(8);
    for (const label of labels) {
      expect(label.htmlFor).not.toBe("");
      const control = document.getElementById(label.htmlFor);
      expect(control).not.toBeNull();
      await user.click(label);
      expect(document.activeElement).toBe(control);
    }

    await user.selectOptions(line1.getByRole("combobox", { name: /Tipo/ }), "service");
    for (const label of Array.from(dialogEl.querySelectorAll("label"))) {
      expect(label.htmlFor).not.toBe("");
      const control = document.getElementById(label.htmlFor);
      expect(control).not.toBeNull();
      await user.click(label);
      expect(document.activeElement).toBe(control);
    }

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await user.click(screen.getByRole("button", { name: /Decisión/ }));
    const decisionEl = screen.getByRole("dialog", { name: "Registrar decisión del cliente" });
    for (const label of Array.from(decisionEl.querySelectorAll("label"))) {
      expect(label.htmlFor).not.toBe("");
      const control = document.getElementById(label.htmlFor);
      expect(control).not.toBeNull();
      await user.click(label);
      expect(document.activeElement).toBe(control);
    }
  });

  it("precio 0 sin confirmar no envía y envía al confirmarlo", async () => {
    render(<QuotesWorkspace />);
    await screen.findByText("ORD-0042 (v1)");

    const { dialog } = await openNewQuoteModal();
    fireEvent.change(dialog.getByRole("combobox", { name: /Orden de reparación/ }), { target: { value: ORDER_ID } });
    fireEvent.change(dialog.getByRole("textbox", { name: /Motivo/ }), { target: { value: "Garantía sin cargo" } });

    const line1 = within(dialog.getByRole("group", { name: "Línea 1" }));
    fireEvent.change(line1.getByRole("textbox", { name: /Descripción/ }), { target: { value: "Revisión técnica" } });
    fireEvent.change(line1.getByRole("spinbutton", { name: /Cantidad/ }), { target: { value: "1" } });
    fireEvent.change(line1.getByRole("spinbutton", { name: /Precio unitario/ }), { target: { value: "0" } });

    fireEvent.click(dialog.getByRole("button", { name: "Guardar presupuesto formal" }));
    expect(await line1.findByText("Confirmá el precio de $0.")).toHaveAttribute("role", "alert");
    expect(mock.createRepairQuote).not.toHaveBeenCalled();

    const confirmCheckbox = line1.getByRole("checkbox", { name: /Confirmo el precio de \$0/ });
    fireEvent.click(confirmCheckbox);
    expect(confirmCheckbox).toBeChecked();

    // Editing unit price resets confirmation
    const priceInput = line1.getByRole("spinbutton", { name: /Precio unitario/ });
    fireEvent.change(priceInput, { target: { value: "100" } });
    expect(line1.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.change(priceInput, { target: { value: "0" } });
    expect(line1.getByRole("checkbox", { name: /Confirmo el precio de \$0/ })).not.toBeChecked();

    fireEvent.click(line1.getByRole("checkbox", { name: /Confirmo el precio de \$0/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Guardar presupuesto formal" }));

    await waitFor(() => expect(mock.createRepairQuote).toHaveBeenCalledWith({
      repairOrderId: ORDER_ID,
      currencyCode: "ARS",
      reason: "Garantía sin cargo",
      lines: [
        {
          kind: "free_concept",
          product_id: undefined,
          description: "Revisión técnica",
          quantity: 1,
          unit_price: 0,
          unit_cost: 0,
          tax_rate_percent: 21,
        },
      ],
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("muestra errores de API dentro del diálogo sin cerrar ni perder datos", async () => {
    mock.createRepairQuote.mockRejectedValueOnce({ code: "42501", message: "quotes.manage permission is required" });
    mock.respondQuoteDecision.mockRejectedValueOnce({ code: "42501", message: "quotes.manage permission is required" });

    render(<QuotesWorkspace />);
    await screen.findByText("ORD-0042 (v1)");

    const { dialog } = await openNewQuoteModal();
    fireEvent.change(dialog.getByRole("combobox", { name: /Orden de reparación/ }), { target: { value: ORDER_ID } });
    fireEvent.change(dialog.getByRole("textbox", { name: /Motivo/ }), { target: { value: "Presupuesto reparación placa" } });
    const line1 = within(dialog.getByRole("group", { name: "Línea 1" }));
    fireEvent.change(line1.getByRole("textbox", { name: /Descripción/ }), { target: { value: "Reparación IC carga" } });
    fireEvent.change(line1.getByRole("spinbutton", { name: /Cantidad/ }), { target: { value: "1" } });
    fireEvent.change(line1.getByRole("spinbutton", { name: /Precio unitario/ }), { target: { value: "25000" } });

    fireEvent.click(dialog.getByRole("button", { name: "Guardar presupuesto formal" }));
    const createAlert = await dialog.findByRole("alert");
    expect(createAlert).toHaveTextContent("No tenés permiso para realizar esta acción.");
    expect(dialog.getByRole("textbox", { name: /Motivo/ })).toHaveValue("Presupuesto reparación placa");
    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    fireEvent.click(screen.getByRole("button", { name: /Decisión/ }));
    const decisionDialog = within(screen.getByRole("dialog", { name: "Registrar decisión del cliente" }));
    fireEvent.click(decisionDialog.getByRole("radio", { name: "Aprobado" }));
    fireEvent.change(decisionDialog.getByRole("textbox", { name: /Mensaje o notas/ }), { target: { value: "Autorizado" } });
    fireEvent.click(decisionDialog.getByRole("button", { name: "Confirmar decisión" }));

    const decisionAlert = await decisionDialog.findByRole("alert");
    expect(decisionAlert).toHaveTextContent("No tenés permiso para realizar esta acción.");
    expect(decisionDialog.getByRole("textbox", { name: /Mensaje o notas/ })).toHaveValue("Autorizado");
  });

  it("deshabilita Nuevo presupuesto, Emitir y Decisión sin permiso quotes.manage", async () => {
    mock.permissions = new Set(["quotes.view"]);
    render(<QuotesWorkspace />);
    await screen.findByText("ORD-0042 (v1)");

    const newBtn = screen.getByRole("button", { name: "Nuevo presupuesto" });
    expect(newBtn).toBeDisabled();
    expect(newBtn).toHaveAttribute("title", "Necesitás permiso para gestionar presupuestos.");

    const issueBtn = screen.getByRole("button", { name: "Emitir" });
    expect(issueBtn).toBeDisabled();
    expect(issueBtn).toHaveAttribute("title", "Necesitás permiso para emitir presupuestos.");

    const decisionBtn = screen.getByRole("button", { name: "Decisión" });
    expect(decisionBtn).toBeDisabled();
    expect(decisionBtn).toHaveAttribute("title", "Necesitás permiso para registrar decisiones de presupuestos.");
  });
});
