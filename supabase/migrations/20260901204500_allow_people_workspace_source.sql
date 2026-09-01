-- Workspace accounts matched through the canonical People person lifecycle use
-- a distinct source label. Keep all existing source values valid while allowing
-- the access cutover to record that canonical match explicitly.

alter table public.google_workspace_accounts
  drop constraint if exists google_workspace_account_source_check;

alter table public.google_workspace_accounts
  add constraint google_workspace_account_source_check
  check (
    source_type is null
    or source_type in (
      'employee',
      'contractor',
      'workforce',
      'location',
      'profile',
      'people_person'
    )
  );
