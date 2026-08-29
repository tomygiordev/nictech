# Stage 9 MVP verification

## Scope

This document records the local Stage 9 finance/accounting MVP work. It does
not claim that the complete ERP, stages 10–11, fiscal integrations, or remote
Supabase are finished.

## Repository move

- Verified destination: `A:\nictech`
- Source retained: `C:\Users\Gime\Desktop\nictech`
- The recursive manifest matched on 30,329 entries, including Git state and
  junction targets normalized relative to each repository.
- Source deletion was attempted but remains pending because Windows processes
  keep locks open. It was not forced.
- Desktop cleanup removed exactly the authorized 14-item allowlist; no other
  Desktop path was targeted.

## Implemented Stage 9 changes

- Migration `202608190010_erp_finance_accounting.sql` remains the original
  finance foundation.
- Forward correction migration
  `202608190011_erp_finance_accounting_stage9_completion.sql` adds source-event
  posting/idempotency, component payment allocation, dated reversals, close
  prerequisites, exact reconciliation, and immutability/audit triggers.
- The pgTAP plan was expanded from 42 to 50 structural and behavioral checks.
- ERP auth now validates the server-provided ERP context and fails closed when
  the organization identity is missing or invalid.
- Finance RPC identifiers are UUID-validated instead of coerced with
  `String(data)`.
- Accounts now exposes currency and monthly-interest fields.
- Accounting now exposes manual journal, reversal, exact reconciliation, and
  period-close actions with permission gates.
- The frontend API exposes the `post_erp_source_event` RPC with typed Zod input.

## Sequential checks

| Check | Result |
|---|---|
| `npm exec vitest run apps/erp/src/features/finance/FinanceWorkspace.test.tsx` | PASS — 8 tests |
| `npm run test:run` | PASS — 5 files / 41 tests |
| `npm run typecheck:erp` | PASS |
| `npm run build:erp` | PASS — 1686 modules |
| Changed ERP-file ESLint | PASS with one pre-existing Fast Refresh warning in `ErpAuthProvider.tsx` |
| `git diff --check` | PASS; only pre-existing line-ending warnings |
| `npm run lint` | FAIL — unrelated baseline has 281 errors / 30 warnings across storefront/admin and other existing files |
| `docker info` | PENDING — Docker Linux daemon unavailable |
| `npm run db:test` | PENDING — `ECONNREFUSED 127.0.0.1:54322` while Docker is unavailable |

## Runtime limitation

SQL, RPC, RLS, and pgTAP behavior are not runtime-verified until Docker
Desktop's Linux daemon is available. The MVP must not be labeled fully
functional until `npm run db:test` passes.

## Deferred

Stages 10–11, fiscal/ARCA correctness, advanced bank reconciliation, remote
integrations, complex refinancing/scoring, and storefront work remain outside
this MVP.
