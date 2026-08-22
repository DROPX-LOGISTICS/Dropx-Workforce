begin;

alter table public.hr_exit_policies
  add column if not exists manager_approval_levels smallint not null default 2;
alter table public.hr_exit_policies
  drop constraint if exists hr_exit_policies_manager_levels_check;
alter table public.hr_exit_policies
  add constraint hr_exit_policies_manager_levels_check check (manager_approval_levels between 1 and 4);

alter table public.hr_exit_cases
  add column if not exists worker_type text not null default 'employee',
  add column if not exists contractor_id uuid references public.contractors(id) on delete restrict;
alter table public.hr_exit_cases alter column employee_id drop not null;
alter table public.hr_exit_cases drop constraint if exists hr_exit_cases_worker_type_check;
alter table public.hr_exit_cases add constraint hr_exit_cases_worker_type_check check (worker_type in ('employee', 'contractor'));
alter table public.hr_exit_cases drop constraint if exists hr_exit_cases_worker_identity_check;
alter table public.hr_exit_cases add constraint hr_exit_cases_worker_identity_check check (
  (worker_type = 'employee' and employee_id is not null and contractor_id is null)
  or (worker_type = 'contractor' and contractor_id is not null and employee_id is null)
);
create unique index if not exists hr_exit_cases_one_open_contractor_idx on public.hr_exit_cases(company_id, contractor_id)
  where worker_type = 'contractor' and status not in ('closed','rejected','withdrawn','cancelled');
create index if not exists hr_exit_cases_contractor_idx on public.hr_exit_cases(company_id, contractor_id, submitted_at desc);

create or replace function public.hr_validate_exit_company()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.worker_type = 'employee' then
    if not exists(select 1 from public.employees where id = new.employee_id and company_id = new.company_id) then
      raise exception 'Employee does not belong to the selected company';
    end if;
  elsif new.worker_type = 'contractor' then
    if not exists(select 1 from public.contractors where id = new.contractor_id and company_id = new.company_id) then
      raise exception 'Contractor does not belong to the selected company';
    end if;
  end if;
  if new.reason_id is not null and not exists(select 1 from public.hr_exit_reasons where id = new.reason_id and company_id = new.company_id and scenario in (new.scenario, 'other')) then
    raise exception 'Exit reason does not belong to the selected company';
  end if;
  return new;
end;
$$;

commit;
