alter table public.fleet_vehicles
  add column if not exists transfer_date date,
  add column if not exists sale_date date,
  add column if not exists dispose_date date;

