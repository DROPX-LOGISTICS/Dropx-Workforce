alter table public.designations
  add column if not exists onboarding_role_ids uuid[] not null default '{}'::uuid[];

create index if not exists designations_onboarding_role_ids_idx
  on public.designations using gin (onboarding_role_ids);
