begin;

-- Reconcile legacy designation rows with the new business-category master.
-- This is intentionally data-driven: non-employee engagement policies,
-- field-operations roles, and designations already referenced by the canonical
-- Workforce register belong to the delivery-network surface. Runtime routing
-- continues to read designation_category_id from the master.
with workforce_categories as (
  select category.id, category.company_id
  from public.designation_categories category
  where category.code = 'workforce'
    and category.people_module = 'delivery_network'
    and category.is_active
), workforce_candidates as (
  select designation.id, designation.company_id
  from public.designations designation
  where designation.is_field_operations
     or exists (
       select 1
       from unnest(designation.onboarding_categories) engagement(code)
       where engagement.code <> 'employees'
     )
     or exists (
       select 1
       from public.workforce worker
       where worker.company_id = designation.company_id
         and worker.designation_id = designation.id
     )
)
update public.designations designation
set designation_category_id = category.id,
    updated_at = now()
from workforce_categories category
join workforce_candidates candidate
  on candidate.company_id = category.company_id
where designation.id = candidate.id
  and designation.company_id = candidate.company_id
  and designation.designation_category_id is distinct from category.id;

do $$
begin
  if exists (
    select 1
    from public.designations designation
    join public.designation_categories category
      on category.id = designation.designation_category_id
     and category.company_id = designation.company_id
    where (
      designation.is_field_operations
      or exists (
        select 1
        from unnest(designation.onboarding_categories) engagement(code)
        where engagement.code <> 'employees'
      )
      or exists (
        select 1
        from public.workforce worker
        where worker.company_id = designation.company_id
          and worker.designation_id = designation.id
      )
    )
      and (
        category.code <> 'workforce'
        or category.people_module <> 'delivery_network'
      )
  ) then
    raise exception 'Workforce designation master reconciliation did not classify every candidate.';
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
