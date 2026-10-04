begin;

-- Beta onboarding is keyed internally by UUID. The operational identifier is
-- supplied later by LSC/SCC; biometric IDs remain attendance-only.
update public.workforce w
set dropx_id = null,
    onboarding_token_hash = null,
    onboarding_token_expires_at = null
where exists (
  select 1
  from public.workforce_amazon_pilots p
  where p.company_id = w.company_id
    and p.workforce_id = w.id
);

create or replace function public.workforce_amazon_pilot_strip_internal_ids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.workforce
  set dropx_id = null,
      onboarding_token_hash = null,
      onboarding_token_expires_at = null
  where company_id = new.company_id
    and id = new.workforce_id;
  return new;
end
$$;

drop trigger if exists workforce_amazon_pilot_strip_internal_ids on public.workforce_amazon_pilots;
create trigger workforce_amazon_pilot_strip_internal_ids
after insert on public.workforce_amazon_pilots
for each row execute function public.workforce_amazon_pilot_strip_internal_ids();

revoke all on function public.workforce_amazon_pilot_strip_internal_ids() from public, anon, authenticated;
grant execute on function public.workforce_amazon_pilot_strip_internal_ids() to service_role;

commit;
