# Amazon onboarding pilot

The new `/delivery-network/amazon-pilot` module is opt-in for new arrivals. Existing people are never backfilled. The initial view focuses on invitation and DA In-App Onboarding pendency; training details live in the associate record.

Arrival creates an inactive, unapproved canonical identity, its biometric enrolment, and a dedicated pilot record in one transaction. The existing Amazon invitation queue is used immediately. Registration readiness is separate: two trial days by default, configurable per person; early readiness requires a recorded reason when the planned days have not been logged. Associates see their pending step and biometric ID in DropX One's existing authenticated work-setup view. Amazon's external invitation cannot enforce DropX's training gate.

## Payroll boundary

No payroll calculator, rates, historical attendance, payment mappings, or payroll snapshots are changed. No legacy joining plan is created by pilot intake. Dedicated trial records retain attendance for later payment review. Guards prevent pilot activation, payment mapping and payroll adjustment insertion. Guards return unchanged for existing associates; their private cohort lookup uses a non-callable trigger function with a fixed search path. Pilot mode only permits `observation`; there is no payroll cutover action in this release. A later reviewed release must define effective dates, compensation reconciliation and cutover.

## Evidence and identity

An hourly source report import is not invented here. The existing DA In-App Onboarding import remains the source; the pilot reads its latest exact `accountid` match, never a name or an email guess. LSC's returned provider ID binds to the internal identity via the existing invitation worker and portal links. LSC `transporter_id` joins SCC `tasId`; SCC `employeeId` joins shipment `provider_employee_id` (the imported holder employee ID).

A ten-minute cron processes up to ten least-recently checked pilots per run, with a 40-second start budget. It reads existing LSC roster data, imported onboarding rows and dated SCC reconciliation snapshots. SCC snapshots contain the active driver roster, including drivers without a delivery count. If upstream SCC collection has not produced fresh evidence for the station, the pilot waits. Cache absence or disappearing onboarding rows never prove activation. Identity conflicts are held, historical observations are retained, and first delivery is bounded by the observed SCC identity date. No inferred match is written to payment mappings.

## Invitations and messaging

The established LSC queue delivers the Amazon email invitation. Queue inserts are idempotent per person; ambiguous/failed external attempts are retained for review rather than automatically resent. The existing configured Workforce WhatsApp welcome workflow is invoked when the user records an arrival and contains the generated biometric ID. WhatsApp delivery is audited by the existing message log and depends on its configured campaign. Tests never send real messages.

## Release

Workforce: GitHub-first release from `DROPX-LOGISTICS/Dropx-Workforce`, migrations only via its production GitHub Actions workflow. DropX One: isolated `apps/connect` changes in `nisar-dropx/dropx-partner-dashboard`. Missing pilot tables are tolerated by One until migration release; other lookup errors fail closed. Verify both production commit SHAs and project/domain associations.

The dedicated Workforce deployment schedules only `/api/cron/amazon-pilot`. Shared-template document, cleanup, OpsPulse and campaign schedules remain with their existing owning deployments; this restored project must not duplicate them. The established Cloudflare invitation worker polls every five minutes, except the quarter-past tick which processes IDfy. Arrivals enter its queue immediately. Its optional immediate HTTP kick requires the worker key; scheduled processing remains independent of that setting.
