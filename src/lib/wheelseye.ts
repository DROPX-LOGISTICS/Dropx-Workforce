import { supabaseAdmin } from "@/lib/supabase-admin";

export async function getWheelseyeAccessToken(companyId?: string | null) {
  if (!supabaseAdmin) return process.env.WHEELSEYE_ACCESS_TOKEN ?? null;
  if (!companyId) return null;

  const settings = await supabaseAdmin
    .from("wheelseye_settings")
    .select("is_enabled, token_secret_id")
    .eq("company_id", companyId)
    .eq("id", true)
    .maybeSingle();

  if (settings.error) return null;
  if (!settings.data?.is_enabled) return null;

  const token = await supabaseAdmin.rpc("get_wheelseye_access_token", { company_uuid: companyId });
  if (token.error || typeof token.data !== "string" || !token.data.trim()) {
    return null;
  }
  return token.data.trim();
}
