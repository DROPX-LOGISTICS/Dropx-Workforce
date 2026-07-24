"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { uploadOpsProof } from "@/lib/ops-pulse/upload";
import { supabaseAdmin } from "@/lib/supabase-admin";

function required(value: FormDataEntryValue | null, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

export async function uploadAmazonScorecard(formData: FormData) {
  const authorization = await requirePagePermission("cod_reports", "add");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const locationId = required(formData.get("location_id"), "Location");
  if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
    throw new Error("You do not have access to this location.");
  }
  const { data: station, error: stationError } = await supabaseAdmin.from("stations")
    .select("station_code").eq("company_id", companyId).eq("id", locationId).single();
  if (stationError) throw new Error(stationError.message);
  const id = randomUUID();
  const attachment = await uploadOpsProof({
    companyId,
    field: "report_file",
    file: formData.get("report_file"),
    label: "Amazon performance report",
    section: "amazon-scorecards",
    submissionId: id
  });
  const scoreText = String(formData.get("overall_score") ?? "").trim();
  const { error } = await supabaseAdmin.from("ops_amazon_scorecards").insert(withCompany({
    id,
    location_id: locationId,
    station_code: station.station_code,
    report_type: required(formData.get("report_type"), "Report type"),
    period_from: required(formData.get("period_from"), "Period from"),
    period_to: required(formData.get("period_to"), "Period to"),
    overall_score: scoreText ? Number(scoreText) : null,
    remarks: String(formData.get("remarks") ?? "").trim() || null,
    attachment,
    created_by: authorization.userId
  }, companyId));
  if (error) throw new Error(error.message);
  revalidatePath("/ops-pulse/reports/amazon");
}
