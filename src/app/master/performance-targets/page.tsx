import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadPerformanceTargets } from "@/lib/ops-pulse/performance-targets";
import { updatePerformanceTarget } from "./actions";

export const dynamic = "force-dynamic";
type SearchParams = { view?: string; saved?: string; error?: string };

export default async function PerformanceTargetMaster({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cod_master", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.cod_master;
  const view = searchParams?.view === "daily" ? "daily" : "sls";
  const result = await loadPerformanceTargets(companyId);
  const rows = result.rows.filter((row) => row.reportType === view).sort((a, b) => a.displayOrder - b.displayOrder);
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  return <AppShell active="Performance Target Master" pageCode="cod_master"><div className="ops-command-center">
    <PageHead eyebrow="Ops Masters" title="Performance Target Master" subtitle="Targets, direction, weight and report-field mapping used by Performance." />
    <nav className="performance-tabs"><Link className={view === "sls" ? "active" : ""} href="/master/performance-targets?view=sls">Weekly SLS</Link><Link className={view === "daily" ? "active" : ""} href="/master/performance-targets?view=daily">Daily EDSP</Link></nav>
    {searchParams?.saved ? <section className="message-panel success">Target updated.</section> : null}
    {searchParams?.error || result.error ? <section className="message-panel error">{searchParams?.error || result.error}</section> : null}
    <section className="performance-summary-grid"><article><span>Metrics</span><strong>{rows.length}</strong><small>{view === "sls" ? "Weekly SLS" : "Daily EDSP"}</small></article><article><span>Total weight</span><strong>{totalWeight}%</strong><small>{view === "sls" ? "Must total 100%" : "Informational targets"}</small></article><article><span>Mapped fields</span><strong>{rows.filter((row) => row.sourceIndex != null).length}</strong><small>Available in report</small></article><article><span>Unmapped</span><strong>{rows.filter((row) => row.sourceIndex == null).length}</strong><small>Awaiting source field</small></article></section>
    <section className="panel"><div className="panel-head"><div><h2>{view === "sls" ? "Weekly SLS targets" : "Daily EDSP targets"}</h2><p className="subtle">Changes apply to the dashboard after Save. Source index controls which extracted PDF field supplies the value.</p></div></div><div className="table-wrap"><table className="performance-target-master"><thead><tr><th>Metric</th><th>Target</th><th>Direction</th><th>Weight</th><th>Unit</th><th>Source index</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td colSpan={8}><form action={updatePerformanceTarget} className="performance-target-row"><input type="hidden" name="id" value={row.id}/><input type="hidden" name="metric_key" value={row.metricKey}/><input type="hidden" name="report_type" value={row.reportType}/><input type="hidden" name="display_order" value={row.displayOrder}/><label><input name="label" defaultValue={row.label}/><input name="short" defaultValue={row.short}/></label><input name="target" type="number" step="any" defaultValue={row.target ?? ""}/><select name="direction" defaultValue={row.direction}><option value="higher">Higher is better</option><option value="lower">Lower is better</option></select><input name="weight" type="number" step="0.5" defaultValue={row.weight}/><select name="unit" defaultValue={row.unit}><option value="percent">Percent</option><option value="dpmo">DPMO</option><option value="ratio">Ratio to goal</option></select><input name="source_index" type="number" min="1" defaultValue={row.sourceIndex ?? ""}/><select name="is_active" defaultValue={String(row.isActive)}><option value="true">Active</option><option value="false">Inactive</option></select><SubmitButton disabled={!permission.canEdit}>Save</SubmitButton></form></td></tr>)}</tbody></table></div></section>
  </div></AppShell>;
}
