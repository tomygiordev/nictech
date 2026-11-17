import { useState, useEffect, useMemo, useCallback } from "react";
import {
  FileText,
  Search,
  Plus,
  ShieldCheck,
  Ban,
  Building2,
  Calendar,
  Printer,
} from "lucide-react";
import {
  WorkspaceHeader,
  Modal,
  FeedbackAlert,
  KpiCard,
  StatePanel,
} from "../../components/erp/WorkspaceUi";
import { formatCurrency, formatDateTime } from "../../lib/formatters";
import {
  issueDocument,
  listDocumentEvents,
  listDocumentTemplateVersions,
  listDocumentTemplates,
  listDocuments,
  listFiscalEventsByRequest,
  listFiscalPoints,
  listFiscalRequests,
  requestFiscalIssuance,
  sha256Hex,
  cancelSale,
  voidDocument,
} from "./api";
import SaleReceipt from "../../components/erp/SaleReceipt";
import type {
  DocumentEventRecord,
  DocumentOwnerType,
  DocumentRecord,
  DocumentTemplate,
  DocumentTemplateVersion,
  FiscalEvent,
  FiscalPoint,
  FiscalRequest,
} from "./api";

const OWNER_TYPE_LABELS: Record<DocumentOwnerType, string> = {
  sale: "Venta",
  payment: "Pago",
  repair: "Reparación",
  warranty: "Garantía",
  pc_build: "Armado PC",
  trade_in: "Plan canje",
};

const OWNER_TYPES = Object.keys(OWNER_TYPE_LABELS) as DocumentOwnerType[];

// Local invoice issuance is complete. This flag controls only the optional future
// provider authorization path; it never gates sale or invoice creation.
const FISCAL_PROVIDER_CONNECTED = false;

const snapshotText = (doc: DocumentRecord, key: string): string => {
  const value = doc.customer_snapshot[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
};

const customerDisplayName = (doc: DocumentRecord): string =>
  snapshotText(doc, "display_name") || snapshotText(doc, "legal_name") || "—";

const customerLegalName = (doc: DocumentRecord): string =>
  snapshotText(doc, "legal_name") || snapshotText(doc, "display_name") || "—";

const normalizeCustomerName = (name: string): string =>
  name.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-AR");

const customerLegalNameLabel = (doc: DocumentRecord): string => {
  const displayName = customerDisplayName(doc);
  const legalName = customerLegalName(doc);
  return normalizeCustomerName(displayName) === normalizeCustomerName(legalName)
    ? "Igual al cliente"
    : legalName;
};

const SALE_STATE_LABELS: Record<string, string> = {
  confirmed: "Confirmada",
  cancelled: "Cancelada",
};

const PAYMENT_STATE_LABELS: Record<string, string> = {
  unpaid: "Sin pagar",
  partial: "Pago parcial",
  paid: "Pagado",
  refunded: "Revertido en ERP",
};

const DOCUMENT_EVENT_LABELS: Record<string, string> = {
  issued: "Emitido",
  voided: "Anulado",
};

const saleStateLabel = (state: string | null): string =>
  state ? SALE_STATE_LABELS[state] ?? state : "Sin evento comercial";

const paymentStateLabel = (state: string | null): string =>
  state ? PAYMENT_STATE_LABELS[state] ?? state : "Sin evento de pago";

const snapshotTotal = (doc: DocumentRecord): number => {
  if (doc.amount_ars !== null) return doc.amount_ars;
  const value = doc.customer_snapshot["total_ars"];
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value) || 0;
  return 0;
};

const isVoided = (events: DocumentEventRecord[]): boolean =>
  events.some((e) => e.status === "voided");

const latestFiscalEvent = (events: FiscalEvent[]): FiscalEvent | null => {
  if (events.length === 0) return null;
  return events.reduce((acc, cur) => (cur.event_sequence > acc.event_sequence ? cur : acc));
};

export const DocumentsWorkspace = () => {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [versions, setVersions] = useState<DocumentTemplateVersion[]>([]);
  const [fiscalPoints, setFiscalPoints] = useState<FiscalPoint[]>([]);
  const [fiscalRequests, setFiscalRequests] = useState<FiscalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<DocumentEventRecord[]>([]);
  const [selectedFiscalEvents, setSelectedFiscalEvents] = useState<FiscalEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [branchId, setBranchId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templateVersionId, setTemplateVersionId] = useState("");
  const [ownerType, setOwnerType] = useState<DocumentOwnerType>("sale");
  const [ownerId, setOwnerId] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [totalArs, setTotalArs] = useState("");
  const [reason, setReason] = useState("");

  const [voidReason, setVoidReason] = useState("");
  const [saleCancelReason, setSaleCancelReason] = useState("");
  const [fiscalPointId, setFiscalPointId] = useState("");
  const [voucherType, setVoucherType] = useState("");
  const [fiscalReason, setFiscalReason] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [docRows, templateRows, pointRows, requestRows] = await Promise.all([
        listDocuments(),
        listDocumentTemplates(),
        listFiscalPoints(),
        listFiscalRequests(),
      ]);
      setDocs(docRows);
      setTemplates(templateRows);
      setFiscalPoints(pointRows);
      setFiscalRequests(requestRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los documentos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (templateId.trim() === "") {
      setVersions([]);
      setTemplateVersionId("");
      return;
    }
    listDocumentTemplateVersions(templateId)
      .then((rows) => {
        setVersions(rows);
        if (!rows.some((v) => v.id === templateVersionId)) setTemplateVersionId("");
      })
      .catch((err: unknown) => {
        setActionError(err instanceof Error ? err.message : "No se pudieron cargar las versiones.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  const selectedDoc = useMemo(
    () => docs.find((d) => d.id === selectedDocId) ?? null,
    [docs, selectedDocId],
  );

  useEffect(() => {
    setSaleCancelReason("");
  }, [selectedDocId]);

  const selectedFiscalRequest = useMemo(() => {
    if (!selectedDoc) return null;
    return fiscalRequests.find((r) => r.document_id === selectedDoc.id) ?? null;
  }, [fiscalRequests, selectedDoc]);

  useEffect(() => {
    if (!selectedDoc) {
      setSelectedEvents([]);
      setSelectedFiscalEvents([]);
      return;
    }
    setDetailLoading(true);
    const loadDetail = async () => {
      try {
        const events = await listDocumentEvents(selectedDoc.id);
        setSelectedEvents(events);
        const request = fiscalRequests.find((r) => r.document_id === selectedDoc.id) ?? null;
        if (request) {
          const fiscalEvents = await listFiscalEventsByRequest(request.id);
          setSelectedFiscalEvents(fiscalEvents);
        } else {
          setSelectedFiscalEvents([]);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "No se pudo cargar el detalle.");
      } finally {
        setDetailLoading(false);
      }
    };
    void loadDetail();
  }, [selectedDoc, fiscalRequests]);

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setActionError(null);
    setSaving(true);
    try {
      const snapshot = {
        display_name: customerName.trim(),
        legal_name: customerName.trim(),
        total_ars: parseFloat(totalArs) || 0,
      };
      if (snapshot.display_name === "") throw new Error("El nombre del cliente es obligatorio.");
      const digest = await sha256Hex(
        JSON.stringify({
          owner_type: ownerType,
          owner_id: ownerId.trim(),
          document_number: documentNumber.trim(),
          snapshot,
        }),
      );
      const id = await issueDocument({
        branchId: branchId.trim(),
        templateVersionId: templateVersionId,
        ownerType,
        ownerId: ownerId.trim(),
        documentNumber: documentNumber.trim(),
        customerSnapshot: snapshot,
        contentSha256: digest,
        reason,
      });
      setFeedback(`Documento emitido (${id}).`);
      setIsModalOpen(false);
      setBranchId("");
      setTemplateId("");
      setTemplateVersionId("");
      setOwnerId("");
      setDocumentNumber("");
      setCustomerName("");
      setTotalArs("");
      setReason("");
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo emitir el documento.");
    } finally {
      setSaving(false);
    }
  };

  const handleVoidDoc = async () => {
    if (!selectedDoc || saving) return;
    setActionError(null);
    setSaving(true);
    try {
      await voidDocument(selectedDoc.id, voidReason);
      setFeedback(`Documento "${selectedDoc.document_number}" anulado.`);
      setVoidReason("");
      await refresh();
      const events = await listDocumentEvents(selectedDoc.id);
      setSelectedEvents(events);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo anular el documento.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelSale = async () => {
    if (
      !selectedDoc ||
      selectedDoc.owner_type !== "sale" ||
      !selectedDoc.sale_receipt ||
      selectedDoc.sale_receipt.sale_state === "cancelled" ||
      saving
    ) return;
    setActionError(null);
    setSaving(true);
    try {
      await cancelSale(selectedDoc.sale_receipt.sale_id, saleCancelReason);
      setFeedback(
        `Venta cancelada en ERP. Se registró la reversión de sus pagos y se repuso el stock. Los cobros externos no se devolvieron; gestioná su devolución desde el medio o proveedor correspondiente. El comprobante "${selectedDoc.document_number}" permanece en Documentos.`,
      );
      setSaleCancelReason("");
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo cancelar la venta.");
    } finally {
      setSaving(false);
    }
  };

  const handleFiscalRequest = async () => {
    if (!selectedDoc || saving) return;
    setActionError(null);
    setSaving(true);
    try {
      const id = await requestFiscalIssuance(
        selectedDoc.id,
        fiscalPointId,
        voucherType,
        fiscalReason,
      );
      setFeedback(`Timbrado solicitado (${id}). Estado: encolado, pendiente del proveedor.`);
      setFiscalPointId("");
      setVoucherType("");
      setFiscalReason("");
      const requestRows = await listFiscalRequests();
      setFiscalRequests(requestRows);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo solicitar el timbrado.");
    } finally {
      setSaving(false);
    }
  };

  const filteredDocs = useMemo(() => {
    return docs.filter((d) => {
      const matchFilter = activeFilter === "all" || d.owner_type === activeFilter;
      const q = search.toLowerCase();
      const matchSearch =
        d.document_number.toLowerCase().includes(q) ||
        customerDisplayName(d).toLowerCase().includes(q) ||
        customerLegalName(d).toLowerCase().includes(q);
      return matchFilter && matchSearch;
    });
  }, [docs, activeFilter, search]);

  const totalBilledArs = docs
    .filter((d) => d.status === "issued")
    .reduce((acc, d) => acc + snapshotTotal(d), 0);

  const issuedCount = docs.filter((d) => d.status === "issued").length;

  const selectedFiscalStatus = selectedFiscalRequest
    ? (latestFiscalEvent(selectedFiscalEvents)?.status ?? "queued")
    : null;
  const selectedCae = latestFiscalEvent(selectedFiscalEvents)?.cae ?? null;

  return (
    <div className="flow-dashboard">
      <WorkspaceHeader
        title="Documentos y facturas"
        description="Consultá ventas con comprobantes fiscales y no fiscales, pagos, reparaciones, armados y canjes."
        badge="Prototipo comercial"
      />

      {!FISCAL_PROVIDER_CONNECTED && (
        <FeedbackAlert
          type="info"
          message="Autorización fiscal pendiente de integración con ARCA"
          submessage="Los comprobantes fiscales se registran y numeran en el ERP. Para contar con autorización fiscal deben obtener CAE/CAEA; las solicitudes previas permanecen visibles para auditoría."
        />
      )}

      {feedback && (
        <FeedbackAlert type="success" message={feedback} onClose={() => setFeedback(null)} />
      )}
      {actionError && (
        <FeedbackAlert type="error" message={actionError} onClose={() => setActionError(null)} />
      )}

      <div className="kpi-grid">
        <KpiCard
          icon={FileText}
          iconVariant="green"
          label="Total Documentos"
          value={docs.length}
          trend={{ text: "Emitidos", positive: true }}
          sublabel="Ventas, pagos, reparaciones y más"
        />
        <KpiCard
          icon={Building2}
          iconVariant="navy"
          label="Total Documentado"
          value={formatCurrency(totalBilledArs, "ARS")}
          trend={{ text: "ARS", positive: true }}
          sublabel={`${issuedCount} documentos emitidos`}
        />
        <KpiCard
          icon={ShieldCheck}
          iconVariant="steel"
          label="Solicitudes a proveedor"
          value={fiscalRequests.length}
          trend={{ text: "Opcional", positive: true }}
          sublabel="Autorización separada de la emisión interna"
        />
        <KpiCard
          icon={Calendar}
          iconVariant="dark"
          label="Puntos de Venta"
          value={`${fiscalPoints.length} PV`}
          trend={{ text: "Fiscales", positive: true }}
          sublabel="Configuración opcional para proveedor futuro"
        />
      </div>

      <div className="flow-card">
        <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="flow-card__title">Libro de Documentos</h2>
            <p className="flow-card__subtitle">Documentos emitidos desde el backend con trazabilidad de eventos</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div className="flow-search-pill" style={{ width: "260px" }}>
              <Search size={15} />
              <input
                type="text"
                placeholder="Buscar por nro, cliente o CUIT…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button type="button" className="btn-primary" onClick={() => setIsModalOpen(true)}>
              <Plus size={16} />
              Registrar documento
            </button>
          </div>
        </div>

        <div className="horizontal-scroll-pills" style={{ marginBottom: "16px" }}>
          {[{ id: "all", label: "Todos" }, ...OWNER_TYPES.map((t) => ({ id: t, label: OWNER_TYPE_LABELS[t] }))].map(
            (tab) => (
              <button
                key={tab.id}
                type="button"
                className={`flow-select-pill ${activeFilter === tab.id ? "active" : ""}`}
                onClick={() => setActiveFilter(tab.id)}
              >
                {tab.label}
              </button>
            ),
          )}
        </div>

        {loading && (
          <StatePanel type="loading" title="Cargando documentos" message="Consultando documentos en Supabase…" />
        )}

        {!loading && error && (
          <StatePanel
            type="error"
            title="No se pudieron cargar los documentos"
            message={error}
            action={
              <button type="button" className="btn-primary" onClick={() => void refresh()}>
                Reintentar
              </button>
            }
          />
        )}

        {!loading && !error && (
          <div className="flow-table-wrapper">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Dueño</th>
                  <th>Cliente</th>
                  <th>Razón social</th>
                  <th>Tipo / proveedor</th>
                  <th>Total</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocs.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                      No hay documentos emitidos en el sistema.
                    </td>
                  </tr>
                ) : (
                  filteredDocs.map((doc) => {
                    const request = fiscalRequests.find((r) => r.document_id === doc.id) ?? null;
                    const reversedPaymentCount = doc.sale_receipt?.payments.filter((payment) => payment.reversed).length ?? 0;
                    return (
                      <tr
                        key={doc.id}
                        className="interactive-row"
                        role="button"
                        tabIndex={0}
                        aria-label={`Abrir documento ${doc.document_number}`}
                        onClick={() => setSelectedDocId(doc.id)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedDocId(doc.id);
                          }
                        }}
                      >
                        <td>
                          <span className="type-badge purple nowrap" style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>
                            {doc.document_number}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: "12px", fontWeight: 650, color: "var(--text-muted)" }}>
                            {OWNER_TYPE_LABELS[doc.owner_type] ?? doc.owner_type}
                          </span>
                        </td>
                        <td>
                          <strong>{customerDisplayName(doc)}</strong>
                        </td>
                        <td>
                          <span className="nowrap" style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                            {customerLegalNameLabel(doc)}
                          </span>
                        </td>
                        <td>
                          {doc.invoice_kind === "fiscal" ? (
                            <span className="flow-status-pill pending">Fiscal · pendiente de CAE</span>
                          ) : doc.invoice_kind === "non_fiscal" ? (
                            <span className="flow-status-pill pending">No fiscal</span>
                          ) : request ? (
                            <span className="flow-status-pill processing">Solicitud a proveedor</span>
                          ) : (
                            <span className="flow-status-pill pending">Documento interno</span>
                          )}
                          {request && (
                            <span style={{ display: "block", marginTop: "3px", fontSize: "10px", color: "var(--text-muted)" }}>
                              {request.voucher_type} {String(request.voucher_number)}
                            </span>
                          )}
                        </td>
                        <td>
                          <strong style={{ color: "var(--brand-primary)" }}>
                            {formatCurrency(snapshotTotal(doc), "ARS")}
                          </strong>
                        </td>
                        <td>
                          {doc.status === "voided" ? (
                            <span className="flow-status-pill pending">Anulado</span>
                          ) : (
                            <span className="flow-status-pill completed">Emitido</span>
                          )}
                          {doc.sale_receipt?.sale_state === "cancelled" && (
                            <span className="flow-status-pill pending" style={{ display: "block", width: "fit-content", marginTop: "4px" }}>
                              Venta cancelada
                            </span>
                          )}
                          {doc.sale_receipt?.payment_state === "refunded" && (
                            <span className="flow-status-pill processing" style={{ display: "block", width: "fit-content", marginTop: "4px" }}>
                              Reversión registrada en ERP
                            </span>
                          )}
                          {reversedPaymentCount > 0 && (
                            <span style={{ display: "block", marginTop: "4px", fontSize: "10px", color: "var(--text-muted)" }}>
                              {reversedPaymentCount} pago(s) con reverso ERP
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedDoc && (
        <Modal
          isOpen={Boolean(selectedDoc)}
          onClose={() => setSelectedDocId(null)}
          title={selectedDoc.document_number}
          subtitle={`${OWNER_TYPE_LABELS[selectedDoc.owner_type]} • ${customerDisplayName(selectedDoc)}`}
          icon={FileText}
          maxWidth="640px"
        >
          {detailLoading ? (
            <StatePanel type="loading" message="Cargando eventos del documento…" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px", background: "var(--canvas-bg)", padding: "12px", borderRadius: "10px" }}>
                <div>
                  <span className="stat-label">Estado Documento</span>
                  <strong style={{ display: "block", fontSize: "13px", marginTop: "2px" }}>
                    {isVoided(selectedEvents) || selectedDoc.status === "voided" ? "Anulado" : "Emitido"}
                  </strong>
                </div>
                <div>
                  <span className="stat-label">Total Documento</span>
                  <strong style={{ display: "block", fontSize: "14px", marginTop: "2px", color: "var(--brand-primary)" }}>
                    {formatCurrency(snapshotTotal(selectedDoc), "ARS")}
                  </strong>
                </div>
                <div>
                  <span className="stat-label">Tipo de comprobante</span>
                  <span style={{ display: "block", fontSize: "13px", marginTop: "2px", fontWeight: 700 }}>
                    {selectedDoc.invoice_kind === "fiscal" && "Comprobante fiscal · sin autorización ARCA"}
                    {selectedDoc.invoice_kind === "non_fiscal" && "Comprobante no fiscal"}
                    {selectedDoc.invoice_kind === null && "Documento interno"}
                  </span>
                </div>
                <div>
                  <span className="stat-label">Autorización fiscal</span>
                  <span style={{ display: "block", fontSize: "13px", marginTop: "2px", fontWeight: 700 }}>
                    {!selectedFiscalRequest && selectedDoc.invoice_kind === "fiscal" && "No autorizada · integración ARCA pendiente"}
                    {!selectedFiscalRequest && selectedDoc.invoice_kind === "non_fiscal" && "No aplica"}
                    {!selectedFiscalRequest && selectedDoc.invoice_kind === null && "No solicitada"}
                    {selectedFiscalRequest && selectedFiscalStatus === "queued" && "En cola · integración futura"}
                    {selectedFiscalRequest && selectedFiscalStatus === "authorized" && `Autorizada · CAE ${selectedCae ?? ""}`}
                    {selectedFiscalRequest && selectedFiscalStatus === "rejected" && "Rechazada por el proveedor"}
                    {selectedFiscalRequest && selectedFiscalStatus === "failed" && "Fallida · requiere reintento"}
                  </span>
                </div>
                <div>
                  <span className="stat-label">PDF</span>
                  <span style={{ display: "block", fontSize: "11px", marginTop: "2px" }}>No adjuntado</span>
                </div>
                {selectedDoc.sale_receipt && (
                  <>
                    <div>
                      <span className="stat-label">Estado comercial de la venta</span>
                      <span style={{ display: "block", fontSize: "13px", marginTop: "2px", fontWeight: 700 }}>
                        {saleStateLabel(selectedDoc.sale_receipt.sale_state)}
                      </span>
                    </div>
                    <div>
                      <span className="stat-label">Estado de pago</span>
                      <span style={{ display: "block", fontSize: "13px", marginTop: "2px", fontWeight: 700 }}>
                        {paymentStateLabel(selectedDoc.sale_receipt.payment_state)}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {selectedDoc.sale_receipt && (
                <button type="button" className="btn-primary" onClick={() => window.print()}>
                  <Printer size={15} /> Reimprimir comprobante
                </button>
              )}

              {selectedDoc.owner_type === "sale" && (
                <p style={{ margin: 0, fontSize: "11px", color: "var(--text-muted)" }}>
                  Anular documento afecta solo el comprobante; no cancela la venta ni revierte pagos o stock.
                </p>
              )}

              {selectedDoc.owner_type === "sale" && selectedDoc.sale_receipt && (
                <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <strong style={{ fontSize: "12px" }}>Pagos y reversos registrados en ERP</strong>
                  {selectedDoc.sale_receipt.payments.length === 0 ? (
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Sin pagos registrados.</span>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "var(--text-muted)" }}>
                      {selectedDoc.sale_receipt.payments.map((payment, index) => (
                        <li key={`${selectedDoc.sale_receipt?.sale_id}-payment-${index}`}>
                          {payment.method_name} · {formatCurrency(payment.amount, payment.currency_code)} · {payment.reversed ? "Reverso registrado en ERP" : "Pago original"}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {selectedDoc.owner_type === "sale" &&
                selectedDoc.sale_receipt &&
                selectedDoc.sale_receipt.sale_state !== "cancelled" && (
                  <section style={{ display: "flex", flexDirection: "column", gap: "10px", border: "1px solid var(--border-line)", borderRadius: "10px", padding: "12px" }}>
                    <div>
                      <strong style={{ display: "block", fontSize: "13px" }}>Cancelar venta y revertir en ERP</strong>
                      <p style={{ margin: "4px 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                        Esta acción registra la reversión de los pagos en ERP y repone el stock; no devuelve cobros externos. Devolvé los pagos de tarjeta, Mercado Pago u otros proveedores desde el medio correspondiente. No anula ni elimina el comprobante; para eso, usá “Anular documento”.
                      </p>
                    </div>
                    <div className="erp-form-group">
                      <label className="erp-form-label">Motivo de cancelación de la venta *</label>
                      <input
                        type="text"
                        required
                        placeholder="Describí el motivo de la cancelación"
                        value={saleCancelReason}
                        onChange={(event) => setSaleCancelReason(event.target.value)}
                        className="erp-form-input"
                      />
                    </div>
                    <div>
                      <button
                        type="button"
                        className="pag-btn"
                        style={{ color: "var(--rose-accent)", borderColor: "var(--rose-border)" }}
                        disabled={saving || saleCancelReason.trim() === ""}
                        onClick={() => void handleCancelSale()}
                      >
                        <Ban size={14} /> Cancelar venta y revertir en ERP
                      </button>
                    </div>
                  </section>
                )}

              <div>
                <span className="stat-label">Historial de eventos</span>
                <ul style={{ margin: "6px 0 0", paddingLeft: "18px", fontSize: "12px", color: "var(--text-muted)" }}>
                  {selectedEvents.length === 0 && <li>Sin eventos registrados.</li>}
                  {selectedEvents.map((ev) => (
                    <li key={ev.id}>
                      {DOCUMENT_EVENT_LABELS[ev.status] ?? ev.status} · {formatDateTime(new Date(ev.occurred_at))} · {ev.reason}
                    </li>
                  ))}
                </ul>
              </div>

              {selectedFiscalRequest && (
                <div>
                  <span className="stat-label">
                    Timbrado · {selectedFiscalRequest.voucher_type} n.º {String(selectedFiscalRequest.voucher_number)}
                  </span>
                  <ul style={{ margin: "6px 0 0", paddingLeft: "18px", fontSize: "12px", color: "var(--text-muted)" }}>
                    {selectedFiscalEvents.length === 0 && (
                      <li>Solicitud encolada en el outbox. Sin resultado del proveedor todavía.</li>
                    )}
                    {selectedFiscalEvents.map((ev) => (
                      <li key={ev.id}>
                        {ev.provider} · {ev.status}
                        {ev.cae ? ` · CAE ${ev.cae}` : ""}
                        {ev.error_code ? ` · ${ev.error_code}` : ""} · {formatDateTime(new Date(ev.occurred_at))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedDoc.status !== "voided" && !isVoided(selectedEvents) && (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", borderTop: "1px solid var(--border-line)", paddingTop: "12px" }}>
                  {!selectedFiscalRequest && selectedDoc.invoice_kind === null && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <div className="erp-form-group">
                        <label className="erp-form-label">Punto de venta fiscal *</label>
                        <select value={fiscalPointId} onChange={(e) => setFiscalPointId(e.target.value)} className="erp-form-select">
                          <option value="">Seleccionar…</option>
                          {fiscalPoints.map((p) => (
                            <option key={p.id} value={p.id}>
                              PV {p.code} · {p.name} ({p.environment})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="erp-form-group">
                        <label className="erp-form-label">Tipo de comprobante *</label>
                        <input
                          type="text"
                          placeholder="Ej: FACTURA_B"
                          value={voucherType}
                          onChange={(e) => setVoucherType(e.target.value.toUpperCase())}
                          className="erp-form-input"
                        />
                      </div>
                      <div className="erp-form-group" style={{ gridColumn: "1 / -1" }}>
                        <label className="erp-form-label">Motivo del timbrado *</label>
                        <input
                          type="text"
                          placeholder="Motivo de la solicitud"
                          value={fiscalReason}
                          onChange={(e) => setFiscalReason(e.target.value)}
                          className="erp-form-input"
                        />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={saving || !FISCAL_PROVIDER_CONNECTED}
                          title={!FISCAL_PROVIDER_CONNECTED ? "Configurá un proveedor ARCA antes de solicitar timbrado." : undefined}
                          onClick={() => void handleFiscalRequest()}
                        >
                          <ShieldCheck size={15} />
                          {FISCAL_PROVIDER_CONNECTED ? "Solicitar timbrado" : "Proveedor ARCA no configurado"}
                        </button>
                      </div>
                    </div>
                  )}
                  {!selectedFiscalRequest && selectedDoc.invoice_kind !== null && (
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
                      La autorización ARCA requiere la integración fiscal correspondiente.
                    </p>
                  )}
                  <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
                    <div className="erp-form-group" style={{ flex: 1 }}>
                      <label className="erp-form-label">Motivo de anulación del documento *</label>
                      <input
                        type="text"
                        placeholder="Motivo formal"
                        value={voidReason}
                        onChange={(e) => setVoidReason(e.target.value)}
                        className="erp-form-input"
                      />
                    </div>
                    <button
                      type="button"
                      className="pag-btn"
                      style={{ color: "var(--rose-accent)", borderColor: "var(--rose-border)" }}
                      disabled={saving}
                      onClick={() => void handleVoidDoc()}
                    >
                      <Ban size={14} /> Anular documento
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {selectedDoc?.sale_receipt && <SaleReceipt receipt={selectedDoc.sale_receipt} />}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Registrar documento"
        subtitle="Registro interno trazable de facturas emitidas en el ERP; la autorización de proveedores queda como flujo futuro opcional."
        icon={FileText}
        maxWidth="560px"
      >
        <form onSubmit={(e) => void handleCreateDocument(e)} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="erp-form-group">
            <label className="erp-form-label">Sucursal *</label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="erp-form-select" required>
              <option value="">Seleccionar sucursal…</option>
              {Array.from(new Map(fiscalPoints.map((point) => [point.branch_id, point])).values()).map((point) => (
                <option key={point.branch_id} value={point.branch_id}>
                  {point.name} · Punto de venta {point.code}
                </option>
              ))}
            </select>
            {fiscalPoints.length === 0 && (
              <span className="erp-form-hint">No hay sucursales operativas disponibles. Configurá una antes de registrar documentos.</span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Plantilla *</label>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="erp-form-select" required>
                <option value="">Seleccionar…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} · {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">Versión *</label>
              <select value={templateVersionId} onChange={(e) => setTemplateVersionId(e.target.value)} className="erp-form-select" required>
                <option value="">Seleccionar…</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Documento dueño *</label>
              <select value={ownerType} onChange={(e) => setOwnerType(e.target.value as DocumentOwnerType)} className="erp-form-select">
                {OWNER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {OWNER_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="erp-form-group">
              <label className="erp-form-label">ID de la operación *</label>
              <input
                type="text"
                required
                placeholder="Identificador de la venta, pago, orden…"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="erp-form-input"
              />
              <span className="erp-form-hint">Usá el identificador de la operación ya registrada. Este panel no crea ventas, reparaciones ni canjes.</span>
            </div>
          </div>
          <div className="erp-form-group">
            <label className="erp-form-label">Nombre del cliente o razón social *</label>
            <input
              type="text"
              required
              placeholder="Ej: Sofía Gómez"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="erp-form-input"
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="erp-form-group">
              <label className="erp-form-label">Número de documento *</label>
              <input
                type="text"
                required
                placeholder="Ej: 0001-00001234"
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                className="erp-form-input"
              />
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
          </div>
          <div className="erp-form-group">
            <label className="erp-form-label">Motivo de la emisión *</label>
            <input
              type="text"
              required
              placeholder="Motivo formal de la operación"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="erp-form-input"
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px", paddingTop: "12px", borderTop: "1px solid var(--border-line)" }}>
            <button type="button" className="pag-btn" onClick={() => setIsModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Registrando…" : "Registrar documento"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
