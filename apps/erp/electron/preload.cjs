const { contextBridge, ipcRenderer } = require("electron");

const getAppVersion = () => ipcRenderer.invoke("get-app-version");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,
  getAppVersion,
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  getWindowState: () => ipcRenderer.invoke("get-window-state"),
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("toggle-maximize-window"),
  closeWindow: () => ipcRenderer.invoke("close-window"),
  onWindowStateChange: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback({
      isMaximized: Boolean(state.isMaximized),
      isFocused: Boolean(state.isFocused),
      isFullScreen: Boolean(state.isFullScreen),
    });
    ipcRenderer.on("window-state-changed", listener);
    return () => ipcRenderer.removeListener("window-state-changed", listener);
  },
});

contextBridge.exposeInMainWorld("erpDesktop", {
  getVersion: getAppVersion,
  updates: {
    check: () => ipcRenderer.invoke("check-for-updates"),
    install: () => ipcRenderer.invoke("install-update"),
    onStatus: (callback) => {
      if (typeof callback !== "function") return () => {};
      let listening = true;
      let receivedEvent = false;
      const listener = (_event, status) => {
        receivedEvent = true;
        callback(status);
      };
      ipcRenderer.on("update-status", listener);
      void ipcRenderer.invoke("get-update-status").then((status) => {
        if (listening && !receivedEvent && status) callback(status);
      }).catch(() => {});
      return () => {
        listening = false;
        ipcRenderer.removeListener("update-status", listener);
      };
    },
  },
});
