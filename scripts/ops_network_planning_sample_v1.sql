-- Optional development/demo seed. This file does not add a station and does not run automatically.
-- Call only with an existing, confirmed OpsPulse station:
-- select public.seed_ops_network_planning_sample('<company-uuid>', '<station-uuid>', 'STATION_CODE');

create or replace function public.seed_ops_network_planning_sample(
  target_company_id uuid,
  target_station_id uuid,
  target_station_code text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  sector_a uuid;
  sector_b uuid;
  sector_c uuid;
begin
  if not exists (
    select 1 from public.stations
    where id = target_station_id
      and company_id = target_company_id
      and upper(station_code) = upper(target_station_code)
      and is_active is true
  ) then
    raise exception 'The sample target must be an active station already present in OpsPulse.';
  end if;

  insert into public.ops_network_sectors(company_id, station_id, code, name, color, expected_daily_volume, bike_volume_percent, notes)
  values
    (target_company_id, target_station_id, 'NORTH', 'North Sector', '#2563eb', 500, 80, 'Sample sector'),
    (target_company_id, target_station_id, 'CENTRAL', 'Central Sector', '#7c3aed', 620, 60, 'Sample sector'),
    (target_company_id, target_station_id, 'SOUTH', 'South Sector', '#ea580c', 430, 70, 'Sample sector')
  on conflict (company_id, station_id, code) do update set
    name = excluded.name,
    color = excluded.color,
    expected_daily_volume = excluded.expected_daily_volume,
    bike_volume_percent = excluded.bike_volume_percent,
    is_active = true,
    updated_at = now();

  select id into sector_a from public.ops_network_sectors where company_id = target_company_id and station_id = target_station_id and code = 'NORTH';
  select id into sector_b from public.ops_network_sectors where company_id = target_company_id and station_id = target_station_id and code = 'CENTRAL';
  select id into sector_c from public.ops_network_sectors where company_id = target_company_id and station_id = target_station_id and code = 'SOUTH';

  insert into public.ops_network_sector_pincodes(company_id, station_id, sector_id, pincode, notes)
  values
    (target_company_id, target_station_id, sector_a, '999001', 'Sample only'),
    (target_company_id, target_station_id, sector_a, '999002', 'Sample only'),
    (target_company_id, target_station_id, sector_a, '999003', 'Sample only'),
    (target_company_id, target_station_id, sector_a, '999004', 'Sample only'),
    (target_company_id, target_station_id, sector_b, '999005', 'Sample only'),
    (target_company_id, target_station_id, sector_b, '999006', 'Sample only'),
    (target_company_id, target_station_id, sector_b, '999007', 'Sample only'),
    (target_company_id, target_station_id, sector_b, '999008', 'Sample only'),
    (target_company_id, target_station_id, sector_c, '999009', 'Sample only'),
    (target_company_id, target_station_id, sector_c, '999010', 'Sample only'),
    (target_company_id, target_station_id, sector_c, '999011', 'Sample only'),
    (target_company_id, target_station_id, sector_c, '999012', 'Sample only')
  on conflict (company_id, station_id, sector_id, pincode, effective_from) do nothing;

  insert into public.ops_route_plans(company_id, station_id, sector_id, plan_date, route_code, route_name, pincodes, expected_volume, vehicle_type, status, notes)
  values
    (target_company_id, target_station_id, sector_a, current_date, 'N-01', 'North Bike Route', array['999001','999002'], 260, 'bike', 'published', 'Sample route'),
    (target_company_id, target_station_id, sector_a, current_date, 'N-02', 'North Mixed Route', array['999003','999004'], 240, 'mixed', 'published', 'Sample route'),
    (target_company_id, target_station_id, sector_b, current_date, 'C-01', 'Central Bike Route', array['999005','999006'], 330, 'bike', 'published', 'Sample route'),
    (target_company_id, target_station_id, sector_b, current_date, 'C-02', 'Central Van Route', array['999007','999008'], 290, 'van', 'published', 'Sample route'),
    (target_company_id, target_station_id, sector_c, current_date, 'S-01', 'South Bike Route', array['999009','999010'], 220, 'bike', 'published', 'Sample route'),
    (target_company_id, target_station_id, sector_c, current_date, 'S-02', 'South Mixed Route', array['999011','999012'], 210, 'mixed', 'draft', 'Sample route')
  on conflict (company_id, station_id, plan_date, route_code) do update set
    route_name = excluded.route_name,
    pincodes = excluded.pincodes,
    expected_volume = excluded.expected_volume,
    vehicle_type = excluded.vehicle_type,
    status = excluded.status,
    updated_at = now();
end;
$$;

revoke all on function public.seed_ops_network_planning_sample(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.seed_ops_network_planning_sample(uuid, uuid, text) to service_role;
