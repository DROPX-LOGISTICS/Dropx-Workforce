alter table public.designations
  add column if not exists app_page_access text[] not null
  default array['dashboard', 'attendance', 'leave']::text[];

update public.designations
set app_page_access = array['dashboard', 'attendance', 'leave']::text[]
where app_page_access is null;

create index if not exists designations_app_page_access_idx
  on public.designations using gin(app_page_access);

notify pgrst, 'reload schema';
