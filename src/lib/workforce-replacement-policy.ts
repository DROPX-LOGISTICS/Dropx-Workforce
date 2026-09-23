import { createHash, timingSafeEqual } from 'node:crypto';

export function replacementAuthorized(header: string | null, token: string | undefined) {
  if (!token || token.length < 48 || !header?.startsWith('Bearer ')) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(token));
}

export function replacementFilters(params: URLSearchParams) {
  const page = Number(params.get('page') || 0);
  if (!Number.isInteger(page) || page < 0 || page > 10000) throw new Error('Invalid page.');
  const dates: Record<string, string> = {};
  for (const key of ['from', 'to']) {
    const value = params.get(key);
    if (value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Invalid date.');
      dates[key] = value;
    }
  }
  if (dates.from && dates.to && dates.from > dates.to) throw new Error('Invalid date range.');
  const station = params.get('station') || '';
  if (station && !/^[a-z0-9-]{36}$/i.test(station)) throw new Error('Invalid station.');
  const q = (params.get('q') || '').trim();
  if (q.length > 100) throw new Error('Search is too long.');
  return { page, ...dates, station, q } as {page:number;from?:string;to?:string;station:string;q:string};
}

// Explicit fields are a security boundary: no banking credentials, document paths,
// provider passwords, session material, or arbitrary caller-selected tables/columns.
export const replacementSources: Record<string, {table:string;select:string;order:string;date?:string;station?:string;person?:string;search?:string}> = {
  paymentTypes: {table:'payment_methods',select:'id,code,name,is_active,payment_method_components(id,component_code,label,component_type,pay_schedule,payment_field_id,is_active)',order:'code'},
  paymentFields: {table:'payment_fields',select:'id,code,label,field_type,pay_schedule,calculation_type,calculation_source,provider_calculation_sources,is_active',order:'code'},
  metricLinks: {table:'payment_field_provider_metrics',select:'id,payment_field_id,provider_id,provider_metric_id,provider_model_id',order:'id'},
  metrics: {table:'provider_production_metrics',select:'id,provider_id,code,name,source_key,source_keys,calculation_operation,is_active',order:'id'},
  rateCards: {table:'workforce_rate_cards',select:'id,name,provider_id,station_id,designation_id,pay_type,effective_from,effective_to,delivery_rate,return_rate,mfn_rate,mfn_return_rate,fuel_rate,fixed_amount,guarantee_amount,status,approved_at',order:'effective_from',station:'station_id'},
  mappings: {table:'field_executive_provider_mappings',select:'id,workforce_id,field_executive_id,employee_id,contractor_id,provider_id,station_id,provider_member_id,effective_from,effective_to,payment_method_id,payment_values,pay_type,delivery_rate,pickup_rate,mfn_rate,mfn_return_rate,guarantee_amount,guarantee_schedule,fuel_rate,status',order:'effective_from',station:'station_id',search:'provider_member_id'},
  shipments: {table:'cps_shipment_daily',select:'id,client,work_date,station_code,provider_employee_id,provider_employee_name,amazon_delivery,swa_delivery,total_delivery,c_return,mfn,mfn_return,total_activity,assigned_count,source_batch_id,updated_at,mapping_status,pay_type,da_total_pay',order:'work_date',date:'work_date',station:'station_code',search:'provider_employee_id'},
  imports: {table:'report_import_batches',select:'id,source_type,file_name,row_count,imported_row_count,skipped_row_count,status,message,report_from,report_to,created_at,completed_at,station_code',order:'created_at'},
  joining: {table:'workforce_joining_plans',select:'workforce_id,station_id,mode,eligible_from,daily_rate,minimum_minutes,training_policy_id,terms_reference,terms_accepted_on,training_completed_on,closed_on,provider_stage,provider_reference,provider_submitted_on,provider_activated_on,next_follow_up_on,owner_note,contact_email,assigned_to,provider_profile_id,version,updated_at',order:'updated_at',station:'station_id',person:'workforce_id'},
  trainingPolicies: {table:'workforce_training_policies',select:'id,station_id,name,daily_rate,minimum_minutes,policy_reference,effective_from,effective_to,is_active',order:'effective_from',station:'station_id'},
  attendance: {table:'attendance_daily',select:'id,workforce_id,field_executive_id,contractor_id,punch_date,in_time,out_time,work_minutes,status,location_id,station_code,in_source,out_source,updated_at',order:'punch_date',date:'punch_date',station:'location_id',person:'attendance'},
  schedules: {table:'workforce_operating_schedules',select:'id,workforce_id,operating_pincode,weekly_off_day,effective_from,effective_to,notes',order:'effective_from',person:'workforce_id'},
  payroll: {table:'workforce_payroll_runs',select:'id,run_number,station_id,period_start,period_end,status,worker_count,shipment_count,base_amount,incentive_amount,adjustment_amount,deduction_amount,net_amount,ready_count,hold_count,exception_count,calculated_at,submitted_at,approved_at,paid_at,payment_reference,payment_date,finance_sent_at',order:'created_at',station:'station_id'},
  payrollItems: {table:'workforce_payroll_items',select:'id,payroll_run_id,workforce_id,dropx_id,worker_name,station_code,shipment_count,activity_count,work_days,base_amount,incentive_amount,adjustment_amount,deduction_amount,gross_amount,net_amount,status,hold_reasons,provider_member_ids',order:'created_at',person:'workforce_id',station:'station_code'},
  payrollLines: {table:'workforce_payroll_lines',select:'id,payroll_run_id,payroll_item_id,workforce_id,source_type,source_id,work_date,provider_name,provider_member_id,shipment_count,activity_count,base_amount,incentive_amount,adjustment_amount,net_amount,calculation_source',order:'work_date',date:'work_date',person:'workforce_id'},
  adjustments: {table:'workforce_adjustments',select:'id,workforce_id,adjustment_type,category,amount,effective_date,reason,external_reference,status,requested_at,reviewed_at,payroll_run_id',order:'requested_at',person:'workforce_id'},
  holds: {table:'workforce_payment_holds',select:'id,workforce_id,station_id,period_start,period_end,reason,reference,status,requested_at,released_at,release_note',order:'requested_at',station:'station_id',person:'workforce_id'},
  disputes: {table:'workforce_payout_disputes',select:'id,publication_id,payroll_run_id,workforce_id,station_id,category,reason,status,resolution,resolved_at,created_at',order:'created_at',station:'station_id',person:'workforce_id'},
  requests: {table:'workforce_connect_requests',select:'id,workforce_id,category,subject,detail,status,responder_note,resolved_at,created_at',order:'created_at',person:'workforce_id'},
  exits: {table:'workforce_lifecycle_cases',select:'id,field_executive_id,profile_type,profile_id,case_type,status,requested_effective_date,approved_effective_date,reason_code,reason_details,reviewed_at,approved_at,created_at',order:'created_at'},
  settlements: {table:'workforce_final_settlements',select:'id,lifecycle_case_id,status,gross_amount,deduction_amount,net_amount,payment_reference,payment_date,approved_at,paid_at',order:'created_at'},
  incentives: {table:'workforce_incentive_campaigns',select:'id,code,name,provider_id,station_id,designation_id,metric,calculation_type,threshold_value,rate_value,flat_amount,maximum_amount,effective_from,effective_to,status',order:'effective_from',station:'station_id'},
  mileage: {table:'workforce_mileage_claims',select:'id,workforce_id,station_id,policy_id,adjustment_id,work_date,kilometres,rate_per_km,reference,notes,reported_at',order:'work_date',date:'work_date',station:'station_id',person:'workforce_id'},
  mileagePolicies: {table:'workforce_mileage_policies',select:'id,station_id,name,rate_per_km,maximum_daily_km,effective_from,effective_to,policy_reference',order:'effective_from',station:'station_id'},
  pooledPolicies: {table:'workforce_pooled_policies',select:'id,station_id,name,formula,daily_guarantee,packages_per_day,package_rate,effective_from,effective_to,policy_reference',order:'effective_from',station:'station_id'},
  pooledAgreements: {table:'workforce_pooled_agreements',select:'id,station_id,workforce_id,policy_id,window_start,window_end,accepted_on,acceptance_reference',order:'window_start',station:'station_id',person:'workforce_id'},
  pooledSettlements: {table:'workforce_pooled_settlements',select:'id,agreement_id,station_id,workforce_id,adjustment_id,reference,posting_date,supplemental_amount,status,requested_at,reviewed_at',order:'posting_date',station:'station_id',person:'workforce_id'},
  amazon: {table:'workforce_amazon_observations',select:'workforce_id,provider_profile_id,progress,provider_status,observed_at',order:'observed_at',person:'workforce_id'},
  agreements: {table:'workforce_agreement_master',select:'id,code,title,version,applicable_designation_codes,is_active,effective_from,effective_to,agreement_type,audience_scope,acceptance_label',order:'code'},
  checklists: {table:'workforce_onboarding_checklist_master',select:'id,code,label,description,applicable_designation_codes,is_required,is_active,sort_order',order:'sort_order'},
};
