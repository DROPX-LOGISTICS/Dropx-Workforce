create extension if not exists pgcrypto;

create table if not exists public.company_allowed_domains (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  domain text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  constraint company_allowed_domains_domain_format check (
    domain ~* '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$'
  ),
  constraint company_allowed_domains_unique unique (company_id, domain)
);

create index if not exists company_allowed_domains_company_id_idx
  on public.company_allowed_domains(company_id);

create or replace function public.set_company_allowed_domains_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_company_allowed_domains_updated_at on public.company_allowed_domains;
create trigger set_company_allowed_domains_updated_at
before update on public.company_allowed_domains
for each row execute function public.set_company_allowed_domains_updated_at();

alter table public.company_allowed_domains enable row level security;

