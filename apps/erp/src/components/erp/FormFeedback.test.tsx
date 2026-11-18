import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Field, FormError } from "./FormFeedback";

describe("Field", () => {
  it("enfoca el control al hacer clic en su etiqueta", async () => {
    const user = userEvent.setup();
    render(<Field label="Correo">{(a11y) => <input type="email" {...a11y} />}</Field>);

    const control = screen.getByRole("textbox", { name: "Correo" });
    await user.click(screen.getByText("Correo"));

    expect(control).toHaveFocus();
    expect(control).not.toHaveAttribute("aria-describedby");
    expect(control).not.toHaveAttribute("aria-invalid");
  });

  it("vincula la ayuda y el error al control, y distingue el campo obligatorio", () => {
    render(
      <Field label="Motivo" required hint="Incluí el detalle de la operación." error="Ingresá un motivo.">
        {(a11y) => <textarea required {...a11y} />}
      </Field>,
    );

    const control = screen.getByRole("textbox", { name: "Motivo (obligatorio)" });
    const error = screen.getByRole("alert");
    const hint = screen.getByText("Incluí el detalle de la operación.");

    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAttribute("aria-describedby", `${hint.id} ${error.id}`);
    expect(control).toHaveAccessibleDescription("Incluí el detalle de la operación. Ingresá un motivo.");
  });
});

describe("FormError", () => {
  it("anuncia el mensaje como una alerta", () => {
    render(<FormError message="No se pudo guardar." />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No se pudo guardar.");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("no renderiza la alerta si no hay mensaje", () => {
    const { container } = render(<FormError message={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("permite cerrar el aviso sin enviar el formulario", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const onSubmit = vi.fn();
    render(<form onSubmit={onSubmit}><FormError message="Reintentá." onDismiss={onDismiss} /></form>);

    await user.click(screen.getByRole("button", { name: "Cerrar aviso de error" }));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
