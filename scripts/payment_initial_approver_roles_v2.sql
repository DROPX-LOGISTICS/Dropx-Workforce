begin;

alter table public.payment_heads
  add column if not exists initial_approval_role_ids uuid[] not null default '{}'::uuid[];

update public.payment_heads
set initial_approval_role_ids = array[initial_approval_role_id]
where initial_approval_role_id is not null
  and coalesce(cardinality(initial_approval_role_ids), 0) = 0;

alter table public.payment_requests
  add column if not exists current_approver_role_ids uuid[] not null default '{}'::uuid[];

update public.payment_requests
set current_approver_role_ids = array[current_approver_role_id]
where current_approver_role_id is not null
  and coalesce(cardinality(current_approver_role_ids), 0) = 0;

create index if not exists payment_heads_initial_approval_roles_gin_idx
  on public.payment_heads using gin(initial_approval_role_ids);

create index if not exists payment_requests_current_approver_roles_gin_idx
  on public.payment_requests using gin(current_approver_role_ids);

commit;
