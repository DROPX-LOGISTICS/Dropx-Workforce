alter table public.stations
  add column if not exists aom text,
  add column if not exists cluster_manager text;

update public.stations
set cluster_manager = cluster
where cluster_manager is null
  and cluster is not null;

create index if not exists stations_ops_hierarchy_idx
  on public.stations(company_id, region, aom, cluster_manager, cluster, station_code);
