alter table public.stations
  add column if not exists hide_from_location_list boolean not null default false;

create index if not exists stations_company_hidden_idx
  on public.stations (company_id, hide_from_location_list, is_active);
