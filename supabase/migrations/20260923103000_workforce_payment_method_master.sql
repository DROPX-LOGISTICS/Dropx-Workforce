begin;

-- Shared master only. No registration, mapping, rate, earnings or payroll rows
-- are changed by this migration. Server actions enforce product permissions.
create or replace function public.workforce_save_payment_method(
  p_company_id uuid, p_method_id uuid, p_code text, p_name text, p_field_ids uuid[]
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_method public.payment_methods%rowtype;
  v_id uuid;
  v_fields uuid[];
  v_existing uuid[];
  v_used boolean;
begin
  if p_company_id is null then raise exception 'Company is required.'; end if;
  p_code := upper(btrim(p_code));
  p_name := btrim(p_name);
  if p_code is null or p_code !~ '^[A-Z0-9_]{1,80}$' then raise exception 'Invalid Method ID.'; end if;
  if p_name is null or length(p_name) not between 1 and 160 then raise exception 'Invalid method name.'; end if;
  select array_agg(distinct id order by id) into v_fields from unnest(p_field_ids) id;
  if coalesce(cardinality(v_fields), 0) not between 1 and 50 or array_position(v_fields, null) is not null then
    raise exception 'Select between 1 and 50 payment fields.';
  end if;

  if p_method_id is not null then
    -- Lock conflicts with mapping FK checks, so the in-use test cannot race a new mapping.
    select * into v_method from public.payment_methods
      where id = p_method_id and company_id = p_company_id for update;
    if not found then raise exception 'Payment method not found for this company.'; end if;
    select exists(select 1 from public.field_executive_provider_mappings where payment_method_id = p_method_id) into v_used;
    select array_agg(distinct payment_field_id order by payment_field_id) into v_existing
      from public.payment_method_components where payment_method_id = p_method_id;
    if v_used then
      if p_code <> v_method.code or v_fields is distinct from v_existing then
        raise exception 'This method is in use. Create a new method to change its ID or fields.';
      end if;
      update public.payment_methods set name = p_name, updated_at = now() where id = p_method_id and company_id = p_company_id;
      return p_method_id;
    end if;
  end if;

  perform 1 from public.payment_fields where company_id = p_company_id and id = any(v_fields) and is_active for share;
  if (select count(*) from public.payment_fields where company_id = p_company_id and id = any(v_fields) and is_active) <> cardinality(v_fields) then
    raise exception 'One or more payment fields are inactive or unavailable for this company.';
  end if;
  if p_method_id is null then
    insert into public.payment_methods(company_id, code, name, is_active)
      values(p_company_id, p_code, p_name, true) returning id into v_id;
  else
    v_id := p_method_id;
    update public.payment_methods set code = p_code, name = p_name, updated_at = now() where id = v_id and company_id = p_company_id;
    delete from public.payment_method_components where payment_method_id = v_id;
  end if;
  insert into public.payment_method_components(company_id, payment_method_id, payment_field_id, component_code, component_type, label, pay_schedule, sort_order, is_active)
    select p_company_id, v_id, f.id, f.code, f.field_type, f.label, f.pay_schedule, row_number() over(order by f.code)::integer, true
    from public.payment_fields f where f.company_id = p_company_id and f.id = any(v_fields);
  return v_id;
end;
$$;

revoke all on function public.workforce_save_payment_method(uuid,uuid,text,text,uuid[]) from public, anon, authenticated;
grant execute on function public.workforce_save_payment_method(uuid,uuid,text,text,uuid[]) to service_role;

create or replace function public.workforce_delete_payment_method(p_company_id uuid, p_method_id uuid)
returns void language plpgsql security invoker set search_path = public
as $$
begin
  perform 1 from public.payment_methods where id = p_method_id and company_id = p_company_id for update;
  if not found then raise exception 'Payment method not found for this company.'; end if;
  if exists(select 1 from public.field_executive_provider_mappings where payment_method_id = p_method_id) then
    raise exception 'This payment method is in use and cannot be deleted.';
  end if;
  delete from public.payment_methods where id = p_method_id and company_id = p_company_id;
end;
$$;
revoke all on function public.workforce_delete_payment_method(uuid,uuid) from public, anon, authenticated;
grant execute on function public.workforce_delete_payment_method(uuid,uuid) to service_role;

commit;
