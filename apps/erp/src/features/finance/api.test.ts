import { describe, expect, it } from "vitest";
import { buildPostJournalEntryRpcArgs } from "./api";
import type { JournalEntryInput } from "./schemas";

describe("post_journal_entry payload", () => {
  it("sends explicit null source fields for a manual entry", () => {
    const input: JournalEntryInput = {
      branchId: "10000000-0000-4000-8000-000000000001",
      entryDate: "2026-09-18",
      operationKey: "manual-journal-1",
      reason: "Asiento de prueba balanceado",
      lines: [
        { account_id: "10000000-0000-4000-8000-000000000002", description: "Debe", debit: "100", credit: "0", currency_code: "ARS", exchange_rate: "1" },
        { account_id: "10000000-0000-4000-8000-000000000003", description: "Haber", debit: "0", credit: "100", currency_code: "ARS", exchange_rate: "1" },
      ],
    };

    expect(buildPostJournalEntryRpcArgs(input)).toMatchObject({
      target_branch_id: input.branchId,
      target_entry_date: input.entryDate,
      target_source_type: null,
      target_source_id: null,
      operation_key: input.operationKey,
      operation_reason: input.reason,
      lines: input.lines,
    });
  });
});
