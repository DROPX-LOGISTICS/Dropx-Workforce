begin;

-- The canonical source constraint introduced in the previous release supports
-- Workforce, but the older value guard also needs to recognize that source.
-- This is schema-only and performs no production data rewrite.
alter table public.hr_engagements
  drop constraint if exists hr_engagements_worker_type_check;
alter table public.hr_engagements
  add constraint hr_engagements_worker_type_check
  check (worker_type in ('employee', 'contractor', 'workforce')) not valid;

notify pgrst, 'reload schema';

commit;
