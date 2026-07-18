import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { MetaLeadsSettingsPanel } from "@/components/meta-leads-settings-panel";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function loadFlash() {
  const raw = cookies().get("dropx_meta_leads_settings_flash")?.value;
  if (!raw) return { error: null as string | null, notice: null as string | null };
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; notice?: unknown };
    return {
      error: typeof parsed.error === "string" ? parsed.error : null,
      notice: typeof parsed.notice === "string" ? parsed.notice : null
    };
  } catch {
    return { error: null, notice: null };
  }
}

async function loadMetaLeadsSettings(companyId: string) {
  const defaults = {
    is_enabled: false,
    meta_app_id: "",
    graph_api_version: "v25.0",
    ad_account_id: "",
    page_id: "",
    page_name: "",
    webhook_verify_token: "",
    app_secret_mask: "",
    access_token_mask: "",
    app_secret_configured: false,
    access_token_configured: false,
    last_synced_at: null as string | null
  };

  if (!supabaseAdmin) return { settings: defaults, error: "Supabase service role key is not configured." };
  const result = await supabaseAdmin
    .from("meta_leads_settings")
    .select("is_enabled, meta_app_id, graph_api_version, ad_account_id, page_id, page_name, webhook_verify_token, app_secret_secret_id, access_token_secret_id, last_synced_at")
    .eq("company_id", companyId)
    .eq("id", true)
    .maybeSingle();

  if (result.error) return { settings: defaults, error: result.error.message };
  const row = result.data;

  const maskSecret = (configured: boolean) => (configured ? "********************************" : "");

  return {
    settings: {
      is_enabled: Boolean(row?.is_enabled),
      meta_app_id: row?.meta_app_id ?? "",
      graph_api_version: row?.graph_api_version ?? "v25.0",
      ad_account_id: row?.ad_account_id ?? "",
      page_id: row?.page_id ?? "",
      page_name: row?.page_name ?? "",
      webhook_verify_token: row?.webhook_verify_token ?? "",
      app_secret_mask: maskSecret(Boolean(row?.app_secret_secret_id)),
      access_token_mask: maskSecret(Boolean(row?.access_token_secret_id)),
      app_secret_configured: Boolean(row?.app_secret_secret_id),
      access_token_configured: Boolean(row?.access_token_secret_id),
      last_synced_at: row?.last_synced_at ?? null
    },
    error: null as string | null
  };
}

export default async function AdsLeadsSettingsPage() {
  const authorization = await requirePagePermission("app_settings", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.app_settings;
  const data = await loadMetaLeadsSettings(companyId);
  const flash = loadFlash();

  return (
    <AppShell active="Settings" pageCode="app_settings">
      <PageHead
        eyebrow="Configuration"
        title="Ads & Leads Config"
        subtitle="Shared lead webhook settings and platform-specific ad lead configuration."
        action={<a className="button secondary" href="/settings">Back</a>}
      />

      {data.error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Ads & Leads database setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{data.error} Run scripts/leads_v1.sql in Supabase SQL Editor.</p>
          </div>
        </section>
      ) : null}

      {flash.error || flash.notice ? (
        <section className={`panel message-panel ${flash.error ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{flash.error ? "Action required" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{flash.error ?? flash.notice}</p>
          </div>
        </section>
      ) : null}

      {!data.error ? (
        <MetaLeadsSettingsPanel
          canEdit={permission.canEdit || permission.canAdd}
          settings={data.settings}
        />
      ) : null}
    </AppShell>
  );
}
