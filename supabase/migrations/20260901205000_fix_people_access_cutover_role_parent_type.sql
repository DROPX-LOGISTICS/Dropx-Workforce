-- The original cutover function is already present in production. PostgreSQL
-- inferred the bare NULL in its INSERT ... SELECT role rows as text, while the
-- destination parent_role_id is uuid. Patch those two expressions in the
-- stored definition without changing any access data or invoking the cutover.

do $migration$
declare
  current_definition text;
  patched_definition text;
begin
  select pg_get_functiondef(
    'public.perform_people_access_cutover(uuid,uuid)'::regprocedure
  )
  into current_definition;

  patched_definition := regexp_replace(
    current_definition,
    E'(\\n[[:space:]]*)null,(\\n[[:space:]]*''role_based'')',
    E'\\1null::uuid,\\2',
    'gi'
  );

  if patched_definition = current_definition then
    raise exception 'People access cutover parent_role_id expressions were not found';
  end if;

  execute patched_definition;
end
$migration$;
