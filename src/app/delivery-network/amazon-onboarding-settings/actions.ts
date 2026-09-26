"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { validAmazonEmailPattern } from "@/lib/amazon-activation";

function dest(params: Record<string, string>) {
  const query = new URLSearchParams(params);
  return `/delivery-network/amazon-onboarding-settings?${query}`;
}

function revalidateAmazonMasters() {
  revalidatePath("/delivery-network/amazon-onboarding-settings");
  revalidatePath("/delivery-network/id-onboarding");
  revalidatePath("/delivery-network/amazon-lifecycle");
}

export async function saveAmazonStation(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding", "edit");
  const value = (name: string) => String(form.get(name) ?? "").trim();
  const station = value("station_id");
  const tab = value("tab") || "stations";
  try {
    if (auth.readOnly) throw new Error("Preview mode is read-only.");
    if (!supabaseAdmin) throw new Error("Database connection unavailable.");
    const code = value("service_area_code").toUpperCase();
    const supervisor = value("supervisor_alias") || "anbaba";
    const contract = value("contract_type");
    const emailPattern = value("associate_email_pattern").toLowerCase();
    const amazonServiceAreaId = value("amazon_service_area_id") || null;
    if (!/^[A-Z0-9_-]{2,24}$/.test(code)) throw new Error("Enter the exact Amazon service-area code for this station.");
    if (!/^[a-zA-Z0-9._-]{2,80}$/.test(supervisor)) throw new Error("Enter the Amazon supervisor badge login without @amazon.com.");
    if (!["Independent Contractor", "Subcontractor", "DSP Employed"].includes(contract)) {
      throw new Error("Choose the approved Amazon DA contract type.");
    }
    if (!validAmazonEmailPattern(emailPattern)) {
      throw new Error("Email pattern must include {station_code} and {first_name} or {full_name}, followed by a valid domain.");
    }
    const version = Number(value("version"));
    if (!Number.isInteger(version) || version < 0) throw new Error("Refresh the station settings first.");
    const result = await supabaseAdmin.rpc("workforce_save_amazon_station", {
      p_company: requireCompanyId(auth),
      p_actor: auth.userId,
      p_actor_name: auth.fullName || auth.email || "Workforce reviewer",
      p_station: station,
      p_version: version,
      p_locations: auth.hasAllLocationAccess ? null : auth.locationScopeIds,
      p_settings: {
        service_area_code: code,
        amazon_service_area_id: amazonServiceAreaId,
        service_type: "Amazon Logistics",
        supervisor_alias: supervisor,
        contract_type: contract,
        associate_email_pattern: emailPattern,
        invitation_enabled: form.get("invitation_enabled") === "on",
      },
    });
    if (result.error) throw new Error(result.error.message);
    revalidateAmazonMasters();
    redirect(dest({ tab, station, notice: "Station onboarding defaults saved." }));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(dest({ tab, station, error: error instanceof Error ? error.message : "Unable to save station defaults." }));
  }
}

export async function saveCatalogStation(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding", "edit");
  const value = (name: string) => String(form.get(name) ?? "").trim();
  const company = requireCompanyId(auth);
  const id = value("catalog_id");
  try {
    if (auth.readOnly || !supabaseAdmin) throw new Error("Catalog edit is unavailable.");
    const stationCode = value("station_code").toUpperCase();
    const displayName = value("display_name") || null;
    const notes = value("notes") || null;
    const sortOrder = Number(value("sort_order") || "100");
    if (!/^[A-Z0-9_-]{2,24}$/.test(stationCode)) throw new Error("Station code must be 2–24 letters/numbers.");
    if (!Number.isFinite(sortOrder)) throw new Error("Sort order must be a number.");

    const { data: opsStation } = await supabaseAdmin
      .from("stations")
      .select("id,station_name")
      .eq("company_id", company)
      .ilike("station_code", stationCode)
      .maybeSingle();

    const payload = {
      company_id: company,
      station_code: stationCode,
      display_name: displayName || opsStation?.station_name || stationCode,
      notes,
      sort_order: Math.trunc(sortOrder),
      station_id: opsStation?.id ?? null,
      is_active: form.get("is_active") === "on" || form.get("is_active") === "true" || !id ? true : form.get("is_active") === "on",
      updated_at: new Date().toISOString(),
    };

    if (id) {
      const { error } = await supabaseAdmin
        .from("workforce_amazon_station_catalog")
        .update({
          ...payload,
          is_active: form.get("is_active") === "on",
        })
        .eq("company_id", company)
        .eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("workforce_amazon_station_catalog").insert(payload);
      if (error) throw new Error(error.message);
    }
    revalidateAmazonMasters();
    redirect(dest({ tab: "catalog", notice: id ? "Station catalog updated." : "Station added to catalog." }));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(dest({ tab: "catalog", error: error instanceof Error ? error.message : "Unable to save catalog station." }));
  }
}

export async function deleteCatalogStation(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding", "edit");
  const company = requireCompanyId(auth);
  const id = String(form.get("catalog_id") ?? "").trim();
  try {
    if (auth.readOnly || !supabaseAdmin) throw new Error("Delete is unavailable.");
    if (!id) throw new Error("Choose a catalog row to delete.");
    const { error } = await supabaseAdmin
      .from("workforce_amazon_station_catalog")
      .delete()
      .eq("company_id", company)
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidateAmazonMasters();
    redirect(dest({ tab: "catalog", notice: "Station removed from catalog." }));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(dest({ tab: "catalog", error: error instanceof Error ? error.message : "Unable to delete catalog station." }));
  }
}

export async function saveSupervisor(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding", "edit");
  const value = (name: string) => String(form.get(name) ?? "").trim();
  const company = requireCompanyId(auth);
  const id = value("supervisor_id");
  try {
    if (auth.readOnly || !supabaseAdmin) throw new Error("Supervisor edit is unavailable.");
    const alias = value("supervisor_alias");
    const displayName = value("display_name") || null;
    if (!/^[a-zA-Z0-9._-]{2,80}$/.test(alias)) {
      throw new Error("Supervisor alias must be 2–80 chars without @amazon.com.");
    }
    const stationCodes = form
      .getAll("station_codes")
      .map((v) => String(v).trim().toUpperCase())
      .filter((code) => /^[A-Z0-9_-]{2,24}$/.test(code));

    let supervisorId = id;
    if (id) {
      const { error } = await supabaseAdmin
        .from("workforce_amazon_supervisors")
        .update({
          supervisor_alias: alias,
          display_name: displayName,
          is_active: form.get("is_active") === "on",
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", company)
        .eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabaseAdmin
        .from("workforce_amazon_supervisors")
        .insert({
          company_id: company,
          supervisor_alias: alias,
          display_name: displayName,
          is_active: true,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      supervisorId = data.id as string;
    }

    await supabaseAdmin
      .from("workforce_amazon_supervisor_stations")
      .delete()
      .eq("company_id", company)
      .eq("supervisor_id", supervisorId);

    if (stationCodes.length) {
      const { error } = await supabaseAdmin.from("workforce_amazon_supervisor_stations").insert(
        stationCodes.map((station_code) => ({
          company_id: company,
          supervisor_id: supervisorId,
          station_code,
        })),
      );
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin.from("workforce_amazon_supervisor_defaults").upsert(
      { company_id: company, supervisor_alias: alias, updated_at: new Date().toISOString() },
      { onConflict: "company_id" },
    );

    revalidateAmazonMasters();
    redirect(dest({ tab: "supervisors", supervisor: supervisorId, notice: "Supervisor and station coverage saved." }));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(dest({ tab: "supervisors", error: error instanceof Error ? error.message : "Unable to save supervisor." }));
  }
}

export async function deleteSupervisor(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding", "edit");
  const company = requireCompanyId(auth);
  const id = String(form.get("supervisor_id") ?? "").trim();
  try {
    if (auth.readOnly || !supabaseAdmin) throw new Error("Delete is unavailable.");
    if (!id) throw new Error("Choose a supervisor to delete.");
    const { error } = await supabaseAdmin
      .from("workforce_amazon_supervisors")
      .delete()
      .eq("company_id", company)
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidateAmazonMasters();
    redirect(dest({ tab: "supervisors", notice: "Supervisor deleted." }));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(dest({ tab: "supervisors", error: error instanceof Error ? error.message : "Unable to delete supervisor." }));
  }
}
