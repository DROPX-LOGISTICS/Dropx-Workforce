begin;

create temp table restore_location_latlong (
  station_code text primary key,
  latitude numeric(10, 7) not null,
  longitude numeric(10, 7) not null
) on commit drop;

insert into restore_location_latlong (station_code, latitude, longitude) values
  ('HO', 11.1204389, 76.1130868),
  ('KGQA', 12.535151, 75.004059),
  ('TLPA', 11.9102417, 75.4914798),
  ('KTUB', 11.2718155, 76.2491261),
  ('KLZH', 11.698841, 76.259911),
  ('KOZA', 11.265875, 75.825172),
  ('KTUH', 11.190595, 76.268715),
  ('PEUA', 11.653251, 75.731018),
  ('PMB', 11.5347707, 75.7769557),
  ('CHM', 11.5674708, 75.8079335),
  ('KANA', 20.47283, 84.23824),
  ('JDBD', 19.09679, 81.96974),
  ('RPRN', 19.71938, 81.23864),
  ('DLB', 13.022024, 77.535679),
  ('JGBA', 19.60613, 81.67313),
  ('KDJE', 22.08218, 85.38572),
  ('QLDA', 11.4454926, 75.7275699),
  ('PHN', 20.3678479, 85.8911429),
  ('GNTI', 15.830694, 80.367722),
  ('GDRD', 14.130787, 79.865732),
  ('GNTF', 16.563688, 80.3589482),
  ('NLRF', 14.8838403, 79.9893785),
  ('NLRC', 14.536912, 79.875777),
  ('NLRE', 13.705667, 80.0135),
  ('GYMC', 13.6113055, 79.3308371),
  ('TIRC', 13.452736, 79.547899),
  ('JUGD', 21.86751, 83.99611),
  ('SPBE', 21.74555, 84.35396),
  ('KGQE', 11.690354, 75.658531),
  ('ERSE', 10.131122, 76.482803),
  ('TLPB', 11.98757, 75.646713),
  ('XAPI', 13.6494935, 79.1588394),
  ('KGQC', 12.439282, 75.029457),
  ('KDJG', 22.063312, 85.6706),
  ('XAPL', 15.8245921, 80.1918862),
  ('SBPD', 21.5012, 83.9439),
  ('JUGE', 21.7534196, 83.8674574),
  ('XAPH', 14.025064, 80.039818),
  ('TTA5', 17.475972, 78.418194),
  ('TTB3', 17.517913, 78.379277),
  ('TCC3', 13.002134, 80.248964),
  ('TCD4', 13.037006, 80.191457),
  ('MEP', 11.542053, 75.712847),
  ('KTUO', 10.05239, 76.63609),
  ('ERSN', 11.499292, 75.637566),
  ('TZC4', 26.462029, 80.341067),
  ('KLZA', 11.61979, 75.58657),
  ('KTUR', 11.195707, 76.261065);

do $$
begin
  if (select count(*) from restore_location_latlong) <> 48 then
    raise exception 'Latitude/longitude restore source count is not 48';
  end if;
end $$;

-- Only latitude and longitude are updated. No address, provider, model, email, status, or updated_at fields are changed.
update public.stations stations
set latitude = restore.latitude,
    longitude = restore.longitude
from restore_location_latlong restore
where stations.station_code = restore.station_code;

commit;

select
  count(*) as locations_with_latlong
from public.stations
where latitude is not null
  and longitude is not null;
