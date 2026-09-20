# Workforce joining foundation — September 2026

## Implemented in this release

- Separate Joining & Training desk with stage/station/source/search/follow-up filters, sorting, pagination, reviewer history and biometric evidence.
- Active-only operational register by default; applicants remain accessible in Joining and the protected registration flow.
- Approve-for-joining: all required registration checks except provider-ID creation. Enables biometric enrolment independently of delivery activation.
- Explicit accepted training terms (daily rate, dates, eligible duration); direct joining without training pay.
- Station-based Training Policy master and DropX-ID associate selector. No default amounts or durations. Policies are immutable; retirement prevents new selection without altering existing accepted terms.
- First qualifying biometric arrival derives training state. Two complete distinct training days identify an invitation task; no external invitation is sent automatically.
- Provider tracking with invitation name preparation, associate-controlled email, Amazon profile identifier, task ownership, verified progress, follow-up owner and due date.
- Station master for Amazon service area, Amazon Logistics service type, supervisor badge login and contract type. Independent Contractor is the user-approved default, not a rewrite of existing arrangements.
- Single-name invitation suggestions repeat first/last only; legal name is unchanged, suffix blank. Operator must verify Amazon accepts this convention.
- Mapping effective date terminates training. Historic mappings are retained in cutoff calculations, including previous stations. Mapping a currently effective provider ID activates an approved joining profile only after provider activation is recorded.
- Training earning lines flow into existing Workforce payroll snapshots. Missing checkout, insufficient duration, duplicate/flagged/manual/wrong-station attendance and incomplete bank details are held. Early leavers retain earned training pay through their last eligible day.
- Training completed but ID pending is an explicit pay-review hold, not endless cheap training.
- Submitted payroll prevents retrospective joining-term/mapping edits. Review/approval checks reject stale joining versions and changed/flagged training attendance.
- Tables have RLS and no anonymous/authenticated Data API grants; writes are authorized server actions + security-invoker atomic RPCs. Immutable event records identify the reviewer and change.

## External portal observations, not an integration claim

Inspected the authenticated Amazon India invitation form, associate onboarding profile and Onboarding DAs console on 21 September 2026. Invitation asks for first name, last name, optional suffix, email and DA contract type. Associate Settings exposes service area, service type and supervisor badge login without @amazon.com. Profile separates DSP, associate and Amazon tasks. Onboarding console exposes progress, status, exact blocker and profile links.

No invitation, profile edit, account creation, background-check order, message or payment was performed during inspection. No credentials or profile document data were copied into source code. Actual personal agreements, consent and course completion must remain with the associate.

## Remaining product work — not delivered by this commit

- Approved Amazon API/browser-service integration and reliable status ingestion; this release records manually verified observations and links to the portal. No unattended CAPTCHA/email-account creation.
- Associate-facing joining progress and live training earnings in the separately deployed DropX One product; existing registration compatibility remains unchanged.
- Automated WhatsApp/email follow-up queue, consent/templates, delivery receipts, deduplication and escalation.
- Referral attribution and retention-based refer-and-earn ledger across One, Recruit and Workforce.
- Pooled 7/14/30-day MG thresholds, guaranteed-vs-piece-rate options, approved waiting-day arrangement, salary plus verified kilometres.
- Policy-scoped daily/weekly/fortnightly/semimonthly/custom pay calendars. Existing payroll accepts explicit nonoverlapping date ranges; that is not a fully automated calendar.
- Provider-authorized temporary/cover-ID attribution and daily pay reconciliation; do not treat shared credentials as permission.
- Ops loss approval and hold-release integration; do not silently deduct unreviewed losses or payable off-days.
- Automated banking/payout-provider integration and reconciliation; existing payment-reference recording is not a bank transfer.
- Final settlement must consume the same unpaid earnings ledger to prevent double payout. Existing manual settlement alone is not that integration.
- Automated future-dated activation and post-training waiting-pay policies. A future mapping never activates early.

## Verification

Run `pnpm exec tsc --noEmit`, `pnpm run prebuild`, `pnpm run build` before Git release. Tests cover pure date/attendance/name rules, existing earnings regression, PostgreSQL migration compilation, training snapshots, optimistic concurrency, scope, stale data and protected payroll, station master audit and privileges. PGlite is isolated; no production business data is used or changed by tests.

After push: verify GitHub quality/migration actions, the dedicated Workforce Vercel deployment SHA, schema migration history, authenticated production views/filter navigation and error-free rendering. Do not describe untested live side-effect integrations as complete.
