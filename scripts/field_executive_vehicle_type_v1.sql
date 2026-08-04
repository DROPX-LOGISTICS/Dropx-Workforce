begin;

alter table public.field_executives
  add column if not exists vehicle_type text;

update public.field_executives
set vehicle_type = lower(trim(vehicle_type))
where vehicle_type is not null;

alter table public.field_executives
  drop constraint if exists field_executives_vehicle_type_check;

alter table public.field_executives
  add constraint field_executives_vehicle_type_check
  check (vehicle_type is null or vehicle_type in ('bike', 'van'));

create or replace function public.enforce_field_executive_vehicle_type_on_activation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  designation_code text;
begin
  if new.is_active is true
     and (tg_op = 'INSERT' or old.is_active is distinct from true) then
    select upper(d.code)
      into designation_code
      from public.designations d
     where d.company_id = new.company_id
       and lower(d.name) = lower(new.designation)
       and d.is_active is true
     limit 1;

    if designation_code in ('DA', 'PTDA')
       and coalesce(new.vehicle_type, '') not in ('bike', 'van') then
      raise exception 'Vehicle type is required for DA and PTDA. Choose Bike or Van.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists field_executives_vehicle_type_activation_guard on public.field_executives;
create trigger field_executives_vehicle_type_activation_guard
before insert or update of is_active on public.field_executives
for each row execute function public.enforce_field_executive_vehicle_type_on_activation();

commit;
