import { useLayoutEffect, useState, type ReactNode, type MouseEvent } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import type { DesktopWindowState, ElectronAPI } from "../../types/electron";
import "./desktop-shell.css";

const INITIAL_WINDOW_STATE: DesktopWindowState = {
  isMaximized: false,
  isFocused: true,
  isFullScreen: false,
};

function DesktopWindow({ api, children }: { api: ElectronAPI; children: ReactNode }) {
  const [windowState, setWindowState] = useState(INITIAL_WINDOW_STATE);
  const [version, setVersion] = useState("");

  useLayoutEffect(() => {
    let disposed = false;
    let receivedState = false;
    document.documentElement.dataset.nativeShell = "true";

    const updateState = (state: DesktopWindowState) => {
      if (disposed) return;
      receivedState = true;
      setWindowState(state);
    };
    const unsubscribe = api.onWindowStateChange(updateState);

    void api.getWindowState().then((state) => {
      if (!disposed && !receivedState) setWindowState(state);
    }).catch((error: unknown) => console.error("No se pudo consultar la ventana.", error));
    void api.getAppVersion().then((appVersion) => {
      if (!disposed) setVersion(appVersion);
    }).catch((error: unknown) => console.error("No se pudo consultar la versión.", error));

    return () => {
      disposed = true;
      unsubscribe();
      delete document.documentElement.dataset.nativeShell;
    };
  }, [api]);

  const runWindowAction = (action: () => Promise<void>) => {
    void action().catch((error: unknown) => console.error("No se pudo controlar la ventana.", error));
  };
  const handleTitleDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    runWindowAction(api.toggleMaximizeWindow);
  };
  const maximizeLabel = windowState.isFullScreen
    ? "Salir de pantalla completa"
    : windowState.isMaximized ? "Restaurar" : "Maximizar";

  return (
    <div className="desktop-shell" data-focused={windowState.isFocused} data-maximized={windowState.isMaximized}>
      <header className="desktop-titlebar" aria-label="Ventana de NicTech ERP" onDoubleClick={handleTitleDoubleClick}>
        <div className="desktop-titlebar__brand">
          <span className="desktop-titlebar__mark" aria-hidden="true">N<span /></span>
          <span className="desktop-titlebar__name">NicTech <span>ERP</span></span>
          {version && <span className="desktop-titlebar__version">v{version}</span>}
        </div>
        <div className="desktop-titlebar__controls" role="group" aria-label="Controles de la ventana">
          <button type="button" className="desktop-window-button" aria-label="Minimizar" title="Minimizar" onClick={() => runWindowAction(api.minimizeWindow)}>
            <Minus size={16} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <button type="button" className="desktop-window-button" aria-label={maximizeLabel} title={maximizeLabel} onClick={() => runWindowAction(api.toggleMaximizeWindow)}>
            {windowState.isMaximized || windowState.isFullScreen
              ? <Copy size={14} strokeWidth={1.7} aria-hidden="true" />
              : <Square size={14} strokeWidth={1.7} aria-hidden="true" />}
          </button>
          <button type="button" className="desktop-window-button desktop-window-button--close" aria-label="Cerrar" title="Cerrar" onClick={() => runWindowAction(api.closeWindow)}>
            <X size={17} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="desktop-app-content">{children}</div>
    </div>
  );
}

export function DesktopShell({ children }: { children: ReactNode }) {
  const api = window.electronAPI;
  if (!api?.isElectron) return <>{children}</>;
  return <DesktopWindow api={api}>{children}</DesktopWindow>;
}
