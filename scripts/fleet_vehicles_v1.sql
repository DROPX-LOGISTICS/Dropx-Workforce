create table if not exists public.fleet_vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_no text not null unique,
  station_code text not null,
  rc_location text,
  model text not null,
  fuel_type text not null,
  registration_expiry text,
  insurance_expiry text,
  puc_expiry text,
  fitness_expiry text,
  tax_expiry text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fleet_vehicles_station_idx on public.fleet_vehicles (station_code);
create index if not exists fleet_vehicles_status_idx on public.fleet_vehicles (status);

insert into public.fleet_vehicles (
  vehicle_no, station_code, rc_location, registration_expiry, insurance_expiry,
  puc_expiry, fitness_expiry, tax_expiry, model, fuel_type, status
)
values
('KL11BW5621','KOZA','KOZA','2037-08-23','2026-08-17',null,'2027-01-09','2027-06-30','OSM Range+','EV','active'),
('KL11BX0723','KOZA','PMB','2037-11-13','2026-11-14',null,'2027-03-13','2027-09-30','OSM Range+','EV','active'),
('KL11BX0806','KOZA','KOZA','2037-11-16','2026-11-14',null,'2026-12-11','2027-09-30','OSM Range+','EV','active'),
('KL11BY6479','KLZH','KOZA','2038-09-06','2026-09-03','2026-10-07','2027-10-08','2028-06-30','Mahindra Jeeto+','Diesel','active'),
('KL11BZ0701','KTUB','KLZH','As per Fitness','2026-11-20','2026-11-19','2025-11-22','2028-09-30','Piaggio Ape Xtra LDX','Diesel','active'),
('KL11BZ0772','KTUB','RTO Agent','As per Fitness','2026-12-02','2027-03-01','2028-03-16','2028-09-30','Piaggio Ape Xtra LDX','Diesel','active'),
('KL11BZ1869','ERSE','PMB','As per Fitness','2026-12-09','2026-12-09','2028-01-12','2028-09-30','Mahindra Jeeto+','Diesel','active'),
('KL11BZ1872','ERSE','PMB','As per Fitness','2026-12-11','2027-01-07','2028-01-08','2028-09-30','Mahindra Jeeto+','Diesel','active'),
('KL11BZ1894','KOZA','KOZA','As per Fitness','2026-12-26','2026-12-25','2027-12-29','2028-09-30','Mahindra Jeeto Strong','Diesel','active'),
('KL11BZ9896','PEUA','KOZA','As per Fitness','2027-05-13','2026-05-16','2026-05-17','2029-03-31','Piaggio Ape Xtra LDX','Diesel','active'),
('KL11CA1432','TLPA','KOZA','As per Fitness','2027-05-13','2026-06-10','2026-06-12','2029-03-31','Piaggio Ape Xtra LDX','CNG','active'),
('KL11CA5156','KGQA','KOZA','As per Fitness','2026-08-18','2026-08-25','2026-08-23','2029-06-30','Piaggio Ape Xtra LDX','Diesel','active'),
('KL60S6982','ERSN','ERSN','2036-04-16','2026-04-15','2027-02-04','2028-02-09','2026-03-31','TATA Ace Gold','Petrol','active'),
('KL11CB7565','KGQA','Digital','As per Fitness','2027-04-01','2026-04-02','2027-04-02','2029-12-31','Mahindra Jeeto Strong','Diesel','active'),
('KL11CB7606','KOZA','Digital','As per Fitness','2027-04-01','2027-04-20','2027-04-03','2029-12-31','Mahindra Jeeto Strong','Diesel','active'),
('KL11CB7682','KTUB','Digital','As per Fitness','2027-04-01','2027-04-19','2027-04-02','2029-12-31','Mahindra Jeeto Strong','Diesel','active'),
('KL11CB8204','QLDA','Digital','As per Fitness','2027-04-16','2026-04-18','2027-04-18','2030-03-31','Mahindra Jeeto Strong','Diesel','active'),
('KL11CB8252','PEUA','Digital','As per Fitness','2027-04-16','2026-04-18','2027-04-18','2030-03-31','Mahindra Jeeto Strong','Diesel','active'),
('KL11CC2822','TLPB','Digital','As per Fitness','2026-07-09','2026-07-16','2027-07-16','2030-06-30','Mahindra Jeeto Strong','Diesel','active'),
('KL11CC2815','TLPB','Digital','As per Fitness','2026-07-04','2026-07-16','2027-07-16','2030-06-30','Mahindra Jeeto Strong','Diesel','active'),
('KL11CC2857','TLPB','Digital','As per Fitness','2026-07-06','2026-07-16','2027-07-16','2030-06-30','Mahindra Jeeto Strong','Diesel','active'),
('KL11CC2832','TLPA','Digital','As per Fitness','2026-07-09','2026-07-16','2027-07-16','2030-06-30','Mahindra Jeeto Strong','Diesel','active'),
('KL11CC2749','QLDA','Digital','As per Fitness','2026-07-09','2026-07-15','2027-07-15','2030-06-30','Mahindra Jeeto Strong','Diesel','active'),
('KL11CC2758','QLDA','Digital','As per Fitness','2026-07-09','2026-07-15','2027-07-15','2030-06-30','Mahindra Jeeto Strong','Diesel','active'),
('KL11CC2792','KGQA','Digital','As per Fitness','2026-07-04','2026-07-15','2027-07-15','2030-06-30','Mahindra Jeeto Strong','Diesel','active'),
('KL11CC3037','ERSE','Digital','As per Fitness','2026-07-18','2026-07-21','2027-07-21','2030-06-30','Mahindra Jeeto Strong','Diesel','active'),
('KL11CC3093','ERSE','Digital','As per Fitness','2026-07-20','2026-07-21','2027-07-21','2030-06-30','Mahindra Jeeto Strong','Diesel','active'),
('KL11CC3048','PMB','Digital','As per Fitness','2026-07-20','2026-07-21','2027-07-21','2030-06-30','Mahindra Jeeto Strong','Diesel','active'),
('KL11CC3016','ERSE','Digital','As per Fitness','2026-07-20','2026-07-21','2027-07-21','2030-06-30','Mahindra Jeeto Strong','Diesel','active'),
('KL11CC3098','ERSE','Digital','As per Fitness','2026-07-20','2026-07-21','2027-07-21','2030-06-30','Mahindra Jeeto Strong','Diesel','active'),
('KL11CC3058','ERSE','Digital','As per Fitness','2026-07-20','2026-07-21','2027-07-21','2030-06-30','Mahindra Jeeto Strong','Diesel','active'),
('KL11CC3081','ERSE','Digital','As per Fitness','2026-07-18','2026-07-21','2027-07-21','2030-06-30','Mahindra Jeeto Strong','Diesel','active')
on conflict (vehicle_no) do update set
  station_code = excluded.station_code,
  rc_location = excluded.rc_location,
  registration_expiry = excluded.registration_expiry,
  insurance_expiry = excluded.insurance_expiry,
  puc_expiry = excluded.puc_expiry,
  fitness_expiry = excluded.fitness_expiry,
  tax_expiry = excluded.tax_expiry,
  model = excluded.model,
  fuel_type = excluded.fuel_type,
  updated_at = now();
