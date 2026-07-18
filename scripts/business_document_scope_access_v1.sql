alter table public.document_types
  add column if not exists enable_scope_access boolean not null default false;

alter table public.business_document_records
  add column if not exists additional_scope_ids text[] not null default '{}';

create index if not exists business_document_records_additional_scope_ids_idx
  on public.business_document_records using gin (additional_scope_ids);
