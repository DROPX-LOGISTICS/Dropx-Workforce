begin;

-- A method groups commercial components. Each component owns its earning evidence
-- so fixed attendance pay and variable shipment pay can coexist in one method.
create table public.workforce_payment_method_component_sources (
  company_id uuid not null references public.companies(id),
  payment_method_id uuid not null references public.payment_methods(id) on delete cascade,
  payment_field_id uuid not null references public.payment_fields(id) on delete restrict,
  source_of_truth text not null check (source_of_truth in ('biometric_attendance','amazon_daily_shipment','manual_approved')),
  calculation_basis text not null check (calculation_basis in ('attendance_day','shipment_active_day','shipment_quantity','manual')),
  source_metric text check (source_metric in ('total_delivery','total_activity','amazon_delivery','swa_delivery','customer_return','seller_pickup','seller_return')),
  minimum_units numeric(12,2) check (minimum_units between 0 and 1000000),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (payment_method_id,payment_field_id),
  check (
    (source_of_truth='biometric_attendance' and calculation_basis='attendance_day' and source_metric is null and minimum_units is null)
    or (source_of_truth='amazon_daily_shipment' and calculation_basis='shipment_quantity' and source_metric is not null and minimum_units is null)
    or (source_of_truth='amazon_daily_shipment' and calculation_basis='shipment_active_day' and source_metric is not null and minimum_units is not null)
    or (source_of_truth='manual_approved' and calculation_basis='manual' and source_metric is null and minimum_units is null)
  )
);
create index workforce_payment_component_sources_company
  on public.workforce_payment_method_component_sources(company_id,payment_method_id);
alter table public.workforce_payment_method_component_sources enable row level security;
revoke all on public.workforce_payment_method_component_sources from public,anon,authenticated;
grant select,insert,update,delete on public.workforce_payment_method_component_sources to service_role;

create function public.workforce_payment_component_source_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare component public.payment_method_components; field public.payment_fields;
begin
  select * into component from public.payment_method_components
    where company_id=new.company_id and payment_method_id=new.payment_method_id and payment_field_id=new.payment_field_id and is_active;
  if component.id is null then raise exception 'Configure rules only for fields in this payment method'; end if;
  select * into field from public.payment_fields where id=new.payment_field_id and company_id=new.company_id and is_active;
  if field.id is null then raise exception 'Payment field is inactive or unavailable'; end if;
  if field.field_type='production' and not (
    (new.source_of_truth='amazon_daily_shipment' and new.calculation_basis='shipment_quantity')
    or (new.source_of_truth='manual_approved' and new.calculation_basis='manual')
  ) then raise exception 'Production fields require shipment quantity or approved manual evidence'; end if;
  if field.field_type='amount' and new.calculation_basis='shipment_quantity' then
    raise exception 'Amount fields cannot use shipment quantity';
  end if;
  return new;
end $$;
revoke all on function public.workforce_payment_component_source_guard() from public,anon,authenticated;
grant execute on function public.workforce_payment_component_source_guard() to service_role;
create trigger workforce_payment_component_source_guard
before insert or update on public.workforce_payment_method_component_sources
for each row execute function public.workforce_payment_component_source_guard();

-- Correct the original catalog schedule labels used by the current Workforce master.
update public.payment_fields set pay_schedule='per_day'
where code in ('FIXED_PAY_PER_DAY','MG_PER_DAY','VAN_RENT_PER_DAY') and field_type='amount';
update public.payment_fields set pay_schedule='per_month'
where code in ('FIXED_PAY_PER_MONTH','MG_PER_MONTH','VAN_RENT_PER_MONTH') and field_type='amount';

-- Preserve existing behavior as a starting point. Owners can now change each
-- component independently without rewriting historical mapping metadata.
insert into public.workforce_payment_method_component_sources(
  company_id,payment_method_id,payment_field_id,source_of_truth,calculation_basis,source_metric,minimum_units,updated_by
)
select component.company_id,component.payment_method_id,component.payment_field_id,
  source.source_of_truth,
  case
    when source.source_of_truth='biometric_attendance' then 'attendance_day'
    when source.source_of_truth='amazon_daily_shipment' and component.component_type='production' then 'shipment_quantity'
    when source.source_of_truth='amazon_daily_shipment' then 'shipment_active_day'
    else 'manual'
  end,
  case when source.source_of_truth='amazon_daily_shipment' then
    case component.component_code
      when 'DELIVERY' then 'total_delivery'
      when 'CRETURN' then 'customer_return'
      when 'SELLER_PICKUP' then 'seller_pickup'
      when 'SLLLER_RETURN' then 'seller_return'
      when 'SELLER_RETURN' then 'seller_return'
      else 'total_activity'
    end
  else null end,
  case when source.source_of_truth='amazon_daily_shipment' and component.component_type<>'production' then 1 else null end,
  source.updated_by
from public.payment_method_components component
join public.workforce_payment_method_sources source
  on source.company_id=component.company_id and source.payment_method_id=component.payment_method_id
where component.is_active
on conflict do nothing;

create function public.workforce_save_payment_method_v4(
  p_company_id uuid,p_actor uuid,p_method_id uuid,p_code text,p_name text,p_field_ids uuid[],
  p_designation_ids uuid[],p_component_rules jsonb
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;v_designations uuid[];v_fields uuid[];rule jsonb;field_id uuid;source text;basis text;metric text;minimum numeric;source_count integer;legacy_source text;legacy_basis text;
begin
  select array_agg(distinct id order by id) into v_designations from unnest(p_designation_ids) id;
  if coalesce(cardinality(v_designations),0) not between 1 and 100 or array_position(v_designations,null) is not null then
    raise exception 'Select between 1 and 100 Workforce designations';
  end if;
  if (select count(*) from public.designations designation join public.designation_categories category
      on category.id=designation.designation_category_id and category.company_id=designation.company_id
      where designation.company_id=p_company_id and designation.id=any(v_designations)
        and designation.is_active and category.is_active and category.people_module='delivery_network') <> cardinality(v_designations) then
    raise exception 'One or more selected designations are inactive or unavailable for Workforce';
  end if;
  select array_agg(distinct id order by id) into v_fields from unnest(p_field_ids) id;
  if coalesce(cardinality(v_fields),0) not between 1 and 50 or jsonb_typeof(p_component_rules)<>'array'
     or jsonb_array_length(p_component_rules)<>cardinality(v_fields) then
    raise exception 'Configure exactly one earning rule for every payment field';
  end if;

  v_id:=public.workforce_save_payment_method(p_company_id,p_method_id,p_code,p_name,v_fields);
  delete from public.workforce_payment_method_designations where company_id=p_company_id and payment_method_id=v_id;
  insert into public.workforce_payment_method_designations(company_id,payment_method_id,designation_id,updated_by)
    select p_company_id,v_id,id,p_actor from unnest(v_designations) id;

  delete from public.workforce_payment_method_component_sources where company_id=p_company_id and payment_method_id=v_id;
  for rule in select value from jsonb_array_elements(p_component_rules) loop
    begin
      field_id:=(rule->>'fieldId')::uuid;
      source:=rule->>'sourceOfTruth';basis:=rule->>'calculationBasis';metric:=nullif(rule->>'sourceMetric','');
      minimum:=case when nullif(rule->>'minimumUnits','') is null then null else (rule->>'minimumUnits')::numeric end;
    exception when others then raise exception 'A payment component earning rule is invalid'; end;
    if not(field_id=any(v_fields)) then raise exception 'A payment component rule does not match the selected fields'; end if;
    insert into public.workforce_payment_method_component_sources(
      company_id,payment_method_id,payment_field_id,source_of_truth,calculation_basis,source_metric,minimum_units,updated_by
    ) values(p_company_id,v_id,field_id,source,basis,metric,minimum,p_actor);
  end loop;
  if (select count(*) from public.workforce_payment_method_component_sources where company_id=p_company_id and payment_method_id=v_id)<>cardinality(v_fields) then
    raise exception 'Configure exactly one earning rule for every payment field';
  end if;

  select count(distinct source_of_truth),min(source_of_truth) into source_count,legacy_source
    from public.workforce_payment_method_component_sources where company_id=p_company_id and payment_method_id=v_id;
  if source_count=1 then
    legacy_basis:=case legacy_source when 'biometric_attendance' then 'attendance_day' when 'amazon_daily_shipment' then 'shipment_activity' else 'manual' end;
  else legacy_source:='manual_approved';legacy_basis:='manual';end if;
  insert into public.workforce_payment_method_sources(payment_method_id,company_id,source_of_truth,calculation_basis,updated_by)
    values(v_id,p_company_id,legacy_source,legacy_basis,p_actor)
    on conflict(payment_method_id) do update set source_of_truth=excluded.source_of_truth,calculation_basis=excluded.calculation_basis,
      version=public.workforce_payment_method_sources.version+1,updated_by=p_actor,updated_at=now();
  return v_id;
end $$;
revoke all on function public.workforce_save_payment_method_v4(uuid,uuid,uuid,text,text,uuid[],uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.workforce_save_payment_method_v4(uuid,uuid,uuid,text,text,uuid[],uuid[],jsonb) to service_role;

create function public.workforce_save_personal_payment_stage_v3(
  p_company uuid,p_actor uuid,p_actor_name text,p_workforce uuid,p_mapping uuid,p_expected timestamptz,
  p_mode text,p_from date,p_to date,p_method uuid,p_values jsonb,p_reason text,p_locations uuid[]
) returns void language plpgsql security invoker set search_path='' as $$
declare w public.workforce;m public.field_executive_provider_mappings;method public.payment_methods;k text;v numeric;payload jsonb:='{}'::jsonb;rules jsonb:='{}'::jsonb;replacement uuid;component_count integer;rule_count integer;component record;source_count integer;summary_source text;
begin
 select * into w from public.workforce where company_id=p_company and id=p_workforce and deleted_at is null and migration_state<>'reclassified' for update;
 if not found or w.onboarding_status not in ('approved','active') or p_actor is null then raise exception 'Choose an approved associate';end if;
 select * into m from public.field_executive_provider_mappings where company_id=p_company and id=p_mapping and workforce_id=p_workforce and status<>'cancelled' for update;
 if not found then raise exception 'Choose this associate''s canonical provider mapping';end if;
 if p_locations is not null and (w.location_id is null or m.station_id is null or not(w.location_id=any(p_locations)) or not(m.station_id=any(p_locations))) then raise exception 'Payment stage is outside your station scope';end if;
 if m.updated_at is distinct from p_expected then raise exception 'Payment mapping changed. Refresh before saving';end if;
 if p_mode not in ('next','edit') or p_from is null or p_to<p_from or p_from<m.effective_from or p_mode='next' and p_from<=m.effective_from or p_mode='edit' and p_from<>m.effective_from then raise exception 'Choose a valid dated payment stage';end if;
 if length(btrim(coalesce(p_reason,'')))<10 or length(p_reason)>1000 then raise exception 'Explain the agreed terms or reason for this change';end if;
 select * into method from public.payment_methods where id=p_method and company_id=p_company and is_active for share;
 if method.id is null then raise exception 'Choose an active payment method';end if;
 select count(*) into component_count from public.payment_method_components where payment_method_id=method.id and company_id=p_company and is_active;
 select count(*) into rule_count from public.workforce_payment_method_component_sources where payment_method_id=method.id and company_id=p_company;
 if component_count=0 or rule_count<>component_count then raise exception 'Configure every payment component earning rule in Master first';end if;
 if (select count(*) from jsonb_object_keys(coalesce(p_values,'{}'::jsonb)))<>component_count then raise exception 'Complete exactly the fields configured for this payment method';end if;
 for component in
   select c.component_code,s.source_of_truth,s.calculation_basis,s.source_metric,s.minimum_units
   from public.payment_method_components c join public.workforce_payment_method_component_sources s
     on s.company_id=c.company_id and s.payment_method_id=c.payment_method_id and s.payment_field_id=c.payment_field_id
   where c.payment_method_id=method.id and c.company_id=p_company and c.is_active order by c.sort_order
 loop
   k:=component.component_code;
   if not(coalesce(p_values,'{}'::jsonb)?k) then raise exception 'Complete every configured payment field';end if;
   v:=(p_values->>k)::numeric;
   if v is null or v::text in ('NaN','Infinity','-Infinity') or v<0 or v>1000000 then raise exception 'Every payment value must be a valid nonnegative amount';end if;
   payload:=payload||jsonb_build_object(k,v);
   rules:=rules||jsonb_build_object(k,jsonb_build_object(
     'sourceOfTruth',component.source_of_truth,'calculationBasis',component.calculation_basis,
     'sourceMetric',component.source_metric,'minimumUnits',component.minimum_units
   ));
 end loop;
 select count(distinct source_of_truth),min(source_of_truth) into source_count,summary_source
   from public.workforce_payment_method_component_sources where company_id=p_company and payment_method_id=method.id;
 if source_count>1 then summary_source:='mixed';end if;
 payload:=payload||jsonb_build_object('DROPX_PERSONAL_TERMS',1,'DROPX_SOURCE_OF_TRUTH',summary_source,'DROPX_COMPONENT_RULES',rules);
 replacement:=case when p_mode='next' and m.effective_to is not null and m.effective_to<p_from then null else m.id end;
 perform public.workforce_save_joining_mapping(p_company,p_actor,p_workforce,replacement,w.dropx_id,jsonb_build_object(
   'provider_id',m.provider_id,'station_id',m.station_id,'provider_member_id',m.provider_member_id,'effective_from',p_from,'effective_to',p_to,
   'payment_method_id',method.id,'payment_values',payload,'pay_type',method.code,'status',case when p_to is null then 'active' else 'closed' end
 ),p_locations,p_actor_name);
 update public.field_executive_provider_mappings set reason=p_reason where company_id=p_company and workforce_id=p_workforce and provider_id=m.provider_id and provider_member_id=m.provider_member_id and station_id=m.station_id and effective_from=p_from and status<>'cancelled';
 insert into public.workforce_joining_events(company_id,workforce_id,event_code,actor_id,actor_name,details)
   values(p_company,p_workforce,'payment_stage_saved',p_actor,p_actor_name,jsonb_build_object(
     'previous_mapping',to_jsonb(m),'from',p_from,'through',p_to,'payment_method_id',method.id,'payment_method_code',method.code,
     'component_rules',rules,'payment_values',payload,'reason',p_reason));
end $$;
revoke all on function public.workforce_save_personal_payment_stage_v3(uuid,uuid,text,uuid,uuid,timestamptz,text,date,date,uuid,jsonb,text,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_save_personal_payment_stage_v3(uuid,uuid,text,uuid,uuid,timestamptz,text,date,date,uuid,jsonb,text,uuid[]) to service_role;

commit;
