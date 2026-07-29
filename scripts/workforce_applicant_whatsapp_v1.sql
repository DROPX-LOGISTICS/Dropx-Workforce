-- Workforce applicant WhatsApp master switch.
-- Uses the existing WhatsApp profile/template configuration tables.
insert into public.whatsapp_notification_configs (company_id, event_code, is_enabled)
select id, 'workforce_application_received', false
from public.companies
on conflict (company_id, event_code) do nothing;
