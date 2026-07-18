alter table if exists public.stations
  add column if not exists latitude numeric(10, 7),
  add column if not exists longitude numeric(10, 7);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stations_latitude_range'
      and conrelid = 'public.stations'::regclass
  ) then
    alter table public.stations
      add constraint stations_latitude_range
      check (latitude is null or (latitude >= -90 and latitude <= 90));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'stations_longitude_range'
      and conrelid = 'public.stations'::regclass
  ) then
    alter table public.stations
      add constraint stations_longitude_range
      check (longitude is null or (longitude >= -180 and longitude <= 180));
  end if;
end $$;
