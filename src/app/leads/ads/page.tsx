import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { LeadsWorkspace } from "@/components/leads-workspace";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadLeadWorkspaceData } from "@/lib/leads-data";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function loadFlash() {
  const store = cookies();
  const raw = store.get("dropx_leads_flash")?.value;
  if (!raw) return { error: null as string | null, notice: null as string | null };
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; notice?: unknown };
    return {
      error: typeof parsed.error === "string" ? parsed.error : null,
      notice: typeof parsed.notice === "string" ? parsed.notice : null
    };
  } catch {
    return { error: null, notice: null };
  }
}

export default async function LeadAdsPage() {
  const authorization = await requirePagePermission("leads_ads", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.leads_ads;
  const data = await loadLeadWorkspaceData(companyId);
  if (!authorization.hasAllLocationAccess && supabaseAdmin) {
    if (!authorization.locationScopeIds.length) {
      data.ads = [];
    } else {
      const scopedLocations = await supabaseAdmin
        .from("stations")
        .select("station_code")
        .eq("company_id", companyId)
        .in("id", authorization.locationScopeIds);
      const allowedCodes = new Set((scopedLocations.data ?? []).map((station) => String(station.station_code ?? "").trim().toUpperCase()).filter(Boolean));
      data.ads = data.ads.filter((ad) => allowedCodes.has(String(ad.station_code ?? "").trim().toUpperCase()));
    }
  }
  const flash = loadFlash();
  return (
    <AppShell active="Leads" pageCode="leads_ads">
      <LeadsWorkspace canEditAds={permission.canEdit} canSyncAds={permission.canView || permission.canAdd || permission.canEdit} data={data} flash={flash} section="ads" />
    </AppShell>
  );
}
