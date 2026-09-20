begin;
create table public.workforce_operating_schedule_events (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 workforce_id uuid not null references public.workforce(id),schedule_id uuid not null references public.workforce_operating_schedules(id),
 replaced_schedule_id uuid references public.workforce_operating_schedules(id),actor_id uuid not null,
 before_snapshot jsonb,after_snapshot jsonb not null,created_at timestamptz not null default now()
);
alter table public.workforce_operating_schedule_events enable row level security;
revoke all on public.workforce_operating_schedule_events from public,anon,authenticated;
grant select on public.workforce_operating_schedule_events to service_role;
create function public.workforce_version_operating_schedule(
 p_company uuid,p_actor uuid,p_workforce uuid,p_pincode text,p_weekly_off_day smallint,
 p_from date,p_to date,p_notes text,p_locations uuid[],p_replaces uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare w public.workforce;previous public.workforce_operating_schedules;existing public.workforce_operating_schedules;result uuid;before_row jsonb;
begin
 if p_actor is null then raise exception 'Authenticated operator is required'; end if;
 select * into w from public.workforce where company_id=p_company and id=p_workforce and deleted_at is null and migration_state<>'reclassified' for update;
 if not found or w.is_active is distinct from true or w.onboarding_status is distinct from 'active' then raise exception 'Choose an activated Workforce associate'; end if;
 if p_locations is not null and (w.location_id is null or not(w.location_id=any(p_locations))) then raise exception 'Associate is outside your station scope'; end if;
 if not exists(select 1 from public.designations d join public.designation_categories c on c.id=d.designation_category_id and c.company_id=d.company_id where d.company_id=p_company and c.people_module='delivery_network' and (d.id=w.designation_id or (w.designation_id is null and nullif(btrim(w.designation),'') is not null and lower(btrim(w.designation)) in (lower(btrim(d.code)),lower(btrim(d.name)))))) then raise exception 'The designation master must classify this person as Workforce'; end if;
 if p_weekly_off_day is null or p_weekly_off_day not between 0 and 6 then raise exception 'Choose a weekly-off day'; end if;
 if p_from is null or (p_to is not null and p_to<p_from) or coalesce(p_pincode,'')!~'^[0-9]{6}$' then raise exception 'Choose a valid pincode and effective period'; end if;
 p_notes:=nullif(btrim(p_notes),'');
 -- Retry is exact and never creates another event or closes another version.
 select * into existing from public.workforce_operating_schedules where company_id=p_company and workforce_id=p_workforce and effective_from=p_from;
 if found then
  if existing.operating_pincode=p_pincode and existing.weekly_off_day=p_weekly_off_day and existing.effective_to is not distinct from p_to and existing.notes is not distinct from p_notes and exists(select 1 from public.workforce_operating_schedule_events e where e.schedule_id=existing.id and e.replaced_schedule_id is not distinct from p_replaces) then return existing.id; end if;
  raise exception 'A schedule already starts on this date; inspect the existing version';
 end if;
 if p_replaces is not null then
  if p_from<(now() at time zone 'Asia/Kolkata')::date then raise exception 'A replacement cannot rewrite past operating days'; end if;
  select * into previous from public.workforce_operating_schedules where id=p_replaces and company_id=p_company and workforce_id=p_workforce for update;
  if not found or previous.effective_from>=p_from or (previous.effective_to is not null and previous.effective_to<p_from) then raise exception 'Select this associate''s schedule covering the replacement date'; end if;
  if length(coalesce(p_notes,''))<3 then raise exception 'Explain the schedule change'; end if;
  before_row:=to_jsonb(previous);
  update public.workforce_operating_schedules set effective_to=p_from-1,updated_at=now() where id=p_replaces;
 end if;
 -- Existing overlap validation also protects future versions. Failure rolls back the closure above.
 result:=public.workforce_save_operating_schedule(p_company,p_actor,p_workforce,p_pincode,p_weekly_off_day,p_from,p_to,p_notes,p_locations);
 insert into public.workforce_operating_schedule_events(company_id,workforce_id,schedule_id,replaced_schedule_id,actor_id,before_snapshot,after_snapshot)
 select p_company,p_workforce,result,p_replaces,p_actor,before_row,to_jsonb(s) from public.workforce_operating_schedules s where s.id=result;
 return result;
end $$;
revoke all on function public.workforce_version_operating_schedule(uuid,uuid,uuid,text,smallint,date,date,text,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.workforce_version_operating_schedule(uuid,uuid,uuid,text,smallint,date,date,text,uuid[],uuid) to service_role;
commit;
