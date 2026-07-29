begin;

alter table public.mob_app_notification_rules
  drop constraint if exists mob_app_notification_rules_event_check;

alter table public.mob_app_notification_rules
  add constraint mob_app_notification_rules_event_check
  check (event_code in (
    'attendance_punch_in',
    'attendance_punch_out',
    'profile_submitted',
    'profile_approved',
    'profile_returned',
    'attendance_regularization_submitted'
  ));

notify pgrst, 'reload schema';

commit;
