import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DocumentsWorkspace } from "./DocumentsWorkspace";
import { ErpAuthContext } from "../../auth/ErpAuthContext";
import type { DocumentRecord } from "./api";

const mocks = vi.hoisted(() => ({
  docs: [] as DocumentRecord[],
  voidDocument: vi.fn(),
  cancelSale: vi.fn(),
  issueDocument: vi.fn(),
  requestFiscalIssuance: vi.fn(),
}));

vi.mock("./api", () => ({
  listDocuments: vi.fn(async () => mocks.docs),
  listDocumentTemplates: vi.fn(async () => [
    {
      id: "tpl-1",
      organization_id: "org-1",
      code: "FAC",
      name: "Factura",
      document_kind: "sale",
      is_active: true,
      created_at: "2026-11-18T10:00:00Z",
    },
  ]),
  listDocumentTemplateVersions: vi.fn(async () => [
    {
      id: "ver-1",
      organization_id: "org-1",
      template_id: "tpl-1",
      version: 1,
      definition: {},
      created_at: "2026-11-18T10:00:00Z",
    },
  ]),
  listFiscalPoints: vi.fn(async () => [
    {
      id: "fp-1",
      organization_id: "org-1",
      branch_id: "branch-1",
      code: 1,
      name: "Casa Central",
      environment: "testing",
      is_active: true,
    },
  ]),
  listFiscalRequests: vi.fn(async () => []),
  listDocumentEvents: vi.fn(async () => []),
  listFiscalEventsByRequest: vi.fn(async () => []),
  sha256Hex: vi.fn(async () => "a".repeat(64)),
  issueDocument: (...args: unknown[]) => mocks.issueDocument(...args),
  voidDocument: (...args: unknown[]) => mocks.voidDocument(...args),
  cancelSale: (...args: unknown[]) => mocks.cancelSale(...args),
  requestFiscalIssuance: (...args: unknown[]) => mocks.requestFiscalIssuance(...args),
}));

const sampleSaleDoc: DocumentRecord = {
  id: "doc-1",
  organization_id: "org-1",
  branch_id: "branch-1",
  template_version_id: "ver-1",
  owner_type: "sale",
  owner_id: "sale-1",
  document_number: "0001-00000123",
  invoice_kind: "non_fiscal",
  customer_snapshot: { display_name: "Sofía Gómez", legal_name: "Sofía Gómez", total_ars: 15000 },
  content_sha256: "a".repeat(64),
  status: "issued",
  issued_at: "2026-11-18T10:00:00Z",
  issued_by: "user-1",
  amount_ars: 15000,
  sale_receipt: {
    sale_id: "sale-1",
    document_id: "doc-1",
    document_number: "0001-00000123",
    invoice_kind: "non_fiscal",
    branch_name: "Casa Central",
    customer_display_name: "Sofía Gómez",
    customer_legal_name: "Sofía Gómez",
    currency_code: "ARS",
    exchange_rate: 1,
    subtotal_amount: 15000,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: 15000,
    total_ars: 15000,
    confirmed_at: "2026-11-18T10:00:00Z",
    document_status: "issued",
    sale_state: "confirmed",
    payment_state: "paid",
    lines: [],
    payments: [],
  },
};

const renderDocuments = (permissions: string[]) =>
  render(
    <ErpAuthContext.Provider
      value={{
        session: null,
        organizationId: "org-1",
        branchIds: ["branch-1"],
        permissions,
        loading: false,
        error: null,
        hasPermission: (perm) => permissions.includes(perm),
      }}
    >
      <DocumentsWorkspace />
    </ErpAuthContext.Provider>,
  );

beforeEach(() => {
  mocks.docs = [sampleSaleDoc];
  mocks.voidDocument.mockReset();
  mocks.cancelSale.mockReset();
  mocks.issueDocument.mockReset();
  mocks.requestFiscalIssuance.mockReset();
});

afterEach(cleanup);

describe("documentos", () => {
  it("deshabilita registrar, anular y cancelar venta según permisos", async () => {
    renderDocuments(["documents.view"]);

    const row = await screen.findByRole("button", { name: /Abrir documento 0001-00000123/i });
    const registerBtn = screen.getByRole("button", { name: /Registrar documento/i });
    expect(registerBtn).toBeDisabled();
    expect(registerBtn).toHaveAttribute("title", "Requiere permiso: emitir y anular documentos");

    fireEvent.click(row);
    const dialog = await screen.findByRole("dialog");

    const cancelSaleBtn = within(dialog).getByRole("button", { name: /Cancelar venta y revertir en ERP/i });
    expect(cancelSaleBtn).toBeDisabled();
    expect(cancelSaleBtn).toHaveAttribute("title", "Requiere permiso: cancelar ventas");

    const voidBtn = within(dialog).getByRole("button", { name: /Anular documento/i });
    expect(voidBtn).toBeDisabled();
    expect(voidBtn).toHaveAttribute("title", "Requiere permiso: emitir y anular documentos");
  });

  it("habilita acciones con permisos y muestra errores del RPC dentro del diálogo", async () => {
    mocks.voidDocument.mockRejectedValueOnce({ code: "42501", message: "documents.issue permission is required" });
    mocks.issueDocument.mockRejectedValueOnce({ message: "El motivo de la operación es obligatorio." });

    renderDocuments(["documents.view", "documents.issue", "sales.cancel"]);

    const row = await screen.findByRole("button", { name: /Abrir documento 0001-00000123/i });
    const registerBtn = screen.getByRole("button", { name: /Registrar documento/i });
    expect(registerBtn).toBeEnabled();

    fireEvent.click(row);
    const detailDialog = await screen.findByRole("dialog");

    const cancelInput = within(detailDialog).getByLabelText(/Motivo de cancelación de la venta/i);
    fireEvent.change(cancelInput, { target: { value: "Devolución cliente" } });
    expect(within(detailDialog).getByRole("button", { name: /Cancelar venta y revertir en ERP/i })).toBeEnabled();

    const voidInput = within(detailDialog).getByLabelText(/Motivo de anulación del documento/i);
    fireEvent.change(voidInput, { target: { value: "Error de carga" } });
    const voidBtn = within(detailDialog).getByRole("button", { name: /Anular documento/i });
    expect(voidBtn).toBeEnabled();
    fireEvent.click(voidBtn);

    expect(await within(detailDialog).findByRole("alert")).toHaveTextContent("No tenés permiso para realizar esta acción.");

    fireEvent.click(within(detailDialog).getByRole("button", { name: "Cerrar modal" }));

    fireEvent.click(registerBtn);
    const createDialog = await screen.findByRole("dialog");
    expect(within(createDialog).getByLabelText(/Sucursal/i)).toBeInTheDocument();
    expect(within(createDialog).getByLabelText(/Plantilla/i)).toBeInTheDocument();
    expect(within(createDialog).getByLabelText(/Versión/i)).toBeInTheDocument();
    expect(within(createDialog).getByLabelText(/Documento dueño/i)).toBeInTheDocument();
    expect(within(createDialog).getByLabelText(/ID de la operación/i)).toBeInTheDocument();
    expect(within(createDialog).getByLabelText(/Nombre del cliente o razón social/i)).toBeInTheDocument();
    expect(within(createDialog).getByLabelText(/Número de documento/i)).toBeInTheDocument();
    expect(within(createDialog).getByLabelText(/Monto Total/i)).toBeInTheDocument();
    expect(within(createDialog).getByLabelText(/Motivo de la emisión/i)).toBeInTheDocument();

    fireEvent.change(within(createDialog).getByLabelText(/Nombre del cliente o razón social/i), { target: { value: "Sofía Gómez" } });
    fireEvent.submit(within(createDialog).getByRole("button", { name: /Registrar documento/i }).closest("form")!);

    expect(await within(createDialog).findByRole("alert")).toHaveTextContent("El motivo de la operación es obligatorio.");
  });
});
