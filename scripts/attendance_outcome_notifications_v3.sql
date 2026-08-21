begin;

alter table public.mob_app_notification_rules
  drop constraint if exists mob_app_notification_rules_event_check;
alter table public.mob_app_notification_rules
  drop constraint if exists mob_app_notification_rules_event_code_check;
alter table public.mob_app_notification_rules
  add constraint mob_app_notification_rules_event_code_check
  check (event_code ~ '^[a-z][a-z0-9_]{2,79}$');

insert into public.mob_app_notification_rules(company_id, event_code, enabled, title_template, body_template, route)
select company.id, event.event_code, true, event.title_template, event.body_template, 'attendance'
from public.companies company
cross join (values
  ('attendance_late_in', 'Late punch-in', 'Punch captured at {time}. You arrived {late_minutes} minutes after your allowed shift time.'),
  ('attendance_early_out', 'Early punch-out', 'Punch-out captured at {time}. You left {early_minutes} minutes before your shift end.'),
  ('attendance_half_day', 'Half day marked', 'Punch-out captured at {time}. You worked {work_duration}; attendance is marked half day under the current policy.'),
  ('attendance_short_day', 'Short workday', 'Punch-out captured at {time}. You worked {work_duration}; attendance is marked {outcome} under the current policy.')
) as event(event_code, title_template, body_template)
where company.is_active
on conflict (company_id, event_code) do nothing;

notify pgrst, 'reload schema';
commit;
