alter table public.field_executives
  add column if not exists eshram_uan text;

alter table public.field_executives
  drop constraint if exists field_executives_eshram_uan_digits_check;

alter table public.field_executives
  add constraint field_executives_eshram_uan_digits_check
  check (eshram_uan is null or eshram_uan ~ '^[0-9]{12}$');
