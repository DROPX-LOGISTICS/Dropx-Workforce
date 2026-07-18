create extension if not exists pgcrypto;

do $$
declare
  master_company uuid;
begin
  select id into master_company
  from public.companies
  where is_master = true or code = 'DROPX_LOGISTICS'
  order by is_master desc, created_at
  limit 1;

  if master_company is null then
    raise exception 'Master company was not found. Run company_master_v1.sql first.';
  end if;

  if to_regclass('public.location_models') is null then
    raise exception 'location_models table was not found. Run the master-data setup first.';
  end if;

  alter table public.location_models
    add column if not exists company_id uuid references public.companies(id) on delete cascade;

  if to_regclass('public.providers') is not null then
    update public.location_models model
    set company_id = provider.company_id
    from public.providers provider
    where model.provider_id = provider.id
      and model.company_id is null
      and provider.company_id is not null;
  end if;

  update public.location_models
  set company_id = master_company
  where company_id is null;

  create index if not exists location_models_company_id_idx
    on public.location_models(company_id);

  create unique index if not exists location_models_company_provider_code_uidx
    on public.location_models(company_id, provider_id, code);
end $$;
