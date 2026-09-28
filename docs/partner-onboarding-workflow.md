# Partner onboarding workflow

## Product decisions

- A single Associate Lifecycle register is the working surface; due and pending-step filters replace a separate ID queue. Existing provider mapping and rate review stay available as supporting tasks.
- All portals read the same partner/model/designation policy and status function. Recruit sees its own initiations; OpsPulse and Workforce respect location authorization.
- Actual arrival comes from an explicitly recorded reporting date or the first canonical attendance punch. An expected joining date does not start overdue alerts.
- Registration completion permits ID invitation; training does not impose a fixed wait. Initial configurable rules cover Amazon EDSP/XPT DA/DCD/ODCD. Other client/model/designation combinations can be configured independently.
- The saved mailbox must have `.stationcode` immediately before `@` when the rule requires it. Any valid mailbox prefix/domain is accepted. The app neither creates mailboxes nor replaces the saved email.
- Amazon invitation requests are validated and queued. A worker rejection never falls through to a direct invitation bypass. Worker credentials and service-area configuration remain server-side.
- Imported evidence matches the saved invitation/registration email and station. Each rule defines the source and normalized field names. New external systems need an importer/integration; manual partner setup is available meanwhile.
- A completed partner report holds the associate at provider mapping. No report, name suggestion, invitation response, or transporter ID auto-confirms mapping. Only an effective active mapping unlocks a configured DropX One workspace.
- Keep both mapping queues: associates without a provider mapping, and imported provider IDs without a DropX mapping. The latter includes all import history.
- Default invitation/progress thresholds are two days and are editable per workflow. A queued or failed invitation has not been sent. The due date remains visible beside the associate.
- Raw report action items are for the operations team. Associates receive a configured readable title and next action, with a neutral contact-your-team fallback for unknown codes.

## Messaging

WhatsApp rules select a workflow, pending step, optional station, approved text template, sender, variable mappings, cadence, limit, report freshness and delivery hours. Queue creation is serialized per company. The delivery worker rechecks the current workflow, station, report age, step and mapping immediately before sending. Missing configuration is not interpreted as permission to send arbitrary messages.

Daily team email is configured by station. It combines overdue invitations and report-backed pending partner setup/mapping into one email, includes only basic identifying and action details, and replies using stable subject plus Message-ID/In-Reply-To/References. Station, station manager and cluster manager addresses come from Station master; Workforce/Ops/Recruit audiences are selected from active company users. Audience changes start a new thread. Atomic station/day uniqueness prevents duplicate sends; uncertain SMTP outcomes are held for review, not automatically resent.

The scheduler runs hourly at :15; each station rule selects its daily hour in IST. SMTP and approved WhatsApp configuration must be enabled before actual delivery. No real messages are sent as tests.

## Verification

PGlite regression coverage: mailbox conventions; registration gate; location/creator isolation; idempotent invitations; future/cancelled mappings; compatibility registration; reminder approval/freshness/limits; configurable due dates; another client's custom report; readable instructions; full-history provider orphans; digest daily uniqueness and table privileges.

Also run each changed application's TypeScript, existing regression suite and production build. Database release uses the Workforce GitHub Actions workflow only. Deployments must reference committed GitHub source and retain separate product domains.
