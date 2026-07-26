insert into storage.buckets (id, name, public, file_size_limit)
values ('report-import-staging', 'report-import-staging', false, 104857600)
on conflict (id) do update set
  public = false,
  file_size_limit = 104857600;
