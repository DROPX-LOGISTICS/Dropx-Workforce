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
| Ops payment holds | Current release: 64 unit tests plus isolated SQL suite and full Workforce build passed. Ops and One surfaces in partner-dashboard require their release. No production hold placed |
| Approved station losses | Pending; existing reviewed Workforce adjustments remain available |
| Unified unpaid ledger and exit settlement reconciliation | Pending |
| Entire Workforce UI and role/mobile acceptance matrix | Pending full pass |

Prior production audit has existing People projection drift and unassigned payment-approval routes. Do not invent approvers, silently repair unrelated records, or suppress this audit.

Completion means code tested, source committed, production deployment SHA matched, database migration verified and authenticated UI/API/data boundary checked. A build or health endpoint alone does not prove the full business flow.
