# Automatic identity handover

The Workforce five-minute verification cron reconciles the current lifecycle rollout. It creates one permanent DropX identity after verified Amazon ACTIVE and submitted registration, then retries numeric payout-ID linking when the exact SCC `tasId` → `employeeId` crosswalk arrives for the candidate's station. It retains a previously verified numeric identity and stops on conflicts, stale confirmation, archive, exit, or duplicate candidates. Names never identify the payout owner.

The transaction is idempotent and audited. It does not approve registration, attendance, bank details or pay rates. OpsPulse separates the saved identity link from payment configuration. A linked employee with no scheme is searchable by both IDs, while earnings remain unavailable until rates are configured.

The existing rollout gate in `beta-lifecycle.ts` still restricts this release to the current pilot. Broad release must expand the same gate consistently in One, Workforce and OpsPulse after beta validation. The reconciliation function itself has no candidate, driver or numeric ID hardcoded, and needs no per-associate SQL command. Missing SCC evidence stays `awaiting_scc_identity`; conflicts require an ownership review, never a name-based guess.

Onboarding biometric setup uses a valid device receipt plus readiness. Attendance approval is separate. Previous setup evidence survives subsequent partial working days. Active accounts enter Home; onboarding remains accessible as history.
