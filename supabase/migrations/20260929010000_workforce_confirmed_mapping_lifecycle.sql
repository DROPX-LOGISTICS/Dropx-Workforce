-- Keep the lifecycle aligned with human-confirmed, date-effective mappings.
-- A matched partner onboarding report is evidence the partner process has started.
-- A missing historical invitation log must not become a false invitation-overdue alert.
-- Preserve pending report follow-up; only a recorded sent date starts its two-day clock.
create or replace function public.workforce_partner_onboarding_state(p_company uuid,p_ids uuid[])
returns table(workforce_id uuid,adapter text,restrict_dropx_one boolean,registration_ready boolean,mapping_confirmed boolean,stage text,label text,instruction text,can_trigger boolean,invitation_status text,report_updated_at timestamptz,station_id uuid,reported_on date,invited_on date,due_kind text,due_since date,transporter_id text,action_item text,report_date date,provider_name text,workflow_rule_id uuid)
language sql stable security invoker set search_path='' as $$
 with evidence as (
 select w.id,r.id workflow_rule_id,w.location_id,w.onboarding_status,r.adapter,r.restrict_dropx_one,r.invite_due_days,r.progress_due_days,r.completed_statuses,p.name provider_name,
  coalesce(progress.reported_on,arrival.reported_on) reported_on,
  coalesce(case when inv.status='sent' then (inv.completed_at at time zone 'Asia/Kolkata')::date end,progress.manual_invited_on) invited_on,
  w.onboarding_status in ('under_review','approved','active') as registered,
  (w.onboarding_status in ('approved','active')) and exists(select 1 from public.field_executive_provider_mappings m where m.company_id=w.company_id and m.workforce_id=w.id and m.provider_id=s.provider_id and m.station_id=s.id and m.status<>'cancelled' and nullif(btrim(m.provider_member_id),'') is not null and m.effective_from <= (now() at time zone 'Asia/Kolkata')::date and (m.effective_to is null or m.effective_to >= (now() at time zone 'Asia/Kolkata')::date)) mapped,
  exists(select 1 from public.field_executive_provider_mappings prior where prior.company_id=w.company_id and prior.workforce_id=w.id and prior.provider_id=s.provider_id and prior.station_id=s.id and prior.status<>'cancelled' and nullif(btrim(prior.provider_member_id),'') is not null) had_mapping,
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
 where w.company_id=p_company and w.id=any(p_ids) and w.deleted_at is null and w.migration_state<>'reclassified' and coalesce(w.lifecycle_status,'') not in ('offboarded','closed','exited','terminated','resigned','settled','inactive') and coalesce(w.onboarding_status,'') not in ('rejected','cancelled','inactive')
 ), stages as (
 select *,case
 when mapped then 'active'
 when not registered then 'registration_pending'

 when report_status ~ '^(failed|rejected|blocked)$' or report_action ~ '(failed|rejected|insufficiency|mismatch|blocked)' then 'exception'
 when had_mapping or report_status=any(completed_statuses) or report_action like '%no further action required%' or guidance_stage='activated' then 'mapping_pending'
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
 when 'mapping_pending' then case when had_mapping then 'Review ID & rate period' else 'ID active · mapping pending' end when 'triggered' then 'Triggered · invitation pending'
 when 'invitation_sent' then 'Invitation sent · ID setup pending' when 'invitation_failed' then 'Invitation failed'
 when 'id_creation_pending' then 'ID creation pending' when 'background_check' then 'Background / video verification pending'
 when 'learning' then 'Learning course pending' when 'documents' then 'Documents pending'
 when 'partner_setup_pending' then 'Partner ID setup pending' when 'exception' then 'ID setup needs help' else 'Action needed to complete your ID' end),
 case when state='mapping_pending' then case when had_mapping then 'Your provider mapping needs review for the current assignment or dates. Contact your TL or Workforce team.' else 'Your partner ID is ready. Contact your TL or Workforce team to confirm your provider ID mapping.' end
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
 case when not mapped and reported_on is not null and invited_on is null and report_at is null and state<>'mapping_pending' and reported_on+invite_due_days<=(now() at time zone 'Asia/Kolkata')::date then 'invitation_due' when not mapped and invited_on is not null and invited_on+progress_due_days<=(now() at time zone 'Asia/Kolkata')::date then 'progress_due' end,
 case when not mapped and reported_on is not null and invited_on is null and report_at is null and state<>'mapping_pending' and reported_on+invite_due_days<=(now() at time zone 'Asia/Kolkata')::date then reported_on+invite_due_days when not mapped and invited_on is not null and invited_on+progress_due_days<=(now() at time zone 'Asia/Kolkata')::date then invited_on+progress_due_days end,transporter_id,report_action,report_date,provider_name,workflow_rule_id
 from stages
$$;

-- A user's explicit ID-and-rate save is the confirmation. Imported evidence alone never maps.
-- Current bounded periods are valid; a future period must not activate an associate early.
create or replace function public.workforce_save_joining_mapping(p_company uuid,p_actor uuid,p_workforce uuid,p_mapping uuid,p_dropx text,p_payload jsonb,p_locations uuid[],p_actor_name text)
returns void language plpgsql security invoker set search_path='' as $$
declare person public.workforce; today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
 select * into person from public.workforce where company_id=p_company and id=p_workforce and deleted_at is null and migration_state<>'reclassified' for update;
 if p_actor is null or person.id is null then raise exception 'An authenticated reviewer and valid Workforce associate are required';end if;
 if coalesce(person.onboarding_status,'') not in ('approved','active') or person.last_working_date<today or coalesce(person.lifecycle_status,'') in ('offboarded','closed','exited','terminated','resigned','settled','inactive') then raise exception 'Approve the registration before confirming the provider ID and rates';end if;
 perform public.workforce_save_mapping(p_company,p_actor,p_workforce,p_mapping,p_dropx,p_payload,p_locations);
 if nullif(btrim(p_payload->>'provider_member_id'),'') is not null and nullif(p_payload->>'payment_method_id','') is not null
    and coalesce(p_payload->>'status','')<>'cancelled'
    and (p_payload->>'effective_from')::date<=today
    and (nullif(p_payload->>'effective_to','') is null or (p_payload->>'effective_to')::date>=today) then
  update public.workforce set onboarding_status='active',is_active=true,lifecycle_status='active',provider_id_status='created',provider_employee_id=p_payload->>'provider_member_id',updated_at=now()
   where id=p_workforce and company_id=p_company and onboarding_status='approved';
 end if;
 insert into public.workforce_joining_events(company_id,workforce_id,event_code,actor_id,actor_name,details)
 values(p_company,p_workforce,'provider_mapping_saved',p_actor,coalesce(nullif(btrim(p_actor_name),''),'Workforce mapping reviewer'),jsonb_build_object('effective_from',p_payload->>'effective_from','effective_to',p_payload->>'effective_to','provider_id',p_payload->>'provider_id','provider_member_id',p_payload->>'provider_member_id','station_id',p_payload->>'station_id'));
end $$;
revoke all on function public.workforce_save_joining_mapping(uuid,uuid,uuid,uuid,text,jsonb,uuid[],text) from public,anon,authenticated;
grant execute on function public.workforce_save_joining_mapping(uuid,uuid,uuid,uuid,text,jsonb,uuid[],text) to service_role;
