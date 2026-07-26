update public.report_import_master
set requires_station = false,
    requires_report_date = false,
    report_date_label = null,
    updated_at = now()
where source_code in ('delivered_shipment_detail', 'inbound_shipment_detail');
