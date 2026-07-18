import { AppShell } from "@/components/app-shell";
import { FleetDashboard } from "@/components/fleet-dashboard";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

const fleetTabs = [
  { label: "Action Center", code: "fleet_action_center", slug: "action-center" },
  { label: "Vehicles", code: "fleet_vehicle_view", slug: "vehicle-view" },
  { label: "Documents", code: "fleet_date_view", slug: "date-view" },
  { label: "Station View", code: "fleet_station_view", slug: "station-view" },
  { label: "Tracking", code: "fleet_tracking", slug: "tracking" },
  { label: "Fuel Log", code: "fleet_fuel_log", slug: "fuel-log" },
  { label: "Live GPS", code: "fleet_live_gps", slug: "live-gps" },
  { label: "Maintenance", code: "fleet_maintenance", slug: "maintenance" },
  { label: "Report", code: "fleet_reports", slug: "report" }
];

type FleetManager = {
  email: string | null;
  name: string;
};

async function loadFleetManager(companyId: string): Promise<FleetManager | null> {
  if (!supabaseAdmin) return null;
  const settingsResult = await supabaseAdmin
    .from("business_document_settings")
    .select("fleet_manager_user_id")
    .eq("company_id", companyId)
    .eq("id", true)
    .maybeSingle();
  if (settingsResult.error || !settingsResult.data?.fleet_manager_user_id) return null;

  const userResult = await supabaseAdmin
    .from("profiles")
    .select("full_name, email")
    .eq("company_id", companyId)
    .eq("id", settingsResult.data.fleet_manager_user_id)
    .maybeSingle();
  if (userResult.error || !userResult.data) return null;
  return {
    email: userResult.data.email ?? null,
    name: userResult.data.full_name || userResult.data.email || "Fleet manager"
  };
}

export default async function FleetPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const authorization = await getAuthorization();
  const fleetManager = authorization ? await loadFleetManager(requireCompanyId(authorization)) : null;
  const legacyFleetPermission = authorization
    ? {
      canView: hasPermission(authorization, "fleet", "access"),
      canAdd: hasPermission(authorization, "fleet", "add"),
      canEdit: hasPermission(authorization, "fleet", "edit")
    }
    : { canView: false, canAdd: false, canEdit: false };
  const tabPermissions = Object.fromEntries(fleetTabs.map((tab) => {
    const permission = {
      canView: authorization ? hasPermission(authorization, tab.code, "access") : false,
      canAdd: authorization ? hasPermission(authorization, tab.code, "add") : false,
      canEdit: authorization ? hasPermission(authorization, tab.code, "edit") : false
    };
    return [
      tab.label,
      permission.canView || permission.canAdd || permission.canEdit ? permission : legacyFleetPermission
    ];
  }));
  const visibleTabs = authorization
    ? fleetTabs.filter((tab) => tabPermissions[tab.label]?.canView || tabPermissions[tab.label]?.canAdd || tabPermissions[tab.label]?.canEdit)
    : [];
  const selectedTab = visibleTabs.find((tab) => tab.slug === searchParams?.tab) ?? visibleTabs[0];

  return (
    <AppShell active="Fleet" pageCode={selectedTab?.code ?? "fleet"}>
      <FleetDashboard
        canAddVehicle={Boolean(tabPermissions.Vehicles?.canAdd)}
        canEditFleet={authorization ? Object.values(tabPermissions).some((permission) => permission.canEdit) : false}
        fleetManager={fleetManager}
        initialMode={selectedTab?.label}
        tabPermissions={tabPermissions}
      />
    </AppShell>
  );
}
