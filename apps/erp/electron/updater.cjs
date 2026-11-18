const RELEASE_URL = "https://github.com/tomygiordev/nictech/releases/latest";
const INITIAL_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const CHECK_ERROR = "No se pudo buscar actualizaciones. Revisá la conexión.";
const INSTALL_ERROR = "No se pudo reiniciar para instalar la actualización.";

function logUpdateError(error) {
  console.error("Error al actualizar NicTech ERP:", error);
}

function startUpdateChecks({ app, dialog, shell, getWindow, isPortable, onStatus = () => {}, loadUpdater = () => require("electron-updater").autoUpdater }) {
  if (!app.isPackaged) return;

  try {
    const autoUpdater = loadUpdater();
    autoUpdater.autoDownload = !isPortable;
    autoUpdater.autoInstallOnAppQuit = !isPortable;

    let notifiedVersion;
    let status = null;
    let operationStatus;
    let activeCheck;
    let manual = false;
    let installRequested = false;

    function publish(next) {
      status = next;
      onStatus(next);
    }

    function report(next) {
      operationStatus = next;
      if (manual || next.kind === "downloaded" || next.kind === "portable-available") publish(next);
    }

    async function notifyUpdate({ version }) {
      const window = getWindow();
      if (!window || window.isDestroyed() || notifiedVersion === version) return;
      notifiedVersion = version;

      const { response } = await dialog.showMessageBox(window, {
        type: "info",
        title: "Actualización de NicTech ERP",
        message: isPortable
          ? `Hay una nueva versión de NicTech ERP (v${version}). Descargá el instalador desde GitHub.`
          : `Hay una nueva versión de NicTech ERP (v${version}) lista. ¿Reiniciar ahora para actualizar?`,
        buttons: [isPortable ? "Abrir descargas" : "Reiniciar ahora", "Más tarde"],
        defaultId: 0,
        cancelId: 1,
      });

      if (response !== 0) return;
      if (isPortable) await shell.openExternal(RELEASE_URL);
      else autoUpdater.quitAndInstall();
    }

    function updateReady(kind, version) {
      report({ kind, version });
      if (manual) notifiedVersion = version;
      else void notifyUpdate({ version }).catch(logUpdateError);
    }

    autoUpdater.on("update-available", ({ version }) => {
      if (isPortable) updateReady("portable-available", version);
      else report({ kind: "available", version });
    });
    autoUpdater.on("update-not-available", () => report({ kind: "not-available" }));
    autoUpdater.on("download-progress", ({ percent }) => {
      if (!Number.isFinite(percent) || !["available", "downloading"].includes(operationStatus?.kind)) return;
      const wholePercent = Math.min(100, Math.max(0, Math.round(percent)));
      if (operationStatus.kind === "downloading" && operationStatus.percent === wholePercent) return;
      report({ kind: "downloading", version: operationStatus.version, percent: wholePercent });
    });
    autoUpdater.on("update-downloaded", ({ version }) => {
      if (!isPortable) updateReady("downloaded", version);
    });

    function checkForUpdates(requestedManually = false) {
      if (activeCheck) {
        if (requestedManually && !manual) {
          manual = true;
          publish(operationStatus);
        }
        return activeCheck;
      }
      manual = requestedManually;
      report({ kind: "checking" });
      activeCheck = (async () => {
        try {
          const result = await autoUpdater.checkForUpdates();
          if (!result && manual) throw new Error("Actualizador inactivo");
          await result?.downloadPromise;
        } catch (error) {
          logUpdateError(error);
          report({ kind: "error", message: CHECK_ERROR });
        }
      })().finally(() => {
        activeCheck = undefined;
        operationStatus = undefined;
        manual = false;
      });
      return activeCheck;
    }

    function reportInstallError() {
      if (!installRequested) return;
      installRequested = false;
      publish({ kind: "error", message: INSTALL_ERROR });
    }
    autoUpdater.on("error", reportInstallError);

    function install() {
      if (installRequested) return;
      if (isPortable || status?.kind !== "downloaded") throw new Error("No hay una actualización lista para instalar.");
      installRequested = true;
      try {
        autoUpdater.quitAndInstall();
      } catch (error) {
        logUpdateError(error);
        reportInstallError();
      }
    }

    const checkAutomatically = () => { if (!installRequested) void checkForUpdates(); };
    let interval;
    const initialCheck = setTimeout(() => {
      interval = setInterval(checkAutomatically, CHECK_INTERVAL_MS);
      checkAutomatically();
    }, INITIAL_DELAY_MS);
    app.once("will-quit", () => {
      clearTimeout(initialCheck);
      clearInterval(interval);
    });
    return { check: () => checkForUpdates(true), install, getStatus: () => status };
  } catch (error) {
    logUpdateError(error);
  }
}

module.exports = { startUpdateChecks };
