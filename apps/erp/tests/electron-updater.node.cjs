const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { startUpdateChecks } = require("../electron/updater.cjs");
const { build } = require("../package.json");

const FOUR_HOURS = 4 * 60 * 60 * 1000;

function updaterFixture(t, { isPackaged = true, isPortable = false, response = 0 } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const app = Object.assign(new EventEmitter(), { isPackaged });
  const window = { isDestroyed: () => false };
  const dialog = { showMessageBox: t.mock.fn(async () => ({ response })) };
  const shell = { openExternal: t.mock.fn(async () => {}) };
  const autoUpdater = Object.assign(new EventEmitter(), {
    checkForUpdates: t.mock.fn(async () => null),
    quitAndInstall: t.mock.fn(),
  });
  const loadUpdater = t.mock.fn(() => autoUpdater);
  const statuses = [];
  const options = { app, dialog, shell, getWindow: () => window, isPortable, loadUpdater, onStatus: (status) => statuses.push(status) };
  return { app, window, dialog, shell, autoUpdater, loadUpdater, options, statuses };
}

test("builder names both Windows artifacts and uses the public stable update feed", () => {
  assert.deepEqual(build.publish, [{
    provider: "generic",
    url: "https://github.com/tomygiordev/nictech/releases/latest/download",
  }]);
  assert.equal(build.nsis.artifactName, "NicTech-ERP-Setup-${version}.${ext}");
  assert.equal(build.portable.artifactName, "NicTech-ERP-Portable-${version}.${ext}");
});

test("unpackaged apps do not load the Electron updater", (t) => {
  const { options, loadUpdater } = updaterFixture(t, { isPackaged: false });
  startUpdateChecks(options);
  t.mock.timers.tick(10_000 + FOUR_HOURS);
  assert.equal(loadUpdater.mock.callCount(), 0);
});

test("installed ERP checks after 10 seconds and every four hours until quit", async (t) => {
  const { app, autoUpdater, options } = updaterFixture(t);
  startUpdateChecks(options);
  assert.equal(autoUpdater.autoDownload, true);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
  t.mock.timers.tick(9_999);
  assert.equal(autoUpdater.checkForUpdates.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.equal(autoUpdater.checkForUpdates.mock.callCount(), 1);
  await new Promise(setImmediate);
  t.mock.timers.tick(FOUR_HOURS - 1);
  assert.equal(autoUpdater.checkForUpdates.mock.callCount(), 1);
  t.mock.timers.tick(1);
  assert.equal(autoUpdater.checkForUpdates.mock.callCount(), 2);
  app.emit("will-quit");
  t.mock.timers.tick(FOUR_HOURS);
  assert.equal(autoUpdater.checkForUpdates.mock.callCount(), 2);
});

test("installed ERP only prompts once per downloaded version and can restart now", async (t) => {
  const { autoUpdater, dialog, window, options } = updaterFixture(t);
  startUpdateChecks(options);
  autoUpdater.emit("update-available", { version: "0.2.1" });
  assert.equal(dialog.showMessageBox.mock.callCount(), 0);
  autoUpdater.emit("update-downloaded", { version: "0.2.1" });
  autoUpdater.emit("update-downloaded", { version: "0.2.1" });
  await Promise.resolve();
  assert.equal(dialog.showMessageBox.mock.callCount(), 1);
  const [parent, { message, buttons, cancelId }] = dialog.showMessageBox.mock.calls[0].arguments;
  assert.equal(parent, window);
  assert.equal(message, "Hay una nueva versión de NicTech ERP (v0.2.1) lista. ¿Reiniciar ahora para actualizar?");
  assert.deepEqual(buttons, ["Reiniciar ahora", "Más tarde"]);
  assert.equal(cancelId, 1);
  assert.equal(autoUpdater.quitAndInstall.mock.callCount(), 1);
});

test("Más tarde leaves the downloaded update queued for quit", async (t) => {
  const { autoUpdater, options } = updaterFixture(t, { response: 1 });
  startUpdateChecks(options);
  autoUpdater.emit("update-downloaded", { version: "0.2.1" });
  await Promise.resolve();
  assert.equal(autoUpdater.quitAndInstall.mock.callCount(), 0);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
});

test("portable ERP checks for updates and only opens the download page if accepted", async (t) => {
  const { autoUpdater, dialog, shell, options } = updaterFixture(t, { isPortable: true, response: 1 });
  startUpdateChecks(options);
  assert.equal(autoUpdater.autoDownload, false);
  assert.equal(autoUpdater.autoInstallOnAppQuit, false);
  t.mock.timers.tick(10_000);
  assert.equal(autoUpdater.checkForUpdates.mock.callCount(), 1);
  autoUpdater.emit("update-available", { version: "0.2.1" });
  await Promise.resolve();
  assert.equal(shell.openExternal.mock.callCount(), 0);
  dialog.showMessageBox.mock.mockImplementation(async () => ({ response: 0 }));
  autoUpdater.emit("update-available", { version: "0.2.2" });
  await Promise.resolve();
  assert.match(dialog.showMessageBox.mock.calls[1].arguments[1].message, /v0\.2\.2.*Descargá el instalador/);
  assert.deepEqual(shell.openExternal.mock.calls[0].arguments, ["https://github.com/tomygiordev/nictech/releases/latest"]);
  assert.equal(autoUpdater.quitAndInstall.mock.callCount(), 0);
});

test("checks and automatic download failures are logged without prompting", async (t) => {
  const errorLog = t.mock.method(console, "error", () => {});
  const { autoUpdater, dialog, options, statuses } = updaterFixture(t);
  const offline = new Error("offline");
  const interrupted = new Error("download interrupted");
  autoUpdater.checkForUpdates.mock.mockImplementationOnce(async () => { throw offline; });
  autoUpdater.checkForUpdates.mock.mockImplementationOnce(async () => ({ downloadPromise: Promise.reject(interrupted) }), 1);
  startUpdateChecks(options);
  t.mock.timers.tick(10_000);
  await new Promise(setImmediate);
  t.mock.timers.tick(FOUR_HOURS);
  await new Promise(setImmediate);
  assert.deepEqual(errorLog.mock.calls.map(({ arguments: [, error] }) => error), [offline, interrupted]);
  assert.equal(dialog.showMessageBox.mock.callCount(), 0);
  assert.deepEqual(statuses, []);
});

test("manual check of the current version reports checking and not-available", async (t) => {
  const { autoUpdater, options, statuses } = updaterFixture(t);
  autoUpdater.checkForUpdates.mock.mockImplementation(async () => {
    autoUpdater.emit("update-not-available", { version: "0.2.0" });
    return { isUpdateAvailable: false };
  });
  const updates = startUpdateChecks(options);
  await updates.check();
  assert.deepEqual(statuses, [{ kind: "checking" }, { kind: "not-available" }]);
  assert.deepEqual(updates.getStatus(), statuses[1]);
});

test("manual NSIS checks publish download progress and suppress the native prompt", async (t) => {
  const { autoUpdater, dialog, options, statuses } = updaterFixture(t);
  autoUpdater.checkForUpdates.mock.mockImplementation(async () => {
    autoUpdater.emit("update-available", { version: "0.2.1" });
    autoUpdater.emit("download-progress", { percent: 54.6 });
    autoUpdater.emit("download-progress", { percent: 55.2 });
    autoUpdater.emit("update-downloaded", { version: "0.2.1" });
    return { downloadPromise: Promise.resolve() };
  });
  const updates = startUpdateChecks(options);
  await updates.check();
  assert.deepEqual(statuses, [
    { kind: "checking" },
    { kind: "available", version: "0.2.1" },
    { kind: "downloading", version: "0.2.1", percent: 55 },
    { kind: "downloaded", version: "0.2.1" },
  ]);
  assert.equal(dialog.showMessageBox.mock.callCount(), 0);
  t.mock.timers.tick(10_000);
  await new Promise(setImmediate);
  assert.equal(dialog.showMessageBox.mock.callCount(), 0, "scheduled check does not re-notify the same version");
  updates.install();
  updates.install();
  assert.equal(autoUpdater.quitAndInstall.mock.callCount(), 1);
});

test("manual check joins an automatic download and takes over its progress and notice", async (t) => {
  const { autoUpdater, dialog, options, statuses } = updaterFixture(t);
  const download = Promise.withResolvers();
  autoUpdater.checkForUpdates.mock.mockImplementation(async () => {
    autoUpdater.emit("update-available", { version: "0.2.1" });
    return { downloadPromise: download.promise };
  });
  const updates = startUpdateChecks(options);
  t.mock.timers.tick(10_000);
  autoUpdater.emit("download-progress", { percent: 25 });
  assert.deepEqual(statuses, []);
  const checking = updates.check();
  assert.deepEqual(statuses, [{ kind: "downloading", version: "0.2.1", percent: 25 }]);
  autoUpdater.emit("update-downloaded", { version: "0.2.1" });
  download.resolve();
  await checking;
  assert.equal(autoUpdater.checkForUpdates.mock.callCount(), 1);
  assert.equal(dialog.showMessageBox.mock.callCount(), 0);
  assert.deepEqual(updates.getStatus(), { kind: "downloaded", version: "0.2.1" });
});

test("manual portable check exposes availability without downloading or installing", async (t) => {
  const { autoUpdater, dialog, options, statuses } = updaterFixture(t, { isPortable: true });
  autoUpdater.checkForUpdates.mock.mockImplementation(async () => {
    autoUpdater.emit("update-available", { version: "0.2.1" });
    return { isUpdateAvailable: true };
  });
  const updates = startUpdateChecks(options);
  await updates.check();
  assert.deepEqual(statuses, [{ kind: "checking" }, { kind: "portable-available", version: "0.2.1" }]);
  assert.equal(autoUpdater.autoDownload, false);
  assert.equal(dialog.showMessageBox.mock.callCount(), 0);
  assert.throws(() => updates.install(), /No hay una actualización lista/);
});

test("manual download failure is localized and a second check can succeed", async (t) => {
  const errorLog = t.mock.method(console, "error", () => {});
  const { autoUpdater, options, statuses } = updaterFixture(t);
  const networkError = new Error("ECONNRESET");
  autoUpdater.checkForUpdates.mock.mockImplementationOnce(async () => ({ downloadPromise: Promise.reject(networkError) }));
  autoUpdater.checkForUpdates.mock.mockImplementation(async () => {
    autoUpdater.emit("update-not-available", { version: "0.2.0" });
    return { isUpdateAvailable: false };
  });
  const updates = startUpdateChecks(options);
  await updates.check();
  assert.deepEqual(statuses.at(-1), { kind: "error", message: "No se pudo buscar actualizaciones. Revisá la conexión." });
  assert.equal(errorLog.mock.calls[0].arguments[1], networkError);
  await updates.check();
  assert.deepEqual(statuses.at(-1), { kind: "not-available" });
});
