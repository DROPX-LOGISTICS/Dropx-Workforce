begin;

create or replace function public.prevent_field_executive_dropx_id_change()
returns trigger
language plpgsql
as $$
begin
  if new.dropx_id is distinct from old.dropx_id then
    raise exception 'DropX ID cannot be changed after creation.';
  end if;
  return new;
end;
$$;

drop trigger if exists field_executive_dropx_id_immutable on public.field_executives;
create trigger field_executive_dropx_id_immutable
before update of dropx_id on public.field_executives
for each row execute function public.prevent_field_executive_dropx_id_change();

commit;
