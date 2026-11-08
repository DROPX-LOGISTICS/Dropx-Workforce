# DropX Workforce Release Policy

This repository is the source of truth for the Workforce product.

## Mandatory release order

1. Make and verify changes locally.
2. Commit the complete change to Git.
3. Push the commit to `DROPX-LOGISTICS/Dropx-Workforce` on GitHub.
4. Let the dedicated `dropx-workforce` Vercel project deploy that GitHub commit.
5. Apply Supabase migrations only through the repository's GitHub Actions workflow.

## Prohibited release paths

- Do not run `vercel deploy`, `vercel --prod`, or manually alias a Workforce deployment from a working tree.
- Do not deploy Workforce from the `dropx-partner-dashboard` Vercel project.
- Do not execute production schema changes directly from a chat, SQL editor, MCP call, or local Supabase CLI command.
- Do not change production data as part of a schema release.

## Product boundaries

- `workforce.dropxlogistics.com` belongs only to the dedicated `dropx-workforce` Vercel project.
- `dashboard.dropxlogistics.com` and the main dashboard are outside the Workforce release scope.
- Workforce designation and profile queries must remain master-classified and isolated from People/HR records.
- Existing invited registrations must keep using the protected compatibility path until their registration is complete.

## Required verification

- Run `pnpm exec tsc --noEmit`.
- Run `pnpm run prebuild`.
- Run `pnpm run build` for application changes.
- Confirm the commit exists on the Workforce GitHub remote before checking a deployment or migration result.

## Data-dependent filters across DropX

For every list, register, queue, dashboard and report in People, OpsPulse, Finance,
Recruit/HR, Workforce and Fleet, each filter must show options present in the
current permission-scoped dataset after all OTHER active filters are applied.
Multi-select values are OR within one dimension and AND between dimensions.
Preserve selected zero-match values so users can remove them; never silently
clear a selection or broaden the query. Date, search and permission context apply
before deriving available choices. Do not use the visible pagination page as the
source of available options. Record creation/edit controls and report-format,
sort-order or page-size controls are not data filters.

Do not add record counts to filter labels outside Recruit. Reuse complete data
already loaded, or return compact server-side distinct combinations. Never fetch
full personal/financial records merely to populate filters, issue a query per
option, or bypass authorization. Memoize local derivation and cancel stale search
requests. Verify cross-filter updates, empty results, paging, access scope and
performance before calling a menu complete. A rollout to one menu/product does
not complete the platform-wide rule.
