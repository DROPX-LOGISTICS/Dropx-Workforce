begin;
-- Service-only, audited controls for the expressly approved beta candidate.
-- No canonical Workforce, payroll, identity verification or provider-status writes.
create function public.workforce_beta_admin_action(
 p_company uuid,p_candidate uuid,p_actor uuid,p_locations uuid[],p_action text,
 p_expected_updated_at timestamptz,p_reason text,p_data jsonb default '{}'
) returns void language plpgsql security invoker set search_path='' as $$
declare c public.workforce_amazon_email_pilot_candidates;
 r public.workforce_amazon_email_pilot_registrations; previous jsonb; changes jsonb='{}';
 name_value text; mobile_value text;
begin
 if p_company<>'43866344-b550-4e8a-9a2d-9d23f3d8a997'::uuid or p_candidate<>'4732e7e3-df91-4c8b-8ea4-0ed77f382313'::uuid or p_company is null or p_candidate is null then
  raise exception 'Lifecycle controls are limited to the current beta';
 end if;
 if p_actor is null or length(btrim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Add a reason of 5–1000 characters'; end if;
 if p_action is null or p_action not in ('edit_contact','confirm_registration','return_registration','archive','restore','note') then raise exception 'Unsupported action'; end if;
 select * into c from public.workforce_amazon_email_pilot_candidates where company_id=p_company and id=p_candidate for update;
 if not found then raise exception 'Beta candidate unavailable'; end if;
 if p_locations is not null and not coalesce(c.station_id=any(p_locations),false) then raise exception 'Station outside your access'; end if;
 if p_expected_updated_at is null or c.updated_at is distinct from p_expected_updated_at then raise exception 'This record changed. Refresh before saving'; end if;
 if c.closed_at is not null and p_action not in ('restore','note') then raise exception 'Restore the pilot before editing'; end if;
 if p_action='edit_contact' then
  name_value=btrim(coalesce(p_data->>'full_name',''));mobile_value=btrim(coalesce(p_data->>'mobile',''));
  if length(name_value) not between 2 and 120 or mobile_value !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a full name and a valid 10-digit Indian mobile number'; end if;
  if exists(select 1 from public.workforce_amazon_email_pilot_candidates where company_id=p_company and id<>p_candidate and closed_at is null and mobile=mobile_value) then raise exception 'Another open beta candidate uses this mobile'; end if;
  changes=jsonb_build_object('before',jsonb_build_object('full_name',c.full_name,'mobile',c.mobile),'after',jsonb_build_object('full_name',name_value,'mobile',mobile_value));
  update public.workforce_amazon_email_pilot_candidates set full_name=name_value,mobile=mobile_value,updated_at=clock_timestamp() where id=c.id and company_id=p_company;
 elsif p_action in ('confirm_registration','return_registration') then
  select * into r from public.workforce_amazon_email_pilot_registrations where company_id=p_company and candidate_id=p_candidate for update;
  if not found or r.status not in ('submitted','confirmed') then raise exception 'Only a submitted registration can be reviewed'; end if;
  if coalesce(p_data->>'registration_version','')='' or r.updated_at is distinct from (p_data->>'registration_version')::timestamptz then raise exception 'Registration changed. Refresh before reviewing'; end if;
  if p_action='confirm_registration' and r.status='confirmed' then raise exception 'Registration already reviewed'; end if;
  changes=jsonb_build_object('before',r.status,'after',case when p_action='confirm_registration' then 'confirmed' else 'returned' end);
  update public.workforce_amazon_email_pilot_registrations set
   status=case when p_action='confirm_registration' then 'confirmed' else 'returned' end,
   confirmed_at=case when p_action='confirm_registration' then now() else null end,
   returned_at=case when p_action='return_registration' then now() else null end,
   return_note=case when p_action='return_registration' then btrim(p_reason) else null end,updated_at=clock_timestamp()
   where candidate_id=p_candidate and company_id=p_company;
 elsif p_action='archive' then
  if exists(select 1 from public.workforce_amazon_invitation_requests where company_id=p_company and email_pilot_candidate_id=p_candidate and status in ('queued','processing')) then raise exception 'Wait for the invitation request to finish before archiving'; end if;
  if exists(select 1 from public.workforce_amazon_email_pilot_exit_requests where company_id=p_company and candidate_id=p_candidate and status in ('queued','processing')) then raise exception 'Wait for the exit request to finish before archiving'; end if;
  if exists(select 1 from public.workforce_beta_verification_cases where company_id=p_company and candidate_id=p_candidate and (status='offboarding' or mail_status in ('queued','processing'))) then raise exception 'Wait for background actions to finish before archiving'; end if;
  changes=jsonb_build_object('previous_status',c.status,'previous_inbox_status',c.inbox_status);
  update public.workforce_amazon_email_pilot_candidates set status='closed',closed_at=now(),close_reason=btrim(p_reason),inbox_status='suspended',updated_at=clock_timestamp() where id=c.id and company_id=p_company;
 elsif p_action='restore' then
  if c.closed_at is null then raise exception 'Pilot is already open'; end if;
  if c.continuation_status='not_continuing' or exists(select 1 from public.workforce_amazon_email_pilot_exit_requests where company_id=p_company and candidate_id=p_candidate and status<>'cancelled') or exists(select 1 from public.workforce_beta_verification_snapshots where company_id=p_company and candidate_id=p_candidate and operational_status='OFFBOARDED') or exists(select 1 from public.workforce_beta_verification_cases where company_id=p_company and candidate_id=p_candidate and status in ('offboarding','offboarded')) then raise exception 'An exit or offboarding record needs review; restoration cannot reactivate an Amazon ID'; end if;
  select detail->'changes' into previous from public.workforce_beta_verification_events where company_id=p_company and candidate_id=p_candidate and event='admin_archive' order by created_at desc limit 1;
  if previous is null or (previous->>'previous_status') not in ('ready','sent','failed','email_received') or (previous->>'previous_inbox_status') not in ('reserved','routed','receiving','route_failed') then raise exception 'No safe archive snapshot is available for restoration'; end if;
  changes=previous;
  update public.workforce_amazon_email_pilot_candidates set status=previous->>'previous_status',inbox_status=previous->>'previous_inbox_status',closed_at=null,close_reason=null,updated_at=clock_timestamp() where id=c.id and company_id=p_company;
 end if;
 -- Touching the candidate serializes admin edits with each other, including notes/reviews.
 if p_action in ('note','confirm_registration','return_registration') then update public.workforce_amazon_email_pilot_candidates set updated_at=clock_timestamp() where id=c.id and company_id=p_company; end if;
 insert into public.workforce_beta_verification_events(company_id,candidate_id,event,detail)
 values(p_company,p_candidate,'admin_'||p_action,jsonb_build_object('actor_id',p_actor,'reason',btrim(p_reason),'changes',changes));
end $$;
revoke all on function public.workforce_beta_admin_action(uuid,uuid,uuid,uuid[],text,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.workforce_beta_admin_action(uuid,uuid,uuid,uuid[],text,timestamptz,text,jsonb) to service_role;
commit;
