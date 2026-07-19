create extension if not exists pgcrypto;

create table if not exists public.field_executives (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  mobile text not null,
  email text not null,
  date_of_join date not null,
  location_id uuid not null references public.stations(id),
  dropx_id text,
  designation text,
  gender text,
  date_of_birth date,
  aadhaar_number text,
  pan_number text,
  address text,
  postal_pin text,
  landmark text,
  state_code text,
  father_name text,
  blood_group text,
  is_handicapped boolean not null default false,
  bank_account_no text,
  ifsc_code text,
  driving_license_no text,
  driving_license_exp_date date,
  vehicle_reg_no text,
  vehicle_reg_exp_date date,
  vehicle_insurance_exp_date date,
  vehicle_pollution_exp_date date,
  biometric_id text,
  emergency_contact_name text,
  emergency_contact_number text,
  emergency_contact_relation text,
  aadhaar_front_path text,
  aadhaar_back_path text,
  dl_front_path text,
  dl_back_path text,
  profile_photo_path text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_executives_mobile_format check (mobile ~ '^[0-9]{10}$')
);

alter table public.field_executives
  drop column if exists operation_mode_id;

alter table public.field_executives
  add column if not exists dropx_id text,
  add column if not exists designation text,
  add column if not exists gender text,
  add column if not exists date_of_birth date,
  add column if not exists aadhaar_number text,
  add column if not exists pan_number text,
  add column if not exists address text,
  add column if not exists postal_pin text,
  add column if not exists landmark text,
  add column if not exists state_code text,
  add column if not exists father_name text,
  add column if not exists blood_group text,
  add column if not exists is_handicapped boolean not null default false,
  add column if not exists bank_account_no text,
  add column if not exists ifsc_code text,
  add column if not exists driving_license_no text,
  add column if not exists driving_license_exp_date date,
  add column if not exists vehicle_reg_no text,
  add column if not exists vehicle_reg_exp_date date,
  add column if not exists vehicle_insurance_exp_date date,
  add column if not exists vehicle_pollution_exp_date date,
  add column if not exists biometric_id text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_number text,
  add column if not exists emergency_contact_relation text,
  add column if not exists aadhaar_front_path text,
  add column if not exists aadhaar_back_path text,
  add column if not exists dl_front_path text,
  add column if not exists dl_back_path text,
  add column if not exists profile_photo_path text;

alter table public.field_executives
  add column if not exists onboarding_token_hash text,
  add column if not exists onboarding_token_expires_at timestamptz,
  add column if not exists onboarding_status text not null default 'pending';

drop table if exists public.operation_modes;

create unique index if not exists field_executives_mobile_unique
  on public.field_executives (mobile);

create unique index if not exists field_executives_email_unique
  on public.field_executives (lower(email));

create index if not exists field_executives_location_id_idx
  on public.field_executives (location_id);

create unique index if not exists field_executives_dropx_id_unique
  on public.field_executives (dropx_id)
  where dropx_id is not null;

create or replace function public.prevent_field_executive_dropx_id_change()
returns trigger
language plpgsql
as $$
begin
  if new.dropx_id is distinct from old.dropx_id then
    raise exception 'DropX ID cannot be changed after creation.';
  end if;
  return new;
end;
$$;

drop trigger if exists field_executive_dropx_id_immutable on public.field_executives;
create trigger field_executive_dropx_id_immutable
before update of dropx_id on public.field_executives
for each row execute function public.prevent_field_executive_dropx_id_change();

drop index if exists field_executives_provider_external_id_idx;
drop index if exists field_executives_provider_member_id_idx;

alter table public.field_executives enable row level security;
