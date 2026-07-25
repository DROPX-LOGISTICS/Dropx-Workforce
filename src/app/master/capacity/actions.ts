"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { deleteCapacityRule, saveCapacityRule } from "@/lib/ops-pulse/capacity";

export async function upsertCapacityRule(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "edit");
  const companyId = requireCompanyId(authorization);
  const stationCode = String(formData.get("station_code") ?? "").trim().toUpperCase();
  const targetSpr = Number(formData.get("target_spr"));
  const maxSafeSpr = Number(formData.get("max_safe_spr"));
  const bufferPercent = Number(formData.get("buffer_percent"));
  const recentDays = Number(formData.get("recent_days"));
  const invalid = !stationCode || targetSpr <= 0 || maxSafeSpr <= 0 || bufferPercent < 0 || recentDays < 1 || recentDays > 31;
  const error = invalid ? "Enter valid positive planning values." : await saveCapacityRule(companyId, {
    stationCode, targetSpr, maxSafeSpr, bufferPercent, recentDays, isActive: true
  });
  revalidatePath("/master/capacity");
  revalidatePath("/ops-pulse/capacity");
  redirect(`/master/capacity?${error ? `error=${encodeURIComponent(error)}` : "saved=1"}`);
}

export async function removeCapacityRule(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "edit");
  const companyId = requireCompanyId(authorization);
  const error = await deleteCapacityRule(companyId, String(formData.get("id") ?? ""));
  revalidatePath("/master/capacity");
  revalidatePath("/ops-pulse/capacity");
  redirect(`/master/capacity?${error ? `error=${encodeURIComponent(error)}` : "deleted=1"}`);
}
