# One-time designation correction

`20261020_van_da_designation_correction.sql` implements the requested DA classification correction for the 36 profiles audited on 20 October 2026:

- 18 DA profiles with current per-packet/van-rent payment mappings become ODCD.
- 18 DA profiles that match the default Amazon ID and station of deployed, company-owned Kerala vans become DCD.
- T1013 becomes ODCD under the user's explicit conflict resolution.
- Three profiles already carrying the requested designation are excluded from mutation. Two Fleet defaults without a verified current Workforce mapping are excluded pending identity reconciliation.

This is a data operation, not a schema migration or application release. It changes only `workforce.designation_id`, `workforce.designation`, and `workforce.updated_at`. Existing validation, audit, policy-history and cache-invalidation triggers remain enabled.

## Execution

1. Inspect the live designation-related trigger functions, target master policies and exact current mappings. Stop if a trigger could change financial terms or external state.
2. Commit and push the reviewed script to this repository before executing it in production.
3. Run the script as saved. It ends in `ROLLBACK` and rehearses the entire update.
4. Check the returned 36-row receipt and all unchanged-data assertions.
5. In the same session, run the same reviewed script with only its final `ROLLBACK` changed to `COMMIT`.
6. Independently read back all targeted profiles and their current Amazon/payment mappings. Save the committed receipt and provide the final ID list.

The script refuses a different execution date, changed designation, missing mapping, changed company-owned Fleet evidence or changed designation payment policy. It also aborts the entire transaction if any payment mapping, direct payment allocation, unrelated Workforce profile or unrelated field on a targeted profile changes.

If execution fails, do not disable triggers or relax identity checks. Reconcile the cause and review a new scoped script. If correction must later be reversed, use the committed receipt to prepare a fresh, reviewed inverse operation that checks each profile still has this operation's target designation and timestamp.

## Local validation

Run `node --test scripts/data-operations/test-van-da-designation-correction.mjs`.
The PGlite tests execute the SQL against disposable fixtures, verify all 36
results and rollback, and check rejection of stale mappings, changed designation
payment policies and a trigger that changes direct payment terms. They validate
SQL behavior, not the installed production triggers. Live trigger inspection and
the production rollback rehearsal are still required.
