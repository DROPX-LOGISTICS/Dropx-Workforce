import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacityRules } from "@/lib/ops-pulse/capacity";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { removeCapacityRule, upsertCapacityRule } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = { saved?: string; deleted?: string; error?: string };

export default async function CapacityMasterPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cod_master", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.cod_master;
  const [ruleResult, locationResult] = await Promise.all([
    loadCapacityRules(companyId),
    loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess)
  ]);
  const rules = new Map(ruleResult.rows.map((row) => [row.stationCode, row]));

  return <AppShell active="Capacity Master" pageCode="cod_master"><div className="ops-command-center">
    <PageHead eyebrow="Ops Masters" title="Capacity Master" subtitle="Station-level SPR, workload risk and workforce buffer assumptions. Nothing is hardcoded in Capacity." />
    {searchParams?.saved ? <div className="message-panel success">Capacity rule saved.</div> : null}
    {searchParams?.deleted ? <div className="message-panel success">Capacity rule deleted. The station will remain visible as Not configured.</div> : null}
    {searchParams?.error || ruleResult.error || locationResult.error ? <div className="message-panel error">{searchParams?.error || ruleResult.error || locationResult.error}</div> : null}
    <section className="performance-summary-grid">
      <article><span>Stations</span><strong>{locationResult.locations.length}</strong><small>Permitted operational scope</small></article>
      <article><span>Configured</span><strong>{ruleResult.rows.length}</strong><small>Ready for planning</small></article>
      <article><span>Pending</span><strong>{Math.max(0, locationResult.locations.length - ruleResult.rows.length)}</strong><small>Require assumptions</small></article>
      <article><span>Model</span><strong>Station level</strong><small>Editable independently</small></article>
    </section>
    <section className="panel"><div className="panel-head"><div><h2>Planning rules</h2><p className="subtle">Target SPR drives required headcount. Maximum safe SPR flags overload. Buffer protects peak and attendance variation.</p></div></div>
      <div className="table-wrap"><table className="capacity-master-table"><thead><tr><th>Station</th><th>Target SPR</th><th>Maximum safe SPR</th><th>Headcount buffer</th><th>Recent baseline</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {locationResult.locations.map((location) => {
          const rule = rules.get(location.station_code);
          return <tr key={location.id}><td><strong>{location.station_code}</strong><small>{location.station_name || location.city || "—"}</small></td><td colSpan={6}><div className="capacity-master-row"><form action={upsertCapacityRule}><input type="hidden" name="station_code" value={location.station_code}/><input aria-label={`${location.station_code} target SPR`} name="target_spr" type="number" min="1" step=".1" defaultValue={rule?.targetSpr ?? ""} placeholder="e.g. 65" required/><input aria-label={`${location.station_code} maximum safe SPR`} name="max_safe_spr" type="number" min="1" step=".1" defaultValue={rule?.maxSafeSpr ?? ""} placeholder="e.g. 70" required/><input aria-label={`${location.station_code} buffer percent`} name="buffer_percent" type="number" min="0" step=".5" defaultValue={rule?.bufferPercent ?? ""} placeholder="e.g. 10" required/><input aria-label={`${location.station_code} recent days`} name="recent_days" type="number" min="1" max="31" defaultValue={rule?.recentDays ?? 5} required/><span className={`status-pill ${rule ? "good" : "warn"}`}>{rule ? "Configured" : "Not configured"}</span><SubmitButton disabled={!permission.canEdit}>{rule ? "Save" : "Configure"}</SubmitButton></form>{rule?.id ? <form action={removeCapacityRule}><input type="hidden" name="id" value={rule.id}/><SubmitButton className="button danger compact" confirmMessage={`Delete capacity assumptions for ${location.station_code}?`} confirmSubmitText="Delete rule" disabled={!permission.canEdit}>Delete</SubmitButton></form> : null}</div></td></tr>;
        })}
      </tbody></table></div>
    </section>
  </div></AppShell>;
}
