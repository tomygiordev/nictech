import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CreateProductModal } from "./CreateProductModal";
import { ProductEditModal } from "./ProductEditModal";
import { StockIntakeModal } from "./StockIntakeModal";
import { ProductCompatibilityModal } from "./ProductCompatibilityModal";
import { ProductVariantsModal } from "./ProductVariantsModal";
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
  { id: "20000000-0000-0000-0000-000000000009", code: "SAM", name: "Samsung" },
];
const mockModels: MasterModel[] = [
  { id: "30000000-0000-0000-0000-000000000003", brand_id: "20000000-0000-0000-0000-000000000002", code: "IP13", name: "iPhone 13" },
  { id: "30000000-0000-0000-0000-000000000004", brand_id: "20000000-0000-0000-0000-000000000009", code: "S22", name: "Galaxy S22" },
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

    it("permite ingresar y enviar SKU en alta de producto con variante de precio propio", async () => {
      rpcMock.mockResolvedValueOnce({
        data: { product_id: "prod-sku-1", internal_code: "FUNDA-PRO", internal_name: "Funda Pro" },
        error: null,
      });

      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <CreateProductModal
          isOpen={true}
          onClose={onClose}
          categories={mockCategories}
          brands={mockBrands}
          models={mockModels}
          onSuccess={onSuccess}
        />,
      );

      fireEvent.change(screen.getByLabelText(/Código Interno/i), { target: { value: "FUNDA-PRO" } });
      fireEvent.change(screen.getByLabelText(/Nombre del Artículo/i), { target: { value: "Funda Pro" } });
      fireEvent.change(screen.getByLabelText(/Precio Final de Venta/i), { target: { value: "10000" } });

      // Enable variants
      const checkbox = screen.getByRole("checkbox", { name: /Este artículo tiene variantes/i });
      fireEvent.click(checkbox);

      // In the first variant row:
      // Fill SKU
      const skuInput = screen.getByLabelText("SKU de variante 1");
      fireEvent.change(skuInput, { target: { value: "SKU-FUNDA-NEG" } });

      // Select price mode 'own'
      const modeSelect = screen.getByLabelText("Modo de precio para variante 1");
      fireEvent.change(modeSelect, { target: { value: "own" } });

      // Fill own price
      const ownPriceInput = screen.getByLabelText("Precio final ARS propio de variante 1");
      fireEvent.change(ownPriceInput, { target: { value: "14500" } });

      // Submit
      fireEvent.click(screen.getByRole("button", { name: "Crear Artículo" }));

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith(
          "create_catalog_product_with_variants",
          expect.objectContaining({
            p_internal_code: "FUNDA-PRO",
            p_internal_name: "Funda Pro",
            p_base_sale_price: 10000,
            p_variants: expect.arrayContaining([
              expect.objectContaining({
                name: "Negro",
                code: "NEG",
                sku: "SKU-FUNDA-NEG",
                final_price_mode: "own",
                final_price_ars: 14500,
              }),
            ]),
          }),
        );
        expect(onSuccess).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
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

  describe("ProductCompatibilityModal", () => {
    it("carga modelos compatibles existentes desde el servidor al abrir", async () => {
      rpcMock.mockResolvedValueOnce({
        data: [
          {
            id: "compat-1",
            model_id: mockModels[0].id,
            model_code: mockModels[0].code,
            model_name: mockModels[0].name,
            brand_id: mockBrands[0].id,
            brand_name: mockBrands[0].name,
          },
        ],
        error: null,
      });

      render(
        <ProductCompatibilityModal
          isOpen={true}
          onClose={vi.fn()}
          product={mockProduct}
          brands={mockBrands}
          models={mockModels}
          onSuccess={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("get_product_compatible_models", {
          p_product_id: mockProduct.id,
        });
      });

      expect(screen.getAllByText("iPhone 13").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByLabelText("Quitar iPhone 13")).toBeInTheDocument();
      expect(screen.getByText(/Modelos Compatibles Seleccionados \(1\)/i)).toBeInTheDocument();
    });

    it("muestra estado de error con botón de reintentar si falla la carga inicial", async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { message: "Error al consultar base de datos", code: "PGRST_ERR" },
      });

      render(
        <ProductCompatibilityModal
          isOpen={true}
          onClose={vi.fn()}
          product={mockProduct}
          brands={mockBrands}
          models={mockModels}
          onSuccess={vi.fn()}
        />,
      );

      await screen.findByRole("alert");
      expect(screen.getByText(/Error al consultar base de datos/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Reintentar/i })).toBeInTheDocument();
    });

    it("permite seleccionar modelos y guarda vía set_product_compatible_models", async () => {
      // 1. Initial get call
      rpcMock.mockResolvedValueOnce({
        data: [],
        error: null,
      });
      // 2. Set call
      rpcMock.mockResolvedValueOnce({
        data: { product_id: mockProduct.id, compatible_model_ids: [mockModels[0].id] },
        error: null,
      });

      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <ProductCompatibilityModal
          isOpen={true}
          onClose={onClose}
          product={mockProduct}
          brands={mockBrands}
          models={mockModels}
          onSuccess={onSuccess}
        />,
      );

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("get_product_compatible_models", {
          p_product_id: mockProduct.id,
        });
      });

      // Click on model to toggle selection
      const modelItem = screen.getByText(mockModels[0].name);
      fireEvent.click(modelItem);

      expect(screen.getByText(/Modelos Compatibles Seleccionados \(1\)/i)).toBeInTheDocument();

      // Submit
      fireEvent.click(screen.getByRole("button", { name: "Guardar Compatibilidades" }));

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("set_product_compatible_models", {
          p_product_id: mockProduct.id,
          p_model_ids: [mockModels[0].id],
          p_expected_updated_at: null,
        });
        expect(onSuccess).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("maneja conflicto de concurrencia enviando snapshot real y ofreciendo recarga sin borrar selección", async () => {
      const productWithTimestamp: DbCatalogProduct = {
        ...mockProduct,
        updated_at: "2026-10-20T15:30:00.000Z",
      };

      // 1. Initial load
      rpcMock.mockResolvedValueOnce({
        data: [],
        error: null,
      });
      // 2. Set call fails with concurrency conflict
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { message: "concurrency conflict: product was modified by another operation", code: "P0001" },
      });
      // 3. Reload after conflict
      rpcMock.mockResolvedValueOnce({
        data: [
          {
            id: "compat-server",
            model_id: mockModels[1].id,
            model_code: mockModels[1].code,
            model_name: mockModels[1].name,
            brand_id: mockBrands[0].id,
            brand_name: mockBrands[0].name,
          },
        ],
        error: null,
      });

      render(
        <ProductCompatibilityModal
          isOpen={true}
          onClose={vi.fn()}
          product={productWithTimestamp}
          brands={mockBrands}
          models={mockModels}
          onSuccess={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("get_product_compatible_models", {
          p_product_id: productWithTimestamp.id,
        });
      });

      // User selects model 0
      fireEvent.click(screen.getByText(mockModels[0].name));
      expect(screen.getByText(/Modelos Compatibles Seleccionados \(1\)/i)).toBeInTheDocument();

      // Submit with optimistic concurrency timestamp
      fireEvent.click(screen.getByRole("button", { name: "Guardar Compatibilidades" }));

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("set_product_compatible_models", {
          p_product_id: productWithTimestamp.id,
          p_model_ids: [mockModels[0].id],
          p_expected_updated_at: "2026-10-20T15:30:00.000Z",
        });
      });

      // Error banner is shown with reload button
      expect(await screen.findByText(/concurrency conflict/i)).toBeInTheDocument();
      // Selection MUST NOT be wiped on failure
      expect(screen.getByText(/Modelos Compatibles Seleccionados \(1\)/i)).toBeInTheDocument();

      // Click reload button
      const reloadBtn = screen.getByRole("button", { name: /Recargar del servidor/i });
      fireEvent.click(reloadBtn);

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe("ProductVariantsModal", () => {
    it("muestra variantes existentes, permite pausar y agregar una nueva variante", async () => {
      rpcMock.mockResolvedValueOnce({
        data: {
          product_id: mockProduct.id,
          variants: [
            { id: mockProduct.product_variants![0].id, code: "NEG", name: "Negro", is_active: false, barcode: "77912345" },
            { id: "new-var-id", code: "BLA", name: "Blanco", is_active: true, barcode: "77999999" },
          ],
        },
        error: null,
      });

      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <ProductVariantsModal
          isOpen={true}
          onClose={onClose}
          product={mockProduct}
          onSuccess={onSuccess}
        />,
      );

      // Verify existing variant is rendered
      expect(screen.getByDisplayValue("Negro")).toBeInTheDocument();
      expect(screen.getByDisplayValue("NEG")).toBeInTheDocument();
      expect(screen.getByDisplayValue("77912345")).toBeInTheDocument();

      // Toggle pause button
      const pauseBtn = screen.getByRole("button", { name: /Pausar/i });
      fireEvent.click(pauseBtn);
      expect(screen.getByRole("button", { name: /Reactivar/i })).toBeInTheDocument();

      // Add new variant
      const colorInput = screen.getByPlaceholderText(/Color \(ej: Negro Mate\)/i);
      const codeInput = screen.getByPlaceholderText(/Código \(ej: NEG\)/i);
      const barcodeInput = screen.getByPlaceholderText(/Código de barras \(opcional\)/i);
      const addBtn = screen.getByRole("button", { name: /Añadir/i });

      fireEvent.change(colorInput, { target: { value: "Blanco" } });
      fireEvent.change(codeInput, { target: { value: "bla" } });
      fireEvent.change(barcodeInput, { target: { value: "77999999" } });
      fireEvent.click(addBtn);

      expect(screen.getByDisplayValue("Blanco")).toBeInTheDocument();
      expect(screen.getByDisplayValue("BLA")).toBeInTheDocument();

      // Submit
      fireEvent.click(screen.getByRole("button", { name: "Guardar Variantes y Estados" }));

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("manage_product_variants", {
          p_product_id: mockProduct.id,
          p_expected_updated_at: null,
          p_variants: [
            {
              id: mockProduct.product_variants![0].id,
              name: "Negro",
              code: "NEG",
              barcode: "77912345",
              is_active: false,
            },
            {
              id: null,
              name: "Blanco",
              code: "BLA",
              barcode: "77999999",
              is_active: true,
            },
          ],
        });
        expect(onSuccess).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("rechaza agregar variantes con códigos duplicados en el cliente", () => {
      render(
        <ProductVariantsModal
          isOpen={true}
          onClose={vi.fn()}
          product={mockProduct}
          onSuccess={vi.fn()}
        />,
      );

      const colorInput = screen.getByPlaceholderText(/Color \(ej: Negro Mate\)/i);
      const codeInput = screen.getByPlaceholderText(/Código \(ej: NEG\)/i);
      const addBtn = screen.getByRole("button", { name: /Añadir/i });

      // Attempt to add duplicate code NEG
      fireEvent.change(colorInput, { target: { value: "Negro Nuevo" } });
      fireEvent.change(codeInput, { target: { value: "neg" } });
      fireEvent.click(addBtn);

      expect(screen.getByText(/El código 'NEG' ya se encuentra asignado en la lista/i)).toBeInTheDocument();
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("clear -> reabrir -> guardar sigue sin barcode y no revive barcode borrado", async () => {
      // Product where variant had its barcode cleared/deactivated previously
      const productWithDeactivatedBarcode: DbCatalogProduct = {
        ...mockProduct,
        product_variants: [
          {
            id: "80000000-0000-0000-0000-000000000008",
            code: "NEG",
            name: "Negro",
            price_delta: 0,
            is_active: true,
            product_identifiers: [
              {
                id: "70000000-0000-0000-0000-000000000007",
                kind: "barcode",
                value: "77912345",
                is_active: false,
                is_primary: false,
              },
            ],
          },
        ],
      };

      rpcMock.mockResolvedValueOnce({
        data: {
          product_id: productWithDeactivatedBarcode.id,
          variants: [
            { id: "80000000-0000-0000-0000-000000000008", code: "NEG", name: "Negro", is_active: true, barcode: null },
          ],
        },
        error: null,
      });

      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <ProductVariantsModal
          isOpen={true}
          onClose={onClose}
          product={productWithDeactivatedBarcode}
          onSuccess={onSuccess}
        />,
      );

      // Verify the input is empty (not showing the deactivated barcode 77912345)
      expect(screen.queryByDisplayValue("77912345")).not.toBeInTheDocument();

      // Submit without adding a barcode
      fireEvent.click(screen.getByRole("button", { name: "Guardar Variantes y Estados" }));

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("manage_product_variants", {
          p_product_id: productWithDeactivatedBarcode.id,
          p_expected_updated_at: null,
          p_variants: [
            {
              id: "80000000-0000-0000-0000-000000000008",
              name: "Negro",
              code: "NEG",
              barcode: null,
              is_active: true,
            },
          ],
        });
        expect(onSuccess).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("permite cambiar barcode y envía nuevo valor preservando la variante", async () => {
      rpcMock.mockResolvedValueOnce({
        data: {
          product_id: mockProduct.id,
          variants: [
            { id: mockProduct.product_variants![0].id, code: "NEG", name: "Negro", is_active: true, barcode: "77988888" },
          ],
        },
        error: null,
      });

      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <ProductVariantsModal
          isOpen={true}
          onClose={onClose}
          product={mockProduct}
          onSuccess={onSuccess}
        />,
      );

      const barcodeInput = screen.getByDisplayValue("77912345");
      fireEvent.change(barcodeInput, { target: { value: "77988888" } });

      fireEvent.click(screen.getByRole("button", { name: "Guardar Variantes y Estados" }));

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("manage_product_variants", {
          p_product_id: mockProduct.id,
          p_expected_updated_at: null,
          p_variants: [
            {
              id: mockProduct.product_variants![0].id,
              name: "Negro",
              code: "NEG",
              barcode: "77988888",
              is_active: true,
            },
          ],
        });
        expect(onSuccess).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("maneja error de conflicto global de barcode del servidor mostrando mensaje sin perder edición", async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { message: "barcode 77999999 is already assigned to another catalog item", code: "23505" },
      });

      render(
        <ProductVariantsModal
          isOpen={true}
          onClose={vi.fn()}
          product={mockProduct}
          onSuccess={vi.fn()}
        />,
      );

      const barcodeInput = screen.getByDisplayValue("77912345");
      fireEvent.change(barcodeInput, { target: { value: "77999999" } });

      fireEvent.click(screen.getByRole("button", { name: "Guardar Variantes y Estados" }));

      await waitFor(() => {
        expect(screen.getByText(/barcode 77999999 is already assigned to another catalog item/i)).toBeInTheDocument();
      });

      // Data is NOT lost on conflict
      expect(screen.getByDisplayValue("77999999")).toBeInTheDocument();
    });

    it("permite fijar precio propio final ARS para una variante y enviarlo en el payload", async () => {
      rpcMock.mockResolvedValueOnce({
        data: {
          product_id: mockProduct.id,
          variants: [
            { id: mockProduct.product_variants![0].id, code: "NEG", name: "Negro", is_active: true, barcode: "77912345", final_price_ars: 16500 },
          ],
        },
        error: null,
      });

      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <ProductVariantsModal
          isOpen={true}
          onClose={onClose}
          product={mockProduct}
          onSuccess={onSuccess}
        />,
      );

      // Cambiar modo de precio a "own"
      const priceModeSelect = screen.getByLabelText("Modo de precio para variante Negro");
      fireEvent.change(priceModeSelect, { target: { value: "own" } });

      // Ingresar precio propio 16500
      const ownPriceInput = screen.getByLabelText("Precio propio para variante Negro");
      fireEvent.change(ownPriceInput, { target: { value: "16500" } });

      fireEvent.click(screen.getByRole("button", { name: "Guardar Variantes y Estados" }));

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("manage_product_variants", {
          p_product_id: mockProduct.id,
          p_expected_updated_at: null,
          p_variants: [
            {
              id: mockProduct.product_variants![0].id,
              name: "Negro",
              code: "NEG",
              barcode: "77912345",
              is_active: true,
              final_price_mode: "own",
              final_price_ars: 16500,
            },
          ],
        });
        expect(onSuccess).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("permite cambiar variante de precio propio a heredar y envía final_price_mode: inherit y final_price_ars: null", async () => {
      const productWithOwnVariant: DbCatalogProduct = {
        ...mockProduct,
        product_variants: [
          {
            id: "80000000-0000-0000-0000-000000000008",
            code: "NEG",
            name: "Negro",
            price_delta: 0,
            final_price_ars: 16500,
            is_active: true,
            product_identifiers: [{ kind: "barcode", value: "77912345" }],
          },
        ],
      };

      rpcMock.mockResolvedValueOnce({
        data: {
          product_id: productWithOwnVariant.id,
          variants: [
            { id: "80000000-0000-0000-0000-000000000008", code: "NEG", name: "Negro", is_active: true, barcode: "77912345", final_price_ars: null },
          ],
        },
        error: null,
      });

      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <ProductVariantsModal
          isOpen={true}
          onClose={onClose}
          product={productWithOwnVariant}
          onSuccess={onSuccess}
        />,
      );

      // Cambiar modo de precio de "own" a "inherit"
      const priceModeSelect = screen.getByLabelText("Modo de precio para variante Negro");
      fireEvent.change(priceModeSelect, { target: { value: "inherit" } });

      fireEvent.click(screen.getByRole("button", { name: "Guardar Variantes y Estados" }));

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("manage_product_variants", {
          p_product_id: productWithOwnVariant.id,
          p_expected_updated_at: null,
          p_variants: [
            {
              id: "80000000-0000-0000-0000-000000000008",
              name: "Negro",
              code: "NEG",
              barcode: "77912345",
              is_active: true,
              final_price_mode: "inherit",
              final_price_ars: null,
            },
          ],
        });
        expect(onSuccess).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("valida que precio propio no sea vacío ni negativo y acepta 0 en formulario real", async () => {
      render(
        <ProductVariantsModal
          isOpen={true}
          onClose={vi.fn()}
          product={mockProduct}
          onSuccess={vi.fn()}
        />,
      );

      // Cambiar modo a "own"
      const priceModeSelect = screen.getByLabelText("Modo de precio para variante Negro");
      fireEvent.change(priceModeSelect, { target: { value: "own" } });

      // Vaciar precio propio
      const ownPriceInput = screen.getByLabelText("Precio propio para variante Negro");
      fireEvent.change(ownPriceInput, { target: { value: "" } });

      fireEvent.click(screen.getByRole("button", { name: "Guardar Variantes y Estados" }));

      // Alert role must show error
      expect(await screen.findByRole("alert")).toHaveTextContent("Debe ingresar un precio propio válido para la variante.");
      expect(rpcMock).not.toHaveBeenCalled();

      // Poner negativo
      fireEvent.change(ownPriceInput, { target: { value: "-50" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar Variantes y Estados" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("no puede ser menor a 0");
      expect(rpcMock).not.toHaveBeenCalled();

      // Poner 0 (válido)
      rpcMock.mockResolvedValueOnce({
        data: {
          product_id: mockProduct.id,
          variants: [{ id: "80000000-0000-0000-0000-000000000008", code: "NEG", name: "Negro", is_active: true, barcode: "77912345", final_price_ars: 0 }],
        },
        error: null,
      });

      fireEvent.change(ownPriceInput, { target: { value: "0" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar Variantes y Estados" }));

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("manage_product_variants", expect.objectContaining({
          p_variants: [
            expect.objectContaining({
              final_price_mode: "own",
              final_price_ars: 0,
            }),
          ],
        }));
      });
    });
  });
});
