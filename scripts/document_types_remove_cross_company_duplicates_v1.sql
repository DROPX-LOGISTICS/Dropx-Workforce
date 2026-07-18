-- Removes unused document master rows that were copied/seeded into other companies.
-- 1) First check company codes:
--    select code, name from public.companies order by code;
-- 2) Change keep_company_code below to the company that should keep the existing templates.
-- 3) Run in Supabase SQL Editor.
-- Used document types are not deleted.

with params as (
  select 'DROPX_LOGISTICS'::text as keep_company_code
),
keep_company as (
  select companies.id
  from public.companies
  cross join params
  where companies.code = params.keep_company_code
),
keep_codes as (
  select distinct document_types.code
  from public.document_types
  join keep_company
    on keep_company.id = document_types.company_id
),
delete_candidates as (
  select document_types.id
  from public.document_types
  join public.companies
    on companies.id = document_types.company_id
  join keep_codes
    on keep_codes.code = document_types.code
  cross join params
  where companies.code <> params.keep_company_code
    and not exists (
      select 1
      from public.fleet_vehicle_documents
      where fleet_vehicle_documents.company_id = document_types.company_id
        and upper(fleet_vehicle_documents.document_type) = document_types.code
    )
    and not exists (
      select 1
      from public.business_document_records
      where business_document_records.company_id = document_types.company_id
        and business_document_records.document_type_id = document_types.id
    )
)
delete from public.document_types
using delete_candidates
where document_types.id = delete_candidates.id
returning document_types.company_id, document_types.code, document_types.name;

select companies.code as company_code,
       companies.name as company_name,
       count(document_types.id) as document_type_count
from public.companies
left join public.document_types
  on document_types.company_id = companies.id
group by companies.code, companies.name
order by companies.code;
