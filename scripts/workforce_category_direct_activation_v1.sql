begin;

alter table public.workforce_categories
  add column if not exists direct_activate boolean not null default false;

commit;

notify pgrst, 'reload schema';
