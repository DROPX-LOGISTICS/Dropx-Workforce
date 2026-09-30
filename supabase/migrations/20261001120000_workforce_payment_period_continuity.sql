begin;

-- Payment terms form one continuous timeline for a provider identity. An open
-- period may be split at any later date; a bounded period must be followed on
-- the immediately succeeding calendar day. The existing v3 function remains
-- the single validator/writer for methods, components, scope and audit events.
create function public.workforce_save_personal_payment_stage_v4(
  p_company uuid,p_actor uuid,p_actor_name text,p_workforce uuid,p_mapping uuid,p_expected timestamptz,
  p_mode text,p_from date,p_to date,p_method uuid,p_values jsonb,p_reason text,p_locations uuid[]
) returns void language plpgsql security invoker set search_path='' as $$
declare
  current_stage public.field_executive_provider_mappings;
  expected_start date;
begin
  select * into current_stage
  from public.field_executive_provider_mappings
  where company_id=p_company and id=p_mapping and workforce_id=p_workforce and status<>'cancelled'
  for update;

  if not found then
    raise exception 'Choose this associate''s current payment period';
  end if;

  if p_mode='next' then
    if exists (
      select 1
      from public.field_executive_provider_mappings later
      where later.company_id=p_company
        and later.workforce_id=p_workforce
        and later.provider_id=current_stage.provider_id
        and later.provider_member_id=current_stage.provider_member_id
        and later.station_id is not distinct from current_stage.station_id
        and later.status<>'cancelled'
        and later.effective_from>current_stage.effective_from
    ) then
      raise exception 'Add the next payment period after the latest existing period';
    end if;

    if current_stage.effective_to is not null then
      expected_start:=current_stage.effective_to+1;
      if p_from is distinct from expected_start then
        raise exception 'No payment gap is allowed. The next period must start on %',to_char(expected_start,'DD Mon YYYY');
      end if;
    end if;
  end if;

  perform public.workforce_save_personal_payment_stage_v3(
    p_company,p_actor,p_actor_name,p_workforce,p_mapping,p_expected,
    p_mode,p_from,p_to,p_method,p_values,p_reason,p_locations
  );
end $$;

revoke all on function public.workforce_save_personal_payment_stage_v4(uuid,uuid,text,uuid,uuid,timestamptz,text,date,date,uuid,jsonb,text,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_save_personal_payment_stage_v4(uuid,uuid,text,uuid,uuid,timestamptz,text,date,date,uuid,jsonb,text,uuid[]) to service_role;

commit;
