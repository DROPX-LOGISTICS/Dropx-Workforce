create or replace function public.multi_designation_used_designation_ids(
  p_company_id uuid,
  p_setting_type text
)
returns table(designation_id uuid)
language sql
security definer
set search_path = public
as $$
  select distinct mapped.designation_id::uuid
  from public.dropx_id_generation_settings settings
  cross join lateral jsonb_each(settings.configs) series
  cross join lateral jsonb_array_elements_text(coalesce(series.value -> 'designation_ids', '[]'::jsonb)) mapped(designation_id)
  where settings.company_id = p_company_id
    and settings.setting_type = p_setting_type
    and settings.scope_type = 'multi_designation'
    and public.multi_designation_has_generated_id(p_company_id, p_setting_type, mapped.designation_id::uuid);
$$;

revoke all on function public.multi_designation_used_designation_ids(uuid, text) from public;
grant execute on function public.multi_designation_used_designation_ids(uuid, text) to service_role;
