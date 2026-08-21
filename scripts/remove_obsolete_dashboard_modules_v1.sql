update public.app_pages
set is_active = false,
    updated_at = now()
where code in (
  'leads',
  'leads_dashboard',
  'leads_all',
  'leads_followups',
  'leads_interviews',
  'leads_reports',
  'leads_ads',
  'leads_sop',
  'rate_cards',
  'earnings',
  'exceptions'
);
