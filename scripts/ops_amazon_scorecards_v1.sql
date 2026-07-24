create table if not exists public.ops_amazon_scorecards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.stations(id) on delete set null,
  station_code text not null,
  report_type text not null check (report_type in ('daily_report', 'weekly_sla')),
  period_from date not null,
  period_to date not null,
  overall_score numeric(8,2),
  remarks text,
  attachment jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists ops_amazon_scorecards_company_station_period_idx
  on public.ops_amazon_scorecards(company_id, station_code, period_to desc);

alter table public.ops_amazon_scorecards enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ops_amazon_scorecards'
      and policyname = 'ops_amazon_scorecards_service_role_all'
  ) then
    create policy ops_amazon_scorecards_service_role_all
      on public.ops_amazon_scorecards
      for all to service_role
      using (true) with check (true);
  end if;
end $$;
