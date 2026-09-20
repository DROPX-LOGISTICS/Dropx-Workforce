import { ShieldAlert, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { requireCompanyId } from "@/lib/company-scope";
import { requirePagePermission } from "@/lib/authorization";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { updateWorkforceSpeakUpReport } from "./actions";

export const dynamic = "force-dynamic";

type Report = { id: string; category: string; subject: string; detail: string; status: string; responder_note: string | null; created_at: string; updated_at: string };
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function date(value: string) { return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }

export default async function WorkforceSpeakUpPage({ searchParams }: { searchParams?: { notice?: string; error?: string; status?: string } }) {
  const authorization = await requirePagePermission("workforce_speak_up", "access");
  const companyId = requireCompanyId(authorization);
  const requestedStatus = String(searchParams?.status ?? "open");
  const status = ["open", "in_review", "resolved", "closed", "all"].includes(requestedStatus) ? requestedStatus : "open";
  let reports: Report[] = [];
  let error: string | null = null;
  if (!supabaseAdmin) error = "Supabase service role key is not configured.";
  else {
    const result = await supabaseAdmin.from("workforce_connect_requests")
      .select("id,category,subject,detail,status,responder_note,created_at,updated_at")
      .eq("company_id", companyId)
      .eq("category", "speak_up")
      .order("updated_at", { ascending: false })
      .limit(250);
    if (result.error) error = result.error.message;
    else reports = (result.data ?? []) as Report[];
  }
  const visible = status === "all" ? reports : reports.filter((report) => report.status === status);
  const counts = new Map(["open", "in_review", "resolved", "closed"].map((value) => [value, reports.filter((report) => report.status === value).length]));

  return <AppShell active="Confidential Speak Up" pageCode="workforce_speak_up">
    <PageHead eyebrow="Restricted review" title="Confidential Speak Up" subtitle="A protected review desk for Workforce safety, conduct and wrongdoing reports. Reporter identity and operational profile are not shown in this queue." />
    <section className="wf-speakup-notice"><ShieldAlert size={19} /><div><strong>Restricted access</strong><span>Only users granted Workforce Speak Up access can open or update these reports. They are excluded from the regular support desk.</span></div></section>
    {searchParams?.notice || searchParams?.error || error ? <section className={`panel message-panel ${searchParams?.error || error ? "error" : "success"}`}><div className="panel-body">{searchParams?.error || error || searchParams?.notice}</div></section> : null}
    <nav className="wf-finance-tabs" aria-label="Speak Up status">{["open", "in_review", "resolved", "closed", "all"].map((value) => <a className={status === value ? "active" : ""} href={`/delivery-network/speak-up?status=${value}`} key={value}>{label(value)} <strong>{value === "all" ? reports.length : counts.get(value) ?? 0}</strong></a>)}</nav>
    <section className="wf-connect-desk wf-speakup-desk">{visible.map((report) => <article key={report.id}><header><span><ShieldCheck size={17} /></span><div><small>Confidential report · {date(report.created_at)}</small><h2>{report.subject}</h2><p>Workforce Speak Up · identity protected</p></div><em className={`wf-pay-state ${report.status}`}>{label(report.status)}</em></header><p className="wf-connect-detail">{report.detail}</p><form action={updateWorkforceSpeakUpReport}><input name="id" type="hidden" value={report.id} /><label>Review status<select defaultValue={report.status} name="status"><option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label><label>Confidential review note<textarea defaultValue={report.responder_note ?? ""} name="responder_note" placeholder="Record the next safe action, owner or outcome" rows={3} /></label><SubmitButton pendingText="Updating"><ShieldCheck size={14} /> Update confidential report</SubmitButton></form></article>)}{!visible.length ? <div className="empty-state">No {status === "all" ? "Speak Up" : label(status).toLowerCase()} reports are waiting for review.</div> : null}</section>
  </AppShell>;
}
