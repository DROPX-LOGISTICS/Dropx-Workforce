begin;

create table if not exists public.people_exception_resolutions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_type text not null,
  profile_id uuid not null,
  rule_code text not null,
  source_updated_at timestamptz not null,
  cleared_by uuid references public.profiles(id) on delete set null,
  cleared_at timestamptz not null default now(),
  remarks text,
  unique (company_id, profile_type, profile_id, rule_code)
);

create index if not exists people_exception_resolutions_lookup_idx
  on public.people_exception_resolutions (company_id, profile_type, profile_id, rule_code);

alter table public.people_exception_resolutions enable row level security;

drop policy if exists service_role_people_exception_resolutions_all on public.people_exception_resolutions;
create policy service_role_people_exception_resolutions_all
on public.people_exception_resolutions
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

commit;
