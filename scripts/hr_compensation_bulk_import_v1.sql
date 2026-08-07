begin;

create table if not exists public.hr_compensation_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  import_kind text not null,
  effective_from date not null,
  file_name text not null,
  file_sha256 text not null,
  row_count integer not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint hr_compensation_imports_kind_check
    check (import_kind in ('employee_salary','contractor_remuneration')),
  constraint hr_compensation_imports_file_name_check
    check (length(btrim(file_name)) between 1 and 240),
  constraint hr_compensation_imports_sha_check
    check (file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint hr_compensation_imports_row_count_check
    check (row_count between 1 and 500)
);

create unique index if not exists hr_compensation_imports_idempotency_idx
  on public.hr_compensation_imports(company_id, import_kind, effective_from, file_sha256);

create index if not exists hr_compensation_imports_company_created_idx
  on public.hr_compensation_imports(company_id, created_at desc);

alter table public.hr_compensation_imports enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='hr_compensation_imports'
      and policyname='service_role_hr_compensation_imports_all'
  ) then
    create policy service_role_hr_compensation_imports_all
      on public.hr_compensation_imports
      for all
      using (auth.role()='service_role')
      with check (auth.role()='service_role');
  end if;
end $$;

insert into public.hr_payroll_heads(
  company_id, code, name, head_type, is_system, display_order, is_active, created_by
)
select company.id, seed.code, seed.name, seed.head_type, false, seed.display_order, true, null
from public.companies company
cross join (values
  ('BASIC_SALARY','Basic Salary','employee_earning',20),
  ('HRA','HRA','employee_earning',30),
  ('LTA','Leave Travel Allowance','employee_earning',40),
  ('SPA','Special Allowance','employee_earning',50),
  ('FOOD_ALLOWANCE','Food Allowance','employee_earning',60),
  ('COMMUNICATION_ALLOWANCE','Communication Allowance','employee_earning',70),
  ('OTA','Other Allowance','employee_earning',80),
  ('EPF_C','Employer PF','statutory_contribution',90),
  ('ESI_C','Employer ESI','statutory_contribution',100)
) as seed(code,name,head_type,display_order)
where company.is_active
on conflict (company_id,code) do update
set name=excluded.name,
    head_type=excluded.head_type,
    is_active=true;

insert into public.hr_salary_configurations(
  company_id, code, name, description, effective_from, annualisation_factor,
  is_default, is_active, created_by
)
select company.id,
       'SALARY_IMPORT',
       'Salary Import',
       'Employee-specific salary values imported by DropX ID from the owner dashboard.',
       current_date,
       12,
       false,
       true,
       null
from public.companies company
where company.is_active
on conflict (company_id,code) do update
set name=excluded.name,
    description=excluded.description,
    annualisation_factor=12,
    is_active=true;

insert into public.hr_salary_configuration_items(
  company_id, configuration_id, payroll_head_id, calculation_type,
  formula, fixed_amount, value_expression, minimum_value, maximum_value,
  is_enabled, display_order
)
select configuration.company_id,
       configuration.id,
       head.id,
       'input',
       null,
       null,
       null,
       null,
       null,
       true,
       case head.code
         when 'CTC' then 10
         when 'BASIC_SALARY' then 20
         when 'HRA' then 30
         when 'LTA' then 40
         when 'SPA' then 50
         when 'FOOD_ALLOWANCE' then 60
         when 'COMMUNICATION_ALLOWANCE' then 70
         when 'OTA' then 80
         when 'EPF_C' then 90
         when 'ESI_C' then 100
       end
from public.hr_salary_configurations configuration
join public.hr_payroll_heads head
  on head.company_id=configuration.company_id
 and head.code in ('CTC','BASIC_SALARY','HRA','LTA','SPA','FOOD_ALLOWANCE','COMMUNICATION_ALLOWANCE','OTA','EPF_C','ESI_C')
where configuration.code='SALARY_IMPORT'
on conflict (configuration_id,payroll_head_id) do update
set calculation_type='input',
    formula=null,
    fixed_amount=null,
    value_expression=null,
    minimum_value=null,
    maximum_value=null,
    is_enabled=true,
    display_order=excluded.display_order;

update public.hr_salary_configuration_items item
set is_enabled=false,
    updated_at=now()
from public.hr_salary_configurations configuration,
     public.hr_payroll_heads head
where configuration.id=item.configuration_id
  and head.id=item.payroll_head_id
  and configuration.code='SALARY_IMPORT'
  and head.code not in ('CTC','BASIC_SALARY','HRA','LTA','SPA','FOOD_ALLOWANCE','COMMUNICATION_ALLOWANCE','OTA','EPF_C','ESI_C');

create or replace function public.hr_apply_compensation_import(
  p_company_id uuid,
  p_import_kind text,
  p_effective_from date,
  p_file_name text,
  p_file_sha256 text,
  p_rows jsonb,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  saved_import_id uuid;
  import_row jsonb;
  normalized_id text;
  person_id uuid;
  person_count integer;
  configuration_id uuid;
  values_payload jsonb;
  basic_amount numeric(14,2);
  hra_amount numeric(14,2);
  lta_amount numeric(14,2);
  special_amount numeric(14,2);
  food_amount numeric(14,2);
  communication_amount numeric(14,2);
  other_amount numeric(14,2);
  pf_amount numeric(14,2);
  esi_amount numeric(14,2);
  gross_amount numeric(14,2);
  ctc_amount numeric(14,2);
  yearly_ctc_amount numeric(16,2);
  remuneration_amount numeric(14,2);
  ctc_head_id uuid;
  basic_head_id uuid;
  hra_head_id uuid;
  lta_head_id uuid;
  special_head_id uuid;
  food_head_id uuid;
  communication_head_id uuid;
  other_head_id uuid;
  pf_head_id uuid;
  esi_head_id uuid;
begin
  if p_import_kind not in ('employee_salary','contractor_remuneration') then
    raise exception 'Select a valid compensation import type';
  end if;
  if p_effective_from is null then raise exception 'Effective date is required'; end if;
  if length(btrim(coalesce(p_file_name,''))) not between 1 and 240 then raise exception 'File name is invalid'; end if;
  if coalesce(p_file_sha256,'') !~ '^[0-9a-f]{64}$' then raise exception 'File checksum is invalid'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Compensation rows must contain between 1 and 500 items';
  end if;
  if p_actor_user_id is null or not exists (
    select 1
    from public.profiles profile
    left join public.user_roles role on role.id=profile.role_id
    where profile.id=p_actor_user_id
      and profile.is_active
      and (
        coalesce(profile.is_master_owner,false)
        or (
          profile.company_id=p_company_id
          and role.company_id=p_company_id
          and upper(role.code)='OWNER'
          and role.is_active
        )
      )
  ) then
    raise exception 'Only an active owner can apply compensation imports';
  end if;
  if exists (
    select 1 from public.hr_compensation_imports
    where company_id=p_company_id
      and import_kind=p_import_kind
      and effective_from=p_effective_from
      and file_sha256=p_file_sha256
  ) then
    raise exception 'This exact workbook was already imported for the selected effective date';
  end if;
  if exists (
    select 1
    from (
      select upper(btrim(item->>'dropx_id')) as dropx_id, count(*)
      from jsonb_array_elements(p_rows) item
      group by upper(btrim(item->>'dropx_id'))
    ) duplicate
    where duplicate.dropx_id='' or duplicate.count>1
  ) then
    raise exception 'Every compensation row must have one unique DropX ID';
  end if;

  if p_import_kind='employee_salary' then
    select id into configuration_id
    from public.hr_salary_configurations
    where company_id=p_company_id and code='SALARY_IMPORT' and is_active
      and effective_from<=p_effective_from
      and (effective_to is null or effective_to>=p_effective_from);
    if configuration_id is null then raise exception 'Salary Import is not active for the selected effective date'; end if;

    select
      (max(id::text) filter (where code='CTC'))::uuid,
      (max(id::text) filter (where code='BASIC_SALARY'))::uuid,
      (max(id::text) filter (where code='HRA'))::uuid,
      (max(id::text) filter (where code='LTA'))::uuid,
      (max(id::text) filter (where code='SPA'))::uuid,
      (max(id::text) filter (where code='FOOD_ALLOWANCE'))::uuid,
      (max(id::text) filter (where code='COMMUNICATION_ALLOWANCE'))::uuid,
      (max(id::text) filter (where code='OTA'))::uuid,
      (max(id::text) filter (where code='EPF_C'))::uuid,
      (max(id::text) filter (where code='ESI_C'))::uuid
    into ctc_head_id,basic_head_id,hra_head_id,lta_head_id,special_head_id,
         food_head_id,communication_head_id,other_head_id,pf_head_id,esi_head_id
    from public.hr_payroll_heads
    where company_id=p_company_id
      and is_active
      and code in ('CTC','BASIC_SALARY','HRA','LTA','SPA','FOOD_ALLOWANCE','COMMUNICATION_ALLOWANCE','OTA','EPF_C','ESI_C');
    if ctc_head_id is null or basic_head_id is null or hra_head_id is null or lta_head_id is null
       or special_head_id is null or food_head_id is null or communication_head_id is null
       or other_head_id is null or pf_head_id is null or esi_head_id is null then
      raise exception 'Salary Import Payroll Master components are incomplete';
    end if;

    for import_row in select value from jsonb_array_elements(p_rows)
    loop
      normalized_id:=upper(btrim(import_row->>'dropx_id'));
      select count(*), min(employee.id::text)::uuid
      into person_count,person_id
      from public.employees employee
      where employee.company_id=p_company_id
        and upper(btrim(employee.employee_code))=normalized_id;
      if person_count<>1 then raise exception 'DropX employee ID % matched % records',normalized_id,person_count; end if;
      if not exists (select 1 from public.employees where id=person_id and company_id=p_company_id and is_active) then
        raise exception 'DropX employee ID % is inactive',normalized_id;
      end if;
      begin
        basic_amount:=(import_row->>'basic')::numeric;
        hra_amount:=(import_row->>'hra')::numeric;
        lta_amount:=(import_row->>'conveyance_lta')::numeric;
        special_amount:=(import_row->>'special')::numeric;
        food_amount:=(import_row->>'food')::numeric;
        communication_amount:=(import_row->>'communication')::numeric;
        other_amount:=(import_row->>'other')::numeric;
        pf_amount:=(import_row->>'pf')::numeric;
        esi_amount:=(import_row->>'esi')::numeric;
        gross_amount:=(import_row->>'gross')::numeric;
        ctc_amount:=(import_row->>'ctc')::numeric;
        yearly_ctc_amount:=(import_row->>'yearly_ctc')::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'DropX employee ID % contains an invalid amount',normalized_id;
      end;
      if least(basic_amount,hra_amount,lta_amount,special_amount,food_amount,communication_amount,other_amount,pf_amount,esi_amount,gross_amount,yearly_ctc_amount)<0
         or ctc_amount<=0 then raise exception 'DropX employee ID % contains a negative or zero compensation amount',normalized_id; end if;
      if abs(gross_amount-(basic_amount+hra_amount+lta_amount+special_amount+food_amount+communication_amount+other_amount))>0.10 then
        raise exception 'DropX employee ID % Total does not match its salary components',normalized_id;
      end if;
      if abs(ctc_amount-(gross_amount+pf_amount+esi_amount))>0.10 then
        raise exception 'DropX employee ID % CTC does not match Total + PF + ESI',normalized_id;
      end if;
      if yearly_ctc_amount>0 and abs(yearly_ctc_amount-(ctc_amount*12))>0.10 then
        raise exception 'DropX employee ID % yearly CTC does not match monthly CTC x 12',normalized_id;
      end if;
      values_payload:=jsonb_build_object(
        ctc_head_id::text,ctc_amount,
        basic_head_id::text,basic_amount,
        hra_head_id::text,hra_amount,
        lta_head_id::text,lta_amount,
        special_head_id::text,special_amount,
        food_head_id::text,food_amount,
        communication_head_id::text,communication_amount,
        other_head_id::text,other_amount,
        pf_head_id::text,pf_amount,
        esi_head_id::text,esi_amount
      );
      perform public.hr_save_employee_salary_assignment(
        p_company_id,person_id,configuration_id,p_effective_from,values_payload,p_actor_user_id
      );
    end loop;
  else
    for import_row in select value from jsonb_array_elements(p_rows)
    loop
      normalized_id:=upper(btrim(import_row->>'dropx_id'));
      select count(*), min(contractor.id::text)::uuid
      into person_count,person_id
      from public.contractors contractor
      where contractor.company_id=p_company_id
        and upper(btrim(contractor.dropx_id))=normalized_id;
      if person_count<>1 then raise exception 'DropX contractor ID % matched % records',normalized_id,person_count; end if;
      if not exists (select 1 from public.contractors where id=person_id and company_id=p_company_id and is_active) then
        raise exception 'DropX contractor ID % is inactive',normalized_id;
      end if;
      begin
        remuneration_amount:=(import_row->>'remuneration')::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'DropX contractor ID % contains an invalid remuneration amount',normalized_id;
      end;
      if remuneration_amount<=0 then raise exception 'DropX contractor ID % remuneration must be greater than zero',normalized_id; end if;
      perform public.hr_save_contractor_pay_profile(
        p_company_id,person_id,'monthly',remuneration_amount,null,p_effective_from,
        'Owner bulk import: '||left(p_file_name,180),p_actor_user_id
      );
    end loop;
  end if;

  insert into public.hr_compensation_imports(
    company_id,import_kind,effective_from,file_name,file_sha256,row_count,created_by
  ) values (
    p_company_id,p_import_kind,p_effective_from,btrim(p_file_name),p_file_sha256,jsonb_array_length(p_rows),p_actor_user_id
  ) returning id into saved_import_id;
  return saved_import_id;
end;
$$;

revoke all on function public.hr_apply_compensation_import(uuid,text,date,text,text,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.hr_apply_compensation_import(uuid,text,date,text,text,jsonb,uuid)
  to service_role;

commit;
