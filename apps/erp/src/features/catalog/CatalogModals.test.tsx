import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CreateProductModal } from "./CreateProductModal";
import { ProductEditModal } from "./ProductEditModal";
import { StockIntakeModal } from "./StockIntakeModal";
import { type DbCatalogProduct, type MasterCategory, type MasterBrand, type MasterModel, type MasterLocation } from "./schemas";

const { rpcMock, fromMock, updateMock, eqMock, selectMock, singleMock } = vi.hoisted(() => {
  const singleMock = vi.fn();
  const selectMock = vi.fn(() => ({ single: singleMock }));
  const eqMock = vi.fn(() => ({ select: selectMock }));
  const updateMock = vi.fn(() => ({ eq: eqMock }));
  const fromMock = vi.fn(() => ({
    update: updateMock,
  }));
  const rpcMock = vi.fn();

  return { rpcMock, fromMock, updateMock, eqMock, selectMock, singleMock };
});

vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
  },
}));

const mockCategories: MasterCategory[] = [
  { id: "10000000-0000-0000-0000-000000000001", code: "ACC", name: "Accesorios" },
];
const mockBrands: MasterBrand[] = [
  { id: "20000000-0000-0000-0000-000000000002", code: "APL", name: "Apple" },
];
const mockModels: MasterModel[] = [
  { id: "30000000-0000-0000-0000-000000000003", brand_id: "20000000-0000-0000-0000-000000000002", code: "IP13", name: "iPhone 13" },
];
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Catalog Modals Component Behavior", () => {
  it.each(["create", "edit"])("%s exige una marca antes de ofrecer modelos", (mode) => {
    const common = {
      isOpen: true,
      onClose: vi.fn(),
      categories: mockCategories,
      brands: mockBrands,
      models: mockModels,
      onSuccess: vi.fn(),
    };
    const { container } = render(mode === "create"
      ? <CreateProductModal {...common} />
      : <ProductEditModal {...common} product={mockProduct} />);
    const prefix = mode === "create" ? "prod-create" : "edit-prod";
    const brand = container.querySelector<HTMLSelectElement>(`#${prefix}-brand`)!;
    const model = container.querySelector<HTMLSelectElement>(`#${prefix}-model`)!;
    expect(model.options).toHaveLength(1);
    fireEvent.change(brand, { target: { value: mockBrands[0].id } });
    expect(model.options).toHaveLength(2);
    fireEvent.change(brand, { target: { value: "" } });
    expect(model.options).toHaveLength(1);
    expect(model.value).toBe("");
  });

  describe("CreateProductModal", () => {
    it("alta inválida no llama a RPC y muestra alerta accesible role=alert", async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <CreateProductModal
          isOpen={true}
          onClose={onClose}
          categories={mockCategories}
          brands={mockBrands}
          models={mockModels}
          locations={mockLocations}
          onSuccess={onSuccess}
        />,
      );

      // Submit form without filling required fields
      const submitBtn = screen.getByRole("button", { name: "Crear Artículo" });
      fireEvent.click(submitBtn);

      expect(rpcMock).not.toHaveBeenCalled();
      const alert = await screen.findByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("alta exitosa llama a RPC create_catalog_product_with_variants, nunca post_stock_document, y resetea", async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();

      rpcMock.mockResolvedValueOnce({
        data: {
          product_id: "new-prod-id",
          internal_code: "CARG-20W",
          internal_name: "Cargador Rápido 20W",
          variants: [],
        },
        error: null,
      });

      render(
        <CreateProductModal
          isOpen={true}
          onClose={onClose}
          categories={mockCategories}
          brands={mockBrands}
          models={mockModels}
          locations={mockLocations}
          onSuccess={onSuccess}
        />,
      );

      fireEvent.change(screen.getByLabelText(/Código Interno/i), { target: { value: "carg-20w" } });
      fireEvent.change(screen.getByLabelText(/Nombre del Artículo/i), { target: { value: "Cargador Rápido 20W" } });
      fireEvent.change(screen.getByLabelText(/Precio Final de Venta/i), { target: { value: "15000" } });

      fireEvent.click(screen.getByRole("button", { name: "Crear Artículo" }));

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledTimes(1);
      });

      expect(rpcMock).toHaveBeenCalledWith(
        "create_catalog_product_with_variants",
        expect.objectContaining({
          p_internal_code: "CARG-20W",
          p_internal_name: "Cargador Rápido 20W",
          p_base_sale_price: 15000,
        }),
      );

      // Verify post_stock_document is NEVER called
      expect(rpcMock).not.toHaveBeenCalledWith("post_stock_document", expect.anything());
      expect(onSuccess).toHaveBeenCalledWith(
        expect.stringContaining("Cargador Rápido 20W"),
        "new-prod-id",
      );
      expect(onClose).toHaveBeenCalled();
    });

    it("aplica guard síncrono para evitar doble submit en clics rápidos", async () => {
      let resolveRpc: (val: unknown) => void = () => {};
      const pendingPromise = new Promise((resolve) => {
        resolveRpc = resolve;
      });
      rpcMock.mockReturnValueOnce(pendingPromise);

      render(
        <CreateProductModal
          isOpen={true}
          onClose={vi.fn()}
          categories={mockCategories}
          brands={mockBrands}
          models={mockModels}
          onSuccess={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByLabelText(/Código Interno/i), { target: { value: "IPH-13" } });
      fireEvent.change(screen.getByLabelText(/Nombre del Artículo/i), { target: { value: "iPhone 13 128GB" } });
      fireEvent.change(screen.getByLabelText(/Precio Final de Venta/i), { target: { value: "950000" } });

      const submitBtn = screen.getByRole("button", { name: "Crear Artículo" });
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);

      expect(rpcMock).toHaveBeenCalledTimes(1);
      resolveRpc({ data: { product_id: "ip13", internal_code: "IPH-13", internal_name: "iPhone 13 128GB" }, error: null });
    });

    it("muestra mensaje útil de error Supabase .message sin caer en texto genérico", async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { message: "violates unique constraint 'products_internal_code_key'", code: "23505" },
      });

      render(
        <CreateProductModal
          isOpen={true}
          onClose={vi.fn()}
          categories={mockCategories}
          brands={mockBrands}
          models={mockModels}
          onSuccess={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByLabelText(/Código Interno/i), { target: { value: "DUP-01" } });
      fireEvent.change(screen.getByLabelText(/Nombre del Artículo/i), { target: { value: "Articulo Duplicado" } });
      fireEvent.change(screen.getByLabelText(/Precio Final de Venta/i), { target: { value: "5000" } });

      fireEvent.click(screen.getByRole("button", { name: "Crear Artículo" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("violates unique constraint 'products_internal_code_key'");
    });
  });

  describe("ProductEditModal", () => {
    it("preserva public_name existente y no lo sobrescribe con internal_name al editar precio", async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();

      singleMock.mockResolvedValueOnce({ data: { id: mockProduct.id }, error: null });

      render(
        <ProductEditModal
          isOpen={true}
          onClose={onClose}
          product={mockProduct}
          categories={mockCategories}
          brands={mockBrands}
          models={mockModels}
          onSuccess={onSuccess}
        />,
      );

      // Change price
      fireEvent.change(screen.getByLabelText(/Precio Final de Venta/i), { target: { value: "14500" } });

      fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }));

      await waitFor(() => {
        expect(updateMock).toHaveBeenCalled();
      });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          internal_name: "Funda Silicona iPhone 13",
          public_name: "Funda Apple Silicona Oficial", // PRESERVED! Not overwritten with internal_name
          base_sale_price: 14500,
        }),
      );
      expect(eqMock).toHaveBeenCalledWith("id", mockProduct.id);
      expect(updateMock).not.toHaveBeenCalledWith(expect.objectContaining({ updated_at: expect.anything() }));
      expect(selectMock).toHaveBeenCalledWith("id");
      expect(singleMock).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
    });

    it("falla con alert y no reporta éxito cuando .single() retorna error por 0 filas (RLS)", async () => {
      const onSuccess = vi.fn();
      singleMock.mockResolvedValueOnce({
        data: null,
        error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
      });

      render(
        <ProductEditModal
          isOpen={true}
          onClose={vi.fn()}
          product={mockProduct}
          categories={mockCategories}
          brands={mockBrands}
          models={mockModels}
          onSuccess={onSuccess}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("multiple (or no) rows returned");
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("muestra precio con delta legacy si la variante antigua tiene price_delta != 0", () => {
      const productWithLegacyDelta: DbCatalogProduct = {
        ...mockProduct,
        tax_rate_percent: 10.5,
        base_sale_price: 10000,
        product_variants: [
          {
            id: "v-legacy",
            code: "DOR",
            name: "Dorado Edición Especial",
            price_delta: 1500,
            is_active: true,
          },
        ],
      };

      render(
        <ProductEditModal
          isOpen={true}
          onClose={vi.fn()}
          product={productWithLegacyDelta}
          categories={mockCategories}
          brands={mockBrands}
          models={mockModels}
          onSuccess={vi.fn()}
        />,
      );

      // Check legacy delta indicator is visible and not claiming pure inheritance
      expect(screen.getByText(/delta legacy: \+1500/i)).toBeInTheDocument();
      // Check real tax rate is displayed
      expect(screen.getByText(/IVA 10.5%/i)).toBeInTheDocument();
    });
  });

  describe("StockIntakeModal", () => {
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

      const submitBtn = screen.getByRole("button", { name: "Confirmar Ingreso" });
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

      fireEvent.change(screen.getByLabelText(/Cantidad a Ingresar/i), { target: { value: "8" } });
      fireEvent.change(screen.getByLabelText(/Motivo de Auditoría/i), { target: { value: "Recepción de proveedor lote 88" } });

      const submitBtn = screen.getByRole("button", { name: "Confirmar Ingreso" });
      fireEvent.click(submitBtn);

      // Wait for error banner
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Error de red: timeout en gateway");

      // Verify retry button is shown and inputs are frozen
      const retryBtn = await screen.findByRole("button", { name: /Reintentar Operación/i });
      expect(retryBtn).toBeInTheDocument();
      expect(screen.getByLabelText(/Cantidad a Ingresar/i)).toBeDisabled();
      expect(screen.getByLabelText(/Motivo de Auditoría/i)).toBeDisabled();

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

      fireEvent.click(screen.getByRole("button", { name: "Confirmar Ingreso" }));
      await screen.findByRole("alert");

      // Click cancel button while attempt is pending
      const cancelBtn = screen.getByRole("button", { name: /Cancelar \/ Descartar/i });
      fireEvent.click(cancelBtn);

      // Confirmation dialog should be presented
      expect(screen.getByText(/¿Descartar intento con resultado pendiente\?/i)).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();

      // Clicking "Volver y Reintentar" keeps the modal open
      fireEvent.click(screen.getByRole("button", { name: "Volver y Reintentar" }));
      expect(screen.getByRole("button", { name: /Reintentar Operación/i })).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();

      // Clicking "Descartar de Todas Formas" confirms and closes
      fireEvent.click(screen.getByRole("button", { name: /Cancelar \/ Descartar/i }));
      fireEvent.click(screen.getByRole("button", { name: "Descartar de Todas Formas" }));
      expect(onClose).toHaveBeenCalled();
    });
  });
});
