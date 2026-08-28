begin;

-- Three historical drafts were saved as field_executive even though their
-- account now lives in contractors. Keep the original draft for old sessions,
-- and create a contractor alias so a fresh DropX One login resumes the same
-- registration instead of starting over. No existing draft is changed.
insert into public.mob_app_registration_drafts (
  company_id,
  profile_type,
  account_id,
  draft_data,
  verification_results,
  file_paths,
  created_at,
  updated_at
)
select
  draft.company_id,
  'contractor',
  draft.account_id,
  draft.draft_data,
  draft.verification_results,
  draft.file_paths,
  draft.created_at,
  draft.updated_at
from public.mob_app_registration_drafts draft
join public.contractors contractor
  on contractor.company_id = draft.company_id
 and contractor.id = draft.account_id
join public.workforce_identity_links link
  on link.company_id = draft.company_id
 and link.legacy_profile_type = 'contractor'
 and link.legacy_profile_id = draft.account_id
 and link.target_profile_type = 'workforce'
where draft.profile_type = 'field_executive'
on conflict (company_id, profile_type, account_id) do nothing;

comment on table public.mob_app_registration_drafts is
  'In-progress DropX One registration state. Legacy rows are retained during Workforce compatibility cutover.';

commit;
