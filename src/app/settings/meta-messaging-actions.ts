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
  if (!text || /^[*•]+$/.test(text) || text.toLowerCase().includes("token configured")) return null;
  return text;
}

function settingsRedirect(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_meta_messaging_settings_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/settings",
    sameSite: "lax"
  });
  redirect("/settings/meta");
}

function platformRedirect(platform: string, params: { error?: string; notice?: string }): never {
  cookies().set("dropx_meta_messaging_settings_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/settings",
    sameSite: "lax"
  });
  redirect(`/settings/meta?platform=${encodeURIComponent(platform)}`);
}

export async function saveMetaMessagingSettings(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const facebookEnabled = formData.get("is_facebook_enabled") === "on";
    const instagramEnabled = formData.get("is_instagram_enabled") === "on";
    const appSecret = secretInput(formData.get("app_secret"));
    const pageAccessToken = secretInput(formData.get("page_access_token"));

    const current = await supabaseAdmin
      .from("meta_messaging_settings")
      .select("meta_app_id, graph_api_version, webhook_verify_token, facebook_page_id, facebook_page_name, instagram_business_account_id, instagram_connected_page_id, app_secret_secret_id, page_access_token_secret_id")
      .eq("id", true)
      .eq("company_id", companyId)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);

    const existing = current.data;
    const metaAppId = formData.has("meta_app_id") ? clean(formData.get("meta_app_id")) : existing?.meta_app_id ?? null;
    const graphApiVersion = formData.has("graph_api_version") ? clean(formData.get("graph_api_version")) ?? "v25.0" : existing?.graph_api_version ?? "v25.0";
    const webhookVerifyToken = formData.has("webhook_verify_token") ? clean(formData.get("webhook_verify_token")) : existing?.webhook_verify_token ?? null;
    const facebookPageId = formData.has("facebook_page_id") ? clean(formData.get("facebook_page_id")) : existing?.facebook_page_id ?? null;
    const facebookPageName = formData.has("facebook_page_name") ? clean(formData.get("facebook_page_name")) : existing?.facebook_page_name ?? null;
    const instagramBusinessAccountId = formData.has("instagram_business_account_id") ? clean(formData.get("instagram_business_account_id")) : existing?.instagram_business_account_id ?? null;
    const instagramConnectedPageId = formData.has("instagram_connected_page_id") ? clean(formData.get("instagram_connected_page_id")) : existing?.instagram_connected_page_id ?? null;

    if ((facebookEnabled || instagramEnabled) && !metaAppId) throw new Error("Meta App ID is required before enabling channels.");
    if (facebookEnabled && !facebookPageId) throw new Error("Facebook Page ID is required before enabling Facebook messages.");
    if (instagramEnabled && !instagramBusinessAccountId) throw new Error("Instagram Business Account ID is required before enabling Instagram messages.");
    if ((facebookEnabled || instagramEnabled) && !pageAccessToken && !current.data?.page_access_token_secret_id) {
      throw new Error("Page access token is required before enabling Facebook or Instagram messages.");
    }

    const { error } = await supabaseAdmin.from("meta_messaging_settings").upsert({
      id: true,
      company_id: companyId,
      is_facebook_enabled: facebookEnabled,
      is_instagram_enabled: instagramEnabled,
      meta_app_id: metaAppId,
      graph_api_version: graphApiVersion,
      webhook_verify_token: webhookVerifyToken,
      facebook_page_id: facebookPageId,
      facebook_page_name: facebookPageName,
      instagram_business_account_id: instagramBusinessAccountId,
      instagram_connected_page_id: instagramConnectedPageId,
      updated_by: authorization.userId,
      updated_at: new Date().toISOString()
    }, { onConflict: "company_id,id" });
    if (error) throw new Error(error.message);

    if (webhookVerifyToken !== existing?.webhook_verify_token) {
      const syncWhatsApp = await supabaseAdmin.from("whatsapp_settings").upsert({
        id: true,
        company_id: companyId,
        webhook_verify_token: webhookVerifyToken,
        updated_by: authorization.userId,
        updated_at: new Date().toISOString()
      }, { onConflict: "company_id,id" });
      if (syncWhatsApp.error) throw new Error(syncWhatsApp.error.message);
    }

    if (appSecret) {
      const secret = await supabaseAdmin.rpc("set_meta_app_secret", { secret_value: appSecret, company_uuid: companyId });
      if (secret.error) throw new Error(secret.error.message);
    }

    if (pageAccessToken) {
      const token = await supabaseAdmin.rpc("set_meta_page_access_token", { secret_value: pageAccessToken, company_uuid: companyId });
      if (token.error) throw new Error(token.error.message);
    }

    revalidatePath("/settings");
    revalidatePath("/settings/messaging");
    revalidatePath("/settings/meta");
    revalidatePath("/settings/meta-messaging");
  } catch (error) {
    settingsRedirect({ error: error instanceof Error ? error.message : "Unable to save Meta messaging settings." });
  }
  settingsRedirect({ notice: "Meta messaging settings saved." });
}

export async function saveMetaChannelProfile(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  const platform = String(formData.get("platform") ?? "").trim().toLowerCase();
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    if (!["facebook", "instagram"].includes(platform)) throw new Error("Invalid Meta platform.");

    const profileId = clean(formData.get("profile_id"));
    const profileName = clean(formData.get("profile_name"));
    const pageId = clean(formData.get("page_id"));
    const pageName = clean(formData.get("page_name"));
    const instagramBusinessAccountId = clean(formData.get("instagram_business_account_id"));
    const connectedPageId = clean(formData.get("connected_page_id"));
    const graphApiVersion = clean(formData.get("graph_api_version")) ?? "v25.0";
    const accessToken = secretInput(formData.get("access_token"));
    const chatEnabled = formData.get("chat_enabled") === "on";
    const isActive = formData.get("is_active") === "on";
    const isDefault = formData.get("is_default") === "on";

    if (!profileName) throw new Error("Profile name is required.");
    if (platform === "facebook" && !pageId) throw new Error("Facebook Page ID is required.");
    if (platform === "instagram" && !instagramBusinessAccountId) throw new Error("Instagram business account ID is required.");

    let existingTokenId: string | null = null;
    if (profileId) {
      const current = await supabaseAdmin
        .from("meta_channel_profiles")
        .select("access_token_secret_id")
        .eq("id", profileId)
        .eq("company_id", companyId)
        .single();
      if (current.error) throw new Error(current.error.message);
      existingTokenId = current.data?.access_token_secret_id ?? null;
    }
    if (isActive && !accessToken && !existingTokenId) throw new Error("Access token is required before activating this profile.");

    const payload = {
      company_id: companyId,
      channel: platform,
      profile_name: profileName,
      page_id: platform === "facebook" ? pageId : connectedPageId,
      page_name: pageName,
      instagram_business_account_id: platform === "instagram" ? instagramBusinessAccountId : null,
      connected_page_id: connectedPageId,
      graph_api_version: graphApiVersion,
      chat_enabled: chatEnabled,
      is_active: isActive,
      is_default: isDefault,
      updated_by: authorization.userId,
      updated_at: new Date().toISOString()
    };

    let savedId = profileId;
    if (profileId) {
      const result = await supabaseAdmin
        .from("meta_channel_profiles")
        .update(payload)
        .eq("id", profileId)
        .eq("company_id", companyId)
        .select("id")
        .single();
      if (result.error) throw new Error(result.error.message);
      savedId = result.data.id;
    } else {
      const result = await supabaseAdmin
        .from("meta_channel_profiles")
        .insert(payload)
        .select("id")
        .single();
      if (result.error) throw new Error(result.error.message);
      savedId = result.data.id;
    }

    if (accessToken && savedId) {
      const secret = await supabaseAdmin.rpc("set_meta_channel_profile_access_token", { profile_id: savedId, secret_value: accessToken });
      if (secret.error) throw new Error(secret.error.message);
    }

    if (isDefault && savedId) {
      const result = await supabaseAdmin
        .from("meta_channel_profiles")
        .update({ is_default: false })
        .eq("company_id", companyId)
        .eq("channel", platform)
        .neq("id", savedId);
      if (result.error) throw new Error(result.error.message);
      const makeDefault = await supabaseAdmin.from("meta_channel_profiles").update({ is_default: true }).eq("id", savedId).eq("company_id", companyId);
      if (makeDefault.error) throw new Error(makeDefault.error.message);
    }

    const settingsPatch = platform === "facebook"
      ? { is_facebook_enabled: true }
      : { is_instagram_enabled: true };
    const settings = await supabaseAdmin.from("meta_messaging_settings").upsert({ id: true, company_id: companyId, ...settingsPatch, updated_at: new Date().toISOString() }, { onConflict: "company_id,id" });
    if (settings.error) throw new Error(settings.error.message);

    revalidatePath("/settings");
    revalidatePath("/settings/meta");
  } catch (error) {
    platformRedirect(platform || "facebook", { error: error instanceof Error ? error.message : "Unable to save Meta profile." });
  }
  platformRedirect(platform, { notice: `${platform === "instagram" ? "Instagram" : "Facebook"} profile saved.` });
}

export async function deleteMetaChannelProfile(formData: FormData) {
  const platform = String(formData.get("platform") ?? "").trim().toLowerCase();
  try {
    const authorization = await requirePagePermission("app_settings", "edit");
    const companyId = requireCompanyId(authorization);
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    if (!["facebook", "instagram"].includes(platform)) throw new Error("Invalid Meta platform.");
    const profileId = clean(formData.get("profile_id"));
    if (!profileId) throw new Error("Profile is missing.");

    const profile = await supabaseAdmin
      .from("meta_channel_profiles")
      .select("profile_name, page_name")
      .eq("id", profileId)
      .eq("company_id", companyId)
      .single();
    if (profile.error) throw new Error(profile.error.message);

    const names = [profile.data.profile_name, profile.data.page_name].filter(Boolean);
    if (names.length) {
      const usage = await supabaseAdmin
        .from("inbox_conversations")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("channel", platform)
        .in("whatsapp_profile_name", names);
      if (usage.error) throw new Error(usage.error.message);
      if ((usage.count ?? 0) > 0) throw new Error(`Profile is used in ${usage.count} conversations and cannot be deleted.`);
    }

    const result = await supabaseAdmin.from("meta_channel_profiles").delete().eq("id", profileId).eq("company_id", companyId);
    if (result.error) throw new Error(result.error.message);
    revalidatePath("/settings");
    revalidatePath("/settings/meta");
  } catch (error) {
    platformRedirect(platform || "facebook", { error: error instanceof Error ? error.message : "Unable to delete Meta profile." });
  }
  platformRedirect(platform, { notice: `${platform === "instagram" ? "Instagram" : "Facebook"} profile deleted.` });
}
