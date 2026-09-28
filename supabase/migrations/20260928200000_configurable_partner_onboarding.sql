begin;

-- Eligibility is configuration, independent of a designation's pay or app menus.
create table public.workforce_partner_onboarding_rules (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 provider_id uuid not null references public.providers(id),
 model_id uuid not null references public.location_models(id),
 designation_id uuid not null references public.designations(id),
 adapter text not null check(adapter in ('amazon','manual')),
 invite_due_days integer not null default 2 check(invite_due_days between 0 and 90),
 progress_due_days integer not null default 2 check(progress_due_days between 0 and 90),
 report_source_type text, report_email_field text not null default 'rabbit_id',
 report_status_field text not null default 'operational_status', report_action_field text not null default 'action_item',
 report_id_field text not null default 'transporter_id',
 status_guidance jsonb not null default '[]'::jsonb check(jsonb_typeof(status_guidance)='array'),
 completed_statuses text[] not null default array['active','activated','completed','provisioned'],
 require_station_email boolean not null default true,
 restrict_dropx_one boolean not null default true,
 is_active boolean not null default true,
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now(),
 unique(company_id,provider_id,model_id,designation_id)
);
alter table public.workforce_partner_onboarding_rules enable row level security;
revoke all on public.workforce_partner_onboarding_rules from public,anon,authenticated;
grant select,insert,update on public.workforce_partner_onboarding_rules to service_role;

create table public.workforce_partner_rule_events(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),rule_id uuid not null references public.workforce_partner_onboarding_rules(id),actor_id uuid not null references auth.users(id),details jsonb not null,created_at timestamptz not null default now());
alter table public.workforce_partner_rule_events enable row level security;
revoke all on public.workforce_partner_rule_events from public,anon,authenticated;
grant select,insert on public.workforce_partner_rule_events to service_role;
create function public.workforce_save_partner_onboarding_rule(p_company uuid,p_actor uuid,p_id uuid,p_version timestamptz,p_rule jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare candidate public.workforce_partner_onboarding_rules; previous public.workforce_partner_onboarding_rules; saved uuid;
begin
 candidate:=jsonb_populate_record(null::public.workforce_partner_onboarding_rules,jsonb_build_object('status_guidance','[]'::jsonb,'invite_due_days',2,'progress_due_days',2,'report_email_field','rabbit_id','report_status_field','operational_status','report_action_field','action_item','report_id_field','transporter_id','completed_statuses',array['active','activated','completed','provisioned'])||p_rule);
 if p_actor is null then raise exception 'Requesting user required'; end if;
 if not exists(select 1 from public.providers where id=candidate.provider_id and company_id=p_company and is_active)
 or not exists(select 1 from public.location_models where id=candidate.model_id and company_id=p_company and is_active)
 or not exists(select 1 from public.designations d join public.designation_categories c on c.id=d.designation_category_id where d.id=candidate.designation_id and d.company_id=p_company and d.is_active and c.people_module='delivery_network') then raise exception 'Choose an active partner, model and Workforce designation in this company'; end if;
 if p_id is not null then
  select * into previous from public.workforce_partner_onboarding_rules where id=p_id and company_id=p_company for update;
  if not found or previous.updated_at is distinct from p_version then raise exception 'Rule changed. Refresh before saving'; end if;
  update public.workforce_partner_onboarding_rules set provider_id=candidate.provider_id,model_id=candidate.model_id,designation_id=candidate.designation_id,adapter=candidate.adapter,status_guidance=candidate.status_guidance,invite_due_days=candidate.invite_due_days,progress_due_days=candidate.progress_due_days,report_source_type=candidate.report_source_type,report_email_field=candidate.report_email_field,report_status_field=candidate.report_status_field,report_action_field=candidate.report_action_field,report_id_field=candidate.report_id_field,completed_statuses=candidate.completed_statuses,require_station_email=candidate.require_station_email,restrict_dropx_one=candidate.restrict_dropx_one,is_active=candidate.is_active,updated_by=p_actor,updated_at=clock_timestamp() where id=p_id returning id into saved;
 else
  insert into public.workforce_partner_onboarding_rules(company_id,provider_id,model_id,designation_id,adapter,require_station_email,restrict_dropx_one,is_active,updated_by,status_guidance,invite_due_days,progress_due_days,report_source_type,report_email_field,report_status_field,report_action_field,report_id_field,completed_statuses) values(p_company,candidate.provider_id,candidate.model_id,candidate.designation_id,candidate.adapter,candidate.require_station_email,candidate.restrict_dropx_one,candidate.is_active,p_actor,candidate.status_guidance,candidate.invite_due_days,candidate.progress_due_days,candidate.report_source_type,candidate.report_email_field,candidate.report_status_field,candidate.report_action_field,candidate.report_id_field,candidate.completed_statuses) returning id into saved;
 end if;
 insert into public.workforce_partner_rule_events(company_id,rule_id,actor_id,details) values(p_company,saved,p_actor,jsonb_build_object('before',to_jsonb(previous),'after',p_rule));
 return saved;
end $$;
revoke all on function public.workforce_save_partner_onboarding_rule(uuid,uuid,uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.workforce_save_partner_onboarding_rule(uuid,uuid,uuid,timestamptz,jsonb) to service_role;

-- Initial requested eligibility only; all future behaviour reads the master rows.
insert into public.workforce_partner_onboarding_rules(company_id,provider_id,model_id,designation_id,adapter,report_source_type)
select distinct s.company_id,s.provider_id,s.location_model_id,d.id,'amazon','da_inapp_onboarding'
from public.stations s
join public.providers p on p.id=s.provider_id and p.company_id=s.company_id
join public.location_models m on m.id=s.location_model_id and m.company_id=s.company_id
join public.designations d on d.company_id=s.company_id and upper(d.code) in ('DA','DCD','ODCD') and d.is_active
join public.designation_categories c on c.id=d.designation_category_id and c.people_module='delivery_network'
where (upper(p.code)='AMAZON' or lower(p.name) like '%amazon%')
 and (upper(m.code) in ('EDSP','XPT') or upper(m.name) in ('AMAZON EDSP','AMAZON XPT','EDSP','XPT'))
on conflict do nothing;

create function public.workforce_station_email_valid(p_email text,p_station_code text)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(length(btrim(p_email))<=254 and btrim(p_email) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 and length(split_part(btrim(p_email),'@',1)) > length(btrim(p_station_code))+1
 and right(lower(split_part(btrim(p_email),'@',1)),length(btrim(p_station_code))+1)='.'||lower(btrim(p_station_code)),false)
$$;

create function public.workforce_validate_partner_email() returns trigger language plpgsql set search_path='' as $$
declare rule public.workforce_partner_onboarding_rules; station public.stations;
begin
 if coalesce(new.compatibility_mode,false) or new.migration_state<>'canonical' then return new; end if;
 if tg_op='UPDATE' and new.email is not distinct from old.email and new.location_id is not distinct from old.location_id and new.designation_id is not distinct from old.designation_id then return new; end if;
 select * into station from public.stations where id=new.location_id and company_id=new.company_id;
 select * into rule from public.workforce_partner_onboarding_rules where company_id=new.company_id and provider_id=station.provider_id and model_id=station.location_model_id and designation_id=new.designation_id and is_active;
 if rule.require_station_email and not public.workforce_station_email_valid(new.email,station.station_code) then
  raise exception 'Email must end with .%@domain, for example name123.%@gmail.com. Use the existing mailbox you created.',lower(station.station_code),lower(station.station_code);
 end if;
 return new;
end $$;
create trigger workforce_partner_email_check before insert on public.workforce for each row execute function public.workforce_validate_partner_email();

create table public.workforce_partner_progress(
 workforce_id uuid primary key references public.workforce(id),company_id uuid not null references public.companies(id),
 reported_on date,manual_invited_on date,updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now()
);
alter table public.workforce_partner_progress enable row level security;
revoke all on public.workforce_partner_progress from public,anon,authenticated;
grant select,insert,update on public.workforce_partner_progress to service_role;
create function public.workforce_record_partner_progress(p_company uuid,p_actor uuid,p_workforce uuid,p_locations uuid[],p_reported date,p_invited date,p_portal text) returns void
language plpgsql security invoker set search_path='' as $$
declare w public.workforce; rule public.workforce_partner_onboarding_rules;
begin
 select * into w from public.workforce where company_id=p_company and id=p_workforce and deleted_at is null for update;
 if not found or p_actor is null then raise exception 'Associate was not found'; end if;
 if p_portal not in ('workforce','ops_pulse','recruit') then raise exception 'Invalid portal'; end if;
 if p_locations is not null and not coalesce(w.location_id=any(p_locations),false) then raise exception 'Outside station scope'; end if;
 if p_portal='recruit' and w.created_by is distinct from p_actor then raise exception 'Only your initiated associates can be updated'; end if;
 select r.* into rule from public.workforce_partner_onboarding_rules r join public.stations s on s.provider_id=r.provider_id and s.location_model_id=r.model_id and s.company_id=r.company_id where s.id=w.location_id and r.company_id=p_company and r.designation_id=w.designation_id and r.is_active;
 if not found then raise exception 'Configure a partner workflow first'; end if;
 if p_reported is null or p_reported>(now() at time zone 'Asia/Kolkata')::date then raise exception 'Enter the actual reporting date, today or earlier'; end if;
 if p_invited is not null and (rule.adapter<>'manual' or w.onboarding_status not in ('under_review','approved','active') or p_invited<p_reported or p_invited>(now() at time zone 'Asia/Kolkata')::date) then raise exception 'Manual invitation date requires completed registration and a manual partner workflow'; end if;
 insert into public.workforce_partner_progress(workforce_id,company_id,reported_on,manual_invited_on,updated_by) values(w.id,p_company,p_reported,p_invited,p_actor) on conflict(workforce_id) do update set reported_on=excluded.reported_on,manual_invited_on=coalesce(excluded.manual_invited_on,public.workforce_partner_progress.manual_invited_on),updated_by=p_actor,updated_at=now();
 insert into public.workforce_joining_events(company_id,workforce_id,event_code,actor_id,details) values(p_company,w.id,'partner_progress_recorded',p_actor,jsonb_build_object('reported_on',p_reported,'manual_invited_on',p_invited,'source_portal',p_portal));
end $$;
revoke all on function public.workforce_record_partner_progress(uuid,uuid,uuid,uuid[],date,date,text) from public,anon,authenticated;
grant execute on function public.workforce_record_partner_progress(uuid,uuid,uuid,uuid[],date,date,text) to service_role;

create index if not exists report_import_partner_station_lookup on public.report_import_rows(company_id,source_type,(upper(btrim(coalesce(station_code,normalized_data->>'station_code',raw_data->>'station_code','')))),work_date desc,created_at desc);
create index if not exists attendance_partner_arrival_lookup on public.attendance_daily(company_id,workforce_id,punch_date) where in_time is not null;
-- Read-only status shared by all products. An Amazon report never creates a mapping.
create function public.workforce_partner_onboarding_state(p_company uuid,p_ids uuid[])
returns table(workforce_id uuid,adapter text,restrict_dropx_one boolean,registration_ready boolean,mapping_confirmed boolean,stage text,label text,instruction text,can_trigger boolean,invitation_status text,report_updated_at timestamptz,station_id uuid,reported_on date,invited_on date,due_kind text,due_since date,transporter_id text,action_item text,report_date date,provider_name text,workflow_rule_id uuid)
language sql stable security invoker set search_path='' as $$
 with evidence as (
 select w.id,r.id workflow_rule_id,w.location_id,w.onboarding_status,r.adapter,r.restrict_dropx_one,r.invite_due_days,r.progress_due_days,r.completed_statuses,p.name provider_name,
  coalesce(progress.reported_on,arrival.reported_on) reported_on,
  coalesce(case when inv.status='sent' then (inv.completed_at at time zone 'Asia/Kolkata')::date end,progress.manual_invited_on) invited_on,
  w.onboarding_status in ('under_review','approved','active') as registered,
  (w.onboarding_status in ('under_review','approved','active')) and exists(select 1 from public.field_executive_provider_mappings m where m.company_id=w.company_id and m.workforce_id=w.id and m.provider_id=s.provider_id and m.station_id=s.id and m.status='active' and nullif(btrim(m.provider_member_id),'') is not null and m.effective_from <= (now() at time zone 'Asia/Kolkata')::date and (m.effective_to is null or m.effective_to >= (now() at time zone 'Asia/Kolkata')::date)) mapped,
  coalesce(inv.status,case when progress.manual_invited_on is not null then 'sent' end) invite_status,cfg.invitation_enabled,
  lower(coalesce(report.normalized_data->>r.report_action_field,report.raw_data->>r.report_action_field,'')) report_action,
  lower(coalesce(report.normalized_data->>r.report_status_field,report.raw_data->>r.report_status_field,'')) report_status,
  least(report.created_at,(report.work_date+1)::timestamp at time zone 'Asia/Kolkata') report_at,report.work_date report_date,coalesce(report.normalized_data->>r.report_id_field,report.raw_data->>r.report_id_field) transporter_id,
  coalesce(custom.step->>'stage',guidance.stage_code) guidance_stage,coalesce(custom.step->>'instruction',guidance.instruction) guidance_instruction,custom.step->>'label' guidance_label
 from public.workforce w
 join public.stations s on s.id=w.location_id and s.company_id=w.company_id
 join public.workforce_partner_onboarding_rules r on r.company_id=w.company_id and r.provider_id=s.provider_id and r.model_id=s.location_model_id and r.designation_id=w.designation_id and r.is_active
 join public.providers p on p.id=s.provider_id and p.company_id=s.company_id
 left join public.workforce_partner_progress progress on progress.workforce_id=w.id and progress.company_id=w.company_id
 left join lateral(select min(a.punch_date) reported_on from public.attendance_daily a where a.company_id=w.company_id and a.workforce_id=w.id and a.in_time is not null) arrival on true
 left join public.workforce_amazon_station_settings cfg on cfg.company_id=w.company_id and cfg.station_id=s.id
 left join lateral(select i.* from public.workforce_amazon_invitation_requests i where r.adapter='amazon' and i.company_id=w.company_id and i.workforce_id=w.id order by i.requested_at desc,i.id desc limit 1) inv on true
 left join lateral(select x.* from public.report_import_rows x where x.company_id=w.company_id and x.source_type=r.report_source_type and (x.work_date is null or x.work_date<=(now() at time zone 'Asia/Kolkata')::date)
  and lower(btrim(coalesce(x.normalized_data->>r.report_email_field,x.raw_data->>r.report_email_field,'')))=lower(btrim(coalesce(inv.amazon_email,w.email)))
  and upper(btrim(coalesce(x.station_code,x.normalized_data->>'station_code',x.raw_data->>'station_code','')))=upper(btrim(s.station_code))
  order by x.work_date desc nulls last,x.created_at desc,x.id desc limit 1) report on true
 left join lateral(select step from jsonb_array_elements(r.status_guidance) with ordinality item(step,priority) where nullif(step->>'match','') is not null and position(lower(step->>'match') in lower(coalesce(report.normalized_data->>r.report_action_field,report.raw_data->>r.report_action_field,'')||' '||coalesce(report.normalized_data->>r.report_status_field,report.raw_data->>r.report_status_field,'')))>0 order by priority limit 1) custom on true
 left join lateral(select g.* from public.workforce_amazon_status_guidance g where r.adapter='amazon' and g.company_id=w.company_id and g.is_active
  and (g.stage_code<>'activated' or lower(g.match_text)=lower(coalesce(report.normalized_data->>r.report_status_field,report.raw_data->>r.report_status_field,'')) or lower(g.match_text)=lower(coalesce(report.normalized_data->>r.report_action_field,report.raw_data->>r.report_action_field,'')))
  and position(lower(g.match_text) in lower(coalesce(report.normalized_data->>r.report_action_field,report.raw_data->>r.report_action_field,'')||' '||coalesce(report.normalized_data->>r.report_status_field,report.raw_data->>r.report_status_field,'')))>0
  order by g.priority,length(g.match_text) desc limit 1) guidance on true
 where w.company_id=p_company and w.id=any(p_ids) and w.deleted_at is null and w.migration_state<>'reclassified' and coalesce(w.lifecycle_status,'') not in ('offboarded','closed','exited','terminated') and coalesce(w.onboarding_status,'') not in ('rejected','cancelled','inactive')
 ), stages as (
 select *,case
 when mapped then 'active'
 when not registered then 'registration_pending'

 when report_status ~ '^(failed|rejected|blocked)$' or report_action ~ '(failed|rejected|insufficiency|mismatch|blocked)' then 'exception'
 when report_status=any(completed_statuses) or report_action like '%no further action required%' or guidance_stage='activated' then 'mapping_pending'
 when report_at is not null then coalesce(guidance_stage,case
  when report_action ~ '(fail|reject|error|insufficien|mismatch|blocked)' then 'exception'
  when report_action ~ '(background|bgc|idfy|video)' then 'background_check'
  when report_action ~ '(learn|course|nsda|nhda)' then 'learning'
  when report_action ~ '(document|aadhaar|aadhar|pan)' then 'documents'
  else 'partner_action_pending' end)
 when adapter='manual' and invite_status is null then 'partner_setup_pending'
 when invite_status='failed' then 'invitation_failed'
 when invite_status='sent' then 'invitation_sent'
 when invite_status in ('queued','processing') then 'triggered'
 else 'id_creation_pending' end state
 from evidence
 )
 select id,adapter,restrict_dropx_one,registered,mapped,state,
 coalesce(case when state not in ('active','registration_pending','mapping_pending','triggered','invitation_sent','invitation_failed','id_creation_pending') then guidance_label end,case state when 'active' then 'Provider mapping confirmed' when 'registration_pending' then 'Complete registration'
 when 'mapping_pending' then 'ID active · mapping pending' when 'triggered' then 'Triggered · invitation pending'
 when 'invitation_sent' then 'Invitation sent · ID setup pending' when 'invitation_failed' then 'Invitation failed'
 when 'id_creation_pending' then 'ID creation pending' when 'background_check' then 'Background / video verification pending'
 when 'learning' then 'Learning course pending' when 'documents' then 'Documents pending'
 when 'partner_setup_pending' then 'Partner ID setup pending' when 'exception' then 'ID setup needs help' else 'Action needed to complete your ID' end),
 case when state='mapping_pending' then 'Your partner ID is ready. Contact your TL or Workforce team to confirm your provider ID mapping.'
 when state='active' then 'Your provider ID mapping is confirmed.'
 when state='registration_pending' then 'Complete your registration. Your station team can then request partner ID creation.'
 when state='partner_setup_pending' then 'Contact your TL or Workforce team to complete this partner’s ID process. Automated invitations are not available for this partner.'
 when state='background_check' then coalesce(guidance_instruction,'Check the verification partner’s WhatsApp message or email. Complete the video verification with your original documents ready.')
 when state='learning' then coalesce(guidance_instruction,'Complete the assigned course in your partner app. Contact your station team if you need access.')
 when state='documents' then coalesce(guidance_instruction,'Open your partner app and complete the pending document uploads.')
 when report_at is not null then coalesce(guidance_instruction,'Your partner account needs attention. Please contact your station team for the next step.')
 when state='invitation_sent' then 'Check your registered station email and complete the partner invitation. Ask your station team if the invitation has not arrived.'
 when state='triggered' then 'Your team has requested the invitation. ID creation is still pending.'
 else 'Your TL or Workforce team will help with the ID invitation.' end,
 registered and not mapped and adapter='amazon' and coalesce(invitation_enabled,false) and state in ('id_creation_pending','invitation_failed'),invite_status,report_at,location_id,reported_on,invited_on,
 case when not mapped and reported_on is not null and invited_on is null and state<>'mapping_pending' and reported_on+invite_due_days<=(now() at time zone 'Asia/Kolkata')::date then 'invitation_due' when not mapped and invited_on is not null and invited_on+progress_due_days<=(now() at time zone 'Asia/Kolkata')::date then 'progress_due' end,
 case when not mapped and reported_on is not null and invited_on is null and state<>'mapping_pending' and reported_on+invite_due_days<=(now() at time zone 'Asia/Kolkata')::date then reported_on+invite_due_days when not mapped and invited_on is not null and invited_on+progress_due_days<=(now() at time zone 'Asia/Kolkata')::date then invited_on+progress_due_days end,transporter_id,report_action,report_date,provider_name,workflow_rule_id
 from stages
$$;

revoke all on function public.workforce_partner_onboarding_state(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_partner_onboarding_state(uuid,uuid[]) to service_role;
revoke all on function public.workforce_station_email_valid(text,text) from public,anon,authenticated;
grant execute on function public.workforce_station_email_valid(text,text) to service_role;
create or replace function public.workforce_queue_amazon_invitation(
  p_company uuid,p_actor uuid,p_actor_name text,p_workforce uuid,p_email text,p_source_portal text,p_locations uuid[]
) returns uuid language plpgsql security invoker set search_path='' as $$
declare w public.workforce; s public.stations; cfg public.workforce_amazon_station_settings; request_id uuid; expected text; first_name text; last_name text; flow record;
begin
  select * into w from public.workforce where id=p_workforce and company_id=p_company and deleted_at is null and migration_state<>'reclassified' for update;
  if not found or p_actor is null then raise exception 'Associate or requesting user was not found'; end if;
  select * into flow from public.workforce_partner_onboarding_state(p_company,array[p_workforce]);
  if not found or flow.adapter<>'amazon' then raise exception 'Amazon ID creation is not enabled for this partner, model and designation'; end if;
  if not flow.registration_ready then raise exception 'Complete registration before creating the partner ID'; end if;
  if flow.mapping_confirmed or flow.stage='mapping_pending' then raise exception 'Partner ID is already ready. Complete or review the provider mapping'; end if;
  if p_source_portal='recruit' and w.created_by is distinct from p_actor then raise exception 'Recruit can trigger only associates invited by this user'; end if;
  if p_locations is not null and (w.location_id is null or not(w.location_id=any(p_locations))) then raise exception 'Associate is outside your station scope'; end if;
  select * into s from public.stations where id=w.location_id and company_id=p_company;
  select * into cfg from public.workforce_amazon_station_settings where station_id=w.location_id and company_id=p_company;
  if cfg.station_id is null or not cfg.invitation_enabled then raise exception 'Complete and enable the Amazon station invitation master first'; end if;
  if p_source_portal not in ('workforce','ops_pulse','recruit') then raise exception 'Choose a valid source portal'; end if;
  expected:=lower(btrim(w.email));
  if lower(btrim(p_email)) is distinct from expected then raise exception 'Use the email saved on the registration'; end if;
  if exists(select 1 from public.workforce_partner_onboarding_rules where company_id=p_company and provider_id=s.provider_id and model_id=s.location_model_id and designation_id=w.designation_id and is_active and require_station_email) and not public.workforce_station_email_valid(expected,s.station_code) then raise exception 'Registration email must end with .%@domain',lower(s.station_code); end if;
  select id into request_id from public.workforce_amazon_invitation_requests where company_id=p_company and workforce_id=w.id and status in ('queued','processing','sent') limit 1;
  if request_id is not null then return request_id; end if;
  if not flow.can_trigger then raise exception 'ID setup is already in progress. Complete the reported pending step instead of sending another invitation'; end if;
  first_name:=split_part(btrim(w.full_name),' ',1);
  last_name:=nullif(btrim(regexp_replace(btrim(w.full_name),'^[^ ]+ *','')),'');
  insert into public.workforce_amazon_invitation_requests(company_id,workforce_id,station_id,source_portal,amazon_email,first_name,last_name,requested_by)
    values(p_company,p_workforce,w.location_id,p_source_portal,expected,first_name,last_name,p_actor) returning id into request_id;
  insert into public.workforce_joining_plans(workforce_id,company_id,station_id,mode,eligible_from,daily_rate,minimum_minutes,terms_reference,terms_accepted_on,provider_stage,contact_email,invitation_first_name,invitation_last_name,version,updated_by)
    values(w.id,p_company,w.location_id,'direct',coalesce(w.date_of_join,(now() at time zone 'Asia/Kolkata')::date),null,1,'Amazon ID activation',coalesce(w.date_of_join,(now() at time zone 'Asia/Kolkata')::date),'email_setup',expected,first_name,last_name,1,p_actor)
    on conflict(workforce_id) do update set contact_email=excluded.contact_email,invitation_first_name=excluded.invitation_first_name,invitation_last_name=excluded.invitation_last_name,provider_stage='email_setup',version=public.workforce_joining_plans.version+1,updated_by=p_actor,updated_at=now();
  insert into public.workforce_joining_events(company_id,workforce_id,event_code,actor_id,actor_name,details)
    values(p_company,w.id,'amazon_invitation_queued',p_actor,coalesce(nullif(btrim(p_actor_name),''),'Workforce'),jsonb_build_object('request_id',request_id,'source_portal',p_source_portal,'amazon_email',expected));
  return request_id;
end $$;
revoke all on function public.workforce_queue_amazon_invitation(uuid,uuid,text,uuid,text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_queue_amazon_invitation(uuid,uuid,text,uuid,text,text,uuid[]) to service_role;


-- Retry must apply the same registration, scope and model policy as first send.
create or replace function public.workforce_retry_amazon_invitation(p_company uuid,p_actor uuid,p_request uuid,p_locations uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare r public.workforce_amazon_invitation_requests; w public.workforce; flow record;
begin
 select * into r from public.workforce_amazon_invitation_requests where id=p_request and company_id=p_company for update;
 if not found or r.status<>'failed' or p_actor is null then raise exception 'Only a failed invitation can be retried'; end if;
 select * into w from public.workforce where id=r.workforce_id and company_id=p_company for update;
 if p_locations is not null and (w.location_id is null or not(w.location_id=any(p_locations))) then raise exception 'Associate is outside your station scope'; end if;
 select * into flow from public.workforce_partner_onboarding_state(p_company,array[w.id]);
 if not found or not flow.can_trigger then raise exception 'This associate is not eligible for an Amazon invitation retry'; end if;
 if w.location_id is distinct from r.station_id or lower(btrim(w.email)) is distinct from r.amazon_email then raise exception 'Station or email changed. Cancel this old request before creating a new invitation'; end if;
 update public.workforce_amazon_invitation_requests set status='queued',requested_by=p_actor,requested_at=now(),claimed_at=null,claimed_by=null,completed_at=null,error_code=null,error_message=null,updated_at=now() where id=r.id;
end $$;
-- Remove the legacy requirement for a generated mailbox pattern.
DO $$ declare definition text; begin
 select pg_get_functiondef('public.workforce_save_amazon_station(uuid,uuid,text,uuid,integer,jsonb,uuid[])'::regprocedure) into definition;
 definition:=replace(definition,'if candidate.invitation_enabled and candidate.associate_email_pattern is null then raise exception ''Configure the associate email pattern before enabling invitations''; end if;','');
 execute definition;
end $$;
-- Orphan provider IDs remain visible across the whole imported history, not only this month.
create function public.workforce_unmapped_provider_ids(p_company uuid,p_locations uuid[])
returns table(provider_id uuid,provider_name text,provider_member_id text,source_name text,station_code text,first_seen date,last_seen date,daily_rows bigint,deliveries numeric)
language sql stable security invoker set search_path='' as $$
 select s.provider_id,p.name::text,d.provider_employee_id::text,max(d.provider_employee_name)::text,s.station_code::text,min(d.work_date),max(d.work_date),count(*),sum(coalesce(d.total_delivery,0))::numeric
 from public.cps_shipment_daily d
 join public.stations s on s.company_id=d.company_id and upper(s.station_code)=upper(d.station_code)
 join public.providers p on p.id=s.provider_id and p.company_id=s.company_id
 where d.company_id=p_company and nullif(btrim(d.provider_employee_id),'') is not null
 and (p_locations is null or s.id=any(p_locations))
 and not exists(select 1 from public.field_executive_provider_mappings m where m.company_id=p_company and m.provider_id=s.provider_id and m.provider_member_id=d.provider_employee_id and m.workforce_id is not null and m.status<>'cancelled')
 group by s.provider_id,p.name,d.provider_employee_id,s.station_code
 order by max(d.work_date) desc,d.provider_employee_id
$$;
revoke all on function public.workforce_unmapped_provider_ids(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_unmapped_provider_ids(uuid,uuid[]) to service_role;
commit;
