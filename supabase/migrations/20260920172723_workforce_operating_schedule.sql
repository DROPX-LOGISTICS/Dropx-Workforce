begin;

create table if not exists public.workforce_operating_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  workforce_id uuid not null references public.workforce(id) on delete cascade,
  operating_pincode text not null check (operating_pincode ~ '^[0-9]{6}$'),
  weekly_off_day smallint not null check (weekly_off_day between 0 and 6),
  effective_from date not null,
  effective_to date,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  unique (company_id, workforce_id, effective_from)
);

create index if not exists workforce_operating_schedules_lookup_idx
  on public.workforce_operating_schedules(company_id, workforce_id, effective_from desc);

alter table public.workforce_operating_schedules enable row level security;
revoke all on table public.workforce_operating_schedules from public, anon, authenticated;
grant select, insert, update, delete on table public.workforce_operating_schedules to service_role;

create or replace function public.workforce_save_operating_schedule(
  p_company uuid, p_actor uuid, p_workforce uuid, p_pincode text,
  p_weekly_off_day smallint, p_from date, p_to date, p_notes text, p_locations uuid[]
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_worker public.workforce;
begin
  select * into v_worker from public.workforce
    where company_id = p_company and id = p_workforce and deleted_at is null and migration_state <> 'reclassified'
    for update;
  if not found or not v_worker.is_active or v_worker.onboarding_status <> 'active' then
    raise exception 'Choose an activated Workforce associate';
  end if;
  if p_locations is not null and (v_worker.location_id is null or not(v_worker.location_id = any(p_locations))) then
    raise exception 'Associate is outside your station scope';
  end if;
  if coalesce(p_pincode, '') !~ '^[0-9]{6}$' then raise exception 'Enter a valid six-digit operating pincode'; end if;
  if p_weekly_off_day not between 0 and 6 then raise exception 'Choose a weekly-off day'; end if;
  if p_from is null or (p_to is not null and p_to < p_from) then raise exception 'Choose a valid effective period'; end if;
  if exists (select 1 from public.workforce_operating_schedules s where s.company_id=p_company and s.workforce_id=p_workforce and daterange(s.effective_from,s.effective_to,'[]') && daterange(p_from,p_to,'[]')) then
    raise exception 'This associate already has an operating schedule in the selected period';
  end if;
  insert into public.workforce_operating_schedules(company_id,workforce_id,operating_pincode,weekly_off_day,effective_from,effective_to,notes,created_by)
    values(p_company,p_workforce,p_pincode,p_weekly_off_day,p_from,p_to,nullif(btrim(p_notes),''),p_actor) returning id into v_id;
  return v_id;
end $$;

revoke all on function public.workforce_save_operating_schedule(uuid,uuid,uuid,text,smallint,date,date,text,uuid[]) from public, anon, authenticated;
grant execute on function public.workforce_save_operating_schedule(uuid,uuid,uuid,text,smallint,date,date,text,uuid[]) to service_role;

notify pgrst, 'reload schema';
commit;
