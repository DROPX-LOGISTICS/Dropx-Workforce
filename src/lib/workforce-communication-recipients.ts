import { readAllRows } from "@/lib/supabase-pagination";
import { isFieldActive, isRetiredWorkforceTable } from "@/lib/workforce-controls";
import type { AuthorizationContext } from "@/lib/authorization";
import { firstDesignationBusinessCategory } from "@/lib/designation-business-categories";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { WorkforceProfileType } from "@/lib/workforce-profiles";

export type WorkforceRecipientProfileType = WorkforceProfileType;

export type WorkforceCommunicationRecipient = {
  accountId: string;
  profileType: WorkforceRecipientProfileType;
  name: string;
  reference: string;
  biometricId: string;
  category: "Workforce";
  location: string;
  designation: string;
  mobile: string;
  countryCode: string;
  email: string;
  provider: string;
  model: string;
  status: string;
  isActive: boolean;
  compatibilityMode: boolean;
  engagementType: string;
  sourceProfileType: string;
  sourceProfileId: string;
  locationId: string;
};

type LocationRelation = {
  station_code?: string | null;
  providers?: { name?: string | null } | Array<{ name?: string | null }> | null;
  location_models?: { code?: string | null; name?: string | null } | Array<{ code?: string | null; name?: string | null }> | null;
};

type LegacyProfileRow = {
  id: string;
  location_id?: string | null;
  lifecycle_status?: string | null;
  dropx_id?: string | null;
  biometric_id?: string | null;
  full_name?: string | null;
  mobile_country_code?: string | null;
  mobile?: string | null;
  email?: string | null;
  designation?: string | null;
  onboarding_status?: string | null;
  is_active?: boolean | null;
  stations?: LocationRelation | LocationRelation[] | null;
};

type CanonicalWorkforceRow = LegacyProfileRow & {
  source_profile_type: string;
  source_profile_id: string;
  compatibility_mode: boolean;
};

function first<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function cleanDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function statusLabel(value: unknown, isActive: boolean) {
  const status = normalized(value) || (isActive ? "active" : "pending");
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function recipientFromRow(
  row: LegacyProfileRow,
  profileType: WorkforceRecipientProfileType,
  accountId: string,
  compatibilityMode: boolean
): WorkforceCommunicationRecipient {
  const station = first(row.stations);
  const provider = first(station?.providers);
  const model = first(station?.location_models);
  const isActive = isFieldActive(row);
  return {
    accountId,
    profileType,
    name: String(row.full_name ?? "Unnamed workforce member"),
    reference: String(row.dropx_id ?? ""),
    biometricId: String(row.biometric_id ?? ""),
    category: "Workforce",
    location: String(station?.station_code ?? ""),
    designation: String(row.designation ?? ""),
    mobile: cleanDigits(row.mobile),
    countryCode: cleanDigits(row.mobile_country_code) || "91",
    email: String(row.email ?? ""),
    provider: String(provider?.name ?? ""),
    model: String(model?.code || model?.name || ""),
    status: statusLabel(row.onboarding_status, isActive),
    isActive,
    compatibilityMode,
    engagementType: profileType === "vendor" || profileType === "worker" ? "operations" : "associate",
    sourceProfileType: profileType,
    sourceProfileId: accountId,
    locationId: row.location_id ?? ""
  };
}

function applyLocationScope(
  // Supabase's recursive query-builder type becomes excessively deep when shared across four table names.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  authorization: AuthorizationContext
) {
  if (authorization.hasAllLocationAccess) return query;
  return query.in(
    "location_id",
    authorization.locationScopeIds.length
      ? authorization.locationScopeIds
      : ["00000000-0000-0000-0000-000000000000"]
  );
}

export async function loadWorkforceCommunicationRecipients(authorization: AuthorizationContext) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  if (!authorization.companyId) throw new Error("Select a company before loading Workforce recipients.");
  const companyId = authorization.companyId;
  const admin = supabaseAdmin;
  const locationSelect = "stations (station_code, providers (name), location_models (code, name))";

  const designationResult = await admin
    .from("designations")
    .select("id, code, name, onboarding_categories, designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active)")
    .eq("company_id", companyId)
    .eq("is_active", true);
  if (designationResult.error) throw new Error(designationResult.error.message);

  const workforceDesignationKeys = new Set<string>();
  const engagementByDesignation = new Map<string, string>();
  for (const designation of designationResult.data ?? []) {
    if (firstDesignationBusinessCategory(designation.designation_category)?.people_module !== "delivery_network") continue;
    workforceDesignationKeys.add(normalized(designation.code));
    workforceDesignationKeys.add(normalized(designation.name));
    const engagement = (designation.onboarding_categories ?? []).some((value: string) => ["vendors", "workers"].includes(value)) ? "operations" : "associate";
    engagementByDesignation.set(normalized(designation.code), engagement);
    engagementByDesignation.set(normalized(designation.name), engagement);
  }
  if (!workforceDesignationKeys.size) return [] as WorkforceCommunicationRecipient[];

  const legacySelect = `id, location_id, dropx_id, biometric_id, full_name, mobile_country_code, mobile, email, designation, onboarding_status, is_active, ${locationSelect}`;
  const canonicalQuery = applyLocationScope(
    admin
      .from("workforce")
      .select(`source_profile_type, source_profile_id, compatibility_mode, ${legacySelect}`)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .neq("migration_state", "reclassified"),
    authorization
  );
  const profileQuery = async (table: "field_executives" | "contractors" | "vendors" | "workers") => {
    const result = await readAllRows(applyLocationScope(
      admin
        .from(table)
        .select(legacySelect)
        .eq("company_id", companyId),
      authorization
    ).order("id"));
    // These legacy sources can be retired after their profiles move to Workforce/People.
    // Keep reading them when present so unfinished registrations remain available.
    const missingRetiredTable = isRetiredWorkforceTable(result.error, table);
    return missingRetiredTable ? { ...result, data: [], error: null } : result;
  };
  const [canonical, fieldExecutives, contractors, vendors, workers, identityLinks] = await Promise.all([
    readAllRows(canonicalQuery.order("id")),
    profileQuery("field_executives"),
    profileQuery("contractors"),
    profileQuery("vendors"),
    profileQuery("workers"),
    readAllRows(admin
      .from("workforce_identity_links")
      .select("legacy_profile_type, legacy_profile_id, target_profile_type")
      .eq("company_id", companyId)
      .eq("compatibility_active", true).order("id"))
  ]);
  const error = canonical.error ?? fieldExecutives.error ?? contractors.error ?? vendors.error ?? workers.error ?? identityLinks.error;
  if (error) throw new Error(error.message);

  const movedLegacyKeys = new Set((identityLinks.data ?? [])
    .filter((link) => ["workforce", "vendor", "worker"].includes(link.target_profile_type))
    .map((link) => `${link.legacy_profile_type}:${link.legacy_profile_id}`));
  const recipients = new Map<string, WorkforceCommunicationRecipient>();
  const add = (recipient: WorkforceCommunicationRecipient) => {
    const key = `${recipient.profileType}:${recipient.accountId}`;
    if (!recipients.has(key)) recipients.set(key, recipient);
  };

  for (const row of (canonical.data ?? []) as unknown as CanonicalWorkforceRow[]) {
    const recipient = recipientFromRow(row, "workforce", row.id, Boolean(row.compatibility_mode));
    recipient.engagementType = engagementByDesignation.get(normalized(row.designation)) ?? "associate";
    recipient.sourceProfileType = row.source_profile_type;
    recipient.sourceProfileId = row.source_profile_id;
    add(recipient);
  }

  const addLegacyRows = (rows: LegacyProfileRow[], profileType: WorkforceRecipientProfileType) => {
    for (const row of rows) {
      if (!workforceDesignationKeys.has(normalized(row.designation))) continue;
      if ((profileType === "field_executive" || profileType === "contractor") && movedLegacyKeys.has(`${profileType}:${row.id}`)) continue;
      add(recipientFromRow(row, profileType, row.id, profileType === "field_executive" || profileType === "contractor"));
    }
  };

  addLegacyRows((fieldExecutives.data ?? []) as unknown as LegacyProfileRow[], "field_executive");
  addLegacyRows((contractors.data ?? []) as unknown as LegacyProfileRow[], "contractor");
  addLegacyRows((vendors.data ?? []) as unknown as LegacyProfileRow[], "vendor");
  addLegacyRows((workers.data ?? []) as unknown as LegacyProfileRow[], "worker");

  return Array.from(recipients.values()).sort((left, right) => left.name.localeCompare(right.name));
}
