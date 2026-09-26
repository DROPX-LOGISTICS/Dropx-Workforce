begin;

-- Editable Amazon station catalog (seeded from ops list; add/edit/delete in UI — not hardcoded in app).
create table if not exists public.workforce_amazon_station_catalog (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  station_code text not null check (station_code ~ '^[A-Z0-9_-]{2,24}$'),
  display_name text,
  notes text,
  station_id uuid references public.stations(id),
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, station_code)
);
create index if not exists workforce_amazon_station_catalog_active
  on public.workforce_amazon_station_catalog(company_id, is_active, sort_order, station_code);
alter table public.workforce_amazon_station_catalog enable row level security;
revoke all on public.workforce_amazon_station_catalog from public, anon, authenticated;
grant select, insert, update, delete on public.workforce_amazon_station_catalog to service_role;

-- Supervisors can own many stations.
create table if not exists public.workforce_amazon_supervisors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  supervisor_alias text not null check (supervisor_alias ~ '^[a-zA-Z0-9._-]{2,80}$'),
  display_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, supervisor_alias)
);
alter table public.workforce_amazon_supervisors enable row level security;
revoke all on public.workforce_amazon_supervisors from public, anon, authenticated;
grant select, insert, update, delete on public.workforce_amazon_supervisors to service_role;

create table if not exists public.workforce_amazon_supervisor_stations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  supervisor_id uuid not null references public.workforce_amazon_supervisors(id) on delete cascade,
  station_code text not null check (station_code ~ '^[A-Z0-9_-]{2,24}$'),
  created_at timestamptz not null default now(),
  unique (company_id, station_code)
);
create index if not exists workforce_amazon_supervisor_stations_supervisor
  on public.workforce_amazon_supervisor_stations(company_id, supervisor_id);
alter table public.workforce_amazon_supervisor_stations enable row level security;
revoke all on public.workforce_amazon_supervisor_stations from public, anon, authenticated;
grant select, insert, update, delete on public.workforce_amazon_supervisor_stations to service_role;

-- Seed catalog for every company from the current DropX Amazon network list.
with seed(code, notes, sort_order) as (
  values
    ('KTUB', null, 10),
    ('KTUR', null, 20),
    ('KOZA', null, 30),
    ('KTUO', null, 40),
    ('KLZA', null, 50),
    ('QLDA', null, 60),
    ('PEUA', null, 70),
    ('KGQE', null, 80),
    ('KBWE', null, 90),
    ('KGQA', null, 100),
    ('KGQC', null, 110),
    ('TLPA', null, 120),
    ('TLPB', null, 130),
    ('KLZH', null, 140),
    ('GNTI', null, 150),
    ('GNTF', null, 160),
    ('NLRC', null, 170),
    ('NLRF', null, 180),
    ('XAPL', null, 190),
    ('GDRD', null, 200),
    ('NLRE', null, 210),
    ('XAPH', 'XPT', 220),
    ('GYMC', null, 230),
    ('TIRC', null, 240),
    ('XAPI', null, 250),
    ('JDBD', null, 260),
    ('JGBA', null, 270),
    ('RPRN', null, 280),
    ('JUGD', null, 290),
    ('SPBE', null, 300),
    ('JUGF', null, 310),
    ('KDJE', null, 320),
    ('KDJG', null, 330),
    ('KANA', null, 340),
    ('HBSC', null, 350)
)
insert into public.workforce_amazon_station_catalog(company_id, station_code, notes, sort_order, station_id, display_name)
select
  c.id,
  seed.code,
  seed.notes,
  seed.sort_order,
  s.id,
  coalesce(s.station_name, seed.code)
from public.companies c
cross join seed
left join public.stations s
  on s.company_id = c.id
 and upper(s.station_code) = seed.code
on conflict (company_id, station_code) do update
set
  notes = coalesce(excluded.notes, public.workforce_amazon_station_catalog.notes),
  sort_order = excluded.sort_order,
  station_id = coalesce(excluded.station_id, public.workforce_amazon_station_catalog.station_id),
  display_name = coalesce(excluded.display_name, public.workforce_amazon_station_catalog.display_name),
  updated_at = now();

-- Seed supervisor anbaba and attach all catalog stations for each company.
insert into public.workforce_amazon_supervisors(company_id, supervisor_alias, display_name)
select c.id, 'anbaba', 'Amazon supervisor'
from public.companies c
on conflict (company_id, supervisor_alias) do update
set display_name = excluded.display_name, is_active = true, updated_at = now();

insert into public.workforce_amazon_supervisor_stations(company_id, supervisor_id, station_code)
select cat.company_id, sup.id, cat.station_code
from public.workforce_amazon_station_catalog cat
join public.workforce_amazon_supervisors sup
  on sup.company_id = cat.company_id
 and lower(sup.supervisor_alias) = 'anbaba'
where cat.is_active
on conflict (company_id, station_code) do nothing;

-- Keep company default supervisor table in sync.
insert into public.workforce_amazon_supervisor_defaults(company_id, supervisor_alias)
select c.id, 'anbaba'
from public.companies c
on conflict (company_id) do update
set supervisor_alias = 'anbaba', updated_at = now();

-- Resolve supervisor for a station code (multi-station map first, then station settings, then company default).
create or replace function public.workforce_amazon_supervisor_for_station(
  p_company uuid,
  p_station_code text
) returns text language plpgsql stable set search_path='' as $$
declare alias text; code text;
begin
  code := upper(btrim(coalesce(p_station_code,'')));
  if code = '' then
    select supervisor_alias into alias from public.workforce_amazon_supervisor_defaults where company_id=p_company;
    return coalesce(alias, 'anbaba');
  end if;
  select s.supervisor_alias into alias
  from public.workforce_amazon_supervisor_stations m
  join public.workforce_amazon_supervisors s on s.id=m.supervisor_id and s.company_id=m.company_id
  where m.company_id=p_company and m.station_code=code and s.is_active
  limit 1;
  if alias is not null then return alias; end if;
  select cfg.supervisor_alias into alias
  from public.workforce_amazon_station_settings cfg
  join public.stations st on st.id=cfg.station_id and st.company_id=cfg.company_id
  where cfg.company_id=p_company and upper(st.station_code)=code
  limit 1;
  if alias is not null and btrim(alias)<>'' then return alias; end if;
  select supervisor_alias into alias from public.workforce_amazon_supervisor_defaults where company_id=p_company;
  return coalesce(nullif(btrim(alias),''), 'anbaba');
end $$;
revoke all on function public.workforce_amazon_supervisor_for_station(uuid,text) from public,anon,authenticated;
grant execute on function public.workforce_amazon_supervisor_for_station(uuid,text) to service_role;

commit;
