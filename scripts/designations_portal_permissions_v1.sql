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

update public.designations
set portal_permissions = jsonb_set(portal_permissions, '{dashboard,view}', 'true'::jsonb, true)
where portal_permissions #>> '{dashboard,edit}' = 'true'
  and portal_permissions #>> '{dashboard,view}' is distinct from 'true';

update public.designations
set portal_permissions = jsonb_set(portal_permissions, '{hrms,view}', 'true'::jsonb, true)
where portal_permissions #>> '{hrms,edit}' = 'true'
  and portal_permissions #>> '{hrms,view}' is distinct from 'true';

update public.designations
set portal_permissions = jsonb_set(portal_permissions, '{ops,view}', 'true'::jsonb, true)
where portal_permissions #>> '{ops,edit}' = 'true'
  and portal_permissions #>> '{ops,view}' is distinct from 'true';

alter table public.designations
  alter column portal_permissions set default '{"dashboard":{"add":true,"view":true,"edit":true},"hrms":{"add":false,"view":false,"edit":false},"ops":{"add":false,"view":false,"edit":false}}'::jsonb,
  alter column portal_permissions set not null;

alter table public.designations
  drop constraint if exists designations_portal_permissions_object_check;

alter table public.designations
  add constraint designations_portal_permissions_object_check
  check (jsonb_typeof(portal_permissions) = 'object');

alter table public.designations
  drop constraint if exists designations_portal_permissions_edit_requires_view_check;

alter table public.designations
  add constraint designations_portal_permissions_edit_requires_view_check
  check (
    ((portal_permissions #>> '{dashboard,edit}') is distinct from 'true' or (portal_permissions #>> '{dashboard,view}') = 'true')
    and ((portal_permissions #>> '{hrms,edit}') is distinct from 'true' or (portal_permissions #>> '{hrms,view}') = 'true')
    and ((portal_permissions #>> '{ops,edit}') is distinct from 'true' or (portal_permissions #>> '{ops,view}') = 'true')
  );

notify pgrst, 'reload schema';

commit;
