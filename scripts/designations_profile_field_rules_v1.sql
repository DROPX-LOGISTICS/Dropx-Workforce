alter table public.designations
  add column if not exists profile_field_rules jsonb not null default '{}'::jsonb;
