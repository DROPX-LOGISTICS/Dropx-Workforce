alter table public.field_executives
  add column if not exists onboarding_status text not null default 'pending';

update public.field_executives
set onboarding_status = 'pending',
    updated_at = now()
where onboarding_status is distinct from 'pending';
