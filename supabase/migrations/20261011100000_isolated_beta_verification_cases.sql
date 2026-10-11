begin;
-- Private pilot only. No foreign key or write path to canonical Workforce/pay/mapping.
create table public.workforce_beta_verification_snapshots (
 company_id uuid not null references public.companies(id),
 candidate_id uuid not null references public.workforce_amazon_email_pilot_candidates(id),
 amazon_profile_id text, idfy_profile_id text, identity_email text,
 driver_id text, id_created_at timestamptz, bgc_submitted_at timestamptz,
 operational_status text, activated_at timestamptz, amazon_tasks jsonb not null default '[]',
 bgc_status text, checks jsonb not null default '[]',
 learning_status text, learning_confirmed_at timestamptz,
 lsc_observed_at timestamptz, idfy_observed_at timestamptz,
 uan_status text, sync_error text, updated_at timestamptz not null default now(),
 primary key(company_id,candidate_id),
 check (jsonb_typeof(checks)='array' and jsonb_typeof(amazon_tasks)='array')
);
create table public.workforce_beta_verification_cases (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 candidate_id uuid not null references public.workforce_amazon_email_pilot_candidates(id),
 check_code text not null, kind text not null check(kind in ('address','pcc','other')),
 label text not null, reason text not null,
 status text not null default 'awaiting_candidate' check(status in ('awaiting_candidate','awaiting_idfy','resolved','held','offboarding','offboarded')),
 notified_at timestamptz, failure_notified_at timestamptz, response_at timestamptz, response_note text,
 current_address jsonb, mail_status text not null default 'not_requested',
 mail_id text, claim_token uuid, mail_requested_at timestamptz, mail_sent_at timestamptz, mail_attempted_at timestamptz,
 resolved_at timestamptz, offboarded_at timestamptz, last_error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,candidate_id,check_code),
 check(current_address is null or jsonb_typeof(current_address)='object')
);
create table public.workforce_beta_verification_events (
 id uuid primary key default gen_random_uuid(), company_id uuid not null,
 candidate_id uuid not null references public.workforce_amazon_email_pilot_candidates(id),
 case_id uuid references public.workforce_beta_verification_cases(id),
 event text not null, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.workforce_beta_verification_settings (
 company_id uuid primary key references public.companies(id),
 no_response_days integer not null default 15 check(no_response_days = 15),
 auto_offboard_enabled boolean not null default false,
 offboard_reason_code text, sender_email text not null default 'nisar@dropxlogistics.com',
 recipients text[] not null default array['support@idfy.com','amazon@idfyops.com'],
 learning_initial_password text, updated_at timestamptz not null default now()
);
-- No automatic destructive action is enabled by a schema migration. The worker
-- requires an explicit company policy plus fresh, exact beta identity evidence.
alter table public.workforce_beta_verification_snapshots enable row level security;
revoke all on public.workforce_beta_verification_snapshots from public,anon,authenticated;
grant select,insert,update on public.workforce_beta_verification_snapshots to service_role;
alter table public.workforce_beta_verification_cases enable row level security;
revoke all on public.workforce_beta_verification_cases from public,anon,authenticated;
grant select,insert,update on public.workforce_beta_verification_cases to service_role;
alter table public.workforce_beta_verification_events enable row level security;
revoke all on public.workforce_beta_verification_events from public,anon,authenticated;
grant select,insert,update on public.workforce_beta_verification_events to service_role;
alter table public.workforce_beta_verification_settings enable row level security;
revoke all on public.workforce_beta_verification_settings from public,anon,authenticated;
grant select,insert,update on public.workforce_beta_verification_settings to service_role;
create function public.workforce_beta_verification_response(p_company uuid,p_candidate uuid,p_case uuid,p_action text,p_details jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.workforce_beta_verification_cases; k text; addr jsonb; response_time timestamptz := now();
begin
 perform 1 from public.workforce_amazon_email_pilot_candidates where id=p_candidate and company_id=p_company and closed_at is null for update;
 if not found then raise exception 'Private beta candidate unavailable'; end if;
 select * into c from public.workforce_beta_verification_cases where id=p_case and company_id=p_company and candidate_id=p_candidate for update;
 if not found or c.status not in ('awaiting_candidate','awaiting_idfy','held') then raise exception 'This case is no longer open'; end if;
 if p_action='seen' then
  update public.workforce_beta_verification_cases set notified_at=coalesce(notified_at,response_time),
   failure_notified_at=case when exists (
    select 1 from public.workforce_beta_verification_snapshots s, jsonb_array_elements(s.checks) x
    where s.company_id=p_company and s.candidate_id=p_candidate and x->>'code'=c.check_code
     and lower(coalesce(s.bgc_status,'')) in ('red','failed','fail','rejected','verified_red')
     and lower(coalesce(x->>'result','')) in ('red','failed','fail','rejected','verified_red')
     and s.sync_error is null and s.idfy_observed_at between response_time-interval '24 hours' and response_time
   ) then coalesce(failure_notified_at,response_time) else failure_notified_at end,
   updated_at=response_time where id=c.id;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='address' then
  if c.kind<>'address' then raise exception 'This check does not request an address'; end if;
  if coalesce(p_details->>'confirmed','')<>'true' then raise exception 'Confirm your current address before sending'; end if;
  addr='{}'::jsonb;
  foreach k in array array['house','road','locality','landmark','city','state','pin','mobile'] loop
   if length(btrim(coalesce(p_details->>k,'')))<2 or length(p_details->>k)>200 then raise exception 'Complete every current-address field'; end if;
   addr=addr||jsonb_build_object(k,btrim(p_details->>k));
  end loop;
  if (addr->>'pin')!~'^[1-9][0-9]{5}$' or (addr->>'mobile')!~'^[6-9][0-9]{9}$' then raise exception 'Enter a valid PIN and 10-digit contact number'; end if;
  if c.mail_status in ('queued','sending') then raise exception 'A request is already being sent'; end if;
  if c.current_address=addr and c.mail_status='sent' then return jsonb_build_object('ok',true,'alreadySent',true); end if;
  update public.workforce_beta_verification_cases set current_address=addr,response_at=response_time,status='awaiting_idfy',mail_status='queued',mail_requested_at=response_time,mail_attempted_at=null,mail_id=null,mail_sent_at=null,last_error=null,updated_at=response_time where id=c.id;
 elsif p_action='pcc_handoff' then
  if c.kind<>'pcc' or length(btrim(coalesce(p_details->>'note','')))<5 or length(p_details->>'note')>1000 then raise exception 'Describe the PCC shared with your team leader'; end if;
  update public.workforce_beta_verification_cases set response_at=response_time,response_note=btrim(p_details->>'note'),status='awaiting_idfy',updated_at=response_time where id=c.id;
 else raise exception 'Unsupported response'; end if;
 insert into public.workforce_beta_verification_events(company_id,candidate_id,case_id,event,detail) values(p_company,p_candidate,c.id,p_action,jsonb_build_object('candidateResponded',true));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.workforce_beta_verification_response(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.workforce_beta_verification_response(uuid,uuid,uuid,text,jsonb) to service_role;


-- Retain every verified onboarding action from an email (UAN and assisted help
-- can coexist in one message). This is still the isolated pilot inbox.
alter table public.workforce_amazon_email_pilot_messages add column if not exists action_urls jsonb not null default '[]' check(jsonb_typeof(action_urls)='array');

-- Defence in depth against service-side company/candidate mismatches.
create function public.workforce_beta_check_scope() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.workforce_amazon_email_pilot_candidates where id=new.candidate_id and company_id=new.company_id) then
  raise exception 'Private beta identity scope mismatch';
 end if;
 return new;
end $$;
create trigger beta_snapshot_scope before insert or update on public.workforce_beta_verification_snapshots for each row execute function public.workforce_beta_check_scope();
create trigger beta_case_scope before insert or update on public.workforce_beta_verification_cases for each row execute function public.workforce_beta_check_scope();
create trigger beta_event_scope before insert or update on public.workforce_beta_verification_events for each row execute function public.workforce_beta_check_scope();

create function public.workforce_beta_claim_mail(p_company uuid,p_case uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.workforce_beta_verification_cases; s public.workforce_beta_verification_snapshots; token uuid:=gen_random_uuid();
begin
 select * into c from public.workforce_beta_verification_cases where id=p_case and company_id=p_company for update;
 if not found or c.kind<>'address' or c.status<>'awaiting_idfy' or c.mail_status<>'queued' or c.response_at is null or c.current_address is null then return null; end if;
 if not exists(select 1 from public.workforce_amazon_email_pilot_candidates where id=c.candidate_id and company_id=p_company and closed_at is null) then return null; end if;
 select * into s from public.workforce_beta_verification_snapshots where company_id=p_company and candidate_id=c.candidate_id;
 if s.idfy_profile_id is null or s.identity_email is null or s.idfy_observed_at is null or s.idfy_observed_at<now()-interval '24 hours' or s.idfy_observed_at>now() or s.sync_error is not null then return null; end if;
 if exists(select 1 from jsonb_array_elements(s.checks) x where x->>'code'=c.check_code and lower(coalesce(x->>'result','')) in ('green','clear','verified','verified_green','approved','passed')) then return null; end if;
 if lower(coalesce(s.bgc_status,'')) in ('green','clear','verified','verified_green','approved','passed') then return null; end if;
 update public.workforce_beta_verification_cases set mail_status='sending',claim_token=token,mail_attempted_at=now(),updated_at=now() where id=c.id;
 return jsonb_build_object('token',token,'case',to_jsonb(c),'snapshot',to_jsonb(s));
end $$;

create function public.workforce_beta_claim_offboarding(p_company uuid,p_candidate uuid,p_case uuid,p_provider text)
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
 if not cfg.auto_offboard_enabled or cfg.no_response_days<>15 or nullif(cfg.offboard_reason_code,'') is null then return null; end if;
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
revoke all on function public.workforce_beta_claim_mail(uuid,uuid) from public,anon,authenticated;
revoke all on function public.workforce_beta_claim_offboarding(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.workforce_beta_claim_mail(uuid,uuid) to service_role;
grant execute on function public.workforce_beta_claim_offboarding(uuid,uuid,uuid,text) to service_role;
commit;
