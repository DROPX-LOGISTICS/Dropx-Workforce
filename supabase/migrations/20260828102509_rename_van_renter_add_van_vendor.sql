begin;

do $$
begin
  if not exists (select 1 from public.designations where upper(code) = 'VAN') then
    raise exception 'The existing VAN designation is required before adding Van Vendor.';
  end if;
end $$;

-- Keep the existing code so current profiles and invitations remain linked.
update public.designations designation
set name = 'Van Renter',
    onboarding_categories = array['vendors']::text[],
    designation_category_id = category.id,
    is_active = true,
    updated_at = now()
from public.designation_categories category
where upper(designation.code) = 'VAN'
  and category.company_id = designation.company_id
  and category.code = 'workforce';

-- The master code remains VAN, but legacy profile rows store the designation
-- name. Align that display value so registration mirroring can still resolve
-- the same master record after the rename.
update public.field_executives
set designation = 'Van Renter', updated_at = now()
where lower(btrim(coalesce(designation, ''))) in ('van rent', 'van renter');

update public.contractors
set designation = 'Van Renter', updated_at = now()
where lower(btrim(coalesce(designation, ''))) in ('van rent', 'van renter');

update public.vendors
set designation = 'Van Renter', updated_at = now()
where lower(btrim(coalesce(designation, ''))) in ('van rent', 'van renter');

update public.workers
set designation = 'Van Renter', updated_at = now()
where lower(btrim(coalesce(designation, ''))) in ('van rent', 'van renter');

-- Clone the existing Van configuration so the new designation inherits its
-- current access, provider, model, location, profile and onboarding settings.
insert into public.designations (
  company_id,
  code,
  name,
  designation_category_id,
  provider_ids,
  model_ids,
  location_ids,
  onboarding_categories,
  profile_field_rules,
  app_page_access,
  onboarding_role_ids,
  portal_permissions,
  is_field_operations,
  is_active,
  updated_at
)
select
  source.company_id,
  'VNV',
  'Van Vendor',
  category.id,
  source.provider_ids,
  source.model_ids,
  source.location_ids,
  array['vendors']::text[],
  source.profile_field_rules,
  source.app_page_access,
  source.onboarding_role_ids,
  source.portal_permissions,
  source.is_field_operations,
  true,
  now()
from public.designations source
join public.designation_categories category
  on category.company_id = source.company_id
 and category.code = 'workforce'
where upper(source.code) = 'VAN'
on conflict (code) do update
set name = excluded.name,
    company_id = excluded.company_id,
    designation_category_id = excluded.designation_category_id,
    onboarding_categories = excluded.onboarding_categories,
    is_active = true,
    updated_at = now();

-- Align known Workforce master rows that predate designation_category_id.
update public.designations designation
set designation_category_id = category.id,
    updated_at = now()
from public.designation_categories category
where upper(designation.code) in ('HK', 'RINF', 'VAN', 'VNV')
  and category.company_id = designation.company_id
  and category.code = 'workforce'
  and designation.designation_category_id is distinct from category.id;

-- People & Culture uses portal_scopes from the same master. Keep this migration
-- compatible with environments where that shared column has not been added yet.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'designations'
      and column_name = 'portal_scopes'
  ) then
    execute $sql$
      update public.designations
      set portal_scopes = array['workforce']::text[],
          updated_at = now()
      where upper(code) in ('HK', 'RINF', 'VAN', 'VNV')
        and portal_scopes is distinct from array['workforce']::text[]
    $sql$;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from public.designations designation
    join public.designation_categories category
      on category.id = designation.designation_category_id
     and category.company_id = designation.company_id
    where upper(designation.code) = 'VAN'
      and designation.name = 'Van Renter'
      and category.code = 'workforce'
      and designation.is_active
  ) then
    raise exception 'Van Renter was not aligned to the Workforce designation category.';
  end if;

  if not exists (
    select 1
    from public.designations designation
    join public.designation_categories category
      on category.id = designation.designation_category_id
     and category.company_id = designation.company_id
    where upper(designation.code) = 'VNV'
      and designation.name = 'Van Vendor'
      and category.code = 'workforce'
      and designation.is_active
  ) then
    raise exception 'Van Vendor was not created in the Workforce designation category.';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
