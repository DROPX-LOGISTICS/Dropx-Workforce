create table if not exists public.dropx_id_generation_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category text not null check (category in ('employee', 'field_executive', 'vendor', 'contractor', 'worker')),
  scope_type text not null check (scope_type in ('category', 'model', 'location', 'designation')),
  scope_key text not null,
  scope_label text,
  prefix text,
  separator text not null default '',
  suffix text,
  next_serial_no integer not null default 1 check (next_serial_no > 0),
  serial_digits integer not null default 3 check (serial_digits between 1 and 12),
  is_active boolean not null default true,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  constraint dropx_id_generation_settings_unique unique (company_id, category, scope_type, scope_key)
);

create index if not exists dropx_id_generation_settings_company_idx
  on public.dropx_id_generation_settings(company_id, category, scope_type, is_active);

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

create or replace function public.generate_dropx_worker_id(
  p_company_id uuid,
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
  selected_rule public.dropx_id_generation_settings%rowtype;
  serial_text text;
  generated_id text;
begin
  select *
    into selected_rule
    from public.dropx_id_generation_settings
   where company_id = p_company_id
     and category = p_category
     and is_active = true
     and (
       (scope_type = 'designation' and p_designation_id is not null and scope_key = p_designation_id::text)
       or (scope_type = 'location' and p_location_id is not null and scope_key = p_location_id::text)
       or (scope_type = 'model' and p_model_id is not null and scope_key = p_model_id::text)
       or (scope_type = 'category' and scope_key = p_category)
     )
   order by case scope_type
     when 'designation' then 1
     when 'location' then 2
     when 'model' then 3
     else 4
   end
   limit 1
   for update;

  if not found then
    return null;
  end if;

  serial_text := lpad(selected_rule.next_serial_no::text, selected_rule.serial_digits, '0');
  generated_id :=
    coalesce(selected_rule.prefix, '') ||
    case when coalesce(selected_rule.prefix, '') <> '' then coalesce(selected_rule.separator, '') else '' end ||
    serial_text ||
    case when coalesce(selected_rule.suffix, '') <> '' then coalesce(selected_rule.separator, '') || selected_rule.suffix else '' end;

  update public.dropx_id_generation_settings
     set next_serial_no = selected_rule.next_serial_no + 1,
         is_locked = true,
         updated_at = now()
   where id = selected_rule.id;

  return generated_id;
end;
$$;

grant execute on function public.generate_dropx_worker_id(uuid, text, uuid, uuid, uuid) to service_role;
