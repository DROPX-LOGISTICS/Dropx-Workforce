begin;

-- Future isolated beta invitations only. No existing record or shared master is rewritten.
create or replace function public.workforce_create_isolated_amazon_email_pilot(
  p_company uuid,
  p_actor uuid,
  p_data jsonb,
  p_locations uuid[]
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate_id uuid := (p_data->>'id')::uuid;
  v_station_id uuid := (p_data->>'station_id')::uuid;
  v_designation_id uuid := (p_data->>'designation_id')::uuid;
  person_name text := btrim(p_data->>'full_name');
  person_mobile text := regexp_replace(coalesce(p_data->>'mobile',''),'[^0-9]','','g');
  reported date := (p_data->>'reported_on')::date;
  station_code text;
  email_pattern text;
  generated_email text;
  email_domain text;
  short_name text;
  short_station text;
  base_email text;
  suffix integer := 1;
  duplicate_summary text;
begin
  if p_actor is null
     or length(person_name) not between 2 and 120
     or person_mobile !~ '^[0-9]{10}$'
     or length(btrim(coalesce(p_data->>'biometric_id',''))) not between 2 and 80
     or reported > (now() at time zone 'Asia/Kolkata')::date
     or reported < (now() at time zone 'Asia/Kolkata')::date-7 then
    raise exception 'Enter valid arrival details within the last seven days';
  end if;
  if p_locations is not null and not(v_station_id=any(p_locations)) then
    raise exception 'Station outside your access';
  end if;
  if not exists (
    select 1 from public.designations d
    join public.designation_categories c on c.id=d.designation_category_id
    where d.id=v_designation_id and d.company_id=p_company and d.is_active
      and c.people_module='delivery_network'
  ) then raise exception 'Select a Workforce designation'; end if;

  select s.station_code,cfg.associate_email_pattern into station_code,email_pattern
  from public.stations s
  join public.workforce_amazon_station_settings cfg
    on cfg.company_id=s.company_id and cfg.station_id=s.id
  where s.company_id=p_company and s.id=v_station_id and s.is_active
    and cfg.invitation_enabled;
  if email_pattern is null or btrim(email_pattern)='' then
    raise exception 'Configure the backend email alias pattern for this station before starting the pilot';
  end if;

  -- Only the isolated beta uses this short local part. Shared station patterns
  -- still supply the domain and remain unchanged for canonical onboarding.
  email_domain := lower(btrim(split_part(email_pattern,'@',2)));
  short_name := left(regexp_replace(lower(split_part(btrim(person_name),' ',1)),'[^a-z0-9]','','g'),18);
  short_station := regexp_replace(lower(station_code),'[^a-z0-9]','','g');
  if short_name='' then short_name := 'associate'; end if;
  if short_station='' or email_domain !~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$' then
    raise exception 'Configure a valid station code and email domain before starting the pilot';
  end if;
  base_email := short_name||'.'||short_station||'@'||email_domain;
  generated_email := base_email;
  -- Serialize allocation for this station/domain, including across companies.
  -- A natural first name ending in digits must not race a collision suffix.
  perform pg_advisory_xact_lock(hashtextextended('beta-email-station:'||short_station||'@'||email_domain,0));
  while exists(select 1 from public.workforce_amazon_email_pilot_candidates where alias_email=generated_email)
     or exists(select 1 from public.workforce_amazon_email_aliases where alias_email=generated_email) loop
    suffix := suffix+1;
    if suffix>9999 then raise exception 'No short sign-in address is available. Contact Workforce'; end if;
    generated_email := short_name||suffix::text||'.'||short_station||'@'||email_domain;
  end loop;
  if length(generated_email)>90 then raise exception 'The email domain is too long for a short sign-in address'; end if;

  select left(w.full_name||' · '||coalesce(w.designation,'Existing Workforce role'),500)
    into duplicate_summary
  from public.workforce w
  where w.company_id=p_company and w.deleted_at is null
    and right(regexp_replace(w.mobile,'[^0-9]','','g'),10)=person_mobile
  order by w.updated_at desc nulls last,w.created_at desc limit 1;

  insert into public.workforce_amazon_email_pilot_candidates(
    id,company_id,station_id,designation_id,full_name,mobile,biometric_id,
    reported_on,alias_email,duplicate_identity_detected,duplicate_identity_summary,created_by
  ) values (
    candidate_id,p_company,v_station_id,v_designation_id,person_name,person_mobile,
    btrim(p_data->>'biometric_id'),reported,generated_email,
    duplicate_summary is not null,duplicate_summary,p_actor
  );
  return candidate_id;
end
$$;

commit;
