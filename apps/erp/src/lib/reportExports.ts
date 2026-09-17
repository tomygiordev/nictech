import { z } from "zod";
import { supabase } from "./supabase";

export const reportCodeSchema = z.enum([
  "audit",
  "iva_ventas",
  "iva_compras",
  "trial_balance",
  "profitability",
]);

export type ReportCode = z.infer<typeof reportCodeSchema>;

export const reportExportReasonSchema = z.string().trim().min(3).max(500);

const reportExportResponseSchema = z
  .object({
    report_code: reportCodeSchema,
    rows: z.array(z.record(z.string(), z.unknown())),
    row_count: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.row_count !== value.rows.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El total informado no coincide con las filas exportadas.",
        path: ["row_count"],
      });
    }
  });

export type ReportExportResponse = z.infer<typeof reportExportResponseSchema>;

export interface ReportExportRequest {
  reportCode: ReportCode;
  reason: string;
  filters?: Record<string, string>;
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  rowLimit?: number;
}

type ExportReportRpcArgs = {
  report_code: ReportCode;
  operation_reason: string;
  filters: Record<string, string>;
  date_from: string | null;
  date_to: string | null;
  target_branch_id: string | null;
  row_limit: number;
};

type ExportReportRpcResult = {
  data: unknown;
  error: { message: string } | null;
};

type ExportReportRpcClient = {
  rpc: (
    functionName: "export_report_rows",
    args: ExportReportRpcArgs,
  ) => PromiseLike<ExportReportRpcResult>;
};

export const requestReportExport = async (
  request: ReportExportRequest,
): Promise<ReportExportResponse> => {
  const reason = reportExportReasonSchema.parse(request.reason);
  if (!supabase) throw new Error("El ERP no está configurado para conectarse a Supabase.");

  // The generated Database type is refreshed after applying migrations. Keep
  // this narrow adapter typed while the migration and frontend land together.
  const rpcClient = supabase as unknown as ExportReportRpcClient;
  const { data, error } = await rpcClient.rpc("export_report_rows", {
    report_code: request.reportCode,
    operation_reason: reason,
    filters: request.filters ?? {},
    date_from: request.dateFrom || null,
    date_to: request.dateTo || null,
    target_branch_id: request.branchId || null,
    row_limit: request.rowLimit ?? 5000,
  });

  if (error) throw new Error(error.message);
  const parsed = reportExportResponseSchema.parse(data);
  if (parsed.report_code !== request.reportCode) {
    throw new Error("Supabase devolvió un reporte distinto del solicitado.");
  }
  return parsed;
};

export const parseReportExportResponse = (value: unknown): ReportExportResponse =>
  reportExportResponseSchema.parse(value);
