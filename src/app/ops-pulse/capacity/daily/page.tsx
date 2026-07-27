import { AppShell } from "@/components/app-shell";
import { CapacityDailyEditor } from "@/components/capacity-daily-editor";
import { CapacityScopeFilter } from "@/components/capacity-scope-filter";
import { CapacityWorkspaceTabs } from "@/components/capacity-workspace-tabs";
import { PageHead } from "@/components/page-head";
import { canEditHistoricalCapacity, hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacityGroundUpdates } from "@/lib/ops-pulse/capacity-ground";
import { loadCapacityStationDays } from "@/lib/ops-pulse/capacity-shipments";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { isAmazonEdspXptLocation } from "@/lib/ops-pulse/operating-context";

export const dynamic = "force-dynamic";
type SearchParams = { date?: string; stations?: string; saved?: string; error?: string };
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
function validDate(value: unknown) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")); }
function selectedCodes(value: string | undefined, allowed: string[]) {
  if (!value) return allowed;
  if (value === "_none") return [];
  const requested = value.split(",").map((code) => code.trim().toUpperCase());
  return allowed.filter((code) => requested.includes(code));
}

export default async function DailyCapacityPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cps_associates", "access");
  const companyId = requireCompanyId(authorization);
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const locations = locationResult.locations.filter(isAmazonEdspXptLocation);
  const allCodes = locations.map((location) => location.station_code);
  const codes = selectedCodes(searchParams?.stations, allCodes);
  const workDate = validDate(searchParams?.date) ? String(searchParams?.date) : today();
  const canEdit = hasPermission(authorization, "cps_associates", "edit")
    && workDate <= today()
    && (workDate === today() || canEditHistoricalCapacity(authorization));
  const [sourceResult, groundResult] = await Promise.all([
    loadCapacityStationDays(companyId, codes, workDate, workDate),
    loadCapacityGroundUpdates(companyId, workDate, workDate)
  ]);
  const sourceMap = new Map((sourceResult.data ?? []).map((row) => [row.station_code, row]));
  const groundMap = new Map(groundResult.rows.map((row) => [row.stationCode, row]));
  const savedValueOrBlank = (groundExists: boolean, value: number | null | undefined) =>
    groundExists && value != null ? Number(value) : null;
  const rows = locations.filter((location) => codes.includes(location.station_code)).map((location) => {
    const source = sourceMap.get(location.station_code);
    const ground = groundMap.get(location.station_code);
    return {
      stationCode: location.station_code,
      stationName: location.station_name || location.city || location.station_code,
      region: location.region || "",
      cluster: location.cluster || "",
      inbound: Number(source?.inbound ?? 0),
      saved: Boolean(ground),
      assignedPackages: savedValueOrBlank(Boolean(ground), ground?.assignedPackages),
      regularBike: savedValueOrBlank(Boolean(ground), ground?.regularBike),
      regularVan: savedValueOrBlank(Boolean(ground), ground?.regularVan),
      regularVanVehicle: savedValueOrBlank(Boolean(ground), ground?.regularVanVehicle),
      adHocBike: savedValueOrBlank(Boolean(ground), ground?.adHocBike),
      adHocVanVehicle: savedValueOrBlank(Boolean(ground), ground?.adHocVanVehicle),
      adHocVan: savedValueOrBlank(Boolean(ground), ground?.adHocVan),
      updatedAt: ground?.updatedAt ?? null
    };
  });
  const scopeStations = locations.map((location) => ({ code: location.station_code, name: location.station_name || location.city || location.station_code, cluster: location.cluster || "", region: location.region || "" }));
  const returnQuery = searchParams?.stations ? `stations=${encodeURIComponent(searchParams.stations)}` : "";

  return <AppShell active="Capacity" pageCode="cps_associates"><div className="ops-command-center capacity-workspace">
    <PageHead eyebrow="Daily Capacity" title="Ground Update" subtitle="Record today’s on-ground staffing in the first half; review it with final workload tomorrow." />
    <div className="capacity-tabs-toolbar"><CapacityWorkspaceTabs active="daily" /><div className="capacity-daily-toolbar">
      <CapacityScopeFilter selectedCodes={codes} stations={scopeStations}/>
      <form method="get"><input name="stations" type="hidden" value={searchParams?.stations ?? ""}/><label>Date<input defaultValue={workDate} name="date" type="date"/></label><button className="button compact">View</button></form>
    </div></div>
    {searchParams?.saved ? <div className="message-panel success">{searchParams.saved} station update{searchParams.saved === "1" ? "" : "s"} saved.</div> : null}
    {searchParams?.error || locationResult.error || sourceResult.error || groundResult.error ? <div className="message-panel error">{searchParams?.error || locationResult.error || sourceResult.error?.message || groundResult.error}</div> : null}
    <section className="panel capacity-daily-entry-panel"><div className="panel-head"><div><h2>{workDate.split("-").reverse().join("/")} ground capacity</h2><p className="subtle">Inbound is system-filled. Enter assigned packages and that date&apos;s actual staffing.</p></div></div>
      {!canEdit ? <div className="capacity-edit-lock"><strong>Read only</strong><span>Your role does not have Historical Ground Update permission for this date.</span></div> : null}
      <div className="capacity-counting-note"><strong>Counting rule</strong><span>DA columns count people. External Bike/Van DA means a temporary associate hired from outside. Van Count columns count vehicles only.</span></div>
      <CapacityDailyEditor canEdit={canEdit} returnQuery={returnQuery} rows={rows} workDate={workDate}/>
    </section>
  </div></AppShell>;
}
