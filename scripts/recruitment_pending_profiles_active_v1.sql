-- Recruitment-created profiles must be able to sign in to DropX One while
-- their profile-completion workflow remains pending.

create or replace function public.ensure_recruitment_profile_login_active()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if lower(btrim(coalesce(new.onboarding_application_source, ''))) in (
    'telecaller',
    'field_recruiter',
    'viewer'
  )
  and lower(btrim(coalesce(new.onboarding_status, 'pending'))) = 'pending' then
    new.is_active := true;
  end if;

  return new;
end;
$$;

drop trigger if exists contractors_ensure_recruitment_login_active
on public.contractors;

create trigger contractors_ensure_recruitment_login_active
before insert or update of onboarding_application_source, onboarding_status
on public.contractors
for each row
execute function public.ensure_recruitment_profile_login_active();

-- Repair recruitment profiles created before the safeguard was installed.
update public.contractors
set is_active = true,
    updated_at = now()
where lower(btrim(coalesce(onboarding_application_source, ''))) in (
    'telecaller',
    'field_recruiter',
    'viewer'
  )
  and lower(btrim(coalesce(onboarding_status, 'pending'))) = 'pending'
  and is_active = false;
