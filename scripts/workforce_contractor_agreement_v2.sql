begin;

-- Preserve every Version 1 acceptance for audit, but require Version 2 for
-- new submissions and activations from the date this migration is applied.
update public.workforce_agreement_master
set is_active = false,
    effective_to = current_date - 1,
    updated_at = now()
where code = 'DA_SERVICE_AGREEMENT'
  and version < 2
  and is_active;

insert into public.workforce_agreement_master (
  company_id,
  code,
  title,
  version,
  agreement_body,
  applicable_designation_codes,
  is_active,
  effective_from
)
select
  id,
  'DA_SERVICE_AGREEMENT',
  'Individual Contractor Agreement - Delivery Services',
  2,
  $agreement$1. INDEPENDENT CONTRACTOR STATUS
I voluntarily engage with DropX as an independent individual contractor for delivery and related logistics services. I understand that this is a contract-for-services arrangement and does not by itself create an employer-employee relationship or an automatic entitlement to salary, employment benefits or a permanent position. I am responsible for the personal statutory and tax obligations that apply to me.

2. REPORTING, ATTENDANCE AND DISCIPLINE
After accepting a duty, route or assignment, I will report to the assigned station, hub or work location on time, record attendance through the authorised method, remain available for the agreed duty period and complete assigned work responsibly. I will follow DropX and client operating procedures, safety requirements, code of conduct, lawful instructions, performance metrics, service standards and workplace discipline communicated for my assignment.

3. SHIPMENT, CASH AND ASSET CUSTODY
From the time shipments, collected cash, devices, documents or other assets are handed to me until they are delivered or formally returned, they remain in my custody and I am responsible for protecting, accounting for and handling them only for authorised work. Every undelivered, failed or unattempted shipment and the full amount of cash collected must be returned to the assigned delivery station or hub on the same day and acknowledged through the prescribed process. I will not retain shipments or cash overnight unless a specifically authorised and recorded exception is given.

Any shortage, loss, damage, unauthorised retention, misappropriation or failure to return shipments, cash or assets that is attributable to my act, omission, negligence, misconduct, fraud or breach may make me financially responsible after documented reconciliation or investigation, subject to applicable law. Failure to make the required same-day return may result in a penalty, suspension, disciplinary action, removal or deactivation from the system and, where warranted, civil, criminal or other legal action.

4. HONESTY, CONDUCT AND COMPLIANCE
I will not commit fraud, falsify records, misuse customer or company information, misbehave with customers or colleagues, manipulate attendance or delivery events, substitute another person, carry prohibited items or use shipments, cash, credentials or assets for an unauthorised purpose. A verified breach may lead to warning, penalty, recovery, suspension, removal from duty, deactivation or termination of this agreement, and legal or police action where appropriate.

5. RATE CARD AND PERIODIC REVIEW
The station-, route-, service- and client-specific rate card communicated for an applicable period is final for that period. I understand that there is no automatic right to an increment. The rate card may be reviewed at three-month intervals and may be reduced prospectively based on shipment volume or density, route productivity, station conditions, client pricing, service requirements or other operating economics applicable at that time. A revised rate card will apply after it is communicated for the relevant station, route, client, service and effective period.

6. PERFORMANCE PENALTIES AND INCENTIVES
DropX or the applicable client may introduce or revise documented performance standards, service-quality penalties, shortage or non-compliance recoveries and incentive schemes from time to time. Each applicable penalty or incentive will be communicated with its metric, conditions and defined validity period. A time-bound incentive does not create a continuing entitlement after that period. Any penalty, deduction or recovery will be supported by the applicable record or validation and handled subject to applicable law.

7. INFORMATION, VERIFICATION AND OPERATIONAL RECORDS
I confirm that the information and documents submitted by me are correct. I consent to verification of my identity, address, bank account, licence, vehicle, attendance, location, delivery, cash-handling and work records for onboarding, safety, payment, investigation and operational compliance. Deliberate false information may result in rejection or deactivation and legal action.

8. SUSPENSION, EXIT AND SETTLEMENT
DropX may suspend assignments or deactivate or terminate my access for operational, performance, safety, disciplinary, fraud, client or compliance reasons, following the applicable review process. On exit I will immediately return all shipments, cash, identity cards, uniforms, devices, documents and other assets. Final settlement is subject to completed reconciliation, approved payable amounts and lawful recoveries or deductions.

9. ELECTRONIC ACCEPTANCE
By selecting acceptance and submitting my registration, I confirm that I have read and understood this agreement, am signing it in my individual capacity as an independent contractor, and agree to be bound by its current version. My acceptance time, agreement version, content hash, IP address and device or browser information may be retained as the electronic audit record.$agreement$,
  array['DA','DCD','ODCD','PTDA']::text[],
  true,
  current_date
from public.companies
on conflict (company_id, code, version) do update
set title = excluded.title,
    agreement_body = excluded.agreement_body,
    applicable_designation_codes = excluded.applicable_designation_codes,
    is_active = true,
    effective_from = excluded.effective_from,
    effective_to = null,
    updated_at = now();

notify pgrst, 'reload schema';

commit;
