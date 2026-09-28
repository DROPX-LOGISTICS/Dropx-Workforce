begin;

-- Existing component snapshots predate the component-level earning master. Align
-- their schedule labels with the shared field catalog before seeding defaults.
update public.payment_method_components component
set pay_schedule=field.pay_schedule
from public.payment_fields field
where field.id=component.payment_field_id
  and field.company_id=component.company_id
  and component.pay_schedule is distinct from field.pay_schedule;

-- One-time compatibility seed for methods created before component earning rules.
-- This is driven by reusable field semantics, never by method or designation name.
-- New and edited methods must still save an explicit rule for every component.
insert into public.workforce_payment_method_component_sources(
  company_id,payment_method_id,payment_field_id,source_of_truth,calculation_basis,source_metric,minimum_units,updated_by
)
select component.company_id,component.payment_method_id,component.payment_field_id,
  case
    when component.component_type='production' then 'amazon_daily_shipment'
    when component.pay_schedule='per_day' then 'biometric_attendance'
    else 'manual_approved'
  end,
  case
    when component.component_type='production' then 'shipment_quantity'
    when component.pay_schedule='per_day' then 'attendance_day'
    else 'manual'
  end,
  case when component.component_type='production' then
    case component.component_code
      when 'DELIVERY' then 'total_delivery'
      when 'CRETURN' then 'customer_return'
      when 'SELLER_PICKUP' then 'seller_pickup'
      when 'SLLLER_RETURN' then 'seller_return'
      when 'SELLER_RETURN' then 'seller_return'
      else 'total_activity'
    end
  else null end,
  null,
  null
from public.payment_method_components component
where component.is_active
on conflict(payment_method_id,payment_field_id) do nothing;

commit;
