import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ErpAuthContext, type ErpAuthContextValue } from "../../auth/ErpAuthContext";
import { CustomersWorkspace } from "./CustomersWorkspace";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  customers: [] as Array<{
    id: string;
    code: string;
    kind: "person" | "business";
    display_name: string;
    email: string | null;
    phone: string | null;
    whatsapp_phone: string | null;
    is_active: boolean;
    created_at: string;
  }>,
  repairs: [] as Array<{
    id: string;
    customer_id: string;
    order_code: string;
    brand_snapshot: string;
    model_snapshot: string;
    status_name: string;
    status_is_terminal: boolean;
    opened_at: string;
  }>,
  sales: [] as Array<{
    id: string;
    customer_id: string;
    total_amount: number;
  }>,
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: mock.rpc,
    from: (table: string) => {
      const getRows = () => {
        if (table === "customers") return mock.customers;
        if (table === "repair_orders_overview") return mock.repairs;
        if (table === "sales") return mock.sales;
        return [];
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        then: (
          resolve: (value: { data: unknown[]; error: null }) => unknown,
          reject: (error: unknown) => unknown,
        ) => Promise.resolve({ data: getRows(), error: null }).then(resolve, reject),
      };
      return chain;
    },
  },
}));

const renderWorkspace = (
  permissions: string[] = ["customers.manage", "customers.view_sensitive"],
) => {
  const authValue: ErpAuthContextValue = {
    session: null,
    organizationId: "org-1",
    branchIds: ["branch-1"],
    permissions,
    loading: false,
    error: null,
    hasPermission: (permission: string) => permissions.includes(permission),
  };
  return render(
    <ErpAuthContext.Provider value={authValue}>
      <CustomersWorkspace />
    </ErpAuthContext.Provider>,
  );
};

beforeEach(() => {
  mock.rpc.mockReset();
  mock.rpc.mockResolvedValue({ data: "cust-new-1", error: null });
  mock.customers = [
    {
      id: "cust-1",
      code: "CLI-001",
      kind: "person",
      display_name: "Ana Pérez",
      email: "ana@ejemplo.com",
      phone: "1122334455",
      whatsapp_phone: null,
      is_active: true,
      created_at: "2026-11-18T10:00:00.000Z",
    },
    {
      id: "cust-2",
      code: "CLI-002",
      kind: "business",
      display_name: "Tech SRL",
      email: "compras@tech.com",
      phone: "1199887766",
      whatsapp_phone: null,
      is_active: true,
      created_at: "2026-11-17T10:00:00.000Z",
    },
  ];
  mock.repairs = [
    {
      id: "rep-1",
      customer_id: "cust-1",
      order_code: "REP-101",
      brand_snapshot: "Apple",
      model_snapshot: "iPhone 14",
      status_name: "waiting_parts",
      status_is_terminal: false,
      opened_at: "2026-11-18T09:00:00.000Z",
    },
  ];
  mock.sales = [
    { id: "sale-1", customer_id: "cust-1", total_amount: 50000 },
    { id: "sale-2", customer_id: "cust-2", total_amount: 20000 },
    { id: "sale-3", customer_id: "cust-2", total_amount: 30000 },
  ];
});

afterEach(cleanup);

describe("CustomersWorkspace", () => {
  it("muestra singular '1 pedido', plural '2 pedidos' y estado de reparación en español", async () => {
    renderWorkspace();

    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("1 pedido")).toBeInTheDocument();
    expect(screen.getByText("2 pedidos")).toBeInTheDocument();
    expect(screen.queryByText("1 pedidos")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Abrir ficha de Ana Pérez" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Esperando repuestos")).toBeInTheDocument();
    expect(within(dialog).queryByText("waiting_parts")).not.toBeInTheDocument();
  });

  it("asocia todos los labels del modal Nuevo cliente con htmlFor y valida con Zod", async () => {
    renderWorkspace();
    await screen.findByText("Ana Pérez");

    fireEvent.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    const dialog = await screen.findByRole("dialog");

    const nameInput = within(dialog).getByLabelText(/Nombre completo o razón social/i);
    const docTypeSelect = within(dialog).getByLabelText("Tipo de documento");
    const docNumberInput = within(dialog).getByLabelText("Número de documento");
    const emailInput = within(dialog).getByLabelText("Email");
    const phoneInput = within(dialog).getByLabelText("Teléfono / WhatsApp");
    const notesInput = within(dialog).getByLabelText("Observaciones / notas");

    expect(nameInput).toHaveAttribute("id");
    expect(docTypeSelect).toHaveAttribute("id");
    expect(docNumberInput).toHaveAttribute("id");
    expect(emailInput).toHaveAttribute("id");
    expect(phoneInput).toHaveAttribute("id");
    expect(notesInput).toHaveAttribute("id");

    fireEvent.change(nameInput, { target: { value: "A" } });
    fireEvent.change(emailInput, { target: { value: "correo-invalido" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cliente" }));

    expect(await within(dialog).findByText("Ingresá el nombre o razón social.")).toBeInTheDocument();
    expect(within(dialog).getByText("Ingresá un email válido.")).toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("muestra el error del alta dentro del modal con FormError en lugar de detrás del overlay", async () => {
    mock.rpc.mockImplementation(async (fnName: string) => {
      if (fnName === "create_customer_with_private_details") {
        return { data: null, error: { message: "identity_document already belongs to another customer" } };
      }
      return { data: null, error: null };
    });

    renderWorkspace();
    await screen.findByText("Ana Pérez");

    fireEvent.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(/Nombre completo o razón social/i), {
      target: { value: "Carlos Méndez" },
    });
    fireEvent.change(within(dialog).getByLabelText("Número de documento"), {
      target: { value: "30111222" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cliente" }));

    await waitFor(() => {
      expect(mock.rpc).toHaveBeenCalledWith(
        "create_customer_with_private_details",
        expect.objectContaining({
          new_display_name: "Carlos Méndez",
          new_identity_document: "30111222",
        }),
      );
    });

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("El documento ya está registrado para otro cliente.");
  });
});
