import { useEffect, useId, useState } from "react";
import type { DesktopUpdateStatus } from "../../types/electron";

const RELEASE_URL = "https://github.com/tomygiordev/nictech/releases/latest";
const CHECK_ERROR = "No se pudo buscar actualizaciones. Revisá la conexión.";
const INSTALL_ERROR = "No se pudo reiniciar para instalar la actualización.";

function statusMessage(status: DesktopUpdateStatus | null, version: string | null) {
  switch (status?.kind) {
    case "checking": return "Buscando…";
    case "not-available": return `Ya tenés la última versión${version ? ` (v${version})` : ""}`;
    case "available": return `Descargando v${status.version}… 0%`;
    case "downloading": return `Descargando v${status.version}… ${status.percent}%`;
    case "downloaded": return `v${status.version} lista:`;
    case "portable-available": return `Hay una versión nueva (v${status.version}):`;
    case "error": return status.message;
    default: return "";
  }
}

export function UpdatesCard() {
  const desktop = window.erpDesktop;
  const titleId = useId();
  const [version, setVersion] = useState<string | null>(null);
  const [versionFailed, setVersionFailed] = useState(false);
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    let mounted = true;
    const unsubscribe = desktop.updates.onStatus((next) => {
      setStatus(next);
      if (next.kind === "error") setInstalling(false);
    });
    void desktop.getVersion().then((installed) => {
      if (mounted) setVersion(installed);
    }).catch(() => {
      if (mounted) setVersionFailed(true);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [desktop]);

  async function check() {
    if (!desktop) return;
    setStatus({ kind: "checking" });
    try {
      await desktop.updates.check();
    } catch {
      setStatus({ kind: "error", message: CHECK_ERROR });
    }
  }

  async function install() {
    if (!desktop) return;
    setInstalling(true);
    try {
      await desktop.updates.install();
    } catch {
      setInstalling(false);
      setStatus({ kind: "error", message: INSTALL_ERROR });
    }
  }

  const kind = status?.kind;
  const busy = installing || kind === "checking" || kind === "available" || kind === "downloading";
  const subtitle = !desktop ? "Disponible solo en la app de escritorio"
    : version ? `Versión instalada: v${version}`
    : versionFailed ? "Versión instalada no disponible" : "Consultando versión instalada…";

  return (
    <section className="flow-card" aria-labelledby={titleId}>
      <div className="flow-card__header" style={{ marginBottom: status ? undefined : 0 }}>
        <div>
          <h2 id={titleId} className="flow-card__title">Actualizaciones</h2>
          <p className="flow-card__subtitle">{subtitle}</p>
        </div>
        <button type="button" className="btn-secondary" disabled={!desktop || busy} onClick={() => void check()}>
          Buscar actualizaciones
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span role="status" aria-atomic="true" style={{ fontSize: "13px", color: "var(--text-muted)" }}>{installing ? "Reiniciando…" : statusMessage(status, version)}</span>
        {kind === "downloaded" && (
          <button type="button" className="btn-primary" disabled={installing} onClick={() => void install()}>
            Reiniciar e instalar
          </button>
        )}
        {kind === "portable-available" && (
          <a className="btn-secondary" href={RELEASE_URL} target="_blank" rel="noreferrer">Descargar</a>
        )}
      </div>
    </section>
  );
}
