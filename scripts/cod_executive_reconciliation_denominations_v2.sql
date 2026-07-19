begin;

alter table public.cod_executive_reconciliations
  add column if not exists expected_amount numeric not null default 0,
  add column if not exists cash_500_count integer not null default 0,
  add column if not exists cash_200_count integer not null default 0,
  add column if not exists cash_100_count integer not null default 0,
  add column if not exists cash_50_count integer not null default 0,
  add column if not exists cash_20_count integer not null default 0,
  add column if not exists cash_10_count integer not null default 0,
  add column if not exists cash_other_amount numeric not null default 0,
  add column if not exists collected_amount numeric not null default 0,
  add column if not exists difference_amount numeric not null default 0;

update public.cod_executive_reconciliations
set provider_employee_id = 'MANUAL-' || station_code || '-' || business_date || '-' || replace(upper(coalesce(manual_associate_name, source_associate_name, id::text)), ' ', '-')
where provider_employee_id is null or btrim(provider_employee_id) = '';

create unique index if not exists cod_executive_reconciliations_unique_row
  on public.cod_executive_reconciliations(company_id, business_date, station_code, provider_employee_id);

create index if not exists cod_executive_reconciliations_company_date_idx
  on public.cod_executive_reconciliations(company_id, business_date desc);

create index if not exists cod_executive_reconciliations_station_idx
  on public.cod_executive_reconciliations(company_id, station_code, business_date desc);

update public.cod_executive_reconciliations
set collected_amount = coalesce(cash_500_count, 0) * 500
    + coalesce(cash_200_count, 0) * 200
    + coalesce(cash_100_count, 0) * 100
    + coalesce(cash_50_count, 0) * 50
    + coalesce(cash_20_count, 0) * 20
    + coalesce(cash_10_count, 0) * 10
    + coalesce(cash_other_amount, 0),
    difference_amount = (
      coalesce(cash_500_count, 0) * 500
      + coalesce(cash_200_count, 0) * 200
      + coalesce(cash_100_count, 0) * 100
      + coalesce(cash_50_count, 0) * 50
      + coalesce(cash_20_count, 0) * 20
      + coalesce(cash_10_count, 0) * 10
      + coalesce(cash_other_amount, 0)
    ) - coalesce(expected_amount, 0),
    pending_amount = greatest(
      coalesce(expected_amount, 0) - (
        coalesce(cash_500_count, 0) * 500
        + coalesce(cash_200_count, 0) * 200
        + coalesce(cash_100_count, 0) * 100
        + coalesce(cash_50_count, 0) * 50
        + coalesce(cash_20_count, 0) * 20
        + coalesce(cash_10_count, 0) * 10
        + coalesce(cash_other_amount, 0)
      ),
      0
    ),
    reconciliation_status = case
      when coalesce(expected_amount, 0) = 0 and (
        coalesce(cash_500_count, 0) * 500
        + coalesce(cash_200_count, 0) * 200
        + coalesce(cash_100_count, 0) * 100
        + coalesce(cash_50_count, 0) * 50
        + coalesce(cash_20_count, 0) * 20
        + coalesce(cash_10_count, 0) * 10
        + coalesce(cash_other_amount, 0)
      ) = 0 then 'Pending'
      when (
        coalesce(cash_500_count, 0) * 500
        + coalesce(cash_200_count, 0) * 200
        + coalesce(cash_100_count, 0) * 100
        + coalesce(cash_50_count, 0) * 50
        + coalesce(cash_20_count, 0) * 20
        + coalesce(cash_10_count, 0) * 10
        + coalesce(cash_other_amount, 0)
      ) = coalesce(expected_amount, 0) then 'Completed'
      when (
        coalesce(cash_500_count, 0) * 500
        + coalesce(cash_200_count, 0) * 200
        + coalesce(cash_100_count, 0) * 100
        + coalesce(cash_50_count, 0) * 50
        + coalesce(cash_20_count, 0) * 20
        + coalesce(cash_10_count, 0) * 10
        + coalesce(cash_other_amount, 0)
      ) < coalesce(expected_amount, 0) then 'Pending Amount'
      else 'Mismatch'
    end;

commit;
