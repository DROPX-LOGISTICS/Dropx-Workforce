import { CircleHelp, MessageSquareText } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { updateWorkforceConnectRequest } from "./actions";

export const dynamic = "force-dynamic";

type RequestRow = { id: string; workforce_id: string; category: string; subject: string; detail: string; status: string; responder_note: string | null; created_at: string; updated_at: string };
type WorkforceRow = { id: string; full_name: string; dropx_id: string | null; location_id: string; stations?: { station_code?: string | null } | null };
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function date(value: string) { return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }

export default async function WorkforceConnectDesk({ searchParams }: { searchParams?: { notice?: string; error?: string; status?: string } }) {
  const authorization = await requirePagePermission("workforce_communications", "access");
  const companyId = requireCompanyId(authorization);
  const requestedStatus = String(searchParams?.status ?? "open");
  const status = ["open", "in_review", "resolved", "closed", "all"].includes(requestedStatus) ? requestedStatus : "open";
  let requests: RequestRow[] = [];
  let workers: WorkforceRow[] = [];
  let error: string | null = null;
  if (!supabaseAdmin) error = "Supabase service role key is not configured.";
  else {
    const result = await supabaseAdmin.from("workforce_connect_requests")
      .select("id,workforce_id,category,subject,detail,status,responder_note,created_at,updated_at")
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false })
      .limit(250);
    if (result.error) error = result.error.message;
    else {
      requests = (result.data ?? []) as RequestRow[];
      const ids = Array.from(new Set(requests.map((request) => request.workforce_id)));
      const workforceResult = ids.length ? await supabaseAdmin.from("workforce").select("id,full_name,dropx_id,location_id,stations(station_code)").eq("company_id", companyId).in("id", ids) : { data: [], error: null };
      if (workforceResult.error) error = workforceResult.error.message;
      else workers = (workforceResult.data ?? []) as WorkforceRow[];
    }
  }
  const workerById = new Map(workers.map((worker) => [worker.id, worker]));
  if (!authorization.hasAllLocationAccess) requests = requests.filter((request) => authorization.locationScopeIds.includes(workerById.get(request.workforce_id)?.location_id ?? ""));
  const visible = status === "all" ? requests : requests.filter((request) => request.status === status);
  const counts = new Map(["open", "in_review", "resolved", "closed"].map((value) => [value, requests.filter((request) => request.status === value).length]));

  return <AppShell active="Connect Requests" pageCode="workforce_communications">
    <PageHead eyebrow="Workforce support" title="Connect requests" subtitle="Respond to associate payment, provider ID, route, document and roster questions from one accountable queue." />
    {searchParams?.notice || searchParams?.error || error ? <section className={`panel message-panel ${searchParams?.error || error ? "error" : "success"}`}><div className="panel-body">{searchParams?.error || error || searchParams?.notice}</div></section> : null}
    <nav className="wf-finance-tabs" aria-label="Connect request status">{["open", "in_review", "resolved", "closed", "all"].map((value) => <a className={status === value ? "active" : ""} href={`${pathFor(value)}`} key={value}>{label(value)} <strong>{value === "all" ? requests.length : counts.get(value) ?? 0}</strong></a>)}</nav>
    <section className="wf-connect-desk">{visible.map((request) => { const worker = workerById.get(request.workforce_id); return <article key={request.id}><header><span><CircleHelp size={17} /></span><div><small>{label(request.category)} · {date(request.created_at)}</small><h2>{request.subject}</h2><p>{worker?.full_name ?? "Workforce associate"} · {worker?.dropx_id ?? "DropX ID pending"} · {worker?.stations?.station_code ?? "No station"}</p></div><em className={`wf-pay-state ${request.status}`}>{label(request.status)}</em></header><p className="wf-connect-detail">{request.detail}</p><form action={updateWorkforceConnectRequest}><input name="id" type="hidden" value={request.id} /><label>Status<select defaultValue={request.status} name="status"><option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label><label>Response to associate<textarea defaultValue={request.responder_note ?? ""} name="responder_note" placeholder="State the action, owner, timeline, or resolution" rows={3} /></label><SubmitButton pendingText="Updating"><MessageSquareText size={14} /> Update request</SubmitButton></form></article>; })}{!visible.length ? <div className="empty-state">No {status === "all" ? "Connect" : label(status).toLowerCase()} requests are waiting in your scope.</div> : null}</section>
  </AppShell>;
}

function pathFor(status: string) { return `/delivery-network/connect?status=${status}`; }
