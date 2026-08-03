begin;

alter table public.payment_heads
  add column if not exists initial_approval_role_id uuid references public.user_roles(id) on delete set null;

create index if not exists payment_heads_initial_approval_role_idx
  on public.payment_heads(company_id, initial_approval_role_id);

commit;
