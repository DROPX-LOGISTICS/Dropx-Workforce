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
| Amazon connection UI, encrypted storage, sync lease and observation history | Current release; isolated tests pass; deployment/production verification pending |
| Amazon full live account scan | Requires owner-entered connection credentials and linked profile; not yet verified |
| DropX One joining/training visibility | Pending, actual source is partner-dashboard/apps/connect |
| Confirmed payroll → Finance approval/process | Pending integration; existing Workforce manual mark-paid must not be represented as this handoff |
| Flexible station payroll calendars / pooled MG / verified km | Pending |
| Refer-and-earn attribution / approved retention reward | Pending |
| Provider-authorised daily cover attribution | Pending |
| Ops holds and approved station losses | Pending |
| Unified unpaid ledger and exit settlement reconciliation | Pending |
| Entire Workforce UI and role/mobile acceptance matrix | Pending full pass |

Prior production audit has existing People projection drift and unassigned payment-approval routes. Do not invent approvers, silently repair unrelated records, or suppress this audit.

Completion means code tested, source committed, production deployment SHA matched, database migration verified and authenticated UI/API/data boundary checked. A build or health endpoint alone does not prove the full business flow.
