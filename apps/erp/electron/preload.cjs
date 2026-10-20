const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
