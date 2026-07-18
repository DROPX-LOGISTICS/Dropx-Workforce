insert into public.user_roles (
  code,
  name,
  parent_role_id,
  location_access_mode,
  is_active,
  is_system
)
select
  'LOCATION',
  'Location',
  null,
  'role_based',
  true,
  false
from public.user_roles owner_role
where owner_role.code = 'OWNER'
on conflict (code) do update set parent_role_id = null;

create or replace function public.prevent_protected_role_delete()
returns trigger
language plpgsql
as $$
begin
  if old.code in ('OWNER', 'LOCATION') then
    raise exception '% is a built-in role and cannot be deleted', old.code;
  end if;
  return old;
end;
$$;

drop trigger if exists prevent_protected_role_delete on public.user_roles;
create trigger prevent_protected_role_delete
before delete on public.user_roles
for each row execute function public.prevent_protected_role_delete();
