alter table public.designations
  add column if not exists onboarding_categories text[] not null default array['employees']::text[];

update public.designations
set onboarding_categories = array['employees']::text[],
    updated_at = now()
where onboarding_categories is null
   or cardinality(onboarding_categories) = 0;

create index if not exists designations_onboarding_categories_idx
  on public.designations using gin(onboarding_categories);

