import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchasesWorkspace } from "./PurchasesWorkspace";

const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), insert: vi.fn() }));

vi.mock("../../auth/ErpAuthContext", () => ({
  useErpAuth: () => ({ organizationId: "test-org", hasPermission: () => true }),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: { from: mock.from, rpc: mock.rpc },
}));

const branch = { id: "550e8400-e29b-41d4-a716-446655440001", name: "Centro" };
const secondBranch = { id: "550e8400-e29b-41d4-a716-446655440002", name: "Norte" };
const supplier = { id: "550e8400-e29b-41d4-a716-446655440003", display_name: "Distribuidora Sur", payment_terms_days: 30 };
const variant = { id: "550e8400-e29b-41d4-a716-446655440004", name: "Negro", code: "NEG" };
const product = {
  id: "550e8400-e29b-41d4-a716-446655440005",
  internal_name: "Funda",
  internal_code: "FUN",
  product_variants: [variant],
};
const plainProduct = {
  id: "550e8400-e29b-41d4-a716-446655440006",
  internal_name: "Cable",
  internal_code: "CAB",
  product_variants: [],
};
const location = { id: "550e8400-e29b-41d4-a716-446655440007", branch_id: branch.id, code: "DEPOSITO", name: "Depósito", kind: "stock" };
const order = {
  id: "550e8400-e29b-41d4-a716-446655440008",
  branch_id: branch.id,
  supplier_id: supplier.id,
  suppliers: supplier,
  currency_code: "ARS",
  exchange_rate: 1,
  reason: "Reposición",
  ordered_at: "2026-11-18T12:00:00Z",
  purchase_order_lines: [{
    id: "550e8400-e29b-41d4-a716-446655440009",
    line_number: 1,
    product_id: product.id,
    variant_id: variant.id,
    ordered_quantity: 2,
    unit_price: 12500,
    tax_amount: 0,
    products: product,
    product_variants: variant,
  }],
  purchase_approval_events: [] as Array<{ action: string; occurred_at: string }>,
  purchase_receipts: [],
};
const payment = {
  id: "550e8400-e29b-41d4-a716-446655440010",
  branch_id: branch.id,
  amount_currency: 5000,
  currency_code: "ARS",
  occurred_at: "2026-11-18T13:00:00Z",
  payment_methods: { name: "Transferencia" },
  supplier_payment_reversals: [],
};
const denied = { code: "42501", message: "internal table permission denied" };

let rows: Record<string, unknown>;
let readErrors: Record<string, unknown>;

beforeEach(() => {
  rows = {
    suppliers: [supplier],
    supplier_account_entries: [{ supplier_id: supplier.id, amount_base_delta: 5000 }],
    purchase_orders: [order],
    products: [product, plainProduct],
    branches: [branch, secondBranch],
    locations: [location],
    supplier_payments: [payment],
  };
  readErrors = {};

  mock.from.mockReset().mockImplementation((table: string) => {
    if (!(table in rows)) throw new Error(`Tabla inesperada: ${table}`);
    const result = Promise.resolve({ data: rows[table], error: readErrors[table] ?? null });
    const query = {
      select: () => query,
      eq: () => query,
      order: () => result,
      then: result.then.bind(result),
      insert: mock.insert,
    };
    return query;
  });
  mock.rpc.mockReset().mockResolvedValue({ data: "result-id", error: null });
  mock.insert.mockReset().mockResolvedValue({ error: null });
});

afterEach(cleanup);

async function openPurchaseDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Nueva orden de compra" }));
  const dialog = within(screen.getByRole("dialog", { name: "Nueva orden de compra" }));
  await dialog.findByRole("option", { name: "Distribuidora Sur (30 días)" });
  await dialog.findByRole("option", { name: "Funda (FUN)" });
  return dialog;
}

function enterHeader(dialog: ReturnType<typeof within>) {
  fireEvent.change(dialog.getByRole("combobox", { name: /Sucursal/ }), { target: { value: branch.id } });
  fireEvent.change(dialog.getByRole("combobox", { name: /Proveedor/ }), { target: { value: supplier.id } });
  fireEvent.change(dialog.getByRole("textbox", { name: /Motivo/ }), { target: { value: "Reponer mercadería" } });
}

function enterLine(line: ReturnType<typeof within>, productId: string, cost: string) {
  fireEvent.change(line.getByRole("combobox", { name: /Producto/ }), { target: { value: productId } });
  fireEvent.change(line.getByRole("spinbutton", { name: /Cantidad/ }), { target: { value: "2" } });
  fireEvent.change(line.getByRole("spinbutton", { name: /Costo unitario/ }), { target: { value: cost } });
}

function submitOrder(dialog: ReturnType<typeof within>) {
  fireEvent.click(dialog.getByRole("button", { name: "Emitir orden de compra" }));
}

describe("órdenes de compra", () => {
  it("abre sin datos inventados y agrega líneas vacías, sin mostrar (PO)", async () => {
    render(<PurchasesWorkspace />);
    const dialog = await openPurchaseDialog();

    expect(dialog.getByRole("combobox", { name: /Sucursal/ })).toHaveValue("");
    expect(dialog.getByRole("combobox", { name: /Proveedor/ })).toHaveDisplayValue("Elegí un proveedor…");
    expect(dialog.getByRole("textbox", { name: /Motivo/ })).toHaveValue("");

    fireEvent.click(dialog.getByRole("button", { name: "Agregar línea" }));
    for (const name of ["Línea 1", "Línea 2"]) {
      const line = within(dialog.getByRole("group", { name }));
      expect(line.getByRole("combobox", { name: /Producto/ })).toHaveValue("");
      expect(line.getByRole("combobox", { name: /Variante/ })).toHaveValue("");
      expect(line.getByRole("spinbutton", { name: /Cantidad/ })).toHaveDisplayValue("");
      expect(line.getByRole("spinbutton", { name: /Costo unitario/ })).toHaveDisplayValue("");
      expect(line.queryByRole("checkbox")).not.toBeInTheDocument();
    }
    expect(document.body).not.toHaveTextContent("(PO)");
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("preselecciona la sucursal solo si hay una y abre un formulario limpio al reintentar desde el listado", async () => {
    rows.branches = [branch];
    render(<PurchasesWorkspace />);
    const dialog = await openPurchaseDialog();
    expect(dialog.getByRole("combobox", { name: /Sucursal/ })).toHaveValue(branch.id);
    enterHeader(dialog);
    enterLine(dialog, plainProduct.id, "1500");
    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    const reopened = await openPurchaseDialog();
    expect(reopened.getByRole("combobox", { name: /Sucursal/ })).toHaveValue(branch.id);
    expect(reopened.getByRole("combobox", { name: /Proveedor/ })).toHaveValue("");
    expect(reopened.getByRole("spinbutton", { name: /Costo unitario/ })).toHaveDisplayValue("");
  });

  it("Enter con el formulario vacío muestra los errores dentro del diálogo y no llama al RPC", async () => {
    const user = userEvent.setup();
    render(<PurchasesWorkspace />);
    const dialog = await openPurchaseDialog();
    await user.click(dialog.getByRole("textbox", { name: /Motivo/ }));
    await user.keyboard("{Enter}");

    expect(await dialog.findByText("Elegí un proveedor.")).toHaveAttribute("role", "alert");
    expect(dialog.getByText("Elegí un producto.")).toHaveAttribute("role", "alert");
    expect(dialog.getByRole("spinbutton", { name: /Cantidad/ })).toHaveAccessibleDescription("Ingresá la cantidad.");
    expect(dialog.getByRole("spinbutton", { name: /Costo unitario/ })).toHaveAccessibleDescription("Ingresá el costo unitario.");
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("no elige la primera variante y muestra el error del RPC sin cerrar ni perder el formulario", async () => {
    mock.rpc.mockImplementation(async (name: string) => name === "create_purchase_order"
      ? { data: null, error: denied }
      : { data: "snapshot-id", error: null });
    render(<PurchasesWorkspace />);
    const dialog = await openPurchaseDialog();
    enterHeader(dialog);
    enterLine(dialog, product.id, "12500");

    const variantField = dialog.getByRole("combobox", { name: /Variante/ });
    expect(variantField).toHaveValue("");
    submitOrder(dialog);
    expect(await dialog.findByText("Elegí una variante.")).toHaveAttribute("role", "alert");
    expect(mock.rpc).not.toHaveBeenCalled();

    fireEvent.change(variantField, { target: { value: variant.id } });
    submitOrder(dialog);
    expect(await dialog.findByText("No tenés permiso para realizar esta acción.")).toBeInTheDocument();
    expect(dialog.getByRole("alert")).toHaveTextContent("No tenés permiso para realizar esta acción.");
    expect(dialog.getByRole("spinbutton", { name: /Costo unitario/ })).toHaveValue(12500);
    expect(mock.rpc).toHaveBeenCalledWith("create_purchase_order", expect.objectContaining({
      lines: [{ product_id: product.id, variant_id: variant.id, quantity: 2, unit_price: 12500 }],
    }));
  });

  it("rechaza un costo positivo que la base podría redondear a cero", async () => {
    render(<PurchasesWorkspace />);
    const dialog = await openPurchaseDialog();
    enterHeader(dialog);
    enterLine(dialog, plainProduct.id, "0.00001");
    submitOrder(dialog);
    expect(await dialog.findByText("Ingresá $0 o un costo de al menos $0,0001.")).toHaveAttribute("role", "alert");
    expect(dialog.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("pide confirmar el costo cero por línea y vuelve a pedirlo si se edita el costo", async () => {
    render(<PurchasesWorkspace />);
    const dialog = await openPurchaseDialog();
    enterHeader(dialog);
    fireEvent.click(dialog.getByRole("button", { name: "Agregar línea" }));
    const first = within(dialog.getByRole("group", { name: "Línea 1" }));
    const second = within(dialog.getByRole("group", { name: "Línea 2" }));
    enterLine(first, plainProduct.id, "0");
    enterLine(second, plainProduct.id, "0");
    const checkbox = (line: ReturnType<typeof within>) => line.getByRole("checkbox", { name: /Confirmo el costo/ });
    fireEvent.click(checkbox(first));
    submitOrder(dialog);
    expect(await second.findByText("Confirmá el costo de $0.")).toBeInTheDocument();
    expect(first.queryByRole("alert")).not.toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();

    const firstCost = first.getByRole("spinbutton", { name: /Costo unitario/ });
    fireEvent.change(firstCost, { target: { value: "10" } });
    expect(first.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.change(firstCost, { target: { value: "0" } });
    expect(checkbox(first)).not.toBeChecked();
    fireEvent.click(checkbox(first));
    fireEvent.click(checkbox(second));
    submitOrder(dialog);
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("create_purchase_order", expect.objectContaining({
      lines: Array.from({ length: 2 }, () => ({ product_id: plainProduct.id, variant_id: null, quantity: 2, unit_price: 0 })),
    })));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("informa monto y proveedor, y llama a aprobar solo después de confirmar", async () => {
    render(<PurchasesWorkspace />);
    const approve = await screen.findByRole("button", { name: "Aprobar" });
    fireEvent.click(approve);
    const dialog = within(screen.getByRole("dialog", { name: "Aprobar orden de compra" }));
    expect(dialog.getByText(/Aprobar la orden de compra por ARS\s*25\.000,00 a Distribuidora Sur\. Genera deuda con el proveedor\./)).toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(approve);
    fireEvent.click(dialogForApproval().getByRole("button", { name: "Aprobar orden" }));
    await screen.findByText("Orden de compra aprobada. Ya podés registrar la recepción.");
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("approve_purchase_order", expect.objectContaining({
      target_purchase_order_id: order.id,
    }));
  });
});

function dialogForApproval() {
  return within(screen.getByRole("dialog", { name: "Aprobar orden de compra" }));
}

describe("errores en los diálogos de compras y proveedores", () => {
  it("muestra el error al aprobar dentro de un diálogo", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: denied });
    render(<PurchasesWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Aprobar" }));
    fireEvent.click(dialogForApproval().getByRole("button", { name: "Aprobar orden" }));
    const dialog = within(await screen.findByRole("dialog", { name: "No se pudo aprobar la orden de compra" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("No tenés permiso para realizar esta acción.");
  });

  it("muestra el error de recepción dentro del diálogo", async () => {
    rows.purchase_orders = [{ ...order, purchase_approval_events: [{ action: "approved" }] }];
    mock.rpc.mockResolvedValue({ data: null, error: { message: "purchase receipts cannot target quarantine locations" } });
    render(<PurchasesWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Recepcionar" }));
    const dialog = within(screen.getByRole("dialog", { name: /Recibir mercadería/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Confirmar recepción" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Elegí una ubicación fuera de cuarentena para recibir la compra.");
  });

  it("muestra el error del alta de proveedor dentro del diálogo", async () => {
    mock.insert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });
    render(<PurchasesWorkspace activeModuleId="suppliers" />);
    await screen.findByRole("button", { name: "Ficha" });
    fireEvent.click(screen.getByRole("button", { name: "Nuevo proveedor" }));
    const dialog = within(screen.getByRole("dialog", { name: "Registrar proveedor" }));
    fireEvent.change(dialog.getByRole("textbox", { name: /Razón social/ }), { target: { value: "Proveedor nuevo" } });
    fireEvent.click(dialog.getByRole("button", { name: "Guardar proveedor" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Ya existe un registro con esos datos.");
  });

  it("muestra en su diálogo un error al cargar el historial o al preparar el pago", async () => {
    readErrors.supplier_payments = denied;
    mock.rpc.mockResolvedValue({ data: null, error: { message: "internal error" } });
    render(<PurchasesWorkspace activeModuleId="suppliers" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ficha" }));
    const details = within(screen.getByRole("dialog", { name: supplier.display_name }));
    expect(await details.findByRole("alert")).toHaveTextContent("No tenés permiso para realizar esta acción.");

    fireEvent.click(details.getByRole("button", { name: "Registrar pago" }));
    const dialog = within(screen.getByRole("dialog", { name: `Registrar pago a ${supplier.display_name}` }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("No se pudo preparar el pago al proveedor.");
    expect(dialog.getByRole("button", { name: "Confirmar pago" })).toBeDisabled();
  });

  it("explica la reversa y mantiene su error en el diálogo abierto", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: denied });
    render(<PurchasesWorkspace activeModuleId="suppliers" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ficha" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revertir" }));
    const dialog = within(screen.getByRole("dialog", { name: "Revertir pago a proveedor" }));
    expect(dialog.getByText("La reversa no borra el pago: registra un movimiento inverso en deuda, caja y contabilidad.")).toBeInTheDocument();
    fireEvent.change(dialog.getByRole("textbox", { name: /Motivo/ }), { target: { value: "Pago duplicado" } });
    fireEvent.click(dialog.getByRole("button", { name: "Confirmar reversa" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("No tenés permiso para realizar esta acción.");
  });

  it("muestra estado de carga en la tabla de órdenes sin mostrar vacío falso", async () => {
    let resolveOrders: (value: { data: unknown[]; error: null }) => void = () => {};
    mock.from.mockImplementation((table: string) => {
      if (table === "purchase_orders") {
        const pending = new Promise<{ data: unknown[]; error: null }>((resolve) => {
          resolveOrders = resolve;
        });
        const query = { select: () => query, eq: () => query, order: () => pending, then: pending.then.bind(pending) };
        return query;
      }
      const result = Promise.resolve({ data: rows[table] ?? [], error: null });
      const query = { select: () => query, eq: () => query, order: () => result, then: result.then.bind(result) };
      return query;
    });

    render(<PurchasesWorkspace />);
    expect(screen.getByText("Cargando órdenes de compra…")).toBeInTheDocument();
    expect(screen.queryByText("No hay órdenes de compra registradas en el ERP.")).not.toBeInTheDocument();

    resolveOrders({ data: [], error: null });
    expect(await screen.findByText("No hay órdenes de compra registradas en el ERP.")).toBeInTheDocument();
  });
});
