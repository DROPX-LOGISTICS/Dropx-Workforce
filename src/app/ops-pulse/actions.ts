"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import {
  locationsForMode,
  operatingModes,
  type OperatingMode
} from "@/lib/ops-pulse/operating-context";

export async function switchOperatingContext(formData: FormData) {
  const authorization = await requirePagePermission("ops_pulse", "access");
  const companyId = requireCompanyId(authorization);
  const { locations } = await loadCodLocations(
    companyId,
    authorization.locationScopeIds,
    authorization.hasAllLocationAccess
  );
  const requestedMode = String(formData.get("mode") ?? "") as OperatingMode;
  const mode = operatingModes.some((entry) => entry.code === requestedMode)
    ? requestedMode
    : "amazon_edsp";
  const permitted = locationsForMode(locations, mode);
  const requestedLocation = String(formData.get("location") ?? "");
  const location = permitted.find((entry) => entry.id === requestedLocation) ?? permitted[0];
  const options = {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 90,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production"
  };
  cookies().set("dropx-ops-mode", mode, options);
  if (location) cookies().set("dropx-ops-location", location.id, options);
  redirect("/ops-pulse");
}
