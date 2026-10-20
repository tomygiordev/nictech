import { supabase } from "../../lib/supabase";
import type { Database, Json } from "../../types/supabase";
import type {
  DocumentSaleReceipt,
  DocumentSaleReceiptLine,
  DocumentSaleReceiptPayment,
} from "../../types/DocumentSaleReceipt";

const client = () => {
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");
  return supabase;
};

const newOpKey = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_RE = /^[0-9a-f]{64}$/;

const parseRpcId = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new Error(`Respuesta inválida para ${label}`);
  }
  return value;
};

export type DocumentOwnerType = "sale" | "payment" | "repair" | "warranty" | "pc_build" | "trade_in";
export type DocumentStatus = Database["erp"]["Enums"]["document_status"];
export type FiscalRequestStatus = Database["erp"]["Enums"]["fiscal_status"];
type JsonObject = { [key: string]: Json | undefined };

const DOCUMENT_OWNER_TYPES: ReadonlySet<string> = new Set<DocumentOwnerType>([
  "sale",
  "payment",
  "repair",
  "warranty",
  "pc_build",
  "trade_in",
]);

const parseDocumentOwnerType = (value: string): DocumentOwnerType => {
  if (!DOCUMENT_OWNER_TYPES.has(value)) throw new Error("El documento tiene un tipo de dueño inválido.");
  return value as DocumentOwnerType;
};

const parseInvoiceKind = (value: string | null): "fiscal" | "non_fiscal" | null => {
  if (value === null || value === "fiscal" || value === "non_fiscal") return value;
  throw new Error("El documento tiene un tipo de factura inválido.");
};

const parseJsonObject = (value: Json, label: string): JsonObject => {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Respuesta inválida para ${label}: se esperaba un objeto JSON.`);
  }
  return value;
};

const snapshotTotal = (snapshot: JsonObject): number | null => {
  const value = snapshot["total_ars"];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const parseRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Respuesta inválida para " + label + ".");
  }
  return value as Record<string, unknown>;
};

const parseReceiptText = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error("Respuesta inválida para " + label + ".");
  return value;
};

const parseReceiptNumber = (value: unknown, label: string): number => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new Error("Respuesta inválida para " + label + ".");
  return parsed;
};

export const parseDocumentSaleReceipt = (value: unknown): DocumentSaleReceipt => {
  const row = parseRecord(value, "el comprobante de venta");
  const invoiceKind = row["invoice_kind"];
  const documentStatus = row["document_status"];
  if (invoiceKind !== "fiscal" && invoiceKind !== "non_fiscal") {
    throw new Error("El comprobante tiene una clasificación local inválida.");
  }
  if (documentStatus !== "issued" && documentStatus !== "voided") {
    throw new Error("El comprobante no tiene un estado documental válido.");
  }
  if (!Array.isArray(row["lines"])) throw new Error("El comprobante no contiene líneas válidas.");
  const lines = row["lines"].map((line, index): DocumentSaleReceiptLine => {
    const values = parseRecord(line, "la línea " + (index + 1));
    return {
      description: parseReceiptText(values["description"], "la descripción de línea " + (index + 1)),
      quantity: parseReceiptNumber(values["quantity"], "la cantidad de línea " + (index + 1)),
      unit_price: parseReceiptNumber(values["unit_price"], "el precio de línea " + (index + 1)),
      discount_amount: parseReceiptNumber(values["discount_amount"], "el descuento de línea " + (index + 1)),
      tax_rate_percent: parseReceiptNumber(values["tax_rate_percent"], "el impuesto de línea " + (index + 1)),
      tax_amount: parseReceiptNumber(values["tax_amount"], "el importe de impuesto de línea " + (index + 1)),
      line_total: parseReceiptNumber(values["line_total"], "el total de línea " + (index + 1)),
    };
  });
  if (!Array.isArray(row["payments"])) throw new Error("El comprobante no contiene un historial de pagos válido.");
  const payments = row["payments"].map((payment, index): DocumentSaleReceiptPayment => {
    const values = parseRecord(payment, "el pago " + (index + 1));
    if (typeof values["reversed"] !== "boolean") throw new Error("El estado del pago " + (index + 1) + " no es válido.");
    return {
      method_name: parseReceiptText(values["method_name"], "el medio de pago " + (index + 1)),
      amount: parseReceiptNumber(values["amount"], "el importe del pago " + (index + 1)),
      currency_code: parseReceiptText(values["currency_code"], "la moneda del pago " + (index + 1)),
      occurred_at: parseReceiptText(values["occurred_at"], "la fecha del pago " + (index + 1)),
      reversed: values["reversed"],
    };
  });
  const nullableState = (state: unknown): string | null => {
    if (state === null) return null;
    if (typeof state !== "string") throw new Error("El estado comercial no es válido.");
    return state;
  };
  return {
    sale_id: parseReceiptText(row["sale_id"], "el ID de venta"),
    document_id: parseReceiptText(row["document_id"], "el ID de documento"),
    document_number: parseReceiptText(row["document_number"], "el número de documento"),
    invoice_kind: invoiceKind,
    branch_name: parseReceiptText(row["branch_name"], "la sucursal"),
    customer_display_name: parseReceiptText(row["customer_display_name"], "el nombre del cliente"),
    customer_legal_name: parseReceiptText(row["customer_legal_name"], "la razón social"),
    currency_code: parseReceiptText(row["currency_code"], "la moneda"),
    exchange_rate: parseReceiptNumber(row["exchange_rate"], "la cotización"),
    subtotal_amount: parseReceiptNumber(row["subtotal_amount"], "el subtotal"),
    discount_amount: parseReceiptNumber(row["discount_amount"], "el descuento total"),
    tax_amount: parseReceiptNumber(row["tax_amount"], "el impuesto total"),
    total_amount: parseReceiptNumber(row["total_amount"], "el total"),
    total_ars: parseReceiptNumber(row["total_ars"], "el total convertido a ARS"),
    confirmed_at: parseReceiptText(row["confirmed_at"], "la fecha de confirmación"),
    document_status: documentStatus,
    sale_state: nullableState(row["sale_state"]),
    payment_state: nullableState(row["payment_state"]),
    lines,
    payments,
  };
};

// PostgreSQL permite NULL en este parámetro aunque el generador sólo expone
// su tipo base. El helper mantiene el NULL real acotado a la frontera RPC.
const nullableRpcString = (value: string | null): string => value as string;

export interface DocumentRecord {
  id: string;
  organization_id: string;
  branch_id: string;
  template_version_id: string;
  owner_type: DocumentOwnerType;
  owner_id: string;
  document_number: string;
  invoice_kind: "fiscal" | "non_fiscal" | null;
  customer_snapshot: JsonObject;
  content_sha256: string;
  status: DocumentStatus;
  issued_at: string;
  issued_by: string | null;
  amount_ars: number | null;
  sale_receipt: DocumentSaleReceipt | null;
}

export interface DocumentEventRecord {
  id: string;
  organization_id: string;
  branch_id: string;
  document_id: string;
  status: DocumentStatus;
  reason: string;
  occurred_at: string;
  actor_id: string | null;
}

export interface DocumentTemplate {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  document_kind: string;
  is_active: boolean;
  created_at: string;
}

export interface DocumentTemplateVersion {
  id: string;
  organization_id: string;
  template_id: string;
  version: number;
  definition: Json;
  created_at: string;
}

export interface FiscalPoint {
  id: string;
  organization_id: string;
  branch_id: string;
  code: number;
  name: string;
  environment: string;
  is_active: boolean;
}

export interface FiscalRequest {
  id: string;
  organization_id: string;
  branch_id: string;
  document_id: string;
  fiscal_point_id: string;
  voucher_type: string;
  voucher_number: number;
  requested_at: string;
  requested_by: string | null;
}

export interface FiscalEvent {
  id: string;
  event_sequence: number;
  organization_id: string;
  branch_id: string;
  fiscal_request_id: string;
  provider: string;
  status: FiscalRequestStatus;
  cae: string | null;
  cae_expires_on: string | null;
  error_code: string | null;
  occurred_at: string;
}

export interface IssueDocumentInput {
  branchId: string;
  templateVersionId: string;
  ownerType: DocumentOwnerType;
  ownerId: string;
  documentNumber: string;
  customerSnapshot: JsonObject;
  contentSha256: string;
  reason: string;
}

export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const bytes = Array.from(new Uint8Array(digest));
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!HEX64_RE.test(hex)) throw new Error("No se pudo calcular el digest del documento.");
  return hex;
};

export const listDocumentTemplates = async (): Promise<DocumentTemplate[]> => {
  const { data, error } = await client()
    .from("document_templates")
    .select("*")
    .eq("is_active", true)
    .order("code");
  if (error) throw error;
  return data ?? [];
};

export const listDocumentTemplateVersions = async (templateId: string): Promise<DocumentTemplateVersion[]> => {
  if (!UUID_RE.test(templateId)) return [];
  const { data, error } = await client()
    .from("document_template_versions")
    .select("*")
    .eq("template_id", templateId)
    .order("version", { ascending: false });
  if (error) throw error;
  return data ?? [];
};

export const listDocuments = async (): Promise<DocumentRecord[]> => {
  const { data, error } = await client()
    .from("documents")
    .select(
      "id,organization_id,branch_id,template_version_id,owner_type,owner_id,document_number,invoice_kind,customer_snapshot,content_sha256,status,issued_at,issued_by",
    )
    .order("issued_at", { ascending: false });
  if (error) throw error;
  const documents = (data ?? []).map((row) => {
    const customerSnapshot = parseJsonObject(row.customer_snapshot, "la instantánea del cliente");
    return {
      ...row,
      owner_type: parseDocumentOwnerType(row.owner_type),
      invoice_kind: parseInvoiceKind(row.invoice_kind),
      customer_snapshot: customerSnapshot,
      amount_ars: snapshotTotal(customerSnapshot),
      sale_receipt: null,
    };
  });

  if (documents.length === 0) return documents;

  const { data: eventRows, error: eventError } = await client()
    .from("document_events")
    .select("document_id,status,event_sequence")
    .in("document_id", documents.map((document) => document.id))
    .order("event_sequence", { ascending: true });
  if (eventError) throw eventError;
  const latestStatusByDocumentId = new Map<string, DocumentStatus>();
  for (const event of eventRows ?? []) latestStatusByDocumentId.set(event.document_id, event.status);
  const statusDocuments = documents.map((document) => ({
    ...document,
    status: latestStatusByDocumentId.get(document.id) ?? document.status,
  }));

  const saleDocumentIds = statusDocuments.filter((document) => document.owner_type === "sale").map((document) => document.id);
  if (saleDocumentIds.length === 0) return statusDocuments;

  const [{ data: saleAmounts, error: saleAmountsError }, receipts] = await Promise.all([
    client().rpc("list_document_sale_amounts", { target_document_ids: saleDocumentIds }),
    getDocumentSaleReceipts(saleDocumentIds),
  ]);
  if (saleAmountsError) throw saleAmountsError;

  const amountByDocumentId = new Map<string, number>();
  for (const saleAmount of saleAmounts ?? []) {
    const amountArs = Number(saleAmount.amount_ars);
    if (Number.isFinite(amountArs)) amountByDocumentId.set(saleAmount.document_id, amountArs);
  }

  return statusDocuments.map((document) => ({
    ...document,
    amount_ars: document.owner_type === "sale" ? amountByDocumentId.get(document.id) ?? document.amount_ars : document.amount_ars,
    sale_receipt: receipts.get(document.id) ?? null,
  }));
};

type SaleReceiptRpc = (
  functionName: "get_document_sale_receipts",
  args: { target_document_ids: string[] },
) => Promise<{ data: unknown; error: { message: string } | null }>;

const getDocumentSaleReceipts = async (documentIds: string[]): Promise<Map<string, DocumentSaleReceipt>> => {
  if (documentIds.length === 0) return new Map();
  const supabaseClient = client();
  const rpc = supabaseClient.rpc.bind(supabaseClient) as unknown as SaleReceiptRpc;
  const { data, error } = await rpc("get_document_sale_receipts", { target_document_ids: documentIds });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error("Respuesta inválida al recuperar los comprobantes de venta.");
  const receipts = new Map<string, DocumentSaleReceipt>();
  for (const item of data) {
    const row = parseRecord(item, "el resultado de comprobantes");
    const documentId = parseReceiptText(row["document_id"], "el ID de documento");
    receipts.set(documentId, parseDocumentSaleReceipt(row["receipt"]));
  }
  return receipts;
};

export const getDocumentSaleReceipt = async (documentId: string): Promise<DocumentSaleReceipt | null> => {
  if (!UUID_RE.test(documentId)) throw new Error("El documento de venta no es válido.");
  const receipts = await getDocumentSaleReceipts([documentId]);
  return receipts.get(documentId) ?? null;
};

export const listDocumentEvents = async (documentId: string): Promise<DocumentEventRecord[]> => {
  if (!UUID_RE.test(documentId)) return [];
  const { data, error } = await client()
    .from("document_events")
    .select("*")
    .eq("document_id", documentId)
    .order("occurred_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
};

export const listFiscalPoints = async (): Promise<FiscalPoint[]> => {
  const { data, error } = await client()
    .from("fiscal_points")
    .select("*")
    .eq("is_active", true)
    .order("code");
  if (error) throw error;
  return data ?? [];
};

export const listFiscalRequests = async (): Promise<FiscalRequest[]> => {
  const { data, error } = await client()
    .from("fiscal_requests")
    .select(
      "id,organization_id,branch_id,document_id,fiscal_point_id,voucher_type,voucher_number,requested_at,requested_by",
    )
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
};

export const listFiscalEventsByRequest = async (fiscalRequestId: string): Promise<FiscalEvent[]> => {
  if (!UUID_RE.test(fiscalRequestId)) return [];
  const { data, error } = await client()
    .from("fiscal_events")
    .select(
      "id,event_sequence,organization_id,branch_id,fiscal_request_id,provider,status,cae,cae_expires_on,error_code,occurred_at",
    )
    .eq("fiscal_request_id", fiscalRequestId)
    .order("event_sequence", { ascending: true });
  if (error) throw error;
  return data ?? [];
};

export const issueDocument = async (input: IssueDocumentInput): Promise<string> => {
  if (!UUID_RE.test(input.branchId)) throw new Error("La sucursal es obligatoria y debe ser un UUID válido.");
  if (!UUID_RE.test(input.templateVersionId)) throw new Error("La versión de plantilla es obligatoria.");
  if (!UUID_RE.test(input.ownerId)) throw new Error("El documento dueño es obligatorio y debe ser un UUID válido.");
  if (input.documentNumber.trim() === "") throw new Error("El número de documento es obligatorio.");
  if (!HEX64_RE.test(input.contentSha256)) throw new Error("El digest del contenido es inválido.");
  if (input.reason.trim() === "") throw new Error("El motivo de la operación es obligatorio.");
  const { data, error } = await client().rpc("issue_document", {
    target_branch_id: input.branchId,
    target_template_version_id: input.templateVersionId,
    owner_type: input.ownerType,
    owner_id: input.ownerId,
    document_number: input.documentNumber.trim(),
    customer_snapshot: input.customerSnapshot,
    content_sha256: input.contentSha256,
    private_object_path: nullableRpcString(null),
    operation_key: newOpKey("doc-issue"),
    operation_reason: input.reason.trim(),
  });
  if (error) throw error;
  return parseRpcId(data, "documento");
};

export const voidDocument = async (documentId: string, reason: string): Promise<string> => {
  if (!UUID_RE.test(documentId)) throw new Error("El documento es obligatorio.");
  if (reason.trim() === "") throw new Error("El motivo de anulación es obligatorio.");
  const { data, error } = await client().rpc("void_document", {
    target_document_id: documentId,
    operation_key: newOpKey("doc-void"),
    operation_reason: reason.trim(),
  });
  if (error) throw error;
  return parseRpcId(data, "anulación");
};

export const cancelSale = async (saleId: string, reason: string): Promise<string> => {
  if (!UUID_RE.test(saleId)) throw new Error("La venta es obligatoria y debe ser un UUID válido.");
  if (reason.trim() === "") throw new Error("El motivo de cancelación es obligatorio.");
  const { data, error } = await client().rpc("cancel_sale", {
    target_sale_id: saleId,
    operation_key: newOpKey("sale-cancel"),
    operation_reason: reason.trim(),
  });
  if (error) throw error;
  return parseRpcId(data, "cancelación de venta");
};

export const requestFiscalIssuance = async (
  documentId: string,
  fiscalPointId: string,
  voucherType: string,
  reason: string,
): Promise<string> => {
  if (!UUID_RE.test(documentId)) throw new Error("El documento es obligatorio.");
  if (!UUID_RE.test(fiscalPointId)) throw new Error("El punto de venta fiscal es obligatorio.");
  if (!/^[A-Z0-9_]{1,40}$/.test(voucherType.trim())) {
    throw new Error("El tipo de comprobante debe usar mayúsculas, números o guion bajo.");
  }
  if (reason.trim() === "") throw new Error("El motivo de la operación es obligatorio.");
  const { data, error } = await client().rpc("request_fiscal_issuance", {
    target_document_id: documentId,
    target_fiscal_point_id: fiscalPointId,
    voucher_type: voucherType.trim(),
    operation_key: newOpKey("fiscal-req"),
    operation_reason: reason.trim(),
  });
  if (error) throw error;
  return parseRpcId(data, "solicitud fiscal");
};

export const createDocumentTemplateVersion = async (
  templateId: string,
  definition: JsonObject,
  reason: string,
): Promise<string> => {
  if (!UUID_RE.test(templateId)) throw new Error("La plantilla es obligatoria.");
  if (reason.trim() === "") throw new Error("El motivo de la operación es obligatorio.");
  const { data, error } = await client().rpc("create_document_template_version", {
    target_template_id: templateId,
    definition,
    operation_key: newOpKey("doc-tpl"),
    operation_reason: reason.trim(),
  });
  if (error) throw error;
  return parseRpcId(data, "versión de plantilla");
};
