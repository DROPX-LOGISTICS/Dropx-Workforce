begin;

alter table public.designations
  add column if not exists portal_permissions jsonb;

update public.designations
set portal_permissions = jsonb_build_object(
  'dashboard', jsonb_build_object('add', true, 'view', true, 'edit', true),
  'hrms', jsonb_build_object('add', false, 'view', false, 'edit', false),
  'ops', jsonb_build_object('add', false, 'view', false, 'edit', false)
)
where portal_permissions is null
   or jsonb_typeof(portal_permissions) <> 'object';

alter table public.designations
  alter column portal_permissions set default '{"dashboard":{"add":true,"view":true,"edit":true},"hrms":{"add":false,"view":false,"edit":false},"ops":{"add":false,"view":false,"edit":false}}'::jsonb,
  alter column portal_permissions set not null;

alter table public.designations
  drop constraint if exists designations_portal_permissions_object_check;

alter table public.designations
  add constraint designations_portal_permissions_object_check
  check (jsonb_typeof(portal_permissions) = 'object');

notify pgrst, 'reload schema';

commit;
