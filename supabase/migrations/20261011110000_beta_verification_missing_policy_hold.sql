begin;
-- Missing policy is an explicit hold, including at the database claim boundary.
create or replace function public.workforce_beta_claim_offboarding(p_company uuid,p_candidate uuid,p_case uuid,p_provider text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.workforce_beta_verification_cases; s public.workforce_beta_verification_snapshots; cfg public.workforce_beta_verification_settings; token uuid:=gen_random_uuid(); alias text; check_result text;
begin
 -- Same order as candidate response: candidate then case. No automatic lease
 -- recovery: an interrupted external action must be reconciled, never replayed.
 select alias_email into alias from public.workforce_amazon_email_pilot_candidates where company_id=p_company and id=p_candidate and closed_at is null for update;
 if not found then return null; end if;
 perform 1 from public.workforce_beta_verification_cases where company_id=p_company and candidate_id=p_candidate for update;
 select * into c from public.workforce_beta_verification_cases where company_id=p_company and candidate_id=p_candidate and id=p_case;
 if not found or c.status<>'awaiting_candidate' or c.response_at is not null or c.failure_notified_at is null or c.failure_notified_at>now()-interval '15 days' then return null; end if;
 if exists(select 1 from public.workforce_beta_verification_cases where company_id=p_company and candidate_id=p_candidate and (response_at is not null or status in ('offboarding','offboarded'))) then return null; end if;
 select * into cfg from public.workforce_beta_verification_settings where company_id=p_company;
 if not found or cfg.auto_offboard_enabled is not true or cfg.no_response_days<>15 or nullif(cfg.offboard_reason_code,'') is null then return null; end if;
 select * into s from public.workforce_beta_verification_snapshots where company_id=p_company and candidate_id=p_candidate for update;
 if not found or s.amazon_profile_id is distinct from p_provider or lower(s.identity_email) is distinct from lower(alias) or s.idfy_profile_id is null or s.sync_error is not null then return null; end if;
 if s.activated_at is not null or s.operational_status is distinct from 'ONBOARDING' or lower(coalesce(s.bgc_status,'')) not in ('red','failed','fail','rejected','verified_red') then return null; end if;
 if s.idfy_observed_at is null or s.lsc_observed_at is null or s.idfy_observed_at not between now()-interval '15 minutes' and now() or s.lsc_observed_at not between now()-interval '15 minutes' and now() then return null; end if;
 select lower(x->>'result') into check_result from jsonb_array_elements(s.checks) x where x->>'code'=c.check_code limit 1;
 if coalesce(check_result,'') not in ('red','failed','fail','rejected','verified_red') then return null; end if;
 -- Never act on an ID also used by an established workforce profile or another
 -- candidate, even if somebody accidentally attached it to a beta record.
 if exists(select 1 from public.workforce where company_id=p_company and deleted_at is null and lower(email)=lower(alias)) then return null; end if;
 if exists(select 1 from public.workforce_amazon_portal_links where company_id=p_company and amazon_provider_id=p_provider) then return null; end if;
 if exists(select 1 from public.workforce_beta_verification_snapshots where company_id=p_company and candidate_id<>p_candidate and amazon_profile_id=p_provider) then return null; end if;
 update public.workforce_beta_verification_cases set status='offboarding',claim_token=token,updated_at=now() where id=c.id;
 insert into public.workforce_beta_verification_events(company_id,candidate_id,case_id,event,detail) values(p_company,p_candidate,p_case,'offboarding_claimed',jsonb_build_object('providerId',p_provider,'reason','Failed BGC; no candidate response for 15 days','idfyObservedAt',s.idfy_observed_at,'lscObservedAt',s.lsc_observed_at));
 return jsonb_build_object('token',token,'reasonCode',cfg.offboard_reason_code);
end $$;
commit;
