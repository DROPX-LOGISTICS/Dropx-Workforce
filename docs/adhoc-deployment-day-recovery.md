# Adhoc DA / WM deployment-day recovery

## Behaviour

- DA names come from the latest Amazon roster or exact manual SCC text. Workforce mapping is not a requirement to request, approve, submit details or process an Adhoc payment.
- Recovery starts only after Finance records `processed` or `paid`. It uses the expense's saved **Deployment Date**, never the roster date or payment-submission date.
- For count schemes, recover Amazon Delivery × the applicable delivery rate plus C-return × the applicable return rate. SWA, seller pickup/return, fuel and incentives are not silently removed.
- For a daily MG scheme, recover one associate/day entitlement. Repeated shipment rows, Provider IDs or Adhoc requests must not multiply the day's MG.
- This replaces the earlier cash-amount recovery. Existing linked adjustments are untouched. No historical payouts or raw shipment rows are rewritten by the release.
- Monthly and mixed schemes, missing dates, ambiguous identities, missing source data and unverified rates remain pending review. Never guess a person or derive a daily rate from an unspecified monthly scheme.

## Reconciliation and audit

The dedicated Workforce cron runs every five minutes. It takes a company-scoped snapshot of the day source and effective mapping/rates, uses the Workforce earnings calculator, and commits a service-only receipt and approved deduction atomically. A source hash is rechecked under locks before posting. Repeated workers/runs reuse the same day recovery key. Previously zero day calculations are retried for later imports.

Unmapped deductions appear in **Workforce → Adjustments & loss visibility**. Creating an appropriate effective-dated mapping allows the worker to retry automatically. Mapping someone only from today does not prove they owned an ID on a historical deployment day.

Unresolved processed Adhoc recovery prevents relevant payroll finalization, **not Adhoc payment processing**. Existing payroll direct-allocation/adjustment completeness controls remain installed. When the applicable payroll is already approved or paid, the deduction moves to the next open date; original deployment date and source/rate evidence remain in the receipt. Already-linked corrections require reviewed payroll corrections rather than rewriting a posted deduction.

## Verification and release

`pnpm run test:adhoc-recovery` exercises the pure calculator and an isolated PostgreSQL-compatible database: count rates, MG/day, missing/ambiguous mapping, late mapping, no report, actual versus roster date, stale snapshots, duplicate requests, immutable paid data, carry-forward, payroll gate and API permissions. No real payment is created or approved by these tests.

Release through committed Workforce GitHub source, its dedicated Vercel project and the repository Supabase production workflow. Never apply this migration through a chat SQL editor. Verify the cron's unauthorized response, committed deployment, migration history, function ACLs and read-only live coverage after release.

### 2026-09-28 verification

- TypeScript, full prebuild regression suite and production build passed locally. The production build needed `NODE_OPTIONS=--max-old-space-size=6144` after the default 2 GB worker exhausted memory.
- Nine recovery calculator tests and the isolated SQL integration suite passed, including duplicate day links (the previous one-adjustment-per-request unique constraint is replaced by a lookup index).
- Read-only production audit found three tracked requests, all still approved/processing, none already recovered. Each has a saved Deployment Date.
- Production release is blocked: existing GitHub migration run `36448336150` fails with Supabase Management API HTTP 401. The `SUPABASE_ACCESS_TOKEN` environment secret must be renewed in `supabase-production`. No production schema or financial records were changed in this implementation session.
