begin;

alter table public.cps_shipment_daily
  add column if not exists assigned_count numeric(14, 2) not null default 0;

commit;
