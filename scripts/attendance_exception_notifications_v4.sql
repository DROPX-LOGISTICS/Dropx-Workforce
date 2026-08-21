begin;

insert into public.mob_app_notification_rules(company_id, event_code, enabled, title_template, body_template, route)
select company.id, event.event_code, true, event.title_template, event.body_template, 'attendance'
from public.companies company
cross join (values
  ('attendance_overtime', 'Overtime needs review', 'Punch-out captured at {time}. You worked {work_duration}; {overtime_minutes} overtime minutes need review under the current policy.'),
  ('attendance_exception_review', 'Attendance needs review', 'Punch captured at {time}. {outcome}.')
) as event(event_code, title_template, body_template)
where company.is_active
on conflict (company_id, event_code) do nothing;

notify pgrst, 'reload schema';
commit;
