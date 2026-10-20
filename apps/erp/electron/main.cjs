const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const MANUAL_FILENAME = "Manual_Operativo_ERP_NicTech.pdf";
const bundledManualUrl = pathToFileURL(path.join(__dirname, "../dist", MANUAL_FILENAME)).href;

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

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0f172a",
    title: "NicTech ERP — Sistema de Gestión",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
    show: false,
  });

  // Reveal window smoothly once ready
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (isDev && process.argv.includes("--open-devtools")) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Security: prevent opening external links in the Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
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
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const isSameDevServer = isDev && url.startsWith(DEV_SERVER_URL);
    const isLocalFile = url.startsWith("file://");
    if (!isSameDevServer && !isLocalFile) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Load either Vite Dev Server or local dist
  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL).catch(() => {
      // If dev server is not ready or failed, try loading dist fallback
      const distIndex = path.join(__dirname, "../dist/index.html");
      if (fs.existsSync(distIndex)) {
        mainWindow.loadFile(distIndex);
      } else {
        mainWindow.loadURL(DEV_SERVER_URL);
      }
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function buildAppMenu() {
  const template = [
    {
      label: "Archivo",
      submenu: [
        {
          label: "Recargar",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow?.webContents.reload(),
        },
        {
          label: "Forzar recarga",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => mainWindow?.webContents.reloadIgnoringCache(),
        },
        { type: "separator" },
        {
          label: "Salir",
          accelerator: "CmdOrCtrl+Q",
          click: () => app.quit(),
        },
      ],
    },
    {
      label: "Edición",
      submenu: [
        { label: "Deshacer", role: "undo" },
        { label: "Rehacer", role: "redo" },
        { type: "separator" },
        { label: "Cortar", role: "cut" },
        { label: "Copiar", role: "copy" },
        { label: "Pegar", role: "paste" },
        { label: "Seleccionar todo", role: "selectAll" },
      ],
    },
    {
      label: "Ver",
      submenu: [
        { label: "Restablecer zoom", role: "resetZoom" },
        { label: "Acercar", role: "zoomIn" },
        { label: "Alejar", role: "zoomOut" },
        { type: "separator" },
        { label: "Pantalla completa", role: "togglefullscreen" },
        {
          label: "Alternar DevTools",
          accelerator: "F12",
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: "Ventana",
      submenu: [
        { label: "Minimizar", role: "minimize" },
        { label: "Cerrar", role: "close" },
      ],
    },
    {
      label: "Ayuda",
      submenu: [
        {
          label: "Acerca de NicTech ERP",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "NicTech ERP",
              message: "NicTech ERP — Sistema de Gestión",
              detail: `Versión: ${app.getVersion() || "0.1.0"}\nElectron: ${process.versions.electron}\nChromium: ${process.versions.chrome}\nNode.js: ${process.versions.node}\n\nDiseñado para administración de stock, taller técnico, ventas y facturación.`,
              buttons: ["Aceptar"],
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC Handlers
ipcMain.handle("get-app-version", () => app.getVersion());
ipcMain.handle("open-external", async (_, url) => {
  if (typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"))) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

// App lifecycle
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  buildAppMenu();
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
