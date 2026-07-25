import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { resolveOperatingContext } from "@/lib/ops-pulse/operating-context";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { updateOnboardingStatus } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = { status?: string; station?: string; saved?: string; error?: string };
type Executive = { id: string; full_name: string; dropx_id: string | null; mobile: string; location_id: string; onboarding_status: string; date_of_join: string; created_at: string; updated_at: string };
function day(value: string) { return value.slice(0, 10); }
function daysSince(value: string) { return Math.max(0, Math.floor((Date.now() - new Date(`${day(value)}T00:00:00+05:30`).getTime()) / 86400000)); }
function indiaDay(offset = 0) { const date = new Date(Date.now() + offset * 86400000); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date); }

export default async function OnboardingPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cod_reports", "access");
  const companyId = requireCompanyId(authorization);
  const { locations } = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const permitted = resolveOperatingContext(locations).selectedLocations;
  const ids = permitted.map((location) => location.id);
  const selectedStation = permitted.some((location) => location.station_code === searchParams?.station) ? searchParams?.station ?? "" : "";
  const filteredIds = selectedStation ? permitted.filter((location) => location.station_code === selectedStation).map((location) => location.id) : ids;
  const status = searchParams?.status === "active" ? "active" : searchParams?.status === "all" ? "all" : "pending";
  let query = supabaseAdmin?.from("field_executives").select("id,full_name,dropx_id,mobile,location_id,onboarding_status,date_of_join,created_at,updated_at").in("location_id", filteredIds).order("created_at", { ascending: true });
  if (query && status !== "all") query = query.eq("onboarding_status", status);
  const result = query ? await query.limit(5000) : { data: [] as Executive[], error: null };
  const rows = (result.data ?? []) as Executive[];
  const locationMap = new Map(permitted.map((location) => [location.id, location]));
  const yesterday = indiaDay(-1);
  const pending = rows.filter((row) => row.onboarding_status !== "active").length;
  const updatedYesterday = rows.filter((row) => day(row.updated_at) === yesterday).length;

  return <AppShell active="Performance" pageCode="cod_reports">
    <div className="ops-command-center onboarding-workspace">
      <PageHead eyebrow="Performance" title="DA In-App Onboarding" subtitle="Pending age, current status and day-level validation." />
      <form className="onboarding-filter">
        <label>Station<select name="station" defaultValue={selectedStation}><option value="">All permitted stations</option>{permitted.map((location) => <option key={location.id} value={location.station_code}>{location.station_code} · {location.station_name || location.city}</option>)}</select></label>
        <label>Status<select name="status" defaultValue={status}><option value="pending">Pending</option><option value="active">Completed</option><option value="all">All</option></select></label>
        <button>Apply</button>
      </form>
      {searchParams?.saved ? <div className="message-panel success">Status updated and revalidated.</div> : null}
      {searchParams?.error || result.error ? <div className="message-panel error">{searchParams?.error || result.error?.message}</div> : null}
      <section className="performance-summary-grid">
        <article><span>Pending</span><strong>{pending}</strong><small>Needs action</small></article>
        <article><span>Updated yesterday</span><strong>{updatedYesterday}</strong><small>{yesterday}</small></article>
        <article><span>Oldest pending</span><strong>{pending ? Math.max(...rows.filter((row) => row.onboarding_status !== "active").map((row) => daysSince(row.created_at))) : 0} days</strong><small>Current pending age</small></article>
        <article><span>Records</span><strong>{rows.length}</strong><small>Current view</small></article>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Onboarding action register</h2><p className="subtle">Yesterday is verified against the current status and the record’s actual update time.</p></div></div>
        <div className="table-wrap"><table className="onboarding-table"><thead><tr><th>DA</th><th>Station</th><th>Pending since</th><th>Age</th><th>Current status</th><th>Yesterday validation</th><th>Update</th></tr></thead><tbody>
          {rows.map((row) => {
            const station = locationMap.get(row.location_id);
            const updatedOnYesterday = day(row.updated_at) === yesterday;
            const verified = updatedOnYesterday && row.onboarding_status === "active";
            return <tr key={row.id}><td><strong>{row.full_name}</strong><small>{row.dropx_id || row.mobile}</small></td><td><strong>{station?.station_code}</strong><small>{station?.station_name || station?.city}</small></td><td>{day(row.created_at)}</td><td><span className={daysSince(row.created_at) > 2 ? "status-badge danger" : "status-badge warning"}>{daysSince(row.created_at)} days</span></td><td><span className={`status-badge ${row.onboarding_status === "active" ? "success" : "warning"}`}>{row.onboarding_status === "active" ? "Completed" : "Pending"}</span></td><td><span className={`status-badge ${verified ? "success" : updatedOnYesterday ? "danger" : ""}`}>{verified ? "Verified completed" : updatedOnYesterday ? "Updated, still pending" : "No update yesterday"}</span></td><td><form action={updateOnboardingStatus} className="inline-status-form"><input type="hidden" name="id" value={row.id}/><input type="hidden" name="location_id" value={row.location_id}/><select name="status" defaultValue={row.onboarding_status === "active" ? "active" : "pending"}><option value="pending">Pending</option><option value="active">Completed</option></select><button>Save</button></form></td></tr>;
          })}
          {!rows.length ? <tr><td colSpan={7} className="empty-cell">No onboarding records in this view.</td></tr> : null}
        </tbody></table></div>
      </section>
    </div>
  </AppShell>;
}
