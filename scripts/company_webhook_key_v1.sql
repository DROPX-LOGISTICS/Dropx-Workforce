create extension if not exists pgcrypto;

alter table public.companies
  add column if not exists webhook_key text;

update public.companies
set webhook_key = lower(code) || '_' || encode(gen_random_bytes(8), 'hex')
where webhook_key is null;

create unique index if not exists companies_webhook_key_idx
  on public.companies (webhook_key)
  where webhook_key is not null;
