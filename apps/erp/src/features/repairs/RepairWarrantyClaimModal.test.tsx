import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openWarrantyClaim, type WarrantyRecord } from "./api";
import { RepairWarrantyClaimModal } from "./RepairWarrantyClaimModal";

vi.mock("./api", () => ({ openWarrantyClaim: vi.fn() }));

const openClaim = vi.mocked(openWarrantyClaim);
const title = "Apertura de reclamo de garantía";
const warranties: WarrantyRecord[] = [
  {
    id: "c36c881e-d05e-4a81-9b39-f1f959afaf15",
    repair_order_id: "758df8ed-05e9-48bf-a70a-29053d171a10",
    delivery_id: "ae1eeded-cfe1-46fc-a792-16384e6cdb6b",
    order_code: "REP-0010",
    customer_name: "Ana Pérez",
    customer_phone: "1155550000",
    equipment_model: "Lenovo ThinkPad",
    starts_at: "2026-10-01T12:00:00Z",
    ends_at: "2027-01-01T12:00:00Z",
    terms_snapshot: "Garantía de 90 días",
    is_active: true,
  },
  {
    id: "2c6e6bc2-3c83-4c20-8d42-539bd19c7e1c",
    repair_order_id: "3d70ac77-df31-4007-99cb-4c7e5acaf394",
    delivery_id: "03c56d7e-490c-4943-b7ed-c98864883f6a",
    order_code: "REP-0001",
    customer_name: "Juan Vencido",
    customer_phone: null,
    equipment_model: "Moto G54",
    starts_at: "2025-01-01T12:00:00Z",
    ends_at: "2025-04-01T12:00:00Z",
    terms_snapshot: "Garantía de 90 días",
    is_active: false,
  },
];

beforeEach(() => {
  openClaim.mockReset().mockResolvedValue("claim-1");
});

async function setup() {
  const user = userEvent.setup();
  const onCreated = vi.fn();

  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Abrir reclamo</button>
        <RepairWarrantyClaimModal
          isOpen={open}
          warranties={warranties}
          onClose={() => setOpen(false)}
          onCreated={onCreated}
        />
      </>
    );
  }

  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Abrir reclamo" }));
  const form = within(screen.getByRole("dialog", { name: title }));
  return { user, form, onCreated };
}

describe("Reclamo de garantía", () => {
  it("abre vacío, lista solo pólizas vigentes y muestra errores dentro del diálogo al enviar vacío", async () => {
    const { user, form, onCreated } = await setup();
    const policySelect = form.getByLabelText(/^Póliza vigente/);
    const issueField = form.getByLabelText(/^Defecto o falla reportada/);

    expect(policySelect).toHaveValue("");
    expect(issueField).toHaveValue("");
    expect(form.getByRole("option", { name: /REP-0010/ })).toBeInTheDocument();
    expect(form.queryByRole("option", { name: /REP-0001/ })).not.toBeInTheDocument();

    await user.click(form.getByRole("button", { name: "Registrar reclamo" }));

    expect(form.getAllByRole("alert")).toHaveLength(2);
    expect(policySelect).toHaveAttribute("aria-invalid", "true");
    expect(issueField).toHaveAttribute("aria-invalid", "true");
    expect(openClaim).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("muestra el error de API dentro del diálogo sin cerrarlo y cierra al completarse", async () => {
    openClaim.mockRejectedValueOnce({ code: "42501" });
    const { user, form, onCreated } = await setup();

    await user.selectOptions(form.getByLabelText(/^Póliza vigente/), warranties[0].id);
    await user.type(form.getByLabelText(/^Defecto o falla reportada/), "  Volvió a fallar el pin de carga  ");
    await user.click(form.getByRole("button", { name: "Registrar reclamo" }));

    expect(form.getByRole("alert")).toHaveTextContent("No tenés permiso para realizar esta acción.");
    expect(screen.getByRole("dialog", { name: title })).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();

    await user.click(form.getByRole("button", { name: "Registrar reclamo" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument());
    expect(openClaim).toHaveBeenCalledWith(warranties[0].id, "Volvió a fallar el pin de carga");
    expect(onCreated).toHaveBeenCalledWith("claim-1");
  });
});
