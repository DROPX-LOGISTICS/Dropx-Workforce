begin;

-- A mobile overlap represents a known person, not an automatic rejection. The
-- Workforce user must explicitly confirm a different-designation engagement;
-- the shared identity trigger then records the exception for lifecycle review.
create or replace function public.workforce_create_amazon_pilot(p_company uuid,p_actor uuid,p_data jsonb,p_locations uuid[])
returns uuid language plpgsql security invoker set search_path='' as $$
declare
 wid uuid := (p_data->>'id')::uuid;
 sid uuid := (p_data->>'station_id')::uuid;
 did uuid := (p_data->>'designation_id')::uuid;
 role_name text;
 v_mobile text := p_data->>'mobile';
 v_email text := lower(btrim(p_data->>'email'));
 reported date := (p_data->>'reported_on')::date;
 identity_evaluation jsonb;
 exact_matches jsonb;
 other_matches jsonb;
 exception_confirmed boolean := coalesce((p_data->>'identity_exception_confirmed')::boolean,false);
 existing_name text;
 existing_designation text;
begin
 if p_actor is null or length(btrim(p_data->>'full_name')) not between 2 and 120 or v_mobile !~ '^[0-9]{10}$' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or reported > (now() at time zone 'Asia/Kolkata')::date or reported < (now() at time zone 'Asia/Kolkata')::date-7 then raise exception 'Enter valid arrival details within the last seven days'; end if;
 if p_locations is not null and not(sid=any(p_locations)) then raise exception 'Station outside your access'; end if;
 if not exists(select 1 from public.stations s join public.workforce_amazon_station_settings a on a.station_id=s.id and a.company_id=s.company_id where s.id=sid and s.company_id=p_company) then raise exception 'Configure Amazon onboarding for this station first'; end if;
 select d.name into role_name from public.designations d join public.designation_categories c on c.id=d.designation_category_id where d.id=did and d.company_id=p_company and d.is_active and c.people_module='delivery_network';
 if role_name is null then raise exception 'Select a Workforce designation'; end if;

 perform pg_advisory_xact_lock(hashtextextended(p_company::text||v_mobile,0));
 identity_evaluation := public.evaluate_onboarding_identity(p_company,v_mobile,did,role_name,null,null);
 exact_matches := coalesce(identity_evaluation->'exact_matches','[]'::jsonb);
 other_matches := coalesce(identity_evaluation->'other_matches','[]'::jsonb);
 if jsonb_array_length(exact_matches)>0 then
  existing_name:=coalesce(exact_matches->0->>'display_name','an existing person');
  existing_designation:=coalesce(exact_matches->0->>'designation_name',exact_matches->0->>'designation_code',role_name);
  raise exception 'Mobile number is already registered to % as %. Continue the existing profile; duplicate registration for the same designation is not allowed.',existing_name,existing_designation;
 end if;
 if jsonb_array_length(other_matches)>0 and not exception_confirmed then
  raise exception 'Existing DropX identity found. Confirm this as a separate Workforce registration to continue.';
 end if;
 if exists(select 1 from public.workforce w where w.company_id=p_company and w.deleted_at is null and lower(btrim(w.email))=v_email) then
  raise exception 'This Amazon email is already used by an associate. Continue the existing onboarding record or use the correct new email.';
 end if;

 insert into public.workforce(id,company_id,full_name,mobile,mobile_country_code,email,date_of_join,location_id,designation_id,designation,source_profile_type,source_profile_id,compatibility_mode,migration_state,is_active,onboarding_status,lifecycle_status,approval_required,created_by,biometric_id,dropx_id,onboarding_application_source,onboarding_token_hash,onboarding_token_expires_at)
 values(wid,p_company,btrim(p_data->>'full_name'),v_mobile,'91',v_email,reported,sid,did,role_name,'canonical',wid,false,'canonical',false,'pending','onboarding',true,p_actor,p_data->>'biometric_id',p_data->>'dropx_id','workforce',p_data->>'token_hash',now()+interval '7 days');
 insert into public.workforce_amazon_pilots(workforce_id,company_id,station_id,reported_on,created_by,invitation_timing,trial_days) values(wid,p_company,sid,reported,p_actor,'on_arrival',coalesce((p_data->>'trial_days')::integer,2));
 insert into public.biometric_enrolments(company_id,enrolment_id,worker_type,profile_type,account_id,location_id,status,effective_from,created_by) values(p_company,p_data->>'biometric_id','individual_contract','workforce',wid,sid,'Active',reported,p_actor);
 insert into public.workforce_amazon_pilot_history(company_id,workforce_id,event,evidence) values(p_company,wid,'reported',jsonb_build_object('reported_on',reported,'actor',p_actor,'identity_exception_confirmed',exception_confirmed,'identity_exception_profiles',other_matches));
 return wid;
end $$;

revoke all on function public.workforce_create_amazon_pilot(uuid,uuid,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_create_amazon_pilot(uuid,uuid,jsonb,uuid[]) to service_role;

commit;
