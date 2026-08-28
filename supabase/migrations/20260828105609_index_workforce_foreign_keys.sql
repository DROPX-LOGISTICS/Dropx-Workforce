begin;

create index if not exists workforce_location_id_idx
  on public.workforce(location_id);
create index if not exists workforce_created_by_idx
  on public.workforce(created_by) where created_by is not null;
create index if not exists workforce_deactivated_by_idx
  on public.workforce(deactivated_by) where deactivated_by is not null;
create index if not exists workforce_deleted_by_idx
  on public.workforce(deleted_by) where deleted_by is not null;
create index if not exists workforce_department_id_idx
  on public.workforce(department_id) where department_id is not null;
create index if not exists workforce_recruitment_lead_id_idx
  on public.workforce(recruitment_lead_id) where recruitment_lead_id is not null;
create index if not exists workforce_onboarding_reviewed_by_idx
  on public.workforce(onboarding_reviewed_by) where onboarding_reviewed_by is not null;
create index if not exists workforce_onboarding_approved_by_idx
  on public.workforce(onboarding_approved_by) where onboarding_approved_by is not null;
create index if not exists workforce_designation_id_idx
  on public.workforce(designation_id);

commit;
