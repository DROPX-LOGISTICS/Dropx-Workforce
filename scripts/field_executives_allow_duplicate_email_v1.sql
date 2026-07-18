begin;

-- Field Executives can share email/mobile when they are separate IDs.
-- DropX ID remains unique and is the account identifier shown in Connect.
drop index if exists public.field_executives_email_unique;

create index if not exists field_executives_company_email_idx
  on public.field_executives (company_id, lower(email));

commit;
