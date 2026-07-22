"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function secretInput(value: FormDataEntryValue | null) {
  const text = clean(value);
  return text && /^\*+$/.test(text) ? null : text;
}

function settingsRedirect(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_verification_api_settings_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/settings",
    sameSite: "lax"
  });
  redirect("/settings/verification-apis");
}

export async function saveVerificationApiSettings(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);

  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const providerCode = clean(formData.get("provider_code"))?.toLowerCase();
    if (providerCode !== "idspay") throw new Error("Select a valid verification API.");

    const isEnabled = formData.get("is_enabled") === "on";
    const apiId = clean(formData.get("api_id"));
    const apiKey = secretInput(formData.get("api_key"));
    const tokenId = secretInput(formData.get("token_id"));

    const current = await supabaseAdmin
      .from("verification_api_settings")
      .select("api_key_secret_id, token_id_secret_id")
      .eq("company_id", companyId)
      .eq("provider_code", providerCode)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);

    if (isEnabled && !apiId) throw new Error("API ID is required before enabling IDSPAY.");
    if (isEnabled && !apiKey && !current.data?.api_key_secret_id) throw new Error("API key is required before enabling IDSPAY.");
    if (isEnabled && !tokenId && !current.data?.token_id_secret_id) throw new Error("Token ID is required before enabling IDSPAY.");

    const saved = await supabaseAdmin.from("verification_api_settings").upsert({
      company_id: companyId,
      provider_code: providerCode,
      is_enabled: isEnabled,
      api_id: apiId,
      updated_by: authorization.userId,
      updated_at: new Date().toISOString()
    }, { onConflict: "company_id,provider_code" });
    if (saved.error) throw new Error(saved.error.message);

    if (apiKey) {
      const secret = await supabaseAdmin.rpc("set_verification_api_secret", {
        company_uuid: companyId,
        provider: providerCode,
        secret_kind: "api_key",
        secret_value: apiKey
      });
      if (secret.error) throw new Error(secret.error.message);
    }

    if (tokenId) {
      const secret = await supabaseAdmin.rpc("set_verification_api_secret", {
        company_uuid: companyId,
        provider: providerCode,
        secret_kind: "token_id",
        secret_value: tokenId
      });
      if (secret.error) throw new Error(secret.error.message);
    }

    revalidatePath("/settings");
    revalidatePath("/settings/verification-apis");
  } catch (error) {
    settingsRedirect({ error: error instanceof Error ? error.message : "Unable to save verification API settings." });
  }

  settingsRedirect({ notice: "Verification API settings saved." });
}
