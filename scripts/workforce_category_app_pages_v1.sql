alter table public.workforce_categories
  add column if not exists app_page_access text[] not null
  default array['dashboard', 'attendance', 'settings']::text[];

update public.workforce_categories
set app_page_access = array['dashboard', 'attendance', 'settings']::text[]
where app_page_access is null;

notify pgrst, 'reload schema';
