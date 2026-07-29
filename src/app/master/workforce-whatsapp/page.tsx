import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { WORKFORCE_APPLICANT_EVENT, WORKFORCE_APPLICANT_TEMPLATE } from "@/lib/workforce-applicant-whatsapp";
import { saveWorkforceWhatsApp } from "./actions";

export const dynamic = "force-dynamic";

export default async function WorkforceWhatsAppMasterPage() {
  const authorization = await requirePagePermission("designations", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.designations;
  const [config, contacts] = supabaseAdmin ? await Promise.all([
    supabaseAdmin.from("whatsapp_notification_configs")
      .select("is_enabled,template_name").eq("company_id", companyId).eq("event_code", WORKFORCE_APPLICANT_EVENT).maybeSingle(),
    supabaseAdmin.from("recruitment_station_contacts")
      .select("station_code,poc_mobile,address").eq("company_id", companyId)
  ]) : [{ data: null, error: { message: "Supabase is not configured." } }, { data: [], error: null }];
  const raw = cookies().get("dropx_workforce_whatsapp_flash")?.value;
  let flash: { error?: string; notice?: string } = {};
  try { flash = raw ? JSON.parse(raw) : {}; } catch {}
  const rows = contacts.data ?? [];
  const ready = rows.filter((row) => row.poc_mobile && row.address).length;

  return (
    <AppShell active="Workforce WhatsApp" pageCode="designations">
      <PageHead eyebrow="Master Data" title="Workforce Applicant WhatsApp" subtitle="Control the automatic acknowledgement sent when a workforce applicant submits a Meta lead form." />
      {flash.error || flash.notice ? <section className={`panel message-panel ${flash.error ? "error" : "success"}`}><div className="panel-body"><strong>{flash.error ? "Action required" : "Saved"}</strong><p className="subtle" style={{ marginTop: 6 }}>{flash.error ?? flash.notice}</p></div></section> : null}
      <section className="panel">
        <form action={saveWorkforceWhatsApp} className="panel-body">
          <div className="panel-head" style={{ padding: 0, border: 0 }}>
            <div>
              <h2>New applicant auto-message</h2>
              <p className="subtle">Workforce only. HR and other applicant flows are not triggered.</p>
            </div>
            <label className="toggle-field compact-toggle">
              <input defaultChecked={Boolean(config.data?.is_enabled)} disabled={!permission.canEdit} name="is_enabled" type="checkbox" />
              <span>{config.data?.is_enabled ? "On" : "Off"}</span>
            </label>
          </div>
          <div className="compact-summary-grid" style={{ marginTop: 18 }}>
            <div><span className="subtle">Template</span><strong>{config.data?.template_name || WORKFORCE_APPLICANT_TEMPLATE}</strong></div>
            <div><span className="subtle">Message includes</span><strong>Name · role · POC · address</strong></div>
            <div><span className="subtle">Station contacts ready</span><strong>{ready}/{rows.length}</strong></div>
            <div><span className="subtle">Duplicate protection</span><strong>One new-lead message</strong></div>
          </div>
          {permission.canEdit ? <div className="form-actions"><SubmitButton>Save</SubmitButton></div> : null}
        </form>
      </section>
    </AppShell>
  );
}
