begin;

-- A retired legacy register must not make the Workforce Master unusable. The
-- master remains authoritative; unavailable physical registers are simply not
-- counted or offered as ready targets.
create or replace function public.designation_register_counts(p_company_id uuid)
returns table(
  designation_id uuid,
  table_name text,
  total_count bigint,
  active_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  register_value text;
begin
  foreach register_value in array array[
    'employees', 'contractors', 'workforce', 'vendors', 'workers', 'workforce_helpers'
  ] loop
    if to_regclass(format('public.%I', register_value)) is null then
      continue;
    end if;

    if register_value in ('employees', 'workforce') then
      return query execute format(
        'select designation.id, %L::text, count(profile.id), count(profile.id) filter (where profile.is_active) '
          'from public.designations designation '
          'left join public.%I profile on profile.company_id = designation.company_id and profile.designation_id = designation.id '
          'where designation.company_id = $1 group by designation.id',
        register_value, register_value
      ) using p_company_id;
    else
      return query execute format(
        'select designation.id, %L::text, count(profile.id), count(profile.id) filter (where profile.is_active) '
          'from public.designations designation '
          'left join public.%I profile on profile.company_id = designation.company_id '
          'and (upper(profile.designation) = upper(designation.code) or lower(btrim(profile.designation)) = lower(btrim(designation.name))) '
          'where designation.company_id = $1 group by designation.id',
        register_value, register_value
      ) using p_company_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.designation_register_counts(uuid) from public, anon, authenticated;
grant execute on function public.designation_register_counts(uuid) to service_role;

-- Workforce Connect is a lightweight, account-scoped request queue. It does
-- not alter earnings, mappings, rate cards, or People workflows.
create table if not exists public.workforce_connect_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  workforce_id uuid not null references public.workforce(id) on delete cascade,
  category text not null,
  subject text not null,
  detail text not null,
  status text not null default 'open',
  responder_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_connect_requests_category_check check (category in ('payment', 'provider_id', 'route_roster', 'document', 'other')),
  constraint workforce_connect_requests_status_check check (status in ('open', 'in_review', 'resolved', 'closed')),
  constraint workforce_connect_requests_subject_check check (char_length(btrim(subject)) between 3 and 160),
  constraint workforce_connect_requests_detail_check check (char_length(btrim(detail)) between 10 and 2000)
);

create index if not exists workforce_connect_requests_account_idx
  on public.workforce_connect_requests (company_id, workforce_id, created_at desc);

alter table public.workforce_connect_requests enable row level security;
revoke all on table public.workforce_connect_requests from anon, authenticated;
grant select, insert, update, delete on table public.workforce_connect_requests to service_role;

notify pgrst, 'reload schema';

commit;
