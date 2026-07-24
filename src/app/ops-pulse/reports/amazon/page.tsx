import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCodLocations, locationLabel } from "@/lib/ops-pulse/cod";
import { resolveOperatingContext } from "@/lib/ops-pulse/operating-context";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { uploadAmazonScorecard } from "./actions";

export const dynamic = "force-dynamic";

export default async function AmazonReportsPage() {
  const authorization = await requirePagePermission("cod_reports", "access");
  const companyId = requireCompanyId(authorization);
  const locationsResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const context = resolveOperatingContext(locationsResult.locations);
  const { data, error } = context.location && supabaseAdmin
    ? await supabaseAdmin.from("ops_amazon_scorecards")
      .select("id,report_type,period_from,period_to,overall_score,remarks,attachment,created_at")
      .eq("company_id", companyId).eq("location_id", context.location.id)
      .order("period_to", { ascending: false }).limit(30)
    : { data: [], error: null };

  return (
    <AppShell active="Performance Reports" pageCode="cod_reports">
      <div className="ops-command-center">
        <PageHead eyebrow={context.location ? locationLabel(context.location) : "Amazon"} title="Amazon Performance Review" subtitle="Daily operational reports and weekly SLA scorecards, retained by station and review period." />
        {error ? <section className="panel message-panel error"><div className="panel-body">{error.message}</div></section> : null}
        <section className="ops-visual-grid">
          <article className="ops-visual-card">
            <header><div><span>NEW REPORT</span><h2>Upload for review</h2></div></header>
            <form action={uploadAmazonScorecard} className="form-grid" style={{ marginTop: 18 }}>
              <input type="hidden" name="location_id" value={context.location?.id ?? ""} />
              <label>Report type<select className="field" name="report_type"><option value="daily_report">Amazon day-level report</option><option value="weekly_sla">Weekly SLA scorecard</option></select></label>
              <label>From<input className="field" type="date" name="period_from" required /></label>
              <label>To<input className="field" type="date" name="period_to" required /></label>
              <label>Overall score<input className="field" type="number" name="overall_score" step="0.01" placeholder="Optional" /></label>
              <label>PDF / report file<input className="field" type="file" name="report_file" accept=".pdf,.xlsx,.xls,.csv,application/pdf" required /></label>
              <label>Review note<textarea className="field" name="remarks" rows={2} /></label>
              <div className="form-actions"><SubmitButton disabled={!context.location}>Upload report</SubmitButton></div>
            </form>
          </article>
          <article className="ops-visual-card wide">
            <header><div><span>REVIEW HISTORY</span><h2>Scorecard timeline</h2></div><strong>{data?.length ?? 0} reports</strong></header>
            <div className="scorecard-timeline">
              {(data ?? []).map((row) => (
                <div key={row.id}>
                  <i className={row.report_type === "weekly_sla" ? "sla" : ""}>{row.report_type === "weekly_sla" ? "W" : "D"}</i>
                  <div><strong>{row.report_type === "weekly_sla" ? "Weekly SLA scorecard" : "Day-level report"}</strong><span>{row.period_from} to {row.period_to}</span><small>{row.remarks || "No review note"}</small></div>
                  <div className="scorecard-actions"><b>{row.overall_score == null ? "—" : Number(row.overall_score).toFixed(2)}</b><a href={`/api/ops-pulse/reports/amazon/${row.id}/download`}>Download</a></div>
                </div>
              ))}
              {!data?.length ? <div className="ops-empty-visual">Upload the first Amazon report for this station.</div> : null}
            </div>
          </article>
        </section>
      </div>
    </AppShell>
  );
}
