import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { VerificationApiSettingsPanel } from "@/components/verification-api-settings-panel";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function loadFlash() {
  const raw = cookies().get("dropx_verification_api_settings_flash")?.value;
  if (!raw) return { error: null as string | null, notice: null as string | null };
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; notice?: unknown };
    return { error: typeof parsed.error === "string" ? parsed.error : null, notice: typeof parsed.notice === "string" ? parsed.notice : null };
  } catch {
    return { error: null, notice: null };
  }
}

async function secretMask(companyId: string, providerCode: string, secretKind: "api_key" | "token_id") {
  if (!supabaseAdmin) return "";
  const secret = await supabaseAdmin.rpc("get_verification_api_secret", {
    company_uuid: companyId,
    provider: providerCode,
    secret_kind: secretKind
  });
  const length = typeof secret.data === "string" ? secret.data.length : 12;
  return "*".repeat(Math.max(8, length));
}

async function loadVerificationApiSettings(companyId: string) {
  const defaults = {
    api_id: "",
    api_key_configured: false,
    api_key_mask: "",
    has_settings: false,
    is_enabled: false,
    provider_code: "idspay",
    token_id_configured: false,
    token_id_mask: ""
  };
  if (!supabaseAdmin) return { settings: defaults, error: "Supabase service role key is not configured." };

  const settings = await supabaseAdmin
    .from("verification_api_settings")
    .select("provider_code, is_enabled, api_id, api_key_secret_id, token_id_secret_id")
    .eq("company_id", companyId)
    .eq("provider_code", "idspay")
    .maybeSingle();
  if (settings.error) return { settings: defaults, error: settings.error.message };

  const providerCode = settings.data?.provider_code ?? "idspay";
  const [apiKeyMask, tokenIdMask] = await Promise.all([
    settings.data?.api_key_secret_id ? secretMask(companyId, providerCode, "api_key") : Promise.resolve(""),
    settings.data?.token_id_secret_id ? secretMask(companyId, providerCode, "token_id") : Promise.resolve("")
  ]);

  return {
    settings: {
      api_id: settings.data?.api_id ?? "",
      api_key_configured: Boolean(settings.data?.api_key_secret_id),
      api_key_mask: apiKeyMask,
      has_settings: Boolean(settings.data),
      is_enabled: Boolean(settings.data?.is_enabled),
      provider_code: providerCode,
      token_id_configured: Boolean(settings.data?.token_id_secret_id),
      token_id_mask: tokenIdMask
    },
    error: null as string | null
  };
}

export default async function VerificationApisSettingsPage() {
  const authorization = await requirePagePermission("app_settings", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.app_settings;
  const data = await loadVerificationApiSettings(companyId);
  const flash = loadFlash();

  return (
    <AppShell active="Settings" pageCode="app_settings">
      <PageHead eyebrow="Configuration" title="Verification APIs" subtitle="Configure third-party verification API credentials." />
      {data.error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Verification API database setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{data.error} Run scripts/verification_api_settings_v1.sql in Supabase SQL Editor.</p>
          </div>
        </section>
      ) : null}
      {!data.error && (flash.error || flash.notice) ? (
        <section className={`panel message-panel ${flash.error ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{flash.error ? "Action required" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{flash.error ?? flash.notice}</p>
          </div>
        </section>
      ) : null}
      {!data.error ? <VerificationApiSettingsPanel canEdit={permission.canEdit || permission.canAdd} settings={data.settings} /> : null}
    </AppShell>
  );
}
