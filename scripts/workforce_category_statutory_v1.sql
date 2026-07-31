begin;

alter table public.workforce_categories
  add column if not exists statutory_enabled boolean not null default false;

update public.workforce_categories
set statutory_enabled = true,
    updated_at = now()
where code = 'employees'
  and statutory_enabled = false;

commit;
