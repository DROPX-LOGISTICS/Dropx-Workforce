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
  $agreement$1. CONTRACTOR STATUS
I am joining DropX in my individual capacity as an independent contractor for delivery and related logistics services. This is a contract-for-services arrangement and does not by itself create permanent employment, salary or employee-benefit entitlement.

2. WORK, ATTENDANCE AND DISCIPLINE
After accepting duty, I will report to the assigned station, hub or location on time, record attendance through the authorised method and follow applicable DropX and client rules, safety requirements, lawful instructions, service standards, performance metrics and workplace discipline.

3. SHIPMENT AND CASH RESPONSIBILITY
Shipments, collected cash, devices and other assets remain in my custody until delivered or formally returned. Every undelivered or failed shipment and all collected cash must be returned to the assigned delivery station or hub on the same day and acknowledged through the prescribed process. I will not retain them overnight without a recorded authorised exception. A verified loss, shortage, damage, misuse or failure to return caused by my act, omission, negligence, misconduct, fraud or breach may make me financially responsible after reconciliation or investigation, subject to applicable law. Non-return may lead to penalty, suspension, removal or deactivation from the system and legal action where warranted.

4. DELIVERY PAYMENT AND RATE CARD
Payment is calculated per eligible and verified package delivered, according to the station-, route-, service- and client-specific rate card shown or communicated through the app or authorised channel. Approved payable amounts will be credited to my registered bank account after operational reconciliation. There is no guaranteed minimum volume, earning or automatic increment. The rate card is final for its stated period and may be reviewed at three-month intervals. It may be reduced prospectively based on shipment volume or density, route productivity, station conditions, client pricing or operating requirements after the revised rate and effective period are communicated.

5. PENALTIES AND INCENTIVES
Documented performance, service-quality, shortage and non-compliance penalties or recoveries may be introduced or revised from time to time. Incentives may also be offered for a defined period. The applicable metric, conditions and validity period will be communicated through the app or an authorised channel. A time-bound incentive does not create a continuing entitlement after its stated period.

6. CONDUCT AND ACTION
I will not commit fraud, falsify records, manipulate attendance or delivery events, misuse customer or company information, substitute another person, misbehave or use shipments, cash, credentials or assets for an unauthorised purpose. A verified breach may result in warning, penalty, recovery, suspension, deactivation, termination and civil, criminal or police action where appropriate. On exit I will return all cash, shipments, documents and assets before final settlement.

7. DECLARATION AND ELECTRONIC ACCEPTANCE
I confirm that my submitted information and documents are correct and consent to verification of my identity, bank, licence, vehicle, attendance, location, delivery and cash-handling records. By accepting and submitting, I confirm that I have read and understood this agreement and agree to its current version. DropX may retain the acceptance time, version, content hash, IP address and device or browser information as the electronic audit record.$agreement$,
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
