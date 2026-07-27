create table if not exists public.mob_app_registration_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_type text not null,
  account_id uuid not null,
  draft_data jsonb not null default '{}'::jsonb,
  verification_results jsonb not null default '[]'::jsonb,
  file_paths jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, profile_type, account_id),
  constraint mob_app_registration_drafts_profile_type_check
    check (profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker')),
  constraint mob_app_registration_drafts_data_object_check
    check (jsonb_typeof(draft_data) = 'object'),
  constraint mob_app_registration_drafts_verifications_array_check
    check (jsonb_typeof(verification_results) = 'array'),
  constraint mob_app_registration_drafts_files_object_check
    check (jsonb_typeof(file_paths) = 'object')
);

create index if not exists mob_app_registration_drafts_account_idx
  on public.mob_app_registration_drafts (company_id, profile_type, account_id);

alter table public.mob_app_registration_drafts enable row level security;

drop policy if exists service_role_mob_app_registration_drafts_all
  on public.mob_app_registration_drafts;
create policy service_role_mob_app_registration_drafts_all
on public.mob_app_registration_drafts
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

notify pgrst, 'reload schema';
