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
