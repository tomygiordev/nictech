const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const MANUAL_FILENAME = "Manual_Operativo_ERP_NicTech.pdf";
const bundledManualUrl = pathToFileURL(path.join(__dirname, "../dist", MANUAL_FILENAME)).href;
const distIndexPath = path.join(__dirname, "../dist/index.html");
const distIndexUrl = pathToFileURL(distIndexPath).href;

// Set app name and isolated user data directory to avoid generic Electron lock collisions
app.name = "nictech-erp";
try {
  const userDataPath = path.join(app.getPath("appData"), "nictech-erp");
  app.setPath("userData", userDataPath);
} catch {
  // Ignore fallback if appData cannot be queried yet
}

const isDev =
  process.argv.includes("--dev") ||
  Boolean(process.env.VITE_DEV_SERVER_URL) ||
  process.env.NODE_ENV === "development" ||
  !app.isPackaged;

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:8081";

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;

function isExternalUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function isAppUrl(url) {
  try {
    const parsed = new URL(url);
    if (isDev && parsed.origin === new URL(DEV_SERVER_URL).origin) return true;
    parsed.hash = "";
    parsed.search = "";
    return parsed.href === distIndexUrl;
  } catch {
    return false;
  }
}

function getWindowState(window) {
  return {
    isMaximized: window.isMaximized(),
    isFocused: window.isFocused(),
    isFullScreen: window.isFullScreen(),
  };
}

function getTrustedWindow(event) {
  if (
    !mainWindow || mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    !event.senderFrame || event.senderFrame !== mainWindow.webContents.mainFrame ||
    !isAppUrl(event.senderFrame.url)
  ) {
    throw new Error("Solicitud de ventana no autorizada");
  }
  return mainWindow;
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0f172a",
    title: "NicTech ERP — Sistema de Gestión",
    icon: path.join(__dirname, app.isPackaged
      ? "../dist/brand/nictech-symbol.png"
      : "../public/brand/nictech-symbol.png"),
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
    },
    show: false,
  });
  const webContents = window.webContents;
  mainWindow = window;
  window.removeMenu();
  window.setMenuBarVisibility(false);

  const publishWindowState = (eventState) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("window-state-changed", { ...getWindowState(window), ...eventState });
    }
  };
  // On Windows the native event can precede the corresponding getter update.
  const stateEvents = [
    ["maximize", { isMaximized: true }],
    ["unmaximize", { isMaximized: false }],
    ["focus", { isFocused: true }],
    ["blur", { isFocused: false }],
    ["enter-full-screen", { isFullScreen: true }],
    ["leave-full-screen", { isFullScreen: false }],
  ];
  const stateListeners = stateEvents.map(([event, eventState]) => {
    const listener = () => publishWindowState(eventState);
    window.on(event, listener);
    return [event, listener];
  });

  // Chromium handles editing shortcuts without a menu. Keep developer tools local to development.
  const handleDeveloperShortcut = (event, input) => {
    if (!isDev || input.type !== "keyDown" || input.alt) return;
    if (input.key === "F12") {
      event.preventDefault();
      window.webContents.toggleDevTools();
      return;
    }
    const commandModifier = process.platform === "darwin" ? input.meta : input.control;
    if (commandModifier && input.key.toLowerCase() === "r") {
      event.preventDefault();
      if (input.shift) window.webContents.reloadIgnoringCache();
      else window.webContents.reload();
    }
  };
  window.webContents.on("before-input-event", handleDeveloperShortcut);

  // Reveal window smoothly once ready
  window.once("ready-to-show", () => {
    window.show();
    if (isDev && process.argv.includes("--open-devtools")) {
      window.webContents.openDevTools({ mode: "detach" });
    }
  });

  window.on("closed", () => {
    for (const [event, listener] of stateListeners) window.removeListener(event, listener);
    webContents.removeListener("before-input-event", handleDeveloperShortcut);
    if (mainWindow === window) mainWindow = null;
  });

  // Security: prevent opening external links in the Electron window
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.href === bundledManualUrl) {
        const manualPath = app.isPackaged
          ? path.join(process.resourcesPath, MANUAL_FILENAME)
          : path.join(__dirname, "../public", MANUAL_FILENAME);
        void shell.openPath(manualPath).then((error) => {
          if (error) dialog.showErrorBox("No se pudo abrir el manual", error);
        }).catch(() => {
          dialog.showErrorBox("No se pudo abrir el manual", "Revisá que haya un lector de PDF instalado e intentá nuevamente.");
        });
      } else if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        shell.openExternal(url);
      }
    } catch {
      // ignore invalid URLs
    }
    return { action: "deny" };
  });

  // Security: prevent in-window navigation away from the ERP
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (isExternalUrl(url)) void shell.openExternal(url);
    }
  });

  // Load either Vite Dev Server or local dist
  if (isDev) {
    window.loadURL(DEV_SERVER_URL).catch(() => {
      // If dev server is not ready or failed, try loading dist fallback
      if (fs.existsSync(distIndexPath)) {
        window.loadFile(distIndexPath);
      } else {
        window.loadURL(DEV_SERVER_URL);
      }
    });
  } else {
    window.loadFile(distIndexPath);
  }
}

// IPC Handlers
ipcMain.handle("get-app-version", (event) => {
  getTrustedWindow(event);
  return app.getVersion();
});
ipcMain.handle("open-external", async (event, url) => {
  getTrustedWindow(event);
  if (isExternalUrl(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});
ipcMain.handle("get-window-state", (event) => getWindowState(getTrustedWindow(event)));
ipcMain.handle("minimize-window", (event) => {
  getTrustedWindow(event).minimize();
});
ipcMain.handle("toggle-maximize-window", (event) => {
  const window = getTrustedWindow(event);
  if (window.isFullScreen()) window.setFullScreen(false);
  else if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});
ipcMain.handle("close-window", (event) => {
  getTrustedWindow(event).close();
});

// App lifecycle
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  if (process.platform === "win32") app.setAppUserModelId("ar.com.nictech.erp");
  Menu.setApplicationMenu(null);
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
