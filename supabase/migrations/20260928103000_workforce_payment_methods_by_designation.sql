begin;

-- A payment method is a reusable commercial structure, but its availability is
-- controlled by the Workforce designation master. Existing methods are opened
-- to every current Workforce designation so this release does not invalidate
-- any existing associate mapping; owners can narrow them afterwards.
create table public.workforce_payment_method_designations (
  company_id uuid not null references public.companies(id),
  payment_method_id uuid not null references public.payment_methods(id) on delete cascade,
  designation_id uuid not null references public.designations(id) on delete restrict,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (payment_method_id, designation_id)
);

create index workforce_payment_method_designations_company_designation
  on public.workforce_payment_method_designations(company_id, designation_id, payment_method_id);

alter table public.workforce_payment_method_designations enable row level security;
revoke all on public.workforce_payment_method_designations from public, anon, authenticated;
grant select, insert, update, delete on public.workforce_payment_method_designations to service_role;

create function public.workforce_payment_method_designation_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1
    from public.payment_methods method
    join public.designations designation
      on designation.id = new.designation_id
     and designation.company_id = method.company_id
    join public.designation_categories category
      on category.id = designation.designation_category_id
     and category.company_id = designation.company_id
    where method.id = new.payment_method_id
      and method.company_id = new.company_id
      and designation.is_active
      and category.is_active
      and category.people_module = 'delivery_network'
  ) then
    raise exception 'Choose an active Workforce designation from this company';
  end if;
  return new;
end $$;
revoke all on function public.workforce_payment_method_designation_guard() from public, anon, authenticated;
grant execute on function public.workforce_payment_method_designation_guard() to service_role;

create trigger workforce_payment_method_designation_guard
before insert or update on public.workforce_payment_method_designations
for each row execute function public.workforce_payment_method_designation_guard();

insert into public.workforce_payment_method_designations(company_id, payment_method_id, designation_id)
select method.company_id, method.id, designation.id
from public.payment_methods method
join public.designations designation on designation.company_id = method.company_id and designation.is_active
join public.designation_categories category
  on category.id = designation.designation_category_id
 and category.company_id = designation.company_id
 and category.is_active
 and category.people_module = 'delivery_network'
on conflict do nothing;

create function public.workforce_save_payment_method_v3(
  p_company_id uuid,
  p_actor uuid,
  p_method_id uuid,
  p_code text,
  p_name text,
  p_field_ids uuid[],
  p_source_of_truth text,
  p_calculation_basis text,
  p_designation_ids uuid[]
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_designations uuid[];
begin
  select array_agg(distinct id order by id) into v_designations from unnest(p_designation_ids) id;
  if coalesce(cardinality(v_designations), 0) not between 1 and 100
    or array_position(v_designations, null) is not null then
    raise exception 'Select between 1 and 100 Workforce designations';
  end if;
  if (
    select count(*)
    from public.designations designation
    join public.designation_categories category
      on category.id = designation.designation_category_id
     and category.company_id = designation.company_id
    where designation.company_id = p_company_id
      and designation.id = any(v_designations)
      and designation.is_active
      and category.is_active
      and category.people_module = 'delivery_network'
  ) <> cardinality(v_designations) then
    raise exception 'One or more selected designations are inactive or unavailable for Workforce';
  end if;

  v_id := public.workforce_save_payment_method_v2(
    p_company_id, p_actor, p_method_id, p_code, p_name, p_field_ids,
    p_source_of_truth, p_calculation_basis
  );

  delete from public.workforce_payment_method_designations
    where company_id = p_company_id and payment_method_id = v_id;
  insert into public.workforce_payment_method_designations(
    company_id, payment_method_id, designation_id, updated_by
  )
  select p_company_id, v_id, id, p_actor from unnest(v_designations) id;
  return v_id;
end $$;
revoke all on function public.workforce_save_payment_method_v3(uuid,uuid,uuid,text,text,uuid[],text,text,uuid[]) from public, anon, authenticated;
grant execute on function public.workforce_save_payment_method_v3(uuid,uuid,uuid,text,text,uuid[],text,text,uuid[]) to service_role;

-- Enforce the designation rule below every UI and import path. Historical rows
-- remain readable when a method is later removed from a designation.
create function public.workforce_mapping_payment_designation_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.workforce_id is null or new.payment_method_id is null then return new; end if;
  if not exists (
    select 1
    from public.workforce worker
    join public.workforce_payment_method_designations rule
      on rule.company_id = worker.company_id
     and rule.designation_id = worker.designation_id
     and rule.payment_method_id = new.payment_method_id
    where worker.id = new.workforce_id
      and worker.company_id = new.company_id
      and worker.deleted_at is null
      and worker.migration_state <> 'reclassified'
  ) then
    raise exception 'This payment method is not enabled for the associate designation';
  end if;
  return new;
end $$;
revoke all on function public.workforce_mapping_payment_designation_guard() from public, anon, authenticated;
grant execute on function public.workforce_mapping_payment_designation_guard() to service_role;

create trigger workforce_mapping_payment_designation_guard
before insert or update of workforce_id, payment_method_id
on public.field_executive_provider_mappings
for each row execute function public.workforce_mapping_payment_designation_guard();

commit;
