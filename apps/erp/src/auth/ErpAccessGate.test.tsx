import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ErpAccessGate } from "./ErpAccessGate";
import { ErpAuthContext } from "./ErpAuthContext";

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
  },
}));

const renderGate = () =>
  render(
    <ErpAuthContext.Provider
      value={{
        session: null,
        organizationId: null,
        branchIds: [],
        permissions: [],
        loading: false,
        error: null,
        hasPermission: () => false,
      }}
    >
      <ErpAccessGate>
        <p>Contenido privado</p>
      </ErpAccessGate>
    </ErpAuthContext.Provider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("ErpAccessGate", () => {
  it("traduce invalid_credentials a mensaje de negocio en español", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "invalid_credentials", message: "Invalid login credentials" },
    });

    renderGate();

    fireEvent.change(screen.getByLabelText("Correo Electrónico"), {
      target: { value: "operador@nictech.com.ar" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "clave-incorrecta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar al Sistema" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Correo o contraseña incorrectos.");
    });
    expect(screen.queryByText("Invalid login credentials")).not.toBeInTheDocument();
  });

  it("usa el fallback en español ante un error desconocido de autenticación", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "unexpected_failure", message: "Unexpected server error" },
    });

    renderGate();

    fireEvent.change(screen.getByLabelText("Correo Electrónico"), {
      target: { value: "operador@nictech.com.ar" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "clave-incorrecta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar al Sistema" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("No se pudo iniciar sesión. Reintentá.");
    });
  });
});
