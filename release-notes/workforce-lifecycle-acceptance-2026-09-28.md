# Workforce lifecycle release acceptance

This release closes the gap between the partner workflow already deployed across the portals and the Workforce operator's actual day-to-day workflow. Deployment alone is not an end-to-end acceptance claim.

| Journey | Product behavior | Verification |
| --- | --- | --- |
| Registration invitation | Existing Recruit and OpsPulse forms retain their own permissions and scope. Workforce's primary CTA opens the canonical associate invitation form. Station-email rules remain driven by the workflow master; protected legacy invitations stay compatible. | Prior shared SQL tests and portal release; current live checks pending. |
| Registration review | The associate opens inside the register. Documents, biometric evidence and approval actions retain their existing checks. All mutations return to the same associate and filter context. | Type check, redirect tests; live checks pending. |
| Partner setup | The same DA In-App/configured partner state drives the list and associate workspace. No legacy training state decides the displayed partner status. Invitation, retry, reporting date, source report and request outcome are contextual. | Shared SQL workflow suite. |
| ID confirmation | Imported IDs are evidence only. The operator confirms mapping. Both unmatched-provider and unmatched-associate queues remain available. A current confirmed ID-and-rate save no longer requires the obsolete training-plan activation flag. | New SQL tests: approval gate, scoped save, bounded dates, future dates, closed assignment, activation without training plan. |
| Rates | Effective dated personal rates and component earning rules remain in the associate workspace. Bounded periods count as current within their effective dates. Payment access is checked independently of registration-review access. | Existing payment/finance suite plus current-period tests. |
| Daily operation / exit | Attendance is available in the profile; earnings, payout review and existing settlement controls remain available. Optional legacy training entitlements and payroll history are retained. | Existing immutable payroll, maker-checker, settlement and evidence tests. |
| Referrals | Existing Refer & Earn intake remains in DropX One; referred-candidate desk remains a view of the Workforce register, not a new top-level menu. | Existing referral SQL tests; location-program configuration not changed in this release. |
| Associate follow-ups | Bulk master setup configures several workflows/steps atomically. Existing rules are preserved. Each associate displays recorded follow-up outcomes. Readiness view distinguishes configuration from actual delivery. | Existing reminder eligibility/idempotency tests; live configuration and delivery to be verified separately. |
| Team follow-ups | Existing daily station-thread logic remains configured separately; no team member is guessed as a recipient. | Existing digest idempotency tests. Workforce/Recruit recipient selection remains required. |
| Client expansion | Master selects client, model and designation. Manual/report-based partner adapter remains usable independently of Amazon worker. | Manual other-client SQL test. |

## External acceptance still needed

- Cloudflare worker must consume a legitimate queued invitation and return its actual outcome; no fictitious associate will be invited to Amazon for testing.
- The approved WhatsApp template and configured rules must be enabled before automatic reminders operate. Actual delivery cannot be inferred from a deployed cron or queued campaign.
- Daily email recipients for the Workforce and recruitment teams are still awaiting an answer; station and cluster addresses come from Station master.
- Existing production registration/classification discrepancies must not be silently resolved by auto-approving or remapping people.

## Release verification

Pending final local checks, GitHub commit, migration workflow, Vercel alias verification and live UI inspection.
