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

function settingsRedirect(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_wheelseye_settings_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/settings",
    sameSite: "lax"
  });
  redirect("/settings/wheelseye");
}

export async function saveWheelseyeSettings(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const isEnabled = formData.get("is_enabled") === "on";
    const tokenInput = clean(formData.get("access_token"));
    const accessToken = tokenInput && /^\*+$/.test(tokenInput) ? null : tokenInput;

    const current = await supabaseAdmin
      .from("wheelseye_settings")
      .select("token_secret_id")
      .eq("id", true)
      .eq("company_id", companyId)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (isEnabled && !accessToken && !current.data?.token_secret_id) {
      throw new Error("Access token is required before enabling Wheelseye.");
    }

    const { error } = await supabaseAdmin.from("wheelseye_settings").upsert({
      id: true,
      company_id: companyId,
      is_enabled: isEnabled,
      updated_by: authorization.userId,
      updated_at: new Date().toISOString()
    }, { onConflict: "company_id,id" });
    if (error) throw new Error(error.message);

    if (accessToken) {
      const secret = await supabaseAdmin.rpc("set_wheelseye_access_token", { secret_value: accessToken, company_uuid: companyId });
      if (secret.error) throw new Error(secret.error.message);
    }

    revalidatePath("/settings");
    revalidatePath("/settings/wheelseye");
    revalidatePath("/fleet");
  } catch (error) {
    settingsRedirect({ error: error instanceof Error ? error.message : "Unable to save Wheelseye settings." });
  }
  settingsRedirect({ notice: "Wheelseye settings saved." });
}
