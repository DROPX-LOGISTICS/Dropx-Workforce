begin;
create table public.workforce_partner_reminder_rules(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 workflow_rule_id uuid not null references public.workforce_partner_onboarding_rules(id),
 stage_code text not null,station_id uuid references public.stations(id),
 whatsapp_profile_id uuid not null references public.whatsapp_profiles(id),template_id text not null,
 variable_mappings jsonb not null default '{}'::jsonb,
 repeat_hours integer not null check(repeat_hours between 1 and 720),max_per_step integer not null check(max_per_step between 1 and 100),
 report_max_age_hours integer not null check(report_max_age_hours between 1 and 720),
 send_hour_start integer not null check(send_hour_start between 0 and 23),send_hour_end integer not null check(send_hour_end between 1 and 24 and send_hour_end>send_hour_start),
 is_active boolean not null default false,updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now()
);
create unique index workforce_partner_reminder_scope on public.workforce_partner_reminder_rules(company_id,workflow_rule_id,stage_code,coalesce(station_id,'00000000-0000-0000-0000-000000000000'::uuid));
create table public.workforce_partner_reminder_events(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 rule_id uuid not null references public.workforce_partner_reminder_rules(id),workforce_id uuid not null references public.workforce(id),
 stage_code text not null,campaign_id uuid not null references public.whatsapp_campaigns(id),report_updated_at timestamptz,created_at timestamptz not null default now()
);
alter table public.workforce_partner_reminder_rules enable row level security;
alter table public.workforce_partner_reminder_events enable row level security;
revoke all on public.workforce_partner_reminder_rules,public.workforce_partner_reminder_events from public,anon,authenticated;
grant select,insert,update on public.workforce_partner_reminder_rules to service_role;
grant select,insert on public.workforce_partner_reminder_events to service_role;

create function public.workforce_queue_partner_reminders(p_company uuid) returns integer
language plpgsql security invoker set search_path='' as $$
declare reminder record; candidate record; campaign uuid; total integer:=0; latest timestamptz; sent_count integer;
begin
 -- Serialise all scheduler/manual ticks per company; campaign+recipient+ledger are atomic.
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||':partner_reminders',0));
 if not exists(select 1 from public.whatsapp_settings where company_id=p_company and is_enabled) then return 0; end if;
 for reminder in select r.*,t.name template_name,t.language template_language,p.profile_name
 from public.workforce_partner_reminder_rules r
 join public.whatsapp_template_cache t on t.company_id=r.company_id and t.template_id=r.template_id and t.whatsapp_profile_id=r.whatsapp_profile_id and t.status='APPROVED'
 join public.whatsapp_profiles p on p.id=r.whatsapp_profile_id and p.company_id=r.company_id and p.is_active
 where r.company_id=p_company and r.is_active
 and extract(hour from now() at time zone 'Asia/Kolkata')>=r.send_hour_start and extract(hour from now() at time zone 'Asia/Kolkata')<r.send_hour_end
 loop
  for candidate in select w.*,s.station_code,flow.stage,flow.label,flow.instruction,flow.report_updated_at
  from public.workforce w join public.stations s on s.id=w.location_id and s.company_id=w.company_id
  cross join lateral public.workforce_partner_onboarding_state(p_company,array[w.id]) flow
  where w.company_id=p_company and not flow.mapping_confirmed and flow.registration_ready
  and flow.workflow_rule_id=reminder.workflow_rule_id and flow.stage=reminder.stage_code and flow.report_updated_at >= now()-make_interval(hours=>reminder.report_max_age_hours)
  and (reminder.station_id is null or reminder.station_id=w.location_id)
  and not exists(select 1 from public.workforce_partner_reminder_rules specific where reminder.station_id is null and specific.company_id=p_company and specific.workflow_rule_id=reminder.workflow_rule_id and specific.stage_code=reminder.stage_code and specific.station_id=w.location_id and specific.is_active)
  and nullif(btrim(w.mobile),'') is not null
  loop
   select count(*),max(created_at) into sent_count,latest from public.workforce_partner_reminder_events where company_id=p_company and workforce_id=candidate.id and rule_id=reminder.id and stage_code=candidate.stage;
   if sent_count>=reminder.max_per_step or latest>now()-make_interval(hours=>reminder.repeat_hours) then continue; end if;
   insert into public.whatsapp_campaigns(company_id,source_mode,whatsapp_profile_id,whatsapp_profile_name,template_id,template_name,template_language,variable_mappings,total_count,sent_count,failed_count,pending_count,status,created_by)
   values(p_company,'workforce',reminder.whatsapp_profile_id,reminder.profile_name,reminder.template_id,reminder.template_name,reminder.template_language,reminder.variable_mappings,1,0,0,1,'queued',reminder.updated_by) returning id into campaign;
   insert into public.whatsapp_campaign_recipients(campaign_id,company_id,row_no,recipient_name,recipient_mobile,country_code,source,source_id,recipient_payload,status)
   values(campaign,p_company,1,candidate.full_name,candidate.mobile,candidate.mobile_country_code,'workforce',candidate.id::text,
   jsonb_build_object('name',candidate.full_name,'full_name',candidate.full_name,'mobile',candidate.mobile,'country_code',candidate.mobile_country_code,'dropx_id',candidate.dropx_id,'email',candidate.email,'location',candidate.station_code,'pending_step',candidate.label,'instruction',candidate.instruction,'partner_reminder_rule_id',reminder.id,'partner_reminder_stage',candidate.stage),'pending');
   insert into public.workforce_partner_reminder_events(company_id,rule_id,workforce_id,stage_code,campaign_id,report_updated_at) values(p_company,reminder.id,candidate.id,candidate.stage,campaign,candidate.report_updated_at);
   total:=total+1;
  end loop;
 end loop;
 return total;
end $$;
revoke all on function public.workforce_queue_partner_reminders(uuid) from public,anon,authenticated;
grant execute on function public.workforce_queue_partner_reminders(uuid) to service_role;
commit;
