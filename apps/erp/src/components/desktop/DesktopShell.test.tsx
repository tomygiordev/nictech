import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopShell } from "./DesktopShell";
import type { DesktopWindowState, ElectronAPI } from "../../types/electron";

const WINDOW_STATE: DesktopWindowState = { isMaximized: false, isFocused: true, isFullScreen: false };

function mockBridge() {
  let listener: ((state: DesktopWindowState) => void) | undefined;
  const unsubscribe = vi.fn();
  const api: ElectronAPI = {
    isElectron: true,
    platform: "win32",
    getWindowState: vi.fn().mockResolvedValue(WINDOW_STATE),
    getAppVersion: vi.fn().mockResolvedValue("1.2.3"),
    openExternal: vi.fn().mockResolvedValue(true),
    minimizeWindow: vi.fn().mockResolvedValue(undefined),
    toggleMaximizeWindow: vi.fn().mockResolvedValue(undefined),
    closeWindow: vi.fn().mockResolvedValue(undefined),
    onWindowStateChange: vi.fn((callback) => { listener = callback; return unsubscribe; }),
  };
  window.electronAPI = api;
  return { api, unsubscribe, emit: (state: DesktopWindowState) => act(() => listener?.(state)) };
}

afterEach(() => {
  cleanup();
  delete window.electronAPI;
});

describe("DesktopShell", () => {
  it("keeps the web app free of desktop chrome and viewport offsets", () => {
    render(<DesktopShell><main>Contenido web</main></DesktopShell>);
    expect(screen.getByRole("main")).toHaveTextContent("Contenido web");
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(document.documentElement).not.toHaveAttribute("data-native-shell");
  });

  it("shows the real app version and invokes each dedicated window action", async () => {
    const { api } = mockBridge();
    render(<DesktopShell><main>ERP</main></DesktopShell>);
    expect(await screen.findByText("v1.2.3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Minimizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Maximizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(api.minimizeWindow).toHaveBeenCalledOnce();
    expect(api.toggleMaximizeWindow).toHaveBeenCalledOnce();
    expect(api.closeWindow).toHaveBeenCalledOnce();
  });

  it("tracks native maximize, focus and full-screen changes and removes subscriptions on unmount", async () => {
    const { emit, unsubscribe } = mockBridge();
    const { unmount } = render(<DesktopShell><main>ERP</main></DesktopShell>);
    await screen.findByText("v1.2.3");
    emit({ ...WINDOW_STATE, isMaximized: true, isFocused: false });
    expect(screen.getByRole("button", { name: "Restaurar" })).toBeInTheDocument();
    expect(screen.getByRole("banner").parentElement).toHaveAttribute("data-focused", "false");
    emit({ ...WINDOW_STATE, isFullScreen: true });
    expect(screen.getByRole("button", { name: "Salir de pantalla completa" })).toBeInTheDocument();
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(document.documentElement).not.toHaveAttribute("data-native-shell");
  });

  it("does not let an older initial snapshot overwrite a newer native event", async () => {
    const { api, emit } = mockBridge();
    let resolveInitialState: ((state: DesktopWindowState) => void) | undefined;
    api.getWindowState = () => new Promise((resolve) => { resolveInitialState = resolve; });
    render(<DesktopShell><main>ERP</main></DesktopShell>);
    emit({ ...WINDOW_STATE, isMaximized: true });
    await act(async () => resolveInitialState?.(WINDOW_STATE));
    expect(screen.getByRole("button", { name: "Restaurar" })).toBeInTheDocument();
  });

  it("supports a title-region double-click fallback without double-toggling controls", async () => {
    const { api } = mockBridge();
    render(<DesktopShell><main>ERP</main></DesktopShell>);
    await waitFor(() => expect(api.getWindowState).toHaveBeenCalledOnce());
    fireEvent.doubleClick(screen.getByRole("banner"));
    fireEvent.doubleClick(screen.getByRole("button", { name: "Maximizar" }));
    expect(api.toggleMaximizeWindow).toHaveBeenCalledOnce();
  });
});
