create or replace function public.set_whatsapp_access_token(secret_value text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  secret_id uuid;
begin
  select vault.create_secret(
    secret_value,
    'dropx_whatsapp_access_token_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX WhatsApp Cloud API token'
  ) into secret_id;

  update public.whatsapp_settings
    set token_secret_id = secret_id, updated_at = now()
    where id = true;

  return secret_id;
end;
$$;

revoke all on function public.set_whatsapp_access_token(text) from public, anon, authenticated;
grant execute on function public.set_whatsapp_access_token(text) to service_role;
