# Workforce Release Process

The Workforce product has an independent GitHub repository, Vercel project, and production domain. The main dashboard is not part of this release chain.

## Application changes

1. Create and verify the change locally.
2. Commit and push it to `DROPX-LOGISTICS/Dropx-Workforce`.
3. The GitHub quality gate verifies TypeScript, the contractor schema boundary, and the production build.
4. Vercel builds the pushed `main` commit through its Git integration.
5. Verify the deployment at `https://workforce.dropxlogistics.com`.

Direct local production deployments are intentionally not part of this process.

## Database changes

1. Create a timestamped file under `supabase/migrations`.
2. Review the SQL, RLS, grants, and registration compatibility behavior.
3. Commit and push the migration to GitHub.
4. The `Workforce Supabase Production Migrations` GitHub Action performs a dry run and then applies only pending committed migrations.

The GitHub environment `supabase-production` requires these encrypted repository secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_ID`

No production schema change should be executed directly from a chat or local working tree.

## Domain isolation

`workforce.dropxlogistics.com` must remain assigned only to the `dropx-workforce` Vercel project. It must never be re-added to `dropx-partner-dashboard`, because every production deployment of that shared project would reclaim the Workforce domain.
