-- Multiple users can share one legacy role. During cutover their rows can point
-- at the same canonical designation/page permission. Aggregate those rows
-- before UPSERT so PostgreSQL updates each destination permission only once.

do $migration$
declare
  current_definition text;
  patched_definition text;
begin
  select pg_get_functiondef(
    'public.perform_people_access_cutover(uuid,uuid)'::regprocedure
  )
  into current_definition;

  patched_definition := replace(
    current_definition,
    $old$
  select
    permission.company_id,
    target.target_role_id,
    permission.page_id,
    permission.can_view,
    permission.can_add,
    permission.can_edit,
    now()
  from pg_temp._membership_targets target
  join public.role_page_permissions permission
    on permission.company_id = target.company_id
   and permission.role_id = target.legacy_role_id
  where target.legacy_role_id is not null
$old$,
    $new$
  select
    permission.company_id,
    target.target_role_id,
    permission.page_id,
    bool_or(permission.can_view),
    bool_or(permission.can_add),
    bool_or(permission.can_edit),
    now()
  from pg_temp._membership_targets target
  join public.role_page_permissions permission
    on permission.company_id = target.company_id
   and permission.role_id = target.legacy_role_id
  where target.legacy_role_id is not null
  group by permission.company_id, target.target_role_id, permission.page_id
$new$
  );

  if patched_definition = current_definition then
    raise exception 'Designation permission aggregation block was not found';
  end if;

  current_definition := patched_definition;
  patched_definition := replace(
    current_definition,
    $old$
  select permission.company_id, mapping.new_role_id, permission.page_id,
         permission.can_view, permission.can_add, permission.can_edit, now()
  from pg_temp._payment_role_map mapping
  join public.role_page_permissions permission
    on permission.company_id = mapping.company_id
   and permission.role_id = mapping.old_role_id
$old$,
    $new$
  select permission.company_id, mapping.new_role_id, permission.page_id,
         bool_or(permission.can_view), bool_or(permission.can_add), bool_or(permission.can_edit), now()
  from pg_temp._payment_role_map mapping
  join public.role_page_permissions permission
    on permission.company_id = mapping.company_id
   and permission.role_id = mapping.old_role_id
  group by permission.company_id, mapping.new_role_id, permission.page_id
$new$
  );

  if patched_definition = current_definition then
    raise exception 'Payment permission aggregation block was not found';
  end if;

  execute patched_definition;
end
$migration$;
