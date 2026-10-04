begin;

create table public.workforce_onboarding_exit_reasons (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 client_code text not null default 'AMAZON' check (client_code ~ '^[A-Z0-9_-]{2,40}$'),
 code text not null check (code ~ '^[a-z0-9_]{2,60}$'),
 label text not null check (length(btrim(label)) between 2 and 120),
 description text not null default '' check (length(description) <= 500),
 requires_note boolean not null default false,
 sort_order integer not null default 100 check (sort_order between 1 and 10000),
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (company_id, client_code, code)
);

alter table public.workforce_onboarding_exit_reasons enable row level security;
revoke all on public.workforce_onboarding_exit_reasons from public,anon,authenticated;
grant select,insert,update on public.workforce_onboarding_exit_reasons to service_role;

insert into public.workforce_onboarding_exit_reasons
 (company_id,client_code,code,label,description,requires_note,sort_order)
select c.id,'AMAZON',v.code,v.label,v.description,v.requires_note,v.sort_order
from public.companies c
cross join (values
 ('role_not_suitable','The role is not suitable','The associate does not wish to continue after understanding the work.',false,10),
 ('pay_expectation','Pay expectation','The available payment structure does not match the associate expectation.',false,20),
 ('schedule_unavailable','Schedule or availability','The associate cannot continue with the required work schedule.',false,30),
 ('travel_distance','Travel or station distance','The station or service area is not practical for the associate.',false,40),
 ('personal_reason','Personal reason','The associate is unable to continue for a personal reason.',false,50),
 ('other','Other reason','Capture the reason shared by the associate.',true,100)
) as v(code,label,description,requires_note,sort_order)
on conflict (company_id,client_code,code) do nothing;

alter table public.workforce_amazon_pilots
 add column exit_reason_id uuid references public.workforce_onboarding_exit_reasons(id),
 add column exit_note text check (length(exit_note) <= 1000),
 add column exit_requested_at timestamptz,
 add column exit_requested_source text check (exit_requested_source in ('associate','workforce')),
 add column reactivated_at timestamptz,
 add column reactivated_by uuid references public.profiles(id);

create function public.workforce_submit_amazon_pilot_exit(
 p_company uuid,
 p_workforce uuid,
 p_reason uuid,
 p_note text default ''
) returns void
language plpgsql
security invoker
set search_path=''
as $$
declare
 p public.workforce_amazon_pilots;
 r public.workforce_onboarding_exit_reasons;
 v_note text := btrim(coalesce(p_note,''));
begin
 select * into p
 from public.workforce_amazon_pilots
 where company_id=p_company and workforce_id=p_workforce
 for update;
 if not found then raise exception 'Onboarding record is unavailable'; end if;

 select * into r
 from public.workforce_onboarding_exit_reasons
 where id=p_reason and company_id=p_company and client_code='AMAZON' and is_active;
 if not found then raise exception 'Choose an available reason'; end if;
 if r.requires_note and length(v_note)<3 then raise exception 'Add a short note for this reason'; end if;

 if p.closed_at is not null and p.exit_requested_source='associate' then return; end if;

 update public.workforce_amazon_invitation_requests
 set status='failed',error_code='associate_not_continuing',error_message='Associate chose not to continue',updated_at=now()
 where company_id=p_company and workforce_id=p_workforce and status='queued';

 update public.workforce_amazon_pilots
 set closed_at=now(),exit_reason_id=r.id,exit_note=nullif(v_note,''),exit_requested_at=now(),
     exit_requested_source='associate',reactivated_at=null,reactivated_by=null
 where company_id=p_company and workforce_id=p_workforce;

 update public.biometric_enrolments
 set status='Inactive',effective_to=(now() at time zone 'Asia/Kolkata')::date
 where company_id=p_company and profile_type='workforce' and account_id=p_workforce;

 insert into public.workforce_amazon_pilot_history(company_id,workforce_id,event,evidence)
 values(p_company,p_workforce,'associate_exit_requested',jsonb_build_object(
  'reason_id',r.id,'reason_code',r.code,'reason_label',r.label,'note',v_note,'source','dropx_one'
 ));
end
$$;

create function public.workforce_reactivate_amazon_pilot(
 p_company uuid,
 p_actor uuid,
 p_workforce uuid,
 p_locations uuid[]
) returns void
language plpgsql
security invoker
set search_path=''
as $$
declare
 p public.workforce_amazon_pilots;
begin
 if p_actor is null then raise exception 'A Workforce user is required'; end if;
 select * into p
 from public.workforce_amazon_pilots
 where company_id=p_company and workforce_id=p_workforce
 for update;
 if not found then raise exception 'Onboarding record is unavailable'; end if;
 if p_locations is not null and not(p.station_id=any(p_locations)) then raise exception 'Station outside your access'; end if;
 if p.closed_at is null then return; end if;

 update public.workforce_amazon_pilots
 set closed_at=null,reactivated_at=now(),reactivated_by=p_actor
 where company_id=p_company and workforce_id=p_workforce;

 update public.workforce_amazon_invitation_requests
 set status='queued',error_code=null,error_message=null,updated_at=now()
 where company_id=p_company and workforce_id=p_workforce
   and status='failed' and error_code='associate_not_continuing';

 update public.biometric_enrolments
 set status='Active',effective_to=null
 where company_id=p_company and profile_type='workforce' and account_id=p_workforce;

 insert into public.workforce_amazon_pilot_history(company_id,workforce_id,event,evidence)
 values(p_company,p_workforce,'reactivated',jsonb_build_object(
  'actor',p_actor,'previous_reason_id',p.exit_reason_id,'previous_note',p.exit_note,
  'previous_requested_at',p.exit_requested_at,'previous_source',p.exit_requested_source
 ));
end
$$;

revoke all on function public.workforce_submit_amazon_pilot_exit(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.workforce_submit_amazon_pilot_exit(uuid,uuid,uuid,text) to service_role;
revoke all on function public.workforce_reactivate_amazon_pilot(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_reactivate_amazon_pilot(uuid,uuid,uuid,uuid[]) to service_role;

commit;
