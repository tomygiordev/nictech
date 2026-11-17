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

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
