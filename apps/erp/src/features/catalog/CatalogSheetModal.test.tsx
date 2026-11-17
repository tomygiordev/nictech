import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CatalogSheetModal } from "./CatalogSheetModal";
import type { DbCatalogProduct } from "./schemas";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), publicUrl: vi.fn(), loadError: null as { code: string; message: string } | null }));
const color = { id: "60000000-0000-4000-8000-000000000006", name: "Negro" };
vi.mock("../../lib/supabase", () => ({ supabase: {
  rpc: mock.rpc,
  from: (table: string) => {
    const result = { data: table === "colors" ? [color] : [], error: mock.loadError };
    const chain = { select: () => chain, eq: () => chain, order: () => Promise.resolve(result),
      then: (resolve: (value: typeof result) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject) };
    return chain;
  },
  storage: { from: () => ({ upload: mock.upload, getPublicUrl: mock.publicUrl }) },
} }));
const category = { id: "10000000-0000-4000-8000-000000000001", code: "ACC", name: "Accesorios" };
const brand = { id: "20000000-0000-4000-8000-000000000002", code: "GEN", name: "Genérico" };
const product: DbCatalogProduct = { id: "90000000-0000-4000-8000-000000000009", internal_code: "ACC-001", internal_name: "Cable USB", public_name: null, public_description: "Anterior", category_id: category.id, brand_id: brand.id, base_sale_price: 100, tax_rate_percent: 21, is_active: true, item_kind: "product", inventory_tracking: "quantity", created_at: "2026-01-01", updated_at: "2026-01-01T00:00:00.123456+00:00", sheet_template: "accesorio", web_status: "draft", media_initialized: true };
const location = { id: "30000000-0000-4000-8000-000000000003", branch_id: "40000000-0000-4000-8000-000000000004", code: "DEP", name: "Depósito", allows_sale: true, is_active: true };
const renderSheet = (item: DbCatalogProduct | null = null, onClose = vi.fn()) => render(<CatalogSheetModal isOpen onClose={onClose} onSuccess={vi.fn()} product={item} categories={[category]} brands={[brand]} models={[]} locations={[location]} />);
const fill = () => { fireEvent.change(screen.getByLabelText("Categoría *"), { target: { value: category.id } }); fireEvent.change(screen.getByLabelText("Marca *"), { target: { value: brand.id } }); fireEvent.change(screen.getByLabelText("Nombre *"), { target: { value: "Cable USB" } }); fireEvent.change(screen.getByLabelText("Costo estimado ARS *"), { target: { value: "50" } }); };
beforeEach(() => { mock.loadError = null; mock.rpc.mockReset(); mock.upload.mockReset(); mock.publicUrl.mockReset(); mock.rpc.mockResolvedValue({ data: {}, error: null }); });
afterEach(cleanup);
describe("ficha guiada", () => {
  it("crea el producto con el RPC de ficha sin publicar", async () => {
    renderSheet(); await screen.findByRole("option", { name: "Negro" }); fill(); fireEvent.click(screen.getByRole("button", { name: "Guardar ficha" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_catalog_product_sheet", expect.objectContaining({ payload: expect.objectContaining({ internal_name: "Cable USB", base_cost: 50 }) })));
    expect(mock.rpc).not.toHaveBeenCalledWith("publish_catalog_product", expect.anything());
  });
  it("separa la descripción interna de la web", async () => {
    renderSheet(product); await screen.findByRole("option", { name: "Negro" });
    fireEvent.change(screen.getByLabelText("Descripción interna (no se publica)"), { target: { value: "Uso interno" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar ficha" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_catalog_product_sheet", { payload: { id: product.id, internal_description: "Uso interno" }, p_expected_updated_at: product.updated_at }));
  });
  it("envía el ingreso inicial por color y ubicación", async () => {
    renderSheet(); await screen.findByRole("option", { name: "Negro" }); fill();
    fireEvent.change(screen.getByLabelText("Color del catálogo"), { target: { value: color.id } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar color" }));
    fireEvent.change(screen.getByLabelText("Cantidad inicial Negro"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Ubicación inicial Negro"), { target: { value: location.id } });
    fireEvent.change(screen.getByLabelText("Costo unitario inicial Negro"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar ficha" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_catalog_product_sheet", expect.objectContaining({ payload: expect.objectContaining({ initial_stock: [expect.objectContaining({ quantity: 3, location_id: location.id, unit_cost: 12, variant_code: expect.any(String) })] }) })));
  });
  it("sin stock omite initial_stock y no cierra si falla el RPC", async () => {
    const onClose = vi.fn(); mock.rpc.mockResolvedValue({ data: null, error: { message: "Error al guardar" } });
    renderSheet(null, onClose); await screen.findByRole("option", { name: "Negro" }); fill();
    fireEvent.click(screen.getByRole("button", { name: "Guardar ficha" }));
    expect(await screen.findByText("Error al guardar")).toBeInTheDocument();
    expect(mock.rpc.mock.calls[0][1].payload).not.toHaveProperty("initial_stock");
    expect(onClose).not.toHaveBeenCalled();
  });
  it("muestra el checklist antes de publicar", async () => {
    mock.rpc.mockResolvedValue({ data: { ready: false, missing: ["missing_primary_image", "invalid_base_price"] }, error: null });
    renderSheet(product); await screen.findByRole("option", { name: "Negro" }); fireEvent.click(screen.getByRole("button", { name: "Publicar" }));
    expect(await screen.findByText("Falta la foto principal.")).toBeInTheDocument(); expect(screen.getByText("El precio debe ser mayor a cero.")).toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalledWith("publish_catalog_product", expect.anything());
  });
  it("editar descripción no envía nombre ni existencias y conserva timestamp exacto", async () => {
    renderSheet(product); await screen.findByRole("option", { name: "Negro" }); fireEvent.change(screen.getByLabelText("Descripción web"), { target: { value: "Nueva" } }); fireEvent.click(screen.getByRole("button", { name: "Guardar ficha" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_catalog_product_sheet", { payload: { id: product.id, public_description: "Nueva" }, p_expected_updated_at: product.updated_at }));
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Cable USB");
  });
  it("agregar color lo envía como variante de catálogo", async () => {
    renderSheet(); await screen.findByRole("option", { name: "Negro" }); fill(); fireEvent.change(screen.getByLabelText("Color del catálogo"), { target: { value: color.id } }); fireEvent.click(screen.getByRole("button", { name: "Agregar color" })); fireEvent.click(screen.getByRole("button", { name: "Guardar ficha" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_catalog_product_sheet", expect.objectContaining({ payload: expect.objectContaining({ variants: [expect.objectContaining({ color_id: color.id, name: "Negro", final_price_mode: "inherit" })] }) })));
  });
  it("si falla una foto informa el archivo y no llama al RPC", async () => {
    mock.upload.mockResolvedValue({ error: { message: "Storage no disponible" } }); renderSheet(); await screen.findByRole("option", { name: "Negro" }); fill();
    fireEvent.change(screen.getByLabelText("Agregar fotos"), { target: { files: [new File(["x"], "cable.jpg", { type: "image/jpeg" })] } }); fireEvent.click(screen.getByRole("button", { name: "Guardar ficha" }));
    expect(await screen.findByText(/No se pudo subir cable.jpg/)).toBeInTheDocument(); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("pausa un producto publicado", async () => {
    renderSheet({ ...product, web_status: "published" });
    await screen.findByRole("option", { name: "Negro" });
    fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("unpublish_catalog_product", { p_product_id: product.id }));
  });
  it("reanuda solo después del checklist", async () => {
    mock.rpc.mockResolvedValue({ data: { ready: true, missing: [] }, error: null });
    renderSheet({ ...product, web_status: "paused" });
    await screen.findByRole("option", { name: "Negro" });
    fireEvent.click(screen.getByRole("button", { name: "Reanudar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("publish_catalog_product", { p_product_id: product.id }));
    expect(mock.rpc.mock.calls[0][0]).toBe("get_catalog_publish_checklist");
  });
  it("muestra aviso si faltan las migraciones", async () => {
    mock.loadError = { code: "PGRST202", message: "unavailable" };
    renderSheet();
    expect(await screen.findByText("La ficha nueva requiere actualizar la base.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar ficha" })).toBeDisabled();
  });
  it("no sobrescribe el nombre editado al cambiar precio o foto", async () => {
    renderSheet();
    await screen.findByRole("option", { name: "Negro" });
    fill();
    fireEvent.change(screen.getByLabelText("Precio final ARS con IVA incluido *"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Agregar fotos"), { target: { files: [new File(["x"], "foto.jpg", { type: "image/jpeg" })] } });
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Cable USB");
  });

  it("confirma la recodificación en el diálogo del ERP", async () => {
    renderSheet(product);
    await screen.findByRole("option", { name: "Negro" });
    fireEvent.change(screen.getByLabelText("Nuevo código"), { target: { value: "ACC-002" } });
    fireEvent.click(screen.getByRole("button", { name: "Recodificar" }));
    expect(mock.rpc).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole("button", { name: "Recodificar" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("recode_catalog_product", { p_product_id: product.id, p_new_code: "ACC-002" }));
  });
  it("crea un color del catálogo mediante el RPC autorizado", async () => {
    mock.rpc.mockResolvedValue({ data: { id: "70000000-0000-4000-8000-000000000007", name: "Azul" }, error: null });
    renderSheet();
    await screen.findByRole("option", { name: "Negro" });
    fireEvent.change(screen.getByLabelText("Crear color nuevo"), { target: { value: "Azul" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear color" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_catalog_color", { p_name: "Azul" }));
    expect(await screen.findByRole("option", { name: "Azul" })).toBeInTheDocument();
  });

});
