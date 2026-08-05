begin;

do $$
declare
  function_row record;
  definition text;
begin
  if to_regclass('public.hr_audit_log') is null then
    raise exception 'Canonical People audit table public.hr_audit_log is missing';
  end if;

  for function_row in
    select procedure.oid
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'hr_replace_payroll_run_snapshot',
        'hr_transition_payroll_run',
        'hr_save_contractor_pay_profile'
      )
  loop
    definition := pg_get_functiondef(function_row.oid);
    if position('public.hr_audit_logs' in definition) > 0 then
      definition := replace(definition, 'public.hr_audit_logs', 'public.hr_audit_log');
      definition := replace(definition, 'new_data', 'after_data');
      execute definition;
    end if;
  end loop;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'hr_replace_payroll_run_snapshot',
        'hr_transition_payroll_run',
        'hr_save_contractor_pay_profile'
      )
      and pg_get_functiondef(procedure.oid) like '%public.hr_audit_logs%'
  ) then
    raise exception 'One or more People payroll functions still use the obsolete audit relation';
  end if;
end
$$;

commit;

