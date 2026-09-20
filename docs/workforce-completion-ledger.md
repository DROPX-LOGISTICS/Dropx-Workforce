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
| Pooled MG / verified km | Pending |
| Refer-and-earn attribution / approved retention reward | Pending |
| Provider-authorised daily cover attribution | Pending |
| Ops payment holds | Live Workforce 0599174/f9c3933 and Ops 8d0f1126; searchable, station-scoped desks browser-verified. SQL checks cover independent release, payroll and late Finance holds. One exposes own period/status only. No production hold placed |
| Approved station losses | Live Workforce d3f6133 + Ops 5836d06b; migration 20260920212000 applied through GitHub. Browser checked Ops menu, form, empty history and pending filter. SQL tests cover duplicate references, independent approval, immutable claim terms, posting dates, single payroll deduction and stale-snapshot gates. No real claim submitted |
| Exit settlement reconciliation | Live 6fee9ec; migration 20260920211000 applied. Paid individual Finance evidence and frozen payroll totals gate canonical exits; no manual paid/waived bypass. Isolated SQL and calculation tests pass. Live exit queue has no cases, so no real exit was completed as a test |
| Unified unpaid ledger / zero-value exit | Pending: all-history coverage, no-payroll exits and arrears after an already-paid final snapshot are not fully implemented |
| Recruit Workforce Plan | Live 8476d2f; navigation, actual applicant separation and Training filter browser checked. Latest blank-alias hardening 0da8b19 tested locally (456 tests + build) and pushed; deployment still requires confirmation |
| DropX One operating schedule | Live 609095d5. Work navigation no longer redirects to login; per-day pincode, non-shift next operating day and timezone-safe week boundaries have isolated tests. Live account has no assigned schedule; no pincode or week-off invented for testing |
| Owner station setup checklist / versioned schedules | This release: owner checklist, canonical designation precedence, searchable roster, explicit dated replacement and actor/time history. 69 unit tests, SQL schedule suite, typecheck and 183-route build passed. Verify deployment and migration 20260920213500 before calling live |
| Entire Workforce UI and role/mobile acceptance matrix | Pending full pass |

Prior production audit has existing People projection drift and unassigned payment-approval routes. Do not invent approvers, silently repair unrelated records, or suppress this audit.

## Still required before an unattended product claim

- Station-approved terms, associate acceptance, operating pincode/weekly off and a Finance payroll payment head with real approval/processor roles. These are business configuration, not safe defaults.
- Owner-entered Amazon credentials, any provider-required verification, and a successful real read-only profile scan. Local browser login is not the worker session.
- Pooled MG averaging and verified kilometre fuel are not covered by the existing daily-hybrid / per-delivery fuel calculations.
- End-to-end associate refer-and-earn, unified referral intake and approved retention rewards are not shipped.
- Provider-authorised daily cover / buffer-ID allocation and double-pay prevention are not shipped.
- Full mobile and scoped-role acceptance remains incomplete; destructive/payment paths are tested with isolated synthetic fixtures, not real payments or account changes.
- The production designation audit currently reports five People source-projection drifts and 53 missing payment-approval routes. Schema apply succeeded even when that separate audit made the workflow red.

Completion means code tested, source committed, production deployment SHA matched, database migration verified and authenticated UI/API/data boundary checked. A build or health endpoint alone does not prove the full business flow.
