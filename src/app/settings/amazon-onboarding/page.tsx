import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { isCompanyOwner,requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { saveOnboardingConnection } from "./actions";
export const dynamic="force-dynamic";
const when=(value:string|null|undefined)=>value ? new Date(value).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"}):"Not yet";
export default async function ConnectionPage() {
  const auth=await requirePagePermission("amazon_connector","access");
  if(!isCompanyOwner(auth)) redirect("/unauthorized?page=amazon_connector");
  const company=requireCompanyId(auth);
  const [config,sync]=supabaseAdmin ? await Promise.all([
    supabaseAdmin.from("workforce_amazon_connections").select("username,enabled,version,updated_at,login_requested_at,login_attempted_at").eq("company_id",company).maybeSingle(),
    supabaseAdmin.from("workforce_amazon_sync_state").select("status,last_attempt_at,last_success_at,matched_count,missing_count").eq("company_id",company).maybeSingle()
  ]):[{data:null,error:true},{data:null,error:true}];
  let notice:{message:string;ok:boolean}|null=null;
  try {notice=JSON.parse(cookies().get("workforce_amazon_connection_notice")?.value||"null");} catch {}
  const c=config.data;const s=sync.data;const unavailable=config.error||sync.error;
  const statuses:Record<string,string>={not_started:"Awaiting worker check",running:"Checking Amazon",ok:"Provider scan completed",no_linked_profiles:"No linked profiles · roster scan not run",login_required:"Sign-in or Amazon verification required",layout_changed:"Amazon page changed · review needed",unavailable:"Worker check failed · review needed"};
  return <AppShell active="Amazon Connection" pageCode="amazon_connector">
    <PageHead eyebrow="Configuration · Connections" title="Amazon Onboarding Connection" subtitle="A dedicated connection to logistics.amazon.in. SCC EDD/COD credentials and schedules are unchanged."/>
    {notice ? <div role="status" className={`alert ${notice.ok ? "success":"error"}`}>{notice.message}</div>:null}
    {unavailable ? <section className="panel"><div className="panel-body"><h2>Connection storage unavailable</h2><p>Wait for the database release or contact your administrator. Credentials cannot be saved yet.</p></div></section>:<>
      <section className="panel"><div className="panel-head"><div><h2>Portal login</h2><p>Password and session are encrypted in Vault. Passwords are never returned to this page.</p></div></div><form action={saveOnboardingConnection} className="panel-body">
        <input name="version" type="hidden" value={c?.version??0}/>
        <div className="form-grid two">
          <label>Amazon portal<input value="https://logistics.amazon.in" readOnly className="field"/></label>
          <label>Login email<input name="username" type="email" defaultValue={c?.username??""} autoComplete="username" required maxLength={254} className="field"/></label>
          <label>Password<input name="password" type="password" autoComplete="new-password" maxLength={1024} required={!c} placeholder={c ? "Saved · leave blank to keep":"Enter the Amazon login password"} className="field"/><small>Changing the login email requires re-entering its password.</small></label>
          <label className="checkbox-row"><input name="enabled" type="checkbox" defaultChecked={c?.enabled??false}/> Enable onboarding connection and scheduled checks</label>
        </div>
        <p className="field-hint">Saving new credentials queues one sign-in attempt. “Save & test connection” queues another attempt. Checks run every 30 minutes; OTP, CAPTCHA and Amazon approval are never bypassed. Do not disable account security.</p>
        <div className="form-actions"><SubmitButton disabled={auth.readOnly} pendingText="Saving securely">Save connection</SubmitButton><button name="intent" value="test" className="button secondary" disabled={auth.readOnly}>Save & test connection</button></div>
      </form></section>
      <section className="panel"><div className="panel-head"><h2>Connection health</h2></div><div className="panel-body">
        <p><strong>{!c?.enabled ? "Paused / not configured":statuses[s?.status??"not_started"]??"Needs review"}</strong></p>
        <dl><dt>Last check (IST)</dt><dd>{when(s?.last_attempt_at)}</dd><dt>Last complete provider scan (IST)</dt><dd>{when(s?.last_success_at)}</dd><dt>Last login attempt (IST)</dt><dd>{when(c?.login_attempted_at)}</dd><dt>Latest scan</dt><dd>{s?.matched_count??0} matched · {s?.missing_count??0} linked profiles not found</dd></dl>
        {s?.status==="login_required" ? <p role="alert">Amazon requires sign-in or verification in the backend worker session. Your local Chrome login is a different session. Ask the connection administrator to complete the worker verification before retrying; do not paste OTPs or cookies into this form.</p>:null}
        <p>Missing profiles are not marked activated. Approved terms, provider mapping and payroll remain unchanged by this connection.</p>
        <div className="form-actions"><Link className="button secondary" href="/delivery-network/joining">Open Joining & Training</Link><Link className="button secondary" href="/delivery-network/amazon-onboarding-settings">Station supervisor defaults</Link></div>
      </div></section>
    </>}
  </AppShell>;
}
