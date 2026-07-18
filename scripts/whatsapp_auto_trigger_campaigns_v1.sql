create sequence if not exists public.whatsapp_onboarding_campaign_seq start 1;

create or replace function public.next_onboarding_campaign_code()
returns text
language sql
security definer
set search_path = public
as $$
  select 'ONBOARD-' || nextval('public.whatsapp_onboarding_campaign_seq')::text;
$$;

revoke all on function public.next_onboarding_campaign_code() from public, anon, authenticated;
grant execute on function public.next_onboarding_campaign_code() to service_role;
