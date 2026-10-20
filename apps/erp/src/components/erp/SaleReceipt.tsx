import { formatCurrency, formatDateTime } from "../../lib/formatters";
import type { DocumentSaleReceipt } from "../../types/DocumentSaleReceipt";

interface SaleReceiptProps {
  receipt: DocumentSaleReceipt;
}

const labelForInvoiceKind = (kind: DocumentSaleReceipt["invoice_kind"]): string =>
  kind === "fiscal" ? "Comprobante fiscal" : "Comprobante no fiscal";

const normalizeCustomerName = (name: string): string =>
  name.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-AR");

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

const saleStateLabel = (state: string | null): string =>
  state ? SALE_STATE_LABELS[state] ?? state : "Sin evento comercial";

const paymentStateLabel = (state: string | null): string =>
  state ? PAYMENT_STATE_LABELS[state] ?? state : "Sin evento de pago";

const SaleReceipt = ({ receipt }: SaleReceiptProps) => (
  <section
    id="printable-labels-area"
    aria-label="Comprobante local de venta"
    style={{
      position: "absolute",
      left: "-10000px",
      top: 0,
      width: "100%",
      maxWidth: "760px",
      padding: "24px",
      color: "#111827",
      background: "#ffffff",
      fontFamily: "Arial, sans-serif",
    }}
  >
    <header style={{ borderBottom: "2px solid #111827", paddingBottom: "14px", marginBottom: "16px" }}>
      <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        Prototipo comercial · comprobante de venta
      </p>
      <h1 style={{ margin: "8px 0 4px", fontSize: "24px" }}>{labelForInvoiceKind(receipt.invoice_kind)}</h1>
      <p style={{ margin: 0, fontSize: "12px" }}>
        {receipt.invoice_kind === "fiscal"
          ? "Sin CAE/CAEA ni autorización de ARCA; no válido como comprobante fiscal autorizado."
          : "Comprobante de uso interno; no sustituye una factura fiscal."}
      </p>
    </header>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px", marginBottom: "18px", fontSize: "13px" }}>
      <div><strong>Número:</strong> {receipt.document_number}</div>
      <div><strong>Fecha:</strong> {formatDateTime(new Date(receipt.confirmed_at))}</div>
      <div><strong>Sucursal:</strong> {receipt.branch_name}</div>
      <div><strong>Cliente:</strong> {receipt.customer_display_name}</div>
      {normalizeCustomerName(receipt.customer_display_name) !== normalizeCustomerName(receipt.customer_legal_name) && (
        <div><strong>Razón social:</strong> {receipt.customer_legal_name}</div>
      )}
      <div><strong>Estado documental:</strong> {receipt.document_status === "voided" ? "Anulado" : "Registrado en ERP"}</div>
      <div><strong>Estado comercial:</strong> {saleStateLabel(receipt.sale_state)}</div>
      <div><strong>Estado de pago:</strong> {paymentStateLabel(receipt.payment_state)}</div>
    </div>

    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", borderBottom: "1px solid #9ca3af", padding: "8px 4px" }}>Detalle</th>
          <th style={{ textAlign: "right", borderBottom: "1px solid #9ca3af", padding: "8px 4px" }}>Cantidad</th>
          <th style={{ textAlign: "right", borderBottom: "1px solid #9ca3af", padding: "8px 4px" }}>Precio unitario</th>
          <th style={{ textAlign: "right", borderBottom: "1px solid #9ca3af", padding: "8px 4px" }}>Total</th>
        </tr>
      </thead>
      <tbody>
        {receipt.lines.map((line, index) => (
          <tr key={receipt.sale_id + "-" + index}>
            <td style={{ borderBottom: "1px solid #e5e7eb", padding: "8px 4px" }}>{line.description}</td>
            <td style={{ textAlign: "right", borderBottom: "1px solid #e5e7eb", padding: "8px 4px" }}>{line.quantity}</td>
            <td style={{ textAlign: "right", borderBottom: "1px solid #e5e7eb", padding: "8px 4px" }}>
              {formatCurrency(line.unit_price, receipt.currency_code)}
            </td>
            <td style={{ textAlign: "right", borderBottom: "1px solid #e5e7eb", padding: "8px 4px" }}>
              {formatCurrency(line.line_total, receipt.currency_code)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>

    <div style={{ display: "grid", justifyContent: "end", gap: "5px", marginTop: "16px", fontSize: "13px" }}>
      <div>Subtotal: {formatCurrency(receipt.subtotal_amount, receipt.currency_code)}</div>
      <div>Descuentos: {formatCurrency(receipt.discount_amount, receipt.currency_code)}</div>
      <div>Impuestos: {formatCurrency(receipt.tax_amount, receipt.currency_code)}</div>
      <strong style={{ borderTop: "1px solid #111827", paddingTop: "8px", fontSize: "17px" }}>
        Total: {formatCurrency(receipt.total_amount, receipt.currency_code)}
      </strong>
    </div>
    <section style={{ marginTop: "18px", fontSize: "12px" }}>
      <strong>Pagos y reversos registrados en ERP</strong>
      {receipt.payments.length === 0 ? (
        <p style={{ margin: "6px 0 0" }}>Sin pagos registrados.</p>
      ) : (
        <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
          {receipt.payments.map((payment, index) => (
            <li key={receipt.sale_id + "-payment-" + index}>
              {payment.method_name} · {formatCurrency(payment.amount, payment.currency_code)}
              {payment.reversed ? " · Reverso registrado en ERP" : " · Pago original"}
            </li>
          ))}
        </ul>
      )}
    </section>
    <footer style={{ borderTop: "1px solid #d1d5db", paddingTop: "10px", marginTop: "20px", fontSize: "10px", color: "#4b5563" }}>
      Venta ERP {receipt.sale_id} · Documento ERP {receipt.document_id}
    </footer>
  </section>
);

export default SaleReceipt;
