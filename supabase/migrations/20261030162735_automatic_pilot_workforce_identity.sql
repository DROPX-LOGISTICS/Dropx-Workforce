-- Internal reconciliation, called by the existing authenticated Workforce cron.
-- No rollout or employee data is changed by applying this migration.
create or replace function public.reconcile_amazon_pilot_identity(p_company uuid,p_candidate uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 c public.workforce_amazon_email_pilot_candidates;
 r public.workforce_amazon_email_pilot_registrations;
 s public.workforce_beta_verification_snapshots;
 w public.workforce;
 st public.stations;
 d public.designations;
 numeric_ids text[];
 provider_number text;
 code text;
 created boolean:=false;
begin
 perform pg_advisory_xact_lock(hashtextextended('pilot-identity:'||p_company::text,0));
 select * into c from public.workforce_amazon_email_pilot_candidates where company_id=p_company and id=p_candidate for update;
 if not found or c.closed_at is not null or c.continuation_status is distinct from 'continuing' or c.inbox_status='suspended' then return jsonb_build_object('status','not_eligible');end if;
 select * into r from public.workforce_amazon_email_pilot_registrations where company_id=p_company and candidate_id=c.id;
 if r.status is null or r.status not in ('submitted','confirmed') or r.submitted_at is null then return jsonb_build_object('status','registration_pending');end if;
 select * into s from public.workforce_beta_verification_snapshots where company_id=p_company and candidate_id=c.id;
 if s.operational_status is distinct from 'ACTIVE' or nullif(s.driver_id,'') is null or lower(s.identity_email) is distinct from lower(c.alias_email)
 or s.lsc_observed_at is null or s.lsc_observed_at<now()-interval '24 hours' or s.lsc_observed_at>now()+interval '5 minutes'
 or not exists(select 1 from public.workforce_amazon_invitation_requests where company_id=p_company and email_pilot_candidate_id=c.id and external_reference=s.amazon_profile_id)
 or exists(select 1 from public.workforce_beta_verification_cases where company_id=p_company and candidate_id=c.id and status='offboarded')
 then return jsonb_build_object('status','source_confirmation_pending');end if;
 select * into strict st from public.stations where id=c.station_id and company_id=p_company;
 select * into strict d from public.designations where id=c.designation_id and company_id=p_company;
 select * into w from public.workforce where company_id=p_company and id=c.id;
 if w.id is not null and (w.deleted_at is not null or w.biometric_id is distinct from c.biometric_id or w.location_id is distinct from c.station_id or w.source_profile_id is distinct from c.id or w.source_profile_type is distinct from 'canonical' or lower(w.email) is distinct from lower(c.alias_email)) then return jsonb_build_object('status','identity_conflict');end if;
 if w.id is null and (c.duplicate_identity_detected or exists(select 1 from public.workforce where company_id=p_company and (biometric_id=c.biometric_id or lower(email)=lower(c.alias_email)))) then return jsonb_build_object('status','identity_review_required');end if;
 -- SCC provides an explicit transporter-to-payroll-ID crosswalk. Never match names.
 select array_agg(distinct j->>'employeeId') into numeric_ids
 from public.workforce_route_scc_snapshots x cross join lateral jsonb_array_elements(x.drivers) j
 where x.company_id=p_company and x.station_id=c.station_id and x.observed_at>=now()-interval '48 hours'
 and j->>'tasId'=s.driver_id and j->>'employeeId' ~ '^[0-9]+$';
 if cardinality(numeric_ids)>1 then return jsonb_build_object('status','identity_conflict');end if;
 provider_number:=coalesce(numeric_ids[1],nullif(w.provider_employee_id,''));
 if w.provider_employee_id is not null and provider_number is distinct from w.provider_employee_id then return jsonb_build_object('status','identity_conflict');end if;
 if exists(select 1 from public.workforce_amazon_portal_links where company_id=p_company and ((transporter_id=s.driver_id and workforce_id<>c.id) or (workforce_id=c.id and (transporter_id is distinct from s.driver_id or amazon_provider_id is distinct from s.amazon_profile_id or lower(amazon_email) is distinct from lower(c.alias_email)))))
 or exists(select 1 from public.workforce where company_id=p_company and id<>c.id and provider_employee_id=provider_number)
 or exists(select 1 from public.field_executive_provider_mappings where company_id=p_company and provider_member_id=provider_number and status<>'cancelled' and workforce_id is distinct from c.id)
 then return jsonb_build_object('status','identity_conflict');end if;
 if w.id is null then
 code:=public.generate_dropx_worker_id(p_company,'field_executive',c.station_id,st.location_model_id,c.designation_id);
 if nullif(code,'') is null then raise exception 'Employee ID configuration missing';end if;
 insert into public.workforce(id,company_id,full_name,mobile,email,date_of_join,location_id,designation_id,designation,biometric_id,dropx_id,
 source_profile_type,source_profile_id,compatibility_mode,migration_state,is_active,onboarding_status,lifecycle_status,approval_required,
 onboarding_submitted_at,provider_id_status,provider_employee_id,onboarding_application_source,onboarding_source_detail,station_email_exception_note,created_by)
 values(c.id,p_company,c.full_name,c.mobile,c.alias_email,c.reported_on,c.station_id,c.designation_id,d.name,c.biometric_id,code,
 'canonical',c.id,false,'canonical',false,'under_review','onboarding',true,r.submitted_at,'created',provider_number,'workforce','Automatic Amazon email onboarding identity','Preserve the verified Amazon invitation mailbox.',c.created_by);
 created:=true;
 insert into public.workforce_beta_verification_events(company_id,candidate_id,event,detail)
 values(p_company,c.id,'workforce_identity_created',jsonb_build_object('dropx_id',code,'driver_id',s.driver_id,'source','automatic_exact_identity','registration_review','pending','payment_scheme','not_configured'));
 elsif w.provider_employee_id is null and provider_number is not null then
 update public.workforce set provider_employee_id=provider_number where company_id=p_company and id=c.id and provider_employee_id is null;
 end if;
 insert into public.workforce_amazon_portal_links(company_id,workforce_id,amazon_provider_id,amazon_email,transporter_id,station_mapped,last_synced_at)
 values(p_company,c.id,s.amazon_profile_id,c.alias_email,s.driver_id,false,s.lsc_observed_at)
 on conflict(company_id,workforce_id) do nothing;
 if provider_number is not null and not exists(select 1 from public.workforce_beta_verification_events where company_id=p_company and candidate_id=c.id and event='provider_identity_linked' and detail->>'provider_employee_id'=provider_number) then
 insert into public.workforce_beta_verification_events(company_id,candidate_id,event,detail)
 values(p_company,c.id,'provider_identity_linked',jsonb_build_object('provider_employee_id',provider_number,'driver_id',s.driver_id,'source',case when numeric_ids[1] is not null then 'scc_exact_crosswalk' else 'persisted_verified_identity' end));end if;
 return jsonb_build_object('status',case when provider_number is null then 'awaiting_scc_identity' else 'identity_linked' end,'created',created,'dropx_id',coalesce(code,w.dropx_id),'provider_employee_id',provider_number,'payment_configured',exists(select 1 from public.field_executive_provider_mappings where company_id=p_company and workforce_id=c.id and provider_member_id=provider_number and station_id=c.station_id and status='active' and payment_method_id is not null and effective_from<=current_date and (effective_to is null or effective_to>=current_date)));
end $$;
revoke all on function public.reconcile_amazon_pilot_identity(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_amazon_pilot_identity(uuid,uuid) to service_role;
