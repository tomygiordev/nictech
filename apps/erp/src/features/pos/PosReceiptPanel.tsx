import React from "react";
import { CheckCircle2, Printer, RefreshCw, Loader2 } from "lucide-react";
import SaleReceipt from "../../components/erp/SaleReceipt";
import { formatCurrency } from "../../lib/formatters";
import type { ConfirmedTicketState } from "./posReceiptFlow";

export interface PosReceiptPanelProps {
  ticket: ConfirmedTicketState;
  onClose: () => void;
  onRecover: (documentId: string) => Promise<void> | void;
}

export const PosReceiptPanel: React.FC<PosReceiptPanelProps> = ({
  ticket,
  onClose,
  onRecover,
}) => {
  const { info, receipt, recoveryLoading, recoveryError } = ticket;

  const paymentMethodsSummary = receipt?.payments && receipt.payments.length > 0
    ? receipt.payments.map((p) => p.method_name).join(", ")
    : "Registrado";

  return (
    <>
      <div
        className="flow-card"
        style={{
          border: "2px solid var(--emerald-success)",
          background: "var(--emerald-soft)",
          marginBottom: "20px",
        }}
        data-testid="pos-receipt-panel"
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                background: "var(--emerald-success)",
                color: "#ffffff",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <CheckCircle2 size={24} />
            </div>

            <div>
              <strong style={{ fontSize: "16px", color: "var(--emerald-success)" }}>
                ¡Venta Confirmada! #{receipt ? receipt.document_number : info.documentNumber}
              </strong>

              {receipt ? (
                <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
                  <span data-testid="receipt-customer">
                    {receipt.customer_display_name || receipt.customer_legal_name || "Consumidor Final"}
                  </span>
                  {" • "}
                  <span data-testid="receipt-payment">{paymentMethodsSummary}</span>
                  {" • "}
                  <span data-testid="receipt-amount">
                    {formatCurrency(receipt.total_amount, receipt.currency_code)}
                  </span>
                </p>
              ) : (
                <p
                  style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-muted)" }}
                  data-testid="pending-receipt-message"
                >
                  {recoveryError || "Comprobante registrado en el ERP. Lectura de comprobante para impresión pendiente."}
                </p>
              )}

              <span
                style={{ fontSize: "10px", color: "var(--text-light)", fontFamily: "monospace" }}
                data-testid="confirmed-sale-id"
              >
                ID Venta ERP: {info.saleId}
              </span>
              <span
                style={{ display: "block", fontSize: "10px", color: "var(--text-light)", fontFamily: "monospace" }}
                data-testid="confirmed-document-id"
              >
                {info.invoiceKind === "fiscal" ? "Comprobante fiscal" : "Comprobante no fiscal"}: {info.documentNumber} • Documento ERP: {info.documentId}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {receipt ? (
              <button
                type="button"
                className="pag-btn"
                onClick={() => window.print()}
                style={{
                  background: "#ffffff",
                  color: "var(--emerald-success)",
                  borderColor: "var(--emerald-border)",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                data-testid="print-receipt-btn"
              >
                <Printer size={14} /> Imprimir comprobante
              </button>
            ) : (
              <button
                type="button"
                className="pag-btn"
                onClick={() => onRecover(info.documentId)}
                disabled={recoveryLoading}
                style={{
                  background: "#ffffff",
                  color: "var(--brand-primary)",
                  borderColor: "var(--brand-border)",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                data-testid="recover-receipt-btn"
              >
                {recoveryLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Recuperando...
                  </>
                ) : (
                  <>
                    <RefreshCw size={14} /> Recuperar comprobante
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              className="pag-btn"
              onClick={onClose}
              style={{ background: "#ffffff" }}
              data-testid="close-receipt-panel-btn"
            >
              ✕ Cerrar
            </button>
          </div>
        </div>
      </div>

      {receipt && <SaleReceipt receipt={receipt} />}
    </>
  );
};
