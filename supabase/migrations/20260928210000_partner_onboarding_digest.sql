begin;
create table public.workforce_partner_digest_settings(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),station_id uuid not null references public.stations(id),
 workforce_user_ids uuid[] not null default '{}',ops_user_ids uuid[] not null default '{}',recruit_user_ids uuid[] not null default '{}',
 include_station boolean not null default true,include_station_manager boolean not null default true,include_cluster_manager boolean not null default true,
 send_hour integer not null default 9 check(send_hour between 0 and 23),is_active boolean not null default false,
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),unique(company_id,station_id)
);
create table public.workforce_partner_digest_deliveries(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),station_id uuid not null references public.stations(id),
 report_date date not null,audience_key text not null,recipients text[] not null,subject text not null,body text not null,
 message_id text not null,root_message_id text not null,in_reply_to text,
 status text not null check(status in ('sending','sent','uncertain','skipped')),error_message text,created_at timestamptz not null default now(),completed_at timestamptz,
 unique(company_id,station_id,report_date)
);
alter table public.workforce_partner_digest_settings enable row level security;
alter table public.workforce_partner_digest_deliveries enable row level security;
revoke all on public.workforce_partner_digest_settings,public.workforce_partner_digest_deliveries from public,anon,authenticated;
grant select,insert,update on public.workforce_partner_digest_settings,public.workforce_partner_digest_deliveries to service_role;
commit;
