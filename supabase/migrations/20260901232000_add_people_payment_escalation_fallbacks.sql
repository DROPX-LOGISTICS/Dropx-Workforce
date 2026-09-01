begin;

-- Local payment approvals should prefer the configured Cluster/Regional
-- manager. Stations such as HO or HBSC do not always have either position,
-- so keep the working order and append the current People escalation chain.
-- The IDs come from the designation master and remain editable there; no user
-- email or person is hardcoded. Finance processing roles are not changed.
create temporary table _operations_payment_escalation_roles on commit drop as
select
  policy.company_id,
  policy.default_role_id as role_id,
  case upper(designation.code)
    when 'AOM' then 10
    when 'BH' then 20
    when 'NH' then 30
  end as escalation_order
from public.designation_product_access_policies policy
join public.designations designation
  on designation.company_id = policy.company_id
 and designation.id = policy.designation_id
 and designation.is_active
join public.designation_categories category
  on category.company_id = designation.company_id
 and category.id = designation.designation_category_id
 and category.people_module = 'people_hr'
 and category.is_active
join public.user_roles role
  on role.company_id = policy.company_id
 and role.id = policy.default_role_id
 and role.is_active
where policy.product_code = 'operations'
  and policy.is_enabled
  and policy.default_role_id is not null
  and upper(designation.code) in ('AOM','BH','NH');

create temporary table _operations_payment_route_roles on commit drop as
select policy.company_id, policy.default_role_id as role_id
from public.designation_product_access_policies policy
join public.designations designation
  on designation.company_id = policy.company_id
 and designation.id = policy.designation_id
 and designation.is_active
where policy.product_code = 'operations'
  and policy.is_enabled
  and policy.default_role_id is not null
  and upper(designation.code) in ('CLM','AOM','RM','BH','NH');

update public.payment_heads head
set initial_approval_role_ids = case
      when cardinality(coalesce(head.initial_approval_role_ids, array_remove(array[head.initial_approval_role_id], null))) = 0
        then coalesce(head.initial_approval_role_ids, '{}'::uuid[])
      else (
        select array_agg(candidate.role_id order by candidate.first_position)
        from (
          select role_id, min(position) as first_position
          from (
            select existing.role_id, existing.position::integer as position
            from unnest(coalesce(head.initial_approval_role_ids, array_remove(array[head.initial_approval_role_id], null)))
              with ordinality existing(role_id, position)
            union all
            select fallback.role_id,
                   1000 + fallback.escalation_order
            from _operations_payment_escalation_roles fallback
            where fallback.company_id = head.company_id
          ) ordered_roles
          group by role_id
        ) candidate
      )
    end,
    final_approval_role_ids = (
      select array_agg(candidate.role_id order by candidate.first_position)
      from (
        select role_id, min(position) as first_position
        from (
          select existing.role_id, existing.position::integer as position
          from unnest(coalesce(head.final_approval_role_ids, array_remove(array[head.final_approval_role_id], null)))
            with ordinality existing(role_id, position)
          union all
          select fallback.role_id,
                 1000 + fallback.escalation_order
          from _operations_payment_escalation_roles fallback
          where fallback.company_id = head.company_id
        ) ordered_roles
        group by role_id
      ) candidate
    ),
    updated_at = now()
where head.is_active
  and exists (
    select 1
    from _operations_payment_route_roles configured
    where configured.company_id = head.company_id
      and (
        configured.role_id = any(coalesce(head.initial_approval_role_ids, array_remove(array[head.initial_approval_role_id], null)))
        or configured.role_id = any(coalesce(head.final_approval_role_ids, array_remove(array[head.final_approval_role_id], null)))
      )
  );

-- Pending requests keep their current local approver first but receive the
-- same escalation safety net. Completed approval/audit rows stay immutable.
update public.payment_requests request
set current_approver_role_ids = (
      select array_agg(candidate.role_id order by candidate.first_position)
      from (
        select role_id, min(position) as first_position
        from (
          select existing.role_id, existing.position::integer as position
          from unnest(coalesce(request.current_approver_role_ids, array_remove(array[request.current_approver_role_id], null)))
            with ordinality existing(role_id, position)
          union all
          select fallback.role_id,
                 1000 + fallback.escalation_order
          from _operations_payment_escalation_roles fallback
          where fallback.company_id = request.company_id
        ) ordered_roles
        group by role_id
      ) candidate
    ),
    final_approval_role_ids = (
      select array_agg(candidate.role_id order by candidate.first_position)
      from (
        select role_id, min(position) as first_position
        from (
          select existing.role_id, existing.position::integer as position
          from unnest(coalesce(request.final_approval_role_ids, array_remove(array[request.final_approval_role_id], null)))
            with ordinality existing(role_id, position)
          union all
          select fallback.role_id,
                 1000 + fallback.escalation_order
          from _operations_payment_escalation_roles fallback
          where fallback.company_id = request.company_id
        ) ordered_roles
        group by role_id
      ) candidate
    ),
    updated_at = now()
where coalesce(upper(request.approval_status), upper(request.status), 'PENDING') not in (
    'FINAL_APPROVED','APPROVED','PAID','REJECTED','CANCELLED','COMPLETED'
  )
  and cardinality(coalesce(request.current_approver_role_ids, array_remove(array[request.current_approver_role_id], null))) > 0
  and exists (
    select 1
    from _operations_payment_route_roles configured
    where configured.company_id = request.company_id
      and (
        configured.role_id = any(coalesce(request.current_approver_role_ids, array_remove(array[request.current_approver_role_id], null)))
        or configured.role_id = any(coalesce(request.final_approval_role_ids, array_remove(array[request.final_approval_role_id], null)))
      )
  );

notify pgrst, 'reload schema';

commit;
