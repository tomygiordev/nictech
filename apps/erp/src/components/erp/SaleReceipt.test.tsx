import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import SaleReceipt from "./SaleReceipt";
import type { DocumentSaleReceipt } from "../../types/DocumentSaleReceipt";

const receipt: DocumentSaleReceipt = {
  sale_id: "10000000-0000-4000-8000-000000000001",
  document_id: "10000000-0000-4000-8000-000000000002",
  document_number: "NF-00000007",
  branch_name: "Sucursal centro",
  invoice_kind: "non_fiscal",
  customer_display_name: "Cliente de prueba",
  customer_legal_name: "Cliente de prueba",
  currency_code: "ARS",
  exchange_rate: 1,
  subtotal_amount: 200,
  discount_amount: 0,
  tax_amount: 42,
  total_amount: 242,
  total_ars: 242,
  confirmed_at: "2026-09-22T12:00:00Z",
  document_status: "issued",
  sale_state: "confirmed",
  payment_state: "paid",
  payments: [{
    method_name: "Tarjeta",
    amount: 242,
    currency_code: "ARS",
    occurred_at: "2026-09-22T12:00:00Z",
    reversed: false,
  }],
  lines: [{
    description: "Teclado mecánico",
    quantity: 2,
    unit_price: 100,
    discount_amount: 0,
    tax_rate_percent: 21,
    tax_amount: 21,
    line_total: 121,
  }],
};

describe("SaleReceipt", () => {
  it("renders a printable local receipt with real line items and totals", () => {
    render(<SaleReceipt receipt={receipt} />);

    expect(screen.getByLabelText("Comprobante local de venta")).toHaveAttribute("id", "printable-labels-area");
    expect(screen.getByText("Comprobante no fiscal")).toBeInTheDocument();
    expect(screen.getByText("Teclado mecánico")).toBeInTheDocument();
    expect(screen.getAllByText("Cliente de prueba")).toHaveLength(1);
    expect(screen.queryByText("Razón social:")).not.toBeInTheDocument();
    const receiptArea = screen.getByLabelText("Comprobante local de venta");
    expect(receiptArea).toHaveTextContent("Sucursal centro");
    expect(screen.getByText(/Total:/)).toHaveTextContent("242");
    expect(receiptArea).toHaveTextContent("Estado comercial: Confirmada");
    expect(receiptArea).toHaveTextContent("Estado de pago: Pagado");
    expect(screen.getByText("Pagos y reversos registrados en ERP")).toBeInTheDocument();
    expect(screen.getByText(/Tarjeta/)).toHaveTextContent("Pago original");
    expect(receiptArea).toHaveTextContent("Comprobante de uso interno; no sustituye una factura fiscal.");
  });

  it("shows the legal name only when it differs from the customer's visible name", () => {
    render(<SaleReceipt receipt={{ ...receipt, customer_legal_name: "Prueba S.A." }} />);

    expect(screen.getByText("Cliente de prueba")).toBeInTheDocument();
    expect(screen.getByText("Prueba S.A.")).toBeInTheDocument();
    expect(screen.getByText("Razón social:")).toBeInTheDocument();
  });

  it("translates cancelled and refunded states and clarifies that the reversal is recorded in ERP", () => {
    render(
      <SaleReceipt
        receipt={{
          ...receipt,
          sale_state: "cancelled",
          payment_state: "refunded",
          payments: [{ ...receipt.payments[0], reversed: true }],
        }}
      />,
    );

    const receiptArea = screen.getByLabelText("Comprobante local de venta");
    expect(receiptArea).toHaveTextContent("Estado comercial: Cancelada");
    expect(receiptArea).toHaveTextContent("Estado de pago: Revertido en ERP");
    expect(screen.getByText(/Reverso registrado en ERP/)).toBeInTheDocument();
    expect(screen.queryByText(/Reembolso externo realizado/i)).not.toBeInTheDocument();
  });

  it.each([
    ["unpaid", "Sin pagar"],
    ["partial", "Pago parcial"],
    ["paid", "Pagado"],
    ["refunded", "Revertido en ERP"],
  ])("translates payment status %s", (paymentState, label) => {
    render(<SaleReceipt receipt={{ ...receipt, payment_state: paymentState }} />);

    expect(screen.getByLabelText("Comprobante local de venta")).toHaveTextContent(`Estado de pago: ${label}`);
  });
});
