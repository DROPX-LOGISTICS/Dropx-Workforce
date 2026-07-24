import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCodLocations, locationLabel } from "@/lib/ops-pulse/cod";
import { operatingModeLabel, resolveOperatingContext } from "@/lib/ops-pulse/operating-context";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function display(value: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
}

export default async function CpsPage() {
  const authorization = await requirePagePermission("cps_overview", "access");
  const companyId = requireCompanyId(authorization);
  const locationsResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const context = resolveOperatingContext(locationsResult.locations);
  const [shipmentResult, stationDailyResult] = context.location && supabaseAdmin
    ? await Promise.all([supabaseAdmin
      .from("cps_shipment_daily")
      .select("work_date,shipment_type,provider_employee_id,total_delivery,total_activity,mapping_status,da_total_pay,updated_at")
      .eq("company_id", companyId)
      .eq("station_code", context.location.station_code)
      .order("work_date", { ascending: false })
      .limit(5000),
    supabaseAdmin.from("cps_station_daily")
      .select("work_date,total_cost,overall_cps,target_cps,target_gap,target_impact,da_pay_cost,staff_cost,fuel_cost,vehicle_cost,rent_cost,other_cost")
      .eq("company_id", companyId)
      .eq("station_code", context.location.station_code)
      .order("work_date", { ascending: false })
      .limit(1)])
    : [{ data: [], error: null }, { data: [], error: null }];
  const rows = shipmentResult.data ?? [];
  const cost = stationDailyResult.data?.[0];
  const latestDate = rows.map((row) => row.work_date).filter(Boolean).sort().at(-1) ?? null;
  const latestRows = latestDate ? rows.filter((row) => row.work_date === latestDate) : [];
  const volume = latestRows.reduce((sum, row) => sum + number(row.total_delivery), 0);
  const activity = latestRows.reduce((sum, row) => sum + number(row.total_activity), 0);
  const associates = new Set(latestRows.map((row) => row.provider_employee_id).filter(Boolean)).size;
  const productivity = associates ? volume / associates : 0;
  const unmapped = latestRows.filter((row) => row.mapping_status !== "Mapped").length;
  const payout = latestRows.reduce((sum, row) => sum + number(row.da_total_pay), 0);
  const typeMap = new Map<string, { activity: number; volume: number }>();
  latestRows.forEach((row) => {
    const key = row.shipment_type || "Unspecified";
    const current = typeMap.get(key) ?? { activity: 0, volume: 0 };
    current.volume += number(row.total_delivery);
    current.activity += number(row.total_activity);
    typeMap.set(key, current);
  });

  return (
    <AppShell active="CPS" pageCode="cps_overview">
      <div className="ops-command-center">
        <PageHead
          eyebrow={`${operatingModeLabel(context.mode)} · ${context.location ? locationLabel(context.location) : "No location"}`}
          title="CPS Performance"
          subtitle="Shipment, associate and productivity review using the selected workspace and existing Supabase facts."
        />
        {locationsResult.error || shipmentResult.error || stationDailyResult.error ? <section className="panel message-panel error"><div className="panel-body">{locationsResult.error ?? shipmentResult.error?.message ?? stationDailyResult.error?.message}</div></section> : null}
        <section className="ops-kpi-grid">
          <article><div className="ops-kpi-icon">V</div><span>Latest volume</span><strong>{display(volume)}</strong><small>{latestDate ?? "No import"}</small></article>
          <article><div className="ops-kpi-icon">A</div><span>Associates</span><strong>{display(associates)}</strong><small>Provider IDs on latest date</small></article>
          <article><div className="ops-kpi-icon">P</div><span>Productivity</span><strong>{productivity.toFixed(1)}</strong><small>Shipments per associate</small></article>
          <article><div className="ops-kpi-icon">T</div><span>Total activity</span><strong>{display(activity)}</strong><small>Imported activity measure</small></article>
          <article><div className="ops-kpi-icon">R</div><span>Data rows</span><strong>{display(rows.length)}</strong><small>Current station history</small></article>
        </section>
        <section className="ops-kpi-grid">
          <article><div className="ops-kpi-icon">₹</div><span>DA payout</span><strong>₹{display(payout)}</strong><small>Latest shipment date</small></article>
          <article className={unmapped ? "attention" : "healthy"}><div className="ops-kpi-icon">!</div><span>Unmapped IDs</span><strong>{display(unmapped)}</strong><small>{unmapped ? "Requires ID mapping" : "Mapping complete"}</small></article>
          <article><div className="ops-kpi-icon">C</div><span>Overall CPS</span><strong>{number(cost?.overall_cps).toFixed(2)}</strong><small>Target {number(cost?.target_cps).toFixed(2)}</small></article>
          <article className={number(cost?.target_gap) > 0 ? "attention" : "healthy"}><div className="ops-kpi-icon">G</div><span>Target gap</span><strong>{number(cost?.target_gap).toFixed(2)}</strong><small>Impact ₹{display(number(cost?.target_impact))}</small></article>
          <article><div className="ops-kpi-icon">Σ</div><span>Total cost</span><strong>₹{display(number(cost?.total_cost))}</strong><small>{cost?.work_date ?? "Awaiting CPS calculation"}</small></article>
        </section>
        <section className="ops-visual-grid">
          <article className="ops-visual-card wide">
            <header><div><span>SHIPMENT MIX</span><h2>Performance by shipment type</h2></div></header>
            <div className="cps-type-mix">
              {[...typeMap.entries()].sort((a, b) => b[1].volume - a[1].volume).map(([type, values]) => (
                <div key={type}><strong>{type}</strong><span><i style={{ width: `${volume ? Math.max(3, values.volume / volume * 100) : 0}%` }} /></span><b>{display(values.volume)}</b></div>
              ))}
              {!typeMap.size ? <div className="ops-empty-visual">No imported shipment facts for this location.</div> : null}
            </div>
          </article>
          <article className="ops-visual-card">
            <header><div><span>DATA READINESS</span><h2>Review status</h2></div></header>
            <div className="ops-health-list">
              <div><i className={latestDate ? "good" : "warn"} /><span>Latest import</span><strong>{latestDate ?? "Pending"}</strong></div>
              <div><i className={associates ? "good" : "warn"} /><span>Associate mapping</span><strong>{associates ? `${associates} IDs` : "No IDs"}</strong></div>
              <div><i className="neutral" /><span>Rate calculation</span><strong>Use CPS Inputs</strong></div>
            </div>
          </article>
        </section>
      </div>
    </AppShell>
  );
}
