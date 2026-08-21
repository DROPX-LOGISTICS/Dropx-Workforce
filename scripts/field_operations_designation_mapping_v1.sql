alter table public.designations
  add column if not exists is_field_operations boolean not null default false;

alter table public.field_executive_provider_mappings
  add column if not exists employee_id uuid references public.employees(id) on delete restrict;

alter table public.field_executive_provider_mappings
  alter column field_executive_id drop not null;

alter table public.field_executive_provider_mappings
  drop constraint if exists field_executive_provider_mappings_worker_check;

alter table public.field_executive_provider_mappings
  add constraint field_executive_provider_mappings_worker_check
  check (num_nonnulls(field_executive_id, employee_id) = 1);

create index if not exists field_executive_provider_mappings_employee_idx
  on public.field_executive_provider_mappings (employee_id, effective_from desc)
  where employee_id is not null;

comment on column public.designations.is_field_operations is
  'When true, active people assigned to this designation appear in ID & Pay Mapping.';
