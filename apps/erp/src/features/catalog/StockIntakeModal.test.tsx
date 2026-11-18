import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StockIntakeModal } from "./StockIntakeModal";
import type { DbCatalogProduct, MasterLocation } from "./schemas";

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ supabase: { rpc: rpcMock } }));

const mockLocations: MasterLocation[] = [
  { id: "40000000-0000-0000-0000-000000000004", branch_id: "50000000-0000-0000-0000-000000000005", code: "DEP-CEN", name: "Depósito Central", allows_sale: true, is_active: true },
];

const mockProduct: DbCatalogProduct = {
  id: "90000000-0000-0000-0000-000000000009",
  internal_code: "FUNDA-IP13",
  internal_name: "Funda Silicona iPhone 13",
  public_name: "Funda Apple Silicona Oficial",
  base_sale_price: 12100,
  base_cost: 4000,
  tax_rate_percent: 21,
  is_active: true,
  item_kind: "product",
  inventory_tracking: "quantity",
  created_at: new Date().toISOString(),
  product_variants: [
    {
      id: "80000000-0000-0000-0000-000000000008",
      code: "NEG",
      name: "Negro",
      price_delta: 0,
      is_active: true,
      product_identifiers: [{ kind: "barcode", value: "77912345" }],
    },
  ],
  stock_balances: [
    { quantity_on_hand: 5, quantity_reserved: 1, variant_id: "80000000-0000-0000-0000-000000000008", location_id: "40000000-0000-0000-0000-000000000004" },
  ],
};

const [central] = mockLocations;
const counter = { ...central, id: "40000000-0000-0000-0000-000000000006", name: "Mostrador", code: "MOST" };
const quarantine = { ...central, id: "40000000-0000-0000-0000-000000000007", name: "Cuarentena", allows_sale: false };
const inactive = { ...central, id: "40000000-0000-0000-0000-000000000008", name: "Depósito dado de baja", is_active: false };

const renderIntake = (locations: MasterLocation[]) => render(
  <StockIntakeModal isOpen product={mockProduct} locations={locations} onClose={vi.fn()} onSuccess={vi.fn()} />,
);

const fillStock = (quantity: string, unitCost: string) => {
  fireEvent.change(screen.getByLabelText(/Cantidad a ingresar/), { target: { value: quantity } });
  fireEvent.change(screen.getByLabelText(/Costo unitario/), { target: { value: unitCost } });
};

beforeEach(() => rpcMock.mockReset());
afterEach(cleanup);

describe("StockIntakeModal", () => {
  it("abre sin ubicación ni valores de stock precargados si hay varias ubicaciones vendibles", () => {
    renderIntake([quarantine, central, inactive, counter]);

    const select = screen.getByLabelText(/Ubicación de ingreso/);
    expect(select).toHaveValue("");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Elegí una ubicación…", "Depósito Central (DEP-CEN)", "Mostrador (MOST)",
    ]);
    expect(screen.getByLabelText(/Cantidad a ingresar/)).toHaveDisplayValue("");
    expect(screen.getByLabelText(/Costo unitario/)).toHaveDisplayValue("");
    expect(screen.queryByLabelText("Confirmo que el costo es cero")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar ingreso" }));
    expect(screen.getByText("Elegí una ubicación.")).toHaveAttribute("role", "alert");
    expect(screen.getByText("Ingresá la cantidad.")).toHaveAttribute("role", "alert");
    expect(screen.getByText("Ingresá el costo unitario.")).toHaveAttribute("role", "alert");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("preselecciona la única vendible y solo registra costo cero con confirmación vigente", async () => {
    rpcMock.mockResolvedValueOnce({ data: "doc-ok", error: null });
    renderIntake([quarantine, central, inactive]);

    expect(screen.getByLabelText(/Ubicación de ingreso/)).toHaveValue(central.id);
    fillStock("2", "0");
    const submit = screen.getByRole("button", { name: "Confirmar ingreso" });
    const confirm = () => screen.getByRole("checkbox", { name: "Confirmo que el costo es cero" });

    expect(confirm()).not.toBeChecked();
    fireEvent.click(submit);
    expect(screen.getByRole("alert")).toHaveTextContent("Confirmá que el costo es cero.");
    expect(rpcMock).not.toHaveBeenCalled();

    fireEvent.click(confirm());
    fillStock("2", "3");
    expect(screen.queryByRole("checkbox", { name: "Confirmo que el costo es cero" })).not.toBeInTheDocument();
    fillStock("2", "0.00");
    expect(confirm()).not.toBeChecked();
    fireEvent.click(confirm());
    fireEvent.click(submit);

    await waitFor(() => expect(rpcMock).toHaveBeenCalledExactlyOnceWith("post_stock_document", expect.objectContaining({
      lines: [expect.objectContaining({ quantity: 2, unit_cost: 0, to_location_id: central.id })],
    })));
  });

  it("bloquea cierre en pending y aplica guard síncrono para doble submit", async () => {
    let resolveRpc: (val: unknown) => void = () => {};
    const pendingPromise = new Promise((resolve) => {
      resolveRpc = resolve;
    });
    rpcMock.mockReturnValue(pendingPromise);

    const onClose = vi.fn();
    render(
      <StockIntakeModal
        isOpen={true}
        onClose={onClose}
        product={mockProduct}
        locations={mockLocations}
        onSuccess={vi.fn()}
      />,
    );

    fillStock("3", "12");
    const submitBtn = screen.getByRole("button", { name: "Confirmar ingreso" });
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    expect(rpcMock).toHaveBeenCalledTimes(1);

    // Verify closing while submitting is blocked
    const cancelBtn = screen.getByRole("button", { name: "Cancelar" });
    expect(cancelBtn).toBeDisabled();
    fireEvent.click(cancelBtn);
    expect(onClose).not.toHaveBeenCalled();

    resolveRpc({ data: "ok", error: null });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("tras fallo ambiguo congela payload y clave, reintentando envía EXACTAMENTE el mismo payload", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    // Step 1: Mock failure on first attempt
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Error de red: timeout en gateway", code: "504" },
    });

    render(
      <StockIntakeModal
        isOpen={true}
        onClose={onClose}
        product={mockProduct}
        locations={mockLocations}
        onSuccess={onSuccess}
      />,
    );

    fillStock("8", "12");
    fireEvent.change(screen.getByLabelText(/Motivo del ingreso/), { target: { value: "Recepción de proveedor lote 88" } });

    const submitBtn = screen.getByRole("button", { name: "Confirmar ingreso" });
    fireEvent.click(submitBtn);

    // Wait for error banner
    const alert = await within(screen.getByRole("dialog")).findByRole("alert");
    expect(alert.getAttribute("style")).toContain("--rose-accent");
    expect(alert).toHaveTextContent("Error de red: timeout en gateway");

    // Verify retry button is shown and inputs are frozen
    const retryBtn = await screen.findByRole("button", { name: "Reintentar ingreso" });
    expect(retryBtn).toBeInTheDocument();
    expect(screen.getByLabelText(/Cantidad a ingresar/)).toBeDisabled();
    expect(screen.getByLabelText(/Motivo del ingreso/)).toBeDisabled();

    // Inspect first payload sent
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const firstPayload = rpcMock.mock.calls[0][1];
    expect(firstPayload.lines[0].quantity).toBe(8);
    expect(firstPayload.operation_reason).toBe("Recepción de proveedor lote 88");
    const firstOpKey = firstPayload.operation_key;
    expect(firstOpKey).toBeTruthy();

    // Step 2: Mock success on retry
    rpcMock.mockResolvedValueOnce({
      data: "doc-ok",
      error: null,
    });

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledTimes(2);
    });

    // Verify second payload is IDENTICAL and reuses the EXACT SAME operation_key
    const secondPayload = rpcMock.mock.calls[1][1];
    expect(secondPayload.operation_key).toBe(firstOpKey);
    expect(secondPayload).toEqual(firstPayload);

    expect(onSuccess).toHaveBeenCalledWith(expect.stringContaining("Se agregaron 8 u."));
    expect(onClose).toHaveBeenCalled();
  });

  it("no permite cerrar sin advertencia cuando hay una operación con fallo ambiguo pendiente", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Conexión interrumpida", code: "NETWORK_ERR" },
    });

    const onClose = vi.fn();
    render(
      <StockIntakeModal
        isOpen={true}
        onClose={onClose}
        product={mockProduct}
        locations={mockLocations}
        onSuccess={vi.fn()}
      />,
    );

    fillStock("3", "12");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar ingreso" }));
    await screen.findByRole("alert");

    // Click cancel button while attempt is pending
    const cancelBtn = screen.getByRole("button", { name: /Cancelar \/ Descartar/i });
    fireEvent.click(cancelBtn);

    // Confirmation dialog should be presented
    expect(screen.getByText(/¿Descartar intento con resultado pendiente\?/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Clicking "Volver y reintentar" keeps the modal open
    fireEvent.click(screen.getByRole("button", { name: "Volver y reintentar" }));
    expect(screen.getByRole("button", { name: "Reintentar ingreso" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Clicking "Descartar de todas formas" confirms and closes
    fireEvent.click(screen.getByRole("button", { name: /Cancelar \/ Descartar/i }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar de todas formas" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("no preselecciona variante si hay varias y bloquea el envío hasta elegir una", async () => {
    rpcMock.mockResolvedValueOnce({ data: "doc-ok", error: null });
    const twoVariantsProduct: DbCatalogProduct = {
      ...mockProduct,
      product_variants: [
        ...mockProduct.product_variants!,
        {
          id: "80000000-0000-0000-0000-000000000009",
          code: "BLA",
          name: "Blanco",
          price_delta: 0,
          is_active: true,
        },
      ],
    };

    render(
      <StockIntakeModal
        isOpen={true}
        onClose={vi.fn()}
        product={twoVariantsProduct}
        locations={[central]}
        onSuccess={vi.fn()}
      />,
    );

    const variantSelect = screen.getByLabelText(/Variante/);
    expect(variantSelect).toHaveValue("");
    expect(within(variantSelect).getAllByRole("option")[0]).toHaveTextContent("Elegí una variante…");

    fillStock("4", "15");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar ingreso" }));
    expect(screen.getByText("Elegí una variante.")).toHaveAttribute("role", "alert");
    expect(rpcMock).not.toHaveBeenCalled();

    fireEvent.change(variantSelect, { target: { value: twoVariantsProduct.product_variants![1].id } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar ingreso" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledExactlyOnceWith("post_stock_document", expect.objectContaining({
      lines: [expect.objectContaining({ variant_id: "80000000-0000-0000-0000-000000000009", quantity: 4 })],
    })));
  });
});
