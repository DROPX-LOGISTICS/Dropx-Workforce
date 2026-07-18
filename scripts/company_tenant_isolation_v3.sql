create extension if not exists pgcrypto;
create extension if not exists supabase_vault with schema vault;

do $$
declare
  master_company uuid;
  table_name text;
begin
  select id into master_company
  from public.companies
  where is_master = true
  order by created_at
  limit 1;

  if master_company is null then
    raise exception 'Master company was not found.';
  end if;

  foreach table_name in array array[
    'meta_leads_settings',
    'meta_messaging_settings',
    'whatsapp_settings',
    'wheelseye_settings'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I add column if not exists company_id uuid references public.companies(id) on delete cascade', table_name);
      execute format('update public.%I set company_id = $1 where company_id is null', table_name) using master_company;
      execute format('alter table public.%I drop constraint if exists %I', table_name, table_name || '_pkey');
      execute format('create unique index if not exists %I on public.%I(company_id, id)', left(table_name || '_company_id_id_uidx', 63), table_name);
      execute format('create index if not exists %I on public.%I(company_id)', left(table_name || '_company_id_idx', 63), table_name);
    end if;
  end loop;

  if to_regclass('public.whatsapp_template_cache') is not null then
    alter table public.whatsapp_template_cache
      add column if not exists company_id uuid references public.companies(id) on delete cascade;
    update public.whatsapp_template_cache set company_id = master_company where company_id is null;
    if to_regclass('public.whatsapp_campaigns') is not null then
      alter table public.whatsapp_campaigns drop constraint if exists whatsapp_campaigns_template_id_fkey;
    end if;
    if to_regclass('public.whatsapp_notification_configs') is not null then
      alter table public.whatsapp_notification_configs drop constraint if exists whatsapp_notification_configs_template_id_fkey;
    end if;
    alter table public.whatsapp_template_cache drop constraint if exists whatsapp_template_cache_template_id_key;
    drop index if exists public.whatsapp_template_cache_template_id_key;
    create unique index if not exists whatsapp_template_cache_company_template_uidx
      on public.whatsapp_template_cache(company_id, template_id);
    create index if not exists whatsapp_template_cache_company_idx
      on public.whatsapp_template_cache(company_id);
  end if;

  if to_regclass('public.whatsapp_notification_configs') is not null then
    alter table public.whatsapp_notification_configs
      add column if not exists company_id uuid references public.companies(id) on delete cascade;
    update public.whatsapp_notification_configs set company_id = master_company where company_id is null;
    alter table public.whatsapp_notification_configs drop constraint if exists whatsapp_notification_configs_event_code_key;
    drop index if exists public.whatsapp_notification_configs_event_code_key;
    create unique index if not exists whatsapp_notification_configs_company_event_uidx
      on public.whatsapp_notification_configs(company_id, event_code);
  end if;

  if to_regclass('public.whatsapp_profiles') is not null then
    alter table public.whatsapp_profiles
      add column if not exists company_id uuid references public.companies(id) on delete cascade;
    update public.whatsapp_profiles set company_id = master_company where company_id is null;
    drop index if exists public.whatsapp_profiles_name_idx;
    drop index if exists public.whatsapp_profiles_one_default_idx;
    create unique index if not exists whatsapp_profiles_company_name_uidx
      on public.whatsapp_profiles(company_id, lower(profile_name));
    create unique index if not exists whatsapp_profiles_company_default_uidx
      on public.whatsapp_profiles(company_id) where is_default = true;
  end if;

  if to_regclass('public.meta_channel_profiles') is not null then
    alter table public.meta_channel_profiles
      add column if not exists company_id uuid references public.companies(id) on delete cascade;
    update public.meta_channel_profiles set company_id = master_company where company_id is null;
    drop index if exists public.meta_channel_profiles_name_idx;
    drop index if exists public.meta_channel_profiles_page_idx;
    drop index if exists public.meta_channel_profiles_instagram_idx;
    create unique index if not exists meta_channel_profiles_company_name_uidx
      on public.meta_channel_profiles(company_id, channel, lower(profile_name));
    create unique index if not exists meta_channel_profiles_company_page_uidx
      on public.meta_channel_profiles(company_id, page_id) where channel = 'facebook' and page_id is not null;
    create unique index if not exists meta_channel_profiles_company_ig_uidx
      on public.meta_channel_profiles(company_id, instagram_business_account_id) where channel = 'instagram' and instagram_business_account_id is not null;
  end if;

  if to_regclass('public.lead_job_roles') is not null then
    alter table public.lead_job_roles
      add column if not exists company_id uuid references public.companies(id) on delete cascade;
    update public.lead_job_roles set company_id = master_company where company_id is null;
    alter table public.lead_job_roles drop constraint if exists lead_job_roles_code_key;
    drop index if exists public.lead_job_roles_code_key;
    create unique index if not exists lead_job_roles_company_code_uidx
      on public.lead_job_roles(company_id, code);
  end if;

  if to_regclass('public.lead_ads') is not null then
    alter table public.lead_ads
      add column if not exists company_id uuid references public.companies(id) on delete cascade;
    update public.lead_ads set company_id = master_company where company_id is null;
    alter table public.lead_ads drop constraint if exists lead_ads_meta_ad_id_key;
    drop index if exists public.lead_ads_meta_ad_id_key;
    create unique index if not exists lead_ads_company_meta_ad_uidx
      on public.lead_ads(company_id, meta_ad_id) where meta_ad_id is not null;
  end if;

  if to_regclass('public.leads') is not null then
    alter table public.leads
      add column if not exists company_id uuid references public.companies(id) on delete cascade;
    update public.leads set company_id = master_company where company_id is null;
    alter table public.leads drop constraint if exists leads_meta_lead_id_key;
    drop index if exists public.leads_meta_lead_id_key;
    create unique index if not exists leads_company_meta_lead_uidx
      on public.leads(company_id, meta_lead_id) where meta_lead_id is not null;
  end if;

  if to_regclass('public.whatsapp_notification_configs') is not null then
    delete from public.whatsapp_notification_configs where company_id <> master_company;
  end if;
  if to_regclass('public.whatsapp_template_cache') is not null then
    delete from public.whatsapp_template_cache where company_id <> master_company;
  end if;
  if to_regclass('public.whatsapp_profiles') is not null then
    delete from public.whatsapp_profiles where company_id <> master_company;
  end if;
  if to_regclass('public.meta_channel_profiles') is not null then
    delete from public.meta_channel_profiles where company_id <> master_company;
  end if;

  if to_regclass('public.whatsapp_settings') is not null then
    update public.whatsapp_settings
    set is_enabled = false,
        business_account_id = null,
        phone_number_id = null,
        graph_api_version = 'v25.0',
        default_country_code = '91',
        registration_url_template = null,
        webhook_verify_token = null,
        token_secret_id = null,
        updated_by = null,
        updated_at = now()
    where company_id <> master_company;
  end if;

  if to_regclass('public.meta_messaging_settings') is not null then
    update public.meta_messaging_settings
    set is_facebook_enabled = false,
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
    where company_id <> master_company;
  end if;

  if to_regclass('public.meta_leads_settings') is not null then
    update public.meta_leads_settings
    set is_enabled = false,
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
    where company_id <> master_company;
  end if;

  if to_regclass('public.wheelseye_settings') is not null then
    update public.wheelseye_settings
    set is_enabled = false,
        token_secret_id = null,
        updated_by = null,
        updated_at = now()
    where company_id <> master_company;
  end if;
end $$;
