export interface DesktopWindowState {
  isMaximized: boolean;
  isFocused: boolean;
  isFullScreen: boolean;
}

export interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  getWindowState: () => Promise<DesktopWindowState>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  onWindowStateChange: (callback: (state: DesktopWindowState) => void) => () => void;
  getAppVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<boolean>;
}

export type DesktopUpdateStatus =
  | { kind: "checking" | "not-available" }
  | { kind: "available" | "downloaded" | "portable-available"; version: string }
  | { kind: "downloading"; version: string; percent: number }
  | { kind: "error"; message: string };

export interface ErpDesktopAPI {
  getVersion: () => Promise<string>;
  updates: {
    check: () => Promise<void>;
    install: () => Promise<void>;
    onStatus: (callback: (status: DesktopUpdateStatus) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    erpDesktop?: ErpDesktopAPI;
  }
}
