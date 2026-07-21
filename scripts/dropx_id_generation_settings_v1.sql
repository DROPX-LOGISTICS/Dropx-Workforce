create table if not exists public.dropx_id_generation_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  setting_type text not null default 'dropx_id' check (setting_type in ('dropx_id', 'biometric_id')),
  scope_type text not null default 'category' check (scope_type in ('company', 'category', 'model', 'location', 'designation')),
  configs jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  constraint dropx_id_generation_settings_one_per_type unique (company_id, setting_type)
);

alter table public.dropx_id_generation_settings
  add column if not exists setting_type text not null default 'dropx_id',
  add column if not exists scope_type text not null default 'category',
  add column if not exists configs jsonb not null default '{}'::jsonb,
  add column if not exists is_active boolean not null default true,
  add column if not exists is_locked boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dropx_id_generation_settings'
      and column_name = 'category'
  ) then
    alter table public.dropx_id_generation_settings
      drop constraint if exists dropx_id_generation_settings_unique;

    update public.dropx_id_generation_settings
       set setting_type = 'dropx_id'
     where setting_type is null;

    with first_rows as (
      select distinct on (company_id, setting_type)
             id,
             company_id,
             setting_type,
             scope_type
        from public.dropx_id_generation_settings
       order by company_id, setting_type, created_at, id
    ),
    merged as (
      select first_rows.id,
             first_rows.scope_type,
             jsonb_object_agg(
               rows.scope_key,
               jsonb_build_object(
                 'label', coalesce(rows.scope_label, rows.scope_key),
                 'prefix', rows.prefix,
                 'separator', rows.separator,
                 'suffix', rows.suffix,
                 'next_serial_no', rows.next_serial_no,
                 'serial_digits', rows.serial_digits
               )
             ) as configs,
             bool_or(rows.is_active) as is_active,
             bool_or(rows.is_locked) as is_locked,
             max(rows.updated_at) as updated_at
        from first_rows
        join public.dropx_id_generation_settings rows
          on rows.company_id = first_rows.company_id
         and rows.setting_type = first_rows.setting_type
         and rows.scope_type = first_rows.scope_type
       group by first_rows.id, first_rows.scope_type
    )
    update public.dropx_id_generation_settings settings
       set scope_type = merged.scope_type,
           configs = merged.configs,
           is_active = merged.is_active,
           is_locked = merged.is_locked,
           updated_at = merged.updated_at
      from merged
     where settings.id = merged.id;

    delete from public.dropx_id_generation_settings rows
     where rows.id not in (
       select distinct on (company_id, setting_type) id
         from public.dropx_id_generation_settings
        order by company_id, setting_type, created_at, id
     );

    alter table public.dropx_id_generation_settings
      drop column if exists category,
      drop column if exists scope_key,
      drop column if exists scope_label,
      drop column if exists prefix,
      drop column if exists separator,
      drop column if exists suffix,
      drop column if exists next_serial_no,
      drop column if exists serial_digits;
  end if;
end $$;

alter table public.dropx_id_generation_settings
  drop constraint if exists dropx_id_generation_settings_scope_type_check;

alter table public.dropx_id_generation_settings
  add constraint dropx_id_generation_settings_scope_type_check
  check (scope_type in ('company', 'category', 'model', 'location', 'designation'));

create unique index if not exists dropx_id_generation_settings_one_per_type_idx
  on public.dropx_id_generation_settings(company_id, setting_type);

create index if not exists dropx_id_generation_settings_company_idx
  on public.dropx_id_generation_settings(company_id, setting_type, is_active);

alter table public.dropx_id_generation_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'dropx_id_generation_settings'
      and policyname = 'service_role_dropx_id_generation_settings_all'
  ) then
    create policy "service_role_dropx_id_generation_settings_all"
      on public.dropx_id_generation_settings
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

create or replace function public.generate_configured_worker_id(
  p_company_id uuid,
  p_setting_type text,
  p_category text,
  p_location_id uuid default null,
  p_model_id uuid default null,
  p_designation_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_setting public.dropx_id_generation_settings%rowtype;
  selected_key text;
  selected_config jsonb;
  selected_prefix text;
  selected_separator text;
  selected_suffix text;
  selected_serial integer;
  selected_digits integer;
  serial_text text;
  generated_id text;
begin
  select *
    into selected_setting
    from public.dropx_id_generation_settings
   where company_id = p_company_id
     and setting_type = p_setting_type
     and is_active = true
   limit 1
   for update;

  if not found then
    return null;
  end if;

  selected_key := case selected_setting.scope_type
    when 'designation' then p_designation_id::text
    when 'location' then p_location_id::text
    when 'model' then p_model_id::text
    when 'company' then 'company'
    else p_category
  end;

  if selected_key is null or selected_key = '' then
    return null;
  end if;

  selected_config := selected_setting.configs -> selected_key;
  if selected_config is null then
    return null;
  end if;

  selected_prefix := nullif(selected_config ->> 'prefix', '');
  selected_separator := coalesce(selected_config ->> 'separator', '');
  selected_suffix := nullif(selected_config ->> 'suffix', '');
  selected_serial := greatest(coalesce((selected_config ->> 'next_serial_no')::integer, 1), 1);
  selected_digits := least(greatest(coalesce((selected_config ->> 'serial_digits')::integer, 3), 1), 12);
  serial_text := lpad(selected_serial::text, selected_digits, '0');
  generated_id :=
    coalesce(selected_prefix, '') ||
    case when coalesce(selected_prefix, '') <> '' then selected_separator else '' end ||
    serial_text ||
    case when coalesce(selected_suffix, '') <> '' then selected_separator || selected_suffix else '' end;

  update public.dropx_id_generation_settings
     set configs = jsonb_set(
           configs,
           array[selected_key, 'next_serial_no'],
           to_jsonb(selected_serial + 1),
           true
         ),
         is_locked = true,
         updated_at = now()
   where id = selected_setting.id;

  return generated_id;
end;
$$;

create or replace function public.generate_dropx_worker_id(
  p_company_id uuid,
  p_category text,
  p_location_id uuid default null,
  p_model_id uuid default null,
  p_designation_id uuid default null
)
returns text
language sql
security definer
set search_path = public
as $$
  select public.generate_configured_worker_id(
    p_company_id,
    'dropx_id',
    p_category,
    p_location_id,
    p_model_id,
    p_designation_id
  );
$$;

create or replace function public.generate_biometric_worker_id(
  p_company_id uuid,
  p_category text,
  p_location_id uuid default null,
  p_model_id uuid default null,
  p_designation_id uuid default null
)
returns text
language sql
security definer
set search_path = public
as $$
  select public.generate_configured_worker_id(
    p_company_id,
    'biometric_id',
    p_category,
    p_location_id,
    p_model_id,
    p_designation_id
  );
$$;

grant execute on function public.generate_configured_worker_id(uuid, text, text, uuid, uuid, uuid) to service_role;
grant execute on function public.generate_dropx_worker_id(uuid, text, uuid, uuid, uuid) to service_role;
grant execute on function public.generate_biometric_worker_id(uuid, text, uuid, uuid, uuid) to service_role;
