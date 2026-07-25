import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadPerformanceTargets, performanceTargetSeeds } from "@/lib/ops-pulse/performance-targets";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { addPerformanceMetric, removePerformanceMetric, updatePerformanceTarget } from "./actions";

export const dynamic = "force-dynamic";
type SearchParams = { view?: string; saved?: string; added?: string; deleted?: string; error?: string };

export default async function PerformanceTargetMaster({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cod_master", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.cod_master;
  const view = searchParams?.view === "daily" ? "daily" : "sls";
  const result = await loadPerformanceTargets(companyId);
  const rows = result.rows.filter((row) => row.reportType === view).sort((a, b) => a.displayOrder - b.displayOrder);
  const sourceType = view === "daily" ? "daily_edsp_metrics" : "edsp_sls_scorecard";
  const sourceResult = supabaseAdmin
    ? await supabaseAdmin.from("report_metric_facts").select("values_json").eq("company_id", companyId).eq("source_type", sourceType).order("created_at", { ascending: false }).limit(50)
    : { data: [], error: null };
  const availableIndexes = new Set<number>();
  (sourceResult.data ?? []).forEach((fact) => {
    const value = fact.values_json;
    const values = Array.isArray(value)
      ? value
      : value && typeof value === "object" && Array.isArray((value as { values?: unknown[] }).values)
        ? (value as { values: unknown[] }).values
        : [];
    values.forEach((_, index) => { if (index > 0) availableIndexes.add(index); });
  });
  const usedIndexes = new Set(rows.map((row) => row.sourceIndex).filter((index): index is number => index != null));
  const addOptions = [...availableIndexes].filter((index) => !usedIndexes.has(index)).sort((a, b) => a - b).map((index) => {
    const catalog = performanceTargetSeeds.find((row) => row.reportType === view && row.sourceIndex === index);
    return { index, label: catalog?.label ?? `Source field ${index}` };
  });
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  return <AppShell active="Performance Master" pageCode="cod_master"><div className="ops-command-center">
    <PageHead eyebrow="Ops Masters" title="Performance Master" subtitle="Choose which imported metrics are shown, then manage their targets and scoring." />
    <nav className="performance-tabs"><Link className={view === "sls" ? "active" : ""} href="/master/performance-targets?view=sls">Weekly SLS</Link><Link className={view === "daily" ? "active" : ""} href="/master/performance-targets?view=daily">Daily EDSP</Link></nav>
    {searchParams?.saved ? <section className="message-panel success">Metric updated.</section> : null}
    {searchParams?.added ? <section className="message-panel success">Metric added to Performance.</section> : null}
    {searchParams?.deleted ? <section className="message-panel success">Metric removed. Imported source data was preserved.</section> : null}
    {searchParams?.error || result.error ? <section className="message-panel error">{searchParams?.error || result.error}</section> : null}
    <section className="performance-summary-grid"><article><span>Metrics</span><strong>{rows.length}</strong><small>{view === "sls" ? "Weekly SLS" : "Daily EDSP"}</small></article><article><span>Total weight</span><strong>{totalWeight}%</strong><small>{view === "sls" ? "Must total 100%" : "Informational targets"}</small></article><article><span>Mapped fields</span><strong>{rows.filter((row) => row.sourceIndex != null).length}</strong><small>Available in report</small></article><article><span>Unmapped</span><strong>{rows.filter((row) => row.sourceIndex == null).length}</strong><small>Awaiting source field</small></article></section>
    <section className="panel"><div className="panel-head"><div><h2>{view === "sls" ? "Weekly SLS metrics" : "Daily EDSP metrics"}</h2><p className="subtle">Add only fields detected in uploaded data. Removing a metric hides it from Performance but never deletes imported facts.</p></div>{addOptions.length ? <form action={addPerformanceMetric} className="performance-add-metric"><input type="hidden" name="report_type" value={view}/><input type="hidden" name="display_order" value={rows.length + 1}/><select name="source_index" required defaultValue=""><option value="" disabled>+ Add available metric</option>{addOptions.map((option) => <option key={option.index} value={option.index}>{option.label} · field {option.index}</option>)}</select><SubmitButton disabled={!permission.canAdd}>Add</SubmitButton></form> : <span className="status-pill good">All detected fields added</span>}</div><div className="table-wrap"><table className="performance-target-master"><thead><tr><th>Metric</th><th>Target</th><th>Direction</th><th>Weight</th><th>Unit</th><th>Source index</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td colSpan={8}><div className="performance-target-row-wrap"><form action={updatePerformanceTarget} className="performance-target-row"><input type="hidden" name="id" value={row.id}/><input type="hidden" name="metric_key" value={row.metricKey}/><input type="hidden" name="report_type" value={row.reportType}/><input type="hidden" name="display_order" value={row.displayOrder}/><label><input name="label" defaultValue={row.label}/><input name="short" defaultValue={row.short}/></label><input name="target" type="number" step="any" defaultValue={row.target ?? ""}/><select name="direction" defaultValue={row.direction}><option value="higher">Higher is better</option><option value="lower">Lower is better</option></select><input name="weight" type="number" step="0.5" defaultValue={row.weight}/><select name="unit" defaultValue={row.unit}><option value="percent">Percent</option><option value="dpmo">DPMO</option><option value="ratio">Ratio to goal</option></select><input name="source_index" type="number" min="1" defaultValue={row.sourceIndex ?? ""}/><select name="is_active" defaultValue={String(row.isActive)}><option value="true">Active</option><option value="false">Inactive</option></select><SubmitButton disabled={!permission.canEdit}>Save</SubmitButton></form><form action={removePerformanceMetric}><input type="hidden" name="id" value={row.id}/><input type="hidden" name="report_type" value={row.reportType}/><SubmitButton className="button danger compact" confirmMessage={`Remove ${row.label} from Performance? Imported source data will remain available.`} confirmSubmitText="Delete metric" disabled={!permission.canEdit}>Delete</SubmitButton></form></div></td></tr>)}</tbody></table></div></section>
  </div></AppShell>;
}
