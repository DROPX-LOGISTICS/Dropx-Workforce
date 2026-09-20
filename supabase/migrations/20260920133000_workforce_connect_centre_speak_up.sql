begin;

-- Keep Workforce Speak Up reports in the same account-scoped inbox table so
-- that the associate can see the response in DropX One, while granting the
-- administration UI a separate, explicitly assignable permission boundary.
alter table public.workforce_connect_requests
  drop constraint if exists workforce_connect_requests_category_check;

alter table public.workforce_connect_requests
  add constraint workforce_connect_requests_category_check
  check (category in ('payment', 'provider_id', 'route_roster', 'document', 'other', 'speak_up'));

create index if not exists workforce_connect_requests_confidential_queue_idx
  on public.workforce_connect_requests (company_id, status, updated_at desc)
  where category = 'speak_up';

notify pgrst, 'reload schema';

commit;
