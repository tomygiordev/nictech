const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const electronDirectory = path.resolve(__dirname, "../electron");
const appUrl = pathToFileURL(path.resolve(electronDirectory, "../dist/index.html")).href;

async function bootMain({ development = false } = {}) {
  const handlers = new Map();
  const menus = [];
  const windows = [];
  const externalLinks = [];
  const openedPaths = [];
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.maximized = false;
      this.focused = true;
      this.fullScreen = false;
      this.destroyed = false;
      const webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: development ? "http://localhost:8081/" : appUrl },
        isDestroyed: () => this.destroyed,
        setWindowOpenHandler: (handler) => { this.openHandler = handler; },
        send: (channel, state) => { this.lastMessage = { channel, state }; },
        toggleDevTools: () => { this.devToolsToggled = true; },
        reload: () => { this.reloaded = true; },
        reloadIgnoringCache: () => { this.reloadedIgnoringCache = true; },
      });
      Object.defineProperty(this, "webContents", {
        get: () => {
          if (this.destroyed) throw new Error("Object has been destroyed");
          return webContents;
        },
      });
      windows.push(this);
    }
    static getAllWindows() { return windows.filter((window) => !window.destroyed); }
    removeMenu() { this.menuRemoved = true; }
    setMenuBarVisibility(visible) { this.menuBarVisible = visible; }
    isDestroyed() { return this.destroyed; }
    isMaximized() { return this.maximized; }
    isFocused() { return this.focused; }
    isFullScreen() { return this.fullScreen; }
    setFullScreen(fullScreen) { this.fullScreen = fullScreen; this.emit(fullScreen ? "enter-full-screen" : "leave-full-screen"); }
    isMinimized() { return this.minimized; }
    minimize() { this.minimized = true; }
    maximize() { this.maximized = true; this.emit("maximize"); }
    unmaximize() { this.maximized = false; this.emit("unmaximize"); }
    close() { this.destroyed = true; this.emit("closed"); }
    show() { this.shown = true; }
    loadURL(url) { this.loadedUrl = url; return Promise.resolve(); }
    loadFile(file) { this.loadedFile = file; return Promise.resolve(); }
  }
  const app = Object.assign(new EventEmitter(), {
    isPackaged: !development,
    getPath: () => "C:/Users/test/AppData/Roaming",
    setPath: () => {},
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    getVersion: () => "0.1.0",
    quit: () => {},
  });
  const electron = {
    app,
    BrowserWindow: Window,
    Menu: { setApplicationMenu: (menu) => menus.push(menu) },
    shell: {
      openExternal: async (url) => { externalLinks.push(url); },
      openPath: async (file) => { openedPaths.push(file); return ""; },
    },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    dialog: { showErrorBox: () => {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(electronDirectory, "main.cjs"), "utf8"), {
    require: (name) => name === "electron" ? electron : require(name),
    __dirname: electronDirectory,
    URL,
    process: { argv: [], env: {}, platform: "win32", resourcesPath: "C:/NicTech/resources" },
  });
  await Promise.resolve();
  const window = windows[0];
  const trustedEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return { window, trustedEvent, handlers, menus, externalLinks, openedPaths, app };
}

test("frameless windows have no application or Alt menu and retain isolation", async () => {
  const { window, menus } = await bootMain();
  assert.deepEqual(menus, [null]);
  assert.equal(window.options.frame, false);
  assert.equal(window.menuRemoved, true);
  assert.equal(window.menuBarVisible, false);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.devTools, false);
});

test("window controls minimize, maximize, restore and close the sending main window", async () => {
  const { window, handlers, trustedEvent } = await bootMain();
  handlers.get("minimize-window")(trustedEvent);
  assert.equal(window.minimized, true);
  handlers.get("toggle-maximize-window")(trustedEvent);
  assert.equal(window.maximized, true);
  assert.equal(handlers.get("get-window-state")(trustedEvent).isMaximized, true);
  handlers.get("toggle-maximize-window")(trustedEvent);
  assert.equal(window.maximized, false);
  handlers.get("close-window")(trustedEvent);
  assert.equal(window.destroyed, true);
  assert.throws(() => handlers.get("get-window-state")(trustedEvent), /no autorizada/);
});

test("every IPC rejects another webContents, a child frame and untrusted top frame URLs", async () => {
  const { window, handlers, trustedEvent, externalLinks } = await bootMain();
  for (const [channel, handler] of handlers) {
    for (const invalidEvent of [
      { ...trustedEvent, sender: {} },
      { ...trustedEvent, senderFrame: { url: appUrl } },
      { ...trustedEvent, senderFrame: null },
    ]) {
      await assert.rejects(async () => handler(invalidEvent, "https://nictech.com"), /no autorizada/, channel);
    }
    window.webContents.mainFrame.url = "https://untrusted.example";
    await assert.rejects(async () => handler(trustedEvent, "https://nictech.com"), /no autorizada/, channel);
    window.webContents.mainFrame.url = appUrl;
  }
  assert.equal(externalLinks.length, 0);
});

test("maximize control exits fullscreen before changing maximized state", async () => {
  const { window, handlers, trustedEvent } = await bootMain();
  window.maximize();
  window.setFullScreen(true);
  handlers.get("toggle-maximize-window")(trustedEvent);
  assert.equal(window.fullScreen, false);
  assert.equal(window.maximized, true);
  handlers.get("toggle-maximize-window")(trustedEvent);
  assert.equal(window.maximized, false);
});

test("state changes reach the renderer and listeners detach when the window closes", async () => {
  const { window } = await bootMain();
  const webContents = window.webContents;
  for (const event of ["maximize", "unmaximize", "focus", "blur", "enter-full-screen", "leave-full-screen"]) {
    window.lastMessage = null;
    window.emit(event);
    assert.equal(window.lastMessage.channel, "window-state-changed");
    assert.deepEqual(Object.keys(window.lastMessage.state), ["isMaximized", "isFocused", "isFullScreen"]);
  }
  window.close();
  assert.equal(window.listenerCount("maximize"), 0);
  assert.equal(window.listenerCount("blur"), 0);
  assert.throws(() => window.webContents, /Object has been destroyed/);
  assert.equal(webContents.listenerCount("before-input-event"), 0);
});

test("native events publish their new state before Windows getters catch up", async () => {
  const { window } = await bootMain();
  for (const [event, nativeProperty, stateProperty, expected] of [
    ["maximize", "maximized", "isMaximized", true],
    ["unmaximize", "maximized", "isMaximized", false],
    ["focus", "focused", "isFocused", true],
    ["blur", "focused", "isFocused", false],
    ["enter-full-screen", "fullScreen", "isFullScreen", true],
    ["leave-full-screen", "fullScreen", "isFullScreen", false],
  ]) {
    window.maximized = true;
    window.focused = false;
    window.fullScreen = true;
    window[nativeProperty] = !expected;
    const expectedSnapshot = {
      isMaximized: window.maximized,
      isFocused: window.focused,
      isFullScreen: window.fullScreen,
      [stateProperty]: expected,
    };
    window.emit(event);
    assert.deepEqual({ ...window.lastMessage.state }, expectedSnapshot, event);
    assert.equal(window[nativeProperty], !expected, "native getter is still stale");
  }
});

test("manual allowlist and http links survive while arbitrary file and script URLs stay blocked", async () => {
  const { window, handlers, trustedEvent, externalLinks, openedPaths } = await bootMain();
  const manualUrl = pathToFileURL(path.resolve(electronDirectory, "../dist/Manual_Operativo_ERP_NicTech.pdf")).href;
  assert.equal(window.openHandler({ url: manualUrl }).action, "deny");
  assert.equal(openedPaths.length, 1);
  for (const url of ["file:///C:/secret.pdf", "javascript:alert(1)", "mailto:test@example.com", "invalid"]) {
    assert.equal(window.openHandler({ url }).action, "deny");
    assert.equal(await handlers.get("open-external")(trustedEvent, url), false);
    let prevented = false;
    window.webContents.emit("will-navigate", { preventDefault: () => { prevented = true; } }, url);
    assert.equal(prevented, true);
  }
  assert.equal(externalLinks.length, 0);
  assert.equal(await handlers.get("open-external")(trustedEvent, "https://nictech.com/manual"), true);
  assert.deepEqual(externalLinks, ["https://nictech.com/manual"]);
});

test("development navigation validates origin and developer shortcuts leave editing to Chromium", async () => {
  const { window } = await bootMain({ development: true });
  let prevented = false;
  window.webContents.emit("will-navigate", { preventDefault: () => { prevented = true; } }, "http://localhost:8081.evil.example/");
  assert.equal(prevented, true);
  window.webContents.emit("before-input-event", { preventDefault() {} }, { type: "keyDown", key: "F12" });
  assert.equal(window.devToolsToggled, true);
  window.webContents.emit("before-input-event", { preventDefault() {} }, { type: "keyDown", control: true, key: "r" });
  assert.equal(window.reloaded, true);
  let editingPrevented = false;
  window.webContents.emit("before-input-event", { preventDefault: () => { editingPrevented = true; } }, { type: "keyDown", control: true, key: "c" });
  assert.equal(editingPrevented, false);
});

test("preload only exposes discrete methods and subscriptions never expose IPC event objects", async () => {
  const ipcRenderer = Object.assign(new EventEmitter(), { invoke: async (...args) => args });
  let api;
  vm.runInNewContext(fs.readFileSync(path.join(electronDirectory, "preload.cjs"), "utf8"), {
    require: () => ({ ipcRenderer, contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } }),
    process: { platform: "win32" },
  });
  assert.equal(api.isElectron, true);
  assert.equal(api.platform, "win32");
  assert.equal("send" in api, false);
  assert.equal("invoke" in api, false);
  assert.deepEqual(await api.minimizeWindow(), ["minimize-window"]);
  assert.deepEqual(await api.toggleMaximizeWindow(), ["toggle-maximize-window"]);
  assert.deepEqual(await api.closeWindow(), ["close-window"]);
  assert.deepEqual(await api.getWindowState(), ["get-window-state"]);
  let received;
  const remove = api.onWindowStateChange((...args) => { received = args; });
  ipcRenderer.emit("window-state-changed", { secretEvent: true }, { isMaximized: true, isFocused: false, isFullScreen: false, extra: true });
  assert.equal(received.length, 1);
  assert.deepEqual(Object.keys(received[0]), ["isMaximized", "isFocused", "isFullScreen"]);
  remove();
  assert.equal(ipcRenderer.listenerCount("window-state-changed"), 0);
});
