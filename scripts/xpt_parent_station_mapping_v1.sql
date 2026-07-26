alter table public.stations
  add column if not exists parent_station_id uuid references public.stations(id) on delete set null;

create index if not exists stations_parent_station_id_idx
  on public.stations(company_id, parent_station_id);

alter table public.report_import_batches
  add column if not exists station_code text;

create index if not exists report_import_batches_station_period_idx
  on public.report_import_batches(company_id, source_type, station_code, report_from, report_to);

-- Seed existing XPT mappings from the maintained parent station email where it
-- unambiguously matches an active station code. Future changes are made in
-- Station Master and do not require code changes.
update public.stations child
set parent_station_id = parent.id
from public.location_models child_model,
     public.stations parent
where child.location_model_id = child_model.id
  and child.company_id = parent.company_id
  and upper(child_model.code) = 'XPT'
  and lower(split_part(child.station_email, '@', 1)) = lower(parent.station_code)
  and child.id <> parent.id
  and child.parent_station_id is null;
