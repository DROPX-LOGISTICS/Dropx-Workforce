alter table public.designations
  add column if not exists model_ids uuid[] not null default '{}';

create index if not exists designations_model_ids_idx
  on public.designations using gin(model_ids);

notify pgrst, 'reload schema';
