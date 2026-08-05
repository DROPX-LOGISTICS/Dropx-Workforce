import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { requirePagePermission, type AuthorizationContext } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { formatDashboardDate } from "@/lib/date-format";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { clearPeopleException } from "./actions";

type ProfileRow = {
  id: string;
  full_name: string | null;
  location_id: string | null;
  statutory_applicability: string[] | null;
  pf_uan: string | null;
  esi_no: string | null;
  bank_account_no: string | null;
  driving_license_no: string | null;
  driving_license_exp_date: string | null;
  vehicle_reg_no: string | null;
  vehicle_reg_exp_date: string | null;
  vehicle_insurance_exp_date: string | null;
  vehicle_pollution_exp_date: string | null;
  updated_at: string | null;
  stations?: { station_code?: string | null } | Array<{ station_code?: string | null }> | null;
};

type VerificationRow = {
  account_id: string;
  profile_type: string;
  kind: string;
  verified: boolean;
  message: string | null;
  updated_at: string;
};

type ResolutionRow = { profile_type: string; profile_id: string; rule_code: string; source_updated_at: string };
type ExceptionRow = { profileType: string; profileId: string; name: string; location: string; category: string; ruleCode: string; issue: string; detail: string; sourceUpdatedAt: string };

const SOURCES = [
  { table: "employees", profileType: "employee", category: "Employee" },
  { table: "field_executives", profileType: "field_executive", category: "Delivery Associate" },
  { table: "contractors", profileType: "contractor", category: "Contractor" },
  { table: "vendors", profileType: "vendor", category: "Vendor" },
  { table: "workers", profileType: "worker", category: "Worker" }
] as const;

function first<T>(value: T | T[] | null | undefined) { return Array.isArray(value) ? value[0] ?? null : value ?? null; }
function clean(value: unknown) { return String(value ?? "").trim(); }
function expired(value: string | null, today: string) { return Boolean(value && value < today); }
function resolutionKey(profileType: string, profileId: string, ruleCode: string) { return `${profileType}:${profileId}:${ruleCode}`; }

async function loadExceptions(companyId: string, authorization: AuthorizationContext) {
  if (!supabaseAdmin) return { rows: [] as ExceptionRow[], error: "Database connection is not configured." };
  const select = "id, full_name, location_id, statutory_applicability, pf_uan, esi_no, bank_account_no, driving_license_no, driving_license_exp_date, vehicle_reg_no, vehicle_reg_exp_date, vehicle_insurance_exp_date, vehicle_pollution_exp_date, updated_at, stations (station_code)";
  const profileResults = await Promise.all(SOURCES.map(async (source) => {
    let query = supabaseAdmin!.from(source.table).select(select).eq("company_id", companyId);
    if (!authorization.hasAllLocationAccess && !authorization.isMasterOwner) query = query.in("location_id", authorization.locationScopeIds);
    const result = await query;
    return { source, data: (result.data ?? []) as unknown as ProfileRow[], error: result.error?.message ?? null };
  }));
  const profileError = profileResults.find((result) => result.error)?.error;
  if (profileError) return { rows: [] as ExceptionRow[], error: profileError };

  const [verificationResult, resolutionResult] = await Promise.all([
    supabaseAdmin.from("connect_profile_verifications").select("account_id, profile_type, kind, verified, message, updated_at").eq("company_id", companyId).eq("verified", false),
    supabaseAdmin.from("people_exception_resolutions").select("profile_type, profile_id, rule_code, source_updated_at").eq("company_id", companyId)
  ]);
  if (verificationResult.error) return { rows: [] as ExceptionRow[], error: verificationResult.error.message };
  if (resolutionResult.error) return { rows: [] as ExceptionRow[], error: `${resolutionResult.error.message}. Run scripts/people_exceptions_v1.sql.` };

  const today = new Date().toISOString().slice(0, 10);
  const rows: ExceptionRow[] = [];
  const profileByKey = new Map<string, { row: ProfileRow; category: string }>();
  const add = (profileType: string, category: string, profile: ProfileRow, ruleCode: string, issue: string, detail: string, sourceUpdatedAt?: string | null) => {
    rows.push({ profileType, profileId: profile.id, name: clean(profile.full_name) || "Unnamed profile", location: clean(first(profile.stations)?.station_code) || "-", category, ruleCode, issue, detail, sourceUpdatedAt: sourceUpdatedAt || profile.updated_at || new Date(0).toISOString() });
  };

  for (const result of profileResults) for (const profile of result.data) {
    profileByKey.set(`${result.source.profileType}:${profile.id}`, { row: profile, category: result.source.category });
    const statutory = profile.statutory_applicability ?? [];
    if (statutory.includes("pf") && !clean(profile.pf_uan)) add(result.source.profileType, result.source.category, profile, "pf_missing", "PF details missing", "PF is enabled, but the profile has no PF UAN.");
    if (statutory.includes("esi") && !clean(profile.esi_no)) add(result.source.profileType, result.source.category, profile, "esi_missing", "ESI details missing", "ESI is enabled, but the profile has no ESI number.");
    if (expired(profile.driving_license_exp_date, today)) add(result.source.profileType, result.source.category, profile, "dl_expired", "Driving licence expired", `Expired on ${formatDashboardDate(profile.driving_license_exp_date)}.`);
    if (clean(profile.vehicle_reg_no) && expired(profile.vehicle_reg_exp_date, today)) add(result.source.profileType, result.source.category, profile, "vehicle_registration_expired", "Vehicle registration expired", `Expired on ${formatDashboardDate(profile.vehicle_reg_exp_date)}.`);
    if (clean(profile.vehicle_reg_no) && expired(profile.vehicle_insurance_exp_date, today)) add(result.source.profileType, result.source.category, profile, "vehicle_insurance_expired", "Vehicle insurance expired", `Expired on ${formatDashboardDate(profile.vehicle_insurance_exp_date)}.`);
    if (clean(profile.vehicle_reg_no) && expired(profile.vehicle_pollution_exp_date, today)) add(result.source.profileType, result.source.category, profile, "vehicle_pollution_expired", "Pollution certificate expired", `Expired on ${formatDashboardDate(profile.vehicle_pollution_exp_date)}.`);
  }

  for (const verification of (verificationResult.data ?? []) as VerificationRow[]) {
    const profile = profileByKey.get(`${verification.profile_type}:${verification.account_id}`);
    if (!profile) continue;
    const label = verification.kind === "pf_uan" ? "PF verification failed" : verification.kind === "bank" ? "Bank verification failed" : `${verification.kind.toUpperCase()} verification failed`;
    add(verification.profile_type, profile.category, profile.row, `verification_${verification.kind}`, label, clean(verification.message) || "Submitted verification did not succeed.", verification.updated_at);
  }

  const resolutions = new Map(((resolutionResult.data ?? []) as ResolutionRow[]).map((row) => [resolutionKey(row.profile_type, row.profile_id, row.rule_code), row.source_updated_at]));
  return {
    rows: rows.filter((row) => resolutions.get(resolutionKey(row.profileType, row.profileId, row.ruleCode)) !== row.sourceUpdatedAt).sort((a, b) => a.name.localeCompare(b.name) || a.issue.localeCompare(b.issue)),
    error: null as string | null
  };
}

export const dynamic = "force-dynamic";

export default async function PeopleExceptionsPage({ searchParams }: { searchParams?: { error?: string; notice?: string } }) {
  const authorization = await requirePagePermission("people_exceptions", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.people_exceptions;
  const { rows, error } = await loadExceptions(companyId, authorization);

  return (
    <AppShell active="Exception" pageCode="people_exceptions">
      <PageHead eyebrow="People" title="Exceptions" subtitle="Review onboarding, verification, statutory, and expired-document exceptions." action={<StatusPill status={`${rows.length} open`} />} />
      {(error || searchParams?.error || searchParams?.notice) ? <section className={`panel message-panel ${error || searchParams?.error ? "error" : "success"}`}><div className="panel-body"><strong>{error || searchParams?.error ? "Exceptions need attention" : "Updated"}</strong><p className="subtle">{error || searchParams?.error || searchParams?.notice}</p></div></section> : null}
      <section className="panel">
        <div className="panel-head"><div><h2>Open exceptions</h2><p className="subtle">Cleared items reopen automatically when their source profile or verification changes and the issue still exists.</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>Person</th><th>Category</th><th>Location</th><th>Exception</th><th>Details</th><th>Action</th></tr></thead><tbody>
          {rows.length ? rows.map((row) => <tr key={`${row.profileType}:${row.profileId}:${row.ruleCode}`}><td><strong>{row.name}</strong></td><td>{row.category}</td><td>{row.location}</td><td><StatusPill status={row.issue} /></td><td>{row.detail}</td><td>{permission.canEdit ? <form action={clearPeopleException}><input name="profile_type" type="hidden" value={row.profileType} /><input name="profile_id" type="hidden" value={row.profileId} /><input name="rule_code" type="hidden" value={row.ruleCode} /><input name="source_updated_at" type="hidden" value={row.sourceUpdatedAt} /><input name="remarks" type="hidden" value="Cleared from People Exceptions" /><button className="button secondary compact" type="submit">Clear</button></form> : "-"}</td></tr>) : <tr><td className="empty-cell" colSpan={6}>No open people exceptions.</td></tr>}
        </tbody></table></div>
      </section>
    </AppShell>
  );
}
