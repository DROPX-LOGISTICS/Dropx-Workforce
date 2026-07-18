alter table public.designations
  add column if not exists location_ids uuid[] not null default '{}';

create index if not exists designations_location_ids_idx
  on public.designations using gin(location_ids);
