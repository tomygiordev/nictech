import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WhatsappWorkspace } from "./WhatsappWorkspace";
import { ErpAuthContext } from "../../auth/ErpAuthContext";

const mocks = vi.hoisted(() => ({
  queueMessage: vi.fn(),
  recordConsent: vi.fn(),
  assignConversation: vi.fn(),
}));

vi.mock("./api", () => ({
  listConversations: vi.fn(async () => [
    {
      id: "conv-1",
      branch_id: "branch-1",
      customer_id: "cust-1",
      channel: "whatsapp",
      opened_at: "2026-11-18T10:00:00Z",
      closed_at: null,
    },
  ]),
  listConversationCustomers: vi.fn(async () => [
    {
      id: "cust-1",
      display_name: "Sofía Gómez",
      code: "CLI-01",
      phone: "+5491122334455",
    },
  ]),
  listMessageTemplates: vi.fn(async () => [
    {
      id: "tpl-1",
      code: "PRESUP",
      channel: "whatsapp",
      name: "Aviso presupuesto",
      is_active: true,
    },
  ]),
  listMessageTemplateVersions: vi.fn(async () => [
    {
      id: "ver-1",
      template_id: "tpl-1",
      version: 1,
      provider_template_name: "presupuesto",
      language_code: "es_AR",
      body: "Hola {{nombre}}",
      variable_keys: ["nombre"],
    },
  ]),
  listConversationMessages: vi.fn(async () => []),
  listCustomerConsents: vi.fn(async () => [
    {
      id: "cons-1",
      customer_id: "cust-1",
      channel: "whatsapp",
      granted: true,
      source: "mostrador",
      reason: "Opt-in inicial",
      recorded_at: "2026-11-18T09:00:00Z",
    },
  ]),
  listConversationAssignments: vi.fn(async () => []),
  listMessageEvents: vi.fn(async () => []),
  queueMessage: (...args: unknown[]) => mocks.queueMessage(...args),
  recordConsent: (...args: unknown[]) => mocks.recordConsent(...args),
  assignConversation: (...args: unknown[]) => mocks.assignConversation(...args),
}));

const renderWhatsapp = (permissions: string[]) =>
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
      <WhatsappWorkspace />
    </ErpAuthContext.Provider>,
  );

beforeEach(() => {
  mocks.queueMessage.mockReset();
  mocks.recordConsent.mockReset();
  mocks.assignConversation.mockReset();
});

afterEach(cleanup);

describe("whatsapp", () => {
  it("deshabilita encolar, asignar y registrar consentimiento sin permisos", async () => {
    renderWhatsapp(["messages.view"]);

    const queueBtn = await screen.findByRole("button", { name: /Encolar mensaje/i });
    const consentBtn = screen.getByRole("button", { name: /Registrar consentimiento/i });
    const assignBtn = screen.getByRole("button", { name: /Asignar conversación/i });

    expect(queueBtn).toBeDisabled();
    expect(queueBtn).toHaveAttribute("title", "Requiere permiso: gestionar mensajes");
    expect(consentBtn).toBeDisabled();
    expect(consentBtn).toHaveAttribute("title", "Requiere permiso: gestionar clientes y consentimientos");
    expect(assignBtn).toBeDisabled();
    expect(assignBtn).toHaveAttribute("title", "Requiere permiso: gestionar mensajes");
  });

  it("habilita acciones según permiso, asocia labels con htmlFor y traduce errores del RPC", async () => {
    mocks.assignConversation.mockRejectedValueOnce({ code: "42501", message: "messages.manage permission is required" });

    renderWhatsapp(["messages.view", "messages.manage", "customers.manage"]);

    const queueBtn = await screen.findByRole("button", { name: /Encolar mensaje/i });
    const consentBtn = screen.getByRole("button", { name: /Registrar consentimiento/i });
    const assignBtn = screen.getByRole("button", { name: /Asignar conversación/i });

    expect(queueBtn).toBeEnabled();
    expect(consentBtn).toBeEnabled();
    expect(assignBtn).toBeEnabled();

    expect(screen.getByLabelText("Plantilla")).toBeInTheDocument();
    expect(screen.getByLabelText("Versión")).toBeInTheDocument();
    expect(screen.getByLabelText("Destinatario")).toBeInTheDocument();
    expect(screen.getByLabelText("Estado")).toBeInTheDocument();
    expect(screen.getByLabelText("Origen")).toBeInTheDocument();
    expect(screen.getByLabelText("ID de usuario (vacío = desasignar)")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Plantilla"), { target: { value: "tpl-1" } });
    expect(await screen.findByLabelText("nombre")).toBeInTheDocument();

    fireEvent.click(assignBtn);
    expect(await screen.findByText("No tenés permiso para realizar esta acción.")).toBeInTheDocument();
  });
});
