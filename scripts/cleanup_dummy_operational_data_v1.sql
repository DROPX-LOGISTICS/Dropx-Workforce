-- Clears old demo/transactional data for operational modules across all companies.
-- This does not touch companies, users, roles, locations, field executives,
-- designations, payment method masters, fleet, leads, inbox, or settings.

do $$
begin
  if to_regclass('public.field_executive_provider_mappings') is not null then
    delete from public.field_executive_provider_mappings;
  end if;

  if to_regclass('public.rate_card_items') is not null then
    delete from public.rate_card_items;
  end if;

  if to_regclass('public.rate_cards') is not null then
    delete from public.rate_cards;
  end if;

  if to_regclass('public.daily_report_rows') is not null then
    delete from public.daily_report_rows;
  end if;

  if to_regclass('public.daily_report_imports') is not null then
    delete from public.daily_report_imports;
  end if;

  if to_regclass('public.report_upload_rows') is not null then
    delete from public.report_upload_rows;
  end if;

  if to_regclass('public.report_uploads') is not null then
    delete from public.report_uploads;
  end if;

  if to_regclass('public.earning_line_items') is not null then
    delete from public.earning_line_items;
  end if;

  if to_regclass('public.earnings') is not null then
    delete from public.earnings;
  end if;

  if to_regclass('public.exception_queue') is not null then
    delete from public.exception_queue;
  end if;

  if to_regclass('public.operational_exceptions') is not null then
    delete from public.operational_exceptions;
  end if;

  if to_regclass('public.exceptions') is not null then
    delete from public.exceptions;
  end if;
end $$;
