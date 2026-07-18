insert into public.whatsapp_notification_configs (company_id, event_code, is_enabled)
select companies.id, 'onboarding_otp_verification', false
from public.companies
where companies.is_active = true
on conflict (company_id, event_code) do nothing;
