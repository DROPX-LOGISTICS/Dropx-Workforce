alter table public.report_import_master
  add column if not exists requires_station boolean not null default false,
  add column if not exists station_scope text not null default 'none',
  add column if not exists requires_report_date boolean not null default false,
  add column if not exists report_date_label text,
  add column if not exists date_default_offset integer not null default 0;

update public.report_import_master
set
  requires_station = true,
  station_scope = 'amazon_dsp_xpt',
  requires_report_date = true,
  report_date_label = case
    when source_code = 'inbound_shipment_detail' then 'Expected at station'
    else 'Delivered date'
  end,
  date_default_offset = case
    when source_code = 'delivered_shipment_detail' then -1
    else 0
  end,
  updated_at = now()
where company_id = '43866344-b550-4e8a-9a2d-9d23f3d8a997'
  and source_code in ('inbound_shipment_detail', 'delivered_shipment_detail');

update public.report_import_master
set
  requires_station = false,
  station_scope = 'none',
  requires_report_date = false,
  report_date_label = null,
  date_default_offset = 0,
  updated_at = now()
where company_id = '43866344-b550-4e8a-9a2d-9d23f3d8a997'
  and source_code not in ('inbound_shipment_detail', 'delivered_shipment_detail');
