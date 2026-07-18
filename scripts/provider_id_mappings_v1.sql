create extension if not exists pgcrypto;

create table if not exists public.field_executive_provider_mappings (
  id uuid primary key default gen_random_uuid(),
  field_executive_id uuid not null references public.field_executives(id) on delete restrict,
  provider_id uuid not null references public.providers(id),
  station_id uuid references public.stations(id),
  provider_member_id text not null,
  effective_from date not null,
  effective_to date,
  payment_method_id uuid references public.payment_methods(id),
  payment_values jsonb not null default '{}'::jsonb,
  pay_type text not null,
  delivery_rate numeric(12, 2),
  pickup_rate numeric(12, 2),
  mfn_rate numeric(12, 2),
  mfn_return_rate numeric(12, 2),
  guarantee_amount numeric(12, 2),
  guarantee_schedule text,
  fuel_rate numeric(12, 2),
  reason text,
  status text not null default 'active',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_executive_provider_mappings_date_order check (effective_to is null or effective_to >= effective_from),
  constraint field_executive_provider_mappings_status_check check (status in ('active', 'closed', 'cancelled'))
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'field_executive_provider_mappings'
      and column_name = 'provider_external_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'field_executive_provider_mappings'
      and column_name = 'provider_member_id'
  ) then
    alter table public.field_executive_provider_mappings rename column provider_external_id to provider_member_id;
  end if;
end $$;

alter table public.field_executive_provider_mappings
  add column if not exists field_executive_id uuid references public.field_executives(id) on delete restrict,
  add column if not exists provider_id uuid references public.providers(id),
  add column if not exists station_id uuid references public.stations(id),
  add column if not exists provider_member_id text,
  add column if not exists effective_from date,
  add column if not exists effective_to date,
  add column if not exists payment_method_id uuid references public.payment_methods(id),
  add column if not exists payment_values jsonb not null default '{}'::jsonb,
  add column if not exists pay_type text,
  add column if not exists delivery_rate numeric(12, 2),
  add column if not exists pickup_rate numeric(12, 2),
  add column if not exists mfn_rate numeric(12, 2),
  add column if not exists mfn_return_rate numeric(12, 2),
  add column if not exists guarantee_amount numeric(12, 2),
  add column if not exists guarantee_schedule text,
  add column if not exists fuel_rate numeric(12, 2),
  add column if not exists reason text,
  add column if not exists status text not null default 'active',
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'field_executives'
      and column_name = 'provider_external_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'field_executives'
      and column_name = 'provider_member_id'
  ) then
    alter table public.field_executives rename column provider_external_id to provider_member_id;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'field_executives'
      and column_name = 'provider_member_id'
  ) then
    execute $migration$
      insert into public.field_executive_provider_mappings (
        field_executive_id,
        provider_id,
        station_id,
        provider_member_id,
        effective_from,
        effective_to,
        pay_type,
        delivery_rate,
        pickup_rate,
        mfn_rate,
        mfn_return_rate,
        guarantee_amount,
        guarantee_schedule,
        fuel_rate,
        reason,
        status,
        created_by,
        created_at,
        updated_at
      )
      select
        fe.id,
        coalesce(fe.provider_id, st.provider_id),
        fe.location_id,
        fe.provider_member_id,
        coalesce(fe.mapping_effective_from, fe.date_of_join),
        fe.mapping_effective_to,
        fe.pay_type,
        fe.delivery_rate,
        fe.pickup_rate,
        fe.mfn_rate,
        fe.mfn_return_rate,
        fe.guarantee_amount,
        fe.guarantee_schedule,
        fe.fuel_rate,
        fe.mapping_notes,
        case when fe.mapping_effective_to is null then 'active' else 'closed' end,
        fe.created_by,
        fe.created_at,
        now()
      from public.field_executives fe
      left join public.stations st on st.id = fe.location_id
      where coalesce(fe.provider_id, st.provider_id) is not null
        and fe.provider_member_id is not null
        and fe.pay_type is not null
        and not exists (
          select 1
          from public.field_executive_provider_mappings existing
          where existing.field_executive_id = fe.id
            and existing.provider_id = coalesce(fe.provider_id, st.provider_id)
            and existing.provider_member_id = fe.provider_member_id
            and existing.effective_from = coalesce(fe.mapping_effective_from, fe.date_of_join)
        );
    $migration$;
  end if;
end $$;

create index if not exists field_executive_provider_mappings_field_exec_idx
  on public.field_executive_provider_mappings (field_executive_id, effective_from desc);

create index if not exists field_executive_provider_mappings_lookup_idx
  on public.field_executive_provider_mappings (provider_id, provider_member_id, effective_from, effective_to);

create index if not exists field_executive_provider_mappings_station_idx
  on public.field_executive_provider_mappings (station_id);

drop index if exists provider_id_mappings_lookup_idx;
drop index if exists provider_id_mappings_dropx_id_idx;
drop index if exists provider_id_mappings_one_current_idx;

create unique index if not exists field_executive_provider_mappings_one_current_member_idx
  on public.field_executive_provider_mappings (provider_id, provider_member_id)
  where effective_to is null and status = 'active';

alter table public.field_executive_provider_mappings enable row level security;

alter table public.field_executives
  drop column if exists provider_id,
  drop column if exists provider_external_id,
  drop column if exists provider_member_id,
  drop column if exists mapping_effective_from,
  drop column if exists mapping_effective_to,
  drop column if exists pay_type,
  drop column if exists delivery_rate,
  drop column if exists pickup_rate,
  drop column if exists mfn_rate,
  drop column if exists mfn_return_rate,
  drop column if exists guarantee_amount,
  drop column if exists guarantee_schedule,
  drop column if exists fuel_rate,
  drop column if exists mapping_notes;
