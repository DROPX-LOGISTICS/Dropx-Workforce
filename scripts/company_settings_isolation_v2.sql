do $$
declare
  master_company uuid;
begin
  select id into master_company
  from public.companies
  where is_master = true
  order by created_at
  limit 1;

  if master_company is null then
    raise exception 'Master company was not found.';
  end if;

  if to_regclass('public.whatsapp_notification_configs') is not null then
    delete from public.whatsapp_notification_configs
    where company_id is not null and company_id <> master_company;
  end if;

  if to_regclass('public.whatsapp_template_cache') is not null then
    delete from public.whatsapp_template_cache
    where company_id is not null and company_id <> master_company;
  end if;

  if to_regclass('public.whatsapp_profiles') is not null then
    delete from public.whatsapp_profiles
    where company_id is not null and company_id <> master_company;
  end if;

  if to_regclass('public.meta_channel_profiles') is not null then
    delete from public.meta_channel_profiles
    where company_id is not null and company_id <> master_company;
  end if;

  if to_regclass('public.whatsapp_settings') is not null then
    update public.whatsapp_settings
    set
      is_enabled = false,
      business_account_id = null,
      phone_number_id = null,
      graph_api_version = 'v25.0',
      default_country_code = '91',
      registration_url_template = null,
      webhook_verify_token = null,
      token_secret_id = null,
      updated_by = null,
      updated_at = now()
    where company_id is not null and company_id <> master_company;
  end if;

  if to_regclass('public.meta_messaging_settings') is not null then
    update public.meta_messaging_settings
    set
      is_facebook_enabled = false,
      is_instagram_enabled = false,
      meta_app_id = null,
      graph_api_version = 'v25.0',
      webhook_verify_token = null,
      facebook_page_id = null,
      facebook_page_name = null,
      instagram_business_account_id = null,
      instagram_connected_page_id = null,
      app_secret_secret_id = null,
      page_access_token_secret_id = null,
      updated_by = null,
      updated_at = now()
    where company_id is not null and company_id <> master_company;
  end if;

  if to_regclass('public.meta_leads_settings') is not null then
    update public.meta_leads_settings
    set
      is_enabled = false,
      meta_app_id = null,
      graph_api_version = 'v25.0',
      page_id = null,
      page_name = null,
      ad_account_id = null,
      webhook_verify_token = null,
      app_secret_secret_id = null,
      access_token_secret_id = null,
      last_synced_at = null,
      updated_at = now()
    where company_id is not null and company_id <> master_company;
  end if;

  if to_regclass('public.wheelseye_settings') is not null then
    update public.wheelseye_settings
    set
      is_enabled = false,
      token_secret_id = null,
      updated_by = null,
      updated_at = now()
    where company_id is not null and company_id <> master_company;
  end if;
end $$;
