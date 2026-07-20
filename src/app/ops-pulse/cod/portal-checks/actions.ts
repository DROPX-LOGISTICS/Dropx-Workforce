"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { clean, dateFromForm } from "@/lib/ops-pulse/cod";
import { supabaseAdmin } from "@/lib/supabase-admin";

const path = "/ops-pulse/cod/portal-checks";

function setFlash(params: { error?: string; notice?: string }) {
  cookies().set("dropx_cod_portal_checks_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 30,
    path,
    sameSite: "lax"
  });
  redirect(path);
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

export async function queuePortalChecks(formData: FormData) {
  const authorization = await requirePagePermission("cod_portal_checks", "add");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const checkDate = dateFromForm(formData.get("check_date"), "Check date");
    const locationId = clean(formData.get("location_id"));

    let settingsQuery = supabaseAdmin
      .from("cod_station_settings")
      .select("id, location_id, station_code, portal_station_code, portal_checks_enabled")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .eq("portal_checks_enabled", true);

    if (locationId) settingsQuery = settingsQuery.eq("location_id", locationId);
    if (!authorization.hasAllLocationAccess) {
      settingsQuery = settingsQuery.in(
        "location_id",
        authorization.locationScopeIds.length ? authorization.locationScopeIds : ["00000000-0000-0000-0000-000000000000"]
      );
    }

    const { data: settings, error: settingsError } = await settingsQuery;
    if (settingsError) throw new Error(settingsError.message);
    if (!settings?.length) throw new Error("No enabled COD portal-check stations found for this selection.");

    let queued = 0;
    const now = new Date().toISOString();
    for (const setting of settings) {
      for (const checkType of ["driver_reconciliation", "prepared_deposit"]) {
        const payload = {
          company_id: companyId,
          location_id: setting.location_id,
          cod_master_id: setting.id,
          station_code: setting.station_code ?? setting.portal_station_code ?? "-",
          portal_station_code: setting.portal_station_code ?? setting.station_code ?? null,
          check_date: checkDate,
          check_type: checkType,
          status: "Queued",
          pending_count: 0,
          pending_amount: 0,
          summary: "Queued for backend portal check.",
          evidence: {},
          raw_result: {},
          next_check_at: now,
          error_message: null,
          updated_at: now,
          created_by: authorization.userId
        };
        const { error } = await supabaseAdmin
          .from("ops_portal_check_runs")
          .upsert(payload, { onConflict: "company_id,location_id,check_date,check_type" });
        if (error) throw new Error(error.message);
        queued += 1;
      }
    }

    revalidatePath(path);
    setFlash({ notice: `${queued} portal checks queued for ${checkDate}.` });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    setFlash({ error: error instanceof Error ? error.message : "Unable to queue portal checks." });
  }
}
