begin;

do $$
declare
  affected_rows integer;
begin
  update public.contractors
  set
    onboarding_status = 'pending',
    profile_return_remarks = null,
    profile_returned_at = null,
    updated_at = now()
  where upper(trim(dropx_id)) = 'D0806'
    and lower(coalesce(onboarding_status, 'pending')) = 'active';

  get diagnostics affected_rows = row_count;

  if affected_rows = 0 then
    raise exception 'Active contractor D0806 was not found; no row was changed.';
  end if;
end $$;

commit;

select
  dropx_id,
  biometric_id,
  full_name,
  onboarding_status,
  is_active
from public.contractors
where upper(trim(dropx_id)) = 'D0806';
