import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CatalogSheetModal } from "./CatalogSheetModal";
import type { DbCatalogProduct, MasterLocation } from "./schemas";

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
const quarantine = { ...location, id: "30000000-0000-4000-8000-000000000006", name: "Cuarentena de canjes", allows_sale: false };
const inactive = { ...location, id: "30000000-0000-4000-8000-000000000007", name: "Depósito inactivo", is_active: false };
const counter = { ...location, id: "30000000-0000-4000-8000-000000000008", name: "Mostrador" };
const renderSheet = (item: DbCatalogProduct | null = null, onClose = vi.fn(), locations: MasterLocation[] = [location]) => render(<CatalogSheetModal isOpen onClose={onClose} onSuccess={vi.fn()} product={item} categories={[category]} brands={[brand]} models={[]} locations={locations} />);
const fill = () => { fireEvent.change(screen.getByLabelText("Categoría (obligatorio)"), { target: { value: category.id } }); fireEvent.change(screen.getByLabelText("Marca (obligatorio)"), { target: { value: brand.id } }); fireEvent.change(screen.getByLabelText("Nombre (obligatorio)"), { target: { value: "Cable USB" } }); fireEvent.change(screen.getByLabelText("Costo estimado ARS (obligatorio)"), { target: { value: "50" } }); };
const addColor = () => {
  fireEvent.change(screen.getByLabelText("Color del catálogo"), { target: { value: color.id } });
  fireEvent.click(screen.getByRole("button", { name: "Agregar color" }));
};
const save = () => fireEvent.click(screen.getByRole("button", { name: "Guardar ficha" }));
beforeEach(() => { mock.loadError = null; mock.rpc.mockReset(); mock.upload.mockReset(); mock.publicUrl.mockReset(); mock.rpc.mockResolvedValue({ data: {}, error: null }); });
afterEach(cleanup);
describe("ficha guiada", () => {
  it("muestra el error de categoría junto al campo y con estilo de error", async () => {
    renderSheet();
    await screen.findByRole("option", { name: "Negro" });
    fill();
    const select = screen.getByLabelText("Categoría (obligatorio)");
    fireEvent.change(select, { target: { value: "" } });
    save();

    const alert = await screen.findByText("Elegí una categoría.");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.getAttribute("style")).toContain("--rose-text");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAccessibleDescription("Elegí una categoría.");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("solo ofrece ubicaciones activas de venta y no elige una si hay varias", async () => {
    renderSheet(null, vi.fn(), [quarantine, location, inactive, counter]);
    await screen.findByRole("option", { name: "Negro" });
    addColor();

    const select = screen.getByLabelText("Ubicación inicial Negro");
    expect(select).toHaveValue("");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Elegí una ubicación…", "Depósito", "Mostrador",
    ]);
    expect(screen.getByLabelText("Sirve para")).toHaveClass("erp-form-select");
  });
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
    renderSheet(null, vi.fn(), [quarantine, location, inactive]); await screen.findByRole("option", { name: "Negro" }); fill();
    addColor();
    expect(screen.getByLabelText("Ubicación inicial Negro")).toHaveValue(location.id);
    expect(screen.getByLabelText("Cantidad inicial Negro")).toHaveDisplayValue("");
    expect(screen.getByLabelText("Costo unitario inicial Negro")).toHaveDisplayValue("");
    fireEvent.change(screen.getByLabelText("Cantidad inicial Negro"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Costo unitario inicial Negro"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar ficha" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_catalog_product_sheet", expect.objectContaining({ payload: expect.objectContaining({ initial_stock: [expect.objectContaining({ quantity: 3, location_id: location.id, unit_cost: 12, variant_code: expect.any(String) })] }) })));
  });
  it("pide costo inicial explícito y confirma el costo cero antes de guardar", async () => {
    renderSheet();
    await screen.findByRole("option", { name: "Negro" });
    fill();
    addColor();
    fireEvent.change(screen.getByLabelText("Cantidad inicial Negro"), { target: { value: "3" } });
    save();
    expect(await screen.findByText("Ingresá el costo unitario.")).toHaveAttribute("role", "alert");
    expect(mock.rpc).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Costo unitario inicial Negro"), { target: { value: "0" } });
    save();
    expect(await screen.findByText("Confirmá que el costo es cero.")).toHaveAttribute("role", "alert");
    expect(mock.rpc).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Confirmo que el costo es cero" }));
    save();
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_catalog_product_sheet", expect.objectContaining({
      payload: expect.objectContaining({ initial_stock: [expect.objectContaining({ unit_cost: 0 })] }),
    })));
  });
  it("sin stock omite initial_stock y no cierra si falla el RPC", async () => {
    const onClose = vi.fn(); mock.rpc.mockResolvedValue({ data: null, error: { message: "Error al guardar" } });
    renderSheet(null, onClose); await screen.findByRole("option", { name: "Negro" }); fill();
    fireEvent.click(screen.getByRole("button", { name: "Guardar ficha" }));
    const alert = await within(screen.getByRole("dialog")).findByRole("alert");
    expect(alert).toHaveTextContent("Error al guardar");
    expect(alert.getAttribute("style")).toContain("--rose-text");
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
    expect(screen.getByLabelText("Nombre (obligatorio)")).toHaveValue("Cable USB");
  });
  it("agregar color lo envía como variante de catálogo", async () => {
    renderSheet(); await screen.findByRole("option", { name: "Negro" }); fill(); fireEvent.change(screen.getByLabelText("Color del catálogo"), { target: { value: color.id } }); fireEvent.click(screen.getByRole("button", { name: "Agregar color" })); fireEvent.click(screen.getByRole("button", { name: "Guardar ficha" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_catalog_product_sheet", expect.objectContaining({ payload: expect.objectContaining({ variants: [expect.objectContaining({ color_id: color.id, name: "Negro", final_price_mode: "inherit" })] }) })));
    expect(mock.rpc.mock.calls[0][1].payload).not.toHaveProperty("initial_stock");
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
    fireEvent.change(screen.getByLabelText("Precio final ARS con IVA incluido (obligatorio)"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Agregar fotos"), { target: { files: [new File(["x"], "foto.jpg", { type: "image/jpeg" })] } });
    expect(screen.getByLabelText("Nombre (obligatorio)")).toHaveValue("Cable USB");
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
