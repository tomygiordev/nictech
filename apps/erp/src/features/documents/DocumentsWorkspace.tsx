import { useState, useEffect, useMemo } from "react";
import {
  FileText,
  Search,
  Plus,
  ShieldCheck,
  Printer,
  Ban,
  Building2,
  Calendar,
} from "lucide-react";
import {
  WorkspaceHeader,
  Modal,
  FeedbackAlert,
  KpiCard,
} from "../../components/erp/WorkspaceUi";
import { formatCurrency, formatDateTime } from "../../lib/formatters";

export interface FiscalDocument {
  id: string;
  docNumber: string;
  docType: "factura_a" | "factura_b" | "factura_c" | "recibo_x" | "remito" | "garantia";
  customerName: string;
  customerTaxId: string;
  posNumber: string;
  caeNumber?: string;
  caeExpiresAt?: string;
  totalArs: number;
  status: "authorized" | "pending_arca" | "rejected" | "voided";
  issuedAt: string;
  pdfStoragePath: string;
}

const DOC_STATUS_MAP = {
  authorized: { label: "Emitido (No Fiscal)", pillClass: "flow-status-pill completed" },
  pending_arca: { label: "Pendiente Fiscal", pillClass: "flow-status-pill processing" },
  rejected: { label: "Rechazado", pillClass: "flow-status-pill cancelled" },
  voided: { label: "Anulado", pillClass: "flow-status-pill pending" },
};

const DOC_TYPE_LABELS: Record<FiscalDocument["docType"], string> = {
  factura_a: "Factura A (Borrador)",
  factura_b: "Factura B (Borrador)",
  factura_c: "Factura C (Borrador)",
  recibo_x: "Recibo X (Taller)",
  remito: "Remito de Entrega",
  garantia: "Certificado Garantía",
};

export const DocumentsWorkspace = () => {
  const [docs, setDocs] = useState<FiscalDocument[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [selectedDoc, setSelectedDoc] = useState<FiscalDocument | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form states
  const [docType, setDocType] = useState<FiscalDocument["docType"]>("recibo_x");
  const [customerName, setCustomerName] = useState("");
  const [customerTaxId, setCustomerTaxId] = useState("");
  const [posNumber, setPosNumber] = useState("PV 0001 - Mostrador Principal");
  const [totalArs, setTotalArs] = useState("");

  const handleCreateDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !totalArs) return;

    const num = Math.floor(100000 + Math.random() * 900000);
    const prefix = docType === "factura_a" ? "FACT-A" : docType === "factura_b" ? "FACT-B" : docType === "factura_c" ? "FACT-C" : docType === "recibo_x" ? "REC-X" : "REM";

    const newDoc: FiscalDocument = {
      id: `doc-${Date.now()}`,
      docNumber: `${prefix}-0001-00${num}`,
      docType,
      customerName: customerName.trim(),
      customerTaxId: customerTaxId.trim() || "20-00000000-0",
      posNumber,
      totalArs: parseFloat(totalArs) || 0,
      status: "authorized",
      issuedAt: formatDateTime(new Date()),
      pdfStoragePath: `documents/org-1/branch-1/sales/${num}.pdf`,
    };

    setDocs([newDoc, ...docs]);
    setFeedback(`¡Comprobante no fiscal "${newDoc.docNumber}" registrado como Remito/Recibo Interno!`);
    setIsModalOpen(false);
    setCustomerName("");
    setCustomerTaxId("");
    setTotalArs("");
  };

  const handleVoidDoc = (id: string) => {
    setDocs((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: "voided" as const } : d))
    );
    if (selectedDoc && selectedDoc.id === id) {
      setSelectedDoc({ ...selectedDoc, status: "voided" });
    }
    setFeedback("Comprobante anulado formalmente.");
  };

  const handlePrint = (doc: FiscalDocument) => {
    setSelectedDoc(doc);
    setTimeout(() => {
      window.print();
    }, 100);
  };

  const filteredDocs = useMemo(() => {
    return docs.filter((d) => {
      const matchFilter = activeFilter === "all" || d.docType === activeFilter;
      const q = search.toLowerCase();
      const matchSearch =
        d.docNumber.toLowerCase().includes(q) ||
        d.customerName.toLowerCase().includes(q) ||
        d.customerTaxId.includes(q) ||
        (d.caeNumber && d.caeNumber.includes(q));
      return matchFilter && matchSearch;
    });
  }, [docs, activeFilter, search]);

  const totalBilledArs = docs
    .filter((d) => d.status === "authorized")
    .reduce((acc, d) => acc + d.totalArs, 0);

  const authorizedCount = docs.filter((d) => d.status === "authorized").length;

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Documentos Oficiales & Facturación Electrónica ARCA"
        description="Emisión de Facturas A/B/C con WebService ARCA (AFIP), Recibos X de taller, remitos y archivo digital PDF."
        badge={`${docs.length} Comprobantes Emitidos`}
      />

      {feedback && (
        <FeedbackAlert
          type="success"
          message={feedback}
          onClose={() => setFeedback(null)}
        />
      )}

      {/* KPI Cards */}
      <div className="kpi-grid">
        <KpiCard
          icon={FileText}
          iconVariant="green"
          label="Total Comprobantes"
          value={docs.length}
          trend={{ text: "Emitidos", positive: true }}
          sublabel="Facturas, Recibos y Remitos"
        />

        <KpiCard
          icon={Building2}
          iconVariant="navy"
          label="Total Facturado ARCA"
          value={formatCurrency(totalBilledArs, "ARS")}
          trend={{ text: "ARS", positive: true }}
          sublabel={`${authorizedCount} autorizados con CAE`}
        />

        <KpiCard
          icon={ShieldCheck}
          iconVariant="steel"
          label="Estado WebService ARCA"
          value="No Configurado"
          trend={{ text: "Sin homologar", positive: false }}
          sublabel="Modo comprobante interno"
        />

        <KpiCard
          icon={Calendar}
          iconVariant="dark"
          label="Puntos de Venta"
          value="1 PV Activo"
          trend={{ text: "Local", positive: true }}
          sublabel="PV 0001 - Mostrador"
        />
      </div>

      <div style={{ padding: "12px 16px", background: "rgba(234, 179, 8, 0.1)", border: "1px solid rgba(234, 179, 8, 0.3)", borderRadius: "8px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--amber-accent)" }}>
        <FileText size={16} style={{ flexShrink: 0 }} />
        <span><strong>[Comprobantes No Fiscales / Remitos Internos]:</strong> La conexión formal con WebService ARCA (AFIP) requiere certificado digital y se implementa en la FASE E. Los comprobantes operan como remitos y recibos internos sin CAE fabricado.</span>
      </div>

      {/* Main Card */}
      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Libro de Documentos & Facturación</h2>
            <p className="flow-card__subtitle">Registro de comprobantes internos, recibos y remitos de entrega</p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div className="flow-search-pill" style={{ width: "260px" }}>
              <Search size={15} />
              <input
                type="text"
                placeholder="Buscar por nro, CUIT, cliente o CAE..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={() => setIsModalOpen(true)}
            >
              <Plus size={16} />
              Emitir Comprobante
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="horizontal-scroll-pills" style={{ marginBottom: "16px" }}>
          {[
            { id: "all", label: "Todos los Tipos" },
            { id: "factura_a", label: "Facturas A" },
            { id: "factura_b", label: "Facturas B" },
            { id: "recibo_x", label: "Recibos X" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`flow-select-pill ${activeFilter === tab.id ? "active" : ""}`}
              onClick={() => setActiveFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="flow-table-wrapper">
          <table className="flow-table">
            <thead>
              <tr>
                <th>Comprobante</th>
                <th>Tipo</th>
                <th>Cliente / Razón Social</th>
                <th>CUIT / DNI</th>
                <th>CAE / Vencimiento</th>
                <th>Total Facturado</th>
                <th>Estado</th>
                <th className="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocs.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    No hay comprobantes emitidos en el sistema.
                  </td>
                </tr>
              ) : (
                filteredDocs.map((doc) => {
                const st = DOC_STATUS_MAP[doc.status] || DOC_STATUS_MAP.authorized;
                return (
                  <tr key={doc.id} style={{ cursor: "pointer" }} onClick={() => setSelectedDoc(doc)}>
                    <td>
                      <span className="type-badge purple nowrap" style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>
                        {doc.docNumber}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: "12px", fontWeight: 650, color: "var(--text-muted)" }}>
                        {DOC_TYPE_LABELS[doc.docType] || doc.docType}
                      </span>
                    </td>
                    <td>
                      <strong>{doc.customerName}</strong>
                    </td>
                    <td>
                      <span className="nowrap" style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {doc.customerTaxId}
                      </span>
                    </td>
                    <td>
                      {doc.caeNumber ? (
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={{ fontSize: "12px", fontFamily: "monospace", fontWeight: 700, color: "var(--text-main)" }}>
                            {doc.caeNumber}
                          </span>
                          <span style={{ fontSize: "10px", color: "var(--text-light)" }}>Vence: {doc.caeExpiresAt}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: "12px", color: "var(--text-light)" }}>No aplica (Interno)</span>
                      )}
                    </td>
                    <td>
                      <strong style={{ color: "var(--brand-primary)" }}>{formatCurrency(doc.totalArs, "ARS")}</strong>
                    </td>
                    <td>
                      <span className={st.pillClass}>{st.label}</span>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="pag-btn"
                        style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePrint(doc);
                        }}
                      >
                        <Printer size={13} /> Imprimir / PDF
                      </button>
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Document Detail Modal */}
      {selectedDoc && (
        <Modal
          isOpen={Boolean(selectedDoc)}
          onClose={() => setSelectedDoc(null)}
          title={selectedDoc.docNumber}
          subtitle={`${DOC_TYPE_LABELS[selectedDoc.docType] || selectedDoc.docType} • ${selectedDoc.customerName}`}
          icon={FileText}
          maxWidth="600px"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px", background: "var(--canvas-bg)", padding: "12px", borderRadius: "10px" }}>
              <div>
                <span className="stat-label">Punto de Venta</span>
                <strong style={{ display: "block", fontSize: "13px", marginTop: "2px" }}>
                  {selectedDoc.posNumber}
                </strong>
              </div>
              <div>
                <span className="stat-label">Identificación Tributaria</span>
                <strong style={{ display: "block", fontSize: "13px", marginTop: "2px", fontFamily: "monospace" }}>
                  {selectedDoc.customerTaxId}
                </strong>
              </div>
              <div>
                <span className="stat-label">CAE Oficial ARCA</span>
                <span style={{ display: "block", fontSize: "13px", marginTop: "2px", fontWeight: 700, color: "var(--emerald-success)" }}>
                  {selectedDoc.caeNumber || "Comprobante Interno"}
                </span>
              </div>
              <div>
                <span className="stat-label">Total Documento</span>
                <strong style={{ display: "block", fontSize: "14px", marginTop: "2px", color: "var(--brand-primary)" }}>
                  {formatCurrency(selectedDoc.totalArs, "ARS")}
                </strong>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-line)", paddingTop: "12px" }}>
              <button type="button" className="btn-primary" onClick={() => window.print()}>
                <Printer size={15} /> Imprimir Comprobante
              </button>

              {selectedDoc.status === "authorized" && (
                <button
                  type="button"
                  className="pag-btn"
                  style={{ color: "var(--rose-accent)", borderColor: "var(--rose-border)" }}
                  onClick={() => handleVoidDoc(selectedDoc.id)}
                >
                  <Ban size={14} /> Anular Comprobante
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Emitir Comprobante */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Emitir Comprobante Fiscal / Recibo"
        subtitle="Autorización electrónica en línea con WebService ARCA (AFIP)"
        icon={FileText}
        maxWidth="520px"
      >
        <form onSubmit={handleCreateDocument} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Tipo de Comprobante *</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as FiscalDocument["docType"])}
                className="erp-form-select"
              >
                <option value="factura_b">Factura B (Consumidor Final)</option>
                <option value="factura_a">Factura A (Resp. Inscripto)</option>
                <option value="factura_c">Factura C</option>
                <option value="recibo_x">Recibo X (Taller / Seña)</option>
                <option value="remito">Remito de Despacho</option>
              </select>
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Punto de Venta *</label>
              <select
                value={posNumber}
                onChange={(e) => setPosNumber(e.target.value)}
                className="erp-form-select"
              >
                <option value="PV 0001 - Mostrador Principal">PV 0001 - Local Central</option>
                <option value="PV 0002 - Tienda Web Online">PV 0002 - Tienda Web Online</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Razón Social / Nombre *</label>
              <input
                type="text"
                required
                placeholder="Ej: Sofía Gómez"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="erp-form-input"
              />
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">CUIT / DNI *</label>
              <input
                type="text"
                required
                placeholder="Ej: 27-42104928-1"
                value={customerTaxId}
                onChange={(e) => setCustomerTaxId(e.target.value)}
                className="erp-form-input"
              />
            </div>
          </div>

          <div className="erp-form-group">
            <label className="erp-form-label">Monto Total ($ ARS) *</label>
            <input
              type="number"
              required
              placeholder="Ej: 245000"
              value={totalArs}
              onChange={(e) => setTotalArs(e.target.value)}
              className="erp-form-input"
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary">
              Autorizar en ARCA & Emitir
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
