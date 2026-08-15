import { PrintButton } from "@/components/print-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { loadNetworkPlanning, routePlanShareText, startOfPlanningWeek } from "@/lib/ops-pulse/network-planning";
import { loadServiceNetworkRules } from "@/lib/ops-pulse/service-network";
import styles from "./share.module.css";

export const dynamic = "force-dynamic";

function validDate(value: unknown) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")); }
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }

export default async function NetworkPlanSharePage({ searchParams }: { searchParams?: { station?: string; date?: string } }) {
  const authorization = await requirePagePermission("service_network", "access");
  const companyId = requireCompanyId(authorization);
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const station = locationResult.locations.find(item => item.station_code === String(searchParams?.station ?? "").toUpperCase()) ?? null;
  const planDate = validDate(searchParams?.date) ? String(searchParams?.date) : today();
  if (!station) return <main className={styles.page}><div className={styles.empty}>The station is not active or is outside your OpsPulse scope.</div></main>;
  const rules = await loadServiceNetworkRules(companyId);
  const rule = rules.rows.find(item => item.stationCode === station.station_code && item.isActive);
  const planning = await loadNetworkPlanning({ companyId, stationId: station.id, weekStart: startOfPlanningWeek(planDate), selectedDate: planDate, rule });
  const routes = planning.routes.filter(route => route.planDate === planDate && route.status !== "cancelled");
  const shareText = routePlanShareText(station.station_code, planDate, planning.routes);
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  const exportQuery = new URLSearchParams({ station: station.station_code, date: planDate });

  return <main className={styles.page}>
    <div className={styles.actions}><a className="button compact" href={whatsapp} target="_blank" rel="noreferrer">Share to WhatsApp</a><a className="button secondary compact" href={`/api/ops-pulse/network-planning/export?${exportQuery}`}>Download CSV</a><PrintButton/></div>
    <header><div><span>OpsPulse</span><h1>Daily Network Plan</h1></div><div><strong>{station.station_code}</strong><small>{planDate.split("-").reverse().join("/")}</small></div></header>
    <section className={styles.summary}><span><small>Routes</small><strong>{routes.length}</strong></span><span><small>Expected volume</small><strong>{planning.summary.expectedVolume.toLocaleString("en-IN")}</strong></span><span><small>HC planned / actual</small><strong>{planning.summary.plannedHeadcount} / {planning.summary.actualHeadcount}</strong></span><span><small>Coverage gaps</small><strong>{planning.summary.coverageGaps}</strong></span></section>
    <section className={styles.routes}>{routes.map(route => <article key={route.id}>
      <div className={styles.routeHead}><span style={{ background: route.sectorColor }}/><div><strong>{route.routeCode} · {route.routeName}</strong><small>{route.sectorName} · {route.vehicleType} · {route.shiftCode}</small></div><b>{route.signal}</b></div>
      <div className={styles.facts}><span><small>Pincodes</small><strong>{route.pincodes.join(", ") || "Pending"}</strong></span><span><small>Volume</small><strong>{route.expectedVolume}</strong></span><span><small>Load / FE</small><strong>{route.loadPerFE?.toFixed(1) ?? "—"}</strong></span></div>
      <div className={styles.people}><small>Field Executives</small><strong>{route.roster.filter(item => !["released", "leave", "absent"].includes(item.rosterStatus)).map(item => `${item.fieldExecutiveName} (${item.vehicleType ?? "vehicle?"})`).join(", ") || "UNASSIGNED"}</strong></div>
    </article>)}{!routes.length ? <div className={styles.empty}>No routes are planned for this date.</div> : null}</section>
    <footer>Generated from the confirmed OpsPulse station plan. External map stations are not included unless active in OpsPulse.</footer>
  </main>;
}
