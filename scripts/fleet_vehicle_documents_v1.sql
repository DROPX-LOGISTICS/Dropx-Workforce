create table if not exists public.fleet_vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  vehicle_no text not null references public.fleet_vehicles(vehicle_no) on update cascade on delete cascade,
  document_type text not null,
  file_name text not null,
  content_type text,
  file_size bigint,
  storage_bucket text not null default 'fleet-documents',
  storage_path text not null,
  expiry_date text,
  is_active boolean not null default true,
  uploaded_at timestamptz not null default now(),
  replaced_at timestamptz,
  delete_after timestamptz,
  created_at timestamptz not null default now()
);

alter table public.fleet_vehicle_documents
  drop constraint if exists fleet_vehicle_documents_document_type_check;

update public.fleet_vehicle_documents
set document_type = case document_type
    when 'registration' then 'FLEET_REGISTRATION'
    when 'insurance' then 'FLEET_INSURANCE'
    when 'puc' then 'FLEET_PUC'
    when 'fitness' then 'FLEET_FITNESS'
    when 'tax' then 'FLEET_TAX'
    when 'fleet_registration' then 'FLEET_REGISTRATION'
    when 'fleet_insurance' then 'FLEET_INSURANCE'
    when 'fleet_puc' then 'FLEET_PUC'
    when 'fleet_fitness' then 'FLEET_FITNESS'
    when 'fleet_tax' then 'FLEET_TAX'
    else document_type
  end
where document_type in ('registration', 'insurance', 'puc', 'fitness', 'tax', 'fleet_registration', 'fleet_insurance', 'fleet_puc', 'fleet_fitness', 'fleet_tax');

create index if not exists fleet_vehicle_documents_vehicle_idx
  on public.fleet_vehicle_documents (vehicle_no);

create index if not exists fleet_vehicle_documents_active_idx
  on public.fleet_vehicle_documents (vehicle_no, document_type, is_active);

create unique index if not exists fleet_vehicle_documents_one_active_idx
  on public.fleet_vehicle_documents (vehicle_no, document_type)
  where is_active = true;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fleet-documents', 'fleet-documents', false, 20971520, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;
