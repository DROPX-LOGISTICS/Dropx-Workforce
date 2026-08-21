alter table public.field_executive_provider_mappings
  add column if not exists contractor_id uuid references public.contractors(id) on delete restrict;

alter table public.field_executive_provider_mappings
  drop constraint if exists field_executive_provider_mappings_worker_check;

alter table public.field_executive_provider_mappings
  add constraint field_executive_provider_mappings_worker_check
  check (num_nonnulls(field_executive_id, employee_id, contractor_id) = 1);

create index if not exists field_executive_provider_mappings_contractor_idx
  on public.field_executive_provider_mappings (contractor_id, effective_from desc)
  where contractor_id is not null;
