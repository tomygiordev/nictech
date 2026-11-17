import { useState } from "react";
import { Download } from "lucide-react";
import { downloadCsvFile, type CsvCell } from "../../lib/csv";
import { Modal } from "./WorkspaceUi";

export interface OfficialCsvDataset {
  headers: string[];
  rows: CsvCell[][];
  truncated: boolean;
}

interface OfficialCsvExportButtonProps {
  filename: string;
  label?: string;
  disabled?: boolean;
  loadDataset: (reason: string) => Promise<OfficialCsvDataset>;
}

export const OfficialCsvExportButton = ({
  filename,
  label = "Exportar CSV",
  disabled = false,
  loadDataset,
}: OfficialCsvExportButtonProps) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultNote, setResultNote] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setReason("");
    setError(null);
  };

  const exportDataset = async () => {
    try {
      setBusy(true);
      setError(null);
      const dataset = await loadDataset(reason.trim());
      downloadCsvFile(filename, dataset.headers, dataset.rows);
      setResultNote(
        dataset.truncated
          ? `Se exportaron ${dataset.rows.length} filas; el resultado alcanzó el límite autorizado.`
          : `Se exportaron ${dataset.rows.length} filas y la operación quedó auditada.`,
      );
      setOpen(false);
      setReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo generar la exportación oficial.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
        <button
          type="button"
          className="pag-btn"
          style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          onClick={() => {
            setResultNote(null);
            setOpen(true);
          }}
          disabled={disabled}
        >
          <Download size={14} /> {label}
        </button>
        {resultNote && <span style={{ maxWidth: "320px", fontSize: "11px", color: "#475569" }}>{resultNote}</span>}
      </div>

      <Modal
        isOpen={open}
        onClose={close}
        title="Exportación oficial"
        subtitle="La base verifica reports.export, aplica el límite y registra el motivo sin guardar el contenido exportado."
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button type="button" className="pag-btn" onClick={close} disabled={busy}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void exportDataset()}
              disabled={busy || reason.trim().length < 3}
            >
              {busy ? "Generando…" : "Autorizar y descargar"}
            </button>
          </div>
        }
      >
        {error && <div className="state-panel state-panel--error">{error}</div>}
        <label style={{ display: "block", fontSize: "13px", color: "var(--text-muted)" }}>
          Motivo de la exportación (obligatorio)
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={500}
            style={{ width: "100%", marginTop: "6px" }}
            placeholder="Ej.: cierre mensual y conciliación administrativa"
          />
        </label>
      </Modal>
    </>
  );
};
