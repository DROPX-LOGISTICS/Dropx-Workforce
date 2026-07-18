create extension if not exists pgcrypto;

create table if not exists public.connect_user_pins (
  id uuid primary key default gen_random_uuid(),
  country_code text not null default '91',
  mobile_number text not null,
  pin_hash text not null,
  attempt_count integer not null default 0,
  locked_until timestamptz,
  reset_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connect_user_pins_pin_attempts_check check (attempt_count >= 0)
);

create unique index if not exists connect_user_pins_mobile_unique
  on public.connect_user_pins (country_code, mobile_number);

create table if not exists public.connect_login_sessions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null default '91',
  mobile_number text not null,
  session_hash text not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  request_ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index if not exists connect_login_sessions_hash_unique
  on public.connect_login_sessions (session_hash);

create index if not exists connect_login_sessions_mobile_idx
  on public.connect_login_sessions (country_code, mobile_number, expires_at desc);

alter table public.connect_user_pins enable row level security;
alter table public.connect_login_sessions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'connect_user_pins'
      and policyname = 'service_role_connect_user_pins_all'
  ) then
    create policy "service_role_connect_user_pins_all"
      on public.connect_user_pins
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'connect_login_sessions'
      and policyname = 'service_role_connect_login_sessions_all'
  ) then
    create policy "service_role_connect_login_sessions_all"
      on public.connect_login_sessions
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;
