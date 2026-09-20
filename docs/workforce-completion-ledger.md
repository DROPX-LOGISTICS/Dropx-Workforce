# Workforce lifecycle delivery ledger

## Approved product boundaries

- Preserve historical identity, attendance, payroll and registration compatibility.
- Station-based immutable training terms; effective provider mapping ends training.
- Amazon: dedicated Cloudflare worker prepares/tracks provider observations; authorised operator performs invitation/settings, associate performs acceptance, consent and courses. No free-mail automation/CAPTCHA bypass.
- Confirmed payroll must hand off to Finance Payments for approval and Federal Bank processing. Workforce is not authorised to send bank transfers autonomously.
- No real invitation, background-check charge, pay-policy assignment or payment is a test fixture.

## Evidence-backed delivery state

| Boundary | State |
|---|---|
| Joining/training, station masters, attendance calculation, provider effective date | Prior foundation deployed and read-only production verified |
| Amazon connection UI, encrypted storage, sync lease and observation history | Deployed (088909a); authenticated settings checked; dedicated Cloudflare scheduler deployed, read-only scan requires credentials |
| Amazon full live account scan | Requires owner-entered connection credentials and linked profile; not yet verified |
| DropX One joining/training visibility | Live; existing mapped account verified; statements use individual Finance outcomes; effective identity/date earnings fix 7f16ea42 verified |
| Confirmed payroll → Finance approval/process | Live Workforce a0bbb45 + Finance e411777. Atomic isolated SQL tests passed; authenticated Finance queue checked. No live payroll created or payment sent. Approved payroll payment-head configuration still required |
| Flexible station payroll calendars | Live e93fff5; station and cross-station duplicate guards tested; authenticated calendar and payroll pages checked. No real calendars or pay terms assigned |
| Pooled MG / verified km | Mileage is live (Workforce 286183a + Ops e437d5a). Confirmed-base pooled supplementary settlement implemented in the release below; this new release still requires production verification |
| Refer-and-earn attribution / approved retention reward | Pending |
| Provider-authorised daily cover attribution | Pending |
| Ops payment holds | Live Workforce 0599174/f9c3933 and Ops 8d0f1126; searchable, station-scoped desks browser-verified. SQL checks cover independent release, payroll and late Finance holds. One exposes own period/status only. No production hold placed |
| Approved station losses | Live Workforce d3f6133 + Ops 5836d06b; migration 20260920212000 applied through GitHub. Browser checked Ops menu, form, empty history and pending filter. SQL tests cover duplicate references, independent approval, immutable claim terms, posting dates, single payroll deduction and stale-snapshot gates. No real claim submitted |
| Exit settlement reconciliation | Live 6fee9ec; migration 20260920211000 applied. Paid individual Finance evidence and frozen payroll totals gate canonical exits; no manual paid/waived bypass. Isolated SQL and calculation tests pass. Live exit queue has no cases, so no real exit was completed as a test |
| Unified unpaid ledger / zero-value exit | Pending: all-history coverage, no-payroll exits and arrears after an already-paid final snapshot are not fully implemented |
| Recruit Workforce Plan | Live 8476d2f and 0da8b19; navigation, actual applicant separation and Training filter browser checked. Blank-alias hardening passed 456 tests + typecheck/build; production alias and SHA verified |
| DropX One operating schedule | Live 609095d5. Work navigation no longer redirects to login; per-day pincode, non-shift next operating day and timezone-safe week boundaries have isolated tests. Live account has no assigned schedule; no pincode or week-off invented for testing |
| Owner station setup checklist / versioned schedules | Live bb729fe/67ebfcb: owner checklist, canonical designation precedence, searchable roster, explicit dated replacement and actor/time history. 69 unit tests, SQL schedule suite, typecheck and 183-route build passed; two migration-read retry tests passed. Migration 20260920213500 applied through GitHub after a transient network failure. Production SHA/alias, checklist search, schedule controls/history and active-person search verified. No real schedule submitted |
| Entire Workforce UI and role/mobile acceptance matrix | Pending full pass |

Prior production audit has existing People projection drift and unassigned payment-approval routes. Do not invent approvers, silently repair unrelated records, or suppress this audit.

## Still required before an unattended product claim

- Station-approved terms, associate acceptance, operating pincode/weekly off and a Finance payroll payment head with real approval/processor roles. These are business configuration, not safe defaults.
- Owner-entered Amazon credentials, any provider-required verification, and a successful real read-only profile scan. Local browser login is not the worker session.
- Pooled settlement requires explicitly accepted station terms and confirmed fixed-daily base payroll. Biometric-only qualifying days, automatic base-rate assignment and late-source arrears/corrections are not implemented by the new supplementary settlement. Verified-distance claims require actual approved mileage policies/evidence, not per-delivery fuel assumptions.
- End-to-end associate refer-and-earn, unified referral intake and approved retention rewards are not shipped.
- Provider-authorised daily cover / buffer-ID allocation and double-pay prevention are not shipped.
- Full mobile and scoped-role acceptance remains incomplete; destructive/payment paths are tested with isolated synthetic fixtures, not real payments or account changes.
- Automated onboarding follow-up delivery still needs live acceptance; a tracked task is not proof that WhatsApp/email was delivered.
- The production designation audit currently reports five People source-projection drifts and 53 missing payment-approval routes. Schema apply succeeded even when that separate audit made the workflow red.

Completion means code tested, source committed, production deployment SHA matched, database migration verified and authenticated UI/API/data boundary checked. A build or health endpoint alone does not prove the full business flow.

Usability follow-up c236b4d is live (dpl_2ArCqcijNz63e6k9yr2aqBsGqRSJ), with GitHub quality run 35539501871 passing. Station masters are sorted by code, station context carries into training/calendar forms, owner-only setup/connection links are hidden from other roles, and pincode validation no longer silently strips invalid characters. QLDA selection was verified in both production master forms without saving.

## Pooled scheme preview boundary

- `workforce-pooled-pay.ts` is a pure calculator, not a payroll source. It distinguishes guarantee-plus-pooled-excess from a pooled minimum floor, counts qualifying days rather than calendar days, adds explicit verified-kilometre fuel, and rounds money to paise.
- One combined row per date prevents duplicate daily guarantees. Invalid dates, duplicate dates, negative/fractional counts, excessive precision and future work fail. Open/unconfirmed windows are provisional. Even a complete-window illustration returns `payrollEnabled: false`.
- The Rate Cards page links to an authenticated, client-only formula preview. Blank terms are not silently replaced by the illustrative example. The example is opt-in and never saved; there is no associate assignment or database write.
- Actual accrual still needs effective associate agreements, independently reviewed distance evidence, window-close supplemental settlement, prior-payment reconciliation and late-source correction handling. Daily or weekly pay cycles must not reset a 30-day pooled threshold. The UI states this limitation explicitly.
- Preview e5fa8ce is live at production deployment dpl_3jxpjYdnUgQGxvp7o5t6p2TP3CH7; quality gate 35540081748 passed. Authenticated browser checks verified 1,600 pooled base, 1,840 with 20 excess packages, 1,928.94 including explicit km fuel, 2,400 under the separate pooled-floor formula, stale-result clearing, duplicate-date rejection and provisional evidence state. No real rates or data changed.
- Visual acceptance caught unreadable inherited finance-header text on a dark background. The shared light-header/CTA-spacing correction ecd3ef8 is live and browser-checked on the preview, Payroll and Rate Cards. Full phone-width/accessibility acceptance remains outstanding.

## Verified mileage release

- Station-specific, finite immutable policy versions define approved ₹/km and daily km limits with an agreement reference. No rates are seeded. Canonical active Workforce associates are selected by DropX ID; policy station, designation classification and provider mapping are checked at submission and approval.
- An explicit effective zero-fuel rate card is required for every mapped provider. Imported/mapped payout totals are never assumed to exclude fuel. Equally specific conflicting rate cards fail closed. Approved mileage protects historical rate/mapping versions, while date closure preserving every approved claim remains possible.
- Ops submits one documented total-distance claim per associate/workday. Evidence and notes are immutable; a different Workforce owner must record a reasoned approval/rejection. Exact-reference retries return the original claim; conflicting retries and duplicate live claims for a day fail. Rejected claims may be replaced with corrected evidence and a new reference.
- Work and payroll posting dates are separate. Approved claims use the existing earning-adjustment ledger and Finance handoff. Paid periods cannot be rewritten; late claims post into an open period. Payroll submission detects approved mileage missing from its snapshot and demands recalculation. Repeated snapshots do not duplicate the earning.
- UI includes station/status/search/sort, paginated claim history, reporter/reviewer names and IST times. The new Ops permission is independently configurable; ordinary roles are not silently granted access. Workforce uses existing adjustment permission, with owner-only terms and decisions.
- Local evidence: 82 unit tests, two retry tests, isolated SQL suites including new mileage invariants, TypeScript and 185-route Workforce build passed. Ops typecheck/prebuild passed; full build/deployment/browser acceptance in progress. All mutations were tested using synthetic isolated fixtures, not real policy/claim/payroll records.
- This does not implement pooled-MG settlement, automated route kilometre capture, associate agreement acceptance, referrals or provider-authorised cover attribution. Real policy/evidence and independent reviewer acceptance remain necessary before real payment.

## Confirmed-base pooled settlement release

- New `Pay & settlements → Pooled MG Settlement` desk: immutable station terms, canonical associate/DropX-ID selection, recorded agreement acceptance, closed-window calculation, independent review and actor/time history. No rates, policies or agreements are seeded.
- Two distinct formulas: guarantee plus packages above the **whole-window** allowance, or the higher of the guaranteed total and whole-window package earnings. The window is independent of daily/weekly/15-day payroll cycles. Only the supplementary difference becomes an earning adjustment; confirmed base pay is never paid again.
- Prerequisite: every qualifying production day already has confirmed fixed-daily base payroll equal to the agreed guarantee across its source rows, with fuel separate. Current source rows must exactly match frozen counts, dates, provider ID and station. Held/unconfirmed/missing/changed source work blocks settlement. Source imports, approval and Finance-release validation share a database lock.
- Pending/rejected claims are not payable. A different owner must review. Exact retries reuse the same settlement; rejected claims permit resubmission with a new reference. Zero supplements are reviewed without fake financial adjustments. Generic adjustment screens cannot bypass the dedicated review. Payroll snapshot and Finance processing recheck the evidence; late posting cannot rewrite a confirmed period. Exit closure also checks accepted windows.
- Local evidence: 88 unit tests + two retry tests, isolated SQL suites covering actual base-pay payroll → pooled calculation → independent approval → supplementary payroll → Finance gate, plus zero/rejected/retry and pooled-floor cases. TypeScript and 186-route production build passed. Production deployment/browser verification pending at this entry.
- Scope limitations: no automatic fixed-daily base assignment, no biometric-only production-day accrual, no early-window proration, no late-source correction/arrears workflow, no fabricated acceptance or policy. Existing mapped associates are untouched. This is a usable controlled settlement path, not a claim that the entire lifecycle product is complete.

## DropX One own-adjustment visibility

- Live One commit `2bcaa64b2d9f08472a0db69aad4523aa8c3af7e2`, deployment `dpl_5RqBsa6fZfHSZohTSEVNGuFZJ3Fa`; domain/SHA and authenticated existing mapped account checked.
- Own-only approved/posted earning and deduction estimates, pending/rejected history, mileage work-date context, status filter and page-25 history. Company/account boundaries, no-store errors/responses, request-race protection and no false raw-import fallback. Twenty targeted tests plus 58 existing tests, typecheck and production build passed. No real adjustments created.
- Remaining parity follow-up: fixed-daily/monthly earnings need the same per-associate/day/card grouping as Workforce when several provider IDs contribute on one day. Full role/mobile acceptance remains open.
