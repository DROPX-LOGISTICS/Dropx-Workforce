import { ArrowRight, BadgeCheck, Banknote, Clock3, FileCheck2, LockKeyhole } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PendingLink } from "@/components/pending-link";
import { SubmitButton } from "@/components/submit-button";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { workforceEarningsDateRange } from "@/lib/workforce-earnings";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createPayrollRun } from "./actions";

export const dynamic = "force-dynamic";
type PayrollRun = { id: string; run_number: string; period_start: string; period_end: string; status: string; worker_count: number; shipment_count: number; net_amount: number; ready_count: number; hold_count: number; exception_count: number; source_updated_at: string | null; calculated_at: string | null; created_at: string };
function money(value: unknown) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value ?? 0)); }
function number(value: unknown) { return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(value ?? 0)); }

export default async function PayrollPage({ searchParams }: { searchParams?: { from?: string; to?: string; notice?: string; error?: string } }) {
  const authorization = await requirePagePermission("workforce_payroll", "access");
  const companyId = requireCompanyId(authorization);
  const canCreate = authorization.permissions.workforce_payroll.canAdd && !authorization.readOnly;
  const { from, to } = workforceEarningsDateRange(searchParams);
  const result = supabaseAdmin && authorization.hasAllLocationAccess
    ? await supabaseAdmin.from("workforce_payroll_runs").select("id, run_number, period_start, period_end, status, worker_count, shipment_count, net_amount, ready_count, hold_count, exception_count, source_updated_at, calculated_at, created_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(100)
    : { data: [], error: authorization.hasAllLocationAccess ? { message: "Supabase service role key is not configured." } : null };
  const runs = (result.data ?? []) as PayrollRun[];
  const openRuns = runs.filter((run) => ["draft", "review"].includes(run.status));
  const approvedValue = runs.filter((run) => ["approved", "paid"].includes(run.status)).reduce((sum, run) => sum + Number(run.net_amount), 0);

  return <AppShell active="Payroll Runs" pageCode="workforce_payroll">
    <section className="wf-finance-hero"><div><span>Controlled payroll close</span><h1>Calculate, review, approve and pay</h1><p>Payroll snapshots live shipment earnings, incentive rules and approved adjustments. Once approved, every payable line is frozen for audit.</p></div><div className="wf-finance-actions">{hasPermission(authorization, "workforce_earnings", "access") ? <PendingLink className="wf-command-secondary" href={`/delivery-network/earnings?from=${from}&to=${to}`}>Preview live earnings</PendingLink> : null}{hasPermission(authorization, "workforce_adjustments", "access") ? <PendingLink className="wf-command-secondary" href="/delivery-network/adjustments">Adjustment queue</PendingLink> : null}</div></section>
    {searchParams?.notice || searchParams?.error ? <section className={`panel message-panel ${searchParams.error ? "error" : "success"}`}><div className="panel-body"><strong>{searchParams.error ? "Action required" : "Completed"}</strong><p>{searchParams.error ?? searchParams.notice}</p></div></section> : null}
    {!authorization.hasAllLocationAccess ? <section className="panel message-panel"><div className="panel-body"><strong>Network payroll is centrally controlled</strong><p>Station-scoped users can review live earnings, but payroll creation and payout totals require all-location access.</p><PendingLink className="button secondary compact" href="/delivery-network/earnings">Open scoped earnings</PendingLink></div></section> : null}
    {result.error ? <section className="panel message-panel error"><div className="panel-body"><strong>Payroll storage is not ready</strong><p>{result.error.message}</p></div></section> : null}
    <section className="wf-finance-kpis mini"><article><span><Clock3 size={18} /></span><small>Open runs</small><strong>{openRuns.length}</strong><em>Draft or under review</em></article><article><span><BadgeCheck size={18} /></span><small>Approved / paid</small><strong>{runs.filter((run) => ["approved", "paid"].includes(run.status)).length}</strong><em>{money(approvedValue)} recorded</em></article><article><span><LockKeyhole size={18} /></span><small>Current blockers</small><strong>{openRuns.reduce((sum, run) => sum + Number(run.hold_count) + Number(run.exception_count), 0)}</strong><em>Holds and earning gaps</em></article></section>
    {authorization.hasAllLocationAccess && canCreate && !result.error ? <section className="wf-payroll-create"><div><span>New close</span><h2>Create payroll snapshot</h2><p>The draft can be recalculated until it is submitted for review.</p></div><form action={createPayrollRun}><label>Period start<input defaultValue={from} name="from" required type="date" /></label><label>Period end<input defaultValue={to} name="to" required type="date" /></label><SubmitButton pendingText="Calculating payroll"><FileCheck2 size={15} /> Create draft payroll</SubmitButton></form></section> : null}
    <section className="wf-finance-panel"><header><div><span>Payroll register</span><h2>All payroll runs</h2><p>Payable value excludes held or manually excluded associates.</p></div></header><div className="table-wrap"><table className="wf-finance-table"><thead><tr><th>Run</th><th>Period</th><th>Workers</th><th>Shipments</th><th>Ready</th><th>Holds</th><th>Exceptions</th><th>Payable</th><th>Status</th><th>Open</th></tr></thead><tbody>
      {runs.map((run) => <tr key={run.id}><td><strong>{run.run_number}</strong><small>Calculated {run.calculated_at ? new Date(run.calculated_at).toLocaleString("en-IN") : "pending"}</small></td><td>{run.period_start}<small>to {run.period_end}</small></td><td>{number(run.worker_count)}</td><td>{number(run.shipment_count)}</td><td>{run.ready_count}</td><td>{run.hold_count}</td><td>{run.exception_count}</td><td><strong>{money(run.net_amount)}</strong></td><td><span className={`wf-pay-state ${run.status}`}>{run.status}</span></td><td><PendingLink href={`/delivery-network/payroll/${run.id}`}>Review <ArrowRight size={13} /></PendingLink></td></tr>)}
      {!runs.length && !result.error ? <tr><td className="empty-cell" colSpan={10}><Banknote size={17} /> No payroll runs have been created.</td></tr> : null}
    </tbody></table></div></section>
  </AppShell>;
}
