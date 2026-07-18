import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { WheelseyeSettingsPanel } from "@/components/wheelseye-settings-panel";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function loadFlash() {
  const raw = cookies().get("dropx_wheelseye_settings_flash")?.value;
  if (!raw) return { error: null as string | null, notice: null as string | null };
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; notice?: unknown };
    return { error: typeof parsed.error === "string" ? parsed.error : null, notice: typeof parsed.notice === "string" ? parsed.notice : null };
  } catch {
    return { error: null, notice: null };
  }
}

async function loadWheelseyeSettings(companyId: string) {
  const defaults = { is_enabled: false, token_configured: false, token_mask: "" };
  if (!supabaseAdmin) return { settings: defaults, error: "Supabase service role key is not configured." };
  const settings = await supabaseAdmin
    .from("wheelseye_settings")
    .select("is_enabled, token_secret_id")
    .eq("company_id", companyId)
    .eq("id", true)
    .maybeSingle();
  if (settings.error) return { settings: defaults, error: settings.error.message };

  let tokenMask = "";
  if (settings.data?.token_secret_id) {
    const token = await supabaseAdmin.rpc("get_wheelseye_access_token", { company_uuid: companyId });
    const tokenLength = typeof token.data === "string" ? token.data.length : 12;
    tokenMask = "*".repeat(Math.max(8, tokenLength));
  }

  return {
    settings: {
      is_enabled: Boolean(settings.data?.is_enabled),
      token_configured: Boolean(settings.data?.token_secret_id),
      token_mask: tokenMask
    },
    error: null as string | null
  };
}

export default async function WheelseyeSettingsPage() {
  const authorization = await requirePagePermission("app_settings", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.app_settings;
  const data = await loadWheelseyeSettings(companyId);
  const flash = loadFlash();

  return (
    <AppShell active="Settings" pageCode="app_settings">
      <PageHead eyebrow="Configuration" title="Wheelseye Config" subtitle="Configure Wheelseye live GPS integration for Fleet." />
      {data.error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Wheelseye database setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{data.error} Run scripts/wheelseye_settings_v1.sql in Supabase SQL Editor.</p>
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
      {!data.error ? <WheelseyeSettingsPanel canEdit={permission.canEdit || permission.canAdd} settings={data.settings} /> : null}
    </AppShell>
  );
}
