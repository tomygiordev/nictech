import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopUpdateStatus, ErpDesktopAPI } from "../../types/electron";
import { UpdatesCard } from "./UpdatesCard";

function mockDesktop() {
  let listener: ((status: DesktopUpdateStatus) => void) | undefined;
  const unsubscribe = vi.fn(() => { listener = undefined; });
  const onStatus = vi.fn((callback: (status: DesktopUpdateStatus) => void) => {
    listener = callback;
    return unsubscribe;
  });
  const api = {
    getVersion: vi.fn<ErpDesktopAPI["getVersion"]>().mockResolvedValue("0.2.0"),
    updates: {
      check: vi.fn<ErpDesktopAPI["updates"]["check"]>().mockResolvedValue(undefined),
      install: vi.fn<ErpDesktopAPI["updates"]["install"]>().mockResolvedValue(undefined),
      onStatus,
    },
  } satisfies ErpDesktopAPI;
  window.erpDesktop = api;
  return { api, unsubscribe, emit: (status: DesktopUpdateStatus) => act(() => listener?.(status)) };
}

const search = () => screen.getByRole("button", { name: "Buscar actualizaciones" });
const status = () => screen.getByRole("status");

afterEach(() => {
  cleanup();
  delete window.erpDesktop;
});

describe("UpdatesCard", () => {
  it("explains why updates are disabled in a browser", () => {
    render(<UpdatesCard />);
    expect(screen.getByRole("region", { name: "Actualizaciones" })).toHaveTextContent("Disponible solo en la app de escritorio");
    expect(search()).toBeDisabled();
  });

  it("shows the installed version and reports when there are no updates", async () => {
    const { api, emit, unsubscribe } = mockDesktop();
    const { unmount } = render(<UpdatesCard />);
    await screen.findByText("Versión instalada: v0.2.0");
    fireEvent.click(search());
    expect(api.updates.check).toHaveBeenCalledOnce();
    expect(search()).toBeDisabled();
    expect(status()).toHaveTextContent("Buscando…");
    emit({ kind: "not-available" });
    expect(status()).toHaveTextContent("Ya tenés la última versión (v0.2.0)");
    expect(search()).toBeEnabled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("shows download progress and uses install only after the update is ready", async () => {
    const { api, emit } = mockDesktop();
    render(<UpdatesCard />);
    await screen.findByText("Versión instalada: v0.2.0");
    fireEvent.click(search());
    emit({ kind: "available", version: "0.2.1" });
    expect(status()).toHaveTextContent("Descargando v0.2.1… 0%");
    emit({ kind: "downloading", version: "0.2.1", percent: 64 });
    expect(status()).toHaveTextContent("Descargando v0.2.1… 64%");
    expect(search()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Reiniciar e instalar" })).not.toBeInTheDocument();
    emit({ kind: "downloaded", version: "0.2.1" });
    expect(status()).toHaveTextContent("v0.2.1 lista:");
    const restart = screen.getByRole("button", { name: "Reiniciar e instalar" });
    fireEvent.click(restart);
    expect(api.updates.install).toHaveBeenCalledOnce();
    expect(restart).toBeDisabled();
  });

  it("offers a release link instead of installing in portable mode", async () => {
    const { emit } = mockDesktop();
    render(<UpdatesCard />);
    await screen.findByText("Versión instalada: v0.2.0");
    emit({ kind: "portable-available", version: "0.2.1" });
    expect(status()).toHaveTextContent("Hay una versión nueva (v0.2.1):");
    expect(screen.getByRole("link", { name: "Descargar" })).toHaveAttribute("href", "https://github.com/tomygiordev/nictech/releases/latest");
    expect(screen.queryByRole("button", { name: "Reiniciar e instalar" })).not.toBeInTheDocument();
  });

  it("shows a localized error and lets the user retry after IPC fails", async () => {
    const { api } = mockDesktop();
    api.updates.check.mockRejectedValueOnce(new Error("ECONNRESET"));
    render(<UpdatesCard />);
    await screen.findByText("Versión instalada: v0.2.0");
    fireEvent.click(search());
    expect(await screen.findByText("No se pudo buscar actualizaciones. Revisá la conexión.")).toBeInTheDocument();
    expect(search()).toBeEnabled();
    fireEvent.click(search());
    expect(api.updates.check).toHaveBeenCalledTimes(2);
    expect(status()).toHaveTextContent("Buscando…");
  });
});
